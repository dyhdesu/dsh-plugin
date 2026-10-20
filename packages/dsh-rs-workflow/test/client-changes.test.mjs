// 源形态锁:数据刷新只走 /api/rsww/changes 长轮询总线,禁回 setInterval 短轮询;
// 例外:会话页签判定 judge 的兜底 interval(缓存短路零网络)合法保留
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('client.js 数据刷新走变更长轮询,禁数据轮询 interval', () => {
  const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
  assert.match(source, /API \+ 'changes'/, '缺 changes 长轮询端点引用')
  assert.match(source, /subscribeChanges/, '缺变更总线订阅入口')
  assert.doesNotMatch(source, /setInterval\((reload|load)\b/, '禁止数据轮询 interval(FlowView/RunCard)')
  assert.doesNotMatch(source, /LIVE_REFRESH_MS/, '运行中短轮询常量已废除,禁止回归')
  const intervalUses = [...source.matchAll(/setInterval\((\w+)/g)].map((m) => m[1])
  assert.deepEqual(intervalUses, ['judge'], '唯一合法 interval 为页签判定 judge 兜底')
})
