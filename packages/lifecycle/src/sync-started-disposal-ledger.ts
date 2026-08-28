import { createLifecycleError, probeThenable, assimilateCapturedThen } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { LifecycleState } from './state-constants.js'
import type { ICollectedError, ILifecycleState } from './types.js'

/** Raw outcome exposed to adapters after a complete synchronous-start disposal plan. */
export type ISyncStartedDisposalOutcome = Readonly<{
  synchronousErrors: readonly ICollectedError[]
  completion: Promise<readonly ICollectedError[]>
}>

/**
 * Lifecycle-owned ledger that starts every callback synchronously, then observes all async
 * settlements until a sealed plan reaches terminal. Domain adapters own ordering and error
 * projection; this primitive owns only admission, pending, and raw error observation.
 */
export type ISyncStartedDisposalLedger = {
  readonly lifecycle: ILifecycleState
  readonly pending: number
  start(source: string, callback: () => unknown): void
  seal(): ISyncStartedDisposalOutcome
  whenTerminal(): Promise<void>
}

/** Creates one sync-start, async-completion disposal ledger. */
export function createSyncStartedDisposalLedger(): ISyncStartedDisposalLedger {
  let lifecycle: ILifecycleState = LifecycleState.open
  let pending = 0
  let activeItem = false
  let outcome: ISyncStartedDisposalOutcome | undefined
  let resolveCompletion: ((errors: readonly ICollectedError[]) => void) | undefined
  const errors: ICollectedError[] = []
  const synchronousErrors: ICollectedError[] = []
  const completion = new Promise<readonly ICollectedError[]>((resolve) => {
    resolveCompletion = resolve
  })
  void completion.catch(() => undefined)

  /** Settles the raw completion exactly once after seal and every thenable have settled. */
  const finishIfReady = (): void => {
    if (lifecycle !== LifecycleState.closing || pending !== 0) return
    lifecycle = LifecycleState.terminal
    const snapshot = Object.freeze([...errors])
    resolveCompletion?.(snapshot)
    resolveCompletion = undefined
  }

  /** Records one callback failure, preserving source and settlement observation order. */
  const record = (source: string, error: unknown, synchronous: boolean): void => {
    const item = Object.freeze({ source, error })
    errors.push(item)
    if (synchronous) synchronousErrors.push(item)
  }

  /** Throws the appropriate lifecycle boundary error before a new operation can mutate state. */
  const assertOpen = (): void => {
    if (activeItem) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        LifecycleErrorText.disposalLedgerReentrant
      )
    }
    if (lifecycle !== LifecycleState.open) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeClosed,
        LifecycleErrorText.disposalLedgerClosed
      )
    }
  }

  /** Starts one callback on the caller's current stack and observes thenable completion once. */
  const start = (source: string, callback: () => unknown): void => {
    if (typeof source !== 'string' || typeof callback !== 'function') {
      throw createLifecycleError(
        LifecycleErrorCode.invalidOption,
        LifecycleErrorText.disposeDescriptorInvalid
      )
    }
    assertOpen()
    activeItem = true
    let result: unknown
    try {
      try {
        result = callback()
      } catch (error) {
        record(source, error, true)
        return
      }
      const probe = probeThenable(result)
      if (probe.kind === 'failed') {
        record(source, probe.error, true)
        return
      }
      if (probe.kind === 'not-thenable') return
      const promise = assimilateCapturedThen<void>(probe.thenFn, result)
      pending++
      void promise.then(
        () => {
          pending--
          finishIfReady()
        },
        (error) => {
          record(source, error, false)
          pending--
          finishIfReady()
        }
      )
    } finally {
      activeItem = false
    }
  }

  /** Seals admission and returns one immutable outcome object for all repeated callers. */
  const seal = (): ISyncStartedDisposalOutcome => {
    if (activeItem) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeReentrantOwn,
        LifecycleErrorText.disposalLedgerReentrant
      )
    }
    if (outcome) return outcome
    if (lifecycle !== LifecycleState.open) {
      throw createLifecycleError(
        LifecycleErrorCode.scopeClosed,
        LifecycleErrorText.disposalLedgerClosed
      )
    }
    lifecycle = LifecycleState.closing
    outcome = Object.freeze({
      synchronousErrors: Object.freeze([...synchronousErrors]),
      completion
    })
    finishIfReady()
    return outcome
  }

  return {
    get lifecycle() {
      return lifecycle
    },
    get pending() {
      return pending
    },
    start,
    seal,
    whenTerminal: () => completion.then(() => undefined)
  }
}
