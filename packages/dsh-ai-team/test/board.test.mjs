// board 路由测试:投影形态、中断受理、同源拒绝
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBoardApi } from '../lib/board.mjs'

function makeApi() {
  const tasks = [{
    taskId: 't1', goal: 'g', workspaceId: 'w1', businessState: 'ready', controlState: 'active',
    runs: [{ runId: 'r1', phase: 'implement', model: 'm', state: 'running', startedAt: 1, endedAt: undefined }],
    tokens: { total: 10, complete: true }, models: ['m'],
  }]
  const store = {
    async loadAggregate() { return undefined },
    async listAggregates() { return tasks },
    loadControl: async () => ({ globalStopped: false, globalStopGeneration: 0, taskAllows: {} }),
  }
  let interruptResult = { accepted: true }
  const interrupts = []
  const api = createBoardApi({
    store,
    interrupt: async (scope) => { interrupts.push(scope); return interruptResult },
  })
  return { api, tasks, interrupts, setInterruptResult: (r) => { interruptResult = r } }
}

function res() {
  return { status: 0, body: undefined, writeHead(s, h) { this.status = s; this.headers = h }, end(b) { this.body = b } }
}

function jsonRes() {
  const r = res()
  r.end = (b) => { r.raw = b }
  Object.defineProperty(r, 'payload', { get() { return JSON.parse(this.raw) } })
  return r
}

function streamReq({ method, headers, url, body }) {
  return {
    method, headers, url,
    on(event, cb) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(body))
      if (event === 'end') cb()
    },
  }
}

test('GET board 返回 control 与任务投影', async () => {
  const { api } = makeApi()
  const r = jsonRes()
  await api.handleBoard({ headers: { host: 'h', origin: 'http://h' } }, r)
  assert.equal(r.status, 200)
  assert.equal(r.payload.control.globalStopped, false)
  assert.equal(r.payload.tasks[0].taskId, 't1')
  assert.equal(r.payload.tasks[0].tokens.complete, true)
})

test('POST interrupt 全局停止透传并返回受理结果', async () => {
  const { api, interrupts } = makeApi()
  const r = jsonRes()
  await api.handleInterrupt(streamReq({ headers: { host: 'h', origin: 'http://h' }, body: JSON.stringify({ global: true }) }), r)
  assert.equal(r.status, 200)
  assert.deepEqual(interrupts, [{ global: true }])
  assert.equal(r.payload.accepted, true)
})

test('持久化失败时 interrupt 返回 502 与错误', async () => {
  const { api, setInterruptResult } = makeApi()
  setInterruptResult({ accepted: false, error: 'disk full' })
  const r = jsonRes()
  await api.handleInterrupt(streamReq({ headers: { host: 'h', origin: 'http://h' }, body: JSON.stringify({ taskId: 't1' }) }), r)
  assert.equal(r.status, 502)
  assert.match(r.payload.error, /disk full/)
})

test('跨源写请求被同源比对拒绝', async () => {
  const { api } = makeApi()
  const r = jsonRes()
  await api.handleInterrupt(streamReq({ headers: { host: 'h', origin: 'http://evil' }, body: JSON.stringify({ global: true }) }), r)
  assert.equal(r.status, 403)
})

test('缺 taskId 且非全局返回 400', async () => {
  const { api } = makeApi()
  const r = jsonRes()
  await api.handleInterrupt(streamReq({ headers: { host: 'h', origin: 'http://h' }, body: '{}' }), r)
  assert.equal(r.status, 400)
})

test('超大请求体返回 413', async () => {
  const { api } = makeApi()
  const r = jsonRes()
  await api.handleInterrupt(streamReq({ headers: { host: 'h', origin: 'http://h', 'content-length': String(65 * 1024) }, body: 'x' }), r)
  assert.equal(r.status, 413)
})

test('存储异常返回 500 且只含 message 不含堆栈', async () => {
  const store = {
    listAggregates: async () => { throw new Error('boom') },
    loadControl: async () => { throw new Error('boom') },
  }
  const api = createBoardApi({ store, interrupt: async () => ({ accepted: true }) })
  const r = jsonRes()
  await api.handleBoard({ headers: { host: 'h' } }, r)
  assert.equal(r.status, 500)
  assert.equal(r.payload.error, 'boom')
  assert.ok(!JSON.stringify(r.payload).includes('at '), '不得泄漏堆栈')
})
