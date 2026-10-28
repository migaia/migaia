import { DurableErrorField } from './errors.ts'
import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import { noop } from '@migaia/utils/function'
import type { ILogPluginCore } from '@migaia/log-host/plugin'
import {
  createDurableError,
  createDurableTypeError,
  tagDurableError,
  LogDurableErrorCode,
  ERROR_SOURCE
} from './errors.ts'
import { createObservation } from './observation.ts'
import { logStorageFailure } from './store.ts'
import { assertLogInteger } from './committed-index.ts'
import { LogOperation, LogStage } from './state-constants.ts'
import { DurableText } from './error-text.ts'
import type { IDurablePluginOptions, ILogAppendPort, ILogPayload, ILogStore } from './types.ts'

/** One installed borrower has authority only over its own use of the original resource. */
const borrowers = new WeakMap<ILogStore, object>()
/** The log host lends its canonical peer lifecycle and disposal registration. */
export type IDurableCore = ILogPluginCore
/** Initialization remains an optional callback owned by the actual plugin index. */
type IInitializer = () => Promise<void>
/** Transaction payloads are already captured before entering this boundary. */
type IPortRecords = readonly { readonly kind: string; readonly payload: ILogPayload }[]

/** One installation owns borrowed-store admission and reuses the original utility FIFO. */
class DurableRuntime {
  /** The immutable original core supplies the sole lifecycle and failure policy. */
  readonly core: IDurableCore
  /** The injected storage resource remains owned by its creator. */
  readonly store: ILogStore
  /** Every ordinary operation and native-port completion is accounted by one canonical limiter. */
  readonly #limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** This identity releases only its own WeakMap borrow. */
  readonly #identity = {}
  /** The owner discriminator is metadata, never transaction authority. */
  readonly #owner: 'binlog' | 'wal' | 'undo'
  /** Initialization only rebuilds this plugin's original data index. */
  readonly #initialize: IInitializer | undefined
  /** Revocation stops new calls without cancelling already accepted FIFO work. */
  #accepting = true
  /** Immediate transaction ports require the actual store initialization to have completed. */
  #prepared = false
  /** Failed initialization is retained for every later handle call. */
  #initializationError: Error | undefined
  /** This exact Promise remains stable for the installation lifetime. */
  readonly #ready: Promise<void>
  /** One immutable optional observer receives metadata only. */
  readonly observe: ReturnType<typeof createObservation>
  /** Source subscriptions and pending transaction callbacks release on revocation. */
  readonly cleanups = new Set<() => void>()
  /** Plugin indexes release after accepted work has drained. */
  readonly afterIdle = new Set<() => void>()
  /** The peer registration is removed only after the installation drains. */
  readonly #offShutdown: () => void
  /** The host's flush registration borrows this original limiter barrier. */
  readonly #offFlush: () => void

  /** Acquire one borrow and register canonical host cleanup before initializing the store. */
  constructor(
    core: IDurableCore,
    options: IDurablePluginOptions,
    owner: 'binlog' | 'wal' | 'undo',
    initialize?: IInitializer
  ) {
    this.core = core
    this.store = options.store
    this.#owner = owner
    this.#initialize = initialize
    if (!this.store || typeof this.store !== 'object')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    if (borrowers.has(this.store))
      throw createDurableError(LogDurableErrorCode.logStoreInUse, DurableText.inUse)
    borrowers.set(this.store, this.#identity)
    this.observe = createObservation(options, this.reportHook)
    core.lifecycle.signal.addEventListener('abort', this.stop, { once: true })
    this.#offShutdown = core.onShutdown(this.stop)
    this.#offFlush = core.onFlush(this.whenIdle)
    core.onDispose(this.#disposeResource)
    this.observe(() => ({
      stage: LogStage.beforeLogOpen,
      owner: this.#owner,
      operation: LogOperation.open
    }))
    this.#ready = this.#limiter.run(this.#initializeStore)
    void this.#ready.catch(noop)
  }
  /** Host sink provenance preserves each original storage error and cause. */
  readonly report = (error: unknown): void => this.core.reportFailure({ source: 'sink', error })
  /** Observer failures stay on the host's existing hook failure channel. */
  readonly reportHook = (error: unknown): void => this.core.reportFailure({ source: 'hook', error })
  /** Native listener identity is stable for registration and revocation. */
  readonly stop = (): void => this.#stop()
  /** Every retained nested handle consults this registration, never its replacement. */
  readonly ready = (): Promise<void> => this.#readyResult()
  /** The unchanged limiter owns this exact current idle barrier. */
  readonly whenIdle = (): Promise<void> => this.#limiter.whenIdle()
  /** Live delivery does not gain authority after this installation is revoked. */
  active(): boolean {
    return this.#accepting && !this.core.lifecycle.signal.aborted
  }
  /** Reject after revocation or failed initialization without hiding the original error. */
  admit(): void {
    if (this.#initializationError) throw this.#initializationError
    if (!this.#accepting || this.core.lifecycle.signal.aborted)
      throw createDurableError(LogDurableErrorCode.runtimeShuttingDown, DurableText.closed)
  }
  /** Return initialization's stable Promise only while this registration still accepts work. */
  #readyResult(): Promise<void> {
    try {
      this.admit()
      return this.#ready
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /** Only this installation can return its original borrowed store identity. */
  #release(): void {
    if (borrowers.get(this.store) === this.#identity) borrowers.delete(this.store)
  }
  /** Stop subscriptions immediately while keeping accepted ordinary operations intact. */
  #stop(): void {
    if (!this.#accepting) return
    this.#accepting = false
    this.observe(() => ({
      stage: LogStage.beforeLogClose,
      owner: this.#owner,
      operation: LogOperation.close
    }))
    for (const cleanup of this.cleanups) {
      try {
        cleanup()
      } catch (error) {
        this.reportHook(error)
      }
    }
    this.cleanups.clear()
  }
  /** The peer invokes one original cleanup resource rather than a plugin-local lifecycle. */
  readonly #disposeResource = (): Promise<void> => this.#dispose()
  /** Drain accepted work before releasing indexes, subscriptions and the borrowed-store receipt. */
  async #dispose(): Promise<void> {
    this.#stop()
    await this.#limiter.whenIdle()
    this.#limiter.close()
    for (const cleanup of this.afterIdle) cleanup()
    this.afterIdle.clear()
    this.#offFlush()
    this.#offShutdown()
    this.core.lifecycle.signal.removeEventListener('abort', this.stop)
    this.#release()
    this.observe(() => ({
      stage: LogStage.afterLogClose,
      owner: this.#owner,
      operation: LogOperation.close
    }))
  }
  /** Initialization remains one original FIFO task even when nobody awaits ready(). */
  readonly #initializeStore = (): Promise<void> => this.#prepare()
  /** Failed recovery revokes the borrow but preserves the exact failure for old handles. */
  async #prepare(): Promise<void> {
    try {
      if (this.#initialize) await this.#initialize()
      else await this.store.lastSeq()
      this.#prepared = true
      this.observe(() => ({
        stage: LogStage.afterLogOpen,
        owner: this.#owner,
        operation: LogOperation.open
      }))
    } catch (error) {
      this.#initializationError = logStorageFailure(error)
      this.#stop()
      this.#release()
      this.observe(() => ({
        stage: LogStage.onLogOpenError,
        owner: this.#owner,
        operation: LogOperation.open
      }))
      this.report(this.#initializationError)
      throw this.#initializationError
    }
  }
  /** Admit once, then execute after the installation's original readiness barrier. */
  run<T>(operation: string, task: () => T | PromiseLike<T>): Promise<T> {
    try {
      this.admit()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#limiter.run(() => this.#execute(operation, task))
  }
  /** Failure reporting cannot replace a transaction rejection with successful completion. */
  async #execute<T>(operation: string, task: () => T | PromiseLike<T>): Promise<T> {
    await this.#ready
    this.observe(() => ({ stage: LogStage.beforeLogOperation, owner: this.#owner, operation }))
    try {
      /** Invoke the original callback without lending it a new receiver. */
      const result = await task()
      this.observe(() => ({ stage: LogStage.afterLogOperation, owner: this.#owner, operation }))
      return result
    } catch (error) {
      /** Already coded durable errors retain identity and raw I/O stays reachable as cause. */
      const coded = logStorageFailure(error)
      this.observe(() => ({ stage: LogStage.onLogOperationError, owner: this.#owner, operation }))
      this.report(coded)
      throw coded
    }
  }
  /** Immediate port calls account completion without waiting behind ordinary blocked work. */
  appendPort(
    port: ILogAppendPort,
    records: IPortRecords,
    committed: (seqs: readonly number[]) => void = noop,
    rolledBack: () => void = noop
  ): Promise<readonly number[]> {
    try {
      this.admit()
      if (
        !this.#prepared ||
        port.store !== this.store ||
        typeof port.append !== 'function' ||
        typeof port.onCommit !== 'function' ||
        typeof port.onRollback !== 'function'
      )
        throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    } catch (error) {
      return Promise.reject(error)
    }
    return new PortAppend(this, port, records, committed, rolledBack, this.#owner).start()
  }
  /** Reserve accounting before native callbacks can synchronously revoke this installation. */
  account(completion: Promise<readonly number[]>): void {
    /** Utility FIFO drains this completion even after an immediate port rejection. */
    const accounting = this.#limiter.run(() => settlePortCompletion(completion))
    void accounting.catch(this.report)
  }
}

/** Waiting for a native append result never rethrows its business rejection on the idle barrier. */
function settlePortCompletion(completion: Promise<readonly number[]>): Promise<void> {
  return completion.then(noop, noop)
}
/** Already coded native transaction failures retain their source/code and original identity. */
function portFailure(error: unknown): unknown {
  return error &&
    typeof error === 'object' &&
    Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value &&
    Object.getOwnPropertyDescriptor(error, DurableErrorField.code)?.value
    ? error
    : logStorageFailure(error)
}

/** Each native append owns exactly its callback registrations and completion accounting. */
class PortAppend {
  /** The installation controls admission and idle accounting, never the native transaction. */
  readonly #runtime: DurableRuntime
  /** The borrowed native port is captured before any asynchronous wait. */
  readonly #port: ILogAppendPort
  /** JSON records are captured by the public plugin entry before the port starts. */
  readonly #records: IPortRecords
  /** Only actual native commit invokes the owner's post-commit projection. */
  readonly #committed: (seqs: readonly number[]) => void
  /** Rollback releases only the owner's provisional identity reservation. */
  readonly #rolledBack: () => void
  /** Owner metadata is stable across late native callbacks. */
  readonly #owner: 'binlog' | 'wal' | 'undo'
  /** FIFO accounting retains the actual append result rather than its queued start. */
  readonly #completion = deferred<readonly number[]>()
  /** Callback cancellation starts as a harmless no-op until registration returns. */
  #offCommit: () => void = noop
  /** Rollback unsubscription has the same captured lifetime as commit unsubscription. */
  #offRollback: () => void = noop

  /** Register pending ownership before any user-controlled native callbacks can run. */
  constructor(
    runtime: DurableRuntime,
    port: ILogAppendPort,
    records: IPortRecords,
    committed: (seqs: readonly number[]) => void,
    rolledBack: () => void,
    owner: 'binlog' | 'wal' | 'undo'
  ) {
    this.#runtime = runtime
    this.#port = port
    this.#records = records
    this.#committed = committed
    this.#rolledBack = rolledBack
    this.#owner = owner
    runtime.account(this.#completion.promise)
    runtime.cleanups.add(this.cancel)
  }
  /** This callback is stored directly in the installation's cleanup set. */
  readonly cancel = (): void => this.#cancel()
  /** Invoke each captured native unsubscription, reporting its failure through the existing hook. */
  #cancel(): void {
    // Exactly two callbacks are defined by the native transaction-port contract.
    for (const off of [this.#offCommit, this.#offRollback]) {
      try {
        off()
      } catch (error) {
        this.#runtime.reportHook(error)
      }
    }
    this.#runtime.cleanups.delete(this.cancel)
  }
  /** Native append starts in this stack and its Promise is returned independently of FIFO work. */
  start(): Promise<readonly number[]> {
    /** The original append completion is separate from its idle-accounting Promise. */
    let result: Promise<readonly number[]>
    try {
      this.#offCommit = this.#port.onCommit(this.#onCommit)
      this.#offRollback = this.#port.onRollback(this.#onRollback)
      this.#runtime.observe(() => ({
        stage: LogStage.beforeLogOperation,
        owner: this.#owner,
        operation: LogOperation.append,
        count: this.#records.length
      }))
      result = Promise.resolve(this.#port.append(this.#records)).catch(rethrowPortFailure)
    } catch (error) {
      result = Promise.reject(portFailure(error))
    }
    void result.then(this.#completion.resolve, this.#onFailure)
    return result
  }
  /** Commit projection runs only while the originating installation remains active. */
  readonly #onCommit = (): void => this.#commit()
  /** Late commit cannot revive a revoked installation or replace the resource-owned notice. */
  #commit(): void {
    this.#cancel()
    if (this.#runtime.active())
      void this.#completion.promise.then(this.#finishCommit, noop).catch(this.#runtime.reportHook)
  }
  /** Keep original callback receiver and observation order after a real native commit. */
  readonly #finishCommit = (seqs: readonly number[]): void => this.#committedResult(seqs)
  /** A plugin callback cannot obtain native transaction authority from this completion. */
  #committedResult(seqs: readonly number[]): void {
    /** Callbacks are invoked as plain functions, as in the original native-port bridge. */
    const committed = this.#committed
    committed(seqs)
    this.#runtime.observe(() => ({
      stage: LogStage.afterLogOperation,
      owner: this.#owner,
      operation: LogOperation.append,
      count: seqs.length
    }))
  }
  /** Native rollback has no resource commit notice to publish. */
  readonly #onRollback = (): void => this.#rollback()
  /** Release callback registration before returning the provisional identity. */
  #rollback(): void {
    this.#cancel()
    /** Preserve undefined callback receiver while releasing owner state. */
    const rolledBack = this.#rolledBack
    rolledBack()
  }
  /** Rejection remains visible to the business caller and satisfies FIFO completion accounting. */
  readonly #onFailure = (error: unknown): void => this.#fail(error)
  /** Observe once without replacing the original transaction error or its code/cause. */
  #fail(error: unknown): void {
    this.#rollback()
    this.#runtime.observe(() => ({
      stage: LogStage.onLogOperationError,
      owner: this.#owner,
      operation: LogOperation.append
    }))
    this.#runtime.report(error)
    this.#completion.reject(error)
  }
}

/** Preserve the old catch boundary for native transaction failures. */
function rethrowPortFailure(error: unknown): never {
  throw portFailure(error)
}

/** Reuse one named installation owner rather than factory-local captured state. */
export function createDurableRuntime(
  core: IDurableCore,
  options: IDurablePluginOptions,
  owner: 'binlog' | 'wal' | 'undo',
  initialize?: IInitializer
): DurableRuntime {
  return new DurableRuntime(core, options, owner, initialize)
}
/** Internal controllers retain the original inferred installation surface. */
export type IDurableRuntime = ReturnType<typeof createDurableRuntime>

/** Captures factory options without cloning or placing resource identities in plugin config. */
export function captureDurableOptions(
  input: import('./types.ts').IBinlogOptions
): import('./types.ts').IBinlogOptions {
  try {
    if (!input || typeof input !== 'object')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    const store = input.store
    const observe = input.observe
    const echo = input.echo
    if (
      !store ||
      typeof store !== 'object' ||
      (observe !== undefined && typeof observe !== 'function') ||
      (echo !== undefined && typeof echo !== 'boolean')
    )
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    for (const method of [
      'append',
      'read',
      'lastSeq',
      'onAppend',
      'truncate',
      'setState',
      'states',
      'dispose'
    ] as const) {
      if (typeof store[method] !== 'function')
        throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    }
    return { store, observe, echo }
  } catch (error) {
    if (
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
    )
      throw error
    throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption, {
      cause: error
    })
  }
}

/** Captures one optional transaction port before entering the FIFO or native transaction. */
export function captureAppendPort(
  options: import('./types.ts').ILogAppendOptions | undefined
): ILogAppendPort | undefined {
  if (options === undefined) return undefined
  try {
    if (!options || typeof options !== 'object')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    return options.transaction
  } catch (error) {
    throw optionFailure(error)
  }
}
/** Captures the public page size and validates its inclusive-zero range. */
export function captureLimit(options: { readonly limit?: number } | undefined): number {
  try {
    if (options !== undefined && (!options || typeof options !== 'object'))
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    const limit = options?.limit ?? 100
    assertLogInteger(limit, 0)
    return limit
  } catch (error) {
    throw optionFailure(error)
  }
}
/** Captures undo list options without allowing accessors to escape the logger boundary. */
export function captureUndoListOptions(
  options: { readonly limit?: number; readonly sinceTime?: number } | undefined
): { limit: number; sinceTime: number } {
  const limit = captureLimit(options)
  try {
    const sinceTime = options?.sinceTime ?? 0
    if (!Number.isFinite(sinceTime) || sinceTime < 0)
      throw tagDurableError(
        new RangeError(DurableText.invalidOption),
        LogDurableErrorCode.invalidOption
      )
    return { limit, sinceTime }
  } catch (error) {
    throw optionFailure(error)
  }
}
/** All option access failures retain their cause while existing logger admission errors stay intact. */
function optionFailure(error: unknown): Error {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
  )
    return error
  return createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption, {
    cause: error
  })
}
