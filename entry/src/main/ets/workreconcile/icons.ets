/**
 * 通知品牌小图标 —— **唯一解码点**（ArkTS 侧；`core/**` 不许 import `@ohos.*`，故解码只能在这里）。
 *
 * 为什么需要：`NotificationRequest.smallIcon?: image.PixelMap`
 * （SDK `api/notification/notificationRequest.d.ts:310`，**不是 Resource** ⇒ 不能直接传 `$r(...)`）
 * 且**默认留空 ⇒ 通知显示系统默认应用图标**（同处 SDK 注释原文）。本文件把它换成**品牌资产**。
 *
 * ── 纪律（违反即回归）────────────────────────────────────────────────────────────
 * 1. **全仓唯一 `image.createImageSource(` 调用点**（判据：剥注释后计数 = 1）
 *    —— 第二条出现即"两处解码"，必然漂移。
 * 2. **解码绝不发生在 publish 路径上**：只在这里 `installNotifyIcon()` 一次，结果存 `memo`；
 *    之后每次发通知只是 `request.smallIcon = memo`（`core/notify.ets` 的装饰钩子）。
 * 3. **失败静默回落**：svg 解不出 ⇒ 退 `start_icon.png`；两者都不可用 ⇒ `memo` 保持 `null`
 *    ⇒ 装饰器什么都不做 ⇒ 通知回落**系统默认图标**。⛔ 任何情况下不得抛（发通知是主链路的旁路）。
 * 4. ⚠️ **`brand_mark_outline.svg` 能否被 `createImageSource` 吃，未经真机验证**：
 *    故写了 PNG 回退；两者都没成功时 `hilog` 会留一行证据（真机可据此判"到底解出来没有"）。
 */
import { image } from '@kit.ImageKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { common } from '@kit.AbilityKit';
import notificationManager from '@ohos.notificationManager';
import { setNotifyDecorator } from '../core/notify';

const DOMAIN: number = 0x0000;
const TAG: string = 'XBOTICON';

/** 解码后的 PixelMap（**只此一份**；`null` = 没解出来 ⇒ 不装饰）。 */
let memo: image.PixelMap | null = null;
/** 是否已经尝试过解码（避免每次启动重复尝试；重试价值极低）。 */
let tried: boolean = false;

/** 把指定媒体资源解成 PixelMap；失败返回 null（不抛）。 */
async function decodeMedia(ctx: common.Context, res: Resource): Promise<image.PixelMap | null> {
  try {
    const data: Uint8Array = await ctx.resourceManager.getMediaContent(res.id);
    const src: image.ImageSource = image.createImageSource(data.buffer as ArrayBuffer);
    const pm: image.PixelMap = await src.createPixelMap();
    return pm !== null && pm !== undefined ? pm : null;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'decode failed: %{public}s', (e as BusinessError).message);
    return null;
  }
}

/**
 * 启动时调一次（幂等）：解出品牌小图标并注册装饰器。
 * 解析顺序：`brand_mark_outline.svg`（品牌描边标记）→ `start_icon.png`（PNG 回退）→ 放弃。
 */
export async function installNotifyIcon(ctx: common.Context): Promise<void> {
  if (tried) {
    return;
  }
  tried = true;
  memo = await decodeMedia(ctx, $r('app.media.brand_mark_outline'));
  if (memo === null) {
    hilog.info(DOMAIN, TAG, 'svg 解不出 ⇒ 回退 start_icon.png');
    memo = await decodeMedia(ctx, $r('app.media.start_icon'));
  }
  if (memo === null) {
    // ⛔ 两个都不行 ⇒ **不装饰**（回落系统默认图标）。真机据此行判"到底解出来没有"。
    hilog.info(DOMAIN, TAG, '两路资产都解码失败 ⇒ 不设 smallIcon（回落系统默认图标）');
    return;
  }
  // ⛔ cast 只能在 ArkTS 侧做（`core` 无法 import `image.PixelMap`）——这正是本文件存在的理由。
  setNotifyDecorator((request: Object): void => {
    const req: notificationManager.NotificationRequest = request as notificationManager.NotificationRequest;
    if (memo !== null) {
      req.smallIcon = memo;
    }
  });
  hilog.info(DOMAIN, TAG, '品牌小图标已就绪并注册装饰器');
}
