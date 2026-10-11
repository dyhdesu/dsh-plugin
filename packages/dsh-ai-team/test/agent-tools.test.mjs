// 工具面测试:dispatch 全管线(校验+幂等提交+Run 记录+发送意图)、报告通道、确认通知
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAgentTools } from '../lib/agent-tools.mjs'

function makeEnv() {
  const aggregates = new Map()
  const control = { globalStopped: false, globalStopGeneration: 1, taskAllows: {} }
  const store = {
    async loadAggregate(id) { return aggregates.get(id) },
    async saveAggregate(agg) { aggregates.set(agg.taskId, agg); return agg },
    async updateAggregate(id, fn) {
      const next = fn(aggregates.get(id))
      aggregates.set(id, next)
      return next
    },
    loadControl: async () => control,
    updateControl: async (fn) => fn(control),
  }
  const prompts = []
  const tools = createAgentTools({
    store,
    sendPrompt: async (intent) => { prompts.push(intent); return { accepted: true } },
    now: () => 42,
  })
  return { tools, aggregates, prompts, store, control }
}

async function seedAuthorized(env) {
  await env.tools.handle('ai_team_create_task', { taskId: 't1', goal: 'g', workspaceId: 'w1' }, { role: 'admin' })
  await env.tools.handle('ai_team_authorize_task', { taskId: 't1' }, { role: 'admin' })
}

test('管理员创建任务为草稿,授权后 ready', async () => {
  const env = makeEnv()
  await seedAuthorized(env)
  assert.equal(env.aggregates.get('t1').businessState, 'ready')
})

test('调度员 dispatch 产生 Run 与发送意图,重复 actionKey 不重发', async () => {
  const env = makeEnv()
  await seedAuthorized(env)
  const cmd = { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n1', actionKey: 'a1' }
  const first = await env.tools.handle('ai_team_dispatch', cmd, { role: 'dispatcher', taskId: 't1' })
  assert.equal(first.ok, true)
  assert.equal(env.prompts.length, 1)
  const second = await env.tools.handle('ai_team_dispatch', cmd, { role: 'dispatcher', taskId: 't1' })
  assert.equal(second.replayed, true)
  assert.equal(env.prompts.length, 1)
})

test('实施角色不能调用调度员工具(登记角色判定,非自填)', async () => {
  const env = makeEnv()
  await seedAuthorized(env)
  await assert.rejects(
    () => env.tools.handle('ai_team_dispatch', { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n', actionKey: 'a' }, { role: 'worker' }),
    /角色/,
  )
})

test('实施角色报告结果进入待验收并生成通知', async () => {
  const env = makeEnv()
  await seedAuthorized(env)
  await env.tools.handle('ai_team_dispatch', { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n1', actionKey: 'a1' }, { role: 'dispatcher', taskId: 't1' })
  const r = await env.tools.handle('ai_team_report_result', { taskId: 't1', workItemId: 'w1', summary: 'done', evidence: 'e' }, { role: 'worker', taskId: 't1' })
  assert.equal(r.ok, true)
  const agg = env.aggregates.get('t1')
  assert.equal(agg.businessState, 'awaiting_acceptance')
  assert.equal(agg.notices.filter((n) => n.kind === 'resultPending').length, 1)
})

test('全局停止后 dispatch 被闸门拒绝', async () => {
  const env = makeEnv()
  env.control.globalStopped = true
  await seedAuthorized(env)
  await assert.rejects(
    () => env.tools.handle('ai_team_dispatch', { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n1', actionKey: 'a1' }, { role: 'dispatcher', taskId: 't1' }),
    /暂停/,
  )
})

test('单任务 stopping 后 dispatch 被拒绝', async () => {
  const env = makeEnv()
  env.control.taskControl = { t1: { controlState: 'stopping' } }
  await seedAuthorized(env)
  await assert.rejects(
    () => env.tools.handle('ai_team_dispatch', { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n1', actionKey: 'a1' }, { role: 'dispatcher', taskId: 't1' }),
    /中断中/,
  )
})

test('report_result 核清在途 Run,工作项可重派', async () => {
  const env = makeEnv()
  await seedAuthorized(env)
  const cmd = { taskId: 't1', workItemId: 'w1', phase: 'fix', causeId: 'n2', actionKey: 'b1' }
  await env.tools.handle('ai_team_dispatch', cmd, { role: 'dispatcher', taskId: 't1' })
  await assert.rejects(() => env.tools.handle('ai_team_dispatch', { ...cmd, causeId: 'n3', actionKey: 'b2' }, { role: 'dispatcher', taskId: 't1' }), /重叠/)
  await env.tools.handle('ai_team_report_result', { taskId: 't1', workItemId: 'w1', summary: 's', evidence: 'e' }, { role: 'worker', taskId: 't1' })
  const agg = env.aggregates.get('t1')
  assert.ok(agg.runs.every((r) => r.state === 'settled'))
  const again = await env.tools.handle('ai_team_dispatch', { ...cmd, causeId: 'n3', actionKey: 'b2' }, { role: 'dispatcher', taskId: 't1' })
  assert.equal(again.ok, true)
})

test('sendPrompt 拒绝时 Run 回写 rejected 并可重派', async () => {
  const env = makeEnv()
  const failing = createAgentTools({ store: env.store, sendPrompt: async () => ({ accepted: false }), now: () => 42 })
  await seedAuthorized(env)
  const first = await failing.handle('ai_team_dispatch', { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n1', actionKey: 'a1' }, { role: 'dispatcher', taskId: 't1' })
  assert.equal(first.accepted, false)
  const agg = env.aggregates.get('t1')
  assert.equal(agg.runs[0].state, 'rejected')
  assert.equal(agg.hasInFlightExecution, false)
  const again = await failing.handle('ai_team_dispatch', { taskId: 't1', workItemId: 'w1', phase: 'implement', causeId: 'n2', actionKey: 'a2' }, { role: 'dispatcher', taskId: 't1' })
  assert.equal(again.ok, true)
})

test('重复创建任务被拒绝', async () => {
  const env = makeEnv()
  await env.tools.handle('ai_team_create_task', { taskId: 't1', goal: 'g', workspaceId: 'w1' }, { role: 'admin' })
  await assert.rejects(
    () => env.tools.handle('ai_team_create_task', { taskId: 't1', goal: 'g2', workspaceId: 'w1' }, { role: 'admin' }),
    /已存在/,
  )
})

test('authorize/query 缺失聚合返回明确错误', async () => {
  const env = makeEnv()
  await assert.rejects(() => env.tools.handle('ai_team_authorize_task', { taskId: 'nope' }, { role: 'admin' }), /不存在/)
})
