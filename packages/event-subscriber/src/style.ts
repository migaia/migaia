/**
 * Owns naming presets, literal type projections, and immutable alias installation; no dispatch
 * state lives here.
 */
import { createInvalidOptionsError } from './internal/channel-options.ts'
import { isRecord } from './internal/record.ts'

/** Canonical method names shared by style projection and callable subscription ownership. */
export const EventApiMethod = {
  /** Registration method preserved on every channel, Hub, and chain handle. */
  subscribe: 'subscribe',
  /** Publication method preserved on every source surface. */
  publish: 'publish',
  /** Callable handle self-alias preserved for every chain. */
  unsubscribe: 'unsubscribe'
} as const

/**
 * Naming presets for Channel and Hub. Aliases reference canonical methods without adding another
 * dispatcher; omit style or select subscribe-publish to keep only the default surface.
 */
export const EventApiStyle = {
  /** Default subscribe/publish/unsubscribe names, with no extra alias properties. */
  subscribePublish: 'subscribe-publish',
  /** Adds on/emit on the event source and on/off on its subscription handles. */
  onEmit: 'on-emit',
  /** Adds on/trigger on the event source and on/off on its subscription handles. */
  onTrigger: 'on-trigger',
  /** Adds listen/fire on the event source and listen/unlisten on its handles. */
  listenFire: 'listen-fire'
} as const

/** Supported built-in naming preset values; runtime constants and type share the same name. */
export type EventApiStyle = (typeof EventApiStyle)[keyof typeof EventApiStyle]

/** Method names a style may not reuse, because the channel or Hub already uses them. */
type IEventApiReservedName =
  | 'subscribe'
  | 'subscribeOnce'
  | 'subscribeUntil'
  | 'publish'
  | 'unsubscribe'
  | 'filterTaskId'
  | 'clear'
  | 'size'
  | '__proto__'
  | 'prototype'
  | 'constructor'

/** Maps each preset to its semantic method names without introducing a second runtime owner. */
const eventApiStyleNames = {
  [EventApiStyle.subscribePublish]: {
    subscribe: EventApiMethod.subscribe,
    publish: EventApiMethod.publish,
    unsubscribe: EventApiMethod.unsubscribe
  },
  [EventApiStyle.onEmit]: { subscribe: 'on', publish: 'emit', unsubscribe: 'off' },
  [EventApiStyle.onTrigger]: { subscribe: 'on', publish: 'trigger', unsubscribe: 'off' },
  [EventApiStyle.listenFire]: { subscribe: 'listen', publish: 'fire', unsubscribe: 'unlisten' }
} as const

/** Own-key lookup prevents inherited Object prototype names from becoming presets. */
const hasEventApiStylePreset = (value: string): value is EventApiStyle =>
  Object.hasOwn(eventApiStyleNames, value)

/** Names reserved by either canonical surface or by JavaScript prototype hazards. */
const eventApiReservedNames = new Set<IEventApiReservedName>([
  EventApiMethod.subscribe,
  'subscribeOnce',
  'subscribeUntil',
  EventApiMethod.publish,
  EventApiMethod.unsubscribe,
  'filterTaskId',
  'clear',
  'size',
  '__proto__',
  'prototype',
  'constructor'
])

/**
 * Custom names for the same subscribe/publish/unsubscribe operations. Names must be nonempty,
 * distinct, and cannot shadow other canonical operations or prototype keys. Invalid names throw
 * INVALID_OPTIONS during construction. Preserve literal names for precise alias type inference.
 */
export type IEventApiStyleNames<
  TSubscribe extends string = string,
  TPublish extends string = string,
  TUnsubscribe extends string = string
> = {
  /** Required subscription alias on the event source and on every chain handle. */
  readonly subscribe: TSubscribe
  /** Required publication alias on the event source. */
  readonly publish: TPublish
  /** Handle cancellation alias; defaults to the canonical unsubscribe name when omitted. */
  readonly unsubscribe?: TUnsubscribe
}

/** Built-in naming preset or custom operation names; neither changes event dispatch semantics. */
export type IEventApiStyle = EventApiStyle | IEventApiStyleNames

/** Names a custom subscribe alias may not take. */
type IEventApiForbiddenSubscribeName = Exclude<IEventApiReservedName, 'subscribe'>
/** Names a custom publish alias may not take. */
type IEventApiForbiddenPublishName = Exclude<IEventApiReservedName, 'publish'>
/** Names a custom unsubscribe alias may not take. */
type IEventApiForbiddenUnsubscribeName = Exclude<IEventApiReservedName, 'unsubscribe'>

/** Rejects known invalid literal styles while retaining runtime validation for wider string names. */
export type IEventApiStyleOption<S extends IEventApiStyle | undefined> = S extends undefined
  ? undefined
  : S extends EventApiStyle
    ? S
    : S extends IEventApiStyleNames<infer TSubscribe, infer TPublish>
      ? string extends TSubscribe | TPublish
        ? S
        : '' extends TSubscribe | TPublish
          ? never
          : Extract<TSubscribe, IEventApiForbiddenSubscribeName> extends never
            ? Extract<TPublish, IEventApiForbiddenPublishName> extends never
              ? IEventApiStyleNamesAreDistinct<
                  TSubscribe,
                  TPublish,
                  IEventApiStyleCancellationName<S>
                > extends true
                ? Extract<
                    IEventApiStyleCancellationName<S>,
                    IEventApiForbiddenUnsubscribeName
                  > extends never
                  ? S
                  : never
                : never
              : never
            : never
      : never

/**
 * Resolves literal style names for type projections; wider custom strings cannot produce precise
 * aliases.
 */
export type IEventApiStyleMethodNames<S extends IEventApiStyle | undefined> =
  S extends EventApiStyle
    ? (typeof eventApiStyleNames)[S]
    : S extends IEventApiStyleNames<infer TSubscribe, infer TPublish>
      ? string extends TSubscribe | TPublish
        ? never
        : IEventApiStyleResolvedNames<TSubscribe, TPublish, IEventApiStyleCancellationName<S>>
      : never

/** The normalized immutable plan consumed once during surface construction. */
export type IEventApiStylePlan = Readonly<IEventApiStyleResolvedNames<string, string, string>>

/** The required shape after optional custom cancellation naming is resolved. */
type IEventApiStyleResolvedNames<
  TSubscribe extends string,
  TPublish extends string,
  TUnsubscribe extends string
> = {
  /** Name of the subscribe method, or its alias. */
  readonly subscribe: TSubscribe
  /** Name of the publish method, or its alias. */
  readonly publish: TPublish
  /** Name of the unsubscribe member of subscription handles, or its alias. */
  readonly unsubscribe: TUnsubscribe
}

/** Falls back to canonical cancellation when a legacy two-field style omits it. */
type IEventApiStyleCancellationName<S> = S extends {
  readonly unsubscribe: infer TUnsubscribe extends string
}
  ? TUnsubscribe
  : 'unsubscribe'

/** Checks semantic names without rejecting legacy two-field custom styles. */
type IEventApiStyleNamesAreDistinct<
  TSubscribe extends string,
  TPublish extends string,
  TUnsubscribe extends string
> = TSubscribe extends TPublish | TUnsubscribe
  ? false
  : TPublish extends TUnsubscribe
    ? false
    : true

/** Resolves a public style value and rejects collisions before a surface can escape. */
export const normalizeEventApiStyle = (value: unknown): IEventApiStylePlan => {
  if (value === undefined)
    return Object.freeze({ ...eventApiStyleNames[EventApiStyle.subscribePublish] })
  if (typeof value === 'string') {
    if (hasEventApiStylePreset(value)) return Object.freeze({ ...eventApiStyleNames[value] })
  } else if (isRecord(value)) {
    /** Raw subscribe alias, read once. */
    const subscribe = value.subscribe
    /** Raw publish alias, read once. */
    const publish = value.publish
    /** Raw unsubscribe alias, read once. */
    const unsubscribe = value.unsubscribe
    /** Subscribe alias after validation. */
    const validatedSubscribe = validateStyleName(subscribe)
    /** Publish alias after validation. */
    const validatedPublish = validateStyleName(publish)
    /** Unsubscribe alias after validation; defaults to `unsubscribe`. */
    const validatedUnsubscribe = validateStyleName(
      unsubscribe === undefined ? EventApiMethod.unsubscribe : unsubscribe
    )
    if (
      validatedSubscribe === validatedPublish ||
      validatedSubscribe === validatedUnsubscribe ||
      validatedPublish === validatedUnsubscribe
    )
      throw createInvalidOptionsError()
    if (isReservedForOtherMethod(validatedSubscribe, EventApiMethod.subscribe))
      throw createInvalidOptionsError()
    if (isReservedForOtherMethod(validatedPublish, EventApiMethod.publish))
      throw createInvalidOptionsError()
    if (isReservedForOtherMethod(validatedUnsubscribe, EventApiMethod.unsubscribe))
      throw createInvalidOptionsError()
    return Object.freeze({
      subscribe: validatedSubscribe,
      publish: validatedPublish,
      unsubscribe: validatedUnsubscribe
    })
  }
  throw createInvalidOptionsError()
}

/** Reads a source's style once and preserves the construction boundary's original cause wrapping. */
export function readEventApiStyle(options: { readonly style?: unknown }): IEventApiStylePlan {
  try {
    return normalizeEventApiStyle(options.style)
  } catch (error) {
    throw createInvalidOptionsError(error)
  }
}

/** Builds only non-canonical alias descriptors; canonical members remain the original methods. */
export const projectEventApiStyle = <T extends object>(surface: T, plan: IEventApiStylePlan): T => {
  /** Alias descriptors to define on the surface. */
  const descriptors: PropertyDescriptorMap = {}
  if (!Object.isExtensible(surface)) throw createInvalidOptionsError()
  // Exactly two source operations exist: subscribe and publish in EventApiMethod.
  if (plan.subscribe !== EventApiMethod.subscribe) validateAliasProperty(surface, plan.subscribe)
  if (plan.publish !== EventApiMethod.publish && plan.publish !== plan.subscribe)
    validateAliasProperty(surface, plan.publish)
  if (plan.subscribe !== EventApiMethod.subscribe)
    descriptors[plan.subscribe] = {
      configurable: false,
      enumerable: false,
      value: (surface as Record<string, unknown>).subscribe,
      writable: false
    }
  if (plan.publish !== EventApiMethod.publish)
    descriptors[plan.publish] = {
      configurable: false,
      enumerable: false,
      value: (surface as Record<string, unknown>).publish,
      writable: false
    }
  Object.defineProperties(surface, descriptors)
  return surface
}

/** Validates one semantic method name before it enters a descriptor plan. */
const validateStyleName = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) throw createInvalidOptionsError()
  return value
}

/** Rejects public members that would shadow a canonical operation or prototype escape hatch. */
const isReservedForOtherMethod = (
  value: string,
  semantic: 'subscribe' | 'publish' | 'unsubscribe'
): boolean => {
  if (value === semantic) return false
  return eventApiReservedNames.has(value as IEventApiReservedName)
}

/** Rejects an immutable existing alias before descriptor installation mutates the source. */
function validateAliasProperty(surface: object, name: string): void {
  /** Existing descriptor is inspected once; configurable aliases may be replaced atomically. */
  const existing = Object.getOwnPropertyDescriptor(surface, name)
  if (existing && !existing.configurable) throw createInvalidOptionsError()
}
