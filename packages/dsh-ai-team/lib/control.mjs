// 控制室装配:存储域、路由、工具、事件订阅。全部经 ctx.inject 门控,缺失即该面不启用。
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { createBoardApi } from './board.mjs'
import { requestInterrupt } from './interrupt.mjs'
import { createEventMerger } from './events.mjs'
import { createSessionAdapter } from './session-adapter.mjs'
import { registerToolRow } from './tools-row.mjs'
import { presetDefinitions } from './presets.mjs'
import { updateControlRecord } from './store.mjs'

const CONTROL_INITIAL = { globalStopped: false, globalStopGeneration: 0, taskAllows: {} }
const TASK_TABLE_SCHEMA = z.any()

// 域形态:单 kv 表承载任务聚合/索引/控制记录(update RMW 在域写链上原子);
// global 句柄只有 get/set 无 RMW,控制记录不走 global。
const DOMAIN_SPEC = defineDomain({
  name: 'ai_team',
  version: 1,
  tables: { kv: domainTable(TASK_TABLE_SCHEMA) },
})

// 任务聚合以 KV 表逐任务存单记录(架构设计:单记录 update 承载同时成立的任务事实)
export function registerControl(ctx) {
  let stopped = false
  ctx.inject(['storageDomain', 'webServer'], async (scope) => {
    if (stopped) return
    const domain = await scope.storageDomain.open(DOMAIN_SPEC)
    ctx.effect(() => () => domain.close())
    const table = domain.table('kv')
    const store = {
      loadAggregate: (id) => Promise.resolve(table.get(`task/${id}`)),
      saveAggregate: async (agg) => {
        await table.put(`task/${agg.taskId}`, agg)
        await table.update('taskIndex', (index) => {
          const ids = index?.ids ?? []
          return ids.includes(agg.taskId) ? index : { ids: [...ids, agg.taskId] }
        })
        return agg
      },
      updateAggregate: (id, fn) => table.update(`task/${id}`, fn),
      loadControl: () => Promise.resolve(table.get('control') ?? CONTROL_INITIAL),
      updateControl: (fn) => updateControlRecord(table, fn, CONTROL_INITIAL),
    }
    const listAggregates = async () => {
      const index = table.get('taskIndex')
      const ids = index?.ids ?? []
      return Promise.all(ids.map((id) => store.loadAggregate(id)))
    }

    const sessionAdapter = 'sessionController' in scope
      ? createSessionAdapter({ sessionController: scope.sessionController })
      : null

    function sendPrompt(intent) {
      if (!sessionAdapter) return Promise.resolve({ accepted: false })
      // 派发面向尚不存在的会话:先 ensure(收养/创建幂等,携带实施角色预设)再 prompt
      return sessionAdapter.ensureSession({ sessionId: intent.sessionId, agentPreset: intent.agentPreset })
        .then(() => sessionAdapter.dispatchPrompt(intent))
    }

    const api = createBoardApi({ store: { ...store, listAggregates }, interrupt: (scopeSignal) => requestInterrupt(makeInterruptDeps(store, sessionAdapter, listAggregates), scopeSignal) })
    ctx.effect(() => scope.webServer.register({ kind: 'exact', path: '/api/ai-team/board', handler: api.handleBoard }), 'ai-team board')
    ctx.effect(() => scope.webServer.register({ kind: 'exact', path: '/api/ai-team/interrupt', handler: api.handleInterrupt }), 'ai-team interrupt')
    // 业务工具注册进全局工具面;guard 按预设前缀拒绝非受管会话(tools-row)
    ctx.effect(registerToolRow(ctx, { store, sendPrompt, now: () => Date.now() }))
    // 角色预设:管理员/调度员专用组合(persona 只含角色边界,不含 shell/写文件/委派)
    ctx.inject(['agentPresets'], async (presets) => {
      for (const definition of presetDefinitions()) {
        const dispose = await presets.register(definition)
        ctx.effect(() => dispose)
      }
    })  })
  ctx.on('dispose', () => { stopped = true })
}

function makeInterruptDeps(store, sessionAdapter, listAggregates) {
  const IN_FLIGHT = ['prepared', 'submitted', 'running']
  return {
    updateControl: store.updateControl,
    // global 停止:taskId 缺省,枚举全部任务的活动 Run 逐个取消
    listActiveRuns: async (taskId) => {
      if (taskId !== undefined) {
        const agg = await store.loadAggregate(taskId)
        return (agg?.runs ?? []).filter((r) => IN_FLIGHT.includes(r.state))
      }
      const all = await listAggregates()
      return all.flatMap((agg) => (agg?.runs ?? []).filter((r) => IN_FLIGHT.includes(r.state)))
    },
    cancelRun: async (run) => sessionAdapter?.cancelSession({ sessionId: run.intent.requestId, pendingItemIds: [] }),
    requestStop: async () => {},
  }
}

// 受管会话登记与事件归并装配在派发管线落地后接线(preset 组合提供角色会话)。
export { createEventMerger }
