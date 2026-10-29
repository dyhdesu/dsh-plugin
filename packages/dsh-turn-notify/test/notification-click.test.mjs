import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildUnit } from '../src/core.mjs'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const REMIND_MS = 10 * 60 * 1000

// 仅替换浏览器/宿主边界；执行真实 factory、apply、poll 与回调。
function fixture({ rows = [], current = null, focus = false, highlight = true } = {}) {
  const definitions = [], shown = [], native = [], timers = new Map(), events = new Map(), storage = new Map()
  let payload = { version: 0, units: [] }, nextTimer = 0
  if (!highlight) storage.set('turn-notify:session-hl', '0')
  const rowEls = rows.map(({ id, title = '同名', running = false }) => {
    const classes = new Set()
    const row = {
      key: id === null ? null : 'session:' + id,
      textContent: (running ? '进行中' : '') + title,
      getAttribute: name => name === 'data-row-key' ? row.key : null,
      classList: { contains: c => classes.has(c), add: (...cs) => cs.forEach(c => classes.add(c)), remove: (...cs) => cs.forEach(c => classes.delete(c)) },
      querySelector: () => ({ textContent: title }), querySelectorAll: () => [{ textContent: title }],
      children: [], click() { throw new Error('导航不可点击DOM') },
    }
    Object.defineProperty(row, 'className', { get: () => [...classes].join(' '), set: value => { classes.clear(); value.split(' ').filter(Boolean).forEach(c => classes.add(c)) } })
    return row
  })
  const listen = (type, fn) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn) }
  const unlisten = (type, fn) => events.get(type)?.delete(fn)
  const document = {
    hidden: !focus, title: '同名 — DeepSeek Harness', hasFocus: () => focus,
    body: {}, documentElement: { dataset: { platform: 'darwin' } },
    createElement: () => ({ setAttribute() {}, remove() {} }), head: { appendChild() {} },
    addEventListener: listen, removeEventListener: unlisten,
    querySelectorAll: selector => selector === '[data-row-key]' ? rowEls : selector === '.tn-sess-hl' ? rowEls.filter(row => row.classList.contains('tn-sess-hl')) : [],
  }
  const window = {
    __ModuleLoader__: { load: definition => definitions.push(definition) },
    location: { protocol: 'dsh-app:' }, focus() {},
    addEventListener: listen, removeEventListener: unlisten,
    localStorage: { get length() { return storage.size }, key: i => [...storage.keys()][i] ?? null,
      getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  }
  const tools = { setupCommonTools: () => ({ subscribe: () => () => {} }), createSnapshotRefresh: refresh => ({ refresh, dispose() {} }),
    toast: { show: (text, opts) => shown.push({ text, opts }) } }
  class Notification {
    static permission = 'granted'
    constructor(text, options) { this.text = text; this.options = options; native.push(this) }
    close() { this.closed = true }
  }
  const setTimer = (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer }
  new Function('window', 'document', 'fetch', 'Notification', 'MutationObserver', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', source)(
    window, document, async path => ({ ok: true, json: async () => path.endsWith('/sounds') ? { sounds: [] } : payload }), Notification,
    class { observe() {} disconnect() {} }, setTimer, id => timers.delete(id), setTimer, id => timers.delete(id), setTimer, id => timers.delete(id),
  )
  const factory = () => definitions[0].factory(name => name === 'react' ? {} : tools)
  const mod = factory()
  function owner(module = mod, { fail = false } = {}) {
    const opened = [], cleanups = [], subscriptions = new Set()
    let live = true, ownerCurrent = current
    const services = {
      uiWorkspace: { openSession(id) { assert.ok(live, '旧owner服务被调用'); if (fail) throw new Error('failed'); opened.push(id) } },
      sessions: { list: { getSnapshot() { assert.ok(live, '旧owner快照被读取'); return { byId: ownerCurrent ? { [ownerCurrent]: { id: ownerCurrent, retainedBy: { mainView: 1 } } } : {} } }, subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn) } } }, workspaces: {},
    }
    module.apply({ get: key => services[key], effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off) }, inject() {}, slots: { inject() {} } })
    return { opened, setCurrent(id) { ownerCurrent = id; for (const fn of subscriptions) fn() }, off() { while (cleanups.length) cleanups.pop()(); live = false } }
  }
  const emit = (type, event) => { for (const fn of [...(events.get(type) || [])]) fn(event) }
  return { mod, factory, owner, shown, native, rows: rowEls, window, timers,
    async notify(units, module = mod) { payload = { version: payload.version + 1, units }; assert.equal(await module.__test.poll(), true) },
    clickRow(index) { emit('click', { target: { closest: () => rowEls[index] } }) },
    remind() { for (const [id, timer] of [...timers]) if (timer.delay === REMIND_MS) { timers.delete(id); timer.fn() } },
    focus() { focus = true; document.hidden = false; emit('focus') },
  }
}
const unit = (id = 'B', category = 'ask') => ({ id: 'event-' + id, sessionId: id, session: '同名', category, text: '通知' + id })
const highlighted = row => row.classList.contains('tn-sess-hl')

test('N1 core保留身份且展示标题不变', () => {
  const result = buildUnit({ id: 'n', sessionId: 'B', sessionTitle: '同名', category: 'ask' })
  assert.equal(result.sessionId, 'B')
  assert.equal(result.session, '同名')
})

for (const rows of [[{ id: 'A' }, { id: 'B' }], [{ id: 'B' }], [], [{ id: 'B', title: '已改名' }]]) {
  test('N1 同名/单行/折叠/改名均按身份导航 ' + JSON.stringify(rows), async () => {
    const f = fixture({ rows }), a = f.owner()
    try {
      await f.notify([unit()])
      f.shown[0].opts.onClick(); f.native[0].onclick()
      assert.deepEqual(a.opened, ['B', 'B'])
      assert.equal(f.native[0].closed, true)
    } finally { a.off() }
  })
}

test('N1 无展示标题仍按身份导航；无身份仅聚焦', async () => {
  const f = fixture(), a = f.owner()
  try {
    await f.notify([{ ...unit(), session: null }, { id: 'bare', session: '同名', category: 'ask', text: '测试' }])
    f.shown[0].opts.onClick(); f.shown[1].opts.onClick()
    assert.deepEqual(a.opened, ['B'])
  } finally { a.off() }
})

test('N2 同名当前A不吞B高亮/提醒，点击A只清A', async () => {
  const f = fixture({ rows: [{ id: 'A' }, { id: 'B' }], current: 'A', focus: true }), a = f.owner()
  try {
    await f.notify([unit('A'), unit('B')])
    assert.deepEqual(f.rows.map(highlighted), [false, true])
    f.clickRow(0); f.remind()
    assert.ok(f.shown.some(item => item.text === '[再次提醒] 通知B'))
    assert.equal(f.shown.some(item => item.text === '[再次提醒] 通知A'), false)
  } finally { a.off() }
})

test('N2 同名双行点击身份A不清B；当前快照切B即已读', async () => {
  const f = fixture({ rows: [{ id: 'A' }, { id: 'B' }] }), a = f.owner()
  try {
    await f.notify([unit('A'), unit('B')])
    assert.deepEqual(f.rows.map(highlighted), [true, true])
    f.clickRow(0)
    assert.deepEqual(f.rows.map(highlighted), [false, true])
    a.setCurrent('B'); f.focus()
    assert.deepEqual(f.rows.map(highlighted), [false, false])
    const count = f.shown.length; f.remind(); assert.equal(f.shown.length, count)
  } finally { a.off() }
})

test('N2 缺失/重复DOM身份不误标；特殊字符按属性严格比较', async () => {
  const id = 'B"]#\\'
  const f = fixture({ rows: [{ id: 'B' }, { id: 'B' }, { id: null }, { id }] }), a = f.owner()
  try {
    await f.notify([unit('B'), unit(id)])
    assert.deepEqual(f.rows.map(highlighted), [false, false, false, true])
  } finally { a.off() }
})

test('N2 DOM复用和容量淘汰清旧类，分类更新不残留', async () => {
  const f = fixture({ rows: [{ id: 'B' }] }), a = f.owner()
  try {
    await f.notify([unit()]); assert.equal(highlighted(f.rows[0]), true)
    f.rows[0].key = 'session:other'
    await f.notify([unit()]); assert.equal(highlighted(f.rows[0]), false)
    f.rows[0].key = 'session:B'
    await f.notify([{ ...unit(), id: 'updated', category: 'error' }])
    assert.equal(f.rows[0].classList.contains('tn-sess-hl--error'), true)
    assert.equal(f.rows[0].classList.contains('tn-sess-hl--ask'), false)
    await f.notify(Array.from({ length: 20 }, (_, i) => unit('new-' + i)))
    assert.equal(highlighted(f.rows[0]), false)
  } finally { a.off() }
})

for (const options of [{ highlight: false }, { rows: [{ id: 'B', running: true }] }, { rows: [{ id: 'B' }] }]) {
  test('N3 高亮关闭/运行/容量淘汰均不等于处理 ' + JSON.stringify(options), async () => {
    const f = fixture(options), a = f.owner()
    try {
      await f.notify([unit()])
      if (options.rows?.[0]?.running === false || options.rows?.[0]?.running === undefined && options.rows) await f.notify([unit(), ...Array.from({ length: 20 }, (_, i) => unit('n-' + i))])
      f.remind()
      assert.ok(f.shown.some(item => item.text === '[再次提醒] 通知B'))
    } finally { a.off() }
  })
}

test('N3 关闭高亮时身份行点击仍处理；同会话后续新通知可再提醒', async () => {
  const f = fixture({ rows: [{ id: 'B' }], highlight: false }), a = f.owner()
  try {
    await f.notify([unit()]); f.clickRow(0); f.remind()
    assert.equal(f.shown.length, 1)
    await f.notify([{ ...unit(), id: 'new-B' }]); f.remind()
    assert.equal(f.shown.at(-1).text, '[再次提醒] 通知B')
  } finally { a.off() }
})

for (const first of [0, 1]) test('N4 任一owner先卸载均用存活服务 ' + first, async () => {
  const f = fixture(), owners = [f.owner(), f.owner()]
  try {
    await f.notify([unit()]); owners[first].off(); f.shown[0].opts.onClick()
    assert.deepEqual(owners[1 - first].opened, ['B']); assert.deepEqual(owners[first].opened, [])
  } finally { owners.forEach(owner => owner.off()) }
})

test('N4 最后卸载/同factory重启/HMR后旧动作不复活，旧cleanup不伤新代', async () => {
  const f = fixture(), a = f.owner()
  await f.notify([unit()]); const oldClick = f.shown[0].opts.onClick, oldNative = f.native[0]
  a.off(); oldClick(); oldNative.onclick(); assert.deepEqual(a.opened, [])
  const b = f.owner(); oldClick(); assert.deepEqual(b.opened, [])
  await f.notify([{ ...unit(), id: 'B2' }]); const bClick = f.shown.at(-1).opts.onClick
  const fresh = f.factory(), c = f.owner(fresh)
  bClick(); b.off(); a.off(); assert.deepEqual(b.opened, [])
  await f.notify([{ ...unit(), id: 'B3' }], fresh); f.shown.at(-1).opts.onClick()
  assert.deepEqual(c.opened, ['B']); c.off()
})

test('R1 关闭高亮时宿主导航查看B再离开仍撤销已读提醒', async () => {
  const f = fixture({ highlight: false, focus: true }), a = f.owner()
  try {
    await f.notify([unit('B')])
    a.setCurrent('B'); a.setCurrent('A')
    const count = f.shown.length
    f.remind()
    assert.equal(f.shown.length, count, '已查看B后离开也不再催')
  } finally { a.off() }
})

test('N5 导航抛错不误记处理且系统通知仍关闭', async () => {
  const f = fixture(), a = f.owner(f.mod, { fail: true })
  try {
    await f.notify([unit()]); assert.doesNotThrow(() => f.native[0].onclick())
    assert.equal(f.native[0].closed, true); f.remind()
    assert.equal(f.shown.at(-1).text, '[再次提醒] 通知B')
  } finally { a.off() }
})
