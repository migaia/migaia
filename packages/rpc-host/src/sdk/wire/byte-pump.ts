/**
 * Owns ordered reads and shared terminal cleanup for one already-acquired native reader/writer
 * pair. Subscriptions pause or wake the single pump; original writes/backpressure and native
 * cleanup ports are borrowed, with raw observations emitted only at the actual read/write points.
 */
import { deferred } from '@migaia/utils/promise'
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
    options?.onWriteStart?.()
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
      for (const result of results)
        if (result.status === 'rejected' && result.reason !== this.#terminal)
          operation.errors.push(result.reason)
      if (operation.errors.length)
        operation.completion.reject(this.#ports.options.cleanupFailed(operation.errors))
      else operation.completion.resolve()
    })
    return this.#closing
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
        const next = await this.#ports.reader.read()
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
