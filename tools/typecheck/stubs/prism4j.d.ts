/**
 * `@hxa-atpc/noties_prism4j` 的**最小声明** —— 只服务 `tools/tests/run.sh`
 * （它把 `core/*.ets` 当纯 TS 编译，解析不到 oh_modules 里的 bytecode HAR）。
 *
 * ⚠️ 本文件**不参与 App 构建**（App 里走真实 HAR 的 `Index.d.ets`）；
 *    这里只按 `core/highlight.ets` 实际用到的 API 面声明，防止脱机编译报 TS2307。
 */
declare module '@hxa-atpc/noties_prism4j' {
  export interface Node {
    textLength(): number;
    isSyntax(): boolean;
  }
  export interface Text extends Node {
    literal(): string;
  }
  export interface Syntax extends Node {
    type(): string;
    children(): ReadonlyArray<Node>;
    alias(): string | null;
  }
  export interface Grammar {
  }
  export interface GrammarLocator {
    grammar(prism4j: Prism4j, name: string): Grammar | null;
    languages?(): ReadonlyArray<string>;
  }
  export class Prism4j {
    constructor(grammarLocator: GrammarLocator);
    grammar(name: string): Grammar | null;
    tokenize(text: string, grammar: Grammar): Node[];
  }
  export function createAllLanguagesGrammarLocator(): GrammarLocator;
}
