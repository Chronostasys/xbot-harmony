/**
 * 最近工作目录 —— **纯逻辑移植** web `src/lib/recent-workdirs.ts`（load/remember/remove）。
 *
 * 用途（对齐 web）：新建会话要选 cwd（工作目录），手机上重打路径极烦 ⇒ 记住最近用过的
 * 5 个目录，选目录时直接给候选。web 侧把这份列表存 **localStorage**（键 `xbot:recent-workdirs:v1`）
 * **并同步到服务端**（服务端键 `web:workspace:recent-workdirs`，见 `web/src/lib/userSettings.ts:44`）；
 * 原生端复用项目既有的「设置项都是 string」通道（读写用**服务端键** `RECENT_WORKDIRS_SERVER_KEY`，
 * 所以本文件只做**串 ↔ 列表**的纯变换 + 增删语义，**不碰任何存储 API**（便于脱机单测，
 * 也让宿主自由选择落盘位置）。
 *
 * ⚠️ 存储格式**必须与 web 逐字一致**（`{ version: 1, paths: string[] }` 的 JSON）——
 * 两端读同一份服务端设置，格式不一致 = 一端读到另一端写的就废。
 *
 * ── 语义（逐条对齐 web）──────────────────────────────────────────────────────
 *   · 上限 5，**最新在前**（remember 把新目录插到最前，去重后截断到 5）。
 *   · 解析时：版本不符 / 非数组 / 脏项 ⇒ 丢弃；字符串项 trim；空串剔；**去重保首现序**。
 *   · remember 传空/纯空白 ⇒ **不改**（返回原列表）。
 *   · remove 用**原始入参**比较（不做 trim）—— 逐字对齐 web，避免"删不掉"的静默分歧。
 *   · 任何 JSON 解析异常 ⇒ 返回 `[]`（**绝不抛**：设置串可能被外部改脏）。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/recentdirs.test.ts`）。本文件属 `core/`，被
 * `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*`。
 */

/** web 的 **localStorage** 键（`recentWorkDirsStorageKey`，与 web 逐字一致；原生无 localStorage）。 */
export const RECENT_WORKDIRS_KEY: string = 'xbot:recent-workdirs:v1';
/**
 * **服务端**设置键 —— 两端读写**同一份**服务端偏好的键。
 *
 * 为什么不是 `RECENT_WORKDIRS_KEY`：web 的 localStorage 键经 `userSettings.ts:44`
 * 的 `SETTING_MAP` 映射到服务端键 `web:workspace:recent-workdirs`；原生没有 localStorage，
 * 走 `store.saveSettings`/`store.settings`（服务端通道）⇒ 必须用**服务端键**才与 web 共读一份。
 * ⚠️ 原生 `core/settings.ets` 未收录该键 ⇒ `serverKey()/localKey()` 对它**原样透传**（§17.5-5 零丢键）
 *    ⇒ 用它读写即命中 web 写的同一格。
 *
 * ⛔ **决策留痕（main agent 裁决，2026-10-11）**：**不要**再给 `core/settings.ets` 加
 *    `xbot:recent-workdirs:v1 → web:workspace:recent-workdirs` 的映射。理由：① 无收益（透传已等价命中）；
 *    ② 会多出一处需要长期守住的一致性（且 `settings.test.ts` 现把该键列为"web 独有键、原样透传"）。
 *    改动方=本常量 + 宿主（`pages/Index.ets` 的 `NewSessionSheet`）。
 */
export const RECENT_WORKDIRS_SERVER_KEY: string = 'web:workspace:recent-workdirs';
/** 存储格式版本（web 写死 1；不匹配即拒）。 */
export const RECENT_WORKDIRS_VERSION: number = 1;
/** 保留条数上限。 */
export const RECENT_WORKDIRS_MAX: number = 5;

/**
 * 解析存储串 ⇒ 目录列表（去脏、trim、去空、去重保序、截断到上限）。
 * 任何异常/版本不符/形状不符 ⇒ `[]`。
 */
export function parseRecentWorkDirs(raw: string | undefined | null): string[] {
  if (raw === undefined || raw === null || raw.length === 0) { return []; }
  let parsed: Object | null = null;
  try {
    parsed = JSON.parse(raw) as Object | null;
  } catch (e) {
    return [];
  }
  if (parsed === null || parsed === undefined) { return []; }
  const obj: Record<string, Object> = parsed as Record<string, Object>;
  if (obj['version'] !== RECENT_WORKDIRS_VERSION) { return []; }
  const pathsRaw: Object = obj['paths'];
  if (!Array.isArray(pathsRaw)) { return []; }
  const arr: Object[] = pathsRaw as Object[];
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item: Object = arr[i];
    if (typeof item !== 'string') { continue; }
    const s: string = (item as string).trim();
    if (s.length === 0) { continue; }
    let dup: boolean = false;
    for (let j = 0; j < out.length; j++) {
      if (out[j] === s) { dup = true; break; }
    }
    if (!dup) { out.push(s); }
  }
  return out.slice(0, RECENT_WORKDIRS_MAX);
}

/** 序列化 ⇒ 存储串（格式与 web 逐字一致）。 */
export function serializeRecentWorkDirs(paths: string[]): string {
  return JSON.stringify({ version: RECENT_WORKDIRS_VERSION, paths: paths });
}

/**
 * 记住一个工作目录（返回**新列表**，不改入参）：新目录插到最前、去重、截断到上限。
 * 入参为空/纯空白 ⇒ 原样返回（不写入噪声）。
 */
export function rememberWorkDir(paths: string[], workDir: string): string[] {
  const normalized: string = workDir.trim();
  if (normalized.length === 0) { return paths; }
  const next: string[] = [normalized];
  for (let i = 0; i < paths.length && next.length < RECENT_WORKDIRS_MAX; i++) {
    if (paths[i] !== normalized) { next.push(paths[i]); }
  }
  return next;
}

/**
 * 移除一个工作目录（返回**新列表**）。⚠️ 逐字对齐 web：用**原始入参**比较（不 trim）。
 */
export function removeWorkDir(paths: string[], workDir: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    if (paths[i] !== workDir) { out.push(paths[i]); }
  }
  return out;
}

/** 是否已在列表中（UI 判"删除"该不该亮用的）。 */
export function hasWorkDir(paths: string[], workDir: string): boolean {
  for (let i = 0; i < paths.length; i++) {
    if (paths[i] === workDir) { return true; }
  }
  return false;
}
