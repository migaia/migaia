/** Sole-profile handshake admission and negotiation operate on original protocol records. */
import {
  readHandshakePeer,
  readHandshakeVersions,
  readHandshakeLabels,
  validateHandshakeVersion,
  invalidHandshakeField,
  readHandshakeProperty
} from './handshake-fields.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import { createContractError } from '../contract/contract-error.js'
import { redactRpcHandshakeFailure } from '../errors/handshake-privacy.js'
import { RpcContractErrorCode } from '../error-code.js'
import { RpcWireLimit, RpcHandshakeViolation } from './limits.js'
import { array } from './record.js'
import { RpcHandshakeReason } from './handshake-text.js'
import { normalizeRpcPortable } from '../portable/normalize.js'
import { normalizeRpcDirectory } from './directory.js'
import { normalizeRpcWireError, restoreRpcWireError } from './errors.js'
import {
  RpcWireField as F,
  RpcWirePointer as P,
  RpcWireProfile,
  RpcWireKind,
  RpcWireHandshakeStep as S,
  RpcWireVersion,
  RpcWireExtensionPattern,
  RpcWireCodecPattern
} from './constants.js'
import type { IRpcHandshake, IRpcHello, IRpcAccept } from './types.js'

/** Validate required extension labels using the existing suffix grammar and duplicate limit. */
function extensions(value: unknown, metadata?: IRpcErrorWireMetadata): readonly string[] {
  if (!Array.isArray(value))
    invalidHandshakeField(RpcHandshakeViolation.type, P.requiredExtensions, metadata)
  /** This local cold set checks only duplicate proposals and holds no installed handler state. */
  const seen = new Set<string>()
  /** Element validation retains the original identifier-first failure order. */
  const result = array(
    value,
    (entry, pointer) => {
      /** Only this actual extension identifier is admitted into proposal membership. */
      if (
        typeof entry !== 'string' ||
        entry.length < 1 ||
        entry.length > RpcWireLimit.maxIdentifierChars
      )
        invalidHandshakeField(RpcHandshakeViolation.type, pointer, metadata)
      const name = entry
      if (!RpcWireExtensionPattern.test(name) || seen.has(name))
        invalidHandshakeField(RpcHandshakeViolation.type, P.extensions, metadata)
      seen.add(name)
      return name
    },
    P.extensions,
    metadata
  )
  if (result.length > RpcWireLimit.maxCapabilities)
    invalidHandshakeField(RpcHandshakeViolation.type, P.extensions, metadata)
  return result
}

/** Required presence is checked at the original known-field read, without a record scan. */
function required(
  input: Record<string, unknown>,
  key: string,
  metadata?: IRpcErrorWireMetadata
): unknown {
  /** This captured value also serves later field validation instead of rereading its getter. */
  const value = readHandshakeProperty(input, key, metadata)
  if (value === undefined)
    invalidHandshakeField(RpcHandshakeViolation.required, `/${key}`, metadata)
  return value
}

/** Authentication stays with the sole portable validator and the existing safe-cause policy. */
function validateAuth(input: Record<string, unknown>, metadata?: IRpcErrorWireMetadata): void {
  if (!Object.hasOwn(input, F.auth)) return
  /** A getter failure is classified before the delegated portable validation starts. */
  const auth = readHandshakeProperty(input, F.auth, metadata)
  try {
    normalizeRpcPortable(auth, metadata)
  } catch (cause) {
    invalidHandshakeField(
      RpcHandshakeViolation.type,
      '/auth',
      metadata,
      redactRpcHandshakeFailure(cause)
    )
  }
}

/** Validate the captured variant fields without rereading any application-owned getter. */
function validateVersionCodec(
  input: Record<string, unknown>,
  metadata?: IRpcErrorWireMetadata
): void {
  if (input.step === S.hello) {
    readHandshakeVersions(input.versions, metadata)
    readHandshakeLabels(input.codecs, RpcWireLimit.maxCodecs, RpcWireCodecPattern, true, metadata)
  } else {
    validateHandshakeVersion(input, metadata)
    if (typeof input.codec !== 'string' || !RpcWireCodecPattern.test(input.codec))
      invalidHandshakeField(RpcHandshakeViolation.type, '/codec', metadata)
  }
}

/** Admit known handshake fields and return exactly the original caller-owned record. */
export function normalizeRpcHandshakeRecord(
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcHandshake {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidHandshakeField(RpcHandshakeViolation.type, P.handshake, metadata)
  /** Unknown record properties are ignored, including properties owned by another step variant. */
  const input = value as Record<string, unknown>
  /** Profile and discriminator retain their original required-field read order. */
  const profile = required(input, F.profile, metadata)
  /** Only a known discriminator is read; additive metadata is never visited. */
  const kind = required(input, F.kind, metadata)
  if (typeof profile !== 'string')
    invalidHandshakeField(RpcHandshakeViolation.type, '/profile', metadata)
  if (profile !== RpcWireProfile)
    invalidHandshakeField(RpcHandshakeViolation.mismatch, '/profile', metadata)
  if (kind !== RpcWireKind.handshake)
    invalidHandshakeField(RpcHandshakeViolation.required, '/kind', metadata)
  /** The selected step is shared by all following admission branches without another read. */
  const step = readHandshakeProperty(input, F.step, metadata)
  if (step === S.reject) {
    /** Wire-error admission executes once and its safe diagnostic remains handshake-owned. */
    const error = required(input, F.error, metadata)
    try {
      normalizeRpcWireError(error, metadata, redactRpcHandshakeFailure)
    } catch (cause) {
      invalidHandshakeField(
        RpcHandshakeViolation.type,
        '/error',
        metadata,
        redactRpcHandshakeFailure(cause)
      )
    }
    return value as IRpcHandshake
  }
  if (step === S.pending) {
    readHandshakePeer(required(input, F.peer, metadata), metadata)
    /** Relative admission budget is captured once after peer validation. */
    const remainingMs = required(input, F.remainingMs, metadata)
    if (
      typeof remainingMs !== 'number' ||
      !Number.isFinite(remainingMs) ||
      remainingMs < 0 ||
      remainingMs > RpcWireLimit.maxDurationMs
    )
      invalidHandshakeField(RpcHandshakeViolation.type, '/remainingMs', metadata)
    validateAuth(input, metadata)
    return value as IRpcHandshake
  }
  if (step !== S.hello && step !== S.accept)
    invalidHandshakeField(RpcHandshakeViolation.step, '/step', metadata)
  /** Only this selected variant's known fields are lent to its later scalar validators. */
  const versionCodec =
    step === S.hello
      ? {
          step,
          versions: required(input, F.versions, metadata),
          codecs: required(input, F.codecs, metadata)
        }
      : {
          step,
          major: required(input, F.major, metadata),
          minor: required(input, F.minor, metadata),
          codec: required(input, F.codec, metadata)
        }
  /** Presence checks retain their established order before peer/directory admission. */
  const selectedExtensions = required(input, F.extensions, metadata)
  /** The peer record is borrowed rather than snapshotted or enumerated. */
  const peerValue = required(input, F.peer, metadata)
  /** Directory's existing owner performs its only semantic traversal below. */
  const directoryValue = required(input, F.directory, metadata)
  /** Peer and directory identify the same actual remote instance. */
  const peerId = readHandshakePeer(peerValue, metadata)
  /** These offered extensions are descriptive until the session negotiates installed handlers. */
  const selected = readHandshakeLabels(
    selectedExtensions,
    RpcWireLimit.maxCapabilities,
    RpcWireExtensionPattern,
    false,
    metadata,
    '/extensions'
  )
  /** Directory admission delegates method/schema semantics without rereading unknown metadata. */
  const directory = normalizeRpcDirectory(directoryValue, metadata, redactRpcHandshakeFailure)
  if (directory.self.instanceId !== peerId)
    invalidHandshakeField(RpcHandshakeViolation.type, '/directory/self/instanceId', metadata)
  validateVersionCodec(versionCodec, metadata)
  validateAuth(input, metadata)
  if (step === S.hello && Object.hasOwn(input, F.requiredExtensions)) {
    /** Requirements must belong to the actual offered handler set. */
    const required = extensions(
      readHandshakeProperty(input, F.requiredExtensions, metadata),
      metadata
    )
    /** One cold membership index avoids repeated proposal scans. */
    const offered = new Set(selected)
    for (const name of required)
      if (!offered.has(name))
        invalidHandshakeField(RpcHandshakeViolation.type, '/requiredExtensions', metadata)
  }
  return value as IRpcHandshake
}

/** Public pure admission does not capture, freeze or mutate handshake metadata. */
export function normalizeRpcHandshake(
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcHandshake {
  return normalizeRpcHandshakeRecord(value, metadata)
}

/** Select only actual common optional handlers; an unavailable explicit requirement rejects. */
function selectExtensions(
  offer: IRpcHello,
  local: IRpcHello,
  metadata?: IRpcErrorWireMetadata
): readonly string[] {
  /** Cold negotiation builds the peer membership index only once. */
  const available = new Set(local.extensions)
  /** Initiator proposal order remains the stable selected order. */
  const selected = offer.extensions.filter((name) => available.has(name))
  /** The selected index also serves both independently declared required subsets. */
  const accepted = new Set(selected)
  for (const name of offer.requiredExtensions ?? [])
    if (!accepted.has(name))
      throw createContractError(
        RpcContractErrorCode.extensionNegotiationFailed,
        undefined,
        metadata
      )
  for (const name of local.requiredExtensions ?? [])
    if (!accepted.has(name))
      throw createContractError(
        RpcContractErrorCode.extensionNegotiationFailed,
        undefined,
        metadata
      )
  return Object.freeze(selected)
}

/** Negotiate the single major version and initiator-preferred actual shared codec in O(n). */
export function acceptRpcHandshake(
  offer: IRpcHello,
  local: IRpcHello,
  metadata?: IRpcErrorWireMetadata
): IRpcAccept {
  /** Normalization keeps this public pure function safe for structurally typed callers as well. */
  const remote = normalizeRpcHandshake(offer, metadata)
  /** The responder offer is validated independently and cannot claim an uninstalled handler. */
  const own = normalizeRpcHandshake(local, metadata)
  if (remote.step !== S.hello || own.step !== S.hello)
    invalidHandshakeField(RpcHandshakeViolation.step, '/step', metadata)
  /** This protocol has one supported major; alternate v1/runtime profiles are never selected. */
  const remoteVersion = remote.versions.find((version) => version.major === RpcWireVersion.major)
  /** Version lists are bounded cold input, but indexing still avoids a nested version scan. */
  const ownVersion = own.versions.find((version) => version.major === RpcWireVersion.major)
  if (!remoteVersion || !ownVersion) {
    /** The original public reason distinguishes incompatible majors from codec requirements. */
    const error = createContractError(
      RpcContractErrorCode.handshakeIncompatible,
      undefined,
      metadata
    )
    Object.defineProperty(error, F.reason, { value: RpcHandshakeReason.version, enumerable: true })
    throw error
  }
  /** A codec membership index preserves initiator priority in one pass. */
  const codecs = new Set(own.codecs)
  /** At most one linear pass selects the first actual shared codec. */
  const codec = remote.codecs.find((name) => codecs.has(name))
  if (!codec)
    throw createContractError(RpcContractErrorCode.handshakeIncompatible, undefined, metadata)
  return Object.freeze({
    profile: RpcWireProfile,
    kind: RpcWireKind.handshake,
    step: S.accept,
    major: RpcWireVersion.major,
    minor: Math.min(remoteVersion.minor, ownVersion.minor, RpcWireVersion.minor),
    codec,
    extensions: selectExtensions(remote, own, metadata),
    peer: own.peer,
    directory: own.directory,
    ...(own.auth === undefined ? {} : { auth: own.auth })
  })
}

/** Check an accept against its actual offer without granting any carrier/session authority. */
export function completeRpcHandshake(
  offer: IRpcHello,
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcAccept {
  /** Capture the actual initiating offer once for codec/version/required-extension membership. */
  const original = normalizeRpcHandshake(offer, metadata)
  /** The reply is independently shape checked before it can change session readiness. */
  const accepted = normalizeRpcHandshake(value, metadata)
  if (original.step !== S.hello)
    invalidHandshakeField(RpcHandshakeViolation.step, '/step', metadata)
  if (accepted.step === S.reject)
    throw createContractError(
      RpcContractErrorCode.handshakeRejected,
      restoreRpcWireError(accepted.error, metadata),
      metadata
    )
  if (accepted.step !== S.accept)
    invalidHandshakeField(RpcHandshakeViolation.step, '/step', metadata)
  /** Cold offer indexes avoid nested lookup over runtime-sized proposal arrays. */
  const codecs = new Set(original.codecs)
  /** Only the one supported major can become this profile's accepted agreement. */
  const version = original.versions.find((item) => item.major === accepted.major)
  if (
    accepted.major !== RpcWireVersion.major ||
    accepted.minor > RpcWireVersion.minor ||
    !version ||
    accepted.minor > version.minor ||
    !codecs.has(accepted.codec)
  )
    invalidHandshakeField(RpcHandshakeViolation.mismatch, '/handshake', metadata)
  /** Accepted extension ids can only be a subset of this actual initiating offer. */
  const offered = new Set(original.extensions)
  /** Required membership is checked against the complete actual accepted set. */
  const selected = new Set(accepted.extensions)
  for (const name of accepted.extensions)
    if (!offered.has(name))
      invalidHandshakeField(RpcHandshakeViolation.mismatch, '/extensions', metadata)
  for (const name of original.requiredExtensions ?? [])
    if (!selected.has(name))
      throw createContractError(
        RpcContractErrorCode.extensionNegotiationFailed,
        undefined,
        metadata
      )
  return accepted
}
