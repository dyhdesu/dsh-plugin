// 克隆仓库打开工作区:纯逻辑矩阵(目录名推导/请求校验/参数构造/克隆执行)
// + 路由层校验拒绝 + client 镜像 parity 与注入锚点结构契约。
// 真实 git 只验证参数构造与超时桩,克隆成功路径全走 spawn 注入,零网络零仓库依赖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  deriveRepoName,
  resolveCloneRequest,
  buildCloneArgs,
  runClone,
  tailLines,
  CLONE_TIMEOUT_MS,
} = await import('../src/clone.mjs')
const { apply, MESSAGES } = await import('../src/index.js')

// ── 目录名推导 ──

test('Given 各形态远程地址, When deriveRepoName, Then 推导去 .git 的尾段目录名', () => {
  assert.equal(deriveRepoName('https://github.com/user/repo.git'), 'repo')
  assert.equal(deriveRepoName('https://github.com/user/repo'), 'repo')
  assert.equal(deriveRepoName('https://github.com/user/repo/'), 'repo')
  assert.equal(deriveRepoName('git@github.com:user/repo.git'), 'repo')
  assert.equal(deriveRepoName('ssh://git@host:2222/group/inner/repo.git'), 'repo')
  assert.equal(deriveRepoName('  https://example.com/My.Repo.GIT  '), 'My.Repo')
})

test('Given 空地址或推导不出尾段, When deriveRepoName, Then 抛中文业务错误', () => {
  assert.throws(() => deriveRepoName(''), /仓库地址不能为空/)
  assert.throws(() => deriveRepoName('   '), /仓库地址不能为空/)
  assert.throws(() => deriveRepoName('https://example.com/.git'), /无法从仓库地址推导目录名/)
})

// ── 请求校验 ──

function statOk() { return async () => true }
function statMissing() { return async () => false }

test('Given 合法请求, When resolveCloneRequest, Then 返回 url/name/shallow/target 且目标由 name 决定', async () => {
  const request = await resolveCloneRequest(
    { url: 'https://github.com/user/repo.git', parent: 'C:\\work', shallow: true },
    { homedirPath: 'C:\\Users\\u', statParent: statOk(), existsTarget: statMissing() },
  )
  assert.equal(request.url, 'https://github.com/user/repo.git')
  assert.equal(request.name, 'repo')
  assert.equal(request.shallow, true)
  assert.equal(request.target, join('C:\\work', 'repo'))
})

test('Given name 缺省, When resolveCloneRequest, Then 由 URL 推导;name 含路径段分隔符或点项则拒绝', async () => {
  const derived = await resolveCloneRequest(
    { url: 'git@github.com:user/proj.git', parent: '/tmp' },
    { homedirPath: '', statParent: statOk(), existsTarget: statMissing() },
  )
  assert.equal(derived.name, 'proj')
  for (const name of ['a/b', 'a\\b', '..', '.']) {
    await assert.rejects(
      () => resolveCloneRequest(
        { url: 'https://e.com/r.git', parent: '/tmp', name },
        { homedirPath: '', statParent: statOk(), existsTarget: statMissing() },
      ),
      /目录名必须是单个路径段/,
    )
  }
})

test('Given 非法 url 或非法父目录, When resolveCloneRequest, Then 逐项拒绝', async () => {
  const base = { parent: '/tmp' }
  const options = { homedirPath: '/home/u', statParent: statOk(), existsTarget: statMissing() }
  await assert.rejects(() => resolveCloneRequest({ ...base, url: '' }, options), /仓库地址不能为空/)
  await assert.rejects(() => resolveCloneRequest({ ...base, url: '-u=https://e.com/r' }, options), /仓库地址不合法/)
  await assert.rejects(() => resolveCloneRequest({ ...base, url: 'file:///tmp/r' }, options), /远程地址/)
  await assert.rejects(() => resolveCloneRequest({ ...base, url: 'C:\\repos\\r' }, options), /远程地址/)
  await assert.rejects(() => resolveCloneRequest({ url: 'https://e.com/r.git', parent: '' }, options), /父目录不能为空/)
  await assert.rejects(
    () => resolveCloneRequest({ url: 'https://e.com/r.git', parent: 'relative/path' }, options),
    /父目录必须是绝对路径/,
  )
  await assert.rejects(
    () => resolveCloneRequest({ url: 'https://e.com/r.git', parent: '/nope' }, { ...options, statParent: statMissing() }),
    /父目录不存在或不是目录/,
  )
})

test('Given 目标目录已存在, When resolveCloneRequest, Then 拒绝并报目标路径', async () => {
  await assert.rejects(
    () => resolveCloneRequest(
      { url: 'https://e.com/r.git', parent: '/tmp' },
      { homedirPath: '', statParent: statOk(), existsTarget: async () => true },
    ),
    /目标目录已存在/,
  )
})

test('Given 父目录为 ~ 前缀, When resolveCloneRequest, Then 以宿主 home 展开', async () => {
  const request = await resolveCloneRequest(
    { url: 'https://e.com/r.git', parent: '~/work' },
    { homedirPath: '/home/u', statParent: statOk(), existsTarget: statMissing() },
  )
  assert.equal(request.parent, join('/home/u', 'work'))
})

// ── git 参数构造 ──

test('Given shallow 与否, When buildCloneArgs, Then 选项在 -- 前,url 与目标在 -- 后', () => {
  assert.deepEqual(
    buildCloneArgs({ url: 'https://e.com/r.git', target: '/t/r', shallow: false }),
    ['clone', '--', 'https://e.com/r.git', '/t/r'],
  )
  assert.deepEqual(
    buildCloneArgs({ url: 'https://e.com/r.git', target: '/t/r', shallow: true }),
    ['clone', '--depth', '1', '--', 'https://e.com/r.git', '/t/r'],
  )
})

// ── 克隆执行(spawn 注入,零网络)──

function spawnStub({ code = 0, stderr = '' } = {}) {
  const calls = []
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return {
      stderr: {
        setEncoding() {},
        on(_event, listener) { if (stderr) listener(stderr) },
      },
      on(event, listener) {
        if (event === 'error') return
        if (event === 'close') setImmediate(() => listener(code))
      },
      kill() {},
    }
  }
  return { spawn, calls }
}

test('Given git 退出 0, When runClone, Then resolve 目标路径', async () => {
  const { spawn, calls } = spawnStub({ code: 0, stderr: 'Cloning into...' })
  const result = await runClone({ url: 'https://e.com/r.git', target: '/t/r', parent: '/t', spawn })
  assert.deepEqual(result, { path: '/t/r' })
  assert.equal(calls[0].cmd, 'git')
  assert.equal(calls[0].opts.cwd, '/t')
})

test('Given git 非零退出, When runClone, Then 透出 stderr 尾部', async () => {
  const { spawn } = spawnStub({ code: 128, stderr: 'warning: x\nfatal: 远端意外挂断\n' })
  await assert.rejects(() => runClone({ url: 'https://e.com/r.git', target: '/t/r', parent: '/t', spawn }), /fatal: 远端意外挂断/)
})

test('Given git 不在 PATH, When runClone, Then 收敛为可行动文案', async () => {
  const missing = new Error('spawn git ENOENT')
  missing.code = 'ENOENT'
  const spawn = () => ({ stderr: null, on(event, listener) { if (event === 'error') setImmediate(() => listener(missing)) }, kill() {} })
  await assert.rejects(() => runClone({ url: 'https://e.com/r.git', target: '/t/r', parent: '/t', spawn }), /git 不可用:未安装或不在宿主 PATH 中/)
})

test('Given 超时, When runClone, Then 树杀并以业务错误拒绝', async () => {
  let killed = null
  const treeKill = (pid) => { killed = pid }
  const child = {
    stderr: { setEncoding() {}, on() {} },
    on() {},
    kill() {},
  }
  const spawn = () => child
  child.pid = 4321
  await assert.rejects(
    () => runClone({ url: 'https://e.com/r.git', target: '/t/r', parent: '/t', spawn, timeoutMs: 5, treeKill }),
    /克隆超时/,
  )
  assert.equal(killed, 4321)
})

test('Given 默认超时未显式传, When runClone 常量校验, Then 超时为 30 分钟量级', () => {
  assert.equal(CLONE_TIMEOUT_MS, 30 * 60 * 1000)
})

test('Given 多行 stderr, When tailLines, Then 保留非空尾部指定行数', () => {
  const text = 'a\n\nb\r\nc\nd'
  assert.equal(tailLines(text, 2), 'c\nd')
  assert.equal(tailLines('', 3), '')
})

// ── 路由层:校验拒绝在 spawn 之前,零副作用 ──

const sharedTmp = mkdtempSync(join(tmpdir(), 'cx-clone-route-'))
const effectDisposers = []
test.after(() => {
  for (const disposer of effectDisposers) {
    try { disposer() } catch { /* 逐个卸载,单个失败不阻断其余清理 */ }
  }
  rmSync(sharedTmp, { recursive: true, force: true })
})

function makeRouteCtx() {
  const routes = []
  const warns = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') effectDisposers.push(disposer)
      return disposer
    },
    inject: () => {},
    fiber: { entry: { options: { id: 'context-manager' } } },
    get: () => ({
      get: () => undefined,
      register: () => {},
    }),
    logger: { warn(message) { warns.push(message) }, info() {} },
    webServer: { register: (route) => routes.push(route) },
    sessionQuery: { listSessions: async () => [] },
    sessionPersistence: undefined,
    agents: undefined,
  }
  process.env.DSH_HISTORY_CACHE_DIR = sharedTmp
  apply(ctx, undefined)
  return { handlers: new Map(routes.map((route) => [route.path, route.handler])), warns }
}

function makeRequest(method, body) {
  const state = { method, chunks: body === undefined ? [] : [JSON.stringify(body)] }
  state.on = (event, listener) => {
    if (event === 'data') for (const chunk of state.chunks) listener(Buffer.from(chunk))
    if (event === 'end') setImmediate(listener)
  }
  return state
}

function makeResponse() {
  const state = { status: undefined, body: undefined }
  state.writeHead = (status) => { state.status = status }
  state.end = (text) => { state.body = JSON.parse(text) }
  return state
}

test('Given 克隆路由, When 各非法请求, Then 逐项中文拒绝且无进程拉起', async () => {
  const { handlers } = makeRouteCtx()
  const handler = handlers.get('/api/context/git-clone')
  assert.ok(handler, '克隆路由未注册')
  const cases = [
    [{}, /仓库地址不能为空/],
    [{ url: '-x', parent: '/tmp' }, /仓库地址不合法/],
    [{ url: 'file:///x', parent: '/tmp' }, /远程地址/],
    [{ url: 'https://e.com/r.git', parent: '' }, /父目录不能为空/],
    [{ url: 'https://e.com/r.git', parent: 'rel' }, /父目录必须是绝对路径/],
    [{ url: 'https://e.com/r.git', parent: sharedTmp, name: 'a/b' }, /目录名必须是单个路径段/],
  ]
  for (const [body, pattern] of cases) {
    const res = makeResponse()
    await handler(makeRequest('POST', body), res)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.match(res.body.error, pattern)
  }
})

test('Given 克隆路由, When 父目录不存在, Then 拒绝且不拉起 git', async () => {
  const { handlers } = makeRouteCtx()
  const handler = handlers.get('/api/context/git-clone')
  const res = makeResponse()
  await handler(makeRequest('POST', { url: 'https://e.com/r.git', parent: join(sharedTmp, 'no-such-dir') }), res)
  assert.equal(res.status, 400)
  assert.match(res.body.error, /父目录不存在或不是目录/)
})

test('Given 克隆路由, When 目标目录已存在, Then 拒绝且不拉起 git', async () => {
  const existing = mkdtempSync(join(sharedTmp, 'exists-'))
  const { handlers } = makeRouteCtx()
  const handler = handlers.get('/api/context/git-clone')
  const res = makeResponse()
  await handler(makeRequest('POST', { url: 'https://e.com/r.git', parent: sharedTmp, name: existing.split(/[\\/]/).pop() }), res)
  assert.equal(res.status, 400)
  assert.match(res.body.error, /目标目录已存在/)
})

test('Given 克隆路由, When GET, Then 405', async () => {
  const { handlers } = makeRouteCtx()
  const handler = handlers.get('/api/context/git-clone')
  const getRes = makeResponse()
  await handler(makeRequest('GET'), getRes)
  assert.equal(getRes.status, 405)
})

test('Given 真实 git 与不可达 .invalid 域, When POST 合法请求, Then 透出 git stderr 失败文案', async () => {
  const { execFileSync } = await import('node:child_process')
  let hasGit = true
  try {
    execFileSync('git', ['--version'])
  } catch {
    hasGit = false
  }
  if (!hasGit) return
  const { handlers } = makeRouteCtx()
  const handler = handlers.get('/api/context/git-clone')
  const res = makeResponse()
  await handler(
    makeRequest('POST', { url: 'https://cx-clone-nonexistent.invalid/repo.git', parent: sharedTmp, name: 'invalid-host-probe' }),
    res,
  )
  assert.equal(res.status, 400)
  assert.match(res.body.error, /克隆失败/)
})

// ── client 镜像与注入锚点契约 ──

const CLIENT_SRC = readFileSync(join(PKG_ROOT, 'src', 'client.js'), 'utf8')

function loadClientModule() {
  const modules = []
  const windowStub = { __ModuleLoader__: { load: (module) => modules.push(module) }, addEventListener: () => {} }
  const reactStub = { useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), createElement: () => null }
  const requireStub = (name) => (name === '@mzzsfy/dsh-toast/client' ? { show: () => 0 } : reactStub)
  const factory = new Function('window', 'require', 'document', CLIENT_SRC + '\n;return null')
  factory(windowStub, requireStub, { createElement: () => ({ style: {}, remove() {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} } })
  assert.equal(modules.length, 1, 'client.js 模块未被捕获')
  return modules[0].factory(requireStub)
}

test('Given client 与 clone.mjs 各持一份目录名推导, When 同输入, Then 行为同源(parity)', async () => {
  const mod = loadClientModule()
  const clientApply = mod.apply
  assert.equal(typeof clientApply, 'function')
  // 经 apply 装配面拿不到内部函数,镜像 parity 以源码级再声明执行:提取 client.js
  // 中 deriveRepoNameClient 函数体独立求值,与 host 实现逐用例对照
  const declared = CLIENT_SRC.match(/function deriveRepoNameClient\(rawUrl\) \{[\s\S]*?\n\}/)
  assert.ok(declared, 'client.js 必须内联声明 deriveRepoNameClient')
  const deriveClient = new Function(declared[0] + '\nreturn deriveRepoNameClient')()
  const cases = ['https://github.com/user/repo.git', 'https://github.com/user/repo/', 'git@github.com:user/repo.git', 'ssh://git@host:2222/g/r.git', '']
  for (const value of cases) {
    let hostOutcome
    try {
      hostOutcome = { value: deriveRepoName(value) }
    } catch {
      hostOutcome = { value: null }
    }
    const clientOutcome = { value: deriveClient(value) }
    assert.deepEqual(clientOutcome, hostOutcome, '目录名推导镜像不一致: ' + value)
  }
})

test('Given client.js 装配面, When apply, Then inject 列表不含 uiWorkspace(防门控放大)且克隆注入经 ctx.effect', async () => {
  const effects = []
  const registered = []
  const modules = []
  const windowStub = { __ModuleLoader__: { load: (module) => modules.push(module) }, addEventListener: () => {} }
  const reactStub = { useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), createElement: () => null }
  const requireStub = (name) => (name === '@mzzsfy/dsh-toast/client' ? { show: () => 0 } : reactStub)
  const factory = new Function('window', 'require', 'document', CLIENT_SRC + '\n;return null')
  factory(windowStub, requireStub, { createElement: () => ({ style: {}, remove() {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} } })
  const mod = modules[0].factory(requireStub)
  const injectDeclaration = CLIENT_SRC.match(/inject: \[[^\]]*\]/)
  assert.ok(injectDeclaration, 'inject 声明缺失')
  assert.ok(!injectDeclaration[0].includes('uiWorkspace'), 'uiWorkspace 不得进入 inject 列表(缺服务时会把门控放大到整个插件)')
  const ctx = {
    get(name) {
      if (name === 'sessions') return { fork: () => Promise.resolve('c1') }
      if (name === 'workspaces') return { create: async () => ({ workspace: { workspaceId: 'w1' } }) }
      return {}
    },
    effect(_fn, label) { effects.push(label) },
    slots: {
      inject: (name, register) => register(),
      register: (options, component) => registered.push({ options, component }),
    },
    get remote() { return { session: {} } },
  }
  mod.apply(ctx)
  assert.ok(effects.some((label) => String(label).includes('clone injection')), '克隆注入效应未注册')
})

test('Given list 读取轮询, When input 延迟出现/不出现, Then 轮询到返回节点/超时返回 null', async () => {
  const pollDeclared = CLIENT_SRC.match(/function defaultPoll\(query\) \{[\s\S]*?\n\}/)
  assert.ok(pollDeclared, 'client.js 必须内联声明 defaultPoll')
  const defaultPoll = new Function(pollDeclared[0] + '\nreturn defaultPoll')()
  let appearAt = 2
  let calls = 0
  const found = await defaultPoll(() => {
    calls += 1
    return calls >= appearAt ? { value: 'x' } : null
  })
  assert.ok(found, '延迟出现的节点应被轮询到')
  assert.ok(calls >= 2, '应至少轮询两次')
  const none = await defaultPoll(() => null)
  assert.equal(none, null, '永不出现应返回 null')
}, 10 * 1000)

test('Given 浏览弹窗读取当前目录, When 编辑路径输入态出现, Then 读到完整路径并派发 Escape 收起', async () => {
  const declared = CLIENT_SRC.match(/async function readBrowseCurrentPath\(card, doc, \{ poll = defaultPoll \} = \{\}\) \{[\s\S]*?\n\}/)
  assert.ok(declared, 'client.js 必须内联声明 readBrowseCurrentPath')
  const events = []
  const input = {
    value: 'C:\\Users\\u\\Desktop\\',
    dispatchEvent(event) { events.push(event.key) },
  }
  const editZone = { disabled: false, click() { events.push('click') } }
  const crumbBar = {
    querySelector(selector) {
      if (selector === 'input') return input
      if (selector.includes('_crumbEditZone')) return editZone
      return null
    },
  }
  const card = { querySelector: (selector) => (selector === '[role="navigation"]' ? { parentElement: crumbBar } : null) }
  const readBrowseCurrentPath = new Function(
    'defaultPoll',
    declared[0] + '\nreturn readBrowseCurrentPath',
  )((query) => Promise.resolve(query()))
  const doc = {}
  const value = await readBrowseCurrentPath(card, doc)
  assert.equal(value, 'C:\\Users\\u\\Desktop\\', '应读出输入态完整路径')
  assert.equal(events[0], 'click', '应先点击编辑按钮')
  if (typeof KeyboardEvent === 'function') assert.equal(events[1], 'Escape', '读取后应派发 Escape 收起官方弹窗')
})

test('Given 读取路径前置守卫, When 编辑按钮缺失或禁用, Then 返回 null 且不点击', async () => {
  const declared = CLIENT_SRC.match(/async function readBrowseCurrentPath\(card, doc, \{ poll = defaultPoll \} = \{\}\) \{[\s\S]*?\n\}/)
  const readBrowseCurrentPath = new Function(
    'defaultPoll',
    declared[0] + '\nreturn readBrowseCurrentPath',
  )(() => Promise.resolve(null))
  const crumbBar = { querySelector: () => null }
  const card = { querySelector: (selector) => (selector === '[role="navigation"]' ? { parentElement: crumbBar } : null) }
  assert.equal(await readBrowseCurrentPath(card, {}), null, '编辑按钮缺失应返回 null')
  const disabledZone = { disabled: true, click() { throw new Error('不应点击') } }
  const crumbBar2 = { querySelector: (selector) => (selector.includes('_crumbEditZone') ? disabledZone : null) }
  const card2 = { querySelector: (selector) => (selector === '[role="navigation"]' ? { parentElement: crumbBar2 } : null) }
  assert.equal(await readBrowseCurrentPath(card2, {}), null, '编辑按钮禁用应返回 null')
})

// findBrowseFooter 结构契约:footer=卡片直子末元素且至少 3 按钮,末按钮=打开,
// 前一兄弟=取消;结构漂移时返回 null(干净禁用)
function fakeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    className: 'cls-' + tag,
    disabled: false,
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === 'button' ? [] : []),
    addEventListener() {},
    insertBefore() {},
    remove() {},
    getAttribute: () => null,
    appendChild(child) { this.children.push(child); child.parentElement = this },
  }
}

test('Given 官方弹窗结构, When findBrowseFooter 逻辑, Then 定位打开与取消按钮;结构漂移返回 null', async () => {
  const declared = CLIENT_SRC.match(/function findBrowseFooter\(card\) \{[\s\S]*?\n\}/)
  assert.ok(declared, 'client.js 必须内联声明 findBrowseFooter')
  const findFooter = new Function(declared[0] + '\nreturn findBrowseFooter')()

  const openButton = fakeElement('button')
  const cancelButton = fakeElement('button')
  const gap = fakeElement('span')
  const other = fakeElement('button')
  const footer = fakeElement('div')
  footer.querySelectorAll = (selector) => (selector === 'button' ? [other, cancelButton, openButton] : [])
  footer.querySelector = (selector) => (selector === 'button:last-of-type' ? openButton : null)
  footer.lastElementChild = openButton
  openButton.previousElementSibling = cancelButton
  cancelButton.previousElementSibling = gap
  const scope = fakeElement('div')
  scope.lastElementChild = footer
  scope.parentElement = null
  const nav = fakeElement('span')
  const card = fakeElement('div')
  nav.parentElement = scope
  scope.parentElement = card
  card.querySelector = (selector) => (selector === '[role="navigation"]' ? nav : null)

  const parts = findFooter(card)
  assert.equal(parts.openButton, openButton)
  assert.equal(parts.cancelButton, cancelButton)

  const brokenCard = fakeElement('div')
  brokenCard.querySelector = () => null
  assert.equal(findFooter(brokenCard), null, '无面包屑卡片应返回 null')
  const thinFooter = fakeElement('div')
  thinFooter.querySelectorAll = () => []
  thinFooter.querySelector = () => null
  const scope2 = fakeElement('div')
  scope2.lastElementChild = thinFooter
  const nav2 = fakeElement('span')
  const thinCard = fakeElement('div')
  nav2.parentElement = scope2
  scope2.parentElement = thinCard
  thinCard.querySelector = (selector) => (selector === '[role="navigation"]' ? nav2 : null)
  assert.equal(findFooter(thinCard), null, '按钮不足 3 的 footer 应返回 null')
})
