# dsh-tool-gate

全局层工具白名单延迟加载。白名单内工具全量注入模型上下文;白名单外统一打
`deferLoading` 标,交给宿主 deferred tool loading 原生链路(API `defer_loading`,
服务端按需搜索激活),解决插件注入大量工具污染上下文的问题。

## 机制

- **声明式收敛**:白名单是全系统工具 defer 态的唯一事实源——白名单内清标
  (覆盖插件作者自带声明),白名单外打标;每次收敛只动与目标态有差异的名。
- **零自实现**:不注册工具、不提供搜索、不拦截执行、不改层成员资格。搜索、
  激活、会话投影(tool-addition/tool-removal)全部由宿主承担;不支持
  `defer_loading` 的上游由宿主投影层剥字段退化为全量注入,与未装本包一致。
- **原状还原**:收敛改动以 undo journal 记录,行禁用/卸载按 journal 还原,
  系统回到「没装本包」的世界;重注册顶替的 definition 跳过还原。
- **干净禁用**:宿主 tools 全局层内部结构不符已知形态时打日志零动作,不崩。

## 配置(设置 → tool-gate 节)

| 字段 | 默认 | 说明 |
|------|------|------|
| `allowlist` | `read/edit/write/shell/glob/grep/todo_write/ask_user_question` | 全量注入白名单,精确工具名 |
| `enabled` | `true` | `false` = 还原全部原状并停止打标(临时停用,不动行) |

白名单含未注册名不阻断,日志 warn 提醒拼错。volatile 字段热改即时收敛
(`loader/volatile-update`),不重启;新工具注册/重注册由 `tools/change`
驱动重收敛。

## 局限

- defer 收益依赖上游 API 支持 `defer_loading`(DeepSeek Messages 端已原生
  映射);不支持的投影层退化为全量注入。
- 彻底屏蔽某工具(不可搜索不可调用)走宿主 market 禁插件行,不在本包范围。

设计全文见 [白名单延迟加载-BDD.md](白名单延迟加载-BDD.md),兼容性见
[兼容性测试.md](兼容性测试.md)。
