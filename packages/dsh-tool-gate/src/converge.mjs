// 收敛决策(纯函数):白名单 → 全局层每个工具的目标 defer 态。
// 白名单是唯一事实源:白名单内清标(覆盖插件作者自带声明,用户意图优先),
// 白名单外打标;与现状相同的名不出现在决策里(幂等,只动差异)。

/**
 * 计算一轮收敛决策。
 * @param {string[]} names 全局层当前工具名清单
 * @param {(name: string) => object|undefined} definitionOf 名 → definition
 * @param {string[]} allowlist 白名单(精确名匹配)
 * @returns {{ toDefer: string[], toClear: string[], unknownAllowlisted: string[] }}
 *   toDefer = 需打标(白名单外且当前非 true);toClear = 需清标(白名单内且
 *   当前为 true,不论谁打的);unknownAllowlisted = 白名单内未注册名
 */
export function planConvergence(names, definitionOf, allowlist) {
  const registered = new Set(names)
  const allowed = new Set(allowlist)
  const toDefer = []
  const toClear = []
  for (const name of names) {
    const deferred = definitionOf(name)?.deferLoading === true
    if (allowed.has(name)) {
      if (deferred) toClear.push(name)
    } else if (!deferred) {
      toDefer.push(name)
    }
  }
  const unknownAllowlisted = allowlist.filter((name) => !registered.has(name))
  return { toDefer, toClear, unknownAllowlisted }
}
