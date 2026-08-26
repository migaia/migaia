import { createHash, verify } from 'node:crypto'
import { types as nodeTypes } from 'node:util'

const approvalSchema = 'WRC-C-B11-approval-v2'

/** Stable native error text for values outside the signed provenance domain. */
const provenanceEncodingErrorText = 'Unsupported provenance value'

const regexpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')
const regexpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')
const typedArrayConstructors = new Map(
  [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    ...(typeof BigInt64Array === 'function' ? [BigInt64Array] : []),
    ...(typeof BigUint64Array === 'function' ? [BigUint64Array] : [])
  ].map((constructor) => [constructor.prototype, constructor.name])
)

/** Rejects unsupported or unsafe values without reading a user property. */
function rejectProvenanceValue() {
  throw new TypeError(provenanceEncodingErrorText)
}

/** Produces deterministic JSON for an approval subject and its digest input. */
export function canonicalJson(value) {
  return JSON.stringify(encodeCanonical(value, new WeakMap(), { nextId: 0 }))
}

/** Encodes admitted values with global node identities and locale-independent ordering. */
function encodeCanonical(value, references, state) {
  if (value === null) return ['null']
  switch (typeof value) {
    case 'undefined':
      return ['undefined']
    case 'boolean':
      return ['boolean', value]
    case 'string':
      return ['string', value]
    case 'number':
      if (Number.isNaN(value)) return ['number', 'NaN']
      if (value === Infinity) return ['number', '+Infinity']
      if (value === -Infinity) return ['number', '-Infinity']
      if (Object.is(value, -0)) return ['number', '-0']
      return ['number', String(value)]
    case 'bigint':
      return ['bigint', value.toString(10)]
    case 'function':
    case 'symbol':
      rejectProvenanceValue()
    case 'object':
      break
    default:
      rejectProvenanceValue()
  }

  const previousId = references.get(value)
  if (previousId !== undefined) return ['reference', previousId]
  if (nodeTypes.isProxy(value)) rejectProvenanceValue()
  const id = `n${state.nextId}`
  state.nextId += 1
  references.set(value, id)
  assertDataDescriptors(value)

  if (value instanceof Date) {
    if (Object.getPrototypeOf(value) !== Date.prototype) rejectProvenanceValue()
    const time = value.getTime()
    if (!Number.isFinite(time)) rejectProvenanceValue()
    return ['date', id, String(time), encodeProperties(value, references, state)]
  }
  if (value instanceof RegExp) {
    if (Object.getPrototypeOf(value) !== RegExp.prototype) rejectProvenanceValue()
    if (!regexpSource || !regexpFlags) rejectProvenanceValue()
    return [
      'regexp',
      id,
      value.source,
      value.flags,
      value.lastIndex,
      encodeProperties(value, references, state)
    ]
  }
  if (value instanceof Map) {
    if (Object.getPrototypeOf(value) !== Map.prototype) rejectProvenanceValue()
    const entries = []
    for (const [key, entry] of value.entries()) {
      entries.push([
        encodeCanonical(key, references, state),
        encodeCanonical(entry, references, state)
      ])
    }
    return ['map', id, entries, encodeProperties(value, references, state)]
  }
  if (value instanceof Set) {
    if (Object.getPrototypeOf(value) !== Set.prototype) rejectProvenanceValue()
    const entries = []
    for (const entry of value.values()) entries.push(encodeCanonical(entry, references, state))
    return ['set', id, entries, encodeProperties(value, references, state)]
  }
  if (value instanceof ArrayBuffer) {
    if (Object.getPrototypeOf(value) !== ArrayBuffer.prototype) rejectProvenanceValue()
    return [
      'array-buffer',
      id,
      [...new Uint8Array(value)],
      encodeProperties(value, references, state)
    ]
  }
  if (ArrayBuffer.isView(value)) {
    const viewName = typedArrayConstructors.get(Object.getPrototypeOf(value))
    if (!viewName || Object.getPrototypeOf(value) === DataView.prototype) {
      if (Object.getPrototypeOf(value) !== DataView.prototype) rejectProvenanceValue()
      return [
        'data-view',
        id,
        encodeCanonical(value.buffer, references, state),
        value.byteOffset,
        value.byteLength,
        [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)],
        encodeProperties(value, references, state)
      ]
    }
    return [
      'typed-view',
      id,
      viewName,
      encodeCanonical(value.buffer, references, state),
      value.byteOffset,
      value.length,
      value.byteLength,
      [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)],
      encodeProperties(value, references, state)
    ]
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype && Object.getPrototypeOf(value) !== null) {
      rejectProvenanceValue()
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || typeof lengthDescriptor.value !== 'number') rejectProvenanceValue()
    const entries = []
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      entries.push(
        descriptor && 'value' in descriptor
          ? encodeCanonical(descriptor.value, references, state)
          : ['hole']
      )
    }
    return ['array', id, entries, encodeProperties(value, references, state, new Set(['length']))]
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    rejectProvenanceValue()
  }
  return ['object', id, encodeProperties(value, references, state)]
}

/** Encodes own data descriptors only, preventing accessor execution and symbol ambiguity. */
function encodeProperties(value, references, state, excludedKeys = new Set()) {
  let descriptors
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    rejectProvenanceValue()
  }
  const ownKeys = Reflect.ownKeys(descriptors)
  if (ownKeys.some((key) => typeof key !== 'string')) rejectProvenanceValue()
  const keys = ownKeys.filter((key) => !excludedKeys.has(key)).sort(compareCodeUnits)
  return keys.map((key) => {
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor)) rejectProvenanceValue()
    return [
      key,
      descriptor.enumerable,
      descriptor.writable,
      descriptor.configurable,
      encodeCanonical(descriptor.value, references, state)
    ]
  })
}

/** Verifies own descriptors before any built-in or collection accessor is read. */
function assertDataDescriptors(value) {
  let descriptors
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    rejectProvenanceValue()
  }
  const ownKeys = Reflect.ownKeys(descriptors)
  if (ownKeys.some((key) => typeof key !== 'string')) rejectProvenanceValue()
  for (const key of ownKeys) {
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor)) rejectProvenanceValue()
  }
}

/** Compares UTF-16 code units without locale or platform-dependent collation. */
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Hashes the complete canonical provenance subject. */
export function digestProvenanceSubject(subject) {
  return createHash('sha256').update(canonicalJson(subject)).digest('hex')
}

/** Returns a frozen-size tuple used to bind an approval to the measured artifact. */
export function sizeTuple(emitted) {
  return {
    moduleCount: emitted.moduleCount,
    rawBytes: emitted.rawBytes,
    gzipBytes: emitted.gzipBytes
  }
}

/** Validates pending or externally signed baseline state without approving it. */
export function validateAuthorization(authorization, subject, options = {}) {
  if (!authorization || typeof authorization !== 'object') return 'authorization must be object'
  if (authorization.status === 'pending') {
    return authorization.approvalRecord === null ? null : 'pending approvalRecord must be null'
  }
  if (authorization.status !== 'approved') return 'status must be pending or approved'
  const record = authorization.approvalRecord
  if (!record || typeof record !== 'object') return 'approved record required'
  const requiredStrings = [
    'schema',
    'authorityId',
    'keyId',
    'decisionId',
    'issuedAt',
    'rationale',
    'digest',
    'signature'
  ]
  if (requiredStrings.some((key) => typeof record[key] !== 'string' || record[key].length === 0)) {
    return 'complete approval record required'
  }
  const authority = options.authority
  if (!authority || typeof authority !== 'object') return 'approval authority unavailable'
  if (
    authority.schema !== approvalSchema ||
    authority.algorithm !== 'ed25519' ||
    typeof authority.authorityId !== 'string' ||
    typeof authority.keyId !== 'string' ||
    typeof authority.publicKeyPem !== 'string' ||
    typeof authority.decisionId !== 'string' ||
    typeof authority.payloadDigest !== 'string'
  ) {
    return 'durable authority descriptor required'
  }
  if (record.schema !== approvalSchema) return 'approval schema mismatch'
  if (record.authorityId !== authority.authorityId) return 'authority mismatch'
  if (record.keyId !== authority.keyId) return 'authority key mismatch'
  if (record.decisionId !== authority.decisionId) return 'stale or replayed decision'
  if (!/^WRC-C-B11-[A-Za-z0-9-]+$/.test(record.decisionId)) return 'durable decision id required'
  if (Number.isNaN(Date.parse(record.issuedAt))) return 'valid decision timestamp required'
  if (record.issuedAt.trim() !== record.issuedAt) return 'decision timestamp whitespace forbidden'
  if (!record.rationale.trim() || record.rationale !== record.rationale.trim()) {
    return 'approval rationale required'
  }
  if (record.digest !== subject.digest) return 'approval digest mismatch'
  if (canonicalJson(record.newTuple) !== canonicalJson(options.newTuple)) {
    return 'approval new tuple mismatch'
  }
  if (canonicalJson(record.oldTuple) !== canonicalJson(options.oldTuple)) {
    return 'approval old tuple mismatch'
  }
  const payload = {
    schema: approvalSchema,
    authorityId: record.authorityId,
    keyId: record.keyId,
    decisionId: record.decisionId,
    issuedAt: record.issuedAt,
    rationale: record.rationale,
    oldTuple: record.oldTuple,
    newTuple: record.newTuple,
    digest: record.digest
  }
  if (canonicalJson(record.payload) !== canonicalJson(payload)) return 'decision payload mismatch'
  if (record.digest !== authority.payloadDigest) return 'authority payload digest mismatch'
  try {
    if (
      !verify(
        null,
        Buffer.from(canonicalJson(payload)),
        authority.publicKeyPem,
        Buffer.from(record.signature, 'base64')
      )
    ) {
      return 'approval signature invalid'
    }
  } catch {
    return 'approval signature invalid'
  }
  return null
}
