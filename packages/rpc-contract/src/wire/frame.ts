/**
 * Admits carrier shells and binary manifests around the canonical semantic frame parser, including
 * negotiated extension labels and original native sidecars. Codec execution, digest verification,
 * backing ownership and stream framing belong to SDK or installed transport capabilities.
 */
import { normalizeRpcPortable } from '../portable/normalize.ts'
import type { IRpcPortableProjector } from './types.ts'
import type { IRpcErrorWireMetadata } from '../contract/types.ts'
/**
 * Validates the carrier-facing frame shell and native binary manifest shapes. Actual codecs,
 * fragment reassembly, sidecar integrity work, transfer, and physical IO belong to their owners.
 */
import { isArrayBuffer } from '@migaia/utils/bytes'
import { isCanonicalBase64url } from '@migaia/serialize/core'
import { array, identifier, invalid } from './record.ts'

import { createContractError } from '../contract/contract-error.ts'
import { RpcContractErrorCode } from '../error-code.ts'
import type { IRpcCarrierFrame } from '../interfaces/carrier.ts'
import type { IRpcBinaryManifest } from './types.ts'
import {
  RpcCarrierFrameKind as K,
  RpcWireField as F,
  RpcWirePointer as P,
  RpcWireExtensionPattern,
  RpcWireBinaryProfile,
  RpcWireBinaryStorage
} from './constants.ts'
import { normalizeRpcFrame, isRpcOperationalFrame } from './envelope.ts'

/** The existing SHA-256 metadata spelling is data, not an executing crypto implementation. */
const digestPattern = /^[0-9a-f]{64}$/u

/** Admit opaque media data and original native backings after checking actual negotiated handlers. */
export function normalizeRpcCarrierFrame(
  value: unknown,
  negotiatedExtensions: ReadonlySet<string>,
  metadata?: IRpcErrorWireMetadata
): IRpcCarrierFrame {
  /** Unknown data remains opaque until its one codec or installed frame handler consumes it. */
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.frame, undefined, metadata)
  /** Carrier data remains opaque and the original sidecar identities are borrowed. */
  const input = value as Record<string, unknown>
  if (input.kind === undefined) invalid(`${P.frame}/kind`, undefined, metadata)
  if (input.data === undefined) invalid(`${P.frame}/data`, undefined, metadata)
  if (input.kind === K.extension) {
    /** This value is descriptive; the Session-owned actual set supplies accepted handler authority. */
    const name = identifier(input.extension, P.extensions, metadata)
    if (!RpcWireExtensionPattern.test(name) || !negotiatedExtensions.has(name))
      throw createContractError(
        RpcContractErrorCode.extensionNegotiationFailed,
        undefined,
        metadata
      )
  } else if (input.kind !== K.message) invalid(`${P.frame}/kind`, undefined, metadata)
  if (Object.hasOwn(input, F.sidecars))
    array(
      input.sidecars,
      (entry, pointer) => {
        if (!isArrayBuffer(entry)) invalid(pointer, undefined, metadata)
        return entry
      },
      P.frame,
      metadata
    )
  return value as IRpcCarrierFrame
}

/** Validate the active inline-data or native-sidecar metadata without executing backing policy. */
function validateBacking(value: unknown, pointer: string, metadata?: IRpcErrorWireMetadata): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(pointer, undefined, metadata)
  /** No backing bytes are accessed, hashed or copied during record admission. */
  const backing = value as Record<string, unknown>
  if (!Number.isSafeInteger(backing.byteLength) || (backing.byteLength as number) < 0)
    invalid(`${pointer}/byteLength`, undefined, metadata)
  if (Object.hasOwn(backing, F.data)) {
    /** Inline data selects this row's representation; any digest field is inactive metadata. */
    const data = backing.data
    if (typeof data !== 'string' || !isCanonicalBase64url(data))
      invalid(`${pointer}/data`, undefined, metadata)
    return
  }
  if (
    Object.hasOwn(backing, F.sha256) &&
    (typeof backing.sha256 !== 'string' || !digestPattern.test(backing.sha256))
  )
    invalid(`${pointer}/sha256`, undefined, metadata)
}

/** Pure manifest admission retains full backing metadata without hashing, copying, or restoring it. */
export function normalizeRpcBinaryManifest(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): IRpcBinaryManifest {
  /** This module validates shape only; caller carrier owns every referenced backing and its bytes. */
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.manifest, undefined, metadata)
  /** Only the four manifest fields participate in this pure admission. */
  const input = value as Record<string, unknown>
  if (input.profile === undefined) invalid(`${P.manifest}/profile`, undefined, metadata)
  if (input.storage === undefined) invalid(`${P.manifest}/storage`, undefined, metadata)
  if (input.envelope === undefined) invalid(`${P.manifest}/envelope`, undefined, metadata)
  if (input.backings === undefined) invalid(`${P.manifest}/backings`, undefined, metadata)
  if (input.profile !== RpcWireBinaryProfile) invalid(`${P.manifest}/profile`, undefined, metadata)
  if (
    input.storage !== RpcWireBinaryStorage.inline &&
    input.storage !== RpcWireBinaryStorage.native
  )
    invalid(`${P.manifest}/storage`, undefined, metadata)
  /** Semantic normalization uses the same sole new-profile parser as ordinary calls. */
  const envelope = normalizeRpcFrame(input.envelope, metadata, portable)
  if (!isRpcOperationalFrame(envelope)) invalid(P.manifest, undefined, metadata)
  if (!Array.isArray(input.backings)) invalid(`${P.manifest}/backings`, undefined, metadata)
  for (let index = 0; index < input.backings.length; index++)
    validateBacking(input.backings[index], `${P.manifest}/${index}`, metadata)
  if (
    input.storage === RpcWireBinaryStorage.inline &&
    (input.backings as readonly unknown[]).length !== 0
  )
    invalid(P.manifest, undefined, metadata)
  return value as IRpcBinaryManifest
}
