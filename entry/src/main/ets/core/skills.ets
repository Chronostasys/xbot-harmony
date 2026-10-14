/**
 * skills.ets —— **技能管理**的纯逻辑（目标④「真的支持 web 的所有插件和功能」）。
 *
 * 背景：web 把技能管理做成**内置前端插件** `xbot.skill-manager`
 * （`web/src/plugins/xbot-skill-manager/SkillManagerPanel.tsx`；`contributes.container = right_sidebar`）。
 * 原生此前**零覆盖**（全仓仅 2 处附带提到 skill，均非管理面）⇒ 这是真实的 parity 缺口
 * （不是"重写 web 逻辑"：视图是原生重做，判据/契约仍以服务端与 web 为权威）。
 *
 * 权威契约（服务端源码逐字）：
 *   · `skill_list` `{project_dir}` → `SkillDetail[]`
 *     （`serverapp/rpc_table.go:3148-3158` → `agent/skills.go:368 ListSkillsDetailed`）
 *     字段 = `SkillInfo{name,description,path,author?,tags?,sharing?}`
 *            ⊕ `{source,enabled,can_uninstall}`（`agent/skills.go:357-362`）
 *     `source ∈ {embedded,global,user,project}`（`deriveSource`）；`enabled=false` ⇔ 在
 *     `disabled_skills` 黑名单里；`can_uninstall=true` ⇔ 用户自己装的（仅在 user 目录下）。
 *   · `skill_set_enabled` `{name,enabled}` → `{status:"ok"}`
 *   · `skill_get_content` `{path}` → `{content}`（**path 是技能目录**，服务端自己拼 `SKILL.md`）
 *   · `skill_validate_path` / `skill_install_file` / 市场 REST：本批不做安装/卸载（见 §21.43 待办）。
 *
 * web 行为（`SkillManagerPanel.tsx:47-107`）：列表；开关 = **乐观更新 + 300ms 防抖 +
 * 失败回滚 + 静默重载**；点行 = 打开 `{path}/SKILL.md`。
 *
 * ⛔ 本文件是**纯逻辑**（无 ArkUI / 无 `@ohos.*`）⇒ 被 `tools/tests/run.sh` 当纯 TS 编译，
 *    面板只画这里算出来的东西，**判据与渲染同源**（分组/标签/文案不许组件各写一份）。
 */

/** 来源档（与服务端 `SkillDetail.source` **逐字**对齐）。 */
export const SKILL_SOURCE_PROJECT: string = 'project';
export const SKILL_SOURCE_USER: string = 'user';
export const SKILL_SOURCE_GLOBAL: string = 'global';
export const SKILL_SOURCE_EMBEDDED: string = 'embedded';
/** 服务端将来若加新档：归到「其他」，⛔ 不丢行、不崩（fail-safe 显示）。 */
export const SKILL_SOURCE_OTHER: string = 'other';

/** 面板显示的**档序**：项目（最具体）→ 用户 → 全局 → 内置 → 其他。 */
export const SKILL_SOURCE_ORDER: string[] = [
  SKILL_SOURCE_PROJECT, SKILL_SOURCE_USER, SKILL_SOURCE_GLOBAL, SKILL_SOURCE_EMBEDDED, SKILL_SOURCE_OTHER,
];

/** 一条技能（= 服务端 `SkillDetail` 的**归一化**视图模型）。 */
export interface SkillItem {
  name: string;
  description: string;
  /** 技能目录（内置的是 `embedded:<name>` 这种伪路径）。 */
  path: string;
  source: string;
  enabled: boolean;
  canUninstall: boolean;
}

/** 服务端原始条目（字段可缺 —— 归一化在本模块，⛔ 组件不做兼容判断）。 */
export interface SkillWire {
  name?: string;
  description?: string;
  path?: string;
  source?: string;
  enabled?: boolean;
  can_uninstall?: boolean;
}

/** 来源归一化：四个已知档原样，其余（含 `undefined`/空串）归「其他」。 */
export function normalizeSkillSource(source: string | undefined): string {
  if (source === undefined || source === null) {
    return SKILL_SOURCE_OTHER;
  }
  const s: string = source.trim();
  for (let i = 0; i < SKILL_SOURCE_ORDER.length; i++) {
    if (SKILL_SOURCE_ORDER[i] === s) {
      return s;
    }
  }
  return SKILL_SOURCE_OTHER;
}

/**
 * 技能描述的**显示规范化**（真机截图 `/tmp/s_skills.jpeg` 抓到的细节缺陷，目标③「细节完美」）：
 * 服务端 `parseSkillFrontmatter` 只做 `TrimSpace`（`agent/skills.go:623`）⇒ SKILL.md 里
 * **带引号**的 frontmatter 值（描述含 `:` 时 YAML 必须加引号，本仓 `orchestrator`/`agent-creator`
 * 等即是）会**连引号一起**下发；web `SkillManagerPanel.tsx:227` 直出 ⇒ 列表里出现
 * `"Manage SubAgent roles: …` 这种引号开头。这里剥掉**成对包裹**的引号（`"` / `'` / 全角 `“”`、
 * `‘’`），其余原样 —— ⛔ 只删真正的定界符，不碰正文里的引号（如描述里写 `xbot` 的 `"name"`）。
 * ⛔ 用字符码比较（34/39/8220/8221/8216/8217）：避免源码里转义引号的可读性/编译坑。
 */
export function normalizeSkillDescription(raw: string | undefined): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  const s: string = raw.trim();
  if (s.length < 2) {
    return s;
  }
  const f: number = s.charCodeAt(0);
  const l: number = s.charCodeAt(s.length - 1);
  const paired: boolean = (f === 34 && l === 34)       // " … "
    || (f === 39 && l === 39)                           // ' … '
    || (f === 8220 && l === 8221)                       // “ … ”
    || (f === 8216 && l === 8217);                      // ‘ … ’
  return paired ? s.substring(1, s.length - 1).trim() : s;
}

/**
 * 解析 `skill_list` 的响应。
 *
 * ⛔ **绝不抛**：非数组/条目缺 `name` ⇒ 跳过该条（面板要能显示"空"而不是崩）。
 * ⛔ `enabled` 只在**显式为 `true`** 时为真（与 web 的 `SkillDetail.enabled` 读法一致：
 *    字段缺失 ⇒ 视作未启用，让用户看到真实状态而不是乐观的"已启用"）。
 */
export function parseSkillList(raw: SkillWire[] | undefined): SkillItem[] {
  const out: SkillItem[] = [];
  if (raw === undefined || raw === null || !Array.isArray(raw)) {
    return out;
  }
  for (let i = 0; i < raw.length; i++) {
    const w: SkillWire = raw[i];
    if (w === undefined || w === null) {
      continue;
    }
    const name: string = w.name !== undefined && w.name !== null ? w.name.trim() : '';
    if (name.length === 0) {
      continue;
    }
    out.push({
      name: name,
      description: normalizeSkillDescription(w.description),
      path: w.path !== undefined && w.path !== null ? w.path : '',
      source: normalizeSkillSource(w.source),
      enabled: w.enabled === true,
      canUninstall: w.can_uninstall === true,
    });
  }
  return out;
}

/** 来源档的中文标签（组标题；⛔ 单一真源，组件不各写一份）。 */
export function skillSourceLabel(source: string): string {
  if (source === SKILL_SOURCE_PROJECT) {
    return '项目技能';
  }
  if (source === SKILL_SOURCE_USER) {
    return '我的技能';
  }
  if (source === SKILL_SOURCE_GLOBAL) {
    return '全局技能';
  }
  if (source === SKILL_SOURCE_EMBEDDED) {
    return '内置技能';
  }
  return '其他技能';
}

/** 一个来源分组（面板的 section）。 */
export interface SkillGroup {
  source: string;
  label: string;
  items: SkillItem[];
}

/**
 * 按来源分组（**档序 = `SKILL_SOURCE_ORDER`**，组内**保持服务端顺序** —— 服务端
 * `ListSkills` 已按名称排好，⛔ 不再二次排序，免得与后端策展顺序分叉）。
 * 空组不产出（⛔ 不画空 section）。
 */
export function skillGroups(items: SkillItem[]): SkillGroup[] {
  const out: SkillGroup[] = [];
  for (let i = 0; i < SKILL_SOURCE_ORDER.length; i++) {
    const src: string = SKILL_SOURCE_ORDER[i];
    const bucket: SkillItem[] = [];
    for (let j = 0; j < items.length; j++) {
      if (items[j].source === src) {
        bucket.push(items[j]);
      }
    }
    if (bucket.length > 0) {
      out.push({ source: src, label: skillSourceLabel(src), items: bucket });
    }
  }
  return out;
}

/** 行类型：**分组标题行**。 */
export const SKILL_ROW_GROUP: string = 'group';
/** 行类型：**技能条目行**。 */
export const SKILL_ROW_ITEM: string = 'item';

/** 面板列表的一行（**扁平模型**：组标题与条目同处一维数组）。 */
export interface SkillRow {
  kind: string;
  /** 组标题行 = 组名；条目行 = 技能名。 */
  label: string;
  /** 条目行才有；组标题行为 `undefined`。 */
  item: SkillItem | undefined;
}

/**
 * 把分组模型**摊平成一维行数组**（组标题行 ⊕ 该组的条目行，按 `SKILL_SOURCE_ORDER`）。
 *
 * ⛔ 为什么摊平而不是在组件里写两层 `ForEach`：性能预算 ⑦（`ForEach(` 全仓硬上限）
 *    —— 摊平后渲染只需**一处**列表站点（与 `TerminalSheet` 的 flow 摊平同理）。
 */
export function skillRows(items: SkillItem[]): SkillRow[] {
  const groups: SkillGroup[] = skillGroups(items);
  const out: SkillRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g: SkillGroup = groups[i];
    out.push({ kind: SKILL_ROW_GROUP, label: `${g.label} · ${g.items.length}`, item: undefined });
    for (let j = 0; j < g.items.length; j++) {
      out.push({ kind: SKILL_ROW_ITEM, label: g.items[j].name, item: g.items[j] });
    }
  }
  return out;
}

/** 开关的**可访问性文案**（描述动作，不是状态 —— 读屏软件读的是"点了会发生什么"）。 */
export function skillToggleLabel(name: string, enabled: boolean): string {
  return `${enabled ? '禁用' : '启用'}技能 ${name}`;
}

/** 头部的计数文案：`10 个技能 · 全部启用` / `12 个技能 · 9 启用 · 3 禁用`。 */
export function skillSummaryText(items: SkillItem[]): string {
  if (items.length === 0) {
    return '暂无技能';
  }
  let on: number = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].enabled) {
      on++;
    }
  }
  if (on === items.length) {
    return `${items.length} 个技能 · 全部启用`;
  }
  if (on === 0) {
    return `${items.length} 个技能 · 全部禁用`;
  }
  return `${items.length} 个技能 · ${on} 启用 · ${items.length - on} 禁用`;
}

/**
 * 行内的**路径提示**（第二行元信息）：内置技能是 `embedded:<name>` 伪路径 ⇒ 返回空串
 * （画出来是噪音）；真实磁盘路径才显示（用户能据此去找文件）。
 */
export function skillPathHint(path: string): string {
  if (path.length === 0) {
    return '';
  }
  if (path.indexOf('embedded:') === 0) {
    return '';
  }
  return path;
}
