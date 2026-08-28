import type {
  ICollectedError,
  IErrorPolicy,
  IReleaseContext,
  IReleaseDescriptor,
  ILifecycleState
} from './types.js'
import { ASYNC_OWNER_BRAND } from './types.js'
import { createLifecycleError, createErrorCollector, probeThenable } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { createTerminalController } from './terminal-controller.js'
import { captureAbortControllerFactory } from './abort-factory.js'
import { LifecycleState, ThenableProbeKind } from './state-constants.js'

const disposeKey = (Symbol as typeof Symbol & { dispose?: symbol }).dispose

/** A descriptor accepted by `SyncLifecycleScope`: `syncSafe` is required and must be `true`. */
export type ISyncReleaseDescriptor = IReleaseDescriptor & { readonly syncSafe: true }

export type ISyncLifecycleScopeOptions = {
  readonly errorPolicy?: IErrorPolicy
  readonly report?: (error: unknown) => void
}

export type ISyncLifecycleScope = {
  readonly lifecycle: ILifecycleState
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  /** Always synchronous — this is the whole reason this type exists (D-6). */
  dispose(): readonly ICollectedError[]
}

type ICallbackOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }

function runSyncCallback(
  callback: (context: IReleaseContext) => void | PromiseLike<void>,
  context: IReleaseContext
): ICallbackOutcome {
  let result: void | PromiseLike<void>
  try {
    result = callback(context)
  } catch (error) {
    return { ok: false, error }
  }
  // 单次探测：hostile `.then` getter 的异常也必须作为本项失败进入 error policy，绝不逃逸出释放循环。
  const probe = probeThenable(result)
  if (probe.kind === ThenableProbeKind.failed) return { ok: false, error: probe.error }
  if (probe.kind === 'thenable') {
    return {
      ok: false,
      error: createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        '[lifecycle] a syncSafe descriptor callback returned a thenable — SyncLifecycleScope never awaits'
      )
    }
  }
  return { ok: true }
}

/**
 * Same degrade order as the async path (custom skips the rest; graceful throwing still runs force),
 * minus any timeout race — there is nothing to await.
 */
function executeSyncDescriptor(
  descriptor: ISyncReleaseDescriptor,
  context: IReleaseContext
): readonly unknown[] {
  if (descriptor.custom) {
    const outcome = runSyncCallback(descriptor.custom, context)
    return outcome.ok ? [] : [outcome.error]
  }
  const errors: unknown[] = []
  if (descriptor.graceful) {
    const gracefulOutcome = runSyncCallback(descriptor.graceful, context)
    if (gracefulOutcome.ok) return []
    errors.push(gracefulOutcome.error)
  }
  const forceOutcome = runSyncCallback(descriptor.force, context)
  if (!forceOutcome.ok) errors.push(forceOutcome.error)
  return errors
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
  const terminal = createTerminalController()
  const entries: Array<{
    readonly resource: unknown
    readonly source: string
    readonly descriptor: ISyncReleaseDescriptor
  }> = []
  let nextId = 0
  let disposed = false
  let currentlyReleasing = false

  const assertOpen = (): void => {
    if (terminal.lifecycle === LifecycleState.terminal) {
      throw createLifecycleError(LifecycleErrorCode.scopeTerminal, '[lifecycle] scope is terminal')
    }
    if (terminal.lifecycle === LifecycleState.closing) {
      throw createLifecycleError(LifecycleErrorCode.scopeClosed, '[lifecycle] scope is closing')
    }
  }

  const own = <T>(resource: T, descriptor: ISyncReleaseDescriptor): T => {
    if (currentlyReleasing) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        '[lifecycle] cannot call own() from within this scope’s own dispose()'
      )
    }
    assertOpen()
    if (descriptor?.syncSafe !== true) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        '[lifecycle] SyncLifecycleScope requires an explicit `syncSafe: true` descriptor'
      )
    }
    const brand = (resource as { readonly [ASYNC_OWNER_BRAND]?: true } | null | undefined)?.[
      ASYNC_OWNER_BRAND
    ]
    if (brand === true) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        '[lifecycle] SyncLifecycleScope cannot own a LifecycleScope or ProvisionalScope instance'
      )
    }
    entries.push({ resource, source: String(nextId++), descriptor })
    return resource
  }

  const release = (resource: unknown): boolean => {
    const index = entries.findIndex((entry) => entry.resource === resource)
    if (index < 0) return false
    entries.splice(index, 1)
    return true
  }

  const close = (): void => {
    terminal.close()
  }

  const dispose = (): readonly ICollectedError[] => {
    if (disposed || terminal.lifecycle === LifecycleState.terminal) {
      if (currentlyReleasing) {
        throw createLifecycleError(
          LifecycleErrorCode.scopeReentrantDispose,
          '[lifecycle] cannot call dispose() re-entrantly on the same scope'
        )
      }
      return []
    }
    close()
    disposed = true
    const released = entries.splice(0).reverse()
    // Explicit release orders are used by synchronous owners that need a source-before-query
    // barrier. Legacy callers with omitted orders retain the documented LIFO behavior.
    const snapshot = released.some((entry) => entry.descriptor.order !== undefined)
      ? [...released].sort(
          (left, right) => (right.descriptor.order ?? 0) - (left.descriptor.order ?? 0)
        )
      : released
    currentlyReleasing = true
    const collector = createErrorCollector(errorPolicy, options.report)
    const controller = createController()
    controller.abort('scope closed')
    try {
      for (const entry of snapshot) {
        const context: IReleaseContext = {
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
        }
        const errors = executeSyncDescriptor(entry.descriptor, context)
        for (const error of errors) collector.add(entry.source, error)
      }
    } finally {
      currentlyReleasing = false
      terminal.forceTerminal()
    }
    return collector.finalize('[lifecycle] sync lifecycle scope disposal failed')
  }

  const scope: ISyncLifecycleScope = {
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

  return scope
}
