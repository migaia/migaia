import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRuntime, type IRuntime } from '@migaia/reactive'
import { StoreRegistryContext } from './provider-context.js'
import { createStoreRegistry, type StoreRegistry } from './provider-registry.js'
import { createStoreReactError } from './errors.js'
import { StoreReactErrorCode } from './error-code.js'
import { StoreReactErrorText } from './error-text.js'
import { StoreProviderState } from './provider-state-constants.js'
import {
  decodeStoreExperimental,
  encodeStoreExperimental,
  normalizeStoreConfig,
  StoreConfigContext,
  type IStoreProviderConfig
} from './store-config.js'

const READY_KEYS = new WeakMap<Promise<void>, number>()
let nextReadyKey = 1
function readyKey(promise: Promise<void>): number {
  let key = READY_KEYS.get(promise)
  if (key === undefined) {
    key = nextReadyKey++
    READY_KEYS.set(promise, key)
  }
  return key
}

/** Normalizes a ready rejection without coercing hostile reasons or replacing Error identity. */
export function normalizeStoreReadyError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : createStoreReactError(StoreReactErrorCode.readyRejected, StoreReactErrorText.readyRejected, {
        cause: reason
      })
}

/** Provider inputs separating registry ownership, Runtime selection and optional readiness gating. */
export type IStoreProviderProps = {
  /** Required subtree shown after readiness, if any, permits rendering. */
  readonly children: ReactNode
  /** Existing registry to borrow; omission creates a Provider-local registry and atom store. */
  readonly registry?: StoreRegistry
  /** Runtime for an internal registry; when registry is supplied, this must be its exact Runtime. */
  readonly runtime?: IRuntime
  /**
   * Internal registries dispose on unmount by default. External registries remain caller-owned
   * unless this flag is explicitly true.
   */
  readonly disposeOnUnmount?: boolean
  /**
   * Configures application features and readiness barriers. Omission keeps all features disabled
   * and uses no barrier.
   */
  readonly config?: IStoreProviderConfig
}

/**
 * Supply registry and feature configuration to the subtree. An external registry is borrowed by
 * default; an internal registry retires after the last disposing committed retain is released.
 * Mounted effects handle retention and delayed cleanup; SSR performs no effect cleanup, so an
 * explicitly supplied request registry remains the server caller's responsibility. Readiness shows
 * fallback while pending and throws its normalized rejection during render; settled promises may
 * still be pending on the first synchronous render. Registry/Runtime mismatch throws
 * INVALID_CONFIG.
 */
export function StoreProvider({
  children,
  registry,
  runtime,
  disposeOnUnmount,
  config
}: IStoreProviderProps) {
  if (registry && runtime && registry.runtime !== runtime) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      StoreReactErrorText.ownershipMismatch
    )
  }

  // Snapshot config once per render so a barrier generation is selected atomically.
  const configSnapshot = useMemo(() => {
    try {
      return {
        ready: config?.ready,
        wasm: config?.features?.wasm === true,
        experimental: config?.features?.experimental,
        warnAsyncActions: config?.defaults?.warnAsyncActions === true,
        fallback: config?.fallback
      }
    } catch (error) {
      throw createStoreReactError(
        StoreReactErrorCode.invalidConfig,
        StoreReactErrorText.configRead,
        {
          cause: error
        }
      )
    }
  }, [config])
  const readyInput = configSnapshot.ready
  const barrierScope = useRef<object>(undefined)
  if (!barrierScope.current) barrierScope.current = {}
  // A changed barrier list is a new generation. The normalized promise cache is scoped
  // to this Provider, so an old settlement cannot unlock the new generation.
  const stableReady = readyInput
  const wasmEnabled = configSnapshot.wasm
  const warnAsyncActions = configSnapshot.warnAsyncActions
  const experimentalKey = useMemo(
    () => encodeStoreExperimental(configSnapshot.experimental),
    [configSnapshot.experimental]
  )
  const experimental = useMemo<Readonly<Record<string, boolean>> | undefined>(
    () => decodeStoreExperimental(experimentalKey),
    [experimentalKey]
  )
  const normalized = useMemo(
    () =>
      normalizeStoreConfig(
        {
          features: {
            wasm: wasmEnabled,
            experimental
          },
          defaults: { warnAsyncActions },
          ready: stableReady
        },
        barrierScope.current
      ),
    [experimental, stableReady, warnAsyncActions, wasmEnabled]
  )
  const fallback = configSnapshot.fallback ?? null

  const tree = registry ? (
    <RegistryBoundary registry={registry} disposeOnUnmount={disposeOnUnmount ?? false}>
      {children}
    </RegistryBoundary>
  ) : (
    <OwnedRegistryBoundary runtime={runtime} disposeOnUnmount={disposeOnUnmount ?? true}>
      {children}
    </OwnedRegistryBoundary>
  )

  return (
    <StoreConfigContext.Provider value={normalized}>
      {normalized.ready ? (
        <ReadyBoundary
          key={readyKey(normalized.ready.promise)}
          ready={normalized.ready}
          fallback={fallback}
        >
          {tree}
        </ReadyBoundary>
      ) : (
        tree
      )}
    </StoreConfigContext.Provider>
  )
}

/** 就绪屏障。复用上层追踪状态；新追踪的 Promise 即使已结算，也要等微任务更新状态后才放行。 */
function ReadyBoundary({
  ready,
  fallback,
  children
}: {
  ready: import('./store-config.js').ITrackedReady
  fallback: ReactNode
  children: ReactNode
}) {
  const initial = ready.status()
  const [status, setStatus] = useState(initial)
  const [error, setError] = useState<Error | null>(() => {
    const reason = ready.error()
    return initial === StoreProviderState.error ? normalizeStoreReadyError(reason) : null
  })

  useEffect(() => {
    let live = true
    const snap = ready.status()
    if (snap === StoreProviderState.ready) {
      setStatus(StoreProviderState.ready)
      setError(null)
      return
    }
    if (snap === StoreProviderState.error) {
      setStatus(StoreProviderState.error)
      setError(normalizeStoreReadyError(ready.error()))
      return
    }
    setStatus(StoreProviderState.pending)
    setError(null)
    ready.promise.then(
      () => {
        if (live) setStatus(StoreProviderState.ready)
      },
      (reason: unknown) => {
        if (live) {
          setError(normalizeStoreReadyError(reason))
          setStatus(StoreProviderState.error)
        }
      }
    )
    return () => {
      live = false
    }
  }, [ready])

  if (status === StoreProviderState.error) throw error
  if (status === StoreProviderState.pending) return <>{fallback}</>
  return <>{children}</>
}

type IRegistryBoundaryProps = {
  readonly children: ReactNode
  readonly registry: StoreRegistry
  readonly disposeOnUnmount: boolean
  readonly onCommit?: () => void
}

function RegistryBoundary({
  children,
  registry,
  disposeOnUnmount,
  onCommit
}: IRegistryBoundaryProps) {
  useEffect(() => {
    const release = registry.retain(disposeOnUnmount)
    onCommit?.()
    return release
  }, [disposeOnUnmount, onCommit, registry])
  return <StoreRegistryContext.Provider value={registry}>{children}</StoreRegistryContext.Provider>
}

type IOwnedRegistryState = {
  readonly runtime: IRuntime | undefined
  readonly registry: StoreRegistry
}

type IOwnedRegistryBoundaryProps = {
  readonly children: ReactNode
  readonly runtime: IRuntime | undefined
  readonly disposeOnUnmount: boolean
}

function OwnedRegistryBoundary({
  children,
  runtime,
  disposeOnUnmount
}: IOwnedRegistryBoundaryProps) {
  const initial = useRef<IOwnedRegistryState>(undefined)
  if (!initial.current) {
    const ownedRuntime = runtime ?? createRuntime()
    const ownedRegistry = createStoreRegistry(ownedRuntime)
    initial.current = {
      runtime,
      registry: ownedRegistry
    }
  }
  const committed = useRef<IOwnedRegistryState>(initial.current)
  const candidate = useRef<IOwnedRegistryState>(undefined)
  let active = committed.current
  if (active.runtime !== runtime) {
    if (candidate.current?.runtime === runtime) {
      active = candidate.current!
    } else {
      const nextRuntime = runtime ?? createRuntime()
      const nextRegistry = createStoreRegistry(nextRuntime)
      active = {
        runtime,
        registry: nextRegistry
      }
      candidate.current = active
    }
  }
  const activeRef = useRef(active)
  activeRef.current = active
  const commitActive = useCallback(() => {
    committed.current = activeRef.current
    if (candidate.current === activeRef.current) candidate.current = undefined
  }, [])
  return (
    <RegistryBoundary
      registry={active.registry}
      disposeOnUnmount={disposeOnUnmount}
      onCommit={commitActive}
    >
      {children}
    </RegistryBoundary>
  )
}
