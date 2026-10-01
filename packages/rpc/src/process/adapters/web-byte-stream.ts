import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessByteChannel } from '../types.js'

/** Adapt runtime-native Web Streams without inserting a second queue or framer. */
export function webByteStream(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  closePhysical: () => void | Promise<void>
): IProcessByteChannel {
  /** One reader and writer own this physical connection. */
  const reader = readable.getReader()
  const writer = writable.getWriter()
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
    closed = true
    terminal = reason ?? createProcessError(RpcProcessErrorCode.channelClosed)
    wakeReader?.()
    for (const listener of closeListeners) listener(terminal)
    dataListeners.clear()
    closeListeners.clear()
    closing = Promise.allSettled([
      reader.cancel(),
      writer.abort(terminal),
      Promise.resolve().then(closePhysical)
    ]).then((results) => {
      /** A failed reader may reject cancel with its already-reported terminal reason. */
      const errors = results.flatMap((result) =>
        result.status === 'rejected' && result.reason !== terminal ? [result.reason] : []
      )
      if (errors.length)
        throw createProcessError(
          RpcProcessErrorCode.channelClosed,
          new AggregateError(errors, RpcProcessErrorText.channelClosed)
        )
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
    hostRethrowReporter(error, IpcReporterContext)
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
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
