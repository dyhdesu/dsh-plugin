// 控制室装配:存储域、路由、工具、角色预设。全部经 ctx.inject 门控,缺失即该面不启用。
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { createBoardApi } from './board.mjs'
import { createSessionAdapter } from './session-adapter.mjs'
import { registerToolRow } from './tools-row.mjs'
import { presetDefinitions } from './presets.mjs'
import { updateControlRecord } from './store.mjs'
import { createGlobalControl } from './core/global-control.mjs'

const TASK_TABLE_SCHEMA = z.any()

// 域形态:单 kv 表承载任务聚合/索引/全局控制记录(update RMW 在域写链上原子);
// global 句柄只有 get/set 无 RMW,控制记录不走 global。
const DOMAIN_SPEC = defineDomain({
  name: 'ai_team',
  version: 1,
  tables: { kv: domainTable(TASK_TABLE_SCHEMA) },
})

const CONTROL_INITIAL = createGlobalControl(() => Date.now())

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

    const api = createBoardApi({ store: { ...store, listAggregates }, now: () => Date.now() })
    ctx.effect(() => scope.webServer.register({ kind: 'exact', path: '/api/ai-team/board', handler: api.handleBoard }), 'ai-team board')
    ctx.effect(() => scope.webServer.register({ kind: 'exact', path: '/api/ai-team/interrupt', handler: api.handleInterrupt }), 'ai-team interrupt')
    // 业务工具注册进全局工具面;guard 按预设精确 id 拒绝非受管会话(tools-row)
    ctx.effect(registerToolRow(ctx, { store, now: () => Date.now() }))
    // 角色预设:管理员/调度员/实施(persona 只含角色边界,不含 shell/写文件/委派)
    ctx.inject(['agentPresets'], async (presets) => {
      for (const definition of presetDefinitions()) {
        const dispose = await presets.register(definition)
        ctx.effect(() => dispose)
      }
    })
  })
  ctx.on('dispose', () => { stopped = true })
}

// 受管会话登记与事件归并装配在派发管线落地后接线(preset 组合提供角色会话)。
export { createSessionAdapter }
