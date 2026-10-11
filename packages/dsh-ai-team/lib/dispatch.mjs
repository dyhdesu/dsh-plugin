// 派发校验与意图构造:调用宿主前的最后闸门(架构设计"派发协议"第 2 步)。
import { actionKeyOf } from './domain.mjs'
import { WORKER_PRESET_ID } from './presets.mjs'

// 未核清状态集合:这些状态的 Run 视为在途,禁止向同一 workItem 重叠派发
const IN_FLIGHT_RUN_STATES = new Set(['prepared', 'submitted', 'running'])
// 可派发业务状态白名单:终态(cancelled/completed)与未知状态一律拒绝
const DISPATCHABLE_STATES = new Set(['ready', 'implementing', 'awaiting_acceptance'])

let requestSeq = 0

// 生成稳定 requestId:时间序 + 序号,进程内唯一即可(跨进程幂等由 actionKey 承担)
function newRequestId(now) {
  requestSeq += 1
  return `req-${now.toString(36)}-${requestSeq.toString(36)}`
}

export function validateDispatch(ctx, task, control, command, options = {}) {
  if (task.businessState === 'draft') return { ok: false, reason: '任务尚无授权记录,不可派发' }
  if (task.businessState === 'blocked') return { ok: false, reason: '任务处于 blocked,不可派发' }
  if (!DISPATCHABLE_STATES.has(task.businessState)) return { ok: false, reason: `任务状态 ${task.businessState} 不可派发` }

  const dependsOn = command.dependsOn ?? []
  // 未接入真实依赖查询前 fail-closed:声明了依赖且无显式满足清单即拒绝
  const satisfied = options.satisfiedDependencies ?? []
  const unmet = dependsOn.filter((id) => !satisfied.includes(id))
  if (unmet.length > 0) return { ok: false, reason: `依赖未满足: ${unmet.join(', ')}` }

  const globallyStopped = Boolean(control.globalStopped)
  const hasRelease = !globallyStopped || control.taskAllows?.[task.taskId] === control.globalStopGeneration
  if (globallyStopped && !hasRelease) return { ok: false, reason: '执行被暂停(全局停止且无单任务放行)' }

  if (control.taskControl?.[task.taskId]?.controlState === 'stopping') {
    return { ok: false, reason: '任务处于中断中(stopping),不可派发' }
  }

  if (!command.workItemId) return { ok: false, reason: '缺少 workItemId,不可派发' }
  const inFlight = (ctx.aggregate.runs ?? []).some(
    (run) => run.workItemId === command.workItemId && IN_FLIGHT_RUN_STATES.has(run.state),
  )
  if (inFlight) return { ok: false, reason: '该工作项存在未核清的在途 Run,不可重叠派发' }

  return {
    ok: true,
    intent: {
      taskId: task.taskId,
      workItemId: command.workItemId,
      phase: command.phase,
      idempotencyKey: actionKeyOf(command.causeId, command.actionKey),
      dispatchGeneration: control.globalStopGeneration ?? 0,
      agentPreset: WORKER_PRESET_ID,
      requestId: newRequestId(ctx.now),
    },
  }
}
