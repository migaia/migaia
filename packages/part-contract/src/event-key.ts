import { isDescriptorId } from './descriptor.ts'
import type { IEventSubscription, IModifierRef } from './types.ts'

/**
 * Key segments that set a native listener option or `native` instead of naming a modifier. The set
 * has a fixed size of four, so membership checks are constant time.
 */
const OPTION_SEGMENTS: ReadonlySet<string> = new Set(['once', 'capture', 'passive', 'native'])
/** Grammar of one modifier segment in a shorthand key: a name with an optional `@major`. */
const MODIFIER_SEGMENT = /^[A-Za-z0-9_-]+(@\d+)?$/
/** Major used when a shorthand segment omits `@major`. */
const DEFAULT_MAJOR = '@1'

/** One subscription of an events record, normalized from its key. */
export type IEventEntry = {
  /** The record key as authored, for example `click.once.outside`; dispatch uses it. */
  readonly key: string
  /** The event name, the key's first segment. */
  readonly name: string
  /** Subscription with key options merged and key modifiers placed before explicit ones. */
  readonly subscription: IEventSubscription
}

/** Splits a key into the event name and its shorthand segments. */
function splitKey(key: string): { readonly name: string; readonly segments: readonly string[] } {
  /** Dot-separated parts; event names never contain dots. */
  const parts = key.split('.')
  return { name: parts[0] as string, segments: parts.slice(1) }
}

/** Expands a shorthand modifier segment to a full id. */
function segmentId(segment: string): string {
  return segment.includes('@') ? segment : `${segment}${DEFAULT_MAJOR}`
}

/**
 * Returns the problem with a shorthand key, or `undefined` when it is well formed: every segment
 * after the name is an option word or a modifier name with an optional `@major`.
 */
export function eventKeyProblem(key: string): string | undefined {
  /** Name and segments. */
  const { name, segments } = splitKey(key)
  if (name === '') return key
  for (const segment of segments)
    if (!OPTION_SEGMENTS.has(segment) && !MODIFIER_SEGMENT.test(segment)) return segment
  return undefined
}

/** True when a modifier reference has a valid `name@major` id. */
export function isModifierRef(value: unknown): value is IModifierRef {
  if (typeof value === 'string') return isDescriptorId(value)
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    isDescriptorId((value as { id: string }).id)
  )
}

/** Id of a modifier reference. */
export function modifierId(ref: IModifierRef): string {
  return typeof ref === 'string' ? ref : ref.id
}

/** Arguments of a modifier reference; the string form has none. */
export function modifierArgs(ref: IModifierRef): unknown {
  return typeof ref === 'string' ? undefined : ref.args
}

/** Normalizes one events record entry: options from the key are OR-ed with the authored fields. */
export function normalizeEventEntry(key: string, subscription: IEventSubscription): IEventEntry {
  /** Name and segments of the key. */
  const { name, segments } = splitKey(key)
  if (segments.length === 0) return { key, name, subscription }
  /** Modifier refs written in the key, in key order. */
  const keyModifiers: IModifierRef[] = []
  /** Options written in the key. */
  const options: Record<string, true> = {}
  for (const segment of segments)
    if (OPTION_SEGMENTS.has(segment)) options[segment] = true
    else keyModifiers.push(segmentId(segment))
  return {
    key,
    name,
    subscription: {
      ...subscription,
      ...options,
      modifiers: [...keyModifiers, ...(subscription.modifiers ?? [])]
    }
  }
}

/** Normalized entries of an events record in authored key order. */
export function eventEntries(
  events: Readonly<Record<string, IEventSubscription>> | undefined
): readonly IEventEntry[] {
  /** Entries in key order. */
  const entries: IEventEntry[] = []
  for (const [key, subscription] of Object.entries(events ?? {}))
    entries.push(normalizeEventEntry(key, subscription))
  return entries
}
