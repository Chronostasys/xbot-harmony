/**
 * SplashPreview —— **开发期开屏/加载态预览页**（用户 2026-10-16 建议：
 * 「要看 splash 样子就直接写个 test 页面渲染它，而不是靠运气截图」）。
 *
 * 进入方式（**仅调试**，生产路径不经过本页）：
 *   `hdc shell aa start -a EntryAbility -b com.chronostasys.xbot --ps dbgPage splash`
 *   （`EntryAbility.dbgPage` ⇒ `loadContent('pages/SplashPreview')`）
 *
 * 覆盖三种真实态，**确定性**（不依赖真实冷启动/切会话的时序）：
 *   ① 冷启动品牌开屏 `SplashOverlay`（T1 入场 / T2 让位淡出）——按钮手动推进相位；
 *   ② 切会话加载态 `SessionLoadingSplash`（真组件，与 `Index.ets` 同一份）；
 *   ③ 主题切换（浅/深）对照。
 */
import { Palette, paletteOf } from '../core/theme';
import { SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { colorOf, typeOf } from '../core/design';
import { SPLASH_T1, SPLASH_T2, SPLASH_T3 } from '../core/splash';
import { SplashOverlay } from '../components/SplashOverlay';
import { SessionLoadingSplash } from '../components/SessionLoadingSplash';
import { t as i18nT } from '../core/i18n';

@Entry
@Component
struct SplashPreview {
  @State private phase: string = SPLASH_T1;
  @State private showCold: boolean = false;
  @State private theme: string = 'dark';
  /** 重放冷启动用：`SplashOverlay` 的 phase 是 `@Prop` ⇒ 靠"先卸载再挂载"重放。 */
  @State private coldKey: number = 0;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  @Builder
  private Label(text: string) {
    Text(text)
      .fontSize(typeOf('type.caption').size)
      .fontColor(this.pal().textMuted)
      .width('100%')
  }

  @Builder
  private Btn(text: string, onTap: () => void) {
    Text(text)
      .fontSize(typeOf('type.subhead').size)
      .fontColor(this.pal().textPrimary)
      .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
      .backgroundColor(this.pal().surfaceAlt)
      .borderRadius(10)
      .onClick(onTap)
  }

  build() {
    Stack() {
      Scroll() {
        Column({ space: SP_4 }) {
          Text(i18nT('开屏预览'))
            .fontSize(typeOf('type.title').size)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().textPrimary)

          this.Label('① 冷启动品牌开屏（SplashOverlay）——点「播放」全屏重放，点「T2」看让位淡出')
          Row({ space: SP_2 }) {
            this.Btn('播放 T1', () => {
              this.phase = SPLASH_T1;
              this.coldKey++;
              this.showCold = true;
            })
            this.Btn('推到 T2', () => {
              this.phase = SPLASH_T2;
            })
            this.Btn('结束(T3)', () => {
              this.phase = SPLASH_T3;
            })
          }

          Divider().color(colorOf(this.pal(), 'hairline'))

          this.Label('② 切会话加载态（SessionLoadingSplash，与 Index.ets 同一组件）')
          Column() {
            SessionLoadingSplash({ theme: this.theme })
          }
          .width('100%')
          .height(420)
          .backgroundColor(this.pal().appBg)
          .borderRadius(12)

          Divider().color(colorOf(this.pal(), 'hairline'))

          this.Label('③ 对比主题（浅/深）')
          Row({ space: SP_2 }) {
            this.Btn('深色', () => {
              this.theme = 'dark';
            })
            this.Btn('浅色', () => {
              this.theme = 'light';
            })
          }
        }
        .width('100%')
        .padding(SP_5)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%').height('100%')
      .backgroundColor(this.pal().appBg)

      // ── 全屏冷启动开屏（点「播放」后叠在最上；T3 自动收起）──
      if (this.showCold) {
        SplashOverlay({
          phase: this.phase,
          onDone: (): void => {
            this.showCold = false;
            this.phase = SPLASH_T1;
          },
          onSkip: (): void => {
            this.phase = SPLASH_T3;
          },
        })
          .key(`cold-${this.coldKey}`)
      }
    }
    .width('100%').height('100%')
  }
}
