import { decodeUtf8, utf8ByteLength } from '@migaia/utils/bytes'
import { createContractError } from './contract-error.js'
import { deserializeRpcError, normalizeRpcSerializedError } from './error.js'
import { RpcContractErrorCode } from './error-code.js'
import { RPC_CONTRACT_SOURCE } from './error-text.js'
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

/** Create a categorized native error while preserving the original input as cause. */
function handshakeInvalid(violation: string, cause?: unknown): TypeError {
  const error = createContractError(RpcContractErrorCode.handshakeInvalid, cause) as TypeError
  Object.defineProperty(error, 'violation', { value: violation, enumerable: true })
  return error
}

/** Snapshot an ordinary object once; a hostile getter remains reachable through cause. */
function snapshot(value: unknown, cause: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw handshakeInvalid(RpcHandshakeViolation.type, cause)
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw handshakeInvalid(RpcHandshakeViolation.type, cause)
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
  const record = snapshot(value, value)
  if (
    typeof record.id !== 'string' ||
    record.id.length < 1 ||
    record.id.length > RpcWireLimit.maxIdentifierChars ||
    typeof record.runtime !== 'string' ||
    !RUNTIME_PATTERN.test(record.runtime)
  )
    throw handshakeInvalid(RpcHandshakeViolation.required, value)
  const peer: {
    id: string
    runtime: string
    runtimeVersion?: string
    implementation?: Readonly<{ name: string; version: string }>
  } = { id: record.id, runtime: record.runtime }
  if (Object.hasOwn(record, 'runtimeVersion')) {
    if (typeof record.runtimeVersion !== 'string' || record.runtimeVersion.length > 64)
      throw handshakeInvalid(RpcHandshakeViolation.type, value)
    peer.runtimeVersion = record.runtimeVersion
  }
  if (Object.hasOwn(record, 'implementation')) {
    const implementation = snapshot(record.implementation, record.implementation)
    if (typeof implementation.name !== 'string' || typeof implementation.version !== 'string')
      throw handshakeInvalid(RpcHandshakeViolation.required, record.implementation)
    peer.implementation = Object.freeze({
      name: implementation.name,
      version: implementation.version
    })
    unknownFields(implementation, ['name', 'version'], '/peer/implementation', options)
  }
  unknownFields(record, ['id', 'runtime', 'runtimeVersion', 'implementation'], '/peer', options)
  return Object.freeze(peer)
}

/** Validate version sets and reject repeated majors before attempting negotiation. */
function versions(value: unknown): readonly IRpcHandshakeVersion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > RpcWireLimit.maxVersions)
    throw handshakeInvalid(RpcHandshakeViolation.type, value)
  const seen = new Set<number>()
  const result = value.map((entry: unknown) => {
    const record = snapshot(entry, entry)
    if (
      !Number.isSafeInteger(record.major) ||
      (record.major as number) <= 0 ||
      !Number.isSafeInteger(record.minor) ||
      (record.minor as number) < 0
    )
      throw handshakeInvalid(RpcHandshakeViolation.type, entry)
    if (seen.has(record.major as number))
      throw handshakeInvalid(RpcHandshakeViolation.duplicate, value)
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
  requireJson: boolean
): readonly string[] {
  if (!Array.isArray(value) || value.length > max || (requireJson && value.length < 1))
    throw handshakeInvalid(RpcHandshakeViolation.type, value)
  if (!value.every((label: unknown) => typeof label === 'string' && pattern.test(label)))
    throw handshakeInvalid(RpcHandshakeViolation.type, value)
  const result = value as string[]
  if (new Set(result).size !== result.length)
    throw handshakeInvalid(RpcHandshakeViolation.duplicate, value)
  if (requireJson && !result.includes(RpcCodecId.json))
    throw handshakeInvalid(RpcHandshakeViolation.baseline, value)
  return Object.freeze([...result])
}

/** Parse a first message with exact UTF-8 decoding and the protocol byte bound. */
function parseText(text: IRpcHandshakeText): unknown {
  let json: string
  if (typeof text === 'string') {
    if (/([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u.test(text))
      throw handshakeInvalid(RpcHandshakeViolation.encoding, text)
    json = text
    if (utf8ByteLength(json) > RpcWireLimit.maxHandshakeBytes)
      throw handshakeInvalid(RpcHandshakeViolation.bytes, text)
  } else if (text instanceof Uint8Array) {
    if (text.byteLength > RpcWireLimit.maxHandshakeBytes)
      throw handshakeInvalid(RpcHandshakeViolation.bytes, text)
    try {
      json = decodeUtf8(text, { fatal: true })
    } catch (cause) {
      throw handshakeInvalid(RpcHandshakeViolation.encoding, cause)
    }
  } else throw handshakeInvalid(RpcHandshakeViolation.type, text)
  try {
    return JSON.parse(json) as unknown
  } catch (cause) {
    throw handshakeInvalid(RpcHandshakeViolation.type, cause)
  }
}

/** Validate and freeze a first-channel message without committing to a transport. */
export function normalizeRpcHandshake(
  text: IRpcHandshakeText,
  options?: IRpcEnvelopeOptions
): IRpcHandshakeMessage {
  const record = snapshot(parseText(text), text)
  if (record.kind !== RpcReservedKind.handshake || typeof record.protocol !== 'string')
    throw handshakeInvalid(RpcHandshakeViolation.required, text)
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
      codecs: labels(record.codecs, RpcWireLimit.maxCodecs, CODEC_PATTERN, true),
      capabilities: labels(
        record.capabilities,
        RpcWireLimit.maxCapabilities,
        CAPABILITY_PATTERN,
        false
      ),
      peer: peerInfo(record.peer, options),
      ...(Object.hasOwn(record, 'auth') ? { auth } : {})
    }
    unknownFields(
      record,
      ['kind', 'step', 'protocol', 'versions', 'codecs', 'capabilities', 'peer', 'auth'],
      '',
      options
    )
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
      throw handshakeInvalid(RpcHandshakeViolation.type, text)
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
        false
      ),
      peer: peerInfo(record.peer, options)
    }
    unknownFields(
      record,
      ['kind', 'step', 'protocol', 'major', 'minor', 'codec', 'capabilities', 'peer'],
      '',
      options
    )
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
      throw handshakeInvalid(RpcHandshakeViolation.type, cause)
    }
    unknownFields(record, ['kind', 'step', 'protocol', 'error'], '', options)
    return Object.freeze({
      kind: RpcReservedKind.handshake,
      step,
      protocol: record.protocol,
      error
    })
  }
  throw handshakeInvalid(RpcHandshakeViolation.step, text)
}

/** Encode a validated local offer into the first wire message. */
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
  if (typeof text !== 'string') throw handshakeInvalid(RpcHandshakeViolation.type, offer)
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

/** A responder chooses the highest common major and the initiator's preferred common codec. */
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
    throw handshakeInvalid(RpcHandshakeViolation.step, hello)
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

/** An initiator verifies that the responder accepted only values it actually offered. */
export function completeRpcHandshake(
  local: IRpcHandshakeOffer,
  reply: IRpcHandshakeText,
  options?: IRpcEnvelopeOptions
): IRpcHandshakeAgreement {
  const localOffer = normalizeRpcHandshake(createRpcHello(local))
  const remote = normalizeRpcHandshake(reply, options)
  if (localOffer.step !== RpcHandshakeStep.hello)
    throw handshakeInvalid(RpcHandshakeViolation.step, reply)
  if (remote.step === RpcHandshakeStep.reject) {
    const cause = deserializeRpcError(remote.error, { unknownFields: 'ignore' })
    throw createContractError(RpcContractErrorCode.handshakeRejected, cause)
  }
  if (remote.step !== RpcHandshakeStep.accept)
    throw handshakeInvalid(RpcHandshakeViolation.step, reply)
  const offeredVersion = localOffer.versions.find((version) => version.major === remote.major)
  if (
    remote.protocol !== RpcProtocol.id ||
    !offeredVersion ||
    remote.minor > offeredVersion.minor ||
    !localOffer.codecs.includes(remote.codec) ||
    remote.capabilities.some((capability) => !localOffer.capabilities.includes(capability))
  )
    throw handshakeInvalid(RpcHandshakeViolation.mismatch, reply)
  return Object.freeze({
    major: remote.major,
    minor: remote.minor,
    codec: remote.codec,
    capabilities: remote.capabilities,
    peer: remote.peer
  })
}
