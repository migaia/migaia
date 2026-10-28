/**
 * Explicit internal Resource state; lifecycle and reactive retain their existing state-machine
 * ownership.
 */
import type { IReactiveSignal, IRuntime } from '@migaia/reactive'
import type { IObservable, ITrackedObserverBinding } from '@migaia/reactive/extension'
import {
  createGenerationController,
  createTerminalController,
  type IGenerationController,
  type ITerminalController
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IResourceFetcher, IResourceRetryPolicy, IResourceState } from './resource-types.ts'

/** Validated clock/deadline pair awaiting current-generation publication. */
export type IResourceExpiry = {
  readonly updatedAt: number
  readonly expiresAt: number
}

/** Shared state passed explicitly between the package's responsibility modules. */
export type IResourceContext<T> = {
  /** Original Resource receiver for user fetch/retry callbacks. */
  readonly owner: object
  /** Caller-owned reactive runtime, installed after option admission. */
  runtime: IRuntime
  /** Canonical graph binding, installed before the state signal. */
  tracking: ITrackedObserverBinding
  /** Visible data/error state and its subscriber collection. */
  stateSignal: IReactiveSignal<IResourceState<T>> & IObservable
  /** Caller fetcher; invoked only inside the reactive tracking frame. */
  fetcher: IResourceFetcher<T>
  /** Admitted freshness duration; zero disables time expiration. */
  ttl: number
  /** Admitted refresh presentation policy. */
  staleWhileRevalidate: boolean
  /** Admitted retry count or synchronous decision callback. */
  retry: IResourceRetryPolicy
  /** Admitted fixed or calculated retry delay. */
  retryDelay: number | ((failureCount: number, error: unknown) => number)
  /** Whether upstream edges remain attached with no state observers. */
  keepAlive: boolean
  /** Lifecycle owns monotonically increasing request identities and supersession. */
  requests: IGenerationController
  /** Exact public Promise for the active request or cached result. */
  currentPromise: Promise<T> | undefined
  /** Local scheduler deadline for cached success. */
  expiresAt: number
  /** Local scheduler timestamp for cached success. */
  updatedAt: number
  /** Whether an admitted request has not yet published its outcome. */
  requestPending: boolean
  /** Whether the reactive idle lane already contains one dependency refresh. */
  refreshScheduled: boolean
  /** Whether a disposed dependency forces the queued refresh. */
  forceRefresh: boolean
  /** Observation epoch that invalidates stale suspension callbacks. */
  suspensionGeneration: number
  /** Explicit cancellation or passive clock failure suppresses passive restart. */
  paused: boolean
  /** Atomic expiry pair held between request resolution and state publication. */
  settlementExpiry: IResourceExpiry | undefined
  /** Lifecycle owns the Resource open/closing/terminal progression. */
  terminal: ITerminalController
  /** Admitted scheduler shared by cache and retry operations. */
  scheduler: IScheduler
  /** Setup and view cleanups; disposal detaches and traverses in reverse order. */
  cleanups: (() => void)[]
}

/** Initializes Resource state before constructor option access and graph installation. */
export function createResourceContext<T>(owner: object): IResourceContext<T> {
  return {
    owner,
    runtime: undefined!,
    tracking: undefined!,
    stateSignal: undefined!,
    fetcher: undefined!,
    ttl: undefined!,
    staleWhileRevalidate: undefined!,
    retry: undefined!,
    retryDelay: undefined!,
    keepAlive: undefined!,
    requests: createGenerationController(),
    currentPromise: undefined,
    expiresAt: 0,
    updatedAt: 0,
    requestPending: false,
    refreshScheduled: false,
    forceRefresh: false,
    suspensionGeneration: 0,
    paused: false,
    settlementExpiry: undefined,
    terminal: createTerminalController(),
    scheduler: undefined!,
    cleanups: []
  }
}
