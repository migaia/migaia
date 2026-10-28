/** Pure handshake field validators borrow original records and ignore non-owned metadata fields. */
import type { IRpcHandshakeVersion } from './types.ts'
import type { IRpcErrorWireMetadata } from '../contract/types.ts'
import { tryReadProperty } from '@migaia/utils/error'
import { createContractError } from '../contract/contract-error.ts'
import { RpcContractErrorCode } from '../error-code.ts'
import { RpcWireJsonCodec, RpcWireField as F } from './constants.ts'
import { RpcWireLimit, RpcHandshakeViolation } from './limits.ts'

/** Runtime labels describe the peer implementation rather than granting execution authority. */
const runtimePattern = /^[a-z][a-z0-9-]{0,31}$/u

/** Field diagnostics retain their native family without exposing any credential-bearing input. */
export function invalidHandshakeField(
  violation: string,
  pointer: string,
  metadata?: IRpcErrorWireMetadata,
  cause?: unknown
): never {
  /** Only classified field facts enter this local error, never reflected handshake values. */
  const error = createContractError(RpcContractErrorCode.handshakeInvalid, cause, metadata)
  Object.defineProperties(error, {
    violation: { value: violation, enumerable: true },
    pointer: { value: pointer, enumerable: true }
  })
  throw error
}

/** Read one selected known field once; a getter failure retains its exact original cause. */
export function readHandshakeProperty(
  value: Record<string, unknown>,
  key: string,
  metadata?: IRpcErrorWireMetadata,
  pointer = `/${key}`
): unknown {
  /** Utils captures only this property read, never validation failures or unknown fields. */
  const read = tryReadProperty(value, key)
  if (read.threw) invalidHandshakeField(RpcHandshakeViolation.read, pointer, metadata, read.error)
  return read.value
}

/** Admit only the implementation's two descriptive text fields and retain the original record. */
function validateImplementation(value: unknown, metadata?: IRpcErrorWireMetadata): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidHandshakeField(RpcHandshakeViolation.type, '/peer/implementation', metadata)
  /** Extra display metadata has no protocol meaning. */
  const implementation = value as Record<string, unknown>
  if (
    typeof readHandshakeProperty(implementation, F.name, metadata, '/peer/implementation/name') !==
    'string'
  )
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/implementation/name', metadata)
  if (
    typeof readHandshakeProperty(
      implementation,
      'version',
      metadata,
      '/peer/implementation/version'
    ) !== 'string'
  )
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/implementation/version', metadata)
}

/** Validate bounded peer facts and lend the captured id to the directory-identity check. */
export function readHandshakePeer(value: unknown, metadata?: IRpcErrorWireMetadata): string {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidHandshakeField(RpcHandshakeViolation.type, '/peer', metadata)
  /** Each known field is read directly from the peer record. */
  const peer = value as Record<string, unknown>
  /** Identifier validation finishes before the next known peer field is read. */
  const id = readHandshakeProperty(peer, F.id, metadata, '/peer/id')
  if (typeof id !== 'string' || id.length < 1 || id.length > RpcWireLimit.maxIdentifierChars)
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/id', metadata)
  /** Runtime is descriptive input and never grants authentication authority. */
  const runtime = readHandshakeProperty(peer, F.runtime, metadata, '/peer/runtime')
  if (typeof runtime !== 'string' || !runtimePattern.test(runtime))
    invalidHandshakeField(RpcHandshakeViolation.required, '/peer/runtime', metadata)
  if (Object.hasOwn(peer, F.runtimeVersion)) {
    /** Optional display text is read only when the original peer owns it. */
    const version = readHandshakeProperty(peer, F.runtimeVersion, metadata, '/peer/runtimeVersion')
    if (typeof version !== 'string' || version.length > 64)
      invalidHandshakeField(RpcHandshakeViolation.type, '/peer/runtimeVersion', metadata)
  }
  if (Object.hasOwn(peer, F.implementation))
    validateImplementation(
      readHandshakeProperty(peer, F.implementation, metadata, '/peer/implementation'),
      metadata
    )
  return id
}

/** Validate both numeric domains once and lend the admitted major to duplicate checking. */
export function validateHandshakeVersion(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  pointer = ''
): number {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidHandshakeField(RpcHandshakeViolation.type, pointer, metadata)
  /** The version object is not frozen, copied or granted any negotiation authority here. */
  const version = value as Record<string, unknown>
  /** Missing-field precedence stays ahead of numeric-domain validation. */
  const major = readHandshakeProperty(version, F.major, metadata, `${pointer}/major`)
  if (major === undefined)
    invalidHandshakeField(RpcHandshakeViolation.required, `${pointer}/major`, metadata)
  /** Minor follows the original major read and does not revisit its getter. */
  const minor = readHandshakeProperty(version, F.minor, metadata, `${pointer}/minor`)
  if (minor === undefined)
    invalidHandshakeField(RpcHandshakeViolation.required, `${pointer}/minor`, metadata)
  if (!Number.isSafeInteger(major) || (major as number) <= 0)
    invalidHandshakeField(RpcHandshakeViolation.type, `${pointer}/major`, metadata)
  if (!Number.isSafeInteger(minor) || (minor as number) < 0)
    invalidHandshakeField(RpcHandshakeViolation.type, `${pointer}/minor`, metadata)
  return major as number
}

/** Validate bounded proposals in order, using one cold duplicate-major membership index. */
export function readHandshakeVersions(
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): readonly IRpcHandshakeVersion[] {
  if (!Array.isArray(value))
    invalidHandshakeField(RpcHandshakeViolation.type, '/versions', metadata)
  if (value.length < 1 || value.length > RpcWireLimit.maxVersions)
    invalidHandshakeField(RpcHandshakeViolation.type, '/versions', metadata)
  /** Major uniqueness is negotiation grammar, not a second metadata registry. */
  const seen = new Set<number>()
  for (let index = 0; index < value.length; index++) {
    /** Each original proposal record is validated once before duplicate admission. */
    const major = validateHandshakeVersion(value[index], metadata, `/versions/${index}`)
    if (seen.has(major))
      invalidHandshakeField(RpcHandshakeViolation.duplicate, '/versions', metadata)
    seen.add(major)
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
  if (!Array.isArray(value)) invalidHandshakeField(RpcHandshakeViolation.type, pointer, metadata)
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
