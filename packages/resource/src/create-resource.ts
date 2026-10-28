/**
 * Functional Resource setup ownership, frozen context admission and rollback; does not own request
 * generations.
 */
import type { IRuntime } from '@migaia/reactive'
import { getDefaultRuntime } from '@migaia/reactive/extension'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type { IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'
import { createResourceSetupError } from './resource-failure.ts'
import { Resource, registerResourceCleanup } from './resource.class.ts'
import type { IResourceFetcher, IResourceOptions } from './resource-types.ts'

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

/** Owns one synchronous setup's context, abort signal and reverse-order cleanup registration. */
class ResourceSetupOwner {
  /** Setup-scoped signal aborts on rollback or Resource disposal. */
  #controller = new AbortController()
  /** Registered cleanup order is retained for both rollback and normal disposal. */
  #cleanups: (() => void)[] = []
  /** Only synchronous setup may register additional cleanup ownership. */
  #open = true
  /** Frozen public context keeps its original own-property shape. */
  #context: IResourceSetupContext

  /** Creates the same context values after options have been split by the public builder. */
  constructor(runtime: IRuntime, options: IResourceOptions) {
    this.#context = Object.freeze({
      runtime,
      scheduler: options.scheduler ?? systemScheduler,
      signal: this.#controller.signal,
      debugName: options.debugName,
      onDispose: (cleanup: () => void): IResourceSetupContext => this.#onDispose(cleanup)
    })
  }

  /** Runs setup once, rolling back before rethrowing its original primary failure. */
  construct<T>(
    setup: IResourceSetup<T>,
    runtime: IRuntime,
    options: IResourceOptions<T>
  ): Resource<T> {
    /** Resource remains unexposed until setup and constructor admission both succeed. */
    let resource: Resource<T>
    try {
      /** Local setup invocation retains its original undefined callback receiver. */
      const fetcher = setup(this.#context)
      if (typeof fetcher !== 'function')
        throw createResourceSetupError(
          ResourceErrorCode.setupInvalid,
          ResourceErrorText.setupInvalid
        )
      resource = new Resource(fetcher, runtime, options)
    } catch (error) {
      this.#open = false
      throw this.#rollback(error)
    }
    this.#open = false
    for (const cleanup of this.#cleanups) registerResourceCleanup(resource, cleanup)
    // Ownership has transferred; an escaped closed setup context need not retain the callbacks.
    this.#cleanups = []
    /** Disposal captures only the controller rather than the completed setup owner. */
    const controller = this.#controller
    // Registered last so disposal aborts setup before invoking the registered cleanups.
    registerResourceCleanup(resource, () => controller.abort())
    return resource
  }

  /** Admits a cleanup only during setup and returns the original frozen context. */
  #onDispose(cleanup: () => void): IResourceSetupContext {
    if (!this.#open)
      throw createResourceSetupError(ResourceErrorCode.setupClosed, ResourceErrorText.setupClosed)
    if (typeof cleanup !== 'function')
      throw createResourceSetupError(ResourceErrorCode.setupInvalid, ResourceErrorText.setupInvalid)
    this.#cleanups.push(cleanup)
    return this.#context
  }

  /** Aborts before reverse cleanup and attaches secondary failures without replacing the primary. */
  #rollback(error: unknown): unknown {
    /** All rollback failures retain encounter order after the triggering setup/constructor error. */
    const failures: unknown[] = []
    try {
      this.#controller.abort(error)
    } catch (abortError) {
      failures.push(abortError)
    }
    for (let index = this.#cleanups.length - 1; index >= 0; index -= 1) {
      try {
        this.#cleanups[index]()
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
    }
    return failures.length > 0 ? attachSecondaryErrors(error, failures) : error
  }
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
    throw createResourceSetupError(ResourceErrorCode.setupInvalid, ResourceErrorText.setupInvalid)
  /** Import remains cold; the shared default runtime is acquired only for this builder call. */
  const { runtime = getDefaultRuntime(), ...resourceOptions } = options
  return new ResourceSetupOwner(runtime, resourceOptions).construct(setup, runtime, resourceOptions)
}
