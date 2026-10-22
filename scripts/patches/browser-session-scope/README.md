# 浏览器 lazy 工具按会话隔离补丁

修复 `dsh-browser-cdp@1.6.0`：原版根实例推进 lazy 批次并向全局注册，A 调用 doctor 后 B 新增同批工具。补丁将 lazy 状态与注册放到调用 `exec.agent.ctx`，每个 agent 独立推进；root 只保留常驻工具，显式 always 模式仍全局开放。

## 交付物

- [source.patch](source.patch)：上游源码及挂载测试补丁，基于提交 `da9891b9c8ee64b6c4da16d3ae654d0f1166cccd`。
- [runtime.patch](runtime.patch)：只修改已发布包的 `lib/index.js`。
- [manifest.json](manifest.json)：包版本及原版/修复版入口 SHA-256。
- [应用脚本](../../diagnostics/apply-browser-scope-patch.mjs)：校验身份、原始 SHA、补丁产物 SHA 与语法；先备份、再原子替换；重复运行不改写；陌生入口拒绝覆盖。

该补丁是本地修复，未发布到 npm，也未提交到浏览器插件上游。重新安装原版包会覆盖本地修改。

## 应用与生效

前提：Node.js >=22、Git可执行程序在PATH中。在本仓库根执行，参数为浏览器插件包目录：

```sh
node scripts/diagnostics/apply-browser-scope-patch.mjs <浏览器插件包目录>
```

脚本只改安装入口，不改 profile 配置、不重启宿主、不发送测试对话。输出的 `runtimeReloaded: false` 表示磁盘替换完成，但脚本没有让当前进程重载。宿主模块缓存不会因页面刷新而清除；需要由宿主插件管理完成代码热重载，或在下一次正常启动时加载。磁盘 SHA 匹配不能作为当前进程已生效的证据。

2026-10-22 已备份并应用到本机安装包。用户提示使用 localhost 后，经当前已登录界面的宿主插件管理关闭再开启主插件，两次均返回 `application: applied`，最终查询 `enabled: true, fiberPhase: active`。宿主没有重启；插件管理暂时切换了该条目的启用配置，最终恢复启用。重载返回另两项警告：pwsh-sandbox 的 shell 服务重复注册、turn-notify 读取 undefined.get；本次未修改这两个插件。生产中没有发送测试对话或浏览器工具调用；行为回归使用下述隔离宿主证据。

## 实际测试

测试宿主 `0.2.1-rc.2`，完整插件 `1.6.0`；新临时 home/profile、随机宿主端口、每轮独立 echo-upstream。实际经过 session/prompt、原插件 execute、持久化结果及上游 wire tools；LLM 回复由 echo 模拟，不消耗真实配额。

原版加隔离断言确实失败：A doctor 后 B 的 tools 改变。修复后有门/无门均通过：

| 操作 | A 浏览器工具数 | B 浏览器工具数 | 新会话 C |
|---|---:|---:|---:|
| 冷启动 | 7 | 7 | — |
| A doctor | 24 | 7 | — |
| A 第二次调用 | 28 | 7 | — |
| A 第三次调用 | 29 | 7 | 7 |
| B 首次自己调用 | 29 | 24 | 7 |

B/C 冷态的整个 tools 数组与基线相等；B 活动后 A 的整个数组不变。第二批逐名核对 js/page_info/read_element/screenshot，第三批仅 wait。源码分级与挂载测试 41/41，类型检查通过；覆盖 agent 退场、插件卸载、always/lazy 切换、无 agent 调用及不同注册对象的 defer 状态隔离。

设置环境变量 `TOOL_SYNC_HOST` 为宿主包目录，`TOOL_SYNC_BROWSER` 为已修复包目录；根开发环境须可解析 Playwright，仅使用 HTTP 请求上下文，不启动浏览器：

```sh
node scripts/diagnostics/tool-sync-live.mjs --assert-isolated
node scripts/diagnostics/tool-sync-live.mjs --assert-isolated --without-gate
```

最终完整构建测试证据：[有门](<C:/Users/yuanhao/AppData/Local/Temp/dsh-tool-sync-live-frsWAt/evidence.json>)、[无门](<C:/Users/yuanhao/AppData/Local/Temp/dsh-tool-sync-live-zm7Pr0/evidence.json>)；应用器实际产物另经[完整宿主验证](<C:/Users/yuanhao/AppData/Local/Temp/dsh-tool-sync-live-lBuUo6/evidence.json>)。临时目录可能被系统清理，可按上述命令重跑。

工具隔离测试未覆盖真实浏览器页面操作或原生 DeepSeek 服务端激活；只确认已定位的 browser lazy 跨会话注册路径已在修复构建中消失。GUI 检查限于下面的页面加载、控制台与插件管理状态。

## 安装后完整验证

2026-10-22 再次使用当前安装包运行，不依赖前一轮结果：

| 验证 | 命令或方式 | 本轮结果 |
|---|---|---|
| 浏览器插件全量套件 | 源码目录 `npm test` | 58 个文件通过，5 个文件跳过；871 项通过、12 项跳过、0 失败 |
| 宿主和客户端类型 | 源码目录 `npm run typecheck` | 两个 tsconfig 均通过 |
| 工具门全量套件 | 工具门目录 `node --test "test/*.test.mjs"` | 77 项通过，0 跳过、0 失败 |
| 当前安装包，有门 | `tool-sync-live.mjs --assert-isolated` | 完整请求数组隔离断言通过 |
| 当前安装包，无门 | 同上加 `--without-gate` | 完整请求数组隔离断言通过 |
| 安装与测试身份 | 安装入口、源码构建、两个隔离副本分别计算 SHA-256 | 全部匹配清单 patchedSha256：`ec6715c9e6ce205bb5c8c2d0d72705b39820d03461cf9d7e954013da4d50f47d` |
| 当前 GUI | localhost 页面刷新后只读查询插件管理 | browser 和 tool-gate 均 enabled/active，无 Failed to load plugins 页面 |
| 残余资源 | 两套实验各检查两次 PID 和端口 | 进程退出、端口释放；隔离宿主日志无 warn/error 匹配 |

12 项跳过是上游测试的显式环境开关：登录导入 5 项、远端 CDP 4 项、Lightpanda 1 项、本地 CLI 1 项、渲染探针 1 项。本轮未开启这些外部环境测试，也未操作真实登录数据；不能把跳过记为通过。全量测试打印的 family-host 警告来自断言中的容器接管/撤回场景；npm 另提示现有 pnpm 专属配置键不被 npm 识别，未导致测试或类型检查失败。

本轮完整宿主证据：[有门](<C:/Users/yuanhao/AppData/Local/Temp/dsh-tool-sync-live-aYQYhe/evidence.json>)、[无门](<C:/Users/yuanhao/AppData/Local/Temp/dsh-tool-sync-live-hbcoGw/evidence.json>)。两套均 `ok: true, cleanupOk: true`；A 为 24/28/29，B/C 保持 7，B 自己首次调用才为 24。

当前宿主另外两行 `pwsh-sandbox`、`turn-notify` 仍为 failed，与此前重载警告一致；本轮只读确认，没有改这两行。刷新后控制台捕获到 browser family container 接管 warning，没有捕获 error。本轮结论是该跨会话注册修复通过上述回归，不能据此宣称整个宿主所有插件正常。本轮未改生产配置、未重启宿主、未向生产发送测试对话。
