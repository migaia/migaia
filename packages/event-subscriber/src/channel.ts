/**
 * Constructs canonical channels with the public overload contract. Runtime state belongs to the
 * composed channel owner; focused helpers expose their own canonical implementations.
 */
import type {
  ICanonicalEventChannel,
  IEventChannelOptions,
  IStyledEventChannel,
  IStyledEventChannelOptions
} from './types.ts'
import type { IEventApiStyle } from './style.ts'
import type { IEventProjectionPlan } from './value-projection.ts'
import { CanonicalChannel } from './internal/channel-owner.ts'

/**
 * Creates a transient event channel for synchronous notifications or awaited invoke helpers. Each
 * publish takes a registration-ordered snapshot; adding, removing, or clearing registrations during
 * delivery changes future snapshots. Events are not stored or replayed.
 *
 * Defaults are recursive nested delivery, multiple independent registrations, handle-only removal,
 * a 100_000 listener-call budget per top-level publish, and throwOnAborted false. style defaults to
 * subscribe-publish; reporters and value projection are absent unless configured. Style aliases
 * share the canonical methods and do not create another dispatcher.
 *
 * Invalid construction options throw INVALID_OPTIONS or INVALID_REPORTER before admission.
 * Synchronous publish failures aggregate as PUBLISH_FAILED after other selected listeners run; late
 * listener rejections go to report and then terminal diagnostics rather than changing the
 * synchronous return. The publish budget can stop delivery with a partial-delivery PUBLISH_FAILED.
 */
export function createCanonicalChannel<
  T,
  R,
  const S extends IEventApiStyle | undefined,
  const V = undefined
>(
  options: S extends IEventApiStyle
    ? IStyledEventChannelOptions<T, S, V>
    : IEventChannelOptions<T, undefined, V>
): ICanonicalEventChannel<T, R, S, V> &
  (S extends IEventApiStyle ? IStyledEventChannel<T, R, S, V> : Record<never, never>)
/** Creates a channel with canonical method names and optional reporting, policies, and value alias. */
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: IEventChannelOptions<T, undefined, V>
): ICanonicalEventChannel<T, R, undefined, V>
/** Selects the canonical subscribe/publish/unsubscribe names without adding alias properties. */
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & {
    readonly style: 'subscribe-publish'
  }
): ICanonicalEventChannel<T, R>
/** Adds on/emit/off aliases while retaining canonical method identity and dispatch semantics. */
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & { readonly style: 'on-emit' }
): ICanonicalEventChannel<T, R, 'on-emit', V> & IStyledEventChannel<T, R, 'on-emit', V>
/** Adds on/trigger/off aliases while retaining canonical method identity and dispatch semantics. */
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & { readonly style: 'on-trigger' }
): ICanonicalEventChannel<T, R, 'on-trigger', V> & IStyledEventChannel<T, R, 'on-trigger', V>
/**
 * Adds listen/fire/unlisten aliases while retaining canonical method identity and dispatch
 * semantics.
 */
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & { readonly style: 'listen-fire' }
): ICanonicalEventChannel<T, R, 'listen-fire', V> & IStyledEventChannel<T, R, 'listen-fire', V>
/** Creates a default channel when options are omitted; invalid supplied options throw before use. */
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options?: IEventChannelOptions<T, undefined, V>
): ICanonicalEventChannel<T, R, undefined, V>
/**
 * Implementation shared by the overloads above. Internal callers may pass an already validated
 * projection plan as the second argument.
 */
export function createCanonicalChannel<T, R = void, V = undefined>(
  options: IEventChannelOptions<T, IEventApiStyle | undefined, V> = {},
  suppliedProjectionPlan?: IEventProjectionPlan
): ICanonicalEventChannel<T, R, undefined, V> {
  return new CanonicalChannel<T, R, V>(options, suppliedProjectionPlan).channel
}

/**
 * Internal Hub injection boundary over the same factory identity, without a runtime wrapper. Public
 * overloads accept only options; the Hub alone reuses its already-admitted projection plan.
 */
export const createChannelWithProjection = createCanonicalChannel as <T, R = void, V = undefined>(
  options: IEventChannelOptions<T, IEventApiStyle | undefined, V>,
  projectionPlan: IEventProjectionPlan
) => ICanonicalEventChannel<T, R, undefined, V>
