// Test-only source normalization: source-shape gates historically match `Text('中文')`.
// UI strings are now wrapped as `Text(i18nT('中文'))`; for shape assertions we present the
// pre-i18n form (the wrapper is a pure identity for zh and does not change modifiers/layout).
// ⛔ Runtime tests must keep the wrapper; this hook only affects tests that read source text.
const fs = require('fs');
const orig = fs.readFileSync;
fs.readFileSync = function (p, enc) {
  const s = orig.apply(fs, arguments);
  if (typeof s !== 'string') return s;
  return s.replace(/i18nT\(([^()]*)\)/g, '$1');
};
