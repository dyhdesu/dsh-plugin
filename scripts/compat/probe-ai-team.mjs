// ai-team L3 HTTP 探针:token 铸 cookie → board/中断/诊断断言。用法: node probe-ai-team.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const work = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.compat', '0.2.0-rc.2')
const live = JSON.parse(readFileSync(join(work, 'live.json'), 'utf8'))
const base = `http://127.0.0.1:${live.port}`
const origin = base

// token URL 302 铸 cookie
const mint = await fetch(`${base}/?token=${live.token}`, { redirect: 'manual' })
const setCookie = mint.headers.getSetCookie?.() ?? []
const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
console.log('mint status', mint.status, 'cookie len', cookie.length)

const headers = { cookie, origin, referer: `${base}/` }

async function get(path) {
  const res = await fetch(base + path, { headers })
  return { status: res.status, body: await res.text() }
}
async function post(path, payload) {
  const res = await fetch(base + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  return { status: res.status, body: await res.text() }
}

const results = {}
results.board = await get('/api/ai-team/board')
results.interruptGlobal = await post('/api/ai-team/interrupt', { global: true })
results.boardAfter = await get('/api/ai-team/board')
results.diagnostics = await get('/api/diagnostics')
results.activation = await get('/api/activation')

console.log('board', results.board.status, results.board.body.slice(0, 300))
console.log('interruptGlobal', results.interruptGlobal.status, results.interruptGlobal.body.slice(0, 200))
console.log('boardAfter globalStopped', JSON.parse(results.boardAfter.body).control?.globalStopped)
console.log('activation broken', (() => { try { const a = JSON.parse(results.activation.body); return JSON.stringify(a.brokenPlugins ?? a.broken ?? null) } catch { return 'parse-fail' } })())

writeFileSync(join(work, 'probe-ai-team-out.json'), JSON.stringify(results, null, 2))
