import { PartContractErrorCode } from './error-code.ts'
import { PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import type { IDescriptor, IKindSchema } from './types.ts'

/** Built-in kinds; this list has a fixed size of six, so membership checks are constant time. */
const BUILTIN_KINDS: ReadonlySet<string> = new Set([
  'part',
  'enhancer',
  'derive',
  'resource',
  'effect',
  'rule'
])
/** Descriptor id grammar: name, `@`, non-negative integer major. */
const ID_PATTERN = /^[A-Za-z0-9_.:/-]+@\d+$/
/** Namespaced meta key grammar: at least one dot between non-empty parts. */
const META_KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Throws `DESCRIPTOR_INVALID` with the problem message. */
function invalid(message: string): never {
  throw createPartContractError(PartContractErrorCode.descriptorInvalid, message)
}

/** Splits `name@major` into its parts; callers have already validated the grammar. */
export function splitDescriptorId(id: string): { readonly name: string; readonly major: number } {
  /** Position of the major separator. */
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), major: Number(id.slice(at + 1)) }
}

/** True when a string has the `name@major` form. */
export function isDescriptorId(id: string): boolean {
  return ID_PATTERN.test(id)
}

/**
 * Validates a descriptor's common fields and returns it unchanged. Extension kinds come only from
 * the caller's table, so two hosts in one realm never share kind state.
 */
export function validateDescriptor(
  descriptor: unknown,
  options?: { readonly kinds?: ReadonlyMap<string, IKindSchema> }
): IDescriptor {
  if (
    !isRecord(descriptor) ||
    typeof descriptor.kind !== 'string' ||
    typeof descriptor.id !== 'string'
  )
    invalid(PartContractErrorText.descriptorShape)
  if (!ID_PATTERN.test(descriptor.id)) invalid(PartContractErrorText.descriptorId(descriptor.id))
  /** Extension kind schema, when the kind is not built in. */
  const extension = BUILTIN_KINDS.has(descriptor.kind)
    ? undefined
    : options?.kinds?.get(descriptor.kind)
  if (!BUILTIN_KINDS.has(descriptor.kind) && extension === undefined)
    invalid(PartContractErrorText.descriptorKind(descriptor.kind))
  for (const field of extension?.required ?? [])
    if (descriptor[field] === undefined) invalid(PartContractErrorText.descriptorShape)
  if (descriptor.meta !== undefined) {
    if (!isRecord(descriptor.meta)) invalid(PartContractErrorText.descriptorShape)
    for (const key of Object.keys(descriptor.meta))
      if (!META_KEY_PATTERN.test(key)) invalid(PartContractErrorText.descriptorMeta(key))
  }
  return descriptor as unknown as IDescriptor
}
