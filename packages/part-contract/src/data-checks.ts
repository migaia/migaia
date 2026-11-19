/** Structural checks of data-layer descriptor fields: model bodies, resource and field groups. */
import { isDescriptorId } from './descriptor-id.ts'
import { DOM_EVENTS } from './doctor/tables.ts'
import { FieldRead, ModelFieldFormat } from './data.ts'
import { PartContractErrorCode } from './error-code.ts'
import { DataInvalidReason, PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import { isRecord } from './record.ts'

/** Allowed field read modes; three fixed values. */
const FIELD_READS: ReadonlySet<string> = new Set(Object.values(FieldRead))
/** Allowed display formats; seven fixed values. */
const FORMATS: ReadonlySet<string> = new Set(Object.values(ModelFieldFormat))
/** Status keys a resource group may map to slots; three fixed values. */
const STATUS_SLOT_KEYS: ReadonlySet<string> = new Set(['loading', 'empty', 'error'])

/** Throws `DESCRIPTOR_INVALID` for a model. */
function modelInvalid(id: string, reason: string): never {
  throw createPartContractError(
    PartContractErrorCode.descriptorInvalid,
    PartContractErrorText.modelInvalid(id, reason)
  )
}

/** Throws `DESCRIPTOR_INVALID` for a part's data behaviour group. */
function behaviorInvalid(id: string, reason: string): never {
  throw createPartContractError(
    PartContractErrorCode.descriptorInvalid,
    PartContractErrorText.behaviorInvalid(id, reason)
  )
}

/** True for an array of strings that are all property names of the schema. */
function fieldsOf(value: unknown, properties: Record<string, unknown>): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((field) => typeof field === 'string' && Object.hasOwn(properties, field))
  )
}

/** Checks one display hint record. */
function checkDisplay(id: string, display: unknown, properties: Record<string, unknown>): void {
  if (display === undefined) return
  if (!isRecord(display)) modelInvalid(id, DataInvalidReason.modelDisplay)
  for (const [field, hint] of Object.entries(display))
    if (
      !Object.hasOwn(properties, field) ||
      !isRecord(hint) ||
      (hint.format !== undefined && !FORMATS.has(String(hint.format))) ||
      (hint.label !== undefined && typeof hint.label !== 'string') ||
      (hint.enumLabels !== undefined && !isRecord(hint.enumLabels))
    )
      modelInvalid(id, DataInvalidReason.modelDisplay)
}

/** Checks one relation record. */
function checkRelations(id: string, relations: unknown, properties: Record<string, unknown>): void {
  if (relations === undefined) return
  if (!isRecord(relations)) modelInvalid(id, DataInvalidReason.modelRelation)
  for (const relation of Object.values(relations))
    if (
      !isRecord(relation) ||
      typeof relation.target !== 'string' ||
      !isDescriptorId(relation.target) ||
      (relation.cardinality !== 'one' && relation.cardinality !== 'many') ||
      !fieldsOf(relation.via, properties)
    )
      modelInvalid(id, DataInvalidReason.modelRelation)
}

/**
 * Checks a `model` descriptor body: an object schema with properties, a non-empty key of schema
 * fields, display hints and relations naming schema fields.
 */
export function checkModelBody(descriptor: Record<string, unknown>): void {
  /** Descriptor id for messages. */
  const id = String(descriptor.id)
  /** Model body. */
  const body = descriptor.model
  if (!isRecord(body) || !isRecord(body.schema)) modelInvalid(id, DataInvalidReason.modelSchema)
  /** Declared properties of the schema. */
  const properties = body.schema.properties
  if (body.schema.type !== 'object' || !isRecord(properties))
    modelInvalid(id, DataInvalidReason.modelSchema)
  if (!fieldsOf(body.key, properties)) modelInvalid(id, DataInvalidReason.modelKey)
  checkDisplay(id, body.display, properties)
  checkRelations(id, body.relations, properties)
}

/** Checks `behavior.resource`: a prop name and status slots that are declared on the part. */
function checkResourceBehavior(id: string, group: unknown, slots: unknown): void {
  if (!isRecord(group) || typeof group.prop !== 'string' || group.prop === '')
    behaviorInvalid(id, DataInvalidReason.resource)
  if (group.slots === undefined) return
  if (!isRecord(group.slots)) behaviorInvalid(id, DataInvalidReason.resource)
  for (const [status, slot] of Object.entries(group.slots))
    if (
      !STATUS_SLOT_KEYS.has(status) ||
      typeof slot !== 'string' ||
      !isRecord(slots) ||
      !Object.hasOwn(slots, slot)
    )
      behaviorInvalid(id, DataInvalidReason.resource)
}

/** Checks `behavior.field`: value prop, a change event that is declared or a DOM event, read mode. */
function checkFieldBehavior(id: string, group: unknown, events: unknown): void {
  if (
    !isRecord(group) ||
    typeof group.value !== 'string' ||
    group.value === '' ||
    typeof group.change !== 'string' ||
    (group.read !== undefined && !FIELD_READS.has(String(group.read)))
  )
    behaviorInvalid(id, DataInvalidReason.field)
  /** Whether the part declares the change event. */
  const declared = isRecord(events) && Object.hasOwn(events, group.change)
  if (!declared && !DOM_EVENTS.has(group.change)) behaviorInvalid(id, DataInvalidReason.field)
}

/** Checks the data behaviour groups of a part descriptor when present. */
export function checkDataBehavior(descriptor: Record<string, unknown>): void {
  /** Behaviour groups of the part. */
  const behavior = descriptor.behavior
  if (!isRecord(behavior)) return
  /** Descriptor id for messages. */
  const id = String(descriptor.id)
  if (behavior.resource !== undefined)
    checkResourceBehavior(id, behavior.resource, descriptor.slots)
  if (behavior.field !== undefined) checkFieldBehavior(id, behavior.field, descriptor.events)
}
