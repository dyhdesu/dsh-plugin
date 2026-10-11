// 派发校验纯逻辑:授权、依赖、暂停、重叠执行、幂等键。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateDispatch } from '../lib/dispatch.mjs'
import { newTask, transitionTask, globalStop } from '../lib/domain.mjs'

function readyTask() {
  return transitionTask(newTask({ taskId: 't1', goal: 'g', workspaceId: 'w1' }), 'authorize', {})
}
const baseCommand = { causeId: 'n1', actionKey: 'd1', phase: 'implement', workItemId: 'w1' }
const baseCtx = { aggregate: { appliedActions: {}, runs: [] }, now: 1_000 }

test('草稿不可派发:缺授权记录', () => {
  const r = validateDispatch(baseCtx, newTask({ taskId: 't1', goal: 'g', workspaceId: 'w1' }), { globalStopped: false }, baseCommand)
  assert.equal(r.ok, false)
  assert.match(r.reason, /授权/)
})

test('依赖未满足不可派发', () => {
  const r = validateDispatch(baseCtx, readyTask(), { globalStopped: false }, { ...baseCommand, dependsOn: ['t0'] }, { satisfiedDependencies: [] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /依赖/)
})

test('暂停期间不可派发', () => {
  const r = validateDispatch(baseCtx, readyTask(), globalStop({ globalStopped: false, globalStopGeneration: 0 }), baseCommand, {})
  assert.equal(r.ok, false)
  assert.match(r.reason, /暂停/)
})

test('存在未核清在途 Run 不可重叠派发', () => {
  const aggregate = { appliedActions: {}, runs: [{ runId: 'r1', workItemId: 'w1', state: 'running' }] }
  const r = validateDispatch({ ...baseCtx, aggregate }, readyTask(), { globalStopped: false }, { ...baseCommand, workItemId: 'w1' }, {})
  assert.equal(r.ok, false)
  assert.match(r.reason, /重叠/)
})

test('缺 workItemId 拒绝派发', () => {
  const { workItemId, ...noWorkItem } = baseCommand
  const r = validateDispatch(baseCtx, readyTask(), { globalStopped: false }, noWorkItem, {})
  assert.equal(r.ok, false)
  assert.match(r.reason, /workItemId/)
})

test('合法派发返回派发意图并记录代次快照', () => {
  const control = { globalStopped: false, globalStopGeneration: 2 }
  const r = validateDispatch(baseCtx, readyTask(), control, baseCommand, {})
  assert.equal(r.ok, true)
  assert.equal(r.intent.dispatchGeneration, 2)
  assert.equal(r.intent.phase, 'implement')
  assert.equal(r.intent.requestId.length > 0, true)
})

test('派发意图携带实施角色预设与会话幂等键', () => {
  const r = validateDispatch(baseCtx, readyTask(), { globalStopped: false, globalStopGeneration: 0 }, baseCommand, {})
  assert.equal(r.ok, true)
  assert.equal(r.intent.agentPreset, 'ai-team-worker')
})
