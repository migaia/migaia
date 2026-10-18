import { createProcessError, tagNativeProcessError } from './error.js'
import { ERROR_SOURCE, RpcProcessErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'

import { RpcProcessErrorText } from './error-text.js'
import type { IProcessByteChannel } from './types.js'

/** Adapt runtime-native Web Streams without inserting a second queue or framer. */
export function webByteStream(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  closePhysical: () => void | Promise<void>
): IProcessByteChannel {
  /** Retain only successfully acquired native resources until construction can commit. */
  let acquiredReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  /** Failed writer acquisition returns the already-acquired native reader to its caller. */
  let writer: WritableStreamDefaultWriter<Uint8Array>
  try {
    acquiredReader = readable.getReader()
    writer = writable.getWriter()
  } catch (error) {
    acquiredReader?.releaseLock()
    throw tagNativeProcessError(error as Error, RpcProcessErrorCode.connectFailed)
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
    terminal = reason ?? createProcessError(RpcProcessErrorCode.channelClosed)
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
      if (errors.length)
        completion.reject(
          attachErrorIdentity(
            new AggregateError(errors, RpcProcessErrorText.channelClosed, { cause: errors[0] }),
            { source: ERROR_SOURCE, code: RpcProcessErrorCode.channelClosed }
          )
        )
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
import { IpcReporterContext } from '@migaia/rpc-core/adapter/internal-advanced'

/** The moved public Web Streams operation retains the original owned byte pump and close scope. */
export function createAdapterWebByteIO(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>
) {
  return webByteStream(readable, writable, () => undefined)
}
