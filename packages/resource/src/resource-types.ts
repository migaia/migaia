/** Public Resource data and configuration contracts; implementation state stays internal. */
import type { IGenerationRequest } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { ResourceStatus } from './state-constants.ts'

/**
 * Everything a view needs to decide what to show: `idle` before any request, `pending` while the
 * first load runs, `success` with `data` (and `refreshing` during a stale-while-revalidate
 * refresh), `error` with the latest failure, and `cancelled` after an explicit `cancel()`.
 */
export type IResourceState<T> =
  | { status: typeof ResourceStatus.idle }
  | { status: typeof ResourceStatus.pending }
  | { status: typeof ResourceStatus.success; data: T; refreshing?: boolean }
  | { status: typeof ResourceStatus.error; error: unknown }
  /**
   * `error` is a native `DOMException` at runtime; typed as `Error` so declarations need no DOM
   * types.
   */
  | { status: typeof ResourceStatus.cancelled; error: Error }

/**
 * Readonly canonical lifecycle request: signal aborts on replacement/reset/disposal, generation
 * advances monotonically, and the opaque token is retained across retry attempts.
 */
export type IResourceFetchContext = IGenerationRequest

/**
 * Loads the data for one request. Reactive values read before the first `await` become
 * dependencies; hand `ctx.signal` to the underlying I/O so replaced or cancelled requests really
 * stop.
 */
export type IResourceFetcher<T> = (ctx: IResourceFetchContext) => T | PromiseLike<T>

/** Portable durations captured at dehydration; callers account for transport/storage elapsed time. */
export type IResourceCacheSnapshot<T> = {
  readonly version: 2
  readonly data: T
  /** Elapsed cache age at capture; independent of the sending scheduler's origin. */
  readonly ageMs: number
  /** Remaining lifetime resumes at hydration; `null` means no time-based expiration. */
  readonly remainingTtlMs: number | null
}

/**
 * Updater accepted by `mutate()`. Declared through a method signature so its parameter stays
 * bivariant and `Resource<T>` keeps its covariant assignability (`Resource<never>` to
 * `Resource<number>`).
 */
export type IResourceUpdater<T> = {
  bivarianceHack(previous: T | undefined): T
}['bivarianceHack']

/**
 * Retry decision after a failure: a maximum number of retries, or a function receiving the failure
 * number (starting at 1) and the error that returns whether to try again.
 */
export type IResourceRetryPolicy = number | ((failureCount: number, error: unknown) => boolean)

/** Constructor options; every field is read and validated once when the resource is created. */
export type IResourceOptions<T = unknown> = {
  /** Human-readable owner label used in reactive diagnostics and request error context. */
  debugName?: string
  /**
   * Successful values remain fresh for this many milliseconds. `0` and `Infinity` keep them fresh
   * until a dependency changes or `refetch()` is called.
   */
  ttl?: number
  /** Start the first request in the constructor. Defaults to true. */
  autoStart?: boolean
  /** Keep stale success data visible while a background refresh runs. */
  staleWhileRevalidate?: boolean
  /** Retry count or predicate. Suspense Promise throws do not count. */
  retry?: IResourceRetryPolicy
  /**
   * Milliseconds to wait before the next retry, fixed or computed from the failure number and
   * error. Defaults to 0.
   */
  retryDelay?: number | ((failureCount: number, error: unknown) => number)
  /** Keep upstream reactive edges while no state consumer exists. */
  keepAlive?: boolean
  /** SSR/persisted success cache used before optional revalidation. */
  initialSnapshot?: IResourceCacheSnapshot<T>
  /**
   * Supplies one scheduler for TTL, `updatedAt`, `expiresAt`, and retry delays. Defaults to
   * utils/scheduler `systemScheduler`. Missing host capabilities fail immediately instead of
   * silently falling back to microtasks.
   */
  scheduler?: IScheduler
}
