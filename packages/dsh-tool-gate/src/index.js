// tool-gate 主行入口(apply 型):白名单 → 全局层 deferLoading 声明式收敛。
//
// 不 provide 服务、不注册工具、不拦截执行(BDD INV-5):deferred 机制全部
// 由宿主原生链路承担(wireSchemas 投影 → API defer_loading → 服务端按需
// 搜索激活,agent-loop/dsh-llm 处理会话一致性)。打标/清标只改 definition
// 的 deferLoading 字段,schema 投影每请求实时读对象,无需 emit(INV-3)。
//
// 收敛触发三点:apply 落定 / loader/volatile-update(白名单热改,现读
// volatile ref)/ tools/change(注册、注销、重注册)。每次全量重算决策,
// 只动与目标态有差异的名(幂等)。改动前记 undo journal(名字 → 原字段
// 形态),行退场按 journal 还原原状,还原前校验层内同名仍是同一 definition
// 引用,防止误改重注册后的新对象(INV-2)。
//
// enabled=false 收敛为「按 journal 全量还原并停止打标」,等效临时停用。

import { globalLayerOf } from './registry.mjs'
import { planConvergence } from './converge.mjs'
import { resolveConfigStrict, unwrapConfig } from './config.mjs'

export const name = 'tool-gate'

// settings 节注册面:宿主按行模块的 Config 导出注册 tool-gate 节
export { Config } from './config.mjs'

/**
 * 主行 apply。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object|undefined} config 行 Config(allowlist/enabled,volatile ref 容器)
 */
export function apply(ctx, config) {
  // inject ['tools'] 已门控服务在场;全局层内部面(ToolRuntime 升级即可能
  // 变化)仍须显式特性检测,不符即干净禁用,零动作不崩
  const layer = globalLayerOf(ctx.get('tools'))
  if (layer === undefined) {
    ctx.logger?.warn?.('tool-gate: ctx.tools 全局层内部结构与已知形态不符,干净禁用(零动作)')
    return
  }

  /** undo journal:名 → { definition, hadField, value };仅记录本包首次改变时的原状。 */
  const journal = new Map()

  const readConfig = () => resolveConfigStrict(unwrapConfig(config ?? {}))

  function restoreAll() {
    for (const [name, record] of journal) {
      // 层内同名已被重注册顶替(不同对象)时跳过:新对象归新注册者,不误改
      if (layer.definitionOf(name) !== record.definition) continue
      if (record.hadField) record.definition.deferLoading = record.value
      else delete record.definition.deferLoading
    }
    journal.clear()
  }

  /** 一轮声明式收敛:白名单是唯一事实源,只动与目标态有差异的名。 */
  function converge() {
    const { allowlist, enabled } = readConfig()
    if (!enabled) {
      if (journal.size > 0) {
        restoreAll()
        ctx.logger?.info?.('tool-gate: enabled=false,已还原全部原状并停止打标')
      }
      return
    }
    const { toDefer, toClear, unknownAllowlisted } = planConvergence(layer.names(), layer.definitionOf, allowlist)
    for (const name of toDefer) {
      const definition = layer.definitionOf(name)
      if (!journal.has(name)) journal.set(name, { definition, hadField: 'deferLoading' in definition, value: definition.deferLoading })
      definition.deferLoading = true
    }
    for (const name of toClear) {
      const definition = layer.definitionOf(name)
      if (!journal.has(name)) journal.set(name, { definition, hadField: 'deferLoading' in definition, value: definition.deferLoading })
      delete definition.deferLoading
    }
    if (unknownAllowlisted.length > 0) {
      ctx.logger?.warn?.(`tool-gate: 白名单未知名(未注册,拼错?): ${unknownAllowlisted.join(', ')}`)
    }
    if (toDefer.length > 0 || toClear.length > 0) {
      ctx.logger?.info?.(`tool-gate: 收敛 defer+${toDefer.length} [${toDefer.join(', ')}] clear-${toClear.length} [${toClear.join(', ')}] 白名单 ${allowlist.length} 项`)
    }
  }

  // 白名单热改:volatile-only 变更宿主换 ref 不重挂行,本行 fiber 自身 emit
  // 的事件现读 ref 重收敛(shell-select volatile 补偿同构)
  ctx.on('loader/volatile-update', converge)
  // 工具注册/注销/重注册:新对象 defer 态回原状,下一轮收敛重新归位
  ctx.on('tools/change', converge, { global: true })

  converge()
  // 行退场(禁用/卸载/重载)还原原状:系统回到「没装本包」的世界
  ctx.effect(() => () => restoreAll())
}
