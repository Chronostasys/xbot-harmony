/**
 * 最小 SDK stub —— 只为「用 tsc 静态检查 core/ 里的 ArkTS（纯 TS 部分）」。
 *
 * 为什么不直接用官方 d.ts：官方 SDK 在 CI 镜像里才有（本机没有 SDK）。
 * 这里按**我们实际用到的 API 面**声明，用来抓自己代码里的类型/拼写错误
 * （SDK 行为一致性仍需 CI 真编译把关）。
 *
 * ⚠️ 本文件不参与打包，只被 tools/typecheck/check.sh 使用。
 */
declare module '@kit.NetworkKit' {
  export namespace http {
    export enum RequestMethod { GET = 'GET', POST = 'POST' }
    export enum HttpDataType { STRING = 0, OBJECT = 1, ARRAY_BUFFER = 2 }
    export interface HttpRequestOptions {
      method?: RequestMethod | string;
      header?: Record<string, string> | Object;
      extraData?: string | Object | ArrayBuffer;
      expectDataType?: HttpDataType;
      connectTimeout?: number;
      readTimeout?: number;
    }
    export interface HttpResponse {
      result: string | Object | ArrayBuffer;
      responseCode: number;
      header: Object;
    }
    export interface HttpRequest {
      request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
      // 真实 SDK 是 AsyncCallback<number>：err 为 BusinessError（有 code/message）
      requestInStream(url: string, options: HttpRequestOptions,
        callback: (err: { code: number; message: string }, data: number) => void): void;
      on(type: 'dataReceive', callback: (data: ArrayBuffer) => void): void;
      on(type: 'dataEnd', callback: () => void): void;
      on(type: 'headersReceive', callback: (header: Object) => void): void;
      off(type: 'dataReceive', callback?: (data: ArrayBuffer) => void): void;
      off(type: 'dataEnd', callback?: () => void): void;
      off(type: 'headersReceive', callback?: (header: Object) => void): void;
      destroy(): void;
    }
    export function createHttp(): HttpRequest;
  }
  export namespace webSocket {
    export interface WebSocket {
      connect(url: string, callback: (err: Object, ok: boolean) => void): void;
      send(data: string): Promise<boolean>;
      close(options?: Object): Promise<boolean>;
      on(type: string, callback: (value: Object) => void): void;
      off(type: string, callback?: (value: Object) => void): void;
    }
    export function createWebSocket(): WebSocket;
  }
}

declare module '@kit.ArkTS' {
  export namespace util {
    export interface DecodeToStringOptions { stream?: boolean }
    export class TextEncoder {
      constructor(encoding?: string);
      encode(input?: string): Uint8Array;
      encodeInto(input?: string): Uint8Array;
      readonly encoding: string;
    }

    export class TextDecoder {
      static create(encoding?: string, options?: Object): TextDecoder;
      decodeToString(input: Uint8Array, options?: DecodeToStringOptions): string;
      decodeWithStream(input: Uint8Array, options?: DecodeToStringOptions): string;
    }
  }
}

declare module '@kit.ArkData' {
  export namespace preferences {
    export interface Options { name: string }
    export type ValueType = number | string | boolean | Array<number> | Array<string> | Array<boolean>;
    export interface Preferences {
      getSync(key: string, defValue: ValueType): ValueType;
      putSync(key: string, value: ValueType): void;
      flush(): Promise<void>;
    }
    export function getPreferences(context: Object, options: Options): Promise<Preferences>;
  }
}

declare module '@kit.AbilityKit' {
  export namespace common {
    export class UIAbilityContext {
      readonly filesDir: string;
    }
  }
  export namespace AbilityConstant {
    export interface LaunchParam { launchReason?: number }
  }
  export class UIAbility {
    context: common.UIAbilityContext;
    onCreate(want: Object, launchParam: AbilityConstant.LaunchParam): void;
    onDestroy(): void;
    onWindowStageCreate(windowStage: Object): void;
    onWindowStageDestroy(): void;
    onForeground(): void;
    onBackground(): void;
  }
  export interface Want { bundleName?: string }
}

declare module '@kit.ArkUI' {
  export namespace window {
    export interface Window {
      setWindowLayoutFullScreen(isLayoutFullScreen: boolean): Promise<void>;
      setWindowSystemBarProperties(props: Object): Promise<void>;
    }
    export interface WindowStage {
      loadContent(path: string, callback: (err: Object) => void): void;
      getMainWindowSync(): Window;
    }
  }
  export namespace promptAction {
    export interface ShowToastOptions { message: string; duration?: number }
    export function showToast(options: ShowToastOptions): void;
  }
}

declare module '@kit.BasicServicesKit' {
  export interface BusinessError {
    code: number;
    message: string;
    name?: string;
  }
}

declare module '@kit.PerformanceAnalysisKit' {
  export namespace hilog {
    export function info(domain: number, tag: string, format: string, ...args: Object[]): void;
    export function warn(domain: number, tag: string, format: string, ...args: Object[]): void;
    export function error(domain: number, tag: string, format: string, ...args: Object[]): void;
  }
}

declare module '@kit.ArkWeb' {
  export namespace webview {
    export class WebviewController {
      refresh(): void;
      loadUrl(url: string): void;
    }
  }
}
