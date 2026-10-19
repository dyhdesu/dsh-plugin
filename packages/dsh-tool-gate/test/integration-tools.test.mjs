// 集成测试:真 cordis + dsh-tools + dsh-system-prompt,锁定官方 deferLoading
// 投影行为(SC-10):deferred 工具的 schema 产物带 deferLoading、白名单内不带、
// 可见性不变(defer 不改 view().visible,只改声明形态)。同时覆盖真 cordis
// 行挂载下的行模块(apply/Config)装载与本包收敛链路。

import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import * as row from '../src/index.js'

function makeTool(name) {
  return defineTool({
    name,
    description: `${name} fixture`,
    parameters: {},
    output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [{ type: 'text', text: name }] },
    async execute() {
      return {}
    },
  })
}

async function boot(toolNames, allowlist) {
  const root = new Context()
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  const registered = new Map()
  for (const name of toolNames) {
    const definition = makeTool(name)
    root.tools.register(definition)
    registered.set(name, definition)
  }
  const fiber = await root.plugin(row, { allowlist })
  if (fiber?.state !== 2) {
    throw new Error(`tool-gate 行未激活 state=${fiber?.state}`)
  }
  return { root, registered, fiber }
}

test('SC-10 官方投影:deferred 带标,白名单内不带,可见性不变', async () => {
  const { root, registered } = await boot(['read', 'web_search'], ['read'])
  assert.equal(registered.get('web_search').deferLoading, true)
  assert.equal('deferLoading' in registered.get('read'), false)

  const schemaOf = (name) => root.tools.schemaOf(registered.get(name), false)
  assert.equal(schemaOf('web_search').deferLoading, true)
  assert.equal(schemaOf('read').deferLoading, undefined)

  assert.ok(root.tools.get('web_search'))
  assert.ok(root.tools.get('read'))

  const wire = root.tools.wireSchemas(undefined)
  assert.deepEqual([...wire.knownNames].sort(), ['read', 'web_search'])
  assert.ok(wire.schemas.some((schema) => schema.name === 'web_search' && schema.deferLoading === true))
})

test('行模块在真 cordis 下装载并按 Config 收敛', async () => {
  const { root, registered } = await boot(['read', 'web_search', 'todo_write'], ['read'])
  assert.equal(registered.get('web_search').deferLoading, true)
  assert.equal(registered.get('todo_write').deferLoading, true)
  assert.equal('deferLoading' in registered.get('read'), false)
})

test('SC-6 行退场还原:真 cordis dispose 后回到原状', async () => {
  const { root, registered, fiber } = await boot(['read', 'web_search'], ['read'])
  assert.equal(registered.get('web_search').deferLoading, true)
  await fiber.dispose()
  assert.equal('deferLoading' in registered.get('web_search'), false)
  void root
})

test('SC-5 真宿主重注册:tools/change 驱动重收敛', async () => {
  const { root, registered } = await boot(['read'], ['read'])
  const replacement = makeTool('web_search')
  root.tools.register(replacement)
  assert.equal(replacement.deferLoading, true)
})
