import test from 'node:test'
import assert from 'node:assert/strict'
import { planConvergence } from '../src/converge.mjs'

const defs = (map) => {
  const data = new Map(Object.entries(map))
  return [(name) => [...data.keys()], (name) => data.get(name)]
}

test('白名单内外分野:内清外打(SC-1)', () => {
  const [names, definitionOf] = defs({
    read: { name: 'read' },
    shell: { name: 'shell' },
    web_search: { name: 'web_search' },
  })
  assert.deepEqual(planConvergence(names(), definitionOf, ['read', 'shell']), {
    toDefer: ['web_search'],
    toClear: [],
    unknownAllowlisted: [],
  })
})

test('覆盖作者声明:白名单命中即清自带 defer(SC-2)', () => {
  const [names, definitionOf] = defs({
    read: { name: 'read' },
    web_search: { name: 'web_search', deferLoading: true },
  })
  assert.deepEqual(planConvergence(names(), definitionOf, ['web_search']), {
    toDefer: ['read'],
    toClear: ['web_search'],
    unknownAllowlisted: [],
  })
})

test('幂等:已处目标态的名不出现在决策里', () => {
  const [names, definitionOf] = defs({
    read: { name: 'read' },
    web_search: { name: 'web_search', deferLoading: true },
  })
  assert.deepEqual(planConvergence(names(), definitionOf, ['read']), {
    toDefer: [],
    toClear: [],
    unknownAllowlisted: [],
  })
})

test('deferLoading: false 视为未打标,进 toDefer', () => {
  const [names, definitionOf] = defs({ odd: { name: 'odd', deferLoading: false } })
  assert.deepEqual(planConvergence(names(), definitionOf, []), {
    toDefer: ['odd'],
    toClear: [],
    unknownAllowlisted: [],
  })
})

test('白名单未注册名进 unknownAllowlisted(SC-8)', () => {
  const [names, definitionOf] = defs({ read: { name: 'read' } })
  assert.deepEqual(planConvergence(names(), definitionOf, ['read', 'no_such_tool']), {
    toDefer: [],
    toClear: [],
    unknownAllowlisted: ['no_such_tool'],
  })
})

test('空白名单 = 全部 defer', () => {
  const [names, definitionOf] = defs({ a: { name: 'a' }, b: { name: 'b' } })
  assert.deepEqual(planConvergence(names(), definitionOf, []), {
    toDefer: ['a', 'b'],
    toClear: [],
    unknownAllowlisted: [],
  })
})
