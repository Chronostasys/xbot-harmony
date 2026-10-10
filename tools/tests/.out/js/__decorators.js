/**
 * ArkUI 装饰器的**运行期垫片**（只服务 tools/tests/run.sh）。
 *
 * 为什么需要两步：`arkui_decorators.d.ts` 只解决**编译期**（tsc 认识 `@Observed`），
 * 而装饰器语法编译后会**调用**该标识符 ⇒ 运行期仍 `ReferenceError: Observed is not defined`。
 * 这里把它们定义成恒等函数（纯逻辑测试不关心装饰器语义）。
 * ⚠️ 不参与 App 构建 —— App 里是编译器内建。
 */
globalThis.Observed = (t) => t;
globalThis.ObservedV2 = (t) => t;
globalThis.Reusable = (t) => t;
globalThis.ComponentV2 = (t) => t;
globalThis.Trace = () => {
};
globalThis.Track = () => {
};
globalThis.Local = () => {
};
globalThis.Param = () => {
};
