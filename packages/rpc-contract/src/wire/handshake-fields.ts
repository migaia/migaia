/** Pure handshake field validators borrow original records and ignore non-owned metadata fields. */
import type { IRpcHandshakeVersion, IRpcPeerInfo } from './types.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import { createContractError } from '../contract/contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import { RpcWireJsonCodec } from './constants.js'
import { RpcWireLimit, RpcHandshakeViolation } from './limits.js'
import { invalid } from './record.js'

/** Runtime labels describe the peer implementation rather than granting execution authority. */
const runtimePattern = /^[a-z][a-z0-9-]{0,31}$/u

/** Field diagnostics retain their native family without exposing any credential-bearing input. */
export function invalidHandshakeField(
  violation: string,
  pointer: string,
  metadata?: IRpcErrorWireMetadata
): never {
  /** Only classified field facts enter this local error, never reflected handshake values. */
  const error = createContractError(RpcContractErrorCode.handshakeInvalid, undefined, metadata)
  Object.defineProperties(error, {
    violation: { value: violation, enumerable: true },
    pointer: { value: pointer, enumerable: true }
  })
  throw error
}

/** Admit only the implementation's two descriptive text fields and retain the original record. */
function validateImplementation(value: unknown, metadata?: IRpcErrorWireMetadata): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/handshake', undefined, metadata)
  /** Extra display metadata has no protocol meaning. */
  const implementation = value as Record<string, unknown>
  if (typeof implementation.name !== 'string')
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/implementation/name', metadata)
  if (typeof implementation.version !== 'string')
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/implementation/version', metadata)
}

/** Validate bounded peer display facts without copying or interpreting its runtime label. */
export function readHandshakePeer(value: unknown, metadata?: IRpcErrorWireMetadata): IRpcPeerInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/handshake', undefined, metadata)
  /** Each known field is read directly from the peer record. */
  const peer = value as Record<string, unknown>
  if (
    typeof peer.id !== 'string' ||
    peer.id.length < 1 ||
    peer.id.length > RpcWireLimit.maxIdentifierChars
  )
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/id', metadata)
  if (typeof peer.runtime !== 'string' || !runtimePattern.test(peer.runtime))
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/runtime', metadata)
  if (
    Object.hasOwn(peer, 'runtimeVersion') &&
    (typeof peer.runtimeVersion !== 'string' || peer.runtimeVersion.length > 64)
  )
    invalidHandshakeField(RpcHandshakeViolation.type, '/peer/runtimeVersion', metadata)
  if (Object.hasOwn(peer, 'implementation')) validateImplementation(peer.implementation, metadata)
  return value as IRpcPeerInfo
}

/** Numeric version fields have the same domains in offers and selected accept records. */
export function validateHandshakeVersion(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  pointer = ''
): IRpcHandshakeVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/handshake', undefined, metadata)
  /** The version object is not frozen, copied or granted any negotiation authority here. */
  const version = value as Record<string, unknown>
  if (version.major === undefined) invalid(`${pointer}/major`, undefined, metadata)
  if (version.minor === undefined) invalid(`${pointer}/minor`, undefined, metadata)
  if (!Number.isSafeInteger(version.major) || (version.major as number) <= 0)
    invalidHandshakeField(RpcHandshakeViolation.type, `${pointer}/major`, metadata)
  if (!Number.isSafeInteger(version.minor) || (version.minor as number) < 0)
    invalidHandshakeField(RpcHandshakeViolation.type, `${pointer}/minor`, metadata)
  return value as IRpcHandshakeVersion
}

/** Validate bounded proposals in order, using one cold duplicate-major membership index. */
export function readHandshakeVersions(
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): readonly IRpcHandshakeVersion[] {
  if (!Array.isArray(value)) invalid('/handshake', undefined, metadata)
  if (value.length < 1 || value.length > RpcWireLimit.maxVersions)
    invalidHandshakeField(RpcHandshakeViolation.type, '/versions', metadata)
  /** Major uniqueness is negotiation grammar, not a second metadata registry. */
  const seen = new Set<number>()
  for (let index = 0; index < value.length; index++) {
    /** Each original proposal record is validated once before duplicate admission. */
    const version = validateHandshakeVersion(value[index], metadata, `/versions/${index}`)
    if (seen.has(version.major))
      invalidHandshakeField(RpcHandshakeViolation.duplicate, '/versions', metadata)
    seen.add(version.major)
  }
  return value as readonly IRpcHandshakeVersion[]
}

/** Keep offered label order while checking the original bounded codec/extension domain. */
export function readHandshakeLabels(
  value: unknown,
  max: number,
  pattern: RegExp,
  requireJson: boolean,
  metadata?: IRpcErrorWireMetadata,
  pointer = '/codecs'
): readonly string[] {
  if (!Array.isArray(value)) invalid('/handshake', undefined, metadata)
  if (value.length > max || (requireJson && value.length < 1))
    invalidHandshakeField(RpcHandshakeViolation.type, pointer, metadata)
  for (let index = 0; index < value.length; index++)
    if (typeof value[index] !== 'string' || !pattern.test(value[index]))
      invalidHandshakeField(RpcHandshakeViolation.type, `${pointer}/${index}`, metadata)
  if (new Set(value).size !== value.length)
    invalidHandshakeField(RpcHandshakeViolation.duplicate, pointer, metadata)
  if (requireJson && !value.includes(RpcWireJsonCodec))
    invalidHandshakeField(RpcHandshakeViolation.baseline, pointer, metadata)
  return value as readonly string[]
}
