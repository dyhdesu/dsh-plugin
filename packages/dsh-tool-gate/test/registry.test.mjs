import test from 'node:test'
import assert from 'node:assert/strict'
import { globalLayerOf } from '../src/registry.mjs'

test('合法形态:投影 names 与 definitionOf', () => {
  const data = new Map([['read', { name: 'read' }]])
  const layer = globalLayerOf({ layers: { global: { tools: { data } } } })
  assert.ok(layer)
  assert.deepEqual(layer.names(), ['read'])
  assert.equal(layer.definitionOf('read'), data.get('read'))
  assert.equal(layer.definitionOf('absent'), undefined)
})

test('缺 layers → undefined(干净禁用)', () => {
  assert.equal(globalLayerOf({}), undefined)
  assert.equal(globalLayerOf(undefined), undefined)
})

test('tools.data 非 Map → undefined(宿主重构内部面)', () => {
  assert.equal(globalLayerOf({ layers: { global: { tools: { data: {} } } } }), undefined)
  assert.equal(globalLayerOf({ layers: { global: {} } }), undefined)
})
