/** `@kit.ArkTS` 的 Node 实现（仅测试用）：TextEncoder/TextDecoder。 */
class TextEncoder {
  constructor(encoding) {
    this.encoding = encoding || 'utf-8';
  }
  encode(input) {
    return new Uint8Array(Buffer.from(input === undefined ? '' : input, 'utf8'));
  }
  encodeInto(input) {
    return new Uint8Array(Buffer.from(input === undefined ? '' : input, 'utf8'));
  }
}

class TextDecoder {
  constructor(encoding) {
    this.encoding = encoding || 'utf-8';
  }
  static create(encoding) {
    return new TextDecoder(encoding);
  }
  decodeToString(input) {
    return Buffer.from(input).toString('utf8');
  }
  decodeWithStream(input) {
    return Buffer.from(input).toString('utf8');
  }
}

module.exports = { util: { TextEncoder, TextDecoder } };
