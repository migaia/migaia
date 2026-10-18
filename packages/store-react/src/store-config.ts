import { createContext, useContext, type ReactNode } from 'react'
import { createStoreReactError } from './errors.js'
import { StoreReactErrorCode } from './error-code.js'
import { StoreReactErrorText } from './error-text.js'
import { EMPTY_EXPERIMENTAL_ENCODING, StoreProviderState } from './provider-state-constants.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/**
 * Configures application features and readiness on `StoreProvider`.
 *
 * Provider registries and runtimes own the graph independently of this configuration. The
 * configuration selects enhancements and whether readiness blocks the subtree.
 *
 * When `features.wasm === true`, supply `ready`, usually with `ensureWasm` from
 * `@migaia/store-wasm`. Without a barrier, normalization creates a rejected readiness promise, and
 * the provider reports the configuration error before rendering its subtree.
 */

export type IStoreFeatureExperimental = Readonly<Record<string, boolean>>

export type IStoreFeatures = {
  /**
   * Declares that the subtree uses WASM fields. Defaults to `false`, which requires no readiness
   * barrier. When `true`, `ready` must complete initialization before the provider renders its
   * subtree.
   */
  readonly wasm?: boolean
  /**
   * Allows experimental features only when their entry is exactly `true`. Missing entries are
   * disabled. Experimental APIs check `assertStoreFeature('experimental.xxx')`.
   */
  readonly experimental?: IStoreFeatureExperimental
}

/** Provides a readiness promise or a zero-argument factory, such as `ensureWasm`. */
export type IStoreReadyBarrier = Promise<unknown> | (() => Promise<unknown> | unknown)

export type IStoreProviderDefaults = {
  /**
   * Exposes a default in the configuration snapshot for application code using `useStoreConfig`. It
   * is not forwarded to `createStore`; set `options.warnAsyncActions` there explicitly.
   */
  readonly warnAsyncActions?: boolean
}

export type IStoreProviderConfig = {
  readonly features?: IStoreFeatures
  /**
   * Requires all barriers to fulfill before the subtree renders. For example, use `ready:
   * [ensureWasm]` with `ensureWasm` from `@migaia/store-wasm`.
   */
  readonly ready?: readonly IStoreReadyBarrier[]
  /** Displays this fallback while readiness barriers are pending. */
  readonly fallback?: ReactNode
  /**
   * Exposes a read-only snapshot of application defaults. The provider does not apply them to
   * individual stores.
   */
  readonly defaults?: IStoreProviderDefaults
}

export type IReadyStatus = (typeof StoreProviderState)[keyof typeof StoreProviderState]

export type ITrackedReady = {
  readonly promise: Promise<void>
  /**
   * Reads status synchronously. Tracking an already settled promise updates status in a microtask,
   * so the first frame may still be pending.
   */
  status(): IReadyStatus
  error(): unknown
}

export type IStoreConfigValue = {
  readonly features: {
    readonly wasm: boolean
    readonly experimental: Readonly<Record<string, boolean>>
  }
  readonly defaults: IStoreProviderDefaults
  /** Provides normalized readiness tracking, or `null` when no barrier exists. */
  readonly ready: ITrackedReady | null
}

export const StoreConfigContext = createContext<IStoreConfigValue | null>(null)

const EMPTY_EXPERIMENTAL: Readonly<Record<string, boolean>> = Object.freeze(
  Object.create(null) as Record<string, boolean>
)
const EXPERIMENTAL_ENCODING_CACHE = new WeakMap<object, string>()

export function normalizeStoreConfig(
  config?: IStoreProviderConfig,
  barrierScope: object = {}
): IStoreConfigValue {
  let wasm = false
  let experimentalInput: IStoreFeatureExperimental | undefined
  let barriers: readonly IStoreReadyBarrier[] | undefined
  /** Capture the supported nested default before readiness factories can start application work. */
  let warnAsyncActions = false
  try {
    const features = config?.features
    wasm = features?.wasm === true
    experimentalInput = features?.experimental
    barriers = config?.ready
    warnAsyncActions = config?.defaults?.warnAsyncActions === true
  } catch (error) {
    throw createStoreReactError(StoreReactErrorCode.invalidConfig, StoreReactErrorText.configRead, {
      cause: error
    })
  }
  const experimental = freezeExperimental(experimentalInput)
  const validBarrier = (barrier: unknown): boolean => {
    if (typeof barrier === 'function') return true
    if (barrier === null || typeof barrier !== 'object') return false
    try {
      return typeof (barrier as { then?: unknown }).then === 'function'
    } catch {
      return false
    }
  }
  if (
    barriers !== undefined &&
    (!Array.isArray(barriers) || barriers.some((barrier) => !validBarrier(barrier)))
  ) {
    throw createStoreReactError(StoreReactErrorCode.invalidConfig, StoreReactErrorText.readyInvalid)
  }
  const normalizedBarriers = barriers ?? []

  const effectiveBarriers =
    wasm && normalizedBarriers.length === 0
      ? ([
          () =>
            Promise.reject(
              createStoreReactError(
                StoreReactErrorCode.invalidConfig,
                StoreReactErrorText.featureReady
              )
            )
        ] as const)
      : normalizedBarriers

  const ready =
    effectiveBarriers.length === 0
      ? null
      : trackReady(getReadyPromise(effectiveBarriers, barrierScope))

  return {
    features: { wasm, experimental },
    defaults: {
      warnAsyncActions
    },
    ready
  }
}

const READY_PROMISES = new WeakMap<object, WeakMap<object, Promise<void>>>()

function getReadyPromise(barriers: readonly IStoreReadyBarrier[], scope: object): Promise<void> {
  let scoped = READY_PROMISES.get(scope)
  if (!scoped) {
    scoped = new WeakMap()
    READY_PROMISES.set(scope, scoped)
  }
  const cached = scoped.get(barriers as object)
  if (cached) return cached
  const promise = Promise.all(barriers.map((barrier) => runBarrier(barrier, scope))).then(
    () => undefined
  )
  scoped.set(barriers as object, promise)
  return promise
}

const READY_TRACK = new WeakMap<Promise<void>, { status: IReadyStatus; error: unknown }>()
const READY_OBJECTS = new WeakMap<Promise<void>, ITrackedReady>()

function trackReady(promise: Promise<void>): ITrackedReady {
  const tracked = READY_OBJECTS.get(promise)
  if (tracked) return tracked
  let state = READY_TRACK.get(promise)
  if (!state) {
    state = { status: StoreProviderState.pending, error: undefined }
    READY_TRACK.set(promise, state)
    promise.then(
      () => {
        state!.status = StoreProviderState.ready
      },
      (reason: unknown) => {
        state!.status = StoreProviderState.error
        state!.error = reason
      }
    )
  }
  const result = {
    promise,
    status: () => state!.status,
    error: () => state!.error
  }
  READY_OBJECTS.set(promise, result)
  return result
}

function freezeExperimental(
  input: IStoreFeatureExperimental | undefined
): Readonly<Record<string, boolean>> {
  if (!input) return EMPTY_EXPERIMENTAL
  return decodeStoreExperimental(encodeStoreExperimental(input))
}

/**
 * Canonical, getter-free feature snapshot used by StoreProvider memoization. Accessors are rejected
 * closed and a sorted tuple encoding makes key order irrelevant. `__proto__` remains an inert
 * string key on the decoded null- prototype object.
 */
export function encodeStoreExperimental(input: IStoreFeatureExperimental | undefined): string {
  if (!input) return '[]'
  try {
    const cacheable = Object.isFrozen(input)
    const cached = cacheable ? EXPERIMENTAL_ENCODING_CACHE.get(input) : undefined
    if (cached !== undefined) return cached
    const entries: Array<readonly [string, boolean]> = []
    const descriptorSnapshot = snapshotOwnDescriptors(input)
    if (!descriptorSnapshot.ok) throw descriptorSnapshot.error
    for (const [key, descriptor] of Object.entries(descriptorSnapshot.descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) continue
      entries.push([key, descriptor.value === true])
    }
    entries.sort(([left], [right]) => left.localeCompare(right))
    const encoded = JSON.stringify(entries)
    if (cacheable) EXPERIMENTAL_ENCODING_CACHE.set(input, encoded)
    return encoded
  } catch (error) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.experimentalInvalid,
      { cause: error }
    )
  }
}

export function decodeStoreExperimental(encoded: string): Readonly<Record<string, boolean>> {
  if (encoded === EMPTY_EXPERIMENTAL_ENCODING) return EMPTY_EXPERIMENTAL
  const entries = JSON.parse(encoded) as Array<readonly [string, boolean]>
  const out = Object.create(null) as Record<string, boolean>
  for (const [key, enabled] of entries) out[key] = enabled === true
  return Object.freeze(out)
}

type IBarrierFactory = Extract<IStoreReadyBarrier, () => unknown>
// Cache by scope and factory identity; list promises have their own cache above.
// Separate Provider/SSR scopes stay isolated. Factory execution is not
// guaranteed exactly once across abandoned React renders; callers should pass
// a memoized Promise/resource for non-idempotent work.
const BARRIER_CACHE = new WeakMap<object, WeakMap<IBarrierFactory, Promise<unknown>>>()

function runBarrier(barrier: IStoreReadyBarrier, scope: object): Promise<unknown> {
  if (typeof barrier !== 'function') return Promise.resolve(barrier)
  let scoped = BARRIER_CACHE.get(scope)
  if (!scoped) {
    scoped = new WeakMap()
    BARRIER_CACHE.set(scope, scoped)
  }
  let cached = scoped.get(barrier)
  if (!cached) {
    try {
      cached = Promise.resolve(barrier())
    } catch (error) {
      cached = Promise.reject(error) as Promise<unknown>
    }
    scoped.set(barrier, cached)
    cached.catch(() => {
      if (scoped?.get(barrier) === cached) scoped.delete(barrier)
    })
  }
  return cached
}

export type IStoreFeaturePath = 'wasm' | `experimental.${string}`

export function readStoreFeature(config: IStoreConfigValue, path: IStoreFeaturePath): boolean {
  if (path === 'wasm') return config.features.wasm
  if (path.startsWith('experimental.')) {
    const key = path.slice('experimental.'.length)
    if (!key) return false
    return config.features.experimental[key] === true
  }
  return false
}

export function assertStoreFeature(
  config: IStoreConfigValue | null,
  path: IStoreFeaturePath,
  apiName = 'this API'
): void {
  if (!config) {
    throw createStoreReactError(
      StoreReactErrorCode.providerRequired,
      StoreReactErrorText.apiProvider(apiName, path)
    )
  }
  if (!readStoreFeature(config, path)) {
    throw createStoreReactError(
      StoreReactErrorCode.featureDisabled,
      StoreReactErrorText.apiFeature(apiName, path)
    )
  }
}

/**
 * Returns the complete configuration, or `null` without a provider. Configuration is optional,
 * unlike the registry.
 */
export function useStoreConfig(): IStoreConfigValue | null {
  return useContext(StoreConfigContext)
}

/**
 * Reads normalized feature flags from the provider. Returns `false` without a provider instead of
 * throwing.
 */
export function useStoreFeature(path: IStoreFeaturePath): boolean {
  const config = useStoreConfig()
  if (!config) return false
  return readStoreFeature(config, path)
}

/**
 * Guards an experimental or enhanced API at its entry point. Throws when the feature is disabled or
 * no provider exists.
 */
export function useAssertStoreFeature(path: IStoreFeaturePath, apiName?: string): void {
  const config = useStoreConfig()
  assertStoreFeature(config, path, apiName)
}
