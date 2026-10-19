// 全局层注册表投影与特性检测(纯函数):从 ctx.tools 投影全局层工具清单。
// layers.global.tools 是 ToolRuntime 内部面(NamedEntries,data 为 Map),
// 宿主升级重构该面即特性检测失败 → 干净禁用(BDD INV-4),不做兼容层。

/**
 * 特性检测并投影全局层:返回 { names, definitionOf },结构不符返回 undefined。
 * 只读访问,不持有表引用以外的东西;definitionOf 对缺席名返回 undefined。
 * @param {object|undefined} tools 宿主 tools 服务(ToolRuntime)
 * @returns {{ names: string[], definitionOf: (name: string) => object|undefined }|undefined}
 */
export function globalLayerOf(tools) {
  const data = tools?.layers?.global?.tools?.data
  if (!(data instanceof Map)) return undefined
  return {
    names: () => [...data.keys()],
    definitionOf: (name) => data.get(name),
  }
}
