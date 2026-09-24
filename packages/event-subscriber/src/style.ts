import { EventSubscriberErrorCode } from './error-code.js'
import { createEventTypeError, eventErrorText } from './errors.js'
import { isRecord } from './internal/record.js'

/** Stable preset names shared by Channel and Hub style projections. */
export const EventApiStyle = {
  subscribePublish: 'subscribe-publish',
  onEmit: 'on-emit',
  onTrigger: 'on-trigger',
  listenFire: 'listen-fire'
} as const

export type EventApiStyle = (typeof EventApiStyle)[keyof typeof EventApiStyle]

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
    subscribe: 'subscribe',
    publish: 'publish',
    unsubscribe: 'unsubscribe'
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
  'subscribe',
  'subscribeOnce',
  'subscribeUntil',
  'publish',
  'unsubscribe',
  'filterTaskId',
  'clear',
  'size',
  '__proto__',
  'prototype',
  'constructor'
])

export type IEventApiStyleNames<
  TSubscribe extends string = string,
  TPublish extends string = string,
  TUnsubscribe extends string = string
> = {
  readonly subscribe: TSubscribe
  readonly publish: TPublish
  readonly unsubscribe?: TUnsubscribe
}

export type IEventApiStyle = EventApiStyle | IEventApiStyleNames

type IEventApiForbiddenSubscribeName = Exclude<IEventApiReservedName, 'subscribe'>
type IEventApiForbiddenPublishName = Exclude<IEventApiReservedName, 'publish'>
type IEventApiForbiddenUnsubscribeName = Exclude<IEventApiReservedName, 'unsubscribe'>

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
  readonly subscribe: TSubscribe
  readonly publish: TPublish
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

/** Returns the input identity while preserving literal names for predeclared style objects. */
export const defineEventApiStyle = <const S extends IEventApiStyleNames>(style: S): S => style

/** Resolves a public style value and rejects collisions before a surface can escape. */
export const normalizeEventApiStyle = (value: unknown): IEventApiStylePlan => {
  if (value === undefined)
    return Object.freeze({ ...eventApiStyleNames[EventApiStyle.subscribePublish] })
  if (typeof value === 'string') {
    if (hasEventApiStylePreset(value)) return Object.freeze({ ...eventApiStyleNames[value] })
  } else if (isRecord(value)) {
    const subscribe = value.subscribe
    const publish = value.publish
    const unsubscribe = value.unsubscribe
    const validatedSubscribe = validateStyleName(subscribe)
    const validatedPublish = validateStyleName(publish)
    const validatedUnsubscribe = validateStyleName(
      unsubscribe === undefined ? 'unsubscribe' : unsubscribe
    )
    if (
      validatedSubscribe === validatedPublish ||
      validatedSubscribe === validatedUnsubscribe ||
      validatedPublish === validatedUnsubscribe
    )
      throw invalidStyle()
    if (isReservedForOtherMethod(validatedSubscribe, 'subscribe')) throw invalidStyle()
    if (isReservedForOtherMethod(validatedPublish, 'publish')) throw invalidStyle()
    if (isReservedForOtherMethod(validatedUnsubscribe, 'unsubscribe')) throw invalidStyle()
    return Object.freeze({
      subscribe: validatedSubscribe,
      publish: validatedPublish,
      unsubscribe: validatedUnsubscribe
    })
  }
  throw invalidStyle()
}

/** Builds only non-canonical alias descriptors; canonical members remain the original methods. */
export const projectEventApiStyle = <T extends object>(surface: T, plan: IEventApiStylePlan): T => {
  const descriptors: PropertyDescriptorMap = {}
  const aliasNames = [plan.subscribe, plan.publish].filter(
    (name, index, names) =>
      name !== (index === 0 ? 'subscribe' : 'publish') && names.indexOf(name) === index
  )
  if (!Object.isExtensible(surface)) throw invalidStyle()
  for (const name of aliasNames) {
    const existing = Object.getOwnPropertyDescriptor(surface, name)
    if (existing && !existing.configurable) throw invalidStyle()
  }
  if (plan.subscribe !== 'subscribe')
    descriptors[plan.subscribe] = {
      configurable: false,
      enumerable: false,
      value: (surface as Record<string, unknown>).subscribe,
      writable: false
    }
  if (plan.publish !== 'publish')
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
  if (typeof value !== 'string' || value.length === 0) throw invalidStyle()
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

/** Creates the package-owned native error used for every invalid style boundary. */
const invalidStyle = (): TypeError =>
  createEventTypeError(
    EventSubscriberErrorCode.invalidOptions,
    eventErrorText(EventSubscriberErrorCode.invalidOptions)
  )
