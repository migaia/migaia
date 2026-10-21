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
 * Creates a family of definitions keyed by identity.
 *
 * The legacy `atomFamily` caches instances bound to a `Runtime`. The same key therefore shares
 * state across scopes and its instances cannot be reused across scopes.
 *
 * A definition family caches pure tokens without state or a runtime. Each scope caches its own
 * graph nodes and values. `chatFamily('conv-1')` returns the same token in every scope, while each
 * scope has its own value. This supports per-conversation state.
 */

export type IFamilyKey = string | number | symbol

/**
 * Options of `familyDef`/`derivedFamilyDef`: `maxSize` bounds the strong cache (default 4096),
 * `debugLabel` names the produced definitions.
 */
export type IFamilyDefOptions = {
  /**
   * Limits the strong definition cache. Entries least recently accessed become weak references when
   * the limit is exceeded.
   *
   * Tokens retained by an `AtomStore` or component keep canonical identity for their key. A later
   * lookup can create a new definition only after the old token becomes unreachable and is
   * collected.
   */
  readonly maxSize?: number
  readonly debugLabel?: string
}

/**
 * Preserves the definition type produced by this family.
 *
 * `familyDef` produces writable definitions. Widening them to `IAtomDefinition` would reject
 * `scope.set(family(key), ...)`.
 */
export type IFamilyDef<
  K extends IFamilyKey,
  T,
  D extends IAtomDefinition<T> = IAtomDefinition<T>
> = {
  (key: K): D
  /** Reports the number of strongly cached definitions. */
  readonly size: number
  /**
   * Explicitly breaks canonical identity for a key. Existing instances remain unchanged. Later
   * lookups return a new token, so callers must stop using the old token first.
   */
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

/** Creates writable source definitions by key. */
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

/** Creates read-only derived definitions by key. */
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
