/**
 * Owns ordered reads and shared terminal cleanup for one already-acquired native reader/writer
 * pair. Subscriptions pause or wake the single pump; original writes/backpressure and native
 * cleanup ports are borrowed, with raw observations emitted only at the actual read/write points.
 */
import { deferred } from '@migaia/utils/promise'
import { inspectThenable, assimilateCapturedThen } from '@migaia/utils/function'
import {
  RpcProbeDirection,
  type IRpcCarrierObservation,
  type IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import type { RpcCarrierObservation } from '../carrier/observation.js'

/** Platform acquisition supplies exactly one original native reader; SDK owns subsequent reads. */
export type IRpcByteReader = Readonly<{
  read(): Promise<Readonly<{ done: boolean; value?: Uint8Array }>>
  cancel(reason?: unknown): Promise<void>
}>
/** The original native writer remains the sole write queue and backpressure authority. */
export type IRpcByteWriter = Readonly<{
  write(chunk: Uint8Array, options?: IRpcCarrierWriteOptions): Promise<void>
  abort(reason?: unknown): Promise<void>
}>
/** Physical adapters retain their error families, cleanup aggregation and background report policy. */
export type IRpcBytePumpOptions = Readonly<{
  closedError(): Error
  cleanupFailed(errors: readonly unknown[]): Error
  report(error: unknown): void
  /** Native acquisition lends observation without changing the original reader or writer. */
  observation?: RpcCarrierObservation
}>
/** Already-acquired native resources expose ordered bytes without a request/session facade. */
export type IRpcByteIO = Readonly<{
  kind: 'byte'
  /** The carrier borrows the same native observer; its public capability cannot emit fake IO. */
  observation?: IRpcCarrierObservation
  write(chunk: Uint8Array, options?: IRpcCarrierWriteOptions): Promise<void>
  onData(listener: (chunk: Uint8Array) => void): () => void
  onClose(listener: (reason?: unknown) => void): () => void
  close(reason?: unknown): Promise<void>
}>

/** One borrowed native reader/writer pair retains the original paused-read and terminal lifecycle. */
export class RpcBytePump {
  /** Native acquisition/rollback stays with the platform; this owner only borrows successful ports. */
  readonly #ports
  /** Subscribed data callbacks determine whether the original pump may issue another native read. */
  readonly #data = new Set<(chunk: Uint8Array) => void>()
  /** Exactly the currently held close observers receive the first terminal reason. */
  readonly #listeners = new Set<(reason?: unknown) => void>()
  /** One pending pause is awakened by subscription or physical close. */
  #wake: (() => void) | undefined
  /** Closing immediately revokes delivery while the actual native resources finish cleanup. */
  #closed = false
  /** The first reason is replayed unchanged to late close subscribers. */
  #terminal: unknown
  /** Native cancellation may repeat a read failure already observed from the same stream. */
  #readFailure: Readonly<{ error: unknown }> | undefined
  /** Reentrant and repeated close calls return the same actual cleanup Promise. */
  #closing: Promise<void> | undefined
  /** Detached methods preserve one stable resource identity for the carrier's native ownership. */
  readonly value: IRpcByteIO

  /** Borrow successfully acquired native ports and start reading only after an owner subscribes. */
  constructor(
    reader: IRpcByteReader,
    writer: IRpcByteWriter,
    closePhysical: () => void | Promise<void>,
    options: IRpcBytePumpOptions
  ) {
    this.#ports = { reader, writer, closePhysical, options }
    this.value = Object.freeze({
      kind: 'byte',
      observation: options.observation,
      write: this.#write,
      onData: this.#onData,
      onClose: this.#onClose,
      close: this.#end
    })
    void this.#pump().catch(options.report)
  }

  /** Preserve the original physical write, options identity and observation-before-handoff order. */
  readonly #write = (chunk: Uint8Array, options?: IRpcCarrierWriteOptions): Promise<void> => {
    if (this.#closed) return Promise.reject(this.#terminal)
    /** A void handoff keeps native write in this stack; only an actual seal is awaited. */
    const started: unknown = options?.onWriteStart?.()
    /** One captured then method preserves the original callback failure. */
    const inspection = inspectThenable(started)
    if ('error' in inspection) throw inspection.error
    if (inspection.then) {
      /** The asynchronous branch alone retains a per-write continuation context. */
      const operation = { owner: this, chunk, options }
      return assimilateCapturedThen<void>(inspection.then, started).then(() => {
        if (operation.owner.#closed) throw operation.owner.#terminal
        return operation.owner.#writeNative(operation.chunk, operation.options)
      })
    }
    return this.#writeNative(chunk, options)
  }

  /** The same native writer and original options retain physical completion ownership. */
  #writeNative(chunk: Uint8Array, options?: IRpcCarrierWriteOptions): Promise<void> {
    this.#ports.options.observation?.emit(RpcProbeDirection.outbound, chunk, options?.transfer)
    return this.#ports.writer.write(chunk, options)
  }

  /** A subscription wakes the one paused reader and owns only its exact listener remover. */
  readonly #onData = (listener: (chunk: Uint8Array) => void): (() => void) => {
    this.#data.add(listener)
    this.#wake?.()
    return () => {
      this.#data.delete(listener)
    }
  }

  /** Late subscribers receive the original close reason; each remover releases only its listener. */
  readonly #onClose = (listener: (reason?: unknown) => void): (() => void) => {
    if (this.#closed) listener(this.#terminal)
    else this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Retire observers before arbitrary callbacks; join all original native cleanup operations once. */
  readonly #end = (reason?: unknown): Promise<void> => {
    if (this.#closing) return this.#closing
    /** Publish before any observer can synchronously reenter close. */
    const operation = { completion: deferred<void>(), errors: [] as unknown[] }
    this.#closing = operation.completion.promise
    this.#closed = true
    this.#terminal = reason ?? this.#ports.options.closedError()
    this.#wake?.()
    /** The current original observer snapshot is cleared before notifying the first observer. */
    const listeners = [...this.#listeners]
    this.#data.clear()
    this.#listeners.clear()
    /** Preserve callback failure order before the original ordered native cleanup failures. */
    for (const listener of listeners) {
      try {
        listener(this.#terminal)
      } catch (error) {
        operation.errors.push(error)
      }
    }
    void Promise.allSettled([
      this.#ports.reader.cancel(),
      this.#ports.writer.abort(this.#terminal),
      Promise.resolve().then(this.#ports.closePhysical)
    ]).then((results) => {
      for (const [index, result] of results.entries()) {
        if (result.status !== 'rejected' || result.reason === this.#terminal) continue
        /** Cancel of an errored reader rethrows its original read failure, not a cleanup failure. */
        const repeatedReadFailure =
          index === 0 &&
          this.#readFailure !== undefined &&
          result.reason === this.#readFailure.error
        if (!repeatedReadFailure) operation.errors.push(result.reason)
      }
      if (operation.errors.length)
        operation.completion.reject(this.#ports.options.cleanupFailed(operation.errors))
      else operation.completion.resolve()
    })
    return this.#closing
  }

  /** Retain only native read failure identity so cancellation cannot count it a second time. */
  async #read(): ReturnType<IRpcByteReader['read']> {
    try {
      return await this.#ports.reader.read()
    } catch (error) {
      this.#readFailure = { error }
      throw error
    }
  }

  /** Pause with no subscribers and deliver each original native read once in subscription order. */
  async #pump(): Promise<void> {
    try {
      while (!this.#closed) {
        if (this.#data.size === 0) {
          await new Promise<void>((resolve) => {
            this.#wake = resolve
          })
          this.#wake = undefined
          continue
        }
        /** Only the native reader determines message boundaries and end-of-input. */
        const next = await this.#read()
        if (this.#closed) return
        if (next.done) {
          await this.#end()
          return
        }
        this.#ports.options.observation?.emit(RpcProbeDirection.inbound, next.value!)
        for (const listener of this.#data) listener(next.value!)
      }
    } catch (error) {
      await this.#end(error)
    }
  }
}
