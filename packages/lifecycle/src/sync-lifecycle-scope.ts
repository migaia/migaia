import { assertErrorPolicyReporter } from './error-boundary.js'
import type { ICollectedError, IErrorPolicy, IReleaseDescriptor, ILifecycleState } from './types.js'
import { ASYNC_OWNER_BRAND } from './types.js'
import { createLifecycleError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createOwnedEntryList } from './owned-entries.js'
import { createTerminalController } from './terminal-controller.js'
import { captureAbortControllerFactory } from './abort-factory.js'
import { DisposeTransactionKind, LifecycleState } from './state-constants.js'
import { admitDescriptor, admitItems } from './dispose-transaction.js'
import { executeSyncDisposeTransaction } from './sync-dispose-transaction.js'

const disposeKey = (Symbol as typeof Symbol & { dispose?: symbol }).dispose

/** A descriptor accepted by `SyncLifecycleScope`: `syncSafe` is required and must be `true`. */
export type ISyncReleaseDescriptor = IReleaseDescriptor & { readonly syncSafe: true }

export type ISyncLifecycleScopeOptions = {
  readonly errorPolicy?: IErrorPolicy
  /**
   * Reporter for failures the error policy does not throw or collect. Required when `errorPolicy`
   * is `report` or `firstError`; otherwise the factory throws `INVALID_OPTION` with `detail.field:
   * 'report'`.
   */
  readonly report?: (error: unknown) => void
}

export type ISyncLifecycleScope = {
  readonly lifecycle: ILifecycleState
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  /** Always synchronous — this is the whole reason this type exists (D-6). */
  dispose(): readonly ICollectedError[]
  /** Releases the scope synchronously for `using`, discarding the collected-error result. */
  [Symbol.dispose](): void
}

/**
 * The `syncSafe`-only scope. Exists so a scope that owns nothing but reactive-graph-style nodes can
 * offer a real, deterministic `[Symbol.dispose]` instead of the general `LifecycleScope`'s
 * always-async `[Symbol.asyncDispose]` (D-6).
 */
export function createSyncLifecycleScope(
  options: ISyncLifecycleScopeOptions = {}
): ISyncLifecycleScope {
  const createController = captureAbortControllerFactory()
  const errorPolicy = options.errorPolicy ?? 'throw'
  assertErrorPolicyReporter(errorPolicy, options.report)
  const terminal = createTerminalController()
  /** Live owned resources in registration order with O(1) release lookup (LC-P1). */
  const entries = createOwnedEntryList<{
    readonly resource: unknown
    readonly source: string
    readonly descriptor: ISyncReleaseDescriptor
  }>()
  let nextId = 0
  let disposed = false
  let currentlyReleasing = false

  const assertOpen = (): void => {
    if (terminal.lifecycle === LifecycleState.terminal) {
      throw createLifecycleError(LifecycleErrorCode.scopeTerminal, LifecycleErrorText.scopeTerminal)
    }
    if (terminal.lifecycle === LifecycleState.closing) {
      throw createLifecycleError(LifecycleErrorCode.scopeClosed, LifecycleErrorText.scopeClosing)
    }
  }

  const own = <T>(resource: T, descriptor: ISyncReleaseDescriptor): T => {
    if (currentlyReleasing) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        LifecycleErrorText.scopeReentrantOwn
      )
    }
    assertOpen()
    if (descriptor?.syncSafe !== true) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        LifecycleErrorText.syncScopeRequiresSyncSafe
      )
    }
    // Validation only, shared with the async path so a bad `order` or missing `force` gets the same
    // INVALID_OPTION at registration; dispose() keeps its own descriptor snapshot.
    const admission = admitDescriptor(descriptor, true)
    if (!admission.ok) throw admission.error
    const brand = (resource as { readonly [ASYNC_OWNER_BRAND]?: true } | null | undefined)?.[
      ASYNC_OWNER_BRAND
    ]
    if (brand === true) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        LifecycleErrorText.syncScopeOwnsAsyncOwner
      )
    }
    entries.push({ resource, source: String(nextId++), descriptor })
    return resource
  }

  const release = (resource: unknown): boolean => {
    return entries.release(resource) !== undefined
  }

  const close = (): void => {
    terminal.close()
  }

  const dispose = (): readonly ICollectedError[] => {
    if (disposed || terminal.lifecycle === LifecycleState.terminal) {
      if (currentlyReleasing) {
        throw createLifecycleError(
          LifecycleErrorCode.scopeReentrantDispose,
          LifecycleErrorText.scopeReentrantDispose
        )
      }
      return []
    }
    close()
    disposed = true
    const released = entries.drain().reverse()
    /** Canonical admission snapshots every item before the first callback and preserves LIFO ties. */
    const admission = admitItems(released, { kind: DisposeTransactionKind.order }, true)
    currentlyReleasing = true
    const controller = createController()
    controller.abort(
      createLifecycleError(LifecycleErrorCode.scopeClosed, LifecycleErrorText.scopeClosedReason)
    )
    try {
      return executeSyncDisposeTransaction(
        admission,
        () => ({
          signal: controller.signal,
          deadlineAt: undefined,
          report: (error) => {
            if (!options.report) return
            try {
              options.report(error)
            } catch {
              // Last error boundary for the reporter's own synchronous failures.
            }
          }
        }),
        errorPolicy,
        options.report
      )
    } finally {
      currentlyReleasing = false
      terminal.forceTerminal()
    }
  }

  const scope: Omit<ISyncLifecycleScope, typeof Symbol.dispose> = {
    get lifecycle() {
      return terminal.lifecycle
    },
    own,
    release,
    close,
    dispose
  }

  if (disposeKey) {
    Object.defineProperty(scope, disposeKey, {
      value: () => {
        dispose()
      },
      enumerable: false
    })
  }

  // The supported host's symbol hook is installed above without making it enumerable.
  return scope as ISyncLifecycleScope
}
