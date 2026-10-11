// 中断协议测试:顺序(关新派发→持久化→作废→停止请求→形态判定)与持久化失败不恢复派发
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { requestInterrupt } from '../lib/interrupt.mjs'

function makeDeps({ persistError, cancelError } = {}) {
  const calls = []
  const control = { globalStopped: false, globalStopGeneration: 0, taskAllows: {} }
  const deps = {
    loadControl: async () => control,
    updateControl: async (fn) => {
      calls.push('persist')
      if (persistError) throw persistError
      const next = fn(control)
      Object.assign(control, next)
      return next
    },
    cancelRun: async (run) => {
      if (cancelError && run.runId === 'r1') throw cancelError
      calls.push(`cancel:${run.runId}`)
    },
    listActiveRuns: async () => [{ runId: 'r1' }, { runId: 'r2' }],
    requestStop: async () => { calls.push('stopRequest') },
    get control() { return control },
  }
  return { deps, calls }
}

test('单任务中断顺序:先持久化再逐 Run 取消再停止请求', async () => {
  const { deps, calls } = makeDeps()
  const result = await requestInterrupt(deps, { taskId: 't1' })
  assert.equal(calls[0], 'persist')
  assert.deepEqual(calls.slice(1, 3), ['cancel:r1', 'cancel:r2'])
  assert.equal(calls[3], 'stopRequest')
  assert.equal(result.controlState, 'stopping')
})

test('持久化失败不取消任何执行且报告错误', async () => {
  const { deps, calls } = makeDeps({ persistError: new Error('disk full') })
  const result = await requestInterrupt(deps, { global: true })
  assert.equal(calls.includes('cancel:r1'), false)
  assert.equal(result.accepted, false)
  assert.match(result.error, /disk full/)
})

test('全局停止更新全局代次与停止位', async () => {
  const { deps } = makeDeps()
  const result = await requestInterrupt(deps, { global: true })
  assert.equal(result.accepted, true)
  assert.equal(deps.control.globalStopped, true)
  assert.equal(deps.control.globalStopGeneration, 1)
})

test('单任务中断作废旧发送意图并保留审计', async () => {
  const { deps } = makeDeps()
  const voided = []
  const d2 = { ...deps, voidPendingIntents: async (taskId) => voided.push(taskId) }
  await requestInterrupt(d2, { taskId: 't1' })
  assert.deepEqual(voided, ['t1'])
})

test('首个 cancelRun 抛错不阻断其余取消,结果含 cancelFailures', async () => {
  const { deps, calls } = makeDeps({ cancelError: new Error('session gone') })
  const result = await requestInterrupt(deps, { taskId: 't1' })
  assert.equal(result.accepted, true)
  assert.deepEqual(calls, ['persist', 'cancel:r2', 'stopRequest'])
  assert.equal(result.cancelFailures.length, 1)
  assert.match(result.cancelFailures[0].error, /session gone/)
})
