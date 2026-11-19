import { PartContractErrorCode } from './error-code.ts'
import { isRecord } from './record.ts'
import { PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import { checkLayoutBehavior } from './layout.ts'
import { checkDataBehavior, checkModelBody } from './data-checks.ts'
import { isDescriptorId } from './descriptor-id.ts'
import type { IDescriptor, IKindSchema } from './types.ts'

/** Built-in kinds; this list has a fixed size of nine, so membership checks are constant time. */
const BUILTIN_KINDS: ReadonlySet<string> = new Set([
  'part',
  'enhancer',
  'derive',
  'resource',
  'effect',
  'rule',
  'modifier',
  'fragment',
  'model'
])
/** Event kinds a modifier may name; fixed size two. */
const MODIFIER_EVENT_KINDS: ReadonlySet<string> = new Set(['dom', 'custom'])
/** Namespaced meta key grammar: at least one dot between non-empty parts. */
const META_KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/

/** Throws `DESCRIPTOR_INVALID` with the problem message. */
function invalid(message: string): never {
  throw createPartContractError(PartContractErrorCode.descriptorInvalid, message)
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
  if (!isDescriptorId(descriptor.id)) invalid(PartContractErrorText.descriptorId(descriptor.id))
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
  if (descriptor.kind === 'modifier') checkModifier(descriptor)
  if (descriptor.kind === 'fragment') checkFragment(descriptor)
  if (
    descriptor.kind === 'part' &&
    isRecord(descriptor.behavior) &&
    descriptor.behavior.layout !== undefined
  )
    checkLayoutBehavior(descriptor.behavior.layout)
  if (descriptor.kind === 'part') checkDataBehavior(descriptor)
  if (descriptor.kind === 'model') checkModelBody(descriptor)
  return descriptor as unknown as IDescriptor
}

/** A modifier declares its event kinds and whether it moves the listener. */
function checkModifier(descriptor: Record<string, unknown>): void {
  /** Declared event kinds. */
  const kinds = descriptor.eventKinds
  if (
    !Array.isArray(kinds) ||
    kinds.length === 0 ||
    !kinds.every((kind) => MODIFIER_EVENT_KINDS.has(String(kind))) ||
    typeof descriptor.placement !== 'boolean'
  )
    invalid(PartContractErrorText.descriptorShape)
}

/** True for a `{ $param }` placeholder. */
function isParam(value: unknown): boolean {
  return isRecord(value) && typeof value.$param === 'string'
}

/** True for a `{ $slot }` placeholder. */
function isSlotPlaceholder(value: unknown): value is { readonly $slot: string } {
  return isRecord(value) && typeof value.$slot === 'string'
}

/**
 * Walks a fragment subtree: ids, tags and slot names must be literal, and each `{ $slot }` name
 * appears at most once. Recursion depth equals the subtree depth.
 */
function checkFragmentNode(id: string, node: unknown, seenSlots: Set<string>): void {
  if (!isRecord(node) || typeof node.tag !== 'string' || isParam(node.id) || isParam(node.tag))
    invalid(PartContractErrorText.fragmentBody(id))
  /** Facet slot groups of the node. */
  const slots = isRecord(node.facets) ? node.facets.slots : undefined
  if (isRecord(slots))
    for (const members of Object.values(slots))
      for (const member of Array.isArray(members) ? members : [])
        checkFragmentNode(id, member, seenSlots)
  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (!isSlotPlaceholder(child)) {
      checkFragmentNode(id, child, seenSlots)
      continue
    }
    if (seenSlots.has(child.$slot)) invalid(PartContractErrorText.fragmentBody(id))
    seenSlots.add(child.$slot)
  }
  if (isRecord(node.template)) checkFragmentNode(id, node.template.node, seenSlots)
}

/** A fragment carries a subtree whose placeholders keep addresses independent of parameters. */
function checkFragment(descriptor: Record<string, unknown>): void {
  /** Fragment body. */
  const body = descriptor.fragment
  /** Descriptor id for messages. */
  const id = String(descriptor.id)
  if (!isRecord(body)) invalid(PartContractErrorText.fragmentBody(id))
  checkFragmentNode(id, body.node, new Set())
}
