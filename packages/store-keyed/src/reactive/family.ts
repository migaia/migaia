import { defaultRuntime } from '@migaia/reactive'
import type { IComputedValue, IDisposable, IRuntime } from '@migaia/reactive'
import type { IComputedConfig } from '@migaia/reactive/reactive/computed.class'
import {
  createStoreKeyedAggregateError,
  createStoreKeyedError,
  createStoreKeyedRangeError,
  StoreKeyedErrorCode
} from '../errors.js'
import { StoreKeyedErrorText } from '../error-text.js'

/** Maximum delay accepted by Web/Node timers; longer TTLs are re-armed in segments. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Keys with deterministic Map/LRU semantics and no accidental object retention. */
export type IFamilyKey = string | number | bigint | boolean | symbol | null | undefined | object

export type IFamilyOptions = {
  /** Maximum unobserved entries retained. Observed entries are never auto-evicted. */
  maxSize?: number
  /** Entry lifetime from creation, in milliseconds. Defaults to Infinity. */
  ttl?: number
  /** Injectable monotonic-ish wall clock for deterministic tests. */
  now?: () => number
}

export type IFamily<K extends IFamilyKey, V extends IDisposable> = {
  (key: K): V
  get(key: K): V
  peek(key: K): V | undefined
  has(key: K): boolean
  /** Explicitly force-dispose an entry, including an observed one. */
  remove(key: K): boolean
  clear(): void
  prune(): number
  dispose(): void
  readonly disposed: boolean
  /** Number of currently reachable entries; object-key entries are GC eventual. */
  readonly size: number
}

type IFamilyEntry<V> = {
  value: V
  expiresAt: number
  lastAccess: number
  key: IFamilyKey | WeakRef<object>
  weak: boolean
}

type IFamilyNodeOptions<K extends IFamilyKey, V extends IDisposable> = IFamilyOptions & {
  create(key: K): V
  isObserved(value: V): boolean
}

type INormalizedFamilyOptions = {
  readonly maxSize: number
  readonly ttl: number
  readonly now: (() => number) | undefined
}

function validateOptions(options: IFamilyOptions): INormalizedFamilyOptions {
  if (options === null || typeof options !== 'object') {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity
    )
  }
  let maxSize: number | undefined
  let ttl: number | undefined
  let now: (() => number) | undefined
  try {
    maxSize = options.maxSize
    ttl = options.ttl
    now = options.now
  } catch (error) {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity,
      { cause: error }
    )
  }
  ttl ??= Infinity
  if (maxSize !== undefined && (!Number.isSafeInteger(maxSize) || maxSize < 1)) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCapacity
    )
  }
  if (typeof ttl !== 'number' || (ttl !== Infinity && (!Number.isFinite(ttl) || ttl < 0))) {
    throw createStoreKeyedRangeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyTtl
    )
  }
  if (now !== undefined && typeof now !== 'function') {
    throw createStoreKeyedError(StoreKeyedErrorCode.invalidOption, StoreKeyedErrorText.familyNow)
  }
  return { maxSize: maxSize ?? Infinity, ttl, now }
}

/** Reports timer cleanup failures without allowing a hostile reporter to escape the timer. */
function reportFamilyTimerFailure(error: unknown): void {
  try {
    defaultRuntime.reportError(error, { phase: 'async-flush' })
    return
  } catch (reporterError) {
    const host = (globalThis as { reportError?: (value: unknown) => void }).reportError
    try {
      if (host) host(reporterError)
      else console.error(reporterError)
    } catch {
      // No diagnostic sink may turn an asynchronous cleanup report into an uncaught exception.
    }
  }
}

/**
 * Primitive keys use a deterministic Map/LRU. Object keys use a WeakMap plus weak bookkeeping, so a
 * family never becomes the sole owner of a parameter object. Explicit clear/dispose still releases
 * every currently reachable entry.
 */
export function createFamily<K extends IFamilyKey, V extends IDisposable>(
  options: IFamilyNodeOptions<K, V>
): IFamily<K, V> {
  const normalizedOptions = validateOptions(options)
  let createCallback: unknown
  let observedCallback: unknown
  try {
    createCallback = options.create
    observedCallback = options.isObserved
  } catch (error) {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCallback('create/isObserved'),
      { cause: error }
    )
  }
  if (typeof createCallback !== 'function') {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCallback('create')
    )
  }
  if (typeof observedCallback !== 'function') {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCallback('isObserved')
    )
  }
  const create = createCallback as (key: K) => V
  const isObserved = observedCallback as (value: V) => boolean
  const familyOptions = {
    ...normalizedOptions,
    create,
    isObserved
  }
  if (typeof WeakRef !== 'function' || typeof FinalizationRegistry !== 'function') {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.envUnsupported,
      StoreKeyedErrorText.createFamilyWeakRef
    )
  }
  const primitiveEntries = new Map<Exclude<K, object>, IFamilyEntry<V>>()
  let objectEntries = new WeakMap<object, IFamilyEntry<V>>()
  const objectEntryRefs = new Set<WeakRef<IFamilyEntry<V>>>()
  const objectRefsByEntry = new WeakMap<IFamilyEntry<V>, WeakRef<IFamilyEntry<V>>>()
  let liveEntryCount = 0
  const collectedEntries = new FinalizationRegistry<WeakRef<IFamilyEntry<V>>>((reference) => {
    if (objectEntryRefs.delete(reference)) liveEntryCount--
  })
  const dropObjectReference = (reference: WeakRef<IFamilyEntry<V>>): void => {
    if (objectEntryRefs.delete(reference)) liveEntryCount--
  }
  const now = familyOptions.now ?? Date.now
  const wallClock = familyOptions.now === undefined
  const ttl = familyOptions.ttl
  const maxSize = familyOptions.maxSize
  let disposed = false
  let accessClock = 0
  let ttlTimer: ReturnType<typeof setTimeout> | undefined

  const assertUsable = (): void => {
    if (disposed)
      throw createStoreKeyedError(
        StoreKeyedErrorCode.familyDisposed,
        StoreKeyedErrorText.disposedFamily
      )
  }

  const expired = (entry: IFamilyEntry<V>): boolean => now() >= entry.expiresAt

  const entryFor = (key: K): IFamilyEntry<V> | undefined =>
    isObjectKey(key) ? objectEntries.get(key) : primitiveEntries.get(key as Exclude<K, object>)

  const deleteEntry = (entry: IFamilyEntry<V>): void => {
    if (entry.weak) {
      const key = (entry.key as WeakRef<object>).deref()
      if (key && objectEntries.get(key) === entry) objectEntries.delete(key)
      const reference = objectRefsByEntry.get(entry)
      if (reference && objectEntryRefs.delete(reference)) liveEntryCount--
      collectedEntries!.unregister(entry)
    } else {
      if (primitiveEntries.delete(entry.key as Exclude<K, object>)) liveEntryCount--
    }
  }

  const disposeEntry = (entry: IFamilyEntry<V>): void => {
    deleteEntry(entry)
    entry.value.dispose()
  }

  const armTtlTimer = (): void => {
    if (ttlTimer !== undefined) clearTimeout(ttlTimer)
    ttlTimer = undefined
    if (!wallClock || ttl === Infinity || disposed) return
    const currentTime = now()
    const nextExpiry = liveEntries().reduce(
      (earliest, entry) =>
        // An expired observed entry is intentionally retained, but it must
        // not keep a proactive timer alive forever. It will be reconsidered
        // on the next family operation or when the caller stops observing it.
        entry.expiresAt <= currentTime && familyOptions.isObserved(entry.value)
          ? earliest
          : Math.min(earliest, entry.expiresAt),
      Infinity
    )
    if (nextExpiry === Infinity) return
    // An observed expired entry is intentionally retained. Keep checking at a
    // bounded cadence so it can be reclaimed after becoming unobserved, but
    // never turn an already-expired observed entry into a 0ms busy loop.
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(16, nextExpiry - currentTime))
    ttlTimer = setTimeout(() => {
      ttlTimer = undefined
      if (disposed) return
      try {
        prune()
      } catch (error) {
        // Timer callbacks have no caller to receive a synchronous disposer
        // failure; route it to the runtime diagnostics channel.
        reportFamilyTimerFailure(error)
      }
    }, delay)
  }

  const touch = (entry: IFamilyEntry<V>): void => {
    entry.lastAccess = ++accessClock
  }

  const liveEntries = (): IFamilyEntry<V>[] => {
    const result = Array.from(primitiveEntries.values())
    for (const reference of Array.from(objectEntryRefs)) {
      const entry = reference.deref()
      if (!entry) {
        dropObjectReference(reference)
        continue
      }
      const key = (entry.key as WeakRef<object>).deref()
      if (!key || objectEntries.get(key) !== entry) {
        dropObjectReference(reference)
        continue
      }
      result.push(entry)
    }
    return result
  }

  const enforceCapacity = (): number => {
    // 没有上限就永远淘汰不掉任何条目，但 liveEntries() 是全量拷贝 + 逐条 isObserved，
    // 而 get() 每次插入都会调用它——不在这里短路，建 n 个 key 就是 O(n²)。
    if (maxSize === Infinity) return 0
    const candidates = liveEntries().filter((entry) => !familyOptions.isObserved(entry.value))
    if (candidates.length <= maxSize) return 0
    // 一次定序即可：原先每淘汰一个都要重扫最小值并复制整个候选集。
    // 被观察的条目不计入上限，与此前语义一致。
    candidates.sort((left, right) => left.lastAccess - right.lastAccess)
    const evictions = candidates.length - maxSize
    const errors: unknown[] = []
    for (let index = 0; index < evictions; index++) {
      try {
        disposeEntry(candidates[index])
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw createStoreKeyedAggregateError(
        StoreKeyedErrorCode.evictionFailed,
        errors,
        StoreKeyedErrorText.evictionFailed
      )
    }
    return evictions
  }

  const prune = (): number => {
    assertUsable()
    let removed = 0
    const errors: unknown[] = []
    try {
      for (const entry of liveEntries()) {
        if (expired(entry) && !familyOptions.isObserved(entry.value)) {
          try {
            disposeEntry(entry)
          } catch (error) {
            errors.push(error)
          } finally {
            // disposeEntry removes ownership before calling hostile cleanup.
            removed++
          }
        }
      }
      try {
        removed += enforceCapacity()
      } catch (error) {
        errors.push(error)
      }
    } finally {
      armTtlTimer()
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw createStoreKeyedAggregateError(
        StoreKeyedErrorCode.disposalFailed,
        errors,
        StoreKeyedErrorText.familyDisposalFailed
      )
    }
    return removed
  }

  const get = (key: K): V => {
    assertUsable()
    const existing = entryFor(key)
    if (existing) {
      if (expired(existing) && !familyOptions.isObserved(existing.value)) {
        disposeEntry(existing)
      } else {
        touch(existing)
        return existing.value
      }
    }

    const value = familyOptions.create(key)
    const weak = isObjectKey(key)
    const entry: IFamilyEntry<V> = {
      value,
      expiresAt: ttl === Infinity ? Infinity : now() + ttl,
      lastAccess: ++accessClock,
      key: weak ? new WeakRef(key) : key,
      weak
    }
    if (weak) {
      objectEntries.set(key, entry)
      const reference = new WeakRef(entry)
      objectEntryRefs.add(reference)
      objectRefsByEntry.set(entry, reference)
      collectedEntries.register(entry, reference, entry)
    } else {
      primitiveEntries.set(key as Exclude<K, object>, entry)
    }
    liveEntryCount++
    try {
      enforceCapacity()
    } catch (error) {
      // Capacity errors belong to victims. The newly-created entry remains
      // reachable so a caller can inspect or remove it after the failure.
      if (entryFor(key) !== entry) {
        try {
          value.dispose()
        } catch {
          // Preserve the capacity error; this cleanup is only a fallback.
        }
      }
      throw error
    }
    armTtlTimer()
    return value
  }

  const family = ((key: K) => get(key)) as IFamily<K, V>
  family.get = get
  family.peek = (key: K): V | undefined => {
    assertUsable()
    const entry = entryFor(key)
    if (!entry) return undefined
    if (expired(entry) && !familyOptions.isObserved(entry.value)) {
      disposeEntry(entry)
      armTtlTimer()
      return undefined
    }
    return entry.value
  }
  family.has = (key: K): boolean => family.peek(key) !== undefined
  family.remove = (key: K): boolean => {
    assertUsable()
    const entry = entryFor(key)
    if (!entry) return false
    disposeEntry(entry)
    armTtlTimer()
    return true
  }
  family.clear = (): void => {
    assertUsable()
    const pending = liveEntries()
    primitiveEntries.clear()
    objectEntries = new WeakMap()
    objectEntryRefs.clear()
    liveEntryCount = 0
    disposeAll(pending.map(({ value }) => value))
    if (ttlTimer !== undefined) clearTimeout(ttlTimer)
    ttlTimer = undefined
  }
  family.prune = prune
  family.dispose = (): void => {
    if (disposed) return
    disposed = true
    const pending = liveEntries()
    primitiveEntries.clear()
    objectEntries = new WeakMap()
    objectEntryRefs.clear()
    liveEntryCount = 0
    disposeAll(pending.map(({ value }) => value))
    if (ttlTimer !== undefined) clearTimeout(ttlTimer)
    ttlTimer = undefined
  }
  Object.defineProperties(family, {
    disposed: { get: () => disposed },
    size: { get: () => liveEntryCount }
  })
  return family
}

function isObjectKey(key: IFamilyKey): key is object {
  return (typeof key === 'object' && key !== null) || typeof key === 'function'
}

function disposeAll(values: IDisposable[]): void {
  const errors: unknown[] = []
  const seen = new Set<IDisposable>()
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    try {
      value.dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw createStoreKeyedAggregateError(
      StoreKeyedErrorCode.disposalFailed,
      errors,
      StoreKeyedErrorText.familyDisposalFailed
    )
  }
}

export type IComputedFamilyOptions<T> = IFamilyOptions & {
  computed?: IComputedConfig<T>
}

/** Materializes computed-family configuration once so entry creation never rereads user accessors. */
function snapshotComputedFamilyOptions<T>(options: IComputedFamilyOptions<T>): {
  readonly family: INormalizedFamilyOptions
  readonly computed: IComputedConfig<T> | undefined
} {
  const family = validateOptions(options)
  let computed: IComputedConfig<T> | undefined
  try {
    computed = options.computed
  } catch (error) {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyComputedOptions,
      { cause: error }
    )
  }
  return { family, computed }
}

export function computedFamily<K extends IFamilyKey, T>(
  derive: (key: K) => T,
  runtime: IRuntime = defaultRuntime,
  options: IComputedFamilyOptions<T> = {}
): IFamily<K, IComputedValue<T>> {
  if (typeof derive !== 'function') {
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.familyCallback('derive')
    )
  }
  const snapshot = snapshotComputedFamilyOptions(options)
  return createFamily({
    ...(snapshot.family.maxSize === Infinity ? {} : { maxSize: snapshot.family.maxSize }),
    ttl: snapshot.family.ttl,
    now: snapshot.family.now,
    create: (key) => runtime.computed(() => derive(key), snapshot.computed),
    isObserved: (value) => value.observed
  })
}
