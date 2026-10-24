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
class RuntimeEventByteIO {
  /** Original reader resource retained by this single adapter owner. */
  #reader: IRuntimeEventByteReader

  /** Original writer resource retained by this single adapter owner. */
  #writer: IRuntimeEventByteWriter

  /** Original physical resource retained by this single adapter owner. */
  #physical: IRuntimeBytePhysicalResource

  /** Original closedDiagnostic resource retained by this single adapter owner. */
  #closedDiagnostic: IRuntimeDiagnosticError

  /** Late listeners receive the same original terminal value without replacing its identity. */
  #terminal: unknown

  /** EOF, write errors and explicit close share one physical retirement. */
  #closed

  /** Only an installed byte carrier observes native write/drain facts. */
  #writeObserver: ((chunk: Uint8Array, drainMs: number) => void) | undefined

  /** False-write callbacks belong to the current observer installation only. */
  #writeGeneration

  /** Backpressure retains bytes only until native drain or observation retirement. */
  #pendingDrains

  /** Cold replacement and close release actual native callbacks without changing write Promises. */
  #releaseDrains = (): void => {
    for (const listener of this.#pendingDrains) this.#writer.off?.('drain', listener)
    this.#pendingDrains.clear()
  }

  /** Core counts its actual byte subscribers rather than accepting an exclusivity callback. */
  #dataListeners

  /** Terminal subscribers borrow the port and never acquire the underlying resources. */
  #closeListeners

  /** Retire the actual physical resources once and deliver their first terminal reason. */
  #end = (reason?: unknown): void => {
    if (this.#closed) return
    this.#closed = true
    this.#writeObserver = undefined
    this.#writeGeneration++
    this.#releaseDrains()
    this.#terminal = reason ?? createRuntimeDiagnosticError(this.#closedDiagnostic)
    this.#physical.close()
    for (const listener of this.#closeListeners) listener(this.#terminal)
    this.#dataListeners.clear()
    this.#closeListeners.clear()
  }

  /** The exact constructed identity owns its physical writer and original subscription count. */
  #channel: IRuntimeByteIO

  /** Frozen operation surface keeps the original transport/resource identity. */
  readonly value: IRuntimeByteIO
  /** Acquire resources and install native observers in the original construction order. */
  constructor(
    reader: IRuntimeEventByteReader,
    writer: IRuntimeEventByteWriter,
    physical: IRuntimeBytePhysicalResource,
    closedDiagnostic: IRuntimeDiagnosticError,
    byteViewFactory?: IRuntimeByteViewFactory
  ) {
    this.#reader = reader
    this.#writer = writer
    this.#physical = physical
    this.#closedDiagnostic = closedDiagnostic

    /** The physical reader stays paused until the original byte owner subscribes. */
    this.#reader.pause()
    this.#closed = false
    this.#writeGeneration = 0
    this.#pendingDrains = new Set<() => void>()
    this.#dataListeners = new Set<(chunk: Uint8Array) => void>()
    this.#closeListeners = new Set<(reason?: unknown) => void>()

    this.#reader.on('data', (chunk: Uint8Array) => {
      for (const listener of this.#dataListeners) listener(chunk)
    })

    this.#reader.once('end', () => this.#end())

    this.#reader.once('error', this.#end)

    this.#writer.once('error', this.#end)

    this.#writer.once('close', () => this.#end())
    this.#channel = RuntimeEventByteIO.#createChannel(this)

    /** Shared duplex resources retain the established legacy behavior of ordinary socket carriers. */
    if (!Object.is(this.#reader, this.#writer)) {
      /** Rewrapping the same held reader never creates another native lifetime owner. */
      registerNativeReplayOwner(this.#reader, {
        alive: () => !this.#closed && !this.#reader.destroyed && !this.#writer.destroyed,
        exclusive: () => this.#dataListeners.size <= 1 && this.#reader.listenerCount('data') === 1
      })
      carryNativeReplayResource(this.#reader, this.#channel)
    }

    if (byteViewFactory) byteViewFactories.set(this.#channel, byteViewFactory)

    /** Existing opaque-write observers may decorate this raw I/O without obtaining a receipt. */

    this.value = this.#channel
  }

  /** Construct the same operation view while native lifetime stays with this owner. */
  static #createChannel(owner: RuntimeEventByteIO): IRuntimeByteIO {
    return {
      kind: 'byte',
      onWrite(listener) {
        /** Replacement retires only diagnostic drain callbacks, never native write settlement. */
        const generation = ++owner.#writeGeneration
        owner.#releaseDrains()
        owner.#writeObserver = listener
        return () => {
          if (generation !== owner.#writeGeneration) return
          owner.#writeObserver = undefined
          owner.#writeGeneration++
          owner.#releaseDrains()
        }
      },
      write(chunk) {
        if (owner.#closed) return Promise.reject(owner.#terminal)
        return new Promise<void>((resolve, reject) => {
          /** Only observed writes read the clock; absent observation leaves native behavior intact. */
          const observer = owner.#writeObserver
          /** A pending drain cannot be retargeted to a later installation of the same callback. */
          const generation = owner.#writeGeneration
          /**
           * False writes measure through the native drain event, independently of callback
           * settlement.
           */
          const started = observer === undefined ? 0 : performance.now()
          /** Preserve the writer's existing callback and Promise; inspect only its returned boolean. */
          const accepted = owner.#writer.write(chunk, (error?: Error | null) => {
            if (error) reject(error)
            else if (owner.#closed) reject(owner.#terminal)
            else resolve()
          })
          if (observer !== undefined) {
            if (accepted === false) {
              /** This callback exists only on native backpressure, outside the normal write path. */
              const drained = (): void => {
                owner.#pendingDrains.delete(drained)
                if (!owner.#closed && generation === owner.#writeGeneration)
                  observer(chunk, performance.now() - started)
              }
              owner.#pendingDrains.add(drained)
              owner.#writer.once('drain', drained)
            } else observer(chunk, 0)
          }
        })
      },
      onData(listener) {
        owner.#dataListeners.add(listener)
        owner.#reader.resume()
        return () => {
          owner.#dataListeners.delete(listener)
          if (owner.#dataListeners.size === 0) owner.#reader.pause()
        }
      },
      onClose(listener) {
        if (owner.#closed) listener(owner.#terminal)
        else owner.#closeListeners.add(listener)
        return () => owner.#closeListeners.delete(listener)
      },
      close() {
        if (owner.#closed) return
        owner.#end()
      }
    }
  }
}

/** Construct one held native byte port with its original write/drain and subscriber ownership. */
export function createRuntimeEventByteIO(
  reader: IRuntimeEventByteReader,
  writer: IRuntimeEventByteWriter,
  physical: IRuntimeBytePhysicalResource,
  closedDiagnostic: IRuntimeDiagnosticError,
  byteViewFactory?: IRuntimeByteViewFactory
): IRuntimeByteIO {
  return new RuntimeEventByteIO(reader, writer, physical, closedDiagnostic, byteViewFactory).value
}
