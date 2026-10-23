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
export function createRuntimeWebByteStream(
  readable: IRuntimeReadableByteStream,
  writable: IRuntimeWritableByteStream,
  closePhysical: () => void | Promise<void>,
  options: IRuntimeWebByteStreamOptions
): IRuntimeByteIO {
  /** Retain only successfully acquired native resources until construction can commit. */
  let acquiredReader: IRuntimeByteStreamReader | undefined
  /** Failed writer acquisition returns the already-acquired native reader to its caller. */
  let writer: IRuntimeByteStreamWriter
  try {
    acquiredReader = readable.getReader()
    writer = writable.getWriter()
  } catch (error) {
    acquiredReader?.releaseLock()
    throw options.openFailed(error as Error)
  }
  /** The successful acquisition branch owns this stable reader for the connection lifetime. */
  const reader = acquiredReader
  /** Listener sets never retain frames after the port closes. */
  const dataListeners = new Set<(chunk: Uint8Array) => void>()
  const closeListeners = new Set<(reason?: unknown) => void>()
  /** The pump waits without reading while no channel owner is subscribed. */
  let wakeReader: (() => void) | undefined
  let closed = false
  let terminal: unknown
  let closing: Promise<void> | undefined

  /** End the one physical port and replay the first reason to late listeners. */
  const end = (reason?: unknown): Promise<void> => {
    if (closing) return closing
    /** Publish completion before notifying any callback that can synchronously reenter close. */
    const completion = deferred<void>()
    closing = completion.promise
    closed = true
    terminal = reason ?? options.closedError()
    wakeReader?.()
    /** Retire the exact current observers before invoking arbitrary application callbacks. */
    const listeners = [...closeListeners]
    dataListeners.clear()
    closeListeners.clear()
    /** Observer failures precede cleanup failures and never prevent physical cleanup. */
    const errors: unknown[] = []
    for (const listener of listeners) {
      try {
        listener(terminal)
      } catch (error) {
        errors.push(error)
      }
    }
    void Promise.allSettled([
      reader.cancel(),
      writer.abort(terminal),
      Promise.resolve().then(closePhysical)
    ]).then((results) => {
      /** A failed reader may reject cancel with its already-reported terminal reason. */
      errors.push(
        ...results.flatMap((result) =>
          result.status === 'rejected' && result.reason !== terminal ? [result.reason] : []
        )
      )
      if (errors.length) completion.reject(options.cleanupFailed(errors))
      else completion.resolve()
    })
    return closing
  }

  /** Each read result is delivered once; the runtime's stream owns byte buffering. */
  void (async () => {
    try {
      while (!closed) {
        if (dataListeners.size === 0) {
          await new Promise<void>((resolve) => {
            wakeReader = resolve
          })
          wakeReader = undefined
          continue
        }
        const next = await reader.read()
        if (next.done) {
          await end()
          return
        }
        for (const listener of dataListeners) listener(next.value)
      }
    } catch (error) {
      await end(error)
    }
  })().catch((error: unknown) => {
    options.report(error)
  })

  return Object.freeze({
    kind: 'byte' as const,
    write(chunk: Uint8Array) {
      if (closed) return Promise.reject(terminal)
      return writer.write(chunk)
    },
    onData(listener: (chunk: Uint8Array) => void) {
      dataListeners.add(listener)
      wakeReader?.()
      return () => dataListeners.delete(listener)
    },
    onClose(listener: (reason?: unknown) => void) {
      if (closed) listener(terminal)
      else closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close: () => end()
  })
}
