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

2026-10-22 已备份并应用到本机安装包；当前文件监听范围不包含此包，管理接口未认证，尚未取得运行中插件已重载证据。未改生产配置、未重启生产宿主。

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

测试未覆盖真实浏览器页面操作、GUI 交互或原生 DeepSeek 服务端激活；只确认已定位的 browser lazy 跨会话注册路径已在修复构建中消失。
