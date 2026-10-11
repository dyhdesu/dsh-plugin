// 事件归并测试:seq 去重、usage 按 turn 全有或全无聚合、非受管会话忽略、turn/end 不作为完成事件
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createEventMerger } from '../lib/events.mjs'

function makeMerger() {
  const notified = []
  const instance = createEventMerger({ notify: (n) => notified.push(n) })
  return { merger: instance, notified }
}

test('同 session 重复 seq 只处理一次', () => {
  const { merger, notified } = makeMerger()
  merger.registerManaged('s1', { taskId: 't1' })
  const event = { type: 'assistant/message', seq: 5, data: { turn: 1 } }
  merger.accept('s1', event)
  merger.accept('s1', event)
  assert.equal(notified.length, 1)
})

test('非受管会话事件被忽略', () => {
  const { merger, notified } = makeMerger()
  merger.accept('s1', { type: 'assistant/message', seq: 1, data: {} })
  assert.equal(notified.length, 0)
})

test('usage 按 turn 聚合,重复投递不双计', () => {
  const { merger } = makeMerger()
  merger.registerManaged('s1', { taskId: 't1' })
  const base = { type: 'assistant/message', data: { turn: 1, usage: { totalTokens: 100 } } }
  merger.accept('s1', { ...base, seq: 1 })
  merger.accept('s1', { ...base, seq: 1 })
  const usage = merger.usageOf('s1')
  assert.equal(usage.totalTokens, 100)
  assert.equal(usage.complete, true)
})

test('turn 无 usage 时 complete 为 false,缺失不伪装为零', () => {
  const { merger } = makeMerger()
  merger.registerManaged('s1', { taskId: 't1' })
  merger.accept('s1', { type: 'assistant/message', seq: 1, data: { turn: 1 } })
  const usage = merger.usageOf('s1')
  assert.equal(usage.totalTokens, 0)
  assert.equal(usage.complete, false)
})

test('turn/end 不触发完成通知', () => {
  const { merger, notified } = makeMerger()
  merger.registerManaged('s1', { taskId: 't1' })
  merger.accept('s1', { type: 'turn/end', seq: 1, data: { turn: 1, reason: 'complete' } })
  assert.equal(notified.filter((n) => n.kind === 'completed').length, 0)
})

test('受管会话 assistant/message 产生结果待核对通知', () => {
  const { merger, notified } = makeMerger()
  merger.registerManaged('s1', { taskId: 't1' })
  merger.accept('s1', { type: 'assistant/message', seq: 1, data: { turn: 1, usage: { totalTokens: 10 } } })
  assert.equal(notified.filter((n) => n.kind === 'resultPending').length, 1)
})
