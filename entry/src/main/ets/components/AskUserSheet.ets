/**
 * AskUserSheet —— 「xbot 需要你确认」问答弹层（原 `pages/Index.ets` 的 `@Builder AskUserSheet()`，P2-3 抽出）。
 *
 * ── 分层铁律（同 StatusSheet / QueueSheet / PluginsSheet / MenuSheets）───────────
 *   · **判据不入组件**：本组件只吃**问题数组**（页面合成 `this.askUser.questions`）+ 回调；
 *     选中判定 / 选择切换 / 提交**全在页面**（那里才持有 `askSelections` 与 store）。
 *     `isSelected` / `onToggleOption` / `setOther` / `onSubmit` 四个回调 ⇄ 页面
 *     `isAskSelected` / `toggleAskOption` / `setAskOther` / `submitAsk`。
 *   · 唯一有真实状态逻辑的入参是「其他（自己填）」的文本 —— 其内联重建 `askSelections`
 *     的那段**逐字搬**到页面方法 `setAskOther(qid, v)`（搬而不改），组件只调 `setOther(qid, v)`。
 *   · **弹层开关所有权不搬**：挂载由页面 `if (this.askUser !== null)` 控制，本组件不持有 flag。
 */
import { Palette, paletteOf } from '../core/theme';
import { AskOption, AskQuestion } from '../core/types';

@Component
export struct AskUserSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** 待确认的问题（页面 `askUser.questions`，空数组 = 无问题）。 */
  @Prop questions: AskQuestion[] = [];
  /** 是否正在提交（页面 `askBusy`；决定「提交」按钮文案）。 */
  @Prop busy: boolean = false;
  /** 某个选项是否已选（页面 `isAskSelected`）。 */
  isSelected: (qid: string, label: string) => boolean = () => false;
  /** 切换某选项（页面 `toggleAskOption`；`multi` = 该题是否多选）。 */
  onToggleOption: (qid: string, label: string, multi: boolean) => void = () => {
  };
  /** 设置「其他（自己填）」的文本（页面 `setAskOther`）。 */
  setOther: (qid: string, v: string) => void = () => {
  };
  /** 提交（页面 `submitAsk`；`cancelled=true` = 用户点了「取消」）。 */
  onSubmit: (cancelled: boolean) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: 10 }) {
      Text('xbot 需要你确认').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.pal().warn).width('100%')
      List() {
        // ⚠️ 与原实现逐字一致：`q.id` 缺失时回落 `q${qi}`（qi 来自外层 ForEach 下标）。
        ForEach(this.questions, (q: AskQuestion, qi: number) => {
          ListItem() {
            Column({ space: 6 }) {
              if (q.header !== undefined && q.header.length > 0) {
                Text(q.header).fontSize(12).fontColor(this.pal().textSecondary).width('100%')
              }
              Text(q.question !== undefined ? q.question : '').fontSize(14).fontColor(this.pal().textPrimary).width('100%')

              ForEach(q.options !== undefined ? q.options : [], (opt: AskOption, oi: number) => {
                Row() {
                  Text(this.isSelected(q.id !== undefined ? q.id : `q${qi}`,
                    opt.label !== undefined ? opt.label : '') ? '已选' : '未选')
                    .fontSize(14).fontColor(this.pal().accentText)
                  Column() {
                    Text(opt.label !== undefined ? opt.label : '').fontSize(13).fontColor(this.pal().textPrimary)
                    if (opt.description !== undefined && opt.description.length > 0) {
                      Text(opt.description).fontSize(11).fontColor(this.pal().textMuted)
                    }
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 6 })
                }
                .width('100%').padding(8).backgroundColor(this.pal().surface)
                .borderRadius(6)
                .onClick(() => {
                  this.onToggleOption(q.id !== undefined ? q.id : `q${qi}`,
                    opt.label !== undefined ? opt.label : '',
                    q.multi_select === true);
                })
              }, (opt: AskOption, oi: number) => `o-${qi}-${oi}`)

              if (q.allow_other === true) {
                TextInput({ placeholder: '其他（自己填）' })
                  .onChange((v: string) => {
                    this.setOther(q.id !== undefined ? q.id : `q${qi}`, v);
                  })
                  .constraintSize({ minHeight: 38 }).backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)
              }
            }.width('100%').padding(8)
          }
        }, (q: AskQuestion, qi: number) => q.id !== undefined ? q.id : `q${qi}`)
      }
      .constraintSize({ maxHeight: 420 }).width('100%')

      Row({ space: 8 }) {
        Button('取消').layoutWeight(1).constraintSize({ minHeight: 42 }).backgroundColor(this.pal().surfaceHi).onClick(() => {
          this.onSubmit(true);
        })
        Button(this.busy ? '提交中…' : '提交').layoutWeight(1).constraintSize({ minHeight: 42 })
          .backgroundColor(this.pal().accent).fontColor(this.pal().onAccent)
          .onClick(() => {
            this.onSubmit(false);
          })
      }.width('100%')
    }
    .width('94%').padding(16).backgroundColor(this.pal().surfaceAlt)
    .borderRadius(12).border({ width: 1, color: this.pal().warn })
  }
}
