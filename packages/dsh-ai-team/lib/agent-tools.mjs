// 业务工具面:管理员/调度员/实施角色的结构化命令入口。
// 角色凭证来自受管会话登记(caller),不接受模型自填;工具层只做装配,状态机在 domain。
// dispatch 的校验+落盘收进单个 updateAggregate 同步 fn(域写链 RMW 原子);发送后的状态推进走二次 update。
import { newTask, transitionTask, globalStop, allowTask, applyCommand, actionKeyOf } from './domain.mjs'
import { validateDispatch } from './dispatch.mjs'

const ROLE_CAPABILITIES = {
  admin: new Set(['ai_team_create_task', 'ai_team_authorize_task', 'ai_team_query_tasks']),
  dispatcher: new Set(['ai_team_dispatch', 'ai_team_report_result', 'ai_team_confirm_notice', 'ai_team_query_tasks']),
  worker: new Set(['ai_team_report_result', 'ai_team_query_tasks']),
}

function assertRole(caller, tool) {
  const allowed = ROLE_CAPABILITIES[caller?.role]
  if (!allowed || !allowed.has(tool)) throw new Error(`角色 ${caller?.role ?? '未知'} 无权调用 ${tool}`)
}

function requireAggregate(aggregate, taskId) {
  if (!aggregate) throw new Error(`任务不存在: ${taskId}`)
  return aggregate
}

export function createAgentTools({ store, sendPrompt, now }) {
  let runSeq = 0
  let noticeSeq = 0

  function noticeOf(aggregate, notice) {
    noticeSeq += 1
    // 时间序+序号:进程重启后不与持久化历史 id 碰撞(requestId 同构)
    return { ...aggregate, notices: [...(aggregate.notices ?? []), { id: `n${now().toString(36)}-${noticeSeq}`, ...notice }] }
  }

  // 把指定 workItem(缺省=全部)的在途 Run 核清为 settled
  function settleRuns(aggregate, workItemId) {
    const inFlight = (run) => ['prepared', 'submitted', 'running'].includes(run.state)
      && (workItemId === undefined || run.workItemId === workItemId)
    if (!(aggregate.runs ?? []).some(inFlight)) return aggregate
    return { ...aggregate, runs: aggregate.runs.map((r) => (inFlight(r) ? { ...r, state: 'settled', settledAt: now() } : r)) }
  }

  async function handle(tool, args, caller) {
    assertRole(caller, tool)
    if (tool === 'ai_team_create_task') {
      if (await store.loadAggregate(args.taskId)) throw new Error(`任务已存在: ${args.taskId}`)
      const task = newTask(args)
      await store.saveAggregate({ ...task, appliedActions: {}, runs: [], notices: [] })
      return { ok: true, taskId: task.taskId, businessState: task.businessState }
    }
    if (tool === 'ai_team_authorize_task') {
      const current = requireAggregate(await store.loadAggregate(args.taskId), args.taskId)
      await store.saveAggregate(transitionTask(current, 'authorize', {}))
      return { ok: true }
    }
    if (tool === 'ai_team_dispatch') {
      const command = { causeId: args.causeId, actionKey: args.actionKey }
      // 控制状态先读(派发闸门);幂等键命中先于一切校验(重放返回原结果)
      const control = await store.loadControl()
      const before = requireAggregate(await store.loadAggregate(args.taskId), args.taskId)
      const key = actionKeyOf(command.causeId, command.actionKey)
      if (before.appliedActions?.[key] !== undefined) {
        return { ok: true, replayed: true, result: before.appliedActions[key] }
      }
      // 校验+Run 落盘在单个 RMW 内:并发 report/interrupt/dispatch 不会丢更新
      const outcome = await store.updateAggregate(args.taskId, (current) => {
        requireAggregate(current, args.taskId)
        const validation = validateDispatch(
          { aggregate: current, now: now() },
          current,
          control,
          { workItemId: args.workItemId, phase: args.phase, dependsOn: args.dependsOn },
        )
        if (!validation.ok) throw new Error(validation.reason)
        return applyCommand(current, command, (agg) => {
          runSeq += 1
          const run = {
            runId: `run-${now().toString(36)}-${runSeq}`,
            workItemId: args.workItemId,
            phase: args.phase,
            state: 'prepared',
            intent: validation.intent,
            startedAt: now(),
          }
          return {
            aggregate: {
              ...agg,
              runs: [...agg.runs, run],
              businessState: transitionTask(agg, 'dispatch', { phase: args.phase }).businessState,
              hasInFlightExecution: true,
              revision: agg.revision + 1,
            },
            result: run,
          }
        }).aggregate
      })
      const run = outcome.runs.filter((r) => r.state === 'prepared').at(-1)
      let sent
      try {
        sent = await sendPrompt({
          sessionId: run.intent.requestId,
          requestId: run.intent.requestId,
          content: [{ type: 'text', text: `任务 ${before.taskId} / ${run.phase}: ${before.goal}` }],
        })
      } catch (error) {
        sent = { accepted: false, error: String(error?.message ?? error) }
      }
      if (sent.accepted) {
        // 仅 prepared 态推进:并发中断/上报已迁移的 Run 不被覆写
        await store.updateAggregate(args.taskId, (agg) => ({
          ...agg,
          runs: agg.runs.map((r) => (r.runId === run.runId && r.state === 'prepared' ? { ...r, state: 'submitted' } : r)),
        }))
      } else {
        // 发送失败:Run 回写 rejected 并清在途,工作项可重派
        await store.updateAggregate(args.taskId, (agg) => ({
          ...agg,
          runs: agg.runs.map((r) => (r.runId === run.runId && r.state === 'prepared' ? { ...r, state: 'rejected', rejectedAt: now() } : r)),
          hasInFlightExecution: false,
        }))
      }
      return { ok: true, replayed: false, runId: run.runId, accepted: sent.accepted }
    }
    if (tool === 'ai_team_report_result') {
      await store.updateAggregate(args.taskId, (aggregate) => {
        requireAggregate(aggregate, args.taskId)
        let next = settleRuns(transitionTask(aggregate, 'resultSubmitted', {}), args.workItemId)
        next = noticeOf(next, { kind: 'resultPending', workItemId: args.workItemId, summary: args.summary, evidence: args.evidence })
        return { ...next, hasInFlightExecution: false, revision: aggregate.revision + 1 }
      })
      return { ok: true }
    }
    if (tool === 'ai_team_confirm_notice') {
      await store.updateAggregate(args.taskId, (aggregate) => ({
        ...aggregate,
        notices: (aggregate.notices ?? []).map((n) => (n.id === args.noticeId ? { ...n, acknowledged: true } : n)),
      }))
      return { ok: true }
    }
    if (tool === 'ai_team_query_tasks') {
      return { ok: true, aggregate: await store.loadAggregate(args.taskId) }
    }
    throw new Error(`未知工具: ${tool}`)
  }

  return { handle, globalStop, allowTask }
}
