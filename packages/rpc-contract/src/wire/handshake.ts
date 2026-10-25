/** Sole-profile handshake admission and negotiation operate on original protocol records. */
import {
  readHandshakePeer,
  readHandshakeVersions,
  readHandshakeLabels,
  validateHandshakeVersion,
  invalidHandshakeField
} from './handshake-fields.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import { createContractError } from '../contract/contract-error.js'
import { redactRpcHandshakeFailure } from '../errors/handshake-privacy.js'
import { RpcContractErrorCode } from '../error-code.js'
import { RpcWireLimit, RpcHandshakeViolation } from './limits.js'
import { array, identifier, invalid } from './record.js'
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
  /** This local cold set checks only duplicate proposals and holds no installed handler state. */
  const seen = new Set<string>()
  /** Element validation retains the original identifier-first failure order. */
  const result = array(
    value,
    (entry, pointer) => {
      /** Only this actual extension identifier is admitted into proposal membership. */
      const name = identifier(entry, pointer, metadata)
      if (!RpcWireExtensionPattern.test(name) || seen.has(name))
        invalid(P.extensions, undefined, metadata)
      seen.add(name)
      return name
    },
    P.extensions,
    metadata
  )
  if (result.length > RpcWireLimit.maxCapabilities) invalid(P.extensions, undefined, metadata)
  return result
}

/** Validate the selected variant's version and codec fields without constructing another record. */
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
    invalid(P.handshake, undefined, metadata)
  /** Unknown record properties are ignored, including properties owned by another step variant. */
  const input = value as Record<string, unknown>
  if (input.profile === undefined) invalid(`${P.handshake}/profile`, undefined, metadata)
  if (input.kind === undefined) invalid(`${P.handshake}/kind`, undefined, metadata)
  if (input.profile !== RpcWireProfile)
    invalidHandshakeField(RpcHandshakeViolation.type, '/profile', metadata)
  if (input.kind !== RpcWireKind.handshake)
    invalidHandshakeField(RpcHandshakeViolation.type, '/kind', metadata)
  if (input.step === S.reject) {
    if (input.error === undefined) invalid(`${P.handshake}/error`, undefined, metadata)
    normalizeRpcWireError(input.error, metadata, redactRpcHandshakeFailure)
    return value as IRpcHandshake
  }
  if (input.step === S.pending) {
    if (input.peer === undefined) invalid(`${P.handshake}/peer`, undefined, metadata)
    readHandshakePeer(input.peer, metadata)
    if (input.remainingMs === undefined) invalid(`${P.handshake}/remainingMs`, undefined, metadata)
    if (
      typeof input.remainingMs !== 'number' ||
      !Number.isFinite(input.remainingMs) ||
      input.remainingMs < 0 ||
      input.remainingMs > RpcWireLimit.maxDurationMs
    )
      invalidHandshakeField(RpcHandshakeViolation.type, '/remainingMs', metadata)
    if (Object.hasOwn(input, F.auth)) normalizeRpcPortable(input.auth, metadata)
    return value as IRpcHandshake
  }
  if (input.step !== S.hello && input.step !== S.accept)
    invalidHandshakeField(RpcHandshakeViolation.type, '/step', metadata)
  if (input.step === S.hello) {
    if (input.versions === undefined) invalid(`${P.handshake}/versions`, undefined, metadata)
    if (input.codecs === undefined) invalid(`${P.handshake}/codecs`, undefined, metadata)
  } else {
    if (input.major === undefined) invalid(`${P.handshake}/major`, undefined, metadata)
    if (input.minor === undefined) invalid(`${P.handshake}/minor`, undefined, metadata)
    if (input.codec === undefined) invalid(`${P.handshake}/codec`, undefined, metadata)
  }
  if (input.extensions === undefined) invalid(`${P.handshake}/extensions`, undefined, metadata)
  if (input.peer === undefined) invalid(`${P.handshake}/peer`, undefined, metadata)
  if (input.directory === undefined) invalid(`${P.handshake}/directory`, undefined, metadata)
  /** Peer and directory identify the same actual remote instance. */
  const peer = readHandshakePeer(input.peer, metadata)
  /** These offered extensions are descriptive until the session negotiates installed handlers. */
  const selected = readHandshakeLabels(
    input.extensions,
    RpcWireLimit.maxCapabilities,
    RpcWireExtensionPattern,
    false,
    metadata,
    '/extensions'
  )
  /** Directory admission delegates method/schema semantics without rereading unknown metadata. */
  const directory = normalizeRpcDirectory(input.directory, metadata, redactRpcHandshakeFailure)
  if (directory.self.instanceId !== peer.id)
    invalidHandshakeField(RpcHandshakeViolation.type, '/directory/self/instanceId', metadata)
  validateVersionCodec(input, metadata)
  if (Object.hasOwn(input, F.auth)) normalizeRpcPortable(input.auth, metadata)
  if (input.step === S.hello && Object.hasOwn(input, F.requiredExtensions)) {
    /** Requirements must belong to the actual offered handler set. */
    const required = extensions(input.requiredExtensions, metadata)
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
    throw createContractError(RpcContractErrorCode.handshakeInvalid, undefined, metadata)
  /** This protocol has one supported major; alternate v1/runtime profiles are never selected. */
  const remoteVersion = remote.versions.find((version) => version.major === RpcWireVersion.major)
  /** Version lists are bounded cold input, but indexing still avoids a nested version scan. */
  const ownVersion = own.versions.find((version) => version.major === RpcWireVersion.major)
  if (!remoteVersion || !ownVersion)
    throw createContractError(RpcContractErrorCode.handshakeIncompatible, undefined, metadata)
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
    throw createContractError(RpcContractErrorCode.handshakeRejected, undefined, metadata)
  if (accepted.step === S.reject)
    throw createContractError(
      RpcContractErrorCode.handshakeRejected,
      restoreRpcWireError(accepted.error, metadata),
      metadata
    )
  if (accepted.step !== S.accept)
    throw createContractError(RpcContractErrorCode.handshakeRejected, undefined, metadata)
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
    throw createContractError(RpcContractErrorCode.handshakeIncompatible, undefined, metadata)
  /** Accepted extension ids can only be a subset of this actual initiating offer. */
  const offered = new Set(original.extensions)
  /** Required membership is checked against the complete actual accepted set. */
  const selected = new Set(accepted.extensions)
  for (const name of accepted.extensions)
    if (!offered.has(name))
      throw createContractError(
        RpcContractErrorCode.extensionNegotiationFailed,
        undefined,
        metadata
      )
  for (const name of original.requiredExtensions ?? [])
    if (!selected.has(name))
      throw createContractError(
        RpcContractErrorCode.extensionNegotiationFailed,
        undefined,
        metadata
      )
  return accepted
}
