import type {
  ICollectedError,
  IErrorPolicy,
  ILifecycleOwner,
  IReleaseContext,
  IReleaseDescriptor,
  ILifecycleState
} from './types.js'
import { ASYNC_OWNER_BRAND } from './types.js'
import { createDisposerContext } from './disposer-context.js'
import { containAsyncRejection, createLifecycleError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createTerminalController } from './terminal-controller.js'
import { DisposeTransactionKind, LifecycleState } from './state-constants.js'
import { createDisposeTransaction } from './dispose-transaction.js'
import { captureAbortControllerFactory } from './abort-factory.js'
import { resolveSchedulerOption, type ILifecycleScheduler } from './scheduler.js'

const asyncDisposeKey = (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose

/**
 * One shared registry for every `LifecycleScope`. The held value is built without ever holding a
 * reference to `target` from _our_ side — it only closes over `descriptor.force` (the caller's own
 * function) and a throwaway `report` callback, matching §4.4's "held value 不得强引用被注册 target 或 包含
 * target 的 disposer closure". A caller whose own `force` closes over the resource defeats GC
 * collection on their end, which is outside what this package can enforce.
 */
const finalizationRegistry: FinalizationRegistry<() => void> | undefined =
  typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((run) => run()) : undefined

export type ILifecycleScopeOptions = {
  readonly errorPolicy?: IErrorPolicy
  readonly report?: (error: unknown) => void
  /** Shared absolute deadline forwarded to every owned resource's release (L-T32). */
  readonly deadlineAt?: number
  /**
   * 时间域来源（R-9）：graceful timeout / deadline 经它驱动，缺省 `systemScheduler`。透传给
   * `DisposeTransaction`，使注入方（如 plugin-host）的 teardown 与 mutation queue 处于同一时间域。
   */
  readonly scheduler?: ILifecycleScheduler
}

export type ILifecycleScope = ILifecycleOwner & {
  readonly lifecycle: ILifecycleState
  /** Unregisters a resource without releasing it — the caller has already released it independently. */
  release(resource: unknown): boolean
  /** Synchronous, idempotent, never calls user code (L-T27). */
  close(): void
  /**
   * Always asynchronous (D-1) — there is no synchronous `dispose()` on this type. Resolves to the
   * collected errors for the `collect` policy (empty for the other three, which throw/report
   * internally instead).
   *
   * Concurrent external calls reuse the same published Promise even while release is in flight.
   * Only a synchronous call from an active disposer callback is rejected as reentrant, preventing
   * that callback from self-awaiting the Promise it is currently helping to settle.
   */
  dispose(): Promise<readonly ICollectedError[]>
}

/**
 * The general-purpose, async-only scope. Ported from `@migaia/reactive`'s `LifecycleScopeImpl`
 * baseline (sync/async reentrancy guard, atomic splice+reverse teardown) with the sync path removed
 * per D-1 and error handling generalized to the four §4.5 policies.
 */
export function createLifecycleScope(options: ILifecycleScopeOptions = {}): ILifecycleScope {
  const errorPolicy = options.errorPolicy ?? 'throw'
  const scheduler = resolveSchedulerOption(options)
  const terminal = createTerminalController()
  const createController = captureAbortControllerFactory()
  const closingController = createController()
  /** Immutable owner-bound capability shared by this scope's release callbacks. */
  const disposerContext = createDisposerContext()
  const entries: Array<{
    readonly resource: unknown
    readonly source: string
    readonly descriptor: IReleaseDescriptor
    readonly unregisterToken?: object
  }> = []
  let nextId = 0
  let disposePromise: Promise<readonly ICollectedError[]> | undefined
  /**
   * True for the whole duration of the teardown loop (from the first item's release call to the
   * last). Reentrant `own()`/`dispose()` calls made from inside a disposer happen while this is
   * true; the throw they trigger propagates up through that disposer's own await/try, so normal
   * call-stack unwinding — not per-item bookkeeping here — attributes the error to the right item.
   */
  let currentlyReleasing = false
  let activeDisposerSynchronously = false

  /** Invokes one user callback while marking only its synchronous call frame as active. */
  const invokeDisposerCallback = (
    callback: (context: IReleaseContext) => void | PromiseLike<void>,
    context: IReleaseContext
  ): void | PromiseLike<void> => {
    activeDisposerSynchronously = true
    let result: void | PromiseLike<void> = undefined
    try {
      result = callback(context)
    } finally {
      activeDisposerSynchronously = false
    }
    return result
  }

  /**
   * Wraps release callbacks lazily so self-dispose is fail-fast without rejecting external joiners.
   * The facade must not read or spread descriptor fields here: DisposeTransaction owns the single
   * per-item admission read and receives any hostile getter failure for policy handling.
   */
  const guardDescriptor = (descriptor: IReleaseDescriptor): IReleaseDescriptor => {
    /** Lazy field facade consumed by DisposeTransaction's descriptor admission boundary. */
    const guarded = {} as IReleaseDescriptor
    Object.defineProperties(guarded, {
      order: {
        get: () => descriptor.order
      },
      graceful: {
        get: () => {
          const graceful = descriptor.graceful
          return typeof graceful === 'function'
            ? (context: IReleaseContext) => invokeDisposerCallback(graceful, context)
            : graceful
        }
      },
      gracefulTimeoutMs: {
        get: () => descriptor.gracefulTimeoutMs
      },
      force: {
        get: () => {
          const force = descriptor.force
          return typeof force === 'function'
            ? (context: IReleaseContext) => invokeDisposerCallback(force, context)
            : force
        }
      },
      custom: {
        get: () => {
          const custom = descriptor.custom
          return typeof custom === 'function'
            ? (context: IReleaseContext) => invokeDisposerCallback(custom, context)
            : custom
        }
      }
    })
    return guarded
  }

  const assertOpen = (): void => {
    if (terminal.lifecycle === LifecycleState.terminal) {
      throw createLifecycleError(LifecycleErrorCode.scopeTerminal, '[lifecycle] scope is terminal')
    }
    if (terminal.lifecycle === LifecycleState.closing) {
      throw createLifecycleError(LifecycleErrorCode.scopeClosed, '[lifecycle] scope is closing')
    }
  }

  const own = <T>(resource: T, descriptor: IReleaseDescriptor): T => {
    if (currentlyReleasing) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        '[lifecycle] cannot call own() from within this scope’s own dispose()'
      )
    }
    assertOpen()
    let unregisterToken: object | undefined
    if (
      descriptor.gcFallback &&
      finalizationRegistry &&
      resource !== null &&
      typeof resource === 'object'
    ) {
      unregisterToken = {}
      const runForce = (): void => {
        const context: IReleaseContext = {
          signal: createController().signal,
          deadlineAt: undefined,
          report: (error) => {
            if (!options.report) return
            try {
              options.report(error)
            } catch {
              // Last error boundary for the reporter's own synchronous failures.
            }
          }
        }
        try {
          containAsyncRejection(descriptor.force(context), (error) => context.report(error))
        } catch (error) {
          context.report(error)
        }
      }
      finalizationRegistry.register(resource, runForce, unregisterToken)
    }
    entries.push({ resource, source: String(nextId++), descriptor, unregisterToken })
    return resource
  }

  const unregisterGcFallback = (unregisterToken: object | undefined): void => {
    if (unregisterToken !== undefined) finalizationRegistry?.unregister(unregisterToken)
  }

  const release = (resource: unknown): boolean => {
    const index = entries.findIndex((entry) => entry.resource === resource)
    if (index < 0) return false
    const [entry] = entries.splice(index, 1)
    // The caller has already released this resource independently — the GC-fallback finalizer
    // must not run `force` a second time (L-T19).
    unregisterGcFallback(entry?.unregisterToken)
    return true
  }

  const close = (): void => {
    terminal.close()
    closingController.abort('scope closed')
  }

  const performDispose = async (): Promise<readonly ICollectedError[]> => {
    close()
    // Atomic: nothing added between the snapshot and the loop, nothing skipped, nothing doubled
    // (L-T33). LIFO order; `DisposeTransaction`'s order-mode stable sort preserves this for
    // same-`order` items.
    const snapshot = entries.splice(0).reverse()
    // Every one of these is about to be explicitly released by the transaction below; the
    // GC-fallback finalizer must not also fire for any of them afterward.
    for (const entry of snapshot) unregisterGcFallback(entry.unregisterToken)
    // Only meaningful when there is at least one disposer to run — an empty scope never invokes
    // user code, so a second concurrent dispose() call on it is unambiguously not reentrant with
    // respect to any disposer and must reuse the same promise (L-T29).
    currentlyReleasing = snapshot.length > 0
    try {
      const transaction = createDisposeTransaction(
        { kind: DisposeTransactionKind.order },
        {
          errorPolicy,
          report: options.report,
          deadlineAt: options.deadlineAt,
          scheduler,
          signal: closingController.signal,
          disposer: disposerContext
        }
      )
      return await transaction.run(
        snapshot.map((entry) => ({
          source: entry.source,
          descriptor: guardDescriptor(entry.descriptor)
        }))
      )
    } finally {
      currentlyReleasing = false
      terminal.forceTerminal()
    }
  }

  const dispose = (): Promise<readonly ICollectedError[]> => {
    if (disposePromise) {
      if (activeDisposerSynchronously) {
        throw createLifecycleError(
          LifecycleErrorCode.scopeReentrantDispose,
          LifecycleErrorText.scopeReentrantDispose
        )
      }
      // Concurrent, non-reentrant call: reuse the one real disposal in flight (L-T29).
      return disposePromise
    }
    if (terminal.lifecycle === LifecycleState.terminal) return Promise.resolve([])
    // Assign the promise identity synchronously, *before* `performDispose()` runs any user code —
    // calling an async function still lets its body run synchronously up to its first genuine
    // suspension point, and for a scope whose very first owned resource reentrantly calls
    // `dispose()` from a synchronous callback, that reentrant call happens before this function's
    // own `await` would otherwise have assigned `disposePromise` on return. Without the early
    // assignment here, that first-item case would see `disposePromise` still falsy and start a
    // second, independent teardown instead of being caught as reentrant.
    let resolveDispose!: (value: readonly ICollectedError[]) => void
    let rejectDispose!: (error: unknown) => void
    disposePromise = new Promise<readonly ICollectedError[]>((resolve, reject) => {
      resolveDispose = resolve
      rejectDispose = reject
    })
    performDispose().then(resolveDispose, rejectDispose)
    return disposePromise
  }

  const scope: ILifecycleScope & { [ASYNC_OWNER_BRAND]?: true } = {
    [ASYNC_OWNER_BRAND]: true,
    get lifecycle() {
      return terminal.lifecycle
    },
    own,
    release,
    close,
    dispose
  }

  if (asyncDisposeKey) {
    Object.defineProperty(scope, asyncDisposeKey, {
      value: async () => {
        await dispose()
      },
      enumerable: false
    })
  }

  return scope
}
