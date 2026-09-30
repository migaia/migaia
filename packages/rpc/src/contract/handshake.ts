import { decodeUtf8, isUint8Array, utf8ByteLength } from '@migaia/utils/bytes'
import { createContractError } from './contract-error.js'
import { deserializeRpcError, normalizeRpcSerializedError } from './error.js'
import { RpcContractErrorCode } from './error-code.js'
import { RPC_CONTRACT_SOURCE } from './error-text.js'
import {
  RpcHandshakeInputForm,
  RpcHandshakeRedactionPath,
  RpcHandshakeRedactionText,
  RpcHandshakeValueType,
  type RpcHandshakeInputForm as IRpcHandshakeInputForm,
  type RpcHandshakeRedactionPath as IRpcHandshakeRedactionPath,
  type RpcHandshakeValueType as IRpcHandshakeValueType
} from './handshake-text.js'
import { normalizePortable } from './normalize.js'
import type { IRpcEnvelopeOptions, IRpcPortableValue, IRpcSerializedError } from './types.js'
import {
  RpcCodecId,
  RpcHandshakeReason,
  RpcHandshakeStep,
  RpcHandshakeViolation,
  RpcProtocol,
  RpcReservedKind,
  RpcWireLimit,
  type RpcHandshakeReason as IRpcHandshakeReason
} from './wire-constants.js'
import { compareRpcFieldNames } from './v1/route.js'
import { RpcWireErrorViolation } from './wire-error-constants.js'

/** One supported protocol version and its highest minor version. */
export type IRpcHandshakeVersion = Readonly<{ major: number; minor: number }>

/** A peer identity used only for diagnostics and connection-owned policy. */
export type IRpcPeerInfo = Readonly<{
  id: string
  runtime: string
  runtimeVersion?: string
  implementation?: Readonly<{ name: string; version: string }>
}>

/** A local handshake proposal sent by an initiator or used by a responder. */
export type IRpcHandshakeOffer = Readonly<{
  versions: readonly IRpcHandshakeVersion[]
  codecs: readonly string[]
  capabilities: readonly string[]
  peer: IRpcPeerInfo
  auth?: IRpcPortableValue
}>

/** Negotiated values and the remote peer retained after a completed handshake. */
export type IRpcHandshakeAgreement = Readonly<{
  major: number
  minor: number
  codec: string
  capabilities: readonly string[]
  peer: IRpcPeerInfo
  auth?: IRpcPortableValue
}>

/** First-channel messages are UTF-8 JSON text, never ordinary envelopes. */
export type IRpcHandshakeText = string | Uint8Array

/** The three accepted handshake forms, after a fresh validated snapshot. */
export type IRpcHandshakeMessage =
  | Readonly<{ kind: 'handshake'; step: 'hello'; protocol: string } & IRpcHandshakeOffer>
  | Readonly<{
      kind: 'handshake'
      step: 'accept'
      protocol: string
      major: number
      minor: number
      codec: string
      capabilities: readonly string[]
      peer: IRpcPeerInfo
    }>
  | Readonly<{
      kind: 'handshake'
      step: 'reject'
      protocol: string
      error: IRpcSerializedError
    }>

/** Printable lowercase codec and capability identifiers are language neutral. */
const CODEC_PATTERN = /^[a-z][a-z0-9.-]{0,31}$/u
const CAPABILITY_PATTERN = /^[a-z][a-z0-9.-]*@[1-9][0-9]*$/u
const RUNTIME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u

/** Portable, bounded evidence about a handshake failure, without the input or token. */
type IRpcHandshakeRedaction = Readonly<{
  redacted: true
  form: IRpcHandshakeInputForm
  bytes?: number
  parsed: boolean
  fields?: readonly string[]
  unknownFieldCount?: number
  kind?: string
  step?: string
  protocol?: string
  codec?: string
  major?: number | string
  minor?: number | string
  auth?: string
  syntaxError?: string
  path?: IRpcHandshakeRedactionPath
  valueType?: IRpcHandshakeValueType
  length?: number
  wireCode?: string
  wireViolation?: string
}>

/** Bounds the diagnostic summary and the JSON engine excerpt check. */
const REDACTION_LIMIT = { maxFields: 16, maxChars: 64, excerptRun: 4 } as const

/** One source for hello validation and the redactor's allowed top-level keys. */
const HELLO_FIELDS = [
  'kind',
  'step',
  'protocol',
  'versions',
  'codecs',
  'capabilities',
  'peer',
  'auth'
] as const
/** One source for accept validation and the redactor's allowed top-level keys. */
const ACCEPT_FIELDS = [
  'kind',
  'step',
  'protocol',
  'major',
  'minor',
  'codec',
  'capabilities',
  'peer'
] as const
/** One source for reject validation and the redactor's allowed top-level keys. */
const REJECT_FIELDS = ['kind', 'step', 'protocol', 'error'] as const
/** Schema-known top-level names shared by every handshake form. */
const HANDSHAKE_FIELDS = new Set<string>([...HELLO_FIELDS, ...ACCEPT_FIELDS, ...REJECT_FIELDS])
/** Allowed peer keys for validation and diagnostic field projection. */
const PEER_FIELDS = ['id', 'runtime', 'runtimeVersion', 'implementation'] as const
/** Allowed implementation keys for validation and diagnostic field projection. */
const IMPLEMENTATION_FIELDS = ['name', 'version'] as const
/** Allowed version entry keys for diagnostic field projection. */
const VERSION_FIELDS = ['major', 'minor'] as const

/** Summarize a received handshake using only allowed scalar fields and bounded field names. */
function redactHandshake(
  input: unknown,
  record?: Readonly<Record<string, unknown>>,
  withheldSyntax?: true,
  parsedOnly?: true,
  localCodecs?: readonly string[]
): IRpcHandshakeRedaction {
  const form =
    typeof input === 'string'
      ? RpcHandshakeInputForm.text
      : isUint8Array(input)
        ? RpcHandshakeInputForm.bytes
        : RpcHandshakeInputForm.other
  const marker = RpcHandshakeRedactionText.marker
  const summary: {
    redacted: true
    form: IRpcHandshakeInputForm
    bytes?: number
    parsed: boolean
    fields?: readonly string[]
    unknownFieldCount?: number
    kind?: string
    step?: string
    protocol?: string
    codec?: string
    major?: number | string
    minor?: number | string
    auth?: string
    syntaxError?: string
  } = { redacted: true, form, parsed: record !== undefined || parsedOnly === true }
  if (typeof input === 'string') summary.bytes = utf8ByteLength(input)
  else if (form === RpcHandshakeInputForm.bytes) summary.bytes = (input as Uint8Array).byteLength
  if (record !== undefined) {
    const names = Object.keys(record)
    summary.fields = Object.freeze(
      names
        .filter((field) => HANDSHAKE_FIELDS.has(field))
        .sort(compareRpcFieldNames)
        .slice(0, REDACTION_LIMIT.maxFields)
    )
    const unknownFieldCount = names.length - summary.fields.length
    if (unknownFieldCount > 0) summary.unknownFieldCount = unknownFieldCount
    if (Object.hasOwn(record, 'kind'))
      summary.kind = record.kind === RpcReservedKind.handshake ? RpcReservedKind.handshake : marker
    if (Object.hasOwn(record, 'step'))
      summary.step = Object.values(RpcHandshakeStep).includes(record.step as never)
        ? (record.step as string)
        : marker
    if (Object.hasOwn(record, 'protocol'))
      summary.protocol = record.protocol === RpcProtocol.id ? RpcProtocol.id : marker
    if (Object.hasOwn(record, 'codec'))
      summary.codec =
        typeof record.codec === 'string' &&
        CODEC_PATTERN.test(record.codec) &&
        (localCodecs ?? [RpcCodecId.json]).includes(record.codec)
          ? record.codec
          : marker
    for (const field of ['major', 'minor'] as const)
      if (Object.hasOwn(record, field))
        summary[field] = Number.isSafeInteger(record[field]) ? (record[field] as number) : marker
    if (Object.hasOwn(record, 'auth')) summary.auth = marker
  }
  if (withheldSyntax) summary.syntaxError = marker
  return Object.freeze(summary)
}

/** Summarize a parsed child value using its schema location, never its values. */
function redactChild(value: unknown, path: IRpcHandshakeRedactionPath): IRpcHandshakeRedaction {
  const valueType =
    value === null
      ? RpcHandshakeValueType.null
      : Array.isArray(value)
        ? RpcHandshakeValueType.array
        : typeof value === 'object'
          ? RpcHandshakeValueType.object
          : typeof value === 'string'
            ? RpcHandshakeValueType.string
            : typeof value === 'number'
              ? RpcHandshakeValueType.number
              : RpcHandshakeValueType.boolean
  const summary: {
    redacted: true
    form: IRpcHandshakeInputForm
    parsed: true
    path: IRpcHandshakeRedactionPath
    valueType: IRpcHandshakeValueType
    fields?: readonly string[]
    unknownFieldCount?: number
    length?: number
  } = { redacted: true, form: RpcHandshakeInputForm.other, parsed: true, path, valueType }
  if (Array.isArray(value)) summary.length = value.length
  else if (valueType === RpcHandshakeValueType.object) {
    const allowed =
      path === RpcHandshakeRedactionPath.peer
        ? PEER_FIELDS
        : path === RpcHandshakeRedactionPath.implementation
          ? IMPLEMENTATION_FIELDS
          : path === RpcHandshakeRedactionPath.versions
            ? VERSION_FIELDS
            : []
    const known = new Set<string>(allowed)
    const names = Object.keys(value as Record<string, unknown>)
    summary.fields = Object.freeze(
      names.filter((field) => known.has(field)).sort(compareRpcFieldNames)
    )
    const unknown = names.length - summary.fields.length
    if (unknown > 0) summary.unknownFieldCount = unknown
  }
  return Object.freeze(summary)
}

/** Keep a wire validation error only when its whole cause chain contains no input subtree. */
export function redactWireFailure(cause: unknown): unknown {
  let node = cause
  for (let depth = 0; depth < 16; depth++) {
    if (!(node instanceof Error) || Object.hasOwn(node, 'errors')) break
    node = (node as Error & { cause?: unknown }).cause
    if (node === undefined) return cause
  }
  const code = cause instanceof Error ? (cause as Error & { code?: unknown }).code : undefined
  const violation =
    cause instanceof Error ? (cause as Error & { violation?: unknown }).violation : undefined
  return Object.freeze({
    redacted: true,
    form: RpcHandshakeInputForm.other,
    parsed: true,
    path: RpcHandshakeRedactionPath.error,
    wireCode:
      code === RpcContractErrorCode.invalidWireError ? code : RpcHandshakeRedactionText.marker,
    wireViolation: Object.values(RpcWireErrorViolation).includes(violation as never)
      ? violation
      : RpcHandshakeRedactionText.marker
  })
}

/** Describe an untrusted local offer without reading any property a second time. */
function redactOffer(): IRpcHandshakeRedaction {
  return Object.freeze({ redacted: true, form: RpcHandshakeInputForm.offer, parsed: false })
}

/** Retain a JSON engine error only when its message cannot quote four input code units. */
function isExcerptFree(message: string, json: string): boolean {
  const width = REDACTION_LIMIT.excerptRun
  if (message.length < width) return true
  const windows = new Set<string>()
  for (let offset = 0; offset <= message.length - width; offset++)
    windows.add(message.slice(offset, offset + width))
  for (let offset = 0; offset <= json.length - width; offset++)
    if (windows.has(json.slice(offset, offset + width))) return false
  return true
}

/** Create the original categorized native error with only safe evidence on its cause chain. */
function handshakeInvalid(violation: string, cause?: unknown): TypeError {
  const error = createContractError(RpcContractErrorCode.handshakeInvalid, cause) as TypeError
  Object.defineProperty(error, 'violation', { value: violation, enumerable: true })
  return error
}

/** Snapshot an ordinary object once; materialize a redacted input cause only on failure. */
function snapshot(value: unknown, causeOf: () => unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw handshakeInvalid(RpcHandshakeViolation.type, causeOf())
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw handshakeInvalid(RpcHandshakeViolation.type, causeOf())
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value)) result[key] = (value as Record<string, unknown>)[key]
    return result
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error as { readonly code?: unknown }).code === RpcContractErrorCode.handshakeInvalid
    )
      throw error
    throw handshakeInvalid(RpcHandshakeViolation.read, error)
  }
}

/** Warn in a stable order about additive fields, leaving unknown values unread beyond snapshot. */
function unknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  pointer: string,
  options?: IRpcEnvelopeOptions
): void {
  const known = new Set(allowed)
  for (const field of Object.keys(record)
    .filter((key) => !known.has(key))
    .sort(compareRpcFieldNames))
    options?.onUnknownField?.(pointer, field)
}

/** Validate one peer descriptor without interpreting its runtime label. */
function peerInfo(value: unknown, options?: IRpcEnvelopeOptions): IRpcPeerInfo {
  const record = snapshot(value, () => redactChild(value, RpcHandshakeRedactionPath.peer))
  if (
    typeof record.id !== 'string' ||
    record.id.length < 1 ||
    record.id.length > RpcWireLimit.maxIdentifierChars ||
    typeof record.runtime !== 'string' ||
    !RUNTIME_PATTERN.test(record.runtime)
  )
    throw handshakeInvalid(
      RpcHandshakeViolation.required,
      redactChild(value, RpcHandshakeRedactionPath.peer)
    )
  const peer: {
    id: string
    runtime: string
    runtimeVersion?: string
    implementation?: Readonly<{ name: string; version: string }>
  } = { id: record.id, runtime: record.runtime }
  if (Object.hasOwn(record, 'runtimeVersion')) {
    if (typeof record.runtimeVersion !== 'string' || record.runtimeVersion.length > 64)
      throw handshakeInvalid(
        RpcHandshakeViolation.type,
        redactChild(value, RpcHandshakeRedactionPath.peer)
      )
    peer.runtimeVersion = record.runtimeVersion
  }
  if (Object.hasOwn(record, 'implementation')) {
    const implementation = snapshot(record.implementation, () =>
      redactChild(record.implementation, RpcHandshakeRedactionPath.implementation)
    )
    if (typeof implementation.name !== 'string' || typeof implementation.version !== 'string')
      throw handshakeInvalid(
        RpcHandshakeViolation.required,
        redactChild(record.implementation, RpcHandshakeRedactionPath.implementation)
      )
    peer.implementation = Object.freeze({
      name: implementation.name,
      version: implementation.version
    })
    unknownFields(implementation, IMPLEMENTATION_FIELDS, '/peer/implementation', options)
  }
  unknownFields(record, PEER_FIELDS, '/peer', options)
  return Object.freeze(peer)
}

/** Validate version sets and reject repeated majors before attempting negotiation. */
function versions(value: unknown): readonly IRpcHandshakeVersion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > RpcWireLimit.maxVersions)
    throw handshakeInvalid(
      RpcHandshakeViolation.type,
      redactChild(value, RpcHandshakeRedactionPath.versions)
    )
  const seen = new Set<number>()
  const result = value.map((entry: unknown) => {
    const record = snapshot(entry, () => redactChild(entry, RpcHandshakeRedactionPath.versions))
    if (
      !Number.isSafeInteger(record.major) ||
      (record.major as number) <= 0 ||
      !Number.isSafeInteger(record.minor) ||
      (record.minor as number) < 0
    )
      throw handshakeInvalid(
        RpcHandshakeViolation.type,
        redactChild(entry, RpcHandshakeRedactionPath.versions)
      )
    if (seen.has(record.major as number))
      throw handshakeInvalid(
        RpcHandshakeViolation.duplicate,
        redactChild(value, RpcHandshakeRedactionPath.versions)
      )
    seen.add(record.major as number)
    return Object.freeze({ major: record.major as number, minor: record.minor as number })
  })
  return Object.freeze(result)
}

/** Keep offered codec and capability preference order while bounding each list. */
function labels(
  value: unknown,
  max: number,
  pattern: RegExp,
  requireJson: boolean,
  path: IRpcHandshakeRedactionPath
): readonly string[] {
  if (!Array.isArray(value) || value.length > max || (requireJson && value.length < 1))
    throw handshakeInvalid(RpcHandshakeViolation.type, redactChild(value, path))
  if (!value.every((label: unknown) => typeof label === 'string' && pattern.test(label)))
    throw handshakeInvalid(RpcHandshakeViolation.type, redactChild(value, path))
  const result = value as string[]
  if (new Set(result).size !== result.length)
    throw handshakeInvalid(RpcHandshakeViolation.duplicate, redactChild(value, path))
  if (requireJson && !result.includes(RpcCodecId.json))
    throw handshakeInvalid(RpcHandshakeViolation.baseline, redactChild(value, path))
  return Object.freeze([...result])
}

/** Parse a first message with exact UTF-8 decoding and the protocol byte bound. */
function parseText(text: IRpcHandshakeText): unknown {
  let json: string
  if (typeof text === 'string') {
    if (/([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u.test(text))
      throw handshakeInvalid(RpcHandshakeViolation.encoding, redactHandshake(text))
    json = text
    if (utf8ByteLength(json) > RpcWireLimit.maxHandshakeBytes)
      throw handshakeInvalid(RpcHandshakeViolation.bytes, redactHandshake(text))
  } else if (isUint8Array(text)) {
    if (text.byteLength > RpcWireLimit.maxHandshakeBytes)
      throw handshakeInvalid(RpcHandshakeViolation.bytes, redactHandshake(text))
    try {
      json = decodeUtf8(text, { fatal: true })
    } catch (cause) {
      throw handshakeInvalid(RpcHandshakeViolation.encoding, cause)
    }
  } else throw handshakeInvalid(RpcHandshakeViolation.type, redactHandshake(text))
  try {
    return JSON.parse(json) as unknown
  } catch (cause) {
    throw handshakeInvalid(
      RpcHandshakeViolation.type,
      cause instanceof Error && isExcerptFree(cause.message, json)
        ? cause
        : redactHandshake(text, undefined, true)
    )
  }
}

/** Validate a first-channel message; input failures retain only a bounded diagnostic summary. */
export function normalizeRpcHandshake(
  text: IRpcHandshakeText,
  options?: IRpcEnvelopeOptions
): IRpcHandshakeMessage {
  const record = snapshot(parseText(text), () => redactHandshake(text, undefined, undefined, true))
  if (record.kind !== RpcReservedKind.handshake || typeof record.protocol !== 'string')
    throw handshakeInvalid(RpcHandshakeViolation.required, redactHandshake(text, record))
  const step = record.step
  if (step === RpcHandshakeStep.hello) {
    let auth: IRpcPortableValue | undefined
    if (Object.hasOwn(record, 'auth')) {
      try {
        auth = normalizePortable(record.auth)
      } catch (cause) {
        throw handshakeInvalid(RpcHandshakeViolation.type, cause)
      }
    }
    const result: IRpcHandshakeMessage = {
      kind: RpcReservedKind.handshake,
      step,
      protocol: record.protocol,
      versions: versions(record.versions),
      codecs: labels(
        record.codecs,
        RpcWireLimit.maxCodecs,
        CODEC_PATTERN,
        true,
        RpcHandshakeRedactionPath.codecs
      ),
      capabilities: labels(
        record.capabilities,
        RpcWireLimit.maxCapabilities,
        CAPABILITY_PATTERN,
        false,
        RpcHandshakeRedactionPath.capabilities
      ),
      peer: peerInfo(record.peer, options),
      ...(Object.hasOwn(record, 'auth') ? { auth } : {})
    }
    unknownFields(record, HELLO_FIELDS, '', options)
    return Object.freeze(result)
  }
  if (step === RpcHandshakeStep.accept) {
    if (
      !Number.isSafeInteger(record.major) ||
      (record.major as number) <= 0 ||
      !Number.isSafeInteger(record.minor) ||
      (record.minor as number) < 0 ||
      typeof record.codec !== 'string' ||
      !CODEC_PATTERN.test(record.codec)
    )
      throw handshakeInvalid(RpcHandshakeViolation.type, redactHandshake(text, record))
    const result: IRpcHandshakeMessage = {
      kind: RpcReservedKind.handshake,
      step,
      protocol: record.protocol,
      major: record.major as number,
      minor: record.minor as number,
      codec: record.codec,
      capabilities: labels(
        record.capabilities,
        RpcWireLimit.maxCapabilities,
        CAPABILITY_PATTERN,
        false,
        RpcHandshakeRedactionPath.capabilities
      ),
      peer: peerInfo(record.peer, options)
    }
    unknownFields(record, ACCEPT_FIELDS, '', options)
    return Object.freeze(result)
  }
  if (step === RpcHandshakeStep.reject) {
    let error: IRpcSerializedError
    try {
      error = normalizeRpcSerializedError(record.error, {
        unknownFields: 'ignore',
        onUnknownField: (pointer, field) => options?.onUnknownField?.(`/error${pointer}`, field)
      })
    } catch (cause) {
      throw handshakeInvalid(RpcHandshakeViolation.type, redactWireFailure(cause))
    }
    unknownFields(record, REJECT_FIELDS, '', options)
    return Object.freeze({
      kind: RpcReservedKind.handshake,
      step,
      protocol: record.protocol,
      error
    })
  }
  throw handshakeInvalid(RpcHandshakeViolation.step, redactHandshake(text, record))
}

/** Encode a local offer without retaining its original value in an invalid-input error. */
export function createRpcHello(offer: IRpcHandshakeOffer): string {
  let text: string
  try {
    text = JSON.stringify({
      kind: RpcReservedKind.handshake,
      step: RpcHandshakeStep.hello,
      protocol: RpcProtocol.id,
      ...offer
    })
  } catch (cause) {
    throw handshakeInvalid(RpcHandshakeViolation.read, cause)
  }
  if (typeof text !== 'string') throw handshakeInvalid(RpcHandshakeViolation.type, redactOffer())
  normalizeRpcHandshake(text)
  return text
}

/** Build a protocol-owned incompatibility error and its portable rejection frame. */
function incompatible(reason: IRpcHandshakeReason): Readonly<{ error: Error; reply: string }> {
  const error = createContractError(RpcContractErrorCode.handshakeIncompatible)
  Object.defineProperty(error, 'reason', { value: reason, enumerable: true })
  const wire: IRpcSerializedError = {
    source: RPC_CONTRACT_SOURCE,
    code: RpcContractErrorCode.handshakeIncompatible,
    name: error.name,
    message: error.message,
    stack: error.stack ?? `${error.name}: ${error.message}`
  }
  return {
    error,
    reply: JSON.stringify({
      kind: RpcReservedKind.handshake,
      step: RpcHandshakeStep.reject,
      protocol: RpcProtocol.id,
      error: wire
    })
  }
}

/** A responder negotiates the common version and codec; failures omit the received hello. */
export function acceptRpcHandshake(
  local: IRpcHandshakeOffer,
  hello: IRpcHandshakeText,
  options?: IRpcEnvelopeOptions
):
  | Readonly<{ ok: true; reply: string; agreement: IRpcHandshakeAgreement }>
  | Readonly<{ ok: false; reply: string; error: Error }> {
  const localOffer = normalizeRpcHandshake(createRpcHello(local))
  const remote = normalizeRpcHandshake(hello, options)
  if (localOffer.step !== RpcHandshakeStep.hello || remote.step !== RpcHandshakeStep.hello)
    throw handshakeInvalid(
      RpcHandshakeViolation.step,
      redactHandshake(
        hello,
        remote as unknown as Record<string, unknown>,
        undefined,
        undefined,
        localOffer.step === RpcHandshakeStep.hello ? localOffer.codecs : undefined
      )
    )
  if (remote.protocol !== RpcProtocol.id)
    return { ok: false, ...incompatible(RpcHandshakeReason.protocol) }
  const shared = remote.versions
    .filter((version) => localOffer.versions.some((candidate) => candidate.major === version.major))
    .sort((a, b) => b.major - a.major)[0]
  if (!shared) return { ok: false, ...incompatible(RpcHandshakeReason.version) }
  const localVersion = localOffer.versions.find((version) => version.major === shared.major)!
  const codec = remote.codecs.find((candidate) => localOffer.codecs.includes(candidate))
  if (!codec) return { ok: false, ...incompatible(RpcHandshakeReason.protocol) }
  const capabilities = remote.capabilities.filter((capability) =>
    localOffer.capabilities.includes(capability)
  )
  const agreement: IRpcHandshakeAgreement = Object.freeze({
    major: shared.major,
    minor: Math.min(shared.minor, localVersion.minor),
    codec,
    capabilities: Object.freeze(capabilities),
    peer: remote.peer,
    ...(remote.auth === undefined ? {} : { auth: remote.auth })
  })
  const reply = JSON.stringify({
    kind: RpcReservedKind.handshake,
    step: RpcHandshakeStep.accept,
    protocol: RpcProtocol.id,
    major: agreement.major,
    minor: agreement.minor,
    codec,
    capabilities,
    peer: localOffer.peer
  })
  return { ok: true, reply, agreement }
}

/** Verify the responder's choices; failures omit the received reply and local offer. */
export function completeRpcHandshake(
  local: IRpcHandshakeOffer,
  reply: IRpcHandshakeText,
  options?: IRpcEnvelopeOptions
): IRpcHandshakeAgreement {
  const localOffer = normalizeRpcHandshake(createRpcHello(local))
  const remote = normalizeRpcHandshake(reply, options)
  if (localOffer.step !== RpcHandshakeStep.hello)
    throw handshakeInvalid(
      RpcHandshakeViolation.step,
      redactHandshake(reply, remote as unknown as Record<string, unknown>)
    )
  if (remote.step === RpcHandshakeStep.reject) {
    const cause = deserializeRpcError(remote.error, { unknownFields: 'ignore' })
    throw createContractError(RpcContractErrorCode.handshakeRejected, cause)
  }
  if (remote.step !== RpcHandshakeStep.accept)
    throw handshakeInvalid(
      RpcHandshakeViolation.step,
      redactHandshake(
        reply,
        remote as unknown as Record<string, unknown>,
        undefined,
        undefined,
        localOffer.codecs
      )
    )
  const offeredVersion = localOffer.versions.find((version) => version.major === remote.major)
  if (
    remote.protocol !== RpcProtocol.id ||
    !offeredVersion ||
    remote.minor > offeredVersion.minor ||
    !localOffer.codecs.includes(remote.codec) ||
    remote.capabilities.some((capability) => !localOffer.capabilities.includes(capability))
  )
    throw handshakeInvalid(
      RpcHandshakeViolation.mismatch,
      redactHandshake(
        reply,
        remote as unknown as Record<string, unknown>,
        undefined,
        undefined,
        localOffer.codecs
      )
    )
  return Object.freeze({
    major: remote.major,
    minor: remote.minor,
    codec: remote.codec,
    capabilities: remote.capabilities,
    peer: remote.peer
  })
}
