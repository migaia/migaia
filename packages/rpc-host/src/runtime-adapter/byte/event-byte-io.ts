import {
  carryNativeReplayResource,
  registerNativeReplayOwner
} from '../../core/internal/native-replay.js'
import { createRuntimeDiagnosticError } from './diagnostics.js'
import type { IRuntimeByteIO, IRuntimeDiagnosticError } from './types.js'
import type { RpcOwnedBinaryAlphabet } from '../../core/internal/outbound-owned-codec.js'

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
  once(event: 'error' | 'close' | 'drain', listener: (reason?: unknown) => void): unknown
  /** Native stream removal releases an observed backpressure callback when its observer retires. */
  off?(event: 'drain', listener: () => void): unknown
}>

/** A held cleanup resource preserves the adapter's exact physical close operation. */
export type IRuntimeBytePhysicalResource = Readonly<{ close(): void }>

/** A held native byte-view constructor performs encoding over the exact visible backing range. */
export type IRuntimeByteViewFactory = Readonly<{
  from(
    backing: ArrayBufferLike,
    byteOffset: number,
    byteLength: number
  ): Readonly<{ toString(alphabet: typeof RpcOwnedBinaryAlphabet): string }>
}>

/** Only Core's own raw I/O construction associates its actual held byte-view resource. */
const byteViewFactories = new WeakMap<object, IRuntimeByteViewFactory>()

/** The final byte connection reads a resource from exact raw I/O identity, never public metadata. */
export function readRuntimeByteViewFactory(channel: IRuntimeByteIO) {
  return byteViewFactories.get(channel)
}

/** Construct and observe the byte port itself; no owner predicates or trust labels are inputs. */
export function createRuntimeEventByteIO(
  reader: IRuntimeEventByteReader,
  writer: IRuntimeEventByteWriter,
  physical: IRuntimeBytePhysicalResource,
  closedDiagnostic: IRuntimeDiagnosticError,
  byteViewFactory?: IRuntimeByteViewFactory
): IRuntimeByteIO {
  /** The physical reader stays paused until the original byte owner subscribes. */
  reader.pause()
  /** Late listeners receive the same original terminal value without replacing its identity. */
  let terminal: unknown
  /** EOF, write errors and explicit close share one physical retirement. */
  let closed = false
  /** Only an installed byte carrier observes native write/drain facts. */
  let writeObserver: ((chunk: Uint8Array, drainMs: number) => void) | undefined
  /** False-write callbacks belong to the current observer installation only. */
  let writeGeneration = 0
  /** Backpressure retains bytes only until native drain or observation retirement. */
  const pendingDrains = new Set<() => void>()
  /** Cold replacement and close release actual native callbacks without changing write Promises. */
  const releaseDrains = (): void => {
    for (const listener of pendingDrains) writer.off?.('drain', listener)
    pendingDrains.clear()
  }
  /** Core counts its actual byte subscribers rather than accepting an exclusivity callback. */
  const dataListeners = new Set<(chunk: Uint8Array) => void>()
  /** Terminal subscribers borrow the port and never acquire the underlying resources. */
  const closeListeners = new Set<(reason?: unknown) => void>()

  /** Retire the actual physical resources once and deliver their first terminal reason. */
  const end = (reason?: unknown): void => {
    if (closed) return
    closed = true
    writeObserver = undefined
    writeGeneration++
    releaseDrains()
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
    onWrite(listener) {
      /** Replacement retires only diagnostic drain callbacks, never native write settlement. */
      const generation = ++writeGeneration
      releaseDrains()
      writeObserver = listener
      return () => {
        if (generation !== writeGeneration) return
        writeObserver = undefined
        writeGeneration++
        releaseDrains()
      }
    },
    write(chunk) {
      if (closed) return Promise.reject(terminal)
      return new Promise<void>((resolve, reject) => {
        /** Only observed writes read the clock; absent observation leaves native behavior intact. */
        const observer = writeObserver
        /** A pending drain cannot be retargeted to a later installation of the same callback. */
        const generation = writeGeneration
        /**
         * False writes measure through the native drain event, independently of callback
         * settlement.
         */
        const started = observer === undefined ? 0 : performance.now()
        /** Preserve the writer's existing callback and Promise; inspect only its returned boolean. */
        const accepted = writer.write(chunk, (error?: Error | null) => {
          if (error) reject(error)
          else if (closed) reject(terminal)
          else resolve()
        })
        if (observer !== undefined) {
          if (accepted === false) {
            /** This callback exists only on native backpressure, outside the normal write path. */
            const drained = (): void => {
              pendingDrains.delete(drained)
              if (!closed && generation === writeGeneration)
                observer(chunk, performance.now() - started)
            }
            pendingDrains.add(drained)
            writer.once('drain', drained)
          } else observer(chunk, 0)
        }
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
    carryNativeReplayResource(reader, channel)
  }
  if (byteViewFactory) byteViewFactories.set(channel, byteViewFactory)
  /** Existing opaque-write observers may decorate this raw I/O without obtaining a receipt. */
  return channel
}
