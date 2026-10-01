import type { Readable, Writable } from 'node:stream'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type { IProcessByteChannel } from '../types.js'

/** Own one Node readable and writable pair without adding another framing layer. */
export function nodeByteStream(
  readable: Readable,
  writable: Writable,
  destroy: () => void
): IProcessByteChannel {
  /** The physical reader starts paused until the channel owner subscribes. */
  readable.pause()
  /** One terminal reason is replayed to subscribers registered after an early failure. */
  let terminal: unknown
  /** Closing the pair is idempotent even when EOF and caller close race. */
  let closed = false
  /** Subscribers do not own the underlying Node streams. */
  const dataListeners = new Set<(chunk: Uint8Array) => void>()
  const closeListeners = new Set<(reason?: unknown) => void>()

  /** Signal one physical terminal state to the owning handshake. */
  const end = (reason?: unknown): void => {
    if (closed) return
    closed = true
    terminal = reason ?? createProcessError(RpcProcessErrorCode.channelClosed)
    destroy()
    for (const listener of closeListeners) listener(terminal)
    dataListeners.clear()
    closeListeners.clear()
  }
  readable.on('data', (chunk: Buffer) => {
    for (const listener of dataListeners) listener(chunk)
  })
  readable.once('end', () => end())
  readable.once('error', end)
  writable.once('error', end)
  writable.once('close', () => end())

  return {
    kind: 'byte',
    write(chunk) {
      if (closed) return Promise.reject(terminal)
      /** Node's completion callback runs when this complete write has drained. */
      return new Promise<void>((resolve, reject) => {
        writable.write(chunk, (error?: Error | null) => {
          if (error) reject(error)
          else if (closed) reject(terminal)
          else resolve()
        })
      })
    },
    onData(listener) {
      dataListeners.add(listener)
      readable.resume()
      return () => {
        dataListeners.delete(listener)
        if (dataListeners.size === 0) readable.pause()
      }
    },
    onClose(listener) {
      if (closed) listener(terminal)
      else closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close() {
      if (closed) return
      end()
    }
  }
}
