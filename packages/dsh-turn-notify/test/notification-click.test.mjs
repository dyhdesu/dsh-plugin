// 通知点击直达 BDD:点击行为按通知携带的 sessionId 身份导航(uiWorkspace.openSession),
// 不再按侧边栏 DOM 标题模拟点击;macOS 桌面壳经 focus-desktop 端点唤起。
// 客户端片段按源码标记切片后在桩环境求值,宿主路由片段同样按标记切片求值。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildUnit, buildWebhookPayload } from '../src/core.mjs'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const navigation = source.slice(source.indexOf('const sessionNavigators = new Map()'), source.indexOf('// ---- 审批/提问超时二次提醒'))
const system = source.slice(source.indexOf('function notifySystem('), source.indexOf('// ---- 投影快照与认领'))
function fixture({ protocol = 'dsh-app:', platform = 'darwin', focusThrows = false, openThrows = false, wakeFails = false } = {}) {
  const opened = [], requests = [], messages = [], notifications = []
  let focuses = 0
  const window = { location: { protocol }, focus() { focuses++; if (focusThrows) throw new Error('focus') } }
  const document = { documentElement: { dataset: { platform } } }
  const api = async (...args) => { requests.push(args); if (wakeFails) throw new Error('wake'); return { ok: true } }
  const toast = (message) => messages.push(message)
  class Notification { constructor(title, options) { Object.assign(this, { title, options, closed: false }); notifications.push(this) } close() { this.closed = true } }
  const runtime = new Function('window', 'document', 'api', 'toast', 'Notification', 'TOAST_MS', navigation + system + '\nreturn { activateSessionFromUnit, notifySystem, bind(value) { sessionNavigators.clear(); if (value) sessionNavigators.set(Symbol(), value) } }')(window, document, api, toast, Notification, 6000)
  runtime.bind({ openSession(id) { if (openThrows) throw new Error('open'); opened.push(id) } })
  return { ...runtime, opened, requests, messages, notifications, focuses: () => focuses }
}

test('投影携带唯一会话ID，标题仍作展示，webhook 结构化同步且向后兼容', () => {
  const unit = buildUnit({ id: 'n', sessionId: 'session-42', sessionTitle: '同名标题', category: 'completed' })
  assert.equal(unit.sessionId, 'session-42')
  assert.equal(unit.session, '同名标题')
  assert.equal(buildUnit({}).sessionId, null)
  assert.equal(buildUnit({ sessionId: '' }).sessionId, null, '空串按缺省归 null')
  assert.equal(buildWebhookPayload(unit).sessionId, 'session-42', 'webhook 结构化字段同步会话 ID')
  assert.equal(buildWebhookPayload(buildUnit({})).sessionId, null, 'null 显式随行,消费方自行判空')
  assert.match(host, /status: reasonKind \?\? category,\s*sessionId,/)
})

test('真实系统通知点击回调按ID导航并关闭通知，通知创建不唤起App', async () => {
  const f = fixture()
  f.notifySystem({ id: 'n', text: '标题', summary: '摘要', sessionId: 's-target', session: '同名标题' })
  assert.equal(f.requests.length, 0, '通知创建不触发唤醒请求')
  assert.deepEqual(f.notifications[0].options, { tag: 'n', body: '摘要' })
  f.notifications[0].onclick()
  await Promise.resolve()
  assert.deepEqual(f.opened, ['s-target'])
  assert.equal(f.notifications[0].closed, true)
  assert.deepEqual(f.requests, [['/api/turn-notify/focus-desktop', { method: 'POST' }]])
})

test('重名、改名、空标题、跨工作区和折叠列表均按ID，不访问DOM', () => {
  const f = fixture({ protocol: 'http:' })
  for (const unit of [
    { sessionId: 'a', session: '相同标题', workspace: '/a' },
    { sessionId: 'b', session: '相同标题', workspace: '/b' },
    { sessionId: 'a', session: '旧标题' },
    { sessionId: 'c', session: null },
  ]) f.activateSessionFromUnit(unit)()
  assert.deepEqual(f.opened, ['a', 'b', 'a', 'c'])
  assert.equal(f.requests.length, 0)
})

test('旧通知或测试通知无ID时只聚焦，不按标题误跳', () => {
  const f = fixture({ protocol: 'http:' })
  for (const sessionId of [undefined, null, '', 42]) f.activateSessionFromUnit({ session: '存在同名行', sessionId })()
  assert.deepEqual(f.opened, [])
  assert.equal(f.focuses(), 4)
})

test('window.focus抛错不阻断ID导航；唤醒失败不产生未处理拒绝', async () => {
  const f = fixture({ focusThrows: true, wakeFails: true })
  f.notifySystem({ id: 'n', sessionId: 's' })
  assert.doesNotThrow(() => f.notifications[0].onclick())
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.opened, ['s'])
  assert.equal(f.notifications[0].closed, true)
  assert.equal(f.messages.length, 1)
})

test('导航服务缺席或调用失败时提示，不按标题走第二条路径', () => {
  const missing = fixture({ protocol: 'http:' })
  missing.bind(null)
  missing.activateSessionFromUnit({ sessionId: 's' })()
  assert.match(missing.messages[0], /尚未就绪/)
  const failed = fixture({ protocol: 'http:', openThrows: true })
  failed.notifySystem({ sessionId: 's' })
  failed.notifications[0].onclick()
  assert.match(failed.messages[0], /无法打开/)
  assert.equal(failed.notifications[0].closed, true)
})

test('普通浏览器和Windows桌面不请求macOS唤醒端点', () => {
  for (const config of [{ protocol: 'https:' }, { platform: 'win32' }]) {
    const f = fixture(config)
    f.activateSessionFromUnit({ sessionId: 's' })()
    assert.equal(f.requests.length, 0)
    assert.deepEqual(f.opened, ['s'])
  }
})

test('导航服务经注入生命周期绑定并卸载，不影响其他通知服务', () => {
  const start = source.indexOf("ctx.inject(['uiWorkspace']")
  const end = source.indexOf('// 样式挂载宿主文档级', start)
  let release
  const navigator = { openSession() {} }
  const ctx = { inject(names, fn) { assert.deepEqual(names, ['uiWorkspace']); fn({ get: () => navigator, effect(fn) { release = fn() } }) } }
  const run = new Function('ctx', 'const sessionNavigators = new Map();\n' + source.slice(start, end) + '\nreturn () => [...sessionNavigators.values()].at(-1) ?? null')
  const current = run(ctx)
  assert.equal(current(), navigator)
  release()
  assert.equal(current(), null)
})

test('宿主唤醒业务固定指向DSH，非macOS不执行且失败如实返回', async () => {
  const start = host.indexOf('  // 只唤起本机 macOS 桌面 App')
  const end = host.indexOf('  // 宿主通知测试点火互斥', start)
  const fragment = host.slice(start, end)
  for (const platform of ['darwin', 'linux']) {
    let registered, fail = false
    const calls = []
    const ctx = { effect(fn) { fn() }, webServer: { register(value) { registered = value } } }
    const route = (method, options, fn) => { assert.equal(method, 'POST'); assert.equal(options.crossOrigin, true); return fn }
    const spawn = { impl(...args) { calls.push(args.slice(0, 3)); args[3](fail ? new Error('failure') : null) } }
    new Function('ctx', 'route', 'sendJson', '__hostSpawn', 'process', fragment)(ctx, route, (res, status, body) => Object.assign(res, { status, body }), spawn, { platform })
    const res = {}
    await registered.handler({ body: { command: 'untrusted', url: 'https://example.org' } }, res)
    if (platform !== 'darwin') { assert.equal(res.status, 409); assert.equal(calls.length, 0); continue }
    assert.deepEqual(calls[0], ['/usr/bin/open', ['-b', 'com.deepseek.dsh', 'dsh://open'], { timeout: 5000 }])
    assert.deepEqual(res.body, { ok: true })
    fail = true
    await registered.handler({}, res)
    assert.equal(res.body.ok, false)
  }
})
