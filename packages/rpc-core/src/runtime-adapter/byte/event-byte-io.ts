import {
  bindNativeReplayTransport,
  registerNativeReplayOwner
} from '../../core/internal/native-replay.js'
import { createRuntimeDiagnosticError } from './diagnostics.js'
import type { IRuntimeByteIO, IRuntimeDiagnosticError } from './types.js'

/** The held emitter-style reader supplies actual byte delivery and physical reader observation. */
export type IRuntimeEventByteReader = Readonly<{
  destroyed: boolean
  pause(): unknown
  resume(): unknown
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  once(event: 'end' | 'error', listener: (reason?: unknown) => void): unknown
  listenerCount(event: 'data'): number
}>

/** The held writer completes each original write when its physical drain callback settles. */
export type IRuntimeEventByteWriter = Readonly<{
  destroyed: boolean
  write(chunk: Uint8Array, settled: (error?: Error | null) => void): unknown
  once(event: 'error' | 'close', listener: (reason?: unknown) => void): unknown
}>

/** A held cleanup resource preserves the adapter's exact physical close operation. */
export type IRuntimeBytePhysicalResource = Readonly<{ close(): void }>

/** Construct and observe the byte port itself; no owner predicates or trust labels are inputs. */
export function createRuntimeEventByteIO(
  reader: IRuntimeEventByteReader,
  writer: IRuntimeEventByteWriter,
  physical: IRuntimeBytePhysicalResource,
  closedDiagnostic: IRuntimeDiagnosticError
): IRuntimeByteIO {
  /** The physical reader stays paused until the original byte owner subscribes. */
  reader.pause()
  /** Late listeners receive the same original terminal value without replacing its identity. */
  let terminal: unknown
  /** EOF, write errors and explicit close share one physical retirement. */
  let closed = false
  /** Core counts its actual byte subscribers rather than accepting an exclusivity callback. */
  const dataListeners = new Set<(chunk: Uint8Array) => void>()
  /** Terminal subscribers borrow the port and never acquire the underlying resources. */
  const closeListeners = new Set<(reason?: unknown) => void>()

  /** Retire the actual physical resources once and deliver their first terminal reason. */
  const end = (reason?: unknown): void => {
    if (closed) return
    closed = true
    terminal = reason ?? createRuntimeDiagnosticError(closedDiagnostic)
    physical.close()
    for (const listener of closeListeners) listener(terminal)
    dataListeners.clear()
    closeListeners.clear()
  }
  reader.on('data', (chunk: Uint8Array) => {
    for (const listener of dataListeners) listener(chunk)
  })
  reader.once('end', () => end())
  reader.once('error', end)
  writer.once('error', end)
  writer.once('close', () => end())

  /** The exact constructed identity owns its physical writer and original subscription count. */
  const channel: IRuntimeByteIO = {
    kind: 'byte',
    write(chunk) {
      if (closed) return Promise.reject(terminal)
      return new Promise<void>((resolve, reject) => {
        writer.write(chunk, (error?: Error | null) => {
          if (error) reject(error)
          else if (closed) reject(terminal)
          else resolve()
        })
      })
    },
    onData(listener) {
      dataListeners.add(listener)
      reader.resume()
      return () => {
        dataListeners.delete(listener)
        if (dataListeners.size === 0) reader.pause()
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
  /** Shared duplex resources retain the established legacy behavior of ordinary socket carriers. */
  if (!Object.is(reader, writer)) {
    /** Rewrapping the same held reader never creates another native lifetime owner. */
    registerNativeReplayOwner(reader, {
      alive: () => !closed && !reader.destroyed && !writer.destroyed,
      exclusive: () => dataListeners.size <= 1 && reader.listenerCount('data') === 1
    })
    bindNativeReplayTransport(reader, channel)
  }
  /** This internal receipt carrier cannot acquire a forged public transport surface by mutation. */
  return Object.freeze(channel)
}
