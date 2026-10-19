// 降级折叠决策(纯函数):缝上请求 tools → 目标 tools(BDD INV-10/11)。
// 三重透传门:空表原样;任一工具带 deferLoading 标(capable 路由原生投影
// 产物,见标即透传)→ 原样;与 deferred 名集无交集 → 原引用零拷贝。
// 命中时折叠为名字占位而非剔除:生成端(API tools 列表)必须可见名字,模型
// 才能产生正确调用名,宿主按名执行 registry 完整定义;剔除会让模型把调用
// 意图收敛到语义最近的白名单工具(真机实证:web_fetch → web_search)。
// 占位不带 deferLoading 键,投影幂等(值等价)。tool_search 永不入 deferred
// 名集(隐式白名单由收敛与 deferredNames 读取端共同保证)。

// 折叠入口工具名:隐式白名单成员(收敛不打标,deferred 名集读取端跳过)
export const TOOL_SEARCH_NAME = 'tool_search'

// 占位描述常量:值逐请求稳定(prompt cache 友好),引导先检索再调用
export const DEFERRED_PLACEHOLDER_DESCRIPTION = '延迟加载工具:调用前先用 tool_search 以本工具名作正则检索完整定义与参数说明,再按检索到的 schema 调用。'

/** dsh ToolSchema 最小占位形态(pi-ai 仅消费 name/description/parameters)。 */
function placeholderOf(name) {
  return { name, description: DEFERRED_PLACEHOLDER_DESCRIPTION, parameters: { type: 'object', properties: {} } }
}

/**
 * @param {Array<{name: string, deferLoading?: true}>|undefined} tools 缝上请求 tools(dsh ToolSchema 形态)
 * @param {Set<string>} deferredNames registry 现读 deferred 名集
 * @returns {{ tools: unknown, folded: string[], native: boolean }}
 *   native = 检测到 deferLoading 标(原生 toolUpdate 流程在管),调用方透传。
 */
export function planRequestTools(tools, deferredNames) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, folded: [], native: false }
  if (tools.some((tool) => tool?.deferLoading === true)) return { tools, folded: [], native: true }
  const folded = tools.filter((tool) => deferredNames.has(tool?.name)).map((tool) => tool.name)
  if (folded.length === 0) return { tools, folded, native: false }
  const foldedSet = new Set(folded)
  return { tools: tools.map((tool) => (foldedSet.has(tool?.name) ? placeholderOf(tool.name) : tool)), folded, native: false }
}
