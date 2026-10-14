import type { IRuntime } from './types.js'
import { assertNoForeignOwnershipBrand } from './copy-check.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

/**
 * 唯一所有权登记。
 *
 * 此前所有权是靠字段名猜的：Store 叫 `$runtime`，Atom 叫 `runtime`，Resource、 Collection、Wasm Field 各有各的形状。于是
 * `provider-registry` 里那句 `if (!('$runtime' in value)) return undefined` 让所有非 Store 的东西**直接跳过
 * 了检查**——把另一个 Runtime 的 Atom 注册进 Registry 不会报错，两张图就此串在一起。
 *
 * 改成一张 WeakMap：谁创建、谁登记，查询只有这一条路。新增节点类型不需要改查询侧， 也不可能因为字段起错名而静默绕过。
 *
 * WeakMap 仍是归属权威。跨副本品牌只在显式诊断边界登记；普通节点构造不触碰全局 Symbol 注册表，避免把部署诊断成本放进热路径。
 */
const OWNERS = new WeakMap<object, IRuntime>()

/**
 * Registers ownership. Assigning one object to different runtimes is a programming error because it
 * would belong to two graphs.
 */
export function claimOwnership(value: object, runtime: IRuntime): void {
  const existing = OWNERS.get(value)
  if (existing && existing !== runtime) {
    throw createReactiveError(
      ReactiveErrorCode.ownershipConflict,
      ReactiveErrorText.ownershipConflict
    )
  }
  OWNERS.set(value, runtime)
}

/**
 * Returns ownership, or `undefined` for an unregistered value. Callers can distinguish no graph
 * ownership from incorrect ownership.
 */
export function ownerOf(value: unknown): IRuntime | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const owner = OWNERS.get(value)
  if (owner) return owner
  if (typeof value === 'object' && value !== null) assertNoForeignOwnershipBrand(value)
  return undefined
}

/**
 * Asserts ownership for values registered with a runtime.
 *
 * Unregistered values are accepted because third-party ordinary registry values do not join the
 * graph. Only registered values with a different owner fail, preventing two graphs from being
 * joined.
 */
export function assertOwnedBy(value: unknown, runtime: IRuntime, what: string): void {
  const owner = ownerOf(value)
  if (owner && owner !== runtime) {
    throw createReactiveError(
      ReactiveErrorCode.crossRuntime,
      ReactiveErrorText.belongsToDifferentRuntime(what)
    )
  }
}

/**
 * Strict ownership assertion at kernel graph boundaries.
 *
 * Ordinary registry values may lack an owner. Nodes entering the dependency graph require trusted
 * registration. A fabricated `runtime` field cannot attach mutable `subs` or `version` state to the
 * graph.
 */
export function assertReactiveOwnedBy(value: object, runtime: IRuntime, what: string): void {
  const owner = OWNERS.get(value)
  if (!owner) {
    throw createReactiveError(
      ReactiveErrorCode.notRuntimeOwned,
      ReactiveErrorText.notRuntimeOwned(what)
    )
  }
  if (owner !== runtime) {
    throw createReactiveError(
      ReactiveErrorCode.crossRuntime,
      ReactiveErrorText.belongsToAnotherRuntime(what)
    )
  }
}
