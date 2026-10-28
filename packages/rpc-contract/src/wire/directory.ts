/** Pure schema3 directory validators read original records and their known fields only. */
import { normalizeRpcGeneration } from './metadata.ts'
import { RpcWireDirectoryVersion } from './constants.ts'
import {
  RpcWireLimit,
  REMOTE_NAME_PATTERN,
  RPC_DIRECTORY_METHOD_LIMIT,
  RuntimeApiMode,
  RuntimeApiModeSource
} from './limits.ts'
import { readMethodSchema, normalizeMethodSchema } from './method-schema.ts'
import {
  inspectShape,
  rejectShape,
  isShapeFailure,
  RpcShapeReason,
  type IShapeInspection,
  type IRpcShapeCheck
} from './schema-diagnostics.ts'
import { invalid as invalidEnvelope } from './record.ts'
import type { IRpcDirectory } from './types.ts'
import type { IRpcErrorWireMetadata } from '../contract/types.ts'

/** Method path segments use the same stable grammar as local provider declarations. */
const segment = new RegExp(REMOTE_NAME_PATTERN, 'u')

/** Check APIs receive diagnostics; throwing admission keeps the original native envelope domain. */
function invalid(
  pointer: string,
  reason: RpcShapeReason,
  metadata?: IRpcErrorWireMetadata,
  inspection?: IShapeInspection,
  cause?: unknown
): never {
  if (inspection) return rejectShape(inspection, reason, pointer, cause)
  return invalidEnvelope(pointer, cause, metadata)
}

/** Validate only the three known self fields without creating an identity projection. */
function validateIdentity(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  inspection?: IShapeInspection
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/directory/self', RpcShapeReason.record, metadata, inspection)
  /** The original identity is borrowed by every later consumer. */
  const identity = value as Record<string, unknown>
  for (const field of ['name', 'instanceId'] as const)
    if (
      typeof identity[field] !== 'string' ||
      identity[field].length === 0 ||
      identity[field].length > RpcWireLimit.maxIdentifierChars
    )
      invalid(`/directory/self/${field}`, RpcShapeReason['runtime-identity'], metadata, inspection)
  normalizeRpcGeneration(identity.generation, metadata)
}

/** Validate one actual method description; schema payloads retain their existing separate grammar. */
function validateMethod(
  value: unknown,
  pointer: string,
  names: Set<string>,
  metadata?: IRpcErrorWireMetadata,
  inspection?: IShapeInspection
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(pointer, RpcShapeReason.record, metadata, inspection)
  /** Unknown method metadata is neither enumerated nor copied. */
  const method = value as Record<string, unknown>
  if (
    method.forwardedVia !== undefined &&
    (typeof method.forwardedVia !== 'string' || !segment.test(method.forwardedVia))
  )
    invalid(`${pointer}/forwardedVia`, RpcShapeReason['runtime-forward'], metadata, inspection)
  if (
    typeof method.name !== 'string' ||
    method.name.length > RpcWireLimit.maxIdentifierChars ||
    !method.name.split('.').every((part) => segment.test(part)) ||
    names.has(method.name)
  )
    invalid(`${pointer}/name`, RpcShapeReason['runtime-method'], metadata, inspection)
  names.add(method.name)
  if (
    !Array.isArray(method.supportedModes) ||
    method.supportedModes.length === 0 ||
    method.supportedModes.length > Object.keys(RuntimeApiMode).length
  )
    invalid(`${pointer}/supportedModes`, RpcShapeReason['runtime-modes'], metadata, inspection)
  if (
    new Set(method.supportedModes).size !== method.supportedModes.length ||
    method.supportedModes.some((mode) => !Object.values(RuntimeApiMode).includes(mode))
  )
    invalid(`${pointer}/supportedModes`, RpcShapeReason['runtime-modes'], metadata, inspection)
  if (!Object.values(RuntimeApiModeSource).includes(method.modeSource as RuntimeApiModeSource))
    invalid(`${pointer}/modeSource`, RpcShapeReason['runtime-mode-source'], metadata, inspection)
  if (method.idempotent !== undefined && typeof method.idempotent !== 'boolean')
    invalid(`${pointer}/idempotent`, RpcShapeReason['runtime-idempotency'], metadata, inspection)
  /** The original directory/method-list/method layers consume three portable embedding levels. */
  for (const key of ['input', 'output', 'yield']) {
    if (!Object.hasOwn(method, key)) continue
    if (inspection) readMethodSchema(method[key], inspection, metadata, 3)
    else {
      try {
        normalizeMethodSchema(method[key], metadata, 3)
      } catch (cause) {
        invalid(`${pointer}/${key}`, RpcShapeReason.schema, metadata, undefined, cause)
      }
    }
  }
}

/** Validate the known cold directory fields in their existing order and retain the original record. */
function validateDirectory(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  inspection?: IShapeInspection
): IRpcDirectory {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/directory', RpcShapeReason.record, metadata, inspection)
  /** Only this profile's directory metadata participates in version and method admission. */
  const directory = value as Record<string, unknown>
  if (
    directory.nodeId !== undefined &&
    (typeof directory.nodeId !== 'string' || !/^[0-9a-f]{32}$/u.test(directory.nodeId))
  )
    invalid('/directory/nodeId', RpcShapeReason['runtime-node'], metadata, inspection)
  if (directory.schemaVersion !== RpcWireDirectoryVersion)
    invalid('/directory/schemaVersion', RpcShapeReason.version, metadata, inspection)
  if (!Array.isArray(directory.methods) || directory.methods.length > RPC_DIRECTORY_METHOD_LIMIT)
    invalid('/directory/methods', RpcShapeReason['runtime-methods'], metadata, inspection)
  /** One cold membership set enforces actual method-name uniqueness in linear input time. */
  const names = new Set<string>()
  for (let index = 0; index < directory.methods.length; index++)
    validateMethod(
      directory.methods[index],
      `/directory/methods/${index}`,
      names,
      metadata,
      inspection
    )
  validateIdentity(directory.self, metadata, inspection)
  return value as IRpcDirectory
}

/** Diagnostic shape checking preserves original local schema/getter failures as bounded causes. */
export function checkRpcDirectory(
  input: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcShapeCheck<IRpcDirectory> {
  return inspectShape((inspection) => {
    try {
      return validateDirectory(input, metadata, inspection)
    } catch (cause) {
      if (isShapeFailure(inspection, cause)) throw cause
      return rejectShape(inspection, RpcShapeReason.portable, '$', cause)
    }
  })
}

/** The throwing protocol boundary returns the original directory without a diagnostic success DTO. */
export function normalizeRpcDirectory(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  causeProjector?: (cause: unknown) => unknown
): IRpcDirectory {
  if (!causeProjector) return validateDirectory(value, metadata)
  /** Handshake privacy applies only to failures; successful metadata creates no snapshot. */
  try {
    return validateDirectory(value, metadata)
  } catch (cause) {
    return invalidEnvelope('/directory', causeProjector(cause), metadata)
  }
}
