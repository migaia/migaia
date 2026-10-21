import type { IRuntime } from '@migaia/reactive'
import { getDefaultRuntime } from '@migaia/reactive/extension'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type { IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { ResourceErrorCode } from './error-code.js'
import { ResourceErrorText } from './error-text.js'
import { tagResourceError } from './errors.js'
import {
  Resource,
  registerResourceCleanup,
  type IResourceFetcher,
  type IResourceOptions
} from './resource.class.js'

/** Context handed to a `createResource()` setup callback. */
export type IResourceSetupContext = {
  /** Runtime that owns the resource graph. */
  readonly runtime: IRuntime
  /** Scheduler the resource uses for TTL and retry timing. */
  readonly scheduler: IScheduler
  /** Aborts when the resource is disposed or setup fails; pass it to listeners and long work. */
  readonly signal: IAbortSignal
  /** Diagnostic name from the options, if any. */
  readonly debugName: string | undefined
  /**
   * Registers a synchronous cleanup. Cleanups run in reverse order on `dispose()`, or immediately
   * when setup fails. Only valid while setup runs (`RESOURCE_SETUP_CLOSED` afterwards). Returns the
   * context for chaining.
   */
  onDispose(cleanup: () => void): IResourceSetupContext
}

/** Setup callback: prepares resources once and returns the fetcher. */
export type IResourceSetup<T> = (context: IResourceSetupContext) => IResourceFetcher<T>

/** `Resource` options plus the optional runtime (defaults to the reactive `defaultRuntime`). */
export type ICreateResourceOptions<T> = IResourceOptions<T> & {
  readonly runtime?: IRuntime
}

/** Creates a coded native `TypeError` for the setup contract. */
function setupError(code: string, message: string): TypeError {
  return tagResourceError(new TypeError(message), code)
}

/**
 * Functional `Resource` builder. `setup` runs once, synchronously, with a context that exposes the
 * runtime, scheduler, an abort signal and `onDispose`; it returns the fetcher. The data type is
 * inferred from the fetcher.
 *
 * If setup throws, returns a non-function (`RESOURCE_SETUP_INVALID`), or the `Resource` constructor
 * rejects the options, the signal aborts and registered cleanups run in reverse order before the
 * original error is rethrown; cleanup failures are attached to it through `errors`.
 *
 * @example
 *   ;```ts
 *   const user = createResource(
 *     ({ signal, onDispose }) => {
 *       const socket = connect()
 *       onDispose(() => socket.close())
 *       return ({ signal: request }) => fetchUser(userId.value, { signal: request })
 *     },
 *     { ttl: 30_000 }
 *   )
 *   ```
 */
export function createResource<T>(
  setup: IResourceSetup<T>,
  options: ICreateResourceOptions<T> = {}
): Resource<T> {
  if (typeof setup !== 'function')
    throw setupError(ResourceErrorCode.setupInvalid, ResourceErrorText.setupInvalid)
  /**
   * Options split once: the runtime is ours, everything else belongs to `Resource`. The shared
   * default is acquired here, on first use, so importing this package never constructs a runtime.
   */
  const { runtime = getDefaultRuntime(), ...resourceOptions } = options
  /** Controller whose signal the setup context exposes. */
  const controller = new AbortController()
  /** Cleanups registered during setup, in registration order. */
  const cleanups: (() => void)[] = []
  /** Whether setup is still running and may register cleanups. */
  let open = true
  /** Frozen context shared with setup. */
  const context: IResourceSetupContext = Object.freeze({
    runtime,
    scheduler: resourceOptions.scheduler ?? systemScheduler,
    signal: controller.signal,
    debugName: resourceOptions.debugName,
    onDispose(cleanup: () => void): IResourceSetupContext {
      if (!open) throw setupError(ResourceErrorCode.setupClosed, ResourceErrorText.setupClosed)
      if (typeof cleanup !== 'function')
        throw setupError(ResourceErrorCode.setupInvalid, ResourceErrorText.setupInvalid)
      cleanups.push(cleanup)
      return context
    }
  })
  /** Resource under construction. */
  let resource: Resource<T>
  try {
    /** Fetcher returned by setup. */
    const fetcher = setup(context)
    if (typeof fetcher !== 'function')
      throw setupError(ResourceErrorCode.setupInvalid, ResourceErrorText.setupInvalid)
    resource = new Resource(fetcher, runtime, resourceOptions)
  } catch (error) {
    open = false
    /** Cleanup failures, attached behind the primary error. */
    const failures: unknown[] = []
    try {
      controller.abort(error)
    } catch (abortError) {
      failures.push(abortError)
    }
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      try {
        cleanups[index]()
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
    }
    throw failures.length > 0 ? attachSecondaryErrors(error, failures) : error
  }
  open = false
  for (const cleanup of cleanups) registerResourceCleanup(resource, cleanup)
  // Registered last so dispose aborts the setup signal before running setup cleanups.
  registerResourceCleanup(resource, () => controller.abort())
  return resource
}
