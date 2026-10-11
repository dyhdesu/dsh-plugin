// 域逻辑测试:状态机、代次放行、幂等键。场景为 GWT 嵌入式。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BUSINESS_STATES,
  PHASES,
  transitionTask,
  computePause,
  globalStop,
  allowTask,
  applyCommand,
  newTask,
} from '../lib/domain.mjs'

function readyTask() {
  return transitionTask(newTask({ taskId: 't1', goal: 'g', workspaceId: 'w1' }), 'authorize', {})
}

test('新任务为 draft,授权后 ready', () => {
  const t = newTask({ taskId: 't1', goal: 'g', workspaceId: 'w1' })
  assert.equal(t.businessState, 'draft')
  const r = transitionTask(t, 'authorize', {})
  assert.equal(r.businessState, 'ready')
})

test('授权前置条件:仅 draft/blocked 可授权', () => {
  assert.throws(() => transitionTask(readyTask(), 'authorize', {}))
})

test('范围或验收标准变更使授权失效进入 blocked,新授权回 ready', () => {
  const t = transitionTask(readyTask(), 'scopeChanged', {})
  assert.equal(t.businessState, 'blocked')
  const r = transitionTask(t, 'authorize', {})
  assert.equal(r.businessState, 'ready')
})

test('派发进入 implementing,实施结果进入 awaiting_acceptance,验收不通过回 implementing', () => {
  const impl = transitionTask(readyTask(), 'dispatch', { phase: 'implement' })
  assert.equal(impl.businessState, 'implementing')
  const aw = transitionTask(impl, 'resultSubmitted', {})
  assert.equal(aw.businessState, 'awaiting_acceptance')
  const back = transitionTask(aw, 'acceptanceRejected', {})
  assert.equal(back.businessState, 'implementing')
  const done = transitionTask(transitionTask(back, 'resultSubmitted', {}), 'acceptancePassed', {})
  assert.equal(done.businessState, 'completed')
})

test('取消:无在途执行直接进入,有在途执行须先确认停止', () => {
  const t = newTask({ taskId: 't1', goal: 'g', workspaceId: 'w1' })
  assert.equal(transitionTask(t, 'cancel', {}).businessState, 'cancelled')
  const dispatched = transitionTask(readyTask(), 'dispatch', { phase: 'implement' })
  assert.throws(() => transitionTask(dispatched, 'cancel', {}))
  const stopped = transitionTask(dispatched, 'executionStopped', {})
  assert.equal(transitionTask(stopped, 'cancel', {}).businessState, 'cancelled')
})

test('无在途执行:全局未停时任务默认放行', () => {
  const control = { globalStopGeneration: 0, globalStopped: false }
  const pause = computePause(control, readyTask())
  assert.equal(pause.paused, false)
})

test('全局停止后新授权任务不放行,单任务放行后可派发', () => {
  let control = globalStop({ globalStopGeneration: 0, globalStopped: false })
  assert.equal(control.globalStopped, true)
  assert.equal(computePause(control, readyTask()).paused, true)
  control = allowTask(control, 't1')
  assert.equal(computePause(control, readyTask()).paused, false)
})

test('再次全局停止使已有单任务放行失效', () => {
  let control = globalStop({ globalStopGeneration: 0, globalStopped: false })
  control = allowTask(control, 't1')
  control = globalStop(control)
  assert.equal(computePause(control, readyTask()).paused, true)
})

test('全局停止代次随停止递增,单任务放行记录停代次', () => {
  let control = globalStop({ globalStopGeneration: 0, globalStopped: false })
  assert.equal(control.globalStopGeneration, 1)
  control = allowTask(control, 't1')
  assert.equal(control.taskAllows.t1, control.globalStopGeneration)
})

test('stopping 形态:请求在途为中断中,已到达但存在不可观测后代为停止待确认', () => {
  const inFlight = computePause({ globalStopGeneration: 0, globalStopped: false }, readyTask(), {
    controlState: 'stopping', stopRequestsInFlight: true,
  })
  assert.equal(inFlight.form, 'interrupting')
  const unconfirmed = computePause({ globalStopGeneration: 0, globalStopped: false }, readyTask(), {
    controlState: 'stopping', stopRequestsInFlight: false, unobservableDescendants: true,
  })
  assert.equal(unconfirmed.form, 'stopPendingConfirm')
  const confirmed = computePause({ globalStopGeneration: 0, globalStopped: false }, readyTask(), {
    controlState: 'stopping', stopRequestsInFlight: false, unobservableDescendants: false,
  })
  assert.equal(confirmed.form, 'paused')
})

test('局部暂停优先于全局放行', () => {
  let control = globalStop({ globalStopGeneration: 0, globalStopped: false })
  control = allowTask(control, 't1')
  const paused = computePause(control, readyTask(), { controlState: 'paused' })
  assert.equal(paused.paused, true)
})

test('同一 causeId+actionKey 重复提交返回原结果不再次派发', () => {
  let aggregate = { appliedActions: {}, runs: [], revision: 0 }
  const effect = (agg) => {
    const run = { runId: `r${agg.runs.length + 1}` }
    return { aggregate: { ...agg, runs: [...agg.runs, run], revision: agg.revision + 1 }, result: run }
  }
  const first = applyCommand(aggregate, { causeId: 'n1', actionKey: 'dispatch-implement' }, effect)
  assert.equal(first.aggregate.runs.length, 1)
  assert.equal(first.replayed, false)
  const second = applyCommand(first.aggregate, { causeId: 'n1', actionKey: 'dispatch-implement' }, effect)
  assert.equal(second.replayed, true)
  assert.equal(second.aggregate.runs.length, 1)
  assert.deepEqual(second.result, first.result)
})

test('不同 actionKey 各自成键,互不命中', () => {
  let aggregate = { appliedActions: {}, runs: [], revision: 0 }
  const effect = (agg) => ({ aggregate: { ...agg, runs: [...agg.runs, { runId: `r${agg.runs.length + 1}` }], revision: agg.revision + 1 }, result: null })
  const a = applyCommand(aggregate, { causeId: 'n1', actionKey: 'dispatch-implement' }, effect)
  const b = applyCommand(a.aggregate, { causeId: 'n1', actionKey: 'dispatch-accept' }, effect)
  assert.equal(b.aggregate.runs.length, 2)
  assert.equal(b.replayed, false)
})

test('状态与 phase 枚举冻结', () => {
  assert.deepEqual([...BUSINESS_STATES].sort(), ['awaiting_acceptance', 'blocked', 'cancelled', 'completed', 'draft', 'implementing', 'ready'])
  assert.deepEqual([...PHASES].sort(), ['accept', 'fix', 'implement', 'integrate'])
})
