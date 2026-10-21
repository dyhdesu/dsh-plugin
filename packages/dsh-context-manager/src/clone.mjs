// 克隆仓库纯逻辑:URL→目录名推导、请求校验、git 参数构造与克隆执行。
// 全部依赖注入(spawn/exists/now),无模块级可变状态;错误一律抛中文业务
// Error(无错误码),由路由层原样透传。

import { join, isAbsolute, basename } from 'node:path'

// 克隆整体超时:大仓库完整克隆的真实上界;超时树杀并按业务错误透出
export const CLONE_TIMEOUT_MS = 30 * 60 * 1000
// 失败时透出的 stderr 尾部行数:git 的错误说明集中在输出末尾
export const STDERR_TAIL_LINES = 6
// git 在 PATH 缺失时 spawn 抛 ENOENT,收敛为可行动文案
export const GIT_MISSING_MESSAGE = 'git 不可用:未安装或不在宿主 PATH 中'

// 远程仓库地址形态:https/http/ssh/git 协议与 git@host:path scp 语法;
// 本地路径与 file:// 不收(克隆来源限定远程,防与目录选择语义混淆)
const REMOTE_URL_RE = /^(?:https?|ssh|git):\/\/\S+|^git@[^\s:/]+:[^\s]+$/

// 从远程地址推导默认目录名:去 .git 后缀与首尾空白;推导不出非空名即失败,
// 由调用方要求用户手填
export function deriveRepoName(rawUrl) {
  const url = String(rawUrl ?? '').trim()
  if (url === '') throw new Error('仓库地址不能为空')
  let tail = url
  const scp = /^git@[^:]+:(.+)$/.exec(url)
  if (scp) tail = scp[1]
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) tail = stripProtocol(url)
  tail = tail.replace(/\/+$/, '')
  const name = basename(tail).replace(/\.git$/i, '').trim()
  if (name === '' || name === '.' || name === '..') throw new Error('无法从仓库地址推导目录名,请手动填写')
  return name
}

function stripProtocol(url) {
  return url.slice(url.indexOf('://') + 3)
}

// 请求解析与校验:parent 必须为已存在的绝对目录,name 缺省由 URL 推导且必须是
// 单个路径段;返回 target 绝对路径。statParent/existsTarget 注入以便测试与路由
// 层共用同一校验形态
export async function resolveCloneRequest(body, { homedirPath, existsTarget, statParent }) {
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (url === '') throw new Error('仓库地址不能为空')
  if (url.startsWith('-')) throw new Error('仓库地址不合法')
  if (!REMOTE_URL_RE.test(url)) throw new Error('仓库地址必须是 http(s)/ssh/git 远程地址或 git@ 形式')

  const parent = typeof body?.parent === 'string' ? body.parent.trim() : ''
  if (parent === '') throw new Error('父目录不能为空')
  const expanded = expandHome(parent, homedirPath)
  if (!isAbsolute(expanded)) throw new Error('父目录必须是绝对路径')
  if (!(await statParent(expanded))) throw new Error('父目录不存在或不是目录:' + expanded)

  const name = typeof body?.name === 'string' && body.name.trim() !== ''
    ? body.name.trim()
    : deriveRepoName(url)
  if (name === '.' || name === '..' || /[/\\]/.test(name)) throw new Error('目录名必须是单个路径段')

  const target = join(expanded, name)
  if (await existsTarget(target)) throw new Error('目标目录已存在:' + target)
  return { url, parent: expanded, name, shallow: body?.shallow === true, target }
}

// 父目录支持 ~ 前缀(客户端记忆值跨机器迁移时宿主侧展开);~ 单独出现或 ~/ 开头
function expandHome(pathValue, homedirPath) {
  if (!homedirPath) return pathValue
  if (pathValue === '~') return homedirPath
  if (pathValue.startsWith('~/') || pathValue.startsWith('~\\')) return join(homedirPath, pathValue.slice(2))
  return pathValue
}

// git 参数:选项必须在 `--` 之前,`--` 之后才是 url 与目标目录(url 以 `-` 开头
// 的注入形态已被校验拦截,`--` 兜底)
export function buildCloneArgs({ url, target, shallow }) {
  return ['clone', ...(shallow ? ['--depth', '1'] : []), '--', url, target]
}

// 克隆执行:spawn 注入(node:child_process.spawn 兼容形态),收集 stderr 尾部,
// ENOENT 收敛为 GIT_MISSING_MESSAGE,非零退出透出 stderr 尾巴,超时树杀
export function runClone({ url, target, parent, shallow, spawn, timeoutMs = CLONE_TIMEOUT_MS, treeKill }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('git', buildCloneArgs({ url, target, shallow }), { cwd: parent })
    } catch (error) {
      reject(error && error.code === 'ENOENT' ? new Error(GIT_MISSING_MESSAGE) : error)
      return
    }
    let settled = false
    let stderrText = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        treeKill(child.pid)
      } catch {
        child.kill()
      }
      reject(new Error('克隆超时(超过 ' + Math.round(timeoutMs / (60 * 1000)) + ' 分钟),已终止'))
    }, timeoutMs)
    child.stderr?.setEncoding?.('utf8')
    child.stderr?.on?.('data', (chunk) => {
      stderrText += chunk
      if (stderrText.length > 64 * 1024) stderrText = stderrText.slice(-32 * 1024)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error && error.code === 'ENOENT' ? new Error(GIT_MISSING_MESSAGE) : error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ path: target })
        return
      }
      reject(new Error(cloneFailureMessage(stderrText)))
    })
  })
}

export function tailLines(text, lines) {
  const parts = String(text ?? '').split(/\r?\n/).filter((line) => line.trim() !== '')
  return parts.slice(-lines).join('\n')
}

function cloneFailureMessage(stderrText) {
  const tail = tailLines(stderrText, STDERR_TAIL_LINES)
  return tail !== '' ? '克隆失败:\n' + tail : '克隆失败(git 非零退出,无错误输出)'
}
