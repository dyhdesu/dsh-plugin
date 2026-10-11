// 任务域纯逻辑:状态机流转、执行控制代次、幂等命令。
// 不依赖宿主服务;持久化由 store 层适配(架构设计"数据与一致性")。

export const BUSINESS_STATES = new Set(['draft', 'ready', 'implementing', 'awaiting_acceptance', 'completed', 'blocked', 'cancelled'])
export const CONTROL_STATES = new Set(['active', 'stopping', 'paused', 'reconciling'])
export const RUN_STATES = new Set(['prepared', 'submitted', 'running', 'settled', 'interrupted', 'rejected', 'unknown'])
export const PHASES = new Set(['implement', 'fix', 'accept', 'integrate'])

// 迁移表:事件 -> { from: 授权状态集合, to }。blocked 的离开由 authorize/scope 语义承载。
const TRANSITIONS = {
  authorize: { from: ['draft', 'blocked'], to: 'ready' },
  scopeChanged: { from: ['draft', 'ready', 'blocked'], to: 'blocked' },
  dispatch: { from: ['ready', 'implementing', 'awaiting_acceptance'], to: 'implementing' },
  resultSubmitted: { from: ['implementing'], to: 'awaiting_acceptance' },
  acceptanceRejected: { from: ['awaiting_acceptance'], to: 'implementing' },
  acceptancePassed: { from: ['awaiting_acceptance'], to: 'completed' },
  executionStopped: { from: ['ready', 'implementing', 'awaiting_acceptance'], to: null },
  cancel: { from: [...BUSINESS_STATES], to: 'cancelled' },
}

export function newTask(def) {
  return {
    taskId: def.taskId,
    goal: def.goal,
    acceptance: def.acceptance ?? '',
    workspaceId: def.workspaceId,
    businessState: 'draft',
    blockedFrom: null,
    hasInFlightExecution: false,
    revision: 0,
  }
}

export function transitionTask(task, event, payload = {}) {
  const rule = TRANSITIONS[event]
  if (!rule) throw new Error(`未知任务事件: ${event}`)
  if (!rule.from.includes(task.businessState)) {
    throw new Error(`事件 ${event} 不适用于状态 ${task.businessState}`)
  }
  if (event === 'cancel' && task.hasInFlightExecution) {
    throw new Error('存在在途执行,取消前须确认执行停止')
  }
  let next = { ...task, revision: task.revision + 1 }
  if (event === 'authorize') {
    next.blockedFrom = null
  }
  if (event === 'scopeChanged') {
    next.blockedFrom = task.businessState
  }
  if (event === 'dispatch') {
    if (!PHASES.has(payload.phase)) throw new Error(`非法 phase: ${payload.phase}`)
    next.hasInFlightExecution = true
  }
  if (event === 'executionStopped') {
    next.hasInFlightExecution = false
  }
  if (rule.to) next.businessState = rule.to
  return next
}

// 全局停止:代次先递增再置位,旧放行按代次自然失效
export function globalStop(control) {
  return {
    ...control,
    globalStopGeneration: (control.globalStopGeneration ?? 0) + 1,
    globalStopped: true,
  }
}

export function allowTask(control, taskId) {
  return {
    ...control,
    taskAllows: { ...control.taskAllows, [taskId]: control.globalStopGeneration },
  }
}

// 有效暂停 = 全局停止代次 + 任务放行代次 + 局部控制状态共同计算;
// runtime 为停止链路观测(请求在途/不可观测后代),决定 stopping 的展示形态。
export function computePause(control, task, runtime = {}) {
  const controlState = runtime.controlState ?? 'active'
  if (!CONTROL_STATES.has(controlState)) throw new Error(`非法控制状态: ${controlState}`)
  if (controlState === 'paused' || controlState === 'reconciling') {
    return { paused: controlState !== 'reconciling', controlState, form: controlState === 'paused' ? 'paused' : 'reconciling' }
  }
  if (controlState === 'stopping') {
    const form = runtime.stopRequestsInFlight ? 'interrupting'
      : runtime.unobservableDescendants ? 'stopPendingConfirm'
        : 'paused'
    return { paused: true, controlState, form }
  }
  const globallyStopped = Boolean(control.globalStopped)
  const hasRelease = !globallyStopped || control.taskAllows?.[task.taskId] === control.globalStopGeneration
  return { paused: globallyStopped && !hasRelease, controlState, form: hasRelease ? 'active' : 'pausedGlobalStop' }
}

// 幂等命令:causeId+actionKey 单一复合键;重复提交返回原结果。
export function actionKeyOf(causeId, actionKey) {
  return `${causeId}\u0000${actionKey}`
}

export function applyCommand(aggregate, command, effect) {
  const key = actionKeyOf(command.causeId, command.actionKey)
  const applied = aggregate.appliedActions ?? {}
  if (key in applied) {
    return { aggregate, result: applied[key], replayed: true }
  }
  const { aggregate: nextAggregate, result } = effect(aggregate)
  return {
    aggregate: {
      ...nextAggregate,
      appliedActions: { ...applied, [key]: result },
    },
    result,
    replayed: false,
  }
}
