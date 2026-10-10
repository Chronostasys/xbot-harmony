/**
 * Unified diff 解析 —— **逐字移植** web `src/components/agent/DiffView.tsx` 的
 * `extractDiffSource()` + `parseUnifiedDiff()`（本工程自己的代码，属"对齐"而非重造）。
 *
 * web 的语义（必须保持一致，否则同一份 diff 在两端行号/增删统计会不一致）：
 *  · 文件头：`+++ b/path` 开一个新文件段（路径取这里，去掉 `b/` 前缀）；`--- a/…`/`diff `/`index ` 跳过。
 *  · 块头：`@@ -旧起,数 +新起,数 @@` —— 记录旧/新**起始行号**（后续 ctx/add/del 逐行自增）。
 *  · `+` ⇒ add（吃新行号）；`-` ⇒ del（吃旧行号）；` ` 或空 ⇒ ctx（两个都吃）；其它 ⇒ plain。
 *  · 段内无行的文件段被丢弃（`filter(f => f.lines.length > 0)`）。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/diffparse.test.ts`）。
 */

export const DIFF_ADD: string = 'add';
export const DIFF_DEL: string = 'del';
export const DIFF_CTX: string = 'ctx';
export const DIFF_HUNK: string = 'hunk';
export const DIFF_META: string = 'meta';
export const DIFF_PLAIN: string = 'plain';

export class DiffLine {
  kind: string = DIFF_PLAIN;
  /** 行内容（**不含**前导 +/-/空格 标记）。 */
  text: string = '';
  /** 1-based 旧文件行号（del / ctx 行有）。0 = 无。 */
  oldNum: number = 0;
  /** 1-based 新文件行号（add / ctx 行有）。0 = 无。 */
  newNum: number = 0;
}

export class DiffFile {
  /** 头部展示的路径（来自 `+++` 行）。 */
  path: string = '';
  lines: DiffLine[] = [];
  adds: number = 0;
  dels: number = 0;
}

/**
 * 从 ToolHints 里抽出 diff 源。
 * ToolHints 格式为 `"```diff\n<diff>\n```"`（见服务端 `engine_run_tools.go`）；
 * 非围栏输入按裸 diff 文本处理。
 */
export function extractDiffSource(hints: string): string {
  const re: RegExp = /```diff\n([\s\S]*?)```/;
  const m: RegExpExecArray | null = re.exec(hints);
  if (m !== null && m.length > 1 && m[1] !== undefined) {
    return m[1];
  }
  return hints;
}

/** diff 里是否"看起来有内容"（用于决定要不要渲染 diff 卡）。 */
export function hasDiffBody(hints: string): boolean {
  if (hints.length === 0) { return false; }
  const src: string = extractDiffSource(hints);
  return src.indexOf('@@') >= 0 || src.indexOf('\n+') >= 0 || src.indexOf('\n-') >= 0
    || src.startsWith('+') || src.startsWith('-');
}

function startsWith(s: string, p: string): boolean {
  return s.length >= p.length && s.substring(0, p.length) === p;
}

/** 解析 unified diff ⇒ 逐文件分组。 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLine: number = 0;
  let newLine: number = 0;

  const pushLine = (ln: DiffLine): void => {
    if (current === null) {
      current = new DiffFile();
      files.push(current);
    }
    const f: DiffFile = current as DiffFile;
    f.lines.push(ln);
    if (ln.kind === DIFF_ADD) { f.adds++; }
    if (ln.kind === DIFF_DEL) { f.dels++; }
  };

  const raw: string[] = diff.split('\n');
  for (let i = 0; i < raw.length; i++) {
    const line: string = raw[i];

    if (startsWith(line, '+++ ')) {
      // 新文件段开始 —— 路径取 `+++ b/path` 去掉 `b/`
      let p: string = line.substring(4).trim();
      if (startsWith(p, 'b/')) { p = p.substring(2); }
      current = new DiffFile();
      current.path = p;
      files.push(current);
      continue;
    }
    if (startsWith(line, '--- ') || startsWith(line, 'diff ') || startsWith(line, 'index ')) {
      continue;
    }
    if (startsWith(line, '@@')) {
      const m: RegExpExecArray | null = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m !== null) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      const ln: DiffLine = new DiffLine();
      ln.kind = DIFF_HUNK;
      ln.text = line;
      pushLine(ln);
      continue;
    }
    if (startsWith(line, '+')) {
      const ln: DiffLine = new DiffLine();
      ln.kind = DIFF_ADD;
      ln.text = line.substring(1);
      ln.newNum = newLine;
      newLine++;
      pushLine(ln);
      continue;
    }
    if (startsWith(line, '-')) {
      const ln: DiffLine = new DiffLine();
      ln.kind = DIFF_DEL;
      ln.text = line.substring(1);
      ln.oldNum = oldLine;
      oldLine++;
      pushLine(ln);
      continue;
    }
    if (startsWith(line, ' ') || line.length === 0) {
      if (line.length === 0 && current === null) { continue; }
      const ln: DiffLine = new DiffLine();
      ln.kind = DIFF_CTX;
      ln.text = line.length > 0 ? line.substring(1) : '';
      ln.oldNum = oldLine;
      ln.newNum = newLine;
      oldLine++;
      newLine++;
      pushLine(ln);
      continue;
    }
    const ln: DiffLine = new DiffLine();
    ln.kind = DIFF_PLAIN;
    ln.text = line;
    pushLine(ln);
  }

  const out: DiffFile[] = [];
  for (let i = 0; i < files.length; i++) {
    if (files[i].lines.length > 0) { out.push(files[i]); }
  }
  return out;
}

/** 块头拆分：`@@ -a,b +c,d @@` 与尾随的上下文说明（web `DiffLineRow` 把尾注用 muted 显示）。 */
export class HunkParts {
  /** `@@ … @@` 本体（含两个 @@）。 */
  marker: string = '';
  /** `@@` 之后的尾注（web 用 muted 显示；空则不显示）。 */
  rest: string = '';
}

export function splitHunk(text: string): HunkParts {
  const p: HunkParts = new HunkParts();
  const idx: number = text.indexOf('@@', 2);
  if (idx < 0) {
    p.marker = text;
    return p;
  }
  p.marker = text.substring(0, idx + 2);
  p.rest = text.substring(idx + 2).trim();
  return p;
}
