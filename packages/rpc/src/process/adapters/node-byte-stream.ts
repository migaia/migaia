import type { Readable, Writable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { remoteProcessJsonCodec } from '../pipeline.js'
import { registerFastCodec } from '../../core/internal/fast-path.js'
import { RpcOwnedBinaryAlphabet } from '../../core/internal/outbound-owned-codec.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type { IProcessByteChannel } from '../types.js'
import type { INativeReplayOwner } from '../../core/internal/native-replay.js'

/** This adapter holds the actual native encoder; Contract imports no Node implementation. */
registerFastCodec(remoteProcessJsonCodec, (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(RpcOwnedBinaryAlphabet)
)

/** Stream construction alone is not authority; only canonical launch/stdio owners register it. */
const nativeOwners = new WeakMap<object, INativeReplayOwner>()

/** Returns the original stream observations for a canonical caller's private registration. */
export function nativeNodeByteOwner(channel: object): INativeReplayOwner | undefined {
  return nativeOwners.get(channel)
}

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

  /** Exact channel identity owns its stream lifetime and single data subscriber observation. */
  const channel: IProcessByteChannel = {
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
  nativeOwners.set(channel, {
    alive: () => !closed && !readable.destroyed && !writable.destroyed,
    exclusive: () => dataListeners.size <= 1 && readable.listenerCount('data') === 1
  })
  return channel
}
