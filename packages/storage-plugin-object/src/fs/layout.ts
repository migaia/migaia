import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import {
  StorageContractError,
  StorageContractErrorCode,
  createStorageBlobBodyReader,
  orderStorageKeysByBytes,
  type IBlobInfo,
  type IOperationContext
} from '@migaia/storage-contract'
import {
  subscribeToAbort,
  throwIfAborted,
  readAbortReason
} from '@migaia/storage-host/authoring/backend'
import { ObjectDriverKind, ObjectNames } from '../constants.js'
import { ObjectErrorCode } from '../error-code.js'
import { ObjectErrorText } from '../error-text.js'
import { invalidArgument, isMissing, normalizeObjectError, objectError } from '../errors.js'
import type { IObjectNative, IObjectOpenContext, IObjectRead } from '../types.js'
import type { IObjectFileIo } from './io.js'
import { decodeObjectWireBytes } from '../wire.js'

/** One process cannot install two independent writers for the same real directory. */
const occupiedRoots = new Set<string>()
/** Pointer generation grammar prevents persisted text from escaping its own fixed directory. */
const generationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Hash directories and canonical wire keys contain only fixed-width lowercase hexadecimal. */
const hashPattern = /^[0-9a-f]{64}$/
/** One committed generation describes immutable bytes and metadata behind a single pointer. */
type ICurrent = {
  readonly generation: string
  readonly physicalKey: string
  readonly info: IBlobInfo
}
/** One complete canonical physical key selects one fixed digest directory. */
const physicalDigest = (key: string): string => createHash('sha256').update(key).digest('hex')

/** Read native not-found only as absence; malformed existing pointers and sidecars remain failures. */
async function readCurrent(
  io: IObjectFileIo,
  directory: string,
  key?: string
): Promise<ICurrent | undefined> {
  let text: string
  try {
    text = await io.readText(join(directory, ObjectNames.pointer))
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  try {
    const pointer = JSON.parse(text) as { version?: unknown; generation?: unknown }
    if (
      pointer.version !== ObjectNames.version ||
      typeof pointer.generation !== 'string' ||
      !generationPattern.test(pointer.generation) ||
      Object.keys(pointer).length !== 2
    )
      throw objectError(ObjectErrorCode.dataInvalid)
    const stored = JSON.parse(
      await io.readText(join(directory, pointer.generation + ObjectNames.metadata))
    ) as { version?: unknown; physicalKey?: unknown; info?: IBlobInfo }
    const info = stored.info
    if (
      stored.version !== ObjectNames.version ||
      typeof stored.physicalKey !== 'string' ||
      physicalDigest(stored.physicalKey) !== basename(directory) ||
      (key !== undefined && stored.physicalKey !== key) ||
      !info ||
      typeof info.key !== 'string' ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0 ||
      typeof info.etag !== 'string' ||
      !hashPattern.test(info.etag) ||
      !Number.isFinite(info.updatedAt) ||
      (info.contentType !== undefined && typeof info.contentType !== 'string') ||
      typeof info.metadata !== 'object' ||
      info.metadata === null ||
      Array.isArray(info.metadata) ||
      Object.values(info.metadata).some((value) => typeof value !== 'string')
    )
      throw objectError(ObjectErrorCode.dataInvalid)
    return {
      generation: pointer.generation,
      physicalKey: stored.physicalKey,
      info: Object.freeze({ ...info, metadata: Object.freeze({ ...info.metadata }) })
    }
  } catch (error) {
    throw objectError(ObjectErrorCode.dataInvalid, error)
  }
}

/** Convert the already canonical hex representation to ordering bytes without another key codec. */
const wireBytes = decodeObjectWireBytes

/**
 * Open one single-writer directory. Native adapters handle only I/O differences; pointer
 * publication, SHA-256, reader pins and shared radix pagination have exactly one implementation.
 */
export async function openFileObjects(
  path: string,
  io: IObjectFileIo,
  context: IObjectOpenContext
): Promise<IObjectNative> {
  /** Native realpath makes aliases share the same process-local installation identity. */
  const root = await io.root(path)
  if (occupiedRoots.has(root)) throw invalidArgument(new Error(ObjectErrorText.rootOccupied))
  occupiedRoots.add(root)
  /** Only generations with active native readers need retention metadata. */
  const readers = new Map<
    string,
    { count: number; retired: boolean; directory: string; generation: string }
  >()
  /** Native close has original per-resource Promise identity even when called repeatedly. */
  let primary: Promise<void> | undefined
  /** Symbolic cleanup reports independently without replacing the primary cleanup Promise. */
  let symbolic: Promise<void> | undefined
  /** Resolve a physical key to one fixed hash directory; original keys never become paths. */
  const hashOf = physicalDigest
  /** Only a fixed hex digest enters the filesystem path. */
  const directoryOf = (key: string): string => join(root, hashOf(key))
  /** Cleanup after a confirmed mutation reports failure and never changes its successful result. */
  const cleanup = async (directory: string, generation: string): Promise<void> => {
    try {
      await io.remove(join(directory, generation + ObjectNames.data))
      await io.remove(join(directory, generation + ObjectNames.metadata))
    } catch (error) {
      context.report(normalizeObjectError(error))
    }
  }
  /** Retire only an immutable old generation after its current pointer has changed or disappeared. */
  const retire = async (directory: string, generation: string): Promise<void> => {
    const pin = readers.get(join(directory, generation))
    if (pin) pin.retired = true
    else await cleanup(directory, generation)
  }
  /** Interrupted uploads and old generations are reclaimed once at installation, never by a daemon. */
  try {
    for (const entry of await io.entries(root)) {
      if (!entry.directory || !hashPattern.test(entry.name)) continue
      const directory = join(root, entry.name)
      const current = await readCurrent(io, directory)
      for (const file of await io.entries(directory)) {
        if (
          file.name === ObjectNames.pointer ||
          (current &&
            (file.name === current.generation + ObjectNames.data ||
              file.name === current.generation + ObjectNames.metadata))
        )
          continue
        try {
          await io.remove(join(directory, file.name))
        } catch (error) {
          context.report(normalizeObjectError(error))
        }
      }
    }
  } catch (error) {
    occupiedRoots.delete(root)
    throw normalizeObjectError(error)
  }
  /** Every file mutation and snapshot acquisition uses the original shared key-lock owner. */
  const locked = <T>(
    key: string,
    ctx: IOperationContext | undefined,
    run: () => Promise<T>
  ): Promise<T> => context.lock(hashOf(key), ctx, run)
  /** Release installation ownership only after the enclosing original resource owner drains reads. */
  const dispose = (): Promise<void> =>
    (primary ??= Promise.resolve().then(() => {
      occupiedRoots.delete(root)
    }))
  return {
    kind: ObjectDriverKind.fs,
    detect: async () => undefined,
    address: () => {
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: ObjectNames.backend
      })
    },
    put: (key, logicalKey, body, options) =>
      locked(key, options.ctx, async () => {
        const directory = directoryOf(key)
        const previous = await readCurrent(io, directory, key)
        if (
          (options.ifNoneMatch && previous) ||
          (options.ifMatch !== undefined && previous?.info.etag !== options.ifMatch)
        )
          throw new StorageContractError(
            StorageContractErrorCode.writeConflict,
            { backend: ObjectNames.backend },
            ObjectErrorText.conflict
          )
        const generation = crypto.randomUUID()
        const data = join(directory, generation + ObjectNames.data)
        const temporary = data + ObjectNames.temporary
        const metadata = join(directory, generation + ObjectNames.metadata)
        const pointer = join(directory, generation + ObjectNames.temporary)
        const hash = createHash('sha256')
        let size = 0
        let committed = false
        let dispatched = false
        const reader = createStorageBlobBodyReader(body, {
          backend: ObjectNames.backend,
          report: context.report,
          normalizeFailure: normalizeObjectError
        })
        const unsubscribe = subscribeToAbort(
          options.ctx?.signal,
          () => {
            // The original resource owner observes cleanup once in the final symbolic disposal.
            void reader.return?.(readAbortReason(options.ctx?.signal))
          },
          context.report
        )
        const hashing = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              throwIfAborted(options.ctx?.signal)
              const next = await reader.next()
              throwIfAborted(options.ctx?.signal)
              if (next.done) {
                controller.close()
                return
              }
              hash.update(next.value)
              size += next.value.byteLength
              controller.enqueue(next.value)
            }
          },
          { highWaterMark: 0 }
        )
        try {
          await io.mkdir(directory)
          await io.write(temporary, hashing)
          await io.rename(temporary, data)
          const info: IBlobInfo = Object.freeze({
            key: logicalKey,
            size,
            etag: hash.digest('hex'),
            contentType: options.contentType,
            metadata: options.metadata ?? Object.freeze({}),
            updatedAt: Date.now()
          })
          await io.writeText(
            metadata + ObjectNames.temporary,
            JSON.stringify({ version: ObjectNames.version, physicalKey: key, info })
          )
          await io.rename(metadata + ObjectNames.temporary, metadata)
          await io.writeText(pointer, JSON.stringify({ version: ObjectNames.version, generation }))
          if (options.ctx?.signal?.aborted)
            throw new StorageContractError(StorageContractErrorCode.aborted, {
              backend: ObjectNames.backend,
              cause: options.ctx.signal.reason
            })
          dispatched = true
          await io.rename(pointer, join(directory, ObjectNames.pointer))
          committed = true
          if (previous) await retire(directory, previous.generation)
          return info
        } catch (error) {
          if (dispatched && !committed) throw objectError(ObjectErrorCode.commitUnknown, error)
          throw normalizeObjectError(error)
        } finally {
          unsubscribe()
          await reader[Symbol.asyncDispose]()
          if (!committed && !dispatched)
            for (const file of [
              temporary,
              data,
              metadata + ObjectNames.temporary,
              metadata,
              pointer
            ]) {
              try {
                await io.remove(file)
              } catch (error) {
                context.report(normalizeObjectError(error))
              }
            }
        }
      }),
    get: (key, _logicalKey, options) =>
      locked(key, options.ctx, async (): Promise<IObjectRead | undefined> => {
        const directory = directoryOf(key)
        const current = await readCurrent(io, directory, key)
        if (!current) return undefined
        const start = options.range?.start ?? 0
        const end = Math.min(options.range?.end ?? current.info.size - 1, current.info.size - 1)
        if (start >= current.info.size || current.info.size === 0)
          return {
            info: current.info,
            source: new ReadableStream({
              start(controller) {
                controller.close()
              }
            }),
            close: async () => undefined
          }
        const native = await io.read(
          join(directory, current.generation + ObjectNames.data),
          start,
          end
        )
        const identity = join(directory, current.generation)
        const pin = readers.get(identity) ?? {
          count: 0,
          retired: false,
          directory,
          generation: current.generation
        }
        pin.count++
        readers.set(identity, pin)
        let close: Promise<void> | undefined
        return {
          info: current.info,
          source: native.source,
          close: () =>
            (close ??= (async () => {
              try {
                await native.close()
              } finally {
                pin.count--
                if (pin.count === 0) {
                  readers.delete(identity)
                  if (pin.retired) await cleanup(directory, current.generation)
                }
              }
            })())
        }
      }),
    head: (key, _logicalKey, ctx) =>
      locked(key, ctx, async () => (await readCurrent(io, directoryOf(key), key))?.info),
    remove: (key, ctx) =>
      locked(key, ctx, async () => {
        const directory = directoryOf(key)
        const current = await readCurrent(io, directory, key)
        if (!current) return false
        await io.remove(join(directory, ObjectNames.pointer))
        await retire(directory, current.generation)
        return true
      }),
    async list(prefix, after, limit, ctx) {
      const candidates: { wireKey: string; info: IBlobInfo; encoded: Uint8Array }[] = []
      for (const entry of await io.entries(root)) {
        if (!entry.directory || !hashPattern.test(entry.name)) continue
        const current = await context.lock(entry.name, ctx, () =>
          readCurrent(io, join(root, entry.name))
        )
        if (
          current &&
          current.physicalKey.startsWith(prefix) &&
          (after === undefined || current.physicalKey > after)
        )
          candidates.push({
            wireKey: current.physicalKey,
            info: current.info,
            encoded: wireBytes(current.physicalKey)
          })
      }
      const ordered = orderStorageKeysByBytes(candidates, (entry) => entry.encoded)
      const items = ordered.slice(0, limit).map(({ wireKey, info }) => ({ wireKey, info }))
      return {
        items,
        ...(ordered.length > limit ? { next: items[items.length - 1]!.wireKey } : {})
      }
    },
    dispose,
    [Symbol.asyncDispose]: () => (symbolic ??= dispose().then(undefined, context.report))
  }
}
