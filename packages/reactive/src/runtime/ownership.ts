import type { IRuntime } from './types';
import { assertNoForeignOwnershipBrand } from './copy-check';

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
const OWNERS = new WeakMap<object, IRuntime>();

/** 登记归属。同一个对象重复登记到不同 Runtime 视为编程错误——那意味着它同时属于 两张图，之后任何一次校验都无法给出正确答案。 */
export function claimOwnership(value: object, runtime: IRuntime): void {
  const existing = OWNERS.get(value);
  if (existing && existing !== runtime) {
    throw new Error('[store] this node is already owned by another Runtime');
  }
  OWNERS.set(value, runtime);
}

/** 查归属。未登记返回 undefined——调用方据此区分「不归任何图」与「归错图」。 */
export function ownerOf(value: unknown): IRuntime | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const owner = OWNERS.get(value);
  if (owner) return owner;
  if (typeof value === 'object' && value !== null) assertNoForeignOwnershipBrand(value);
  return undefined;
}

/**
 * 断言归属。
 *
 * 未登记的对象一律放行：第三方可以把自己的普通值注册进 Registry，那不涉及图。 只有**登记过且归属不符**才是错误——那才是两张图被接在一起的那一刻。
 */
export function assertOwnedBy(value: unknown, runtime: IRuntime, what: string): void {
  const owner = ownerOf(value);
  if (owner && owner !== runtime) {
    throw new Error(`[store] ${what} belongs to a different Runtime than this scope`);
  }
}

/**
 * 内核图边界使用的严格断言。
 *
 * 普通 Registry 值可以没有 owner；真正进入依赖图的节点则必须由受信工厂登记。 否则第三方只要伪造一个 `runtime` 字段，就能把可变的 subs/version 接进图里。
 */
export function assertReactiveOwnedBy(value: object, runtime: IRuntime, what: string): void {
  const owner = OWNERS.get(value);
  if (!owner) {
    throw new Error(`[store] ${what} is not a Runtime-owned reactive node`);
  }
  if (owner !== runtime) {
    throw new Error(`[store] ${what} belongs to another Runtime`);
  }
}
