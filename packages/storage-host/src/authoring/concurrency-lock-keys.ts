// Lock key parsing, canonical encoding and snapshots for the concurrency SDK (see ./concurrency.ts).
import {
  type ILockKey,
  type ITransactionOptions,
  type ILockHolding,
  LockChannel,
  type INormalizedLockKey,
  invalidLockArgument,
  assertLockKey,
  assertStringStorageKey,
  type IQuad,
  type IBackendKind,
  type IStorageKey
} from '@migaia/storage-contract'
import {
  snapshotStorageKey,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  storageKeyBytesIdentity,
  sortStorageByteIdentities
} from './key.js'
import { snapshotStorageRdfQuad, encodeRdfQuadSnapshot } from './rdf.js'
import { snapshotLockIdentities } from './concurrency-attempt.js'

/** Disjoint channel markers prevent equal user keys in different channels from colliding. */
const LockChannelRank = { text: 1, bytes: 2, record: 3, vector: 4, rdf: 5 } as const

/** Capture text identity before queued lock admission can observe caller key changes. */
function parseTextLock(
  value: Extract<ILockKey, { channel: 'text' }>,
  backend: IBackendKind | undefined
): ILockKey {
  return { channel: LockChannel.text, key: snapshotStorageKey(value.key, backend) }
}

/** Bytes retain the existing string-only key domain without allocating another key image. */
function parseBytesLock(value: Extract<ILockKey, { channel: 'bytes' }>): ILockKey {
  return { channel: LockChannel.bytes, key: value.key }
}

/** Capture mutable record key components before the real lock queue yields. */
function parseRecordLock(
  value: Extract<ILockKey, { channel: 'record' }>,
  backend: IBackendKind | undefined
): ILockKey {
  return { channel: LockChannel.record, key: snapshotStorageKey(value.key, backend) }
}

/** Vector point identity consists only of its collection/id strings. */
function parseVectorLock(value: Extract<ILockKey, { channel: 'vector' }>): ILockKey {
  return { channel: LockChannel.vector, collection: value.collection, id: value.id }
}

/** Ground quad fields span queued lock admission and share the canonical RDF capture owner. */
function parseRdfLock(
  value: Extract<ILockKey, { channel: 'rdf' }>,
  backend: IBackendKind | undefined
): ILockKey {
  return { channel: LockChannel.rdf, quad: snapshotStorageRdfQuad(value.quad, backend) }
}

/** Dispatch the supported channel once; each channel owns exactly its actual input fields. */
export function snapshotLockKey(value: unknown, backend: IBackendKind | undefined): ILockKey {
  assertLockKey(value, backend)
  /** Only the snapshot boundary detaches mutable keys or ground term objects for queued use. */
  const key = value
  switch (key.channel) {
    case LockChannel.text:
      return parseTextLock(key, backend)
    case LockChannel.bytes:
      return parseBytesLock(key)
    case LockChannel.record:
      return parseRecordLock(key, backend)
    case LockChannel.vector:
      return parseVectorLock(key)
    case LockChannel.rdf:
      return parseRdfLock(key, backend)
    default:
      throw invalidLockArgument(backend)
  }
}

/** Public factories snapshot immediately without inventing a backend when no store exists yet. */
export const lockKey = Object.freeze({
  /** Text locks use the same typed key domain as single and batch text identity. */
  text(key: IStorageKey): Extract<ILockKey, { readonly channel: 'text' }> {
    return snapshotLockKey({ channel: LockChannel.text, key }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'text' }
    >
  },
  /** Byte locks retain their existing string-only physical channel. */
  bytes(key: string): Extract<ILockKey, { readonly channel: 'bytes' }> {
    return snapshotLockKey({ channel: LockChannel.bytes, key }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'bytes' }
    >
  },
  /** Record locks detach Dates, buffers and nested arrays through the existing validator. */
  record(key: IStorageKey): Extract<ILockKey, { readonly channel: 'record' }> {
    return snapshotLockKey({ channel: LockChannel.record, key }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'record' }
    >
  },
  /** Vector locks share one exact collection/point identity with native writes and TTL. */
  vector(collection: string, id: string): Extract<ILockKey, { readonly channel: 'vector' }> {
    return snapshotLockKey({ channel: LockChannel.vector, collection, id }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'vector' }
    >
  },
  /** RDF locks detach a complete ground quad through its canonical term owner. */
  rdf(quad: IQuad): Extract<ILockKey, { readonly channel: 'rdf' }> {
    return snapshotLockKey({ channel: LockChannel.rdf, quad }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'rdf' }
    >
  }
})

/** Encodes only canonical channel content for both native identity and unchanged diagnostics. */
export function encodeLockContent(key: ILockKey, backend: IBackendKind | undefined): Uint8Array {
  return key.channel === LockChannel.rdf
    ? encodeRdfQuadSnapshot(key.quad)
    : encodeOrderedStorageKey(
        key.channel === LockChannel.vector ? [key.collection, key.id] : key.key,
        backend
      )
}

/** Adds only channel identity around the sole canonical ordered-key encoder. */
function encodeLockIdentity(key: ILockKey, backend: IBackendKind | undefined): Uint8Array {
  /** Key-order and RDF own all self-delimiting content bytes. */
  const ordered = encodeLockContent(key, backend)
  /** New vector/RDF markers follow the unchanged text < bytes < record order. */
  const encoded = new Uint8Array(ordered.length + 1)
  encoded[0] = LockChannelRank[key.channel]
  encoded.set(ordered, 1)
  return encoded
}

/**
 * Detaches only the current inspection rows and orders them with the original stable byte radix.
 * Equal keys retain their individual holder/lease rows; no lock or resource authority is granted.
 */
export function snapshotConcurrencyLockHoldings(
  rows: readonly ILockHolding[]
): readonly ILockHolding[] {
  if (!Array.isArray(rows)) throw invalidLockArgument(undefined)
  /** Encodings belong only to this inspection and never replace authentic attempt metadata. */
  const entries: { readonly encoded: Uint8Array; readonly row: ILockHolding }[] = []
  for (const row of rows) {
    /** Public diagnostics can retain and mutate Date/binary keys while the lease remains active. */
    const captured = { ...row, key: snapshotLockKey(row.key, undefined) }
    entries.push({ encoded: encodeLockIdentity(captured.key, undefined), row: captured })
  }
  sortStorageByteIdentities(entries)
  return entries.map((entry) => entry.row)
}

/** Adjacent deduplication charges each compared encoding at most twice. */
function equalLockIdentity(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false
  return true
}

/**
 * Internal owner/builder normalization snapshots once, encodes once and sorts by actual byte
 * suffixes. The immutable result has independent keys and no comparison sort or global cache.
 */
export function normalizeLockKeys(
  keys: unknown,
  backend: IBackendKind
): readonly INormalizedLockKey[] {
  if (!Array.isArray(keys)) throw invalidLockArgument(backend)
  /** Normalization keeps only this input's independent key snapshots and encodings. */
  const entries: INormalizedLockKey[] = []
  for (const value of keys) {
    /** Mutable key components must survive actual queued acquisition and asynchronous retries. */
    const key = snapshotLockKey(value, backend)
    entries.push({ key, encoded: encodeLockIdentity(key, backend) })
  }
  return uniqueNormalizedLockKeys(entries)
}

/** Reuses captured byte identities when original options acquire additional implicit locks. */
export function uniqueNormalizedLockKeys(
  entries: INormalizedLockKey[]
): readonly INormalizedLockKey[] {
  sortStorageByteIdentities(entries)
  /** Only adjacent canonical identities are compared; mutable object identity never deduplicates. */
  const unique: INormalizedLockKey[] = []
  for (const entry of entries) {
    /** The last retained item is already in canonical order. */
    const previous = unique[unique.length - 1]
    if (!previous || !equalLockIdentity(previous.encoded, entry.encoded)) unique.push(entry)
  }
  return unique
}

/**
 * Captures one canonical lock set and its matching immutable identities without granting admission
 * authority. Consumers share the original key snapshot, ordered encoder and stable deduplication.
 */
export function snapshotConcurrencyLockKeys(
  keys: unknown,
  backend: IBackendKind
): { readonly keys: readonly ILockKey[]; readonly identities: readonly string[] } {
  /** One normalization supplies both detached logical keys and their already captured bytes. */
  const locks = normalizeLockKeys(keys, backend)
  return {
    keys: locks.map((entry) => entry.key),
    identities: snapshotLockIdentities(locks)
  }
}

/**
 * Projects one channel or typed prefix into the same half-open hexadecimal identity interval as
 * active locks. This is a pure range snapshot, without a lock table or acquisition authority.
 */
export function snapshotConcurrencyLockRange(
  range: { readonly channel: ILockKey['channel']; readonly prefix?: IStorageKey },
  backend: IBackendKind
): { readonly lower: string; readonly upper: string } {
  if (typeof range !== 'object' || range === null || Array.isArray(range))
    throw invalidLockArgument(backend)
  /** Scalar channel/prefix intent is consumed synchronously by the canonical encoder. */
  const { channel, prefix } = range
  if (
    channel !== LockChannel.text &&
    channel !== LockChannel.bytes &&
    channel !== LockChannel.record &&
    channel !== LockChannel.vector &&
    channel !== LockChannel.rdf
  )
    throw invalidLockArgument(backend)
  /** Only the original channel owner supplies its finite physical ordering. */
  const rank = LockChannelRank[channel]
  if (prefix === undefined)
    return {
      lower: storageKeyBytesIdentity(new Uint8Array([rank])),
      upper: storageKeyBytesIdentity(new Uint8Array([rank + 1]))
    }
  if (channel === LockChannel.vector || channel === LockChannel.rdf)
    throw invalidLockArgument(backend)
  if (channel === LockChannel.bytes) assertStringStorageKey(prefix, backend)
  /** The original prefix writer owns all type tags, variable terminators and strict successors. */
  const bounds = snapshotStorageKeyPrefix(prefix, backend)
  /** Each bound adds only the same channel byte used by individual lock normalization. */
  const withChannel = (bytes: Uint8Array): string => {
    /** One allocation holds the captured channel and the original bound bytes. */
    const encoded = new Uint8Array(bytes.length + 1)
    encoded[0] = rank
    encoded.set(bytes, 1)
    return storageKeyBytesIdentity(encoded)
  }
  return { lower: withChannel(bounds.lower), upper: withChannel(bounds.upper) }
}

/** Fixed fields have already been captured by the original option/context admission path. */
const capturedConcurrencyFields = {
  lock: true,
  concurrency: true,
  signal: true,
  timeoutMs: true,
  pageSize: true,
  conflictPolicy: true,
  orgId: true
}

/**
 * Captures backend extension fields once for contexts that cross real preparation and attempt
 * awaits.
 */
export function snapshotConcurrencyExtensions(options: ITransactionOptions): object {
  /** Plain owned properties preserve native option values and symbol fields on every attempt. */
  const extensions = {}
  for (const key of Reflect.ownKeys(options)) {
    if (Object.hasOwn(capturedConcurrencyFields, key)) continue
    Object.defineProperty(extensions, key, {
      value: options[key as keyof ITransactionOptions],
      enumerable: true
    })
  }
  return extensions
}
