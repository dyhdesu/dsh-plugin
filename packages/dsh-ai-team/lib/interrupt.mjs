// 中断协议:先关新派发并持久化,再逐 Run 取消与停止请求;持久化失败不继续执行面动作。
// 形态判定沿用 domain.computePause:请求在途=interrupting,存在不可观测后代=stopPendingConfirm。
import { globalStop } from './domain.mjs'

export async function requestInterrupt(deps, { taskId, global = false }) {
  // 1. 进程内先关新派发:dispatch 闸门每次调用重读 control,这里先持久化 stopping 意图
  let nextControl
  try {
    nextControl = await deps.updateControl((control) => (global
      ? globalStop(control)
      : { ...control, taskControl: { ...control.taskControl, [taskId]: { ...(control.taskControl?.[taskId] ?? {}), controlState: 'stopping' } } }))
  } catch (error) {
    // 持久化失败也不恢复派发(闸门读不到 stopping 即不冒险),报告错误
    return { accepted: false, error: String(error?.message ?? error) }
  }
  // 2. 作废旧发送意图(保留审计由调用方落账)
  if (!global && typeof deps.voidPendingIntents === 'function') {
    await deps.voidPendingIntents(taskId)
  }
  // 3. 取消当前执行面上的 Run(逐 Run 容错,失败不阻断其余取消),再发停止请求
  const cancelFailures = []
  for (const run of await deps.listActiveRuns(taskId)) {
    try {
      await deps.cancelRun(run)
    } catch (error) {
      cancelFailures.push({ runId: run.runId, error: String(error?.message ?? error) })
    }
  }
  await deps.requestStop()
  return {
    accepted: true,
    control: nextControl,
    controlState: 'stopping',
    taskId,
    global,
    ...(cancelFailures.length > 0 ? { cancelFailures } : {}),
  }
}
