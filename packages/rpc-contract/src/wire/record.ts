/** Scalar failures and ordered array validation serve the single protocol without record copies. */
import { RpcContractErrorCode } from '../error-code.ts'
import { RpcEnvelopeViolation, RpcWireLimit } from './limits.ts'
import { createContractError } from '../contract/contract-error.ts'
import type { IRpcErrorWireMetadata } from '../contract/types.ts'
/** Reject closed-profile input with the existing native contract error, preserving its cause. */
export function invalid(pointer: string, cause?: unknown, metadata?: IRpcErrorWireMetadata): never {
  throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, pointer, cause, metadata)
}

/** Validate array elements in order without snapshotting or changing caller-owned containers. */
export function array<T>(
  value: unknown,
  validate: (value: unknown, pointer: string) => T,
  pointer: string,
  metadata?: IRpcErrorWireMetadata
): readonly T[] {
  if (!Array.isArray(value)) invalid(pointer, undefined, metadata)
  for (let index = 0; index < value.length; index++) validate(value[index], `${pointer}/${index}`)
  return value as readonly T[]
}

/** Preserve the original identifier domain instead of adding a second task/key grammar. */
export function identifier(
  value: unknown,
  pointer: string,
  metadata?: IRpcErrorWireMetadata
): string {
  if (!isIdentifier(value)) invalid(pointer, undefined, metadata)
  return value
}

/** Attaches the first semantic violation and its JSON pointer without replacing the cause. */
export function invalidRpcEnvelope(
  violation: string,
  pointer: string,
  cause?: unknown,
  metadata?: IRpcErrorWireMetadata
): TypeError {
  const error = createContractError(
    RpcContractErrorCode.invalidEnvelope,
    cause,
    metadata
  ) as TypeError
  Object.defineProperties(error, {
    violation: { value: violation, enumerable: true },
    pointer: { value: pointer, enumerable: true }
  })
  return error
}

/** A bounded nonempty identifier is the common routing identity domain. */
export function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= RpcWireLimit.maxIdentifierChars
  )
}
