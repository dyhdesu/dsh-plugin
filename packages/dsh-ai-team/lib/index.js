// dsh-ai-team — AI 团队任务控制室。行角色分发,业务在 lib/ 各模块。
// 依赖缺失时干净禁用:不注册任何服务/UI,打日志说明原因即返回(DEVELOPMENT/dsh-api-alignment)。
import z from '@deepseek-ai/schemastery'
import { registerControl } from './control.mjs'

export const name = 'ai-team'

export const Config = z.object({
  role: z.union(['control']).required(),
})

export function apply(ctx, config) {
  const cfg = Config(config || {})
  if (cfg.role !== 'control') return
  registerControl(ctx)
}
