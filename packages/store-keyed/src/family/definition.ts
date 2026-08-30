import {
  atomDefFactory,
  derivedDef,
  type IAtomDefinition,
  type IAtomGet,
  type IWritableAtomDefinition
} from '../atom/definition.js'
import {
  createStoreKeyedError,
  createStoreKeyedRangeError,
  StoreKeyedErrorCode
} from '../errors.js'
import { StoreKeyedErrorText } from '../error-text.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/**
 * 按键产出**定义**的 family。
 *
 * 旧的 `atomFamily` 缓存的是已经绑死 Runtime 的实例，所以同一个 key 在两个 Scope 下拿到的是同一份状态——这正是「family 返回的东西不能跨 Scope
 * 复用」的原因。
 *
 * 定义化之后分工清楚：
 *
 * - **family 缓存定义**（纯 token，无状态、无 Runtime）
 * - **Scope 缓存实例**（真正的图节点与值） 于是 `chatFamily('conv-1')` 在任何 Scope 里都是同一个 token，但每个 Scope 各有 一份值。AI 对话里
 *   per-conversation 的状态正是这个形状。
 */

export type IFamilyKey = string | number | symbol

export type IFamilyDefOptions = {
  /**
   * 定义强缓存的上限。达到上限后按最久未取用降级为弱引用。
   *
   * 仍被 AtomStore/组件持有的 token 会保持同 key 的 canonical identity；只有 token 已不可达且被 GC 后，后续 lookup 才可能创建新定义。
   */
  readonly maxSize?: number
  readonly debugLabel?: string
}

/**
 * D 是这个 family 产出的定义类型。
 *
 * 不能写死成 IAtomDefinition：familyDef 产出的是**可写**定义，写死会让 `scope.set(family(key), ...)`
 * 在类型层被拒——类型在这里必须如实说话。
 */
export type IFamilyDef<
  K extends IFamilyKey,
  T,
  D extends IAtomDefinition<T> = IAtomDefinition<T>
> = {
  (key: K): D
  /** 已缓存的定义数。 */
  readonly size: number
  /** 显式破坏某个键的 canonical identity。已建实例不受影响；同 key 后续 lookup 会得到新 token，因此调用方必须先停止使用旧 token。 */
  forget(key: K): boolean
  clear(): void
}

type IDefinitionCache<K extends IFamilyKey, D extends object> = {
  lookup(key: K): D
  readonly size: number
  forget(key: K): boolean
  clear(): void
}

/**
 * Keep canonical identity weakly after an entry leaves the strong LRU.
 *
 * AtomStore instances strongly retain definition tokens. Returning a new token for the same logical
 * key while an old token is still live would split one key into two independent states. The weak
 * canonical table prevents that without turning the strong cache into an unbounded map.
 */
function createDefinitionCache<K extends IFamilyKey, D extends object>(
  maxSize: number,
  create: (key: K) => D
): IDefinitionCache<K, D> {
  if (typeof WeakRef !== 'function' || typeof FinalizationRegistry !== 'function') {
    throw createStoreKeyedError(StoreKeyedErrorCode.envUnsupported, StoreKeyedErrorText.weakRef)
  }
  const entries = new Map<K, D>()
  const canonical = new Map<K, WeakRef<D>>()
  const finalizer = new FinalizationRegistry<{
    readonly key: K
    readonly reference: WeakRef<D>
  }>(({ key, reference }) => {
    if (canonical.get(key) === reference) canonical.delete(key)
  })

  const touch = (key: K, value: D): D => {
    entries.delete(key)
    entries.set(key, value)
    if (entries.size > maxSize) {
      const oldest = entries.keys().next()
      if (!oldest.done) {
        entries.delete(oldest.value)
      }
    }
    return value
  }

  const lookup = (key: K): D => {
    const strong = entries.get(key)
    if (strong) return touch(key, strong)
    const reference = canonical.get(key)
    const weak = reference?.deref()
    if (weak) return touch(key, weak)
    if (reference) canonical.delete(key)

    const created = create(key)
    const createdReference = new WeakRef(created)
    canonical.set(key, createdReference)
    finalizer.register(created, { key, reference: createdReference }, created)
    return touch(key, created)
  }

  return {
    lookup,
    get size() {
      return entries.size
    },
    forget(key) {
      const reference = canonical.get(key)
      const value = entries.get(key) ?? reference?.deref()
      if (!reference && !entries.has(key)) return false
      entries.delete(key)
      canonical.delete(key)
      if (value) finalizer.unregister(value)
      return true
    },
    clear() {
      for (const reference of canonical.values()) {
        const value = reference.deref()
        if (value) finalizer.unregister(value)
      }
      entries.clear()
      canonical.clear()
    }
  }
}

/** 按键产出可写源定义。 */
export function familyDef<K extends IFamilyKey, T>(
  initial: (key: K) => T,
  options: IFamilyDefOptions = {}
): IFamilyDef<K, T, IWritableAtomDefinition<T>> {
  if (options === null || typeof options !== 'object') {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity
    )
  }
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity,
      { cause: descriptorSnapshot.error }
    )
  }
  let maxSize: number | undefined
  let debugLabel: string | undefined
  try {
    ;({ maxSize, debugLabel } = options)
  } catch (error) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity,
      { cause: error }
    )
  }
  maxSize ??= 4096
  debugLabel ??= 'family'
  if (typeof debugLabel !== 'string') {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyLabel
    )
  }
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity
    )
  }
  const cache = createDefinitionCache<K, IWritableAtomDefinition<T>>(maxSize, (key) =>
    atomDefFactory(() => initial(key), `${debugLabel}[${String(key)}]`)
  )

  const family = ((key: K) => cache.lookup(key)) as IFamilyDef<K, T, IWritableAtomDefinition<T>>
  Object.defineProperty(family, 'size', { get: () => cache.size })
  ;(family as { forget: (key: K) => boolean }).forget = (key) => cache.forget(key)
  ;(family as { clear: () => void }).clear = () => cache.clear()
  return family
}

/** 按键产出只读派生定义。 */
export function derivedFamilyDef<K extends IFamilyKey, T>(
  read: (key: K) => (get: IAtomGet) => T,
  options: IFamilyDefOptions = {}
): IFamilyDef<K, T> {
  if (options === null || typeof options !== 'object') {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity
    )
  }
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity,
      { cause: descriptorSnapshot.error }
    )
  }
  let maxSize: number | undefined
  let debugLabel: string | undefined
  try {
    ;({ maxSize, debugLabel } = options)
  } catch (error) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity,
      { cause: error }
    )
  }
  maxSize ??= 4096
  debugLabel ??= 'derived-family'
  if (typeof debugLabel !== 'string') {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyLabel
    )
  }
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity
    )
  }
  const cache = createDefinitionCache<K, IAtomDefinition<T>>(maxSize, (key) =>
    derivedDef(read(key), `${debugLabel}[${String(key)}]`)
  )

  const family = ((key: K) => cache.lookup(key)) as IFamilyDef<K, T>
  Object.defineProperty(family, 'size', { get: () => cache.size })
  ;(family as { forget: (key: K) => boolean }).forget = (key) => cache.forget(key)
  ;(family as { clear: () => void }).clear = () => cache.clear()
  return family
}
