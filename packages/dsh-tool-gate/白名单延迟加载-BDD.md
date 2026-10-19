# tool-gate 白名单延迟加载 BDD(白名单是全系统工具 defer 态的唯一事实源)

背景:插件向全局层注入大量工具,全量进模型上下文,污染注意力与 token 预算。
宿主 0.2 起原生支持 deferred tool loading 全链路:工具 definition 带
`deferLoading: true` → `wireSchemas`/system-prompt 投影透传 → deepseek 适配器
映射 API `defer_loading: true` → 服务端按需搜索激活(agent-loop 以 developer
message 记录 tool-addition/tool-removal,dsh-llm 投影层处理会话一致性);不支持
的上游由投影层剥字段退化为全量注入,无害。官方 `tools.restrict()` 只开 agent
级,全局可见性门是官方留白,本包补位。

本包不做工具摘除、不做行禁用、不做自实现搜索工具——只把白名单映射到
`deferLoading` 字段,机制全部站在宿主原生链路上。

## 核心不变式

- **INV-1 声明式收敛**:任意时刻,全局层每个工具的 defer 态 = f(白名单)。
  白名单内 ⇒ `deferLoading` 不存在;白名单外 ⇒ `deferLoading === true`。
  不区分标是谁打的:白名单命中即清(覆盖插件作者声明,用户意图优先),
  白名单外即打(含插件自带 defer 声明的工具——白名单外本就应延迟)。
- **INV-2 原状可还原**:收敛只改 `deferLoading` 字段且每次改变前记录原状
  (undo journal);行禁用/卸载时按 journal 还原全部原状,系统回到
  「没装本包」的世界。还原前校验层内同名工具仍是同一 definition 引用,
  防止误改重注册后的新对象。
- **INV-3 打标即生效**:schema 投影(`wireSchemas`/`view`)每请求实时读
  definition,打标/清标不改层成员资格,无需 emit `tools/change`,下一次
  assemble 自然生效。
- **INV-4 干净禁用**:宿主 `ctx.tools` 缺失或全局层内部结构
  (`layers.global.tools`,NamedEntries Map)与已知形态不符时,apply 打日志
  即返回,零动作不崩;宿主升级重构内部面后自愈路径 = 形态再探测。
- **INV-5 零会话干预**:deferred 工具的搜索、激活、会话投影、prompt 顺序
  校验全部由宿主原生链路承担,本包不注册任何工具、不 provide 任何服务、
  不拦截任何执行。
- **INV-6 非 deferLoading 能力宿主不受影响**:工具执行、权限、guard、
  presentCall/presentResult 均不读 `deferLoading`,本包不触碰 definition
  其余字段。

## 配置语义

- `allowlist`(volatile 数组):全量注入白名单,精确工具名匹配。
- `enabled`(volatile 布尔,默认 true):false = 收敛为「全部还原原状并
  停止打标」,等效临时停用而不动行。
- 出厂白名单 = 会话核心工具集(read/edit/write/shell/glob/grep/
  todo_write/ask_user_question),用户按需增删。
- 白名单含未注册名:收敛照常,日志 warn 未知名清单(不报错不阻断)。

## 场景

- **SC-1 白名单内外分野**:注册 read/shell/web_search,白名单 = [read,
  shell] ⇒ read/shell 无 `deferLoading`,web_search `deferLoading === true`。
- **SC-2 覆盖作者声明**:web_search 注册时自带 `deferLoading: true`,移入
  白名单收敛 ⇒ 该字段被清除(用户意图优先,INV-1)。
- **SC-3 白名单热改收敛**:收敛态白名单 = [read],settings 写白名单 =
  [read, shell] → `loader/volatile-update` ⇒ shell 解除 defer;原白名单外
  其余工具维持 defer。
- **SC-4 新工具收敛**(`tools/change`):收敛态下新插件注册 web_fetch ⇒
  下一轮收敛 web_fetch 打标(白名单外)。
- **SC-5 重注册收敛**:已打标工具被插件卸载重注册(新 definition 对象,
  defer 态回原状)⇒ 下一轮收敛重新打标。
- **SC-6 行退场还原**:收敛态若干工具被本包改动 ⇒ 行禁用 ⇒ journal 逐项
  还原:本包打过标的字段消失,被本包清掉的自带 defer 声明恢复;层内已被
  重注册顶替的名字跳过还原。
- **SC-7 enabled=false**:`enabled` 写 false ⇒ 全部按 journal 还原并停止
  打标;写回 true ⇒ 重新收敛。
- **SC-8 未知名白名单**:白名单 = [read, no_such_tool] ⇒ 收敛正常,
  warn 含 no_such_tool。
- **SC-9 内部面缺失**:ctx.tools 无 layers.global.tools Map 结构 ⇒ 日志
  说明即返回,不崩,零动作。
- **SC-10 官方投影锁定**(集成):真 cordis + dsh-tools 下,deferred 工具的
  `schemaOf` 产物带 `deferLoading: true`,白名单内工具不带;`view().visible`
  两者均在(defer 不改可见性,只改声明形态)。

## 已知边界

- defer 收益依赖上游 API 支持 `defer_loading`(DeepSeek Messages 端已实测
  映射);不支持的投影层剥字段全量注入,行为与未装本包一致。
- 工具 deferral 不改变其执行权限与调用许可;屏蔽级需求(彻底不可用)走
  宿主 market 禁行,不在本包范围。
