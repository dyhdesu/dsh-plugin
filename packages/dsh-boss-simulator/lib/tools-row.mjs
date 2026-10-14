// 工具行:把业务工具注册进 tools 服务。角色凭证取会话预设 id(受管登记),不接受模型自填。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createAgentTools } from './agent-tools.mjs'
import { ADMIN_PRESET_ID, WORKER_PRESET_ID } from './presets.mjs'

// 预设 id 精确匹配→角色(防自建同名前缀预设越权)
const ROLE_BY_PRESET = { [ADMIN_PRESET_ID]: 'admin', 'boss-simulator-dispatcher': 'dispatcher', [WORKER_PRESET_ID]: 'worker' }
const TOOL_NAME = 'boss_simulator'
const TOOL_DESCRIPTION = '公司管理任务控制室工具(create/authorize/dispatch/report/confirm/query)'

export function registerToolRow(ctx, deps) {
  const tools = createAgentTools(deps)
  const disposer = ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      tool: { type: 'string', required: true, description: '业务工具名(boss_simulator_create_task/boss_simulator_report_result 等)' },
      args: { type: 'object', additionalProperties: true, description: '业务工具参数' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_params, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(params, execution) {
      const role = roleOf(execution)
      if (!role) throw new Error('当前会话未受管,禁止调用公司管理工具')
      return tools.handle(params.tool, params.args ?? {}, { role })
    },
  }))
  // 非受管会话对本工具 deny 兜底(deny-only guard)
  const restrict = ctx.tools.guard((execution) => {
    const name = execution?.name ?? execution?.toolName
    if (name !== TOOL_NAME) return undefined
    return roleOf(execution) ? undefined : '公司管理工具仅限受管角色预设会话'
  })
  return () => { disposer(); restrict() }
}

// 当前宿主组合才是角色凭证；创建时header和模型参数不能代表切换后的身份。
function roleOf(execution) {
  const agentCtx = execution?.agent?.ctx
  const registry = agentCtx?.get?.('agentPresets')
  const id = registry?.composedPreset?.(agentCtx)
  return ROLE_BY_PRESET[id] ?? null
}
