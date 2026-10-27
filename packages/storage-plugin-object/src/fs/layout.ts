import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IBlobInfo,
  type IOperationContext
} from '@migaia/storage-contract'
import {
  createStorageBlobBodyReader,
  orderStorageKeysByBytes,
  subscribeToAbort,
  throwIfAborted,
  readAbortReason
} from '@migaia/storage-host/sdk'
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
      info: { ...info, metadata: { ...info.metadata } }
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
  /** Real paths make aliases share one existing single-writer identity. */
  const root = await io.root(path)
  if (occupiedRoots.has(root)) throw invalidArgument(new Error(ObjectErrorText.rootOccupied))
  occupiedRoots.add(root)
  /** One named owner retains native state after interrupted files are reclaimed. */
  const objects = new FileObjectNative(root, io, context)
  await objects.reclaim()
  return objects
}

/** Native filesystem storage owns generation pins and one single-writer directory. */
class FileObjectNative implements IObjectNative {
  /** Native family controls supported object features. */
  readonly kind = ObjectDriverKind.fs
  /** Canonical directory identity is held until all admitted reads drain. */
  readonly #root: string
  /** The adapter owns platform I/O; this class owns storage semantics. */
  readonly #io: IObjectFileIo
  /** Original host ports supply key locks and cleanup reporting. */
  readonly #context: IObjectOpenContext
  /** Only generations with live readers retain retirement state. */
  readonly #readers = new Map<
    string,
    { count: number; retired: boolean; directory: string; generation: string }
  >()
  /** Ordinary disposal preserves its original shared promise. */
  #primary: Promise<void> | undefined
  /** Symbol disposal reports once without replacing the primary promise. */
  #symbolic: Promise<void> | undefined
  /** Bind state without changing the original installation order. */
  constructor(root: string, io: IObjectFileIo, context: IObjectOpenContext) {
    this.#root = root
    this.#io = io
    this.#context = context
  }

  /** Resolve only a fixed digest into the native directory. */
  #directoryOf = (key: string): string => join(this.#root, physicalDigest(key))

  /** Report retired-generation cleanup without changing a committed result. */
  #cleanup = async (directory: string, generation: string): Promise<void> => {
    try {
      await this.#io.remove(join(directory, generation + ObjectNames.data))
      await this.#io.remove(join(directory, generation + ObjectNames.metadata))
    } catch (error) {
      this.#context.report(normalizeObjectError(error))
    }
  }

  /** Defer old-generation cleanup until its last reader releases. */
  #retire = async (directory: string, generation: string): Promise<void> => {
    const pin = this.#readers.get(join(directory, generation))
    if (pin) pin.retired = true
    else await this.#cleanup(directory, generation)
  }

  /** Reuse the existing host key-lock owner for one native operation. */
  #locked = <T>(
    key: string,
    ctx: IOperationContext | undefined,
    run: () => Promise<T>
  ): Promise<T> => this.#context.lock(physicalDigest(key), ctx, run)

  /** Reclaim interrupted uploads once during installation; failed installation releases ownership. */
  async reclaim() {
    try {
      for (const entry of await this.#io.entries(this.#root)) {
        if (!entry.directory || !hashPattern.test(entry.name)) continue
        const directory = join(this.#root, entry.name)
        const current = await readCurrent(this.#io, directory)
        for (const file of await this.#io.entries(directory)) {
          if (
            file.name === ObjectNames.pointer ||
            (current &&
              (file.name === current.generation + ObjectNames.data ||
                file.name === current.generation + ObjectNames.metadata))
          )
            continue
          try {
            await this.#io.remove(join(directory, file.name))
          } catch (error) {
            this.#context.report(normalizeObjectError(error))
          }
        }
      }
    } catch (error) {
      occupiedRoots.delete(this.#root)
      throw normalizeObjectError(error)
    }
  }

  /** Execute the original detect operation with this owner's native state. */
  detect: IObjectNative['detect'] = async () => undefined

  /** Execute the original address operation with this owner's native state. */
  address: IObjectNative['address'] = () => {
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: ObjectNames.backend
    })
  }

  /** Execute the original put operation with this owner's native state. */
  put: IObjectNative['put'] = (key, logicalKey, body, options) =>
    this.#locked(key, options.ctx, async () => {
      const directory = this.#directoryOf(key)
      const previous = await readCurrent(this.#io, directory, key)
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
        report: this.#context.report,
        normalizeFailure: normalizeObjectError
      })
      const unsubscribe = subscribeToAbort(
        options.ctx?.signal,
        () => {
          // The original resource owner observes cleanup once in the final symbolic disposal.
          void reader.return?.(readAbortReason(options.ctx?.signal))
        },
        this.#context.report
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
        await this.#io.mkdir(directory)
        await this.#io.write(temporary, hashing)
        await this.#io.rename(temporary, data)
        const info: IBlobInfo = {
          key: logicalKey,
          size,
          etag: hash.digest('hex'),
          contentType: options.contentType,
          metadata: options.metadata ?? {},
          updatedAt: Date.now()
        }
        await this.#io.writeText(
          metadata + ObjectNames.temporary,
          JSON.stringify({ version: ObjectNames.version, physicalKey: key, info })
        )
        await this.#io.rename(metadata + ObjectNames.temporary, metadata)
        await this.#io.writeText(
          pointer,
          JSON.stringify({ version: ObjectNames.version, generation })
        )
        if (options.ctx?.signal?.aborted)
          throw new StorageContractError(StorageContractErrorCode.aborted, {
            backend: ObjectNames.backend,
            cause: options.ctx.signal.reason
          })
        dispatched = true
        await this.#io.rename(pointer, join(directory, ObjectNames.pointer))
        committed = true
        if (previous) await this.#retire(directory, previous.generation)
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
              await this.#io.remove(file)
            } catch (error) {
              this.#context.report(normalizeObjectError(error))
            }
          }
      }
    })

  /** Execute the original get operation with this owner's native state. */
  get: IObjectNative['get'] = (key, _logicalKey, options) =>
    this.#locked(key, options.ctx, async (): Promise<IObjectRead | undefined> => {
      const directory = this.#directoryOf(key)
      const current = await readCurrent(this.#io, directory, key)
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
      const native = await this.#io.read(
        join(directory, current.generation + ObjectNames.data),
        start,
        end
      )
      const identity = join(directory, current.generation)
      const pin = this.#readers.get(identity) ?? {
        count: 0,
        retired: false,
        directory,
        generation: current.generation
      }
      pin.count++
      this.#readers.set(identity, pin)
      return new FileObjectRead(current.info, native, () => this.#releaseRead(identity))
    })

  /** The last reader releases its generation only after native handle cleanup settles. */
  async #releaseRead(identity: string): Promise<void> {
    /** Every opened reader registers its generation before publication. */
    const pin = this.#readers.get(identity)!
    pin.count--
    if (pin.count === 0) {
      this.#readers.delete(identity)
      if (pin.retired) await this.#cleanup(pin.directory, pin.generation)
    }
  }

  /** Execute the original head operation with this owner's native state. */
  head: IObjectNative['head'] = (key, _logicalKey, ctx) =>
    this.#locked(
      key,
      ctx,
      async () => (await readCurrent(this.#io, this.#directoryOf(key), key))?.info
    )

  /** Execute the original remove operation with this owner's native state. */
  remove: IObjectNative['remove'] = (key, ctx) =>
    this.#locked(key, ctx, async () => {
      const directory = this.#directoryOf(key)
      const current = await readCurrent(this.#io, directory, key)
      if (!current) return false
      await this.#io.remove(join(directory, ObjectNames.pointer))
      await this.#retire(directory, current.generation)
      return true
    })

  /** List committed generations in the canonical physical-key order. */
  list: IObjectNative['list'] = async (prefix, after, limit, ctx) => {
    const candidates: { wireKey: string; info: IBlobInfo; encoded: Uint8Array }[] = []
    for (const entry of await this.#io.entries(this.#root)) {
      if (!entry.directory || !hashPattern.test(entry.name)) continue
      const current = await this.#context.lock(entry.name, ctx, () =>
        readCurrent(this.#io, join(this.#root, entry.name))
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
  }

  /** Release single-writer ownership after the enclosing resource owner drains reads. */
  dispose = (): Promise<void> =>
    (this.#primary ??= Promise.resolve().then(() => {
      occupiedRoots.delete(this.#root)
    }));
  /** Symbol cleanup reports once without replacing the ordinary disposal promise. */
  [Symbol.asyncDispose] = () =>
    (this.#symbolic ??= this.dispose().then(undefined, this.#context.report))
}

/** One native read owns its close promise and the generation pin released after native cleanup. */
class FileObjectRead implements IObjectRead {
  /** Metadata belongs to the same committed generation as this stream. */
  readonly info: IBlobInfo
  /** The outer blob resource owns consumption and cancellation. */
  readonly source: ReadableStream<Uint8Array>
  /** Native cleanup must settle before the generation pin can be released. */
  readonly #native: Awaited<ReturnType<IObjectFileIo['read']>>
  /** The filesystem owner alone maintains generation retention. */
  readonly #release: () => Promise<void>
  /** Repeated closes preserve the exact original cleanup promise. */
  #primary: Promise<void> | undefined
  /** Bind a confirmed generation and the already-open native handle. */
  constructor(
    info: IBlobInfo,
    native: Awaited<ReturnType<IObjectFileIo['read']>>,
    release: () => Promise<void>
  ) {
    this.info = info
    this.source = native.source
    this.#native = native
    this.#release = release
  }
  /** Native failure still releases the pin while remaining the primary read-close error. */
  close = (): Promise<void> => (this.#primary ??= this.#closeNative())
  /** Release in the original finally order so obsolete generations cannot outlive their reader. */
  async #closeNative(): Promise<void> {
    try {
      await this.#native.close()
    } finally {
      await this.#release()
    }
  }
}
