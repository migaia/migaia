import {
  assertStorageKey,
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind,
  type IStorageKey,
  type IStorageBatchKey,
  type IStorageBatchKeyCapture,
  type IStorageKeyPrefix,
  assertStringStorageKey,
  KEY_DOMAIN_LIMITS,
  StorageContractErrorText,
  assertStorageOrgId
} from '@migaia/storage-contract'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'

/** Copies admitted mutable components once before backend work can await caller changes. */
function cloneStorageKey(candidate: IStorageKey): IStorageKey {
  if (typeof candidate === 'string' || typeof candidate === 'number') return candidate
  if (Array.isArray(candidate)) return candidate.map(cloneStorageKey)
  if (isArrayBuffer(candidate)) return new Uint8Array(candidate).slice().buffer
  return new Date(Reflect.apply(Date.prototype.getTime, candidate, []) as number)
}

/**
 * Validates the original key then copies its mutable Date, binary and array components once before
 * asynchronous work. Validation owns all key-domain rules; the private copy does not revalidate
 * independently owned data.
 */
export function snapshotStorageKey(
  value: unknown,
  backend: IBackendKind | undefined,
  label = 'key'
): IStorageKey {
  assertStorageKey(value, backend, label)
  return cloneStorageKey(value)
}

/** Orders admitted key kinds without probing or cloning mutable component data. */
function storageKeyRank(value: IStorageKey): number {
  if (typeof value === 'number') return 0
  if (typeof value === 'string') return 2
  if (Array.isArray(value)) return 4
  return isArrayBuffer(value) ? 3 : 1
}

/**
 * Compares already-valid storage keys for sorting or range work without touching a provider.
 * Returns a negative, zero, or positive number; it is not restricted to -1/0/1. Cross-type order is
 * number, Date, string, ArrayBuffer, then array. Binary values compare bytewise and arrays compare
 * componentwise, with a shorter equal prefix first. Use assertStorageKey before unknown inputs.
 */
export const compareStorageKeys = (a: IStorageKey, b: IStorageKey): number => {
  const rankA = storageKeyRank(a)
  const rankB = storageKeyRank(b)
  if (rankA !== rankB) return rankA - rankB
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const dateA = rankA === 1 ? (Reflect.apply(Date.prototype.getTime, a, []) as number) : undefined
  const dateB = rankB === 1 ? (Reflect.apply(Date.prototype.getTime, b, []) as number) : undefined
  if (dateA !== undefined && dateB !== undefined) return dateA - dateB
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  const bytesA = rankA === 3 ? new Uint8Array(a as ArrayBuffer) : undefined
  const bytesB = rankB === 3 ? new Uint8Array(b as ArrayBuffer) : undefined
  if (bytesA !== undefined && bytesB !== undefined) {
    const viewA = bytesA
    const viewB = bytesB
    const length = Math.min(viewA.length, viewB.length)
    for (let index = 0; index < length; index += 1) {
      if (viewA[index] !== viewB[index]) return viewA[index]! - viewB[index]!
    }
    return viewA.length - viewB.length
  }
  const arrayA = a as readonly IStorageKey[]
  const arrayB = b as readonly IStorageKey[]
  const length = Math.min(arrayA.length, arrayB.length)
  for (let index = 0; index < length; index += 1) {
    const comparison = compareStorageKeys(arrayA[index]!, arrayB[index]!)
    if (comparison !== 0) return comparison
  }
  return arrayA.length - arrayB.length
}

/** Tags preserve the canonical cross-type order; zero terminates a variable-length component. */
const OrderedKeyTag = { number: 1, date: 2, string: 3, bytes: 4, array: 5 } as const

/** Counts output once; child encodings are never repeatedly concatenated into parent arrays. */
function measureKey(key: IStorageKey): number {
  if (typeof key === 'number' || storageKeyRank(key) === 1) return 9
  if (typeof key === 'string') return 2 + key.length * 3
  if (Array.isArray(key)) {
    /** Array tag and terminator surround each complete child encoding. */
    let size = 2
    for (const child of key) size += measureKey(child)
    return size
  }
  return 2 + (key as ArrayBuffer).byteLength * 2
}

/** Writes an already admitted canonical snapshot; only the root variable terminator may be omitted. */
/** One synchronous writer owns its output allocation and monotonic byte cursor. */
type IOrderedKeyWriter = { readonly output: Uint8Array; readonly view: DataView; offset: number }
/** Writes sortable IEEE-754 bits into the original output allocation. */
function writeOrderedKeyNumber(context: IOrderedKeyWriter, value: number): void {
  context.view.setFloat64(context.offset, value === 0 ? 0 : value, false)
  if (value < 0) {
    for (let index = 0; index < 8; index += 1) context.output[context.offset + index] ^= 255
  } else context.output[context.offset] ^= 128
  context.offset += 8
}
/** Writes one admitted component without copying caller data during synchronous encoding. */
function writeOrderedKey(context: IOrderedKeyWriter, value: IStorageKey, omitEnd = false): void {
  if (typeof value === 'number') {
    context.output[context.offset++] = OrderedKeyTag.number
    writeOrderedKeyNumber(context, value)
    return
  }
  if (storageKeyRank(value) === 1) {
    context.output[context.offset++] = OrderedKeyTag.date
    writeOrderedKeyNumber(context, Reflect.apply(Date.prototype.getTime, value, []) as number)
    return
  }
  if (typeof value === 'string') {
    context.output[context.offset++] = OrderedKeyTag.string
    for (let index = 0; index < value.length; index += 1) {
      /** UTF-16 ordering includes lone surrogate code units unchanged. */
      const unit = value.charCodeAt(index)
      context.output[context.offset++] = 1
      context.output[context.offset++] = unit >>> 8
      context.output[context.offset++] = unit & 255
    }
  } else if (Array.isArray(value)) {
    context.output[context.offset++] = OrderedKeyTag.array
    for (const child of value) writeOrderedKey(context, child)
  } else {
    context.output[context.offset++] = OrderedKeyTag.bytes
    for (const byte of new Uint8Array(value as ArrayBuffer)) {
      context.output[context.offset++] = 1
      context.output[context.offset++] = byte
    }
  }
  if (!omitEnd) context.output[context.offset++] = 0
}
/** Allocates only the final encoded bytes; the caller already completed pure key admission. */
function encodeKeySnapshot(snapshot: IStorageKey, prefix: boolean): Uint8Array {
  /** Variable root terminators are omitted only for canonical prefix bounds. */
  const omitRootEnd = prefix && typeof snapshot !== 'number' && storageKeyRank(snapshot) !== 1
  /** One allocation is owned exclusively by the writer until publication. */
  const output = new Uint8Array(measureKey(snapshot) - (omitRootEnd ? 1 : 0))
  /** Context makes the recursive writer's mutable cursor ownership explicit. */
  const context: IOrderedKeyWriter = { output, view: new DataView(output.buffer), offset: 0 }
  writeOrderedKey(context, snapshot, omitRootEnd)
  return output
}

/**
 * Snapshots the existing key domain and writes its complete independent order-preserving bytes.
 * UTF-16, binary prefixes, nested keys and normalized signed zero retain canonical comparison.
 */
export function encodeOrderedStorageKey(
  key: unknown,
  backend: IBackendKind | undefined
): Uint8Array {
  assertStorageKey(key, backend)
  return encodeKeySnapshot(key, false)
}

/**
 * Read the exact existing ordered-key wire format for native backends that enumerate physical keys.
 * No alternate encoding is introduced. Bounds are checked before allocation and the original key
 * owner validates the resulting domain; malformed or noncanonical bytes throw INVALID_KEY.
 */
/** One native wire reader owns only its original input view and bounded cursors. */
type IOrderedKeyReader = {
  readonly encoded: Uint8Array
  readonly backend: IBackendKind | undefined
  offset: number
  nodes: number
}
/** All malformed encodings retain the existing key-domain source, code and text. */
function invalidOrderedKey(context: IOrderedKeyReader): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidKey,
    { backend: context.backend },
    StorageContractErrorText.orderedKeyInvalid
  )
}
/** Reject truncated components before fixed-width reads or data-dependent allocations. */
function requireOrderedKeyBytes(context: IOrderedKeyReader, count: number): void {
  if (context.offset + count > context.encoded.byteLength) invalidOrderedKey(context)
}
/** Parse one self-delimiting component using the same canonical tag table as the writer. */
function readOrderedKey(context: IOrderedKeyReader, depth: number): IStorageKey {
  if (++context.nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth)
    invalidOrderedKey(context)
  requireOrderedKeyBytes(context, 1)
  const tag = context.encoded[context.offset++]
  if (tag === OrderedKeyTag.number || tag === OrderedKeyTag.date) {
    requireOrderedKeyBytes(context, 8)
    const bytes = context.encoded.slice(context.offset, context.offset + 8)
    context.offset += 8
    if (bytes[0]! & 128) bytes[0]! ^= 128
    else for (let index = 0; index < 8; index++) bytes[index]! ^= 255
    const value = new DataView(bytes.buffer).getFloat64(0, false)
    if (!Number.isFinite(value) || Object.is(value, -0)) invalidOrderedKey(context)
    if (tag === OrderedKeyTag.number) return value
    const date = new Date(value)
    if (date.getTime() !== value) invalidOrderedKey(context)
    return date
  }
  if (tag === OrderedKeyTag.string) {
    /** Bounded chunks avoid spread argument limits without normalizing UTF-16 surrogate units. */
    let result = ''
    const units: number[] = []
    for (;;) {
      requireOrderedKeyBytes(context, 1)
      const marker = context.encoded[context.offset++]
      if (marker === 0) break
      if (marker !== 1) invalidOrderedKey(context)
      requireOrderedKeyBytes(context, 2)
      units.push((context.encoded[context.offset++]! << 8) | context.encoded[context.offset++]!)
      if (units.length === 1024) {
        result += String.fromCharCode(...units)
        units.length = 0
      }
    }
    return result + String.fromCharCode(...units)
  }
  if (tag === OrderedKeyTag.bytes) {
    const bytes: number[] = []
    for (;;) {
      requireOrderedKeyBytes(context, 1)
      const marker = context.encoded[context.offset++]
      if (marker === 0) break
      if (marker !== 1 || bytes.length >= KEY_DOMAIN_LIMITS.maxBinaryBytes)
        invalidOrderedKey(context)
      requireOrderedKeyBytes(context, 1)
      bytes.push(context.encoded[context.offset++]!)
    }
    return new Uint8Array(bytes).buffer
  }
  if (tag === OrderedKeyTag.array) {
    const children: IStorageKey[] = []
    for (;;) {
      requireOrderedKeyBytes(context, 1)
      if (context.encoded[context.offset] === 0) {
        context.offset++
        break
      }
      children.push(readOrderedKey(context, depth + 1))
    }
    return children
  }
  return invalidOrderedKey(context)
}
/** Decode the unchanged wire format into new private data without cloning that output again. */
export function decodeOrderedStorageKey(
  encoded: Uint8Array,
  backend: IBackendKind | undefined
): IStorageKey {
  /** The reader borrows bytes synchronously; no callback or await can mutate them mid-read. */
  const context: IOrderedKeyReader = { encoded, backend, offset: 0, nodes: 0 }
  if (!isUint8Array(encoded)) invalidOrderedKey(context)
  /** Every mutable result component is newly constructed by the canonical decoder. */
  const key = readOrderedKey(context, 0)
  if (context.offset !== encoded.byteLength) invalidOrderedKey(context)
  assertStorageKey(key, backend)
  return key
}

/** Encode the original organization envelope without charging it to the logical key's budget. */
export function encodeStorageOrgKey(
  orgId: string,
  key: IStorageKey,
  backend: IBackendKind | undefined
): Uint8Array {
  return encodeKeySnapshot(prefixStorageOrgKey(orgId, key, backend), false)
}

/** The same writer supplies the original fixed marker and UUID header for native ranges. */
function storageOrgKeyHeader(orgId: string, backend: IBackendKind | undefined): Uint8Array {
  /** Known empty logical content identifies only the original envelope boundary. */
  const emptyEnvelope = encodeStorageOrgKey(orgId, '', backend)
  return emptyEnvelope.subarray(0, emptyEnvelope.byteLength - measureKey('') - 1)
}

/** A shortest strict successor bounds a canonical byte prefix without another ordering format. */
function strictByteSuccessor(encoded: Uint8Array): Uint8Array {
  /** Every caller supplies a nonempty canonical type-tagged prefix, so a successor exists. */
  let end = encoded.length
  while (end > 0 && encoded[end - 1] === 255) end--
  /** Discard saturated suffix bytes before incrementing the last representable component. */
  const upper = encoded.slice(0, end)
  upper[end - 1]++
  return upper
}

/** Project one organization's native half-open byte range using the original logical prefix owner. */
export function snapshotStorageOrgKeyPrefix(
  orgId: string,
  prefix: IStorageKey | undefined,
  backend: IBackendKind | undefined
): Pick<IStorageKeyPrefix, 'lower' | 'upper'> {
  /** The original fixed organization envelope is outside logical key limits. */
  const header = storageOrgKeyHeader(orgId, backend)
  if (prefix === undefined) return { lower: header.slice(), upper: strictByteSuccessor(header) }
  /** Typed bounds and their complete-child prefix semantics belong to the original key owner. */
  const logical = snapshotStorageKeyPrefix(prefix, backend)
  /** Copy each detached bound after the fixed header without inspecting logical tags. */
  const join = (bytes: Uint8Array): Uint8Array => {
    /** One allocation retains exactly this bound and its organization. */
    const result = new Uint8Array(header.byteLength + bytes.byteLength)
    result.set(header)
    result.set(bytes, header.byteLength)
    return result
  }
  return { lower: join(logical.lower), upper: join(logical.upper) }
}

/**
 * Check the original envelope's canonical bytes, then give only its logical component to the
 * original bounded reader. No second key format or parser is introduced.
 */
export function decodeStorageOrgKey(
  orgId: string,
  encoded: Uint8Array,
  backend: IBackendKind | undefined
): IStorageKey {
  /** The original writer supplies the exact marker and UUID header without duplicating its tags. */
  const header = storageOrgKeyHeader(orgId, backend)
  /** Invalid/foreign envelope boundaries keep the original organization error family. */
  const invalid = (): never => {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(StorageContractErrorText.orgKeyEnvelope)
    })
  }
  if (
    !isUint8Array(encoded) ||
    encoded.byteLength <= header.byteLength + 1 ||
    encoded[encoded.byteLength - 1] !== 0
  )
    invalid()
  for (let index = 0; index < header.byteLength; index++)
    if (encoded[index] !== header[index]) invalid()
  return decodeOrderedStorageKey(encoded.subarray(header.byteLength, -1), backend)
}

/** Converts already canonical bytes without another logical-key traversal or representation. */
export function storageKeyBytesIdentity(encoded: Uint8Array): string {
  return Array.from(encoded, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** One batch's equality facts belong to this short-lived projector, never a backend cache. */
class StorageBatchKeyProjector {
  /** Canonical validation errors retain the requesting backend's identity. */
  readonly #backend: IBackendKind | undefined
  /** Only equivalent keys in this admitted batch share a first position. */
  readonly #firstPositions = new Map<string, number>()
  /** Failed key validation never consumes a successful input position. */
  #position = 0
  /** Keep key admission and identity projection in their one existing owner. */
  constructor(backend: IBackendKind | undefined) {
    this.#backend = backend
  }
  /** Compute metadata from an admitted key using the original canonical writer. */
  #projectKey(key: IStorageKey): IStorageBatchKey {
    /** Typed equality uses the original ordered writer rather than object or string identity. */
    const identity = storageKeyBytesIdentity(encodeKeySnapshot(key, false))
    /** Native position remains stable when structurally equivalent keys repeat. */
    const firstIndex = this.#firstPositions.get(identity) ?? this.#position
    if (firstIndex === this.#position) this.#firstPositions.set(identity, this.#position)
    this.#position++
    return { key, identity, firstIndex }
  }
  /** Detach caller keys when native admission or middleware can await before use. */
  capture(input: IStorageKey): IStorageBatchKey {
    return this.#projectKey(snapshotStorageKey(input, this.#backend))
  }
  /** Borrow validated keys only for a synchronous native terminal with no intervening await. */
  project(input: IStorageKey): IStorageBatchKey {
    assertStorageKey(input, this.#backend)
    return this.#projectKey(input)
  }
}

/** Capture per-entry keys before deferred native work while preserving canonical equality. */
export function createStorageBatchKeyCapture(
  backend: IBackendKind | undefined
): IStorageBatchKeyCapture {
  /** The short-lived owner belongs only to this admitted batch. */
  const projector = new StorageBatchKeyProjector(backend)
  return (input) => projector.capture(input)
}

/** Recompute transformed batch metadata without copying keys in a synchronous native terminal. */
export function createStorageBatchKeyProjection(
  backend: IBackendKind | undefined
): IStorageBatchKeyCapture {
  /** Only the synchronous terminal owns these recomputed first-position facts. */
  const projector = new StorageBatchKeyProjector(backend)
  return (input) => projector.project(input)
}

/** Validate one batch and project its original order and optional duplicate rejection once. */
function prepareStorageBatchKeys(
  keys: readonly IStorageKey[],
  backend: IBackendKind | undefined,
  options: { readonly rejectDuplicates?: boolean } | undefined,
  project: IStorageBatchKeyCapture
): readonly IStorageBatchKey[] {
  if (
    !Array.isArray(keys) ||
    (options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options)))
  )
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend },
      StorageContractErrorText.batchKeys
    )
  /** Duplicate rejection remains optional for read and remove batches. */
  const rejectDuplicates = options?.rejectDuplicates
  if (rejectDuplicates !== undefined && typeof rejectDuplicates !== 'boolean')
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend },
      StorageContractErrorText.batchKeys
    )
  /** Metadata retains native request order, including repeated positions. */
  const result: IStorageBatchKey[] = []
  for (let index = 0; index < keys.length; index++) {
    /** Both projection modes reuse the same canonical equality and identity rule. */
    const fact = project(keys[index]!)
    if (fact.firstIndex !== index && rejectDuplicates)
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.batchDuplicate
      )
    result.push(fact)
  }
  return result
}

/** Detach caller keys before middleware, logical locks or physical native admission can await. */
export function snapshotStorageBatchKeys(
  keys: readonly IStorageKey[],
  backend: IBackendKind | undefined,
  options?: { readonly rejectDuplicates?: boolean }
): readonly IStorageBatchKey[] {
  return prepareStorageBatchKeys(keys, backend, options, createStorageBatchKeyCapture(backend))
}

/** Borrow keys only while a synchronous terminal recomputes metadata after middleware rewrites. */
export function projectStorageBatchKeys(
  keys: readonly IStorageKey[],
  backend: IBackendKind | undefined,
  options?: { readonly rejectDuplicates?: boolean }
): readonly IStorageBatchKey[] {
  return prepareStorageBatchKeys(keys, backend, options, createStorageBatchKeyProjection(backend))
}

/**
 * Snapshots one typed prefix. Strings/buffers match content prefixes, arrays match complete leading
 * child keys, and numbers/Dates match exact normalized identities. The existing domain still
 * rejects empty arrays. Exposed bytes/key are independent of the private matcher; no index or store
 * permission is created, and only this input's bytes determine the exclusive upper bound.
 */
/** Public prefix facts and private matcher bytes share one explicit owner. */
class StorageKeyPrefix implements IStorageKeyPrefix {
  /** Backend labels invalid candidates without adding a separate key validator. */
  readonly #backend: IBackendKind | undefined
  /** Private matching bytes must survive consumer mutation of the public key and bounds. */
  readonly #encoded: Uint8Array
  /** This public logical key is detached from the caller and from the private byte matcher. */
  readonly key: IStorageKey
  /** The public lower view cannot mutate private matching bytes. */
  readonly lower: Uint8Array
  /** A fresh successor is the original half-open upper bound. */
  readonly upper: Uint8Array
  /** Capture the prefix once before native callers retain and expose it across queued work. */
  constructor(prefix: unknown, backend: IBackendKind | undefined) {
    this.#backend = backend
    this.key = snapshotStorageKey(prefix, backend)
    this.#encoded = encodeKeySnapshot(this.key, true)
    this.lower = this.#encoded.slice()
    this.upper = strictByteSuccessor(this.#encoded)
  }
  /** Compare complete candidate bytes without exposing the original matcher allocation. */
  readonly matches = (candidate: IStorageKey): boolean => {
    /** Synchronous canonical encoding needs only pure admission, not a candidate key copy. */
    const bytes = encodeOrderedStorageKey(candidate, this.#backend)
    if (bytes.length < this.#encoded.length) return false
    for (let index = 0; index < this.#encoded.length; index++)
      if (bytes[index] !== this.#encoded[index]) return false
    return true
  }
}
/** Detach a typed prefix and preserve its matcher across later public/native consumption. */
export function snapshotStorageKeyPrefix(
  prefix: unknown,
  backend: IBackendKind | undefined
): IStorageKeyPrefix {
  return new StorageKeyPrefix(prefix, backend)
}

/** Explicit stack frames visit only still-shared suffixes rather than maximum-length padding. */
type IStorageByteRadixFrame = {
  readonly start: number
  readonly end: number
  readonly depth: number
}

/** Byte values occupy 1..256; bucket zero is reserved for a genuinely ended encoding. */
const STORAGE_BYTE_RADIX_BUCKETS = 257

/** Stable MSD buckets process each present suffix byte a constant number of times. */
export function sortStorageByteIdentities<T extends { readonly encoded: Uint8Array }>(
  entries: T[]
): void {
  if (entries.length < 2) return
  /** One shared scratch array serves every disjoint frame, without copying prefixes. */
  const scratch: T[] = []
  scratch.length = entries.length
  /** Fixed alphabet state is reused for every frame instead of retained per depth. */
  const counts = new Uint32Array(STORAGE_BYTE_RADIX_BUCKETS)
  /** Write positions are independently advanced while stable scattering fills the scratch region. */
  const positions = new Uint32Array(STORAGE_BYTE_RADIX_BUCKETS)
  /** LIFO suffix work avoids call-stack growth for long equal prefixes. */
  const frames: IStorageByteRadixFrame[] = [{ start: 0, end: entries.length, depth: 0 }]
  while (frames.length > 0) {
    /** Frames are disjoint at this depth and never include an already ended key. */
    const { start, end, depth } = frames.pop()!
    counts.fill(0)
    for (let index = start; index < end; index += 1) {
      /** Actual zero bytes stay ordinary content; only absence enters the terminator bucket. */
      const encoded = entries[index]!.encoded
      counts[depth < encoded.length ? encoded[depth]! + 1 : 0] += 1
    }
    /** Bucket boundaries use absolute array positions, independent of key length. */
    let boundary = start
    for (let bucket = 0; bucket < STORAGE_BYTE_RADIX_BUCKETS; bucket += 1) {
      positions[bucket] = boundary
      boundary += counts[bucket]!
    }
    for (let index = start; index < end; index += 1) {
      /** Stable movement retains the first snapshot when duplicate identities later collapse. */
      const entry = entries[index]!
      /** End-of-key has its own bucket and cannot be confused with embedded binary zero. */
      const bucket = depth < entry.encoded.length ? entry.encoded[depth]! + 1 : 0
      scratch[positions[bucket]!] = entry
      positions[bucket] += 1
    }
    for (let index = start; index < end; index += 1) entries[index] = scratch[index]!
    boundary = start + counts[0]!
    for (let bucket = 1; bucket < STORAGE_BYTE_RADIX_BUCKETS; bucket += 1) {
      /** Singleton and terminated ranges need no further byte inspection. */
      const size = counts[bucket]!
      if (size > 1) frames.push({ start: boundary, end: boundary + size, depth: depth + 1 })
      boundary += size
    }
  }
}

/**
 * Stable byte order shares the original lock radix. Each selector is invoked once and its bytes are
 * detached immediately, so later callback mutation cannot alter an earlier row's identity.
 */
export function orderStorageKeysByBytes<T>(
  entries: readonly T[],
  key: (entry: T) => Uint8Array
): readonly T[] {
  try {
    if (!Array.isArray(entries) || typeof key !== 'function')
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        {},
        StorageContractErrorText.keyByteOrder
      )
    /** Only this operation's detached ordering facts exist; no persistent index is created. */
    const captured: { readonly encoded: Uint8Array; readonly entry: T }[] = []
    /** Input length cannot grow while a borrowed selector executes. */
    const length = entries.length
    if (!Number.isSafeInteger(length) || length < 0)
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        {},
        StorageContractErrorText.keyByteOrder
      )
    for (let index = 0; index < length; index++) {
      /** Each original row and selector result is captured once in input order. */
      const entry = entries[index]!
      /** The existing byte-domain guard admits actual cross-realm Uint8Array values. */
      const bytes = key(entry)
      if (!isUint8Array(bytes))
        throw new StorageContractError(
          StorageContractErrorCode.invalidArgument,
          {},
          StorageContractErrorText.keyByteOrder
        )
      captured.push({ encoded: new Uint8Array(bytes), entry })
    }
    sortStorageByteIdentities(captured)
    return captured.map((row) => row.entry)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { cause },
      StorageContractErrorText.keyByteOrder
    )
  }
}

/**
 * Encodes one logical string prefix inside the original three-part organization envelope. Only the
 * final string and enclosing tuple terminators are omitted; all tags and preceding components come
 * from the original writer, including UTF-16 and empty-string semantics.
 */
export function encodeStorageOrgStringPrefix(
  orgId: string,
  prefix: string,
  backend: IBackendKind
): Uint8Array {
  assertStringStorageKey(prefix, backend)
  /** This exact envelope is shared with Redis/blob physical key composition. */
  const key = prefixStorageOrgKey(orgId, prefix)
  return encodeKeySnapshot(key, false).slice(0, -2)
}

/** The physical envelope marker is shared by wrapping and strict organization-aware unwrapping. */
const storageOrgKeyMarker = '$o'

/**
 * Wraps a detached logical key in one organization segment. Tuple keys remain nested in the third
 * slot so scalar and tuple identities stay distinct. The internal envelope does not consume the
 * logical key's depth or node budget.
 */
export const prefixStorageOrgKey = (
  orgId: string,
  key: IStorageKey,
  backend?: IBackendKind
): IStorageKey => {
  assertStorageOrgId(orgId)
  return [storageOrgKeyMarker, orgId, snapshotStorageKey(key, backend)]
}

/**
 * Checks the exact three-part envelope and organization before returning a detached logical key. A
 * malformed or foreign envelope throws INVALID_ARGUMENT; an invalid contained logical key retains
 * INVALID_KEY. Getter failures stay reachable as the original cause.
 */
export const unprefixStorageOrgKey = (orgId: string, key: IStorageKey): IStorageKey => {
  assertStorageOrgId(orgId)
  /** Captured envelope components prevent a changing getter from changing organization admission. */
  let marker: unknown
  /** Captured identity must match the requested organization exactly. */
  let capturedOrgId: unknown
  /** Only the contained logical key is subject to the public logical key-domain budget. */
  let logicalKey: unknown
  try {
    if (!Array.isArray(key) || key.length !== 3)
      throw new TypeError(StorageContractErrorText.orgKeyEnvelope)
    marker = key[0]
    capturedOrgId = key[1]
    logicalKey = key[2]
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (marker !== storageOrgKeyMarker || capturedOrgId !== orgId)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.orgKeyEnvelope)
    })
  return snapshotStorageKey(logicalKey, undefined)
}
