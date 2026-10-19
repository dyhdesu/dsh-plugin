// tool-gate 主行入口(apply 型):白名单 → 全部工具层 deferLoading 声明式收敛。
//
// 不 provide 服务、不注册工具、不拦截执行(BDD INV-5):deferred 机制全部
// 由宿主原生链路承担(wireSchemas 投影 → API defer_loading → 服务端按需
// 搜索激活,agent-loop/dsh-llm 处理会话一致性)。打标/清标只改 definition
// 的 deferLoading 字段,schema 投影每请求实时读对象,无需 emit(INV-3)。
//
// 收敛面 = 全局层 + 全部 per-agent scope 层(宿主 0.2 模型可见工具多注册在
// agent 面,全局层近乎恒空,真机实证);scoped 层随 agent 动态生灭,每轮
// 收敛现读层清单,新层的首收敛由其注册触发的 tools/change 驱动。
//
// 收敛触发三点:apply 落定 / loader/volatile-update(白名单热改,现读
// volatile ref)/ tools/change(注册、注销、重注册)。每次全量重算决策,
// 只动与目标态有差异的名(幂等)。改动前记 undo journal(层键+名 → 原字段
// 形态),行退场按 journal 还原原状,还原前校验层内同名仍是同一 definition
// 引用,防止误改重注册后的新对象(INV-2);层已随 agent 销毁时 definition
// 引用仍在,改无人观察的对象,无害。
//
// enabled=false 收敛为「按 journal 全量还原并停止打标」,等效临时停用。

import { toolLayersOf } from './registry.mjs'
import { planConvergence } from './converge.mjs'
import { resolveConfigStrict, unwrapConfig } from './config.mjs'

export const name = 'tool-gate'

// inject 声明式门控:行 fiber 等 tools 服务在场才 apply(ctx.get 即时解析在
// 行挂载时刻早于服务可达,真机实证 undefined → 误判干净禁用;宿主行模块
// inject 同 web-routes 先例,服务缺失即保持未激活,即干净禁用)
export const inject = ['tools']

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
  const store = toolLayersOf(ctx.get('tools'))
  if (store === undefined) {
    ctx.logger?.warn?.('tool-gate: ctx.tools 层结构与已知形态不符,干净禁用(零动作)')
    return
  }

  /**
   * undo journal:层数据表(Map 引用)→ 名 → { definition, hadField, value };
   * 仅记录首次改变时的原状。层键是对象引用,直接作 Map 键,禁止字符串化
   * (对象 String 化坍缩 '[object Object]' 串层,真机实证)。
   */
  const journal = new Map()

  const readConfig = () => resolveConfigStrict(unwrapConfig(config ?? {}))

  function restoreAll() {
    for (const [data, records] of journal) {
      const layer = store.layers().find((candidate) => candidate.key === data)
      if (layer === undefined) continue
      for (const [name, record] of records) {
        if (layer.definitionOf(name) !== record.definition) continue
        if (record.hadField) record.definition.deferLoading = record.value
        else delete record.definition.deferLoading
      }
    }
    journal.clear()
  }

  /** 取(或建)该层的原状记录表。 */
  function journalOf(layer) {
    let records = journal.get(layer.key)
    if (records === undefined) {
      records = new Map()
      journal.set(layer.key, records)
    }
    return records
  }

  /** 一轮声明式收敛:白名单是唯一事实源,逐层只动与目标态有差异的名。 */
  function converge() {
    const { allowlist, enabled } = readConfig()
    if (!enabled) {
      if (journal.size > 0) {
        restoreAll()
        ctx.logger?.info?.('tool-gate: enabled=false,已还原全部原状并停止打标')
      }
      return
    }
    const layers = store.layers()
    const { perLayer, unknownAllowlisted } = planConvergence(layers, allowlist)
    let deferred = 0
    let cleared = 0
    for (const plan of perLayer) {
      const layer = layers.find((candidate) => candidate.key === plan.key)
      const records = journalOf(layer)
      for (const name of plan.toDefer) {
        const definition = layer.definitionOf(name)
        if (!records.has(name)) records.set(name, { definition, hadField: 'deferLoading' in definition, value: definition.deferLoading })
        definition.deferLoading = true
        deferred += 1
      }
      for (const name of plan.toClear) {
        const definition = layer.definitionOf(name)
        if (!records.has(name)) records.set(name, { definition, hadField: 'deferLoading' in definition, value: definition.deferLoading })
        delete definition.deferLoading
        cleared += 1
      }
    }
    if (unknownAllowlisted.length > 0) {
      ctx.logger?.warn?.(`tool-gate: 白名单未知名(全部层未注册,拼错?): ${unknownAllowlisted.join(', ')}`)
    }
    if (deferred > 0 || cleared > 0) {
      ctx.logger?.info?.(`tool-gate: 收敛 defer+${deferred} clear-${cleared} 层 ${layers.length} 白名单 ${allowlist.length} 项`)
    }
  }

  // 白名单热改:volatile-only 变更宿主换 ref 不重挂行,本行 fiber 自身 emit
  // 的事件现读 ref 重收敛(shell-select volatile 补偿同构)
  ctx.on('loader/volatile-update', converge)
  // 工具注册/注销/重注册(含 scoped 层新注册):新对象 defer 态回原状,
  // 下一轮收敛重新归位
  ctx.on('tools/change', converge, { global: true })

  converge()
  // 行退场(禁用/卸载/重载)还原原状:系统回到「没装本包」的世界
  ctx.effect(() => () => restoreAll())
}
