/**
 * ArkUI 装饰器的**最小声明** —— 只服务 `tools/tests/run.sh`：它把 `core/*.ets`
 * 当**纯 TS** 编译（没有 ArkUI 编译器内建），所以 `@Observed` 这类装饰器需要在这里声明，
 * 否则出现 `Cannot find name 'Observed'`。
 *
 * ⚠️ 本文件**不参与 App 构建**（App 里这些是编译器内建）；这里写宽松类型即可。
 */
declare const Observed: any;
declare const ObservedV2: any;
declare const Trace: any;
declare const Track: any;
declare const Reusable: any;
declare const ComponentV2: any;
declare const Local: any;
declare const Param: any;
