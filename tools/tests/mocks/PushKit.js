// Push Kit 运行时 mock（单测用）：默认给出一个**假 token**，并允许测试注入失败以覆盖错误文案。
// 真机行为由 SDK 决定；这里只保证"单测能跑、且不联网"。
let nextToken = 'MOCK_PUSH_TOKEN_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let failWith = null;
module.exports = {
  pushService: {
    getToken: () => {
      if (failWith) { const e = new Error(failWith.message); e.code = failWith.code; return Promise.reject(e); }
      return Promise.resolve(nextToken);
    },
    deleteToken: () => Promise.resolve(),
  },
  __setToken: (t) => { nextToken = t; },
  __failWith: (code, message) => { failWith = code ? { code, message } : null; },
};
