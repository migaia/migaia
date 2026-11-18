import { isValidName } from './address.ts'
import { isRecord } from './record.ts'
import { eventKeyProblem, isModifierRef } from './event-key.ts'
import { PartContractErrorCode } from './error-code.ts'
import { PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import type { IBlueprint, IPartNode } from './types.ts'

/** Throws `BLUEPRINT_INVALID` with the structural problem as cause. */
function invalid(problem: string): never {
  throw createPartContractError(
    PartContractErrorCode.blueprintInvalid,
    PartContractErrorText.blueprintShape,
    new TypeError(problem)
  )
}

/** Validates the events record of a node: shorthand keys and modifier references. */
function checkEvents(events: unknown, path: string): void {
  if (events === undefined) return
  if (!isRecord(events)) invalid(PartContractErrorText.nodeShape(path))
  for (const [key, subscription] of Object.entries(events)) {
    /** Malformed shorthand segment, if any. */
    const problem = eventKeyProblem(key)
    if (problem !== undefined) invalid(PartContractErrorText.eventKey(key, problem))
    if (!isRecord(subscription)) invalid(PartContractErrorText.nodeShape(`${path}/${key}`))
    /** Explicit modifier references. */
    const modifiers = subscription.modifiers
    if (modifiers === undefined) continue
    if (!Array.isArray(modifiers)) invalid(PartContractErrorText.modifierRef(`${path}/${key}`))
    modifiers.forEach((ref, position) => {
      if (!isModifierRef(ref))
        invalid(PartContractErrorText.modifierRef(`${path}/${key}/modifiers/${position}`))
    })
  }
}

/** Validates one node and its subtree; recursion depth equals tree depth. */
function checkNode(value: unknown, path: string): void {
  if (!isRecord(value) || typeof value.tag !== 'string' || value.tag === '')
    invalid(PartContractErrorText.nodeShape(path))
  if (value.id !== undefined && (typeof value.id !== 'string' || !isValidName(value.id)))
    invalid(PartContractErrorText.nameInvalid(String(value.id)))
  if (value.facets !== undefined && !isRecord(value.facets))
    invalid(PartContractErrorText.nodeShape(path))
  if (isRecord(value.facets)) checkEvents(value.facets.events, `${path}/facets/events`)
  /** Slot map of the node, if any. */
  const slots = isRecord(value.facets) ? value.facets.slots : undefined
  if (slots !== undefined) {
    if (!isRecord(slots)) invalid(PartContractErrorText.nodeShape(path))
    for (const [name, members] of Object.entries(slots)) {
      if (!isValidName(name)) invalid(PartContractErrorText.nameInvalid(name))
      if (!Array.isArray(members))
        invalid(PartContractErrorText.nodeShape(`${path}/facets/slots/${name}`))
      members.forEach((member, position) =>
        checkNode(member, `${path}/facets/slots/${name}/${position}`)
      )
    }
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) invalid(PartContractErrorText.nodeShape(path))
    value.children.forEach((child, position) => checkNode(child, `${path}/children/${position}`))
  }
  if (value.template !== undefined) {
    if (!isRecord(value.template) || typeof value.template.rowKey !== 'string')
      invalid(PartContractErrorText.nodeShape(`${path}/template`))
    checkNode(value.template.node, `${path}/template/node`)
  }
}

/** Freezes a validated plain value tree so rules and enhancers cannot mutate it in place. */
function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
}

/**
 * Validates and freezes a blueprint document. Throws `BLUEPRINT_INVALID` with the first structural
 * problem on `cause`; the returned blueprint is the same object, deeply frozen.
 */
export function parseBlueprint(input: unknown): IBlueprint {
  if (
    !isRecord(input) ||
    typeof input.id !== 'string' ||
    input.id === '' ||
    !Number.isInteger(input.version)
  )
    invalid(PartContractErrorText.blueprintShape)
  checkNode(input.root, '/root')
  deepFreeze(input)
  return input as unknown as IBlueprint
}

/** Narrows an unknown node value; used by consumers that walk nodes they did not parse. */
export function isPartNode(value: unknown): value is IPartNode {
  return isRecord(value) && typeof value.tag === 'string'
}
