import { deferred } from '@migaia/utils/promise'
import type { IRuntimeByteIO } from './types.js'

/** Only native byte read, cancellation and lock release are needed by the shared owner. */
export type IRuntimeByteStreamReader = Readonly<{
  read(): Promise<
    Readonly<{ done: false; value: Uint8Array }> | Readonly<{ done: true; value?: Uint8Array }>
  >
  cancel(reason?: unknown): Promise<void>
  releaseLock(): void
}>
/** Native write ordering and abort remain owned by the runtime's writer. */
export type IRuntimeByteStreamWriter = Readonly<{
  write(chunk: Uint8Array): Promise<void>
  abort(reason?: unknown): Promise<void>
}>
/** Structural streams keep the foundation independent of DOM and native runtime type libraries. */
export type IRuntimeReadableByteStream = Readonly<{ getReader(): IRuntimeByteStreamReader }>
/** Exactly one native writer is borrowed from this structural stream. */
export type IRuntimeWritableByteStream = Readonly<{ getWriter(): IRuntimeByteStreamWriter }>

/** Native owners keep their existing errors while this one pump owns reader/writer lifetime. */
export type IRuntimeWebByteStreamOptions = Readonly<{
  /** Preserve the owning adapter's original native acquisition failure and semantic code. */
  openFailed(error: Error): Error
  /** Create the existing terminal error only when native EOF supplies no explicit reason. */
  closedError(): Error
  /** Keep original observer/cleanup failures reachable through the owning adapter's aggregate. */
  cleanupFailed(errors: readonly unknown[]): Error
  /** Report a background pump failure through the owner's existing unhandled failure policy. */
  report(error: unknown): void
}>

/** Acquire native Web Streams once; their own buffering and write order remain authoritative. */
class RuntimeWebByteStream {
  /** Original closePhysical resource retained by this single adapter owner. */
  #closePhysical: () => void | Promise<void>

  /** Original options resource retained by this single adapter owner. */
  #options: IRuntimeWebByteStreamOptions

  /** Failed writer acquisition returns the already-acquired native reader to its caller. */
  #writer!: IRuntimeByteStreamWriter

  /** The successful acquisition branch owns this stable reader for the connection lifetime. */
  #reader

  /** Listener sets never retain frames after the port closes. */
  #dataListeners

  #closeListeners

  /** The pump waits without reading while no channel owner is subscribed. */
  #wakeReader: (() => void) | undefined

  #closed

  #terminal: unknown

  #closing: Promise<void> | undefined

  /** End the one physical port and replay the first reason to late listeners. */
  #end = (reason?: unknown): Promise<void> => {
    if (this.#closing) return this.#closing
    /** Publish completion before notifying any callback that can synchronously reenter close. */
    const completion = deferred<void>()
    this.#closing = completion.promise
    this.#closed = true
    this.#terminal = reason ?? this.#options.closedError()
    this.#wakeReader?.()
    /** Retire the exact current observers before invoking arbitrary application callbacks. */
    const listeners = [...this.#closeListeners]
    this.#dataListeners.clear()
    this.#closeListeners.clear()
    /** Observer failures precede cleanup failures and never prevent physical cleanup. */
    const errors: unknown[] = []
    for (const listener of listeners) {
      try {
        listener(this.#terminal)
      } catch (error) {
        errors.push(error)
      }
    }
    void Promise.allSettled([
      this.#reader.cancel(),
      this.#writer.abort(this.#terminal),
      Promise.resolve().then(this.#closePhysical)
    ]).then((results) => {
      /** A failed reader may reject cancel with its already-reported terminal reason. */
      errors.push(
        ...results.flatMap((result) =>
          result.status === 'rejected' && result.reason !== this.#terminal ? [result.reason] : []
        )
      )
      if (errors.length) completion.reject(this.#options.cleanupFailed(errors))
      else completion.resolve()
    })
    return this.#closing
  }

  /** Frozen operation surface keeps the original transport/resource identity. */
  readonly value: IRuntimeByteIO
  /** Acquire resources and install native observers in the original construction order. */
  constructor(
    readable: IRuntimeReadableByteStream,
    writable: IRuntimeWritableByteStream,
    closePhysical: () => void | Promise<void>,
    options: IRuntimeWebByteStreamOptions
  ) {
    this.#closePhysical = closePhysical
    this.#options = options

    /** Writer acquisition failure releases the reader acquired by this construction attempt. */
    let acquiredReader: IRuntimeByteStreamReader | undefined
    try {
      acquiredReader = readable.getReader()
      this.#writer = writable.getWriter()
    } catch (error) {
      acquiredReader?.releaseLock()
      throw this.#options.openFailed(error as Error)
    }
    this.#reader = acquiredReader
    this.#dataListeners = new Set<(chunk: Uint8Array) => void>()
    this.#closeListeners = new Set<(reason?: unknown) => void>()
    this.#closed = false

    void this.#pump().catch((error: unknown) => {
      this.#options.report(error)
    })

    this.value = Object.freeze({
      kind: 'byte' as const,
      write: (chunk: Uint8Array) => {
        if (this.#closed) return Promise.reject(this.#terminal)
        return this.#writer.write(chunk)
      },
      onData: (listener: (chunk: Uint8Array) => void) => {
        this.#dataListeners.add(listener)
        this.#wakeReader?.()
        return () => this.#dataListeners.delete(listener)
      },
      onClose: (listener: (reason?: unknown) => void) => {
        if (this.#closed) listener(this.#terminal)
        else this.#closeListeners.add(listener)
        return () => this.#closeListeners.delete(listener)
      },
      close: () => this.#end()
    })
  }
  /** Deliver each native read once while pausing the pump when no owner subscribes. */
  async #pump(): Promise<void> {
    try {
      while (!this.#closed) {
        if (this.#dataListeners.size === 0) {
          await new Promise<void>((resolve) => {
            this.#wakeReader = resolve
          })
          this.#wakeReader = undefined
          continue
        }
        const next = await this.#reader.read()
        if (next.done) {
          await this.#end()
          return
        }
        for (const listener of this.#dataListeners) listener(next.value)
      }
    } catch (error) {
      await this.#end(error)
    }
  }
}

/** Acquire one native reader/writer pair and retain its exact pump and cleanup lifecycle. */
export function createRuntimeWebByteStream(
  readable: IRuntimeReadableByteStream,
  writable: IRuntimeWritableByteStream,
  closePhysical: () => void | Promise<void>,
  options: IRuntimeWebByteStreamOptions
): IRuntimeByteIO {
  return new RuntimeWebByteStream(readable, writable, closePhysical, options).value
}
