# 插件 UI 统一设计规范

所有带 client 半区的包共用一份视觉决策。目标:用户在宿主界面里打开任意插件,看到的色彩、圆角、间距、字号、控件形态属于同一套设计语言;插件之间不出现第二种蓝、第二种红、第二种圆角体系。

本文件与 [plugin-client-conventions.md](plugin-client-conventions.md) 并列:那份管控件的结构契约(switch 结构、data-plugin 注入),本份管视觉决策(颜色值、尺寸标尺、状态语义)。两份同时生效。

## 色彩:唯一来源是宿主语义别名

插件禁止在样式中书写裸 hex / rgb 色值表达界面语义色。所有语义色经包局部 token 二次封装,局部 token 的值一律引用宿主 `--dsw-alias-*` 并携带 fallback:

```css
/* 合法:包前缀局部 token,引用宿主别名,fallback 必填 */
--xx-accent: var(--dsw-alias-brand-primary, #1677ff);
--xx-danger: var(--dsw-alias-state-error-primary, #d54941);

/* 禁止:裸 hex 直接用于界面元素 */
color: #1677ff;

/* 禁止:映射表槽位绕过局部 token 直接写在规则里 */
color: var(--dsw-alias-brand-primary);
```

非槽位的一次性交互态(焦点 `state-focus-primary`、hover `interactive-bg-hover`、toast、字体、阴影)允许在规则中直接引用别名,不强制逐个建 token。

语义色与宿主别名的唯一映射(局部 token 后缀即此表槽位名):

| 语义槽位 | 宿主别名 | fallback | 用途 |
|---------|---------|----------|------|
| `<pfx>-accent` | `--dsw-alias-brand-primary` | `#1677ff` | 主操作、选中态、链接、焦点强调 |
| `<pfx>-accent-deep` | `--dsw-alias-button-primary-hover` | 嵌套 `var(--dsw-alias-brand-primary, #1677ff)`(完整写法 `var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #1677ff))`) | 主按钮 hover / accent 加深 |
| `<pfx>-accent-wash` | color-mix 派生:`brand-primary` 12% 掺透明 | — | accent 的浅底(选中行、信息条背景) |
| `<pfx>-ok` | `--dsw-alias-state-success-primary` | `#1a9e55` | 成功、健康、启用 |
| `<pfx>-warn` | `--dsw-alias-state-warn-primary` | `#d97706` | 警告、降级、接近阈值 |
| `<pfx>-danger` | `--dsw-alias-state-error-primary` | `#d54941` | 错误、危险操作、删除 |
| `<pfx>-danger-wash` | color-mix 派生:`state-error-primary` 10% 掺透明 | — | 危险文本按钮 / 列表行 hover 浅底(实底危险按钮 hover 见组件节) |

wash 类浅底禁止固定浅色值(暗色主题下刺眼且暴露),统一按 `color-mix(in srgb, var(--dsw-alias-<别名>, <fallback>) <10-14>%, transparent)` 从语义色派生(仓库 usage-dash 既有写法)。

禁止各包自造第四种状态色。信息类提示需要区分于品牌蓝时用 `<pfx>-warn`,不加 info 槽位。

中性色(背景 / 文本 / 边框)同样只经局部 token 引用宿主别名,fallback 与宿主亮色主题一致:

| 语义槽位 | 宿主别名 | fallback |
|---------|---------|----------|
| `<pfx>-bg` | `--dsw-alias-bg-layer-1` | `#ffffff` |
| `<pfx>-bg-sub` | `--dsw-alias-bg-layer-2` | `#f7f8fa` |
| `<pfx>-bg-muted` | `--dsw-alias-bg-module-platform` | `#f2f3f5` |
| `<pfx>-border` | `--dsw-alias-border-l2` | `#e5e6eb` |
| `<pfx>-border-strong` | `--dsw-alias-border-l3` | `#dfe1e5` |
| `<pfx>-text` | `--dsw-alias-label-primary` | `#1f2329` |
| `<pfx>-text-sub` | `--dsw-alias-label-secondary` | `#646a73` |
| `<pfx>-text-dim` | `--dsw-alias-label-tertiary` | `#8f959e` |

图表、趋势线等数据可视化允许在语义槽位之外使用区分用色,但必须集中定义为包局部 token(如 `<pfx>-chart-1`),禁止规则内裸 hex;优先复用语义色,确需新增时饱和度(HSL S)不低于 70%,保证亮暗主题下可辨。

数据与代码用等宽字体,统一 `font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, monospace)`(变量与 fallback 均取宿主原样);界面文本一律 `inherit`,禁止插件自设无衬线字体族。

## 包局部 token 契约

- 命名:`<包前缀>-<语义槽位>`,前缀取包名缩写且在 packages/ 全清单内唯一(与样式类名前缀同一规则,见 plugin-client-conventions.md)
- 定义位置:包样式根作用域一次性声明(宿主容器节点或包根类),映射表槽位色在组件规则中只消费 `var(<pfx>-<槽位>)`;非槽位交互态按色彩节豁免直接引用,图表区分色消费 `<pfx>-chart-*`
- fallback 必填:映射表槽位的 fallback 取对应表列(wash 槽位按派生式写,无字面 fallback);允许在 fallback 位嵌套别名(先例见 accent-deep 列),链条必须终结于字面色,禁止 `var(var(...))` 双重包裹
- 禁止镜像宿主值:局部 token 不允许定义与别名无关的新颜色体系,只做"槽位 → 别名"封装

既有包(cron-board 的 `--cb-*`、tunnel 的 `--tu-*` 等)已符合本契约形态;未接入的包在新改样式时按本表槽位收敛,不强制一次性回改存量,但同一次改动触及的规则必须同步收敛——禁止同一个文件里新旧两套蓝。

## 尺寸标尺

间距以 4px 为基准刻度,允许 2/4/8/12/16/20/24;紧凑控件内部允许 6/10(存量主流值)。禁止 5/7/9 等奇数刻度新增。

字号标尺(存量分布收敛):正文 12px(默认)、辅助 11px、强调正文 13px、小标题 14px、区块标题 16px、页面主标题 20px。行高:12px 正文用 1.5,标题用 1.3。9/10px 字号禁止新增(可读性下限)。

圆角标尺:

| token | 值 | 用途 |
|-------|-----|------|
| `<pfx>-radius-sm` | 6px | 输入框、小按钮、徽标 |
| `<pfx>-radius-md` | 8px | 卡片、面板、下拉 |
| `<pfx>-radius-lg` | 12px | 弹窗、大容器 |
| 圆形 | 999px / 50% | pill、开关、头像 |

阴影不自定义:优先继承宿主;有先例的挂 `var(--dsw-shadow-lv3, 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014)`(common-tools 同款,弹层用);无宿主变量可挂时,弹层统一 `0 12px 40px rgb(31 35 41 / 18%)`,卡片默认无阴影、用边框分层。禁止每个卡片挂一层软阴影。

## 组件视觉形态

控件结构契约(开关、pill、图标、样式注入)以 plugin-client-conventions.md 为准,本节只定视觉参数:

- **开关**:track 胶囊 34×19px、thumb 圆点 13px(参考 `.tn-switch` 存量值,防仿制漂移),选中底色 `<pfx>-accent`,禁用态 `<pfx>-bg-muted` 底 + `<pfx>-text-dim` 字,过渡 0.15s ease
- **按钮**:主按钮实底 `<pfx>-accent` 白字、hover `<pfx>-accent-deep`;次按钮透明底 + `<pfx>-border` 边框 + text 色,hover `var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))`;危险按钮实底 `<pfx>-danger`,hover 用 `color-mix(in srgb, <pfx>-danger 85%, black)` 加深(wash 类浅底只作页面底色,不作实底按钮 hover)。圆角 radius-sm,高度 28px 量级,内边距水平 12px
- **输入框**:白底(`<pfx>-bg`)+ border 边框,radius-sm,聚焦描边 `var(--dsw-alias-state-focus-primary, #4c8dff)`(仓库既有 fallback 统一为此值),禁止自造聚焦色
- **卡片 / 面板**:`<pfx>-bg` 底 + border 边框 + radius-md,无阴影;嵌套分层用 bg-sub,不再加边框
- **徽标 / 状态点**:状态语义只允许 ok / warn / danger 三色,文字用对应语义色、底色统一 `color-mix(in srgb, var(<pfx>-<状态>) 10%, transparent)`(rgba 无法包裹 CSS 变量,禁止),禁止独立配色
- **表格 / 列表行**:行高 32px 量级,hover `var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))`,选中行用 accent-wash 底 + accent 文字或左侧 accent 竖线(二选一,包内一致)
- **空态**:一行说明 + 一个主操作按钮,说明用 `<pfx>-text-sub`,不插图不造插画
- **错误与 toast**:错误文案 text 色不飘红,红只给图标 / 边框 / 操作按钮;toast 底色 `var(--dsw-alias-toast-bg, #43454a)`,文案 `var(--dsw-alias-toast-label, #fff)`(仓库既有 fallback)
- **禁用**:统一 opacity 0.5 + cursor not-allowed,不换色相

## 主题适配与验证

fallback 是亮色值,宿主切暗色主题时别名变量随之变化,插件不需要也不允许另写 `@media (prefers-color-scheme)` 覆盖。验证方式:用 dev-browser 有头浏览器打开插件页面,宿主亮 / 暗两套主题各过一遍,检查点:文本对比度、边框可见性、accent-wash 与 danger-wash 在暗色下不刺眼。存量硬编码色未收敛的规则在暗色下暴露的对比度问题,单独按本规范收敛该规则后修复,不属新增 UI 验收范围。

## 新增 UI 验收清单

改 / 加插件 UI 时逐条自查:

- 规则内无裸语义色 hex;映射表槽位的语义色全部经 `<pfx>-*` token,非槽位交互态按色彩节豁免直接引用别名
- 无新增奇数间距、9/10px 字号、自造圆角值
- 状态色只用 ok / warn / danger,无第四种语义色
- 开关 / pill 结构符合 plugin-client-conventions.md,类名带包前缀
- 亮暗主题各验证一遍,无对比度失效
- 同类元素(按钮、行、徽标)在包内形态一致,与宿主设置页同类控件放在一起不违和
