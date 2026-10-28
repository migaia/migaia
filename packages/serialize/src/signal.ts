/** Signal composition owns listener arbitration and cleanup; lifecycle owns abort controllers. */
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.ts'
import { createAbortController } from '@migaia/lifecycle/abort'
import {
  isSerializeTaggedError,
  readAborted,
  readReason,
  snapshotSerializeSignal
} from './signal-snapshot.ts'

/** Internal registration record used to make signal-listener rollback idempotent. */
type IListenerRegistration = {
  readonly signal: IAbortSignal
  readonly listener: () => void
  attempted: boolean
  removed: boolean
}

/** A listener wrapper contains caller failure without changing the composed signal's abort state. */
function reportedAbortListener(
  listener: () => void,
  owner: SerializeSignalComposition
): () => void {
  return () => {
    try {
      listener()
    } catch (error) {
      owner.reportCleanupFailure(error)
    }
  }
}

/**
 * Construct the plain exposed signal while keeping listener identity and failure ownership
 * explicit.
 */
function composedSignalFacade(owner: SerializeSignalComposition): IAbortSignal {
  return {
    get aborted() {
      return owner.aborted
    },
    get reason() {
      return owner.reason
    },
    addEventListener: (type, listener, options) => owner.addListener(type, listener, options),
    removeEventListener: (type, listener) => owner.removeListener(type, listener)
  }
}

/** One composition owns its two source registrations and its exposed listener identity table. */
class SerializeSignalComposition {
  /** Existing lifecycle controller retains first-observed abort semantics. */
  readonly #composed = createAbortController()
  /** Reporter remains a bare callback, matching its original receiver and failure containment. */
  readonly #report: (error: unknown) => void
  /** Optional caller admission snapshot is installed before the closing source. */
  readonly #caller: IAbortSignal | undefined
  /** Closing admission snapshot wins only when observed before the caller. */
  readonly #closing: IAbortSignal
  /** Fixed install-order snapshot has exactly two slots, one per supported source. */
  readonly #registrations: readonly IListenerRegistration[]
  /** Reentrant add calls defer removal until their return boundary. */
  #registrationDepth = 0
  /** Terminal cleanup request survives a synchronous callback during registration. */
  #cleanupRequested = false
  /** Terminal cleanup prevents repeated abort and listener release. */
  #disposed = false
  /** Exposed callbacks retain their matching wrapper until removal or composition disposal. */
  readonly #exposedListeners = new Map<() => void, () => void>()
  /** The public signal keeps the original plain own-property shape. */
  readonly #exposedSignal: IAbortSignal
  /** The public result retains own signal/dispose fields and permits method destructuring. */
  readonly result: { readonly signal: IAbortSignal; readonly dispose: () => void }

  /** Capture admitted sources and stable listeners before attempting external registration. */
  constructor(
    caller: IAbortSignal | undefined,
    closing: IAbortSignal,
    report: (error: unknown) => void
  ) {
    this.#caller = caller
    this.#closing = closing
    this.#report = report
    this.#registrations = [
      {
        signal: caller!,
        listener: () => this.#observeAbort(this.#caller!),
        attempted: false,
        removed: false
      },
      {
        signal: closing,
        listener: () => this.#observeAbort(this.#closing),
        attempted: false,
        removed: false
      }
    ]
    this.#exposedSignal = composedSignalFacade(this)
    this.result = { signal: this.#exposedSignal, dispose: () => this.dispose() }
  }

  /** Expose controller abort state without publishing the controller itself. */
  get aborted(): boolean {
    return this.#composed.signal.aborted
  }

  /** Expose the controller's first abort reason with its original identity. */
  get reason(): unknown {
    return this.#composed.signal.reason
  }

  /** Install caller then closing, retaining the historical post-registration recheck order. */
  start(): { readonly signal: IAbortSignal; readonly dispose: () => void } {
    try {
      if (this.#caller !== undefined) this.#register(this.#registrations[0]!)
      if (
        (this.#caller !== undefined && this.#recheck(this.#caller)) ||
        this.#recheck(this.#closing)
      )
        return this.result
      this.#register(this.#registrations[1]!)
      if (this.#caller !== undefined) this.#recheck(this.#caller)
      this.#recheck(this.#closing)
      return this.result
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  /** Request idempotent removal, deferring active source registration until its return boundary. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#cleanupRequested = true
    this.#exposedListeners.clear()
    this.#cleanupListeners()
  }

  /** Secondary reporter failures cannot replace source registration or cancellation failures. */
  reportCleanupFailure(error: unknown): void {
    try {
      /** Bare invocation preserves the reporter's original undefined receiver. */
      const report = this.#report
      report(error)
    } catch {
      // Secondary reporter failure must not escape signal cleanup.
    }
  }

  /** Register one wrapped exposed listener and retain exact identity for removal. */
  addListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void {
    if (this.#exposedListeners.has(listener)) return
    /** One wrapper reports callback failures while preserving its map identity. */
    const wrapped = reportedAbortListener(listener, this)
    this.#exposedListeners.set(listener, wrapped)
    try {
      this.#composed.signal.addEventListener(type, wrapped, options)
    } catch (error) {
      this.#exposedListeners.delete(listener)
      throw error
    }
  }

  /** Delete the identity entry before external removal so reentry cannot release it twice. */
  removeListener(type: 'abort', listener: () => void): void {
    /** Missing listeners require no controller-side removal. */
    const wrapped = this.#exposedListeners.get(listener)
    if (wrapped === undefined) return
    this.#exposedListeners.delete(listener)
    this.#composed.signal.removeEventListener(type, wrapped)
  }

  /** Remove attempted registrations once in strict reverse order, continuing after failures. */
  #cleanupListeners(): void {
    if (this.#registrationDepth > 0) return
    // The two source slots are fixed by the composition contract; avoid a copied reverse array.
    for (let index = this.#registrations.length - 1; index >= 0; index--) {
      /** The fixed slot is marked before external removal to preserve idempotency under reentry. */
      const registration = this.#registrations[index]!
      if (!registration.attempted || registration.removed) continue
      registration.removed = true
      try {
        registration.signal.removeEventListener('abort', registration.listener)
      } catch (error) {
        this.reportCleanupFailure(error)
      }
    }
  }

  /** Abort once, then release all attempted source listeners even if controller notification fails. */
  #abortComposed(reason: unknown): void {
    if (this.#disposed) return
    if (!this.#composed.signal.aborted) {
      try {
        this.#composed.abort(reason)
      } finally {
        this.dispose()
      }
      return
    }
    this.dispose()
  }

  /** Convert hostile asynchronous source reads into the existing package-owned abort failure. */
  #observeAbort(source: IAbortSignal): void {
    try {
      this.#abortComposed(readReason(source))
    } catch (error) {
      try {
        this.#abortComposed(
          isSerializeTaggedError(error)
            ? error
            : createSerializeTypeError(
                SerializeErrorCode.invalidOption,
                SerializeErrorText.signalAccessorFailed,
                { cause: error }
              )
        )
      } catch (abortError) {
        this.reportCleanupFailure(abortError)
      }
    }
  }

  /** Mark admission before external add so stored-then-throw sources still receive rollback. */
  #register(registration: IListenerRegistration): void {
    registration.attempted = true
    this.#registrationDepth++
    try {
      registration.signal.addEventListener('abort', registration.listener, { once: true })
    } catch (error) {
      this.dispose()
      throw createSerializeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.signalRegistrationFailed,
        { cause: error }
      )
    } finally {
      this.#registrationDepth--
      if (this.#registrationDepth === 0 && this.#cleanupRequested) this.#cleanupListeners()
    }
  }

  /** Recheck after registration because structural signals need not replay a just-fired event. */
  #recheck(source: IAbortSignal): boolean {
    if (!readAborted(source)) return false
    this.#abortComposed(readReason(source))
    return true
  }
}

/**
 * Compose caller and closing signals with first-observed-wins arbitration. Snapshot admission and
 * pre-abort precedence remain unchanged; a named owner handles registration rollback and cleanup.
 */
export function composeSerializeSignal(
  caller: IAbortSignal | undefined,
  closing: IAbortSignal,
  report: (error: unknown) => void
): { readonly signal: IAbortSignal; readonly dispose: () => void } {
  /** Closing admission precedes caller access and wins when already aborted. */
  const closingSnapshot = snapshotSerializeSignal(closing)
  if (readAborted(closingSnapshot)) return { signal: closingSnapshot, dispose: () => {} }
  /** Caller admission retains its own pre-abort reason before any listener is installed. */
  const callerSnapshot = caller === undefined ? undefined : snapshotSerializeSignal(caller)
  if (callerSnapshot !== undefined && readAborted(callerSnapshot)) {
    readReason(callerSnapshot)
    return { signal: callerSnapshot, dispose: () => {} }
  }
  return new SerializeSignalComposition(callerSnapshot, closingSnapshot, report).start()
}

/** One operation owns its controller while borrowing the existing composition listener protocol. */
class SerializeOperationSignal {
  /** Lifecycle owns actual controller creation and its first-abort behavior. */
  readonly #owner = createAbortController()
  /** Reports secondary controller failures without changing the cancellation outcome. */
  readonly #report: (error: unknown) => void
  /** Plain result preserves own keys, method receiver independence, and borrowed dispose identity. */
  readonly result: {
    readonly signal: IAbortSignal
    readonly abort: (reason?: unknown) => void
    readonly dispose: () => void
  }

  /** Compose once before publishing the operation's independently callable handle. */
  constructor(caller: IAbortSignal | undefined, report: (error: unknown) => void) {
    this.#report = report
    /** Composition retains the original signal and exact dispose callback identity. */
    const composed = composeSerializeSignal(caller, this.#owner.signal, report)
    this.result = {
      signal: composed.signal,
      abort: (reason) => this.#abort(reason),
      dispose: composed.dispose
    }
  }

  /** Controller/report failures remain secondary to the operation's primary cancellation. */
  #abort(reason?: unknown): void {
    try {
      this.#owner.abort(reason)
    } catch (error) {
      try {
        /** Bare reporter invocation retains the historical receiver. */
        const report = this.#report
        report(error)
      } catch {
        // Secondary reporting failure cannot replace the operation's primary cancellation.
      }
    }
  }
}

/** Create an operation through the existing lifecycle controller and signal composition owner. */
export function createSerializeOperationSignal(
  caller: IAbortSignal | undefined,
  report: (error: unknown) => void
): {
  readonly signal: IAbortSignal
  readonly abort: (reason?: unknown) => void
  readonly dispose: () => void
} {
  return new SerializeOperationSignal(caller, report).result
}
