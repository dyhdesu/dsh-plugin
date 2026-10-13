// 插话撤回(steer recall)接线与纯函数测试:加载真实 src/client.js,
// 捕获 slots.register 断言 dock 条目结构,切片实例化纯函数锁定撤回动作与失败文案。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SRC = readFileSync(join(PKG_ROOT, 'src', 'client.js'), 'utf8')

// 加载 client.js 并执行 apply(mock 最小服务面),返回插槽注册捕获。
// slots.inject 收到注册回调即同步执行;binding 桩仅对会话 s1 生效
function loadClient({ binding, remoteSession } = {}) {
  const modules = []
  const registered = []
  const injectedNames = []
  const windowStub = { __ModuleLoader__: { load: (module) => modules.push(module) }, addEventListener: () => {} }
  const reactStub = {
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    createElement: () => null,
  }
  const requireStub = (name) => {
    if (name === '@mzzsfy/dsh-toast/client') return { show: () => 0 }
    return reactStub
  }
  const factory = new Function('window', 'require', 'document', CLIENT_SRC + '\n;return null')
  factory(
    windowStub,
    requireStub,
    { createElement: () => ({ style: {}, remove() {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} } },
  )
  assert.equal(modules.length, 1, 'client.js 模块未被捕获')
  const mod = modules[0].factory(requireStub)

  const sessions = {
    binding: (sessionId) => (sessionId === 's1' ? binding : undefined),
    fork: () => Promise.resolve('child-1'),
    open: () => {},
  }
  const remote = { session: remoteSession }
  const ctx = {
    get: (name) => (name === 'sessions' ? sessions : {}),
    effect: () => {},
    slots: {
      inject: (name, register) => { injectedNames.push(name); register() },
      register: (options, component) => registered.push({ options, component }),
    },
    get remote() { return remote },
  }
  mod.apply(ctx)
  return { registered, injectedNames }
}

// 插话撤回 dock 条目捕获:与官方 queue dock(order 20)、goal dock(order 10)同槽位
function findSteerEntry(options) {
  const { registered, injectedNames } = loadClient(options)
  assert.ok(injectedNames.includes('conversation.input.dock'), 'apply 未注入 conversation.input.dock 插槽')
  const entries = registered.filter((item) => item.options.name === 'conversation.input.dock')
  const entry = entries.find((item) => item.options.id === 'context-manager-steer')
  assert.ok(entry, '未注册 id=context-manager-steer 的插话撤回 dock 条目')
  return { entry, entries }
}

test('Given client.js 装载, When apply, Then 注册插话撤回与历史浮层 dock 条目', () => {
  const { entry, entries } = findSteerEntry()
  assert.equal(typeof entry.component, 'function', 'dock 条目缺组件')
  assert.equal(entry.options.order, 25, '插话撤回条目 order 应紧邻官方队列面板(20)之后')
  assert.ok(entries.some((item) => item.options.id === 'context-manager-history'), '历史浮层条目被挤掉')
})

test('Given 会话绑定存在, When dock inject, Then updateQueue 路由到 binding.session.updateQueue', async () => {
  const calls = []
  const binding = {
    session: {
      updateQueue: async (itemId, action) => {
        calls.push({ itemId, action })
        return { ok: true }
      },
      projections: { faceOf: () => ({ getSnapshot: () => ({}) }) },
    },
  }
  const { entry } = findSteerEntry({ binding })
  const props = entry.options.inject('s1')
  assert.equal(typeof props.updateQueue, 'function', 'inject 未返回 updateQueue')
  const result = await props.updateQueue('m1', { kind: 'remove' })
  assert.deepEqual(calls, [{ itemId: 'm1', action: { kind: 'remove' } }], 'updateQueue 未按 remove 动作透传')
  assert.deepEqual(result, { ok: true })
})

test('Given 会话绑定存在, When dock inject, Then 返回 inbox 投影 face 供组件订阅', () => {
  const face = { getSnapshot: () => ({ 'next-step': [INBOX_MESSAGE] }) }
  const binding = {
    session: {
      updateQueue: async () => ({ ok: true }),
      projections: { faceOf: (name) => name === 'inbox' ? face : null },
    },
  }
  const { entry } = findSteerEntry({ binding })
  const props = entry.options.inject('s1')
  assert.equal(props.inboxFace, face, 'inject 未返回 inbox 投影 face')
})

test('Given 会话面无投影(旧宿主), When dock inject, Then inboxFace 为 undefined(组件不渲染)', () => {
  const binding = { session: { updateQueue: async () => ({ ok: true }) } }
  const { entry } = findSteerEntry({ binding })
  const props = entry.options.inject('s1')
  assert.equal(props.inboxFace, undefined, '无投影时应返回 undefined 触发组件干净缺席')
})

test('Given 会话绑定缺失, When dock inject, Then 返回空 props(干净禁用)', () => {
  const { entry } = findSteerEntry()
  assert.deepEqual(entry.options.inject('s1'), {}, '绑定缺失应返回空 props')
  assert.deepEqual(entry.options.inject('missing'), {}, '未知会话应返回空 props')
})

test('Given 会话面无 updateQueue(旧宿主), When dock inject, Then 返回空 props(干净禁用)', () => {
  const { entry } = findSteerEntry({ binding: { session: {} } })
  assert.deepEqual(entry.options.inject('s1'), {}, '会话面无 updateQueue 应返回空 props')
})

// 纯函数切片:steerRowsOfInbox / withdrawFailureText / withdrawSteer(无外部依赖,动作经注入)
const PURE_START = CLIENT_SRC.indexOf('function steerRowsOfInbox(')
const PURE_END = CLIENT_SRC.indexOf('function SteerRecallDock(')
assert.ok(PURE_START >= 0 && PURE_END > PURE_START, 'client.js 插话撤回纯函数切片定位失败')
const pure = new Function(
  CLIENT_SRC.slice(PURE_START, PURE_END)
  + '; return { steerRowsOfInbox: steerRowsOfInbox, withdrawFailureText: withdrawFailureText, withdrawSteer: withdrawSteer }',
)()

const INBOX_MESSAGE = {
  id: 'm1',
  source: { kind: 'user' },
  content: [{ type: 'text', text: '帮我看下' }],
}
const STEERING_ROW = { id: 'm1', preview: '帮我看下', text: '帮我看下' }

test('steerRowsOfInbox:仅保留 user 来源的 next-step 行,映射为撤回行', () => {
  const messages = [
    { id: 'x1', source: { kind: 'system' }, content: [{ type: 'text', text: '注入' }] },
    INBOX_MESSAGE,
    null,
    { id: 'x2', source: { kind: 'user' }, content: [{ type: 'text', text: '第二条' }] },
  ]
  const rows = pure.steerRowsOfInbox(messages)
  assert.deepEqual(rows.map((row) => row.id), ['m1', 'x2'])
  assert.equal(rows[0].text, '帮我看下')
  assert.ok(rows[0].preview.includes('帮我看下'))
  assert.deepEqual(pure.steerRowsOfInbox([]), [])
  assert.deepEqual(pure.steerRowsOfInbox(undefined), [])
})

test('steerRowsOfInbox:含非文本块的插话不可撤回(text 为 null)', () => {
  const rows = pure.steerRowsOfInbox([
    { id: 'm2', source: { kind: 'user' }, content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: {} }] },
    { id: 'm3', source: { kind: 'user' }, content: [] },
    { id: 'm4', source: { kind: 'user' } },
    { id: 'm5' },
  ])
  assert.equal(rows[0].text, null)
  assert.equal(rows[1].text, null)
  assert.equal(rows[2].text, null)
  assert.deepEqual(rows.map((row) => row.id), ['m2', 'm3', 'm4'])
})

test('withdrawSteer 主路径:remove 成功后回填草稿并提示,返回 true', async () => {
  const calls = []
  const actions = {
    updateQueue: async (itemId, action) => { calls.push({ itemId, action }); return { ok: true } },
    setDraft: (text) => calls.push({ setDraft: text }),
    notify: (text, opts) => calls.push({ notify: text, opts }),
  }
  const done = await pure.withdrawSteer(STEERING_ROW, actions)
  assert.equal(done, true)
  assert.deepEqual(calls, [
    { itemId: 'm1', action: { kind: 'remove' } },
    { setDraft: '帮我看下' },
    { notify: '已撤回到输入框', opts: undefined },
  ])
})

test('withdrawSteer 已被应用:queue-item-not-found 不回填草稿,专用文案报错', async () => {
  const calls = []
  const actions = {
    updateQueue: async () => ({ ok: false, error: { code: 'session/queue-item-not-found', message: 'queued item is no longer pending' } }),
    setDraft: (text) => calls.push({ setDraft: text }),
    notify: (text, opts) => calls.push({ notify: text, opts }),
  }
  const done = await pure.withdrawSteer(STEERING_ROW, actions)
  assert.equal(done, false)
  assert.deepEqual(calls, [{ notify: '插话已被应用,无法撤回', opts: { kind: 'error' } }])
})

test('withdrawSteer 其他失败:透传错误消息且不回填草稿', async () => {
  const calls = []
  const actions = {
    updateQueue: async () => ({ ok: false, error: { code: 'session/steer-unavailable', message: 'busy' } }),
    setDraft: (text) => calls.push({ setDraft: text }),
    notify: (text, opts) => calls.push({ notify: text, opts }),
  }
  const done = await pure.withdrawSteer(STEERING_ROW, actions)
  assert.equal(done, false)
  assert.deepEqual(calls, [{ notify: '撤回失败: busy', opts: { kind: 'error' } }])
})

test('withdrawSteer 传输层拒绝:按错误处理且不回填草稿', async () => {
  const calls = []
  const actions = {
    updateQueue: async () => { throw new Error('network down') },
    setDraft: (text) => calls.push({ setDraft: text }),
    notify: (text, opts) => calls.push({ notify: text, opts }),
  }
  const done = await pure.withdrawSteer(STEERING_ROW, actions)
  assert.equal(done, false)
  assert.deepEqual(calls, [{ notify: '撤回失败: network down', opts: { kind: 'error' } }])
})

test('withdrawSteer 摘除成功但回填抛错:兜底展示原文,不报成功', async () => {
  const calls = []
  const actions = {
    updateQueue: async () => ({ ok: true }),
    setDraft: () => { throw new Error('shell released') },
    notify: (text, opts) => calls.push({ notify: text, opts }),
  }
  const done = await pure.withdrawSteer(STEERING_ROW, actions)
  assert.equal(done, false)
  assert.deepEqual(calls, [{ notify: '草稿回填失败,原文: 帮我看下', opts: { kind: 'error' } }])
})

// ── 组件级门控:干净禁用规约的落地断言(整源加载 + 记录型 createElement 直接调组件) ──

// createElement 桩记录调用树:h(type, props, ...children) -> {type, props, children}
// useStateValues:按调用序覆盖各 useState 初始值(超出部分用组件默认),供渲染态断言
function loadComponent(useStateValues = [], { captureEffects = false } = {}) {
  const modules = []
  const registered = []
  const effects = []
  const windowStub = { __ModuleLoader__: { load: (module) => modules.push(module) }, addEventListener: () => {} }
  const element = (type, props, ...children) => ({ type, props, children })
  let call = 0
  let refCall = 0
  // useState/useRef 有状态桩:setter 写回槽位、ref 跨调用持久(模拟 React 更新周期)
  const slots = []
  const refs = []
  const reactStub = {
    useState: (value) => {
      const i = call
      call += 1
      if (!(i in slots)) slots[i] = i < useStateValues.length ? useStateValues[i] : value
      return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }]
    },
    useEffect: (fn) => {
      if (captureEffects) effects.push(fn)
    },
    useRef: (value) => {
      const i = refCall
      refCall += 1
      if (!(i in refs)) refs[i] = { current: value }
      return refs[i]
    },
    createElement: element,
  }
  const requireStub = (name) => {
    if (name === '@mzzsfy/dsh-toast/client') return { show: () => 0 }
    return reactStub
  }
  const factory = new Function('window', 'require', 'document', CLIENT_SRC + '\n;return null')
  factory(
    windowStub,
    requireStub,
    {
      createElement: () => ({ style: {}, remove() {} }),
      createElementNS: () => ({ appendChild() {}, setAttribute() {} }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      querySelectorAll: () => [],
    },
  )
  const mod = modules[0].factory(requireStub)
  const sessions = { binding: () => undefined, fork: () => Promise.resolve('c'), open: () => {} }
  const ctx = {
    get: (name) => (name === 'sessions' ? sessions : {}),
    effect: () => {},
    slots: {
      inject: (name, register) => register(),
      register: (options, component) => registered.push({ options, component }),
    },
    get remote() { return { session: { page: () => Promise.resolve({ records: [] }) } } },
  }
  mod.apply(ctx)
  const entry = registered.find((item) => item.options.id === 'context-manager-steer')
  assert.ok(entry, '组件级测试未捕获插话撤回条目')
  // 每次组件调用重置 hooks 槽位游标(一次调用 = 一轮渲染,槽位序号从 0 起)
  const raw = entry.component
  const component = (...args) => {
    call = 0
    refCall = 0
    return raw(...args)
  }
  return { component, effects }
}

const DOCK_COMPONENT = loadComponent()
const NO_ACTIONS = { setDraft: () => {} }
const OK_UPDATE = async () => ({ ok: true })

// useSession 桩:两次 selector 读取共用同一快照(与官方 SessionSnapshotSelector 单快照同构)
// rows:注入 useState 的行集初始值(组件订阅投影后由 setRows 更新,桩环境静态注入)
function dockWith(snapshot, rows = []) {
  const useSession = (selector) => selector(snapshot)
  const inboxFace = { getSnapshot: () => ({}) }
  const dock = loadComponent([false, true, rows])
  return (props) => dock.component({ useSession, inputActions: NO_ACTIONS, updateQueue: OK_UPDATE, inboxFace, ...props })
}

test('SteerRecallDock 干净禁用:依赖任一缺失即返回 null', () => {
  const dock = dockWith({ subagent: null })
  assert.equal(dock({ inputActions: undefined }), null, 'inputActions 缺失应不渲染')
  assert.equal(dock({ updateQueue: undefined }), null, 'updateQueue 缺失应不渲染')
  assert.equal(dock({ inboxFace: undefined }), null, 'inboxFace 缺失应不渲染(旧宿主无投影)')
})

test('SteerRecallDock 干净禁用:subagent 非 continuable 即返回 null', () => {
  const locked = dockWith({ subagent: { address: { mode: 'prompt' } } }, [STEERING_ROW])
  assert.equal(locked({}), null, 'queueMutable 为假应不渲染')
})

test('SteerRecallDock 渲染:投影行映射为撤回行,含附件行禁用', () => {
  const dock = dockWith({ subagent: null }, [STEERING_ROW, { id: 'm2', text: null, preview: null }])
  dock({}) // 首帧:faceRef 校验未通过(与 React 挂载帧一致),行集按空渲染
  const host = dock({})
  assert.equal(host.type, 'div')
  assert.equal(host.props.className, 'cx-steer', '应渲染撤回行宿主')
  const rowsUi = host.children[0]
  assert.equal(rowsUi.length, 2, '每行投影行对应一个撤回行')
  const firstBtn = rowsUi[0].children[0]
  assert.equal(firstBtn.props.disabled, false, '纯文本行可撤回')
  assert.ok(firstBtn.props.title.includes('撤回到输入框'), '标题含撤回语义与预览')
  const secondBtn = rowsUi[1].children[0]
  assert.equal(secondBtn.props.disabled, true, '含附件行禁用')
  assert.equal(secondBtn.props.title, '含附件的插话不可撤回')
})

test('SteerRecallDock 渲染:face 变更的首帧按空行集渲染(防旧会话行闪现)', () => {
  const dock = dockWith({ subagent: null }, [STEERING_ROW])
  dock({}) // face A 初始化
  const other = { getSnapshot: () => ({}) }
  assert.equal(dock({ inboxFace: other }), null, 'face 切换首帧不得渲染旧 face 的行集')
  dock({ inboxFace: other })
  assert.equal(dock({ inboxFace: other }).props.className, 'cx-steer', '同 face 稳定后恢复渲染')
})

test('SteerRecallDock 渲染:空行集(行已应用/摘除)不渲染零占位', () => {
  assert.equal(dockWith({ subagent: null }, [])({}), null, '行集为空应不渲染')
})

test('SteerRecallDock 渲染:停用开关(挂载拉取后为关)不渲染', () => {
  const dock = loadComponent([false, false, [STEERING_ROW]])
  const useSession = (selector) => selector({ subagent: null })
  const host = dock.component({ useSession, inputActions: NO_ACTIONS, updateQueue: OK_UPDATE, inboxFace: { getSnapshot: () => ({}) } })
  assert.equal(host, null, 'enabled=false 应不渲染')
})

test('SteerRecallDock 订阅:face 推送驱动行集更新,行映射渲染,退订生效', () => {
  // fake face:可手动推送快照,记录订阅与退订
  let snapshot = { 'next-step': [] }
  const listeners = new Set()
  const face = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const dock = loadComponent([false, true, []], { captureEffects: true })
  const renders = []
  const render = (props) => {
    const out = dock.component({ useSession: (s) => s({ subagent: null }), inputActions: NO_ACTIONS, updateQueue: OK_UPDATE, inboxFace: face, ...props })
    renders.push(out)
    return out
  }
  // 首渲染 + 手动执行 effects(挂载):订阅建立并拉取空快照(effects[1] 为订阅,effects[0] 为启停拉取)
  render({})
  assert.equal(listeners.size, 0, 'effects 未执行前不应订阅')
  const mountCleanup = dock.effects[1]()
  assert.equal(listeners.size, 1, '挂载后应建立订阅')
  assert.equal(typeof mountCleanup, 'function', '订阅应返回退订函数')
  assert.equal(renders.at(-1), null, '空行集首渲染不输出')
  // 推送:user 行入投影 → setRows 调度 → 重渲染映射为撤回行
  snapshot = { 'next-step': [INBOX_MESSAGE] }
  listeners.forEach((fn) => fn())
  render({})
  const host = renders.at(-1)
  assert.equal(host && host.props.className, 'cx-steer', '推送后应渲染撤回行宿主')
  assert.equal(host.children[0].length, 1, 'user 行映射为一条撤回行')
  // 推送:行摘除 → 回到零占位
  snapshot = { 'next-step': [] }
  listeners.forEach((fn) => fn())
  render({})
  assert.equal(renders.at(-1), null, '行摘除后应回到零占位')
  // 卸载:执行挂载返回的清理函数,退订后推送不再触达组件
  mountCleanup()
  assert.equal(listeners.size, 0, '卸载清理应退订')
  snapshot = { 'next-step': [INBOX_MESSAGE] }
  listeners.forEach((fn) => fn())
  render({})
  assert.equal(renders.at(-1), null, '退订后推送不再驱动渲染')
})

// 数据面契约(源码级守卫):撤回入口由 inbox 投影驱动,禁止再依赖官方气泡 DOM——
// 0.2.0-rc.2 实测气泡落账(user/message 事件)常迟于投影 spliced 且几乎同步于应用
// claim,按气泡注入按钮的窗口结构性趋零(本次为撤回入口第二次失效的形态结论)
test('SteerRecallDock 数据面契约:订阅 inbox face,不依赖官方气泡 DOM', () => {
  assert.ok(CLIENT_SRC.includes('inboxFace.subscribe'), '应订阅 inbox 投影 face 变更')
  assert.ok(CLIENT_SRC.includes('inboxFace.getSnapshot'), '应经 face 快照读取行集')
  assert.ok(CLIENT_SRC.includes("faceOf(INBOX_STEER_KEY)"), 'inject 应取 inbox 投影 face')
  assert.ok(CLIENT_SRC.includes('INBOX_STEER_QUEUE'), '行集键应走常量')
  assert.ok(!CLIENT_SRC.includes('data-pending-steering'), '不得依赖旧 pending 属性(仅落账前乐观态渲染,且无 id 不可撤)')
  assert.ok(!CLIENT_SRC.includes('data-chat-flow-kind="steering"'), '不得依赖官方 steering 流标记(落账≈claim,窗口趋零)')
  assert.ok(!CLIENT_SRC.includes('data-cx-steer-recall'), '撤回按钮不再注入官方气泡 DOM')
  // SteerRecallDock 组件体内不得有 MutationObserver(fork/history 的观察器不在此列)
  const DOCK_START = CLIENT_SRC.indexOf('function SteerRecallDock(')
  const DOCK_END = CLIENT_SRC.indexOf('function ForkDockWithBootstrap')
  assert.ok(DOCK_START > 0 && DOCK_END > DOCK_START, 'SteerRecallDock 切片定位失败')
  assert.ok(!CLIENT_SRC.slice(DOCK_START, DOCK_END).includes('MutationObserver'), '撤回入口由投影订阅驱动,不得依赖 DOM 观察')
})
