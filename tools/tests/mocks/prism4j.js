/**
 * `@hxa-atpc/noties_prism4j` 的 Node 实现（仅测试用）。
 *
 * ⚠️ 这是**字节码 HAR**，真机才跑得起来；脱机环境里我们**故意**让 `grammar()`
 *    返回 `null`，以此稳定地覆盖 `core/highlight.ets` 的**退化路径**：
 *      · 未知 / 无语言 ⇒ 返回整段纯文本（零丢失）；
 *      · `supportsLang()` 在库不可用时安全回落 false（不抛异常）。
 *    真正的着色效果由真机验收（见 docs/TOOLPOPOVER-SPEC.md），此处不伪造分词结果。
 */
class Prism4j {
  constructor(grammarLocator) {
    this.grammarLocator = grammarLocator;
  }
  grammar(_name) {
    return null;
  }
  tokenize(_text, _grammar) {
    return [];
  }
}

function createAllLanguagesGrammarLocator() {
  return { grammar: () => null, languages: () => [] };
}

module.exports = { Prism4j, createAllLanguagesGrammarLocator };
