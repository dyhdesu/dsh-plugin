// 事件归并:受管会话事件的 seq 去重、usage 按 turn 聚合、通知生成。
// 事实先行:调用方在宿主事件回调内只做归并与通知入队,不做长任务。
export function createEventMerger({ notify }) {
  const managed = new Map()
  const seenSeqs = new Map()
  const usage = new Map()

  function registerManaged(sessionId, binding) {
    managed.set(sessionId, binding)
    seenSeqs.set(sessionId, new Set())
    usage.set(sessionId, { totalTokens: 0, complete: true, turns: new Set() })
  }

  function isManaged(sessionId) {
    return managed.has(sessionId)
  }

  function accept(sessionId, event) {
    if (!isManaged(sessionId)) return
    const seen = seenSeqs.get(sessionId)
    if (seen.has(event.seq)) return
    seen.add(event.seq)
    const binding = managed.get(sessionId)
    if (event.type === 'assistant/message') {
      acceptUsage(sessionId, event.data ?? {})
      notify({ kind: 'resultPending', sessionId, taskId: binding.taskId, seq: event.seq })
      return
    }
    // turn/end 等生命周期事件只更新事实,不产生完成通知
  }

  function acceptUsage(sessionId, data) {
    const stat = usage.get(sessionId)
    const turn = data.turn
    if (!stat.turns.has(turn)) {
      stat.turns.add(turn)
      const turnUsage = data.usage
      if (turnUsage && typeof turnUsage.totalTokens === 'number') {
        stat.totalTokens += turnUsage.totalTokens
      } else {
        stat.complete = false
      }
    }
  }

  function usageOf(sessionId) {
    const stat = usage.get(sessionId)
    if (!stat) return { totalTokens: 0, complete: false }
    return { totalTokens: stat.totalTokens, complete: stat.complete }
  }

  return { registerManaged, isManaged, accept, usageOf }
}
