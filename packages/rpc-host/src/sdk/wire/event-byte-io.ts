/**
 * Borrow native emitter streams for ordered byte delivery and write-callback settlement. Close
 * releases reader subscriptions immediately; writer subscriptions cover the original native flush
 * grace until its actual error, close or finish event retires them.
 */
import { deferred } from '@migaia/utils/promise'
import type { IRpcByteIO } from './byte-pump.js'
import { RpcProbeDirection, type IRpcCarrierWriteOptions } from '@migaia/rpc-contract/interfaces'
import type { RpcCarrierObservation } from '../carrier/observation.js'

/** Native emitter streams retain their original listener and pause/resume semantics. */
export type IRpcEventByteReader = Readonly<{
  pause(): unknown
  resume(): unknown
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  once(event: 'end' | 'error', listener: (reason?: unknown) => void): unknown
  off(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  off(event: 'end' | 'error', listener: (reason?: unknown) => void): unknown
}>
/** Write settlement belongs to the native callback, independently from false-write drain. */
export type IRpcEventByteWriter = Readonly<{
  write(chunk: Uint8Array, settled: (error?: Error | null) => void): unknown
  once(event: 'error' | 'close' | 'drain' | 'finish', listener: (reason?: unknown) => void): unknown
  off(event: 'error' | 'close' | 'drain' | 'finish', listener: (reason?: unknown) => void): unknown
}>
/** Native acquisition supplies error presentation and background cleanup reporting. */
export type IRpcEventByteIOOptions = Readonly<{
  closedError(): Error
  report(error: unknown): void
  /** The acquired native owner supplies its one observer and actual cold medium facts. */
  observation?: RpcCarrierObservation
  /** Only a qualifying native factory can report that its original emitter has one reader. */
  isExclusive?(): boolean
}>
/** Optional carrier observation borrows actual writes without changing their settlement. */
export type IRpcEventByteIO = IRpcByteIO &
  Readonly<{
    /** Current sole native and byte-consumer ownership is sampled without another subscription. */
    isExclusive(): boolean
    onWrite(listener: (chunk: Uint8Array, drainMs: number) => void): () => void
  }>

/** One native emitter pair owns byte delivery, callback settlement and terminal replay. */
export class RpcEventByteIO {
  /** Acquired native resources and the caller's error policy remain with this single owner. */
  readonly #ports
  /** Current subscribers determine when the original reader is resumed or paused. */
  readonly #data = new Set<(chunk: Uint8Array) => void>()
  /** Original close subscribers receive the first terminal reason in registration order. */
  readonly #listeners = new Set<(reason?: unknown) => void>()
  /** Native backpressure retains callbacks only for the current observation installation. */
  readonly #pendingDrains = new Set<() => void>()
  /** Replacement invalidates old callbacks even when the callback function is reused. */
  #writeGeneration = 0
  /** Only an installed carrier observes physical write/drain completion. */
  #writeObserver: ((chunk: Uint8Array, drainMs: number) => void) | undefined
  /** Late subscribers and failed writes reuse the original first terminal value. */
  #terminal: unknown
  /** Delivery stops immediately, before physical cleanup can reenter the port. */
  #closed = false
  /** A real native writer terminal prevents close from reattaching an obsolete finish receipt. */
  #writerTerminal = false
  /** Reentrant and repeated close callers share one physical cleanup Promise. */
  #closing: Promise<void> | undefined
  /** Detached operations preserve the actual byte resource's stable identity. */
  readonly value: IRpcEventByteIO

  /** Pause acquired resources before installing their original native event subscriptions. */
  constructor(
    reader: IRpcEventByteReader,
    writer: IRpcEventByteWriter,
    closePhysical: () => void,
    options: IRpcEventByteIOOptions
  ) {
    this.#ports = { reader, writer, closePhysical, options }
    reader.pause()
    reader.on('data', this.#receive)
    reader.once('end', this.#end)
    reader.once('error', this.#end)
    writer.once('error', this.#writerFailed)
    writer.once('close', this.#writerClosed)
    this.value = Object.freeze({
      kind: 'byte',
      observation: options.observation,
      isExclusive: () => this.#data.size === 1 && (options.isExclusive?.() ?? false),
      write: this.#write,
      onData: this.#onData,
      onClose: this.#onClose,
      onWrite: this.#onWrite,
      close: this.#close
    })
  }

  /** Native events report cleanup failures; explicit close callers retain the same rejection. */
  readonly #end = (reason?: unknown): void => {
    void this.#close(reason).catch(this.#ports.options.report)
  }

  /** Native input borrows each original chunk without retaining an anonymous emitter callback. */
  readonly #receive = (chunk: Uint8Array): void => {
    this.#ports.options.observation?.emit(RpcProbeDirection.inbound, chunk)
    for (const listener of this.#data) listener(chunk)
  }

  /** A real writer error ends its native grace before the original close path can reenter. */
  readonly #writerFailed = (reason?: unknown): void => {
    this.#releaseWriter()
    this.#end(reason)
  }

  /** Native close also releases a writer that never emitted finish. */
  readonly #writerClosed = (): void => {
    this.#releaseWriter()
    this.#end()
  }

  /** Paused retained stdin must no longer hold this closed byte owner through its subscriptions. */
  #releaseReader(): void {
    this.#ports.reader.off('data', this.#receive)
    this.#ports.reader.off('end', this.#end)
    this.#ports.reader.off('error', this.#end)
  }

  /** Finish, error and close each retire the same exact native writer receipts once. */
  readonly #releaseWriter = (): void => {
    if (this.#writerTerminal) return
    this.#writerTerminal = true
    this.#ports.writer.off('error', this.#writerFailed)
    this.#ports.writer.off('close', this.#writerClosed)
    this.#ports.writer.off('finish', this.#releaseWriter)
  }

  /** Release only diagnostic drain callbacks, leaving native write settlement untouched. */
  #releaseDrains(): void {
    for (const listener of this.#pendingDrains) this.#ports.writer.off('drain', listener)
    this.#pendingDrains.clear()
  }

  /** Preserve physical-close-before-listeners ordering and the original cleanup failure. */
  readonly #close = (reason?: unknown): Promise<void> => {
    if (this.#closing) return this.#closing
    /** Publish before physical cleanup or a close listener can synchronously reenter. */
    const completion = deferred<void>()
    this.#closing = completion.promise
    this.#closed = true
    this.#terminal = reason ?? this.#ports.options.closedError()
    this.#writeObserver = undefined
    this.#writeGeneration++
    try {
      this.#releaseDrains()
      this.#releaseReader()
      /** Original end/destroy owns flush completion; close does not wait for or fake that terminal. */
      if (!this.#writerTerminal) this.#ports.writer.once('finish', this.#releaseWriter)
      this.#ports.closePhysical()
      for (const listener of this.#listeners) listener(this.#terminal)
      completion.resolve()
    } catch (error) {
      completion.reject(error)
    } finally {
      this.#data.clear()
      this.#listeners.clear()
    }
    return this.#closing
  }

  /** Native callbacks settle writes; drain remains an independent optional observation. */
  readonly #write = (chunk: Uint8Array, options?: IRpcCarrierWriteOptions): Promise<void> => {
    if (this.#closed) return Promise.reject(this.#terminal)
    /** One native callback settles this operation; construction failures keep Promise rejection. */
    const completion = deferred<void>()
    try {
      /** Capture the exact installation before native write can synchronously emit events. */
      const observer = this.#writeObserver
      /** Stale drain callbacks cannot be retargeted to a later installation. */
      const generation = this.#writeGeneration
      /** Unobserved writes do not read the clock. */
      const started = observer === undefined ? 0 : performance.now()
      options?.onWriteStart?.()
      this.#ports.options.observation?.emit(RpcProbeDirection.outbound, chunk, options?.transfer)
      /** Inspect only the native return value; retain the original completion callback. */
      const accepted = this.#ports.writer.write(chunk, (error) => {
        if (error) completion.reject(error)
        else if (this.#closed) completion.reject(this.#terminal)
        else completion.resolve()
      })
      if (observer === undefined) return completion.promise
      if (accepted !== false) {
        observer(chunk, 0)
        return completion.promise
      }
      /** One observed drain retains its own small native-write facts, never the caller's options. */
      const operation = { owner: this, observer, chunk, generation, started }
      /** Backpressure alone allocates this diagnostic native listener. */
      function drained(): void {
        operation.owner.#pendingDrains.delete(drained)
        if (!operation.owner.#closed && operation.generation === operation.owner.#writeGeneration)
          operation.observer(operation.chunk, performance.now() - operation.started)
      }
      this.#pendingDrains.add(drained)
      this.#ports.writer.once('drain', drained)
    } catch (error) {
      completion.reject(error)
    }
    return completion.promise
  }

  /** Resume only subscribed delivery and pause after the last original remover. */
  readonly #onData = (listener: (chunk: Uint8Array) => void): (() => void) => {
    this.#data.add(listener)
    this.#ports.reader.resume()
    return () => {
      this.#data.delete(listener)
      if (this.#data.size === 0) this.#ports.reader.pause()
    }
  }

  /** Late listeners receive the same original terminal value immediately. */
  readonly #onClose = (listener: (reason?: unknown) => void): (() => void) => {
    if (this.#closed) listener(this.#terminal)
    else this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Replacement retires obsolete drain observers without changing write Promises. */
  readonly #onWrite = (listener: (chunk: Uint8Array, drainMs: number) => void): (() => void) => {
    /** Installation identity is independent of callback function identity. */
    const generation = ++this.#writeGeneration
    this.#releaseDrains()
    this.#writeObserver = listener
    return () => {
      if (generation !== this.#writeGeneration) return
      this.#writeObserver = undefined
      this.#writeGeneration++
      this.#releaseDrains()
    }
  }
}
