import type { IAbortSignal } from '@migaia/utils/promise'
import { EventSubscriberErrorCode } from './error-code.js'
import {
  MAX_NATIVE_RECURSION_DEPTH,
  inspectThenable,
  observeThenableRejection
} from '@migaia/utils/function'
import { admitAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import {
  attachEventErrorCode,
  codeExistingError,
  createEventAggregateError,
  createEventTypeError,
  eventErrorText
} from './errors.js'
import type {
  ICanonicalEventChannel,
  IEventChannelLike,
  IEventChannelOptions,
  IEventContext,
  IEventDispatchControl,
  IEventDispatchSnapshot,
  IEventInvocation,
  IEventInvocationVisitor,
  IEventListener,
  IEventSubscribeOptions,
  IEventValueListener,
  IFilteredEventChannel,
  IUnsubscribe,
  IStyledEventChannel,
  IStyledEventChannelOptions
} from './types.js'
import { createRawSubscriptionOwner, installSubscriptionSource } from './internal/subscription.js'
import { isRecord } from './internal/record.js'
import {
  EventAdmissionPolicy,
  EventDelivery,
  EventDispatchPolicy,
  EventRemovalPolicy,
  EventSubscriberState
} from './state-constants.js'
import {
  normalizeEventApiStyle,
  projectEventApiStyle,
  type IEventApiStyle,
  type IEventApiStylePlan
} from './style.js'
import {
  createSystemTerminalRuntime,
  reportTerminalDiagnostic
} from './internal/terminal-runtime.js'
import {
  addEventProjection,
  copyEventProjection,
  createEventValueProjectionPlan,
  projectEventValue,
  reportEventProjectionFailure,
  type IEventProjectionOutcome,
  type IEventProjectionPlan
} from './value-projection.js'

/** Internal record of one registration, linked into the channel's ordered owner list. */
type IRegistrationOwner<T, R, V> = {
  listener: IEventListener<T, R, V> | IEventValueListener<T, R>
  /** Fixed argument mode owned by this registration and copied into every dispatch snapshot. */
  delivery: EventDelivery
  active: boolean
  aborted: boolean
  abortReason: unknown
  currentTaskId: string | undefined
  previous: IRegistrationOwner<T, R, V> | undefined
  next: IRegistrationOwner<T, R, V> | undefined
  release: IUnsubscribe
  committed: boolean
  /** Live abort/task control created once per registration and shared by every dispatch snapshot. */
  control: IEventDispatchControl
}

/**
 * Package-internal operations of one channel, kept off the public object and looked up through a
 * WeakMap by the helpers.
 */
type IChannelCapability<T, R, V = undefined> = {
  snapshot(taskId?: string): readonly IEventDispatchSnapshot<T, R, V>[]
  project(value: T): IEventProjectionOutcome
  readonly plan: IEventProjectionPlan | undefined
  readonly options: IEventChannelOptions<T, IEventApiStyle | undefined, V>
  liveVisit(
    value: T,
    taskId: string | undefined,
    visitor: (invocation: IEventInvocation<R>) => void
  ): void
}

/** Internal record of a task-filter view: the source channel and the task name it selects. */
type IFilteredCapability<T, R, V = undefined> = {
  readonly channel: ICanonicalEventChannel<T, R, undefined, V>
  readonly taskId: string
}

/** Structural channel after validation: `subscribe` is known to be callable. */
type IValidatedChannel<T, R, V = undefined> = IEventChannelLike<T, R, V> & {
  readonly subscribe: IEventChannelLike<T, R, V>['subscribe']
}

/** Runtime identity for canonical channels; structural lookalikes never enter async helpers. */
const channelCapabilities = new WeakMap<object, IChannelCapability<unknown, unknown, unknown>>()

/** Runtime identity for filtered views; the public object carries no mutable channel state. */
const filteredCapabilities = new WeakMap<object, IFilteredCapability<unknown, unknown, unknown>>()

/** The host adapter is lazy and does not inspect globals until a terminal failure occurs. */
const systemTerminalRuntime = createSystemTerminalRuntime()

/** Validates a task label before it can enter a registration or selection index. */
export const validateTaskId = (value: unknown, allowUndefined: boolean): string | undefined => {
  if (value === undefined && allowUndefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidTaskId,
      eventErrorText(EventSubscriberErrorCode.invalidTaskId)
    )
  }
  return value
}

/** Validates a listener option record and reads taskId once. */
const readTaskOption = (options: unknown): string | undefined => {
  if (options === undefined) return undefined
  try {
    if (!isRecord(options)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    }
    return validateTaskId(options.taskId, true)
  } catch (error) {
    /** Whether the failure came from task-name validation, which keeps its own code. */
    let isTaskIdError = false
    try {
      isTaskIdError =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        (error as { readonly code?: unknown }).code === EventSubscriberErrorCode.invalidTaskId
    } catch {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
    }
    if (isTaskIdError) throw error
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
}

/** Reads the listener argument mode once, preserving existing options-error identity and coding. */
export const readDeliveryOption = (options: unknown): EventDelivery => {
  if (options === undefined) return EventDelivery.context
  try {
    if (!isRecord(options))
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    /** Omission alone selects the incumbent context contract; malformed supplied modes reject. */
    const delivery = options.delivery
    if (delivery === undefined) return EventDelivery.context
    if (delivery !== EventDelivery.context && delivery !== EventDelivery.value)
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    return delivery
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
}

/** Validates a structural channel before registration state can be changed. */
export const validateChannelLike = <T, R, V = undefined>(
  channel: unknown
): IValidatedChannel<T, R, V> => {
  try {
    if (!isRecord(channel) && typeof channel !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    if (!('subscribe' in (channel as object))) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
  }
  return {
    subscribe(listener, options) {
      try {
        return (channel as IEventChannelLike<T, R, V>).subscribe(
          listener as never,
          options as never
        )
      } catch (error) {
        throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
      }
    }
  }
}

/** Per-dispatch data shared by the prototype accessors, never reused between contexts. */
type IEventContextState<T, R, V> = {
  readonly value: T
  readonly snapshot: IEventDispatchSnapshot<T, R, V>
}

/** Keeps dispatch data on each escaping context while sharing the read-only accessors. */
class EventContext<T, R, V> implements IEventContext<T> {
  /** A single state slot avoids multiple private-field maps in the ES2020 build. */
  readonly #state: IEventContextState<T, R, V>

  /** Each cancellation callback retains its registration independently of the call-site receiver. */
  declare readonly abort: (reason?: unknown) => void
  /** Each retagging callback remains safe to detach or retain after listener delivery. */
  declare readonly setTaskId: (taskId: string | undefined) => void

  /** Captures one dispatch without reusing contexts or installing per-instance accessors. */
  constructor(value: T, snapshot: IEventDispatchSnapshot<T, R, V>) {
    this.#state = { value, snapshot }
    this.abort = (reason?: unknown): void => {
      snapshot.control.abort(reason)
    }
    this.setTaskId = (taskId: string | undefined): void => {
      snapshot.control.setTaskId(taskId)
    }
  }

  /** Returns the original payload without cloning or projection. */
  get value(): T {
    return this.#state.value
  }

  /** Reads cancellation from the registration retained by this dispatch. */
  get aborted(): boolean {
    return this.#state.snapshot.control.aborted
  }

  /** Preserves the exact reason identity recorded by the registration. */
  get abortReason(): unknown {
    return this.#state.snapshot.control.abortReason
  }

  /** Retains the label captured before listeners can retag their registration. */
  get taskId(): string | undefined {
    return this.#state.snapshot.taskId
  }
}

/** Creates a distinct live context and then appends the existing immutable projection alias. */
export const createEventContext = <T, R, V = undefined>(
  value: T,
  snapshot: IEventDispatchSnapshot<T, R, V>,
  projection?: { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
): IEventContext<T> => {
  /** Every listener invocation owns its context, including callbacks retained after dispatch. */
  const context = new EventContext(value, snapshot)
  if (projection) addEventProjection(context, projection.plan, projection.outcome)
  return context
}

/** Keeps internal control state off the frozen object's observable own-property surface. */
const controlOwners = new WeakMap<
  IEventDispatchControl,
  Pick<
    IRegistrationOwner<unknown, unknown, unknown>,
    'active' | 'aborted' | 'abortReason' | 'currentTaskId' | 'release'
  >
>()

/** Reuses control functions while preserving the original plain object's own descriptors and order. */
const ownerControlDescriptors = Object.getOwnPropertyDescriptors({
  get active(): boolean {
    return controlOwners.get(this)!.active
  },
  get aborted(): boolean {
    return controlOwners.get(this)!.aborted
  },
  get abortReason(): unknown {
    return controlOwners.get(this)!.abortReason
  },
  abort(reason?: unknown): void {
    /** Only the control's registration is released, even when another owner has the same listener. */
    const owner = controlOwners.get(this)!
    if (!owner.active) return
    owner.aborted = true
    owner.abortReason = reason
    owner.release()
  },
  setTaskId(taskId: string | undefined): void {
    /** Retagging remains live while each dispatch snapshot keeps its earlier fixed task label. */
    const owner = controlOwners.get(this)!
    if (!owner.active) return
    owner.currentTaskId = validateTaskId(taskId, true)
  }
} satisfies IEventDispatchControl)

/** Builds one frozen own-property control without allocating five functions per registration. */
const createOwnerControl = <T, R, V>(owner: IRegistrationOwner<T, R, V>): IEventDispatchControl => {
  /** The WeakMap entry owns the registration for exactly as long as a control remains reachable. */
  const control = Object.create(Object.prototype, ownerControlDescriptors) as IEventDispatchControl
  controlOwners.set(control, owner)
  return Object.freeze(control)
}

/**
 * Builds a package-internal snapshot whose task label is fixed at dispatch time while abort state
 * stays live through the shared owner control. Snapshots never reach user code, so they are not
 * frozen.
 */
const snapshotOwner = <T, R, V>(
  owner: IRegistrationOwner<T, R, V>
): IEventDispatchSnapshot<T, R, V> => ({
  listener: owner.listener,
  delivery: owner.delivery,
  taskId: owner.currentTaskId,
  control: owner.control
})

/** Invokes one snapshot entry and returns its raw listener result. */
export const invokeDispatchSnapshot = <T, R, V = undefined>(
  snapshot: IEventDispatchSnapshot<T, R, V>,
  value: T,
  projection?: { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
): R | PromiseLike<R> =>
  snapshot.delivery === EventDelivery.value
    ? (snapshot.listener as IEventValueListener<T, R>)(value)
    : (snapshot.listener as IEventListener<T, R, V>)(
        createEventContext(value, snapshot, projection) as never
      )

/**
 * Gives a visitor a frozen, registration-ordered list of single-use listener invocations. Use when
 * custom invocation order is needed without exposing listeners or registration ownership. Only a
 * channel created by this package instance, or its task-filter view, is accepted.
 *
 * The visitor decides which entries to invoke and whether to await their results. Entries close
 * when the visitor returns synchronously or its returned promise settles. Calling an entry twice or
 * after closure throws INVOCATION_CLOSED. Visitor failure crosses the boundary as VISITOR_FAILED
 * while retaining the original failure; malformed channels throw INVALID_CHANNEL before
 * visitation.
 */
export const withSnapshotEntries = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
  value: T,
  visitor: IEventInvocationVisitor<R>
): void | Promise<void> => {
  const { capability, taskId } = getCapability(channel)
  /** Registrations that match the view's task name at the time of the call. */
  const snapshots = capability.snapshot(taskId)
  /** Value-path projection, computed only when at least one listener will be offered. */
  const projection =
    snapshots.length > 0 && capability.plan
      ? { plan: capability.plan, outcome: capability.project(value) }
      : undefined
  /** Set when the visitor finishes; later `invoke()` calls then throw `INVOCATION_CLOSED`. */
  let closed = false
  /** Single-use invocation entries, one per snapshot, in registration order. */
  const entries = snapshots.map((snapshot) => {
    /** Set by the first `invoke()` of this entry; a second call throws. */
    let invoked = false
    return Object.freeze({
      taskId: snapshot.taskId,
      invoke: (): R | PromiseLike<R> => {
        if (closed || invoked)
          throw createEventTypeError(
            EventSubscriberErrorCode.invocationClosed,
            eventErrorText(EventSubscriberErrorCode.invocationClosed)
          )
        invoked = true
        return invokeDispatchSnapshot(snapshot, value, projection)
      }
    }) as IEventInvocation<R>
  })
  /** Closes every entry once and reports a pending projection failure. */
  const close = (): void => {
    if (closed) return
    closed = true
    if (projection?.outcome.diagnostic)
      reportEventProjectionFailure(
        capability.options,
        createEventContext(value, snapshots[0]!, projection),
        projection.outcome.diagnostic
      )
  }
  try {
    /** Visitor result; a Promise keeps the entries open until it settles. */
    const result = visitor(Object.freeze(entries))
    if (result === undefined) {
      close()
      return
    }
    return Promise.resolve(result).then(
      () => {
        close()
      },
      (error: unknown) => {
        close()
        throw codeExistingError(error, EventSubscriberErrorCode.visitorFailed)
      }
    )
  } catch (error) {
    close()
    throw codeExistingError(error, EventSubscriberErrorCode.visitorFailed)
  }
}

/**
 * Visits listener invocations synchronously, including registrations appended during this pass.
 * Unlike a fixed snapshot, a later scan can admit new registrations until a removal or clear ends
 * admission. Entries already admitted stay scheduled, even when their registrations are removed.
 * Only this package instance's canonical channel or task-filter view is accepted.
 *
 * The visitor chooses whether to invoke each entry and owns any returned listener promise. Each
 * entry is single-use; all entries close when this synchronous visitor pass finishes.
 * INVALID_CHANNEL rejects other sources; visitor throws become VISITOR_FAILED with the original
 * failure retained. This helper does not await visitor or listener results.
 */
export const invokeEachLive = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
  value: T,
  visitor: (invocation: IEventInvocation<R>) => void
): void => {
  const { capability, taskId } = getCapability(channel)
  /** Live-visit operation; absent on objects that are not channels of this package. */
  const liveVisit = capability.liveVisit
  if (!liveVisit) return
  liveVisit(value, taskId, visitor)
}

/** Reads one dispatch snapshot from a canonical channel or filtered capability. */
export const getCapability = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>
): { readonly capability: IChannelCapability<T, R, V>; readonly taskId: string | undefined } => {
  /** Internal record when the argument is a task-filter view. */
  const filtered = filteredCapabilities.get(channel as object) as
    | IFilteredCapability<T, R, V>
    | undefined
  if (filtered) {
    /** Capability of the source channel behind the view. */
    const capability = channelCapabilities.get(filtered.channel as object) as
      | IChannelCapability<T, R, V>
      | undefined
    if (!capability)
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    return { capability, taskId: filtered.taskId }
  }
  /** Capability registered for this channel object. */
  const capability = channelCapabilities.get(channel as object) as
    | IChannelCapability<T, R, V>
    | undefined
  if (!capability)
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
  return { capability, taskId: undefined }
}

/** Reports a late listener rejection without making synchronous publish awaitable. */
export const reportLateFailure = <
  T,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
>(
  options: IEventChannelOptions<T, S, V>,
  event: IEventContext<T>,
  failure: unknown
): void => {
  /** Aggregate error that carries the late listener failure as its first entry. */
  const diagnostic = createEventAggregateError(
    EventSubscriberErrorCode.unhandledListenerFailure,
    [failure],
    eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
  )
  /** Caller's reporter, if configured; otherwise the terminal path receives the failure. */
  const report = options.report
  if (report) {
    /** Reporter result; a rejection is forwarded to the terminal path. */
    let reportResult: void | PromiseLike<void>
    try {
      reportResult = report({ event: event as never, error: failure })
    } catch (error) {
      reportTerminal(options, diagnostic, error)
      return
    }
    observeRejection(reportResult, (error) => reportTerminal(options, diagnostic, error))
    return
  }
  reportTerminal(options, diagnostic, undefined)
}

/**
 * Observes a listener or reporter result for rejection. The `then` property is read once: a
 * thenable is assimilated with its original receiver, a throwing `then` getter is reported one
 * microtask later as an asynchronous rejection, and any other value schedules no work.
 */
const observeRejection = (value: unknown, onRejected: (error: unknown) => void): void => {
  /** Result of reading `then` exactly once, so a throwing getter is observed instead of escaping. */
  const inspection = inspectThenable(value)
  if ('error' in inspection) void Promise.reject(inspection.error).then(undefined, onRejected)
  else observeThenableRejection(value, inspection, onRejected)
}

/** Final fallback chain. Runtime access is isolated here so core channel code has no host branch. */
const reportTerminal = <T, S extends IEventApiStyle | undefined = undefined, V = undefined>(
  options: IEventChannelOptions<T, S, V>,
  diagnostic: AggregateError,
  failure: unknown
): void => {
  /**
   * Errors passed to the terminal reporter: the diagnostic entries plus the reporter's own failure,
   * if any.
   */
  const errors = failure === undefined ? diagnostic.errors : [...diagnostic.errors, failure]
  reportTerminalDiagnostic(
    EventSubscriberErrorCode.unhandledListenerFailure,
    errors,
    options.terminalReport,
    systemTerminalRuntime
  )
}

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
  /** Validated `report` option. */
  let report: IEventChannelOptions<T, undefined, V>['report']
  /** Validated `terminalReport` option. */
  let terminalReport: IEventChannelOptions<T, undefined, V>['terminalReport']
  /** Validated `dispatchPolicy` option. */
  let dispatchPolicy: IEventChannelOptions<T, undefined, V>['dispatchPolicy']
  /** The selected mode is read once before creating any registration state. */
  let admissionPolicy: IEventChannelOptions<T, undefined, V>['admissionPolicy']
  /** Validated `removalPolicy` option; defaults to removing only the called handle. */
  let removalPolicy: IEventChannelOptions<T, undefined, V>['removalPolicy']
  /** Validated `publishBudget` option. */
  let publishBudget: number | undefined
  /** Validated `throwOnAborted` option. */
  let throwOnAborted: boolean
  /** Raw `valueConfig` option; validated when the projection plan is built. */
  let valueConfig: unknown
  /** Raw `style` option. */
  let style: IEventApiStyle | undefined
  /** Alias names resolved from `style`. */
  let stylePlan: IEventApiStylePlan
  try {
    if (!isRecord(options)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    }
    report = options.report
    terminalReport = options.terminalReport
    dispatchPolicy = options.dispatchPolicy ?? EventDispatchPolicy.recursive
    admissionPolicy = options.admissionPolicy
    removalPolicy = options.removalPolicy ?? EventRemovalPolicy.handle
    publishBudget = options.publishBudget ?? 100_000
    /** Raw `throwOnAborted` option, read once so a getter cannot change between checks. */
    const suppliedThrowOnAborted = options.throwOnAborted
    throwOnAborted = suppliedThrowOnAborted === undefined ? false : suppliedThrowOnAborted
    valueConfig = options.valueConfig as unknown
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
  try {
    style = options.style
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  try {
    stylePlan = normalizeEventApiStyle(style)
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  if (report !== undefined && typeof report !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    )
  }
  if (terminalReport !== undefined && typeof terminalReport !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    )
  }
  if (
    (dispatchPolicy !== EventDispatchPolicy.recursive &&
      dispatchPolicy !== EventDispatchPolicy.queued) ||
    (admissionPolicy !== undefined &&
      admissionPolicy !== EventAdmissionPolicy.multiple &&
      admissionPolicy !== EventAdmissionPolicy.unique) ||
    (removalPolicy !== EventRemovalPolicy.handle &&
      removalPolicy !== EventRemovalPolicy.listenerAll)
  ) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  }
  if (!Number.isSafeInteger(publishBudget) || publishBudget < 1)
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  if (typeof throwOnAborted !== 'boolean')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  /** Options after validation, shared by dispatch, reporters and helper functions. */
  const normalizedOptions: IEventChannelOptions<T, undefined, V> = {
    report,
    terminalReport,
    valueConfig: valueConfig as IEventChannelOptions<T, undefined, V>['valueConfig'],
    removalPolicy,
    dispatchPolicy,
    publishBudget,
    throwOnAborted
  }
  /** Projection plan of the value alias; `undefined` when no `valueConfig` was given. */
  const projectionPlan = suppliedProjectionPlan ?? createEventValueProjectionPlan(valueConfig)
  /** First registration in delivery order. */
  let first: IRegistrationOwner<T, R, V> | undefined
  /** Last registration; new registrations are appended after it. */
  let last: IRegistrationOwner<T, R, V> | undefined
  /** Number of committed registrations; exposed as `size`. */
  let count = 0
  /**
   * Incremented when registrations are removed, so an in-progress live visit stops admitting new
   * ones.
   */
  let membershipEpoch = 0
  /** Unique channels alone index active owners by listener identity. */
  const uniqueOwners =
    admissionPolicy === EventAdmissionPolicy.unique
      ? new Map<IEventListener<T, R, V> | IEventValueListener<T, R>, IRegistrationOwner<T, R, V>>()
      : undefined
  /** Queued values used only when the caller explicitly opts into queued reentrancy. */
  let publishing = false
  /** Values waiting for delivery under the queued policy. */
  const pendingValues: T[] = []
  /** Index of the next queued value to deliver. */
  let pendingIndex = 0
  /** Unlinks one registration using shared channel state instead of a per-owner closure. */
  const removeOwner = (target: IRegistrationOwner<T, R, V>, incrementEpoch: boolean): void => {
    if (!target.active || !target.committed) return
    target.active = false
    if (uniqueOwners?.get(target.listener) === target) uniqueOwners.delete(target.listener)
    if (target.previous) target.previous.next = target.next
    else first = target.next
    if (target.next) target.next.previous = target.previous
    else last = target.previous
    target.previous = undefined
    target.next = undefined
    count -= 1
    if (incrementEpoch) membershipEpoch += 1
  }
  /**
   * Creates one registration in two steps: `commit()` links it into the list, and the returned
   * release removes it according to the removal policy. Splitting the steps lets callers finish
   * their own setup before the listener becomes visible.
   */
  const registerRaw = (
    listener: IEventListener<T, R, V> | IEventValueListener<T, R>,
    taskId: string | undefined,
    delivery: EventDelivery
  ): { readonly release: IUnsubscribe; readonly commit: () => void } => {
    /** Set by the first release; later releases do nothing. */
    let released = false
    /** Set once the registration is linked into the list. */
    let committed = false
    /** Owner record of this registration; filled in field by field below. */
    const owner = {} as IRegistrationOwner<T, R, V>
    /**
     * Removes this registration once. Under the `listenerAll` removal policy it removes every
     * registration of the same listener.
     */
    const release = (): void => {
      if (released) return
      released = true
      if (removalPolicy === EventRemovalPolicy.listenerAll && committed && !uniqueOwners) {
        /** Registrations of the same listener, collected before any of them is unlinked. */
        const matching: IRegistrationOwner<T, R, V>[] = []
        /** Cursor over the registration list. */
        let current = first
        while (current) {
          if (current.listener === owner.listener) matching.push(current)
          current = current.next
        }
        for (const matchingOwner of matching) removeOwner(matchingOwner, false)
        if (matching.length > 0) membershipEpoch += 1
      } else removeOwner(owner, true)
    }
    owner.listener = listener
    owner.delivery = delivery
    owner.active = true
    owner.aborted = false
    owner.abortReason = undefined
    owner.currentTaskId = taskId
    owner.previous = last
    owner.next = undefined
    owner.release = release
    owner.committed = false
    owner.control = createOwnerControl(owner)
    /** Links the registration at the end of the list once; does nothing after release. */
    const commit = (): void => {
      if (committed || released) return
      committed = true
      owner.committed = true
      owner.previous = last
      owner.next = undefined
      if (last) last.next = owner
      else first = owner
      last = owner
      count += 1
      uniqueOwners?.set(listener, owner)
    }
    return { release, commit }
  }
  /** Returns the current owner's release without changing its order or task label. */
  const admitUnique = (
    listener: IEventListener<T, R, V> | IEventValueListener<T, R>,
    taskId: string | undefined,
    delivery: EventDelivery
  ): IUnsubscribe | undefined => {
    /** Registration already holding this listener on a unique channel. */
    const existing = uniqueOwners?.get(listener)
    if (!existing) return undefined
    if (existing.currentTaskId !== taskId || existing.delivery !== delivery) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    }
    return existing.release
  }
  /** Delivers one value while preserving listener snapshots and late-failure reporting. */
  let remaining: number
  /** Records omitted snapshot targets even when no nested value remains queued. */
  let budgetExhausted = false
  /** Synchronous listener failures of the current top-level publish. */
  let failures: unknown[] = []
  /** Depth of nested dispatches, used to switch to queuing before the native stack overflows. */
  let nativeDepth = 0
  /**
   * Values published while the native stack is at its depth limit; drained after the current
   * listener returns.
   */
  let spillCapture: T[] | undefined
  /** Delivers one value while preserving listener snapshots and late-failure reporting. */
  const dispatchValue = (value: T): void => {
    // A channel without owners has nothing to snapshot, project, or report.
    if (!first) return
    ++nativeDepth
    /** Frozen list of registrations taken before any listener runs. */
    const snapshots = capability.snapshot()
    try {
      /** Value-path projection, computed once for this value. */
      const projection = projectionPlan
        ? { plan: projectionPlan, outcome: capability.project(value) }
        : undefined
      for (const snapshot of snapshots) {
        // Budget exhaustion stops delivery but still reaches the projection report below.
        if (!remaining) {
          budgetExhausted = true
          break
        }
        --remaining
        if (nativeDepth >= MAX_NATIVE_RECURSION_DEPTH) spillCapture = []
        /** Listener return value; checked for a later rejection when it is an object or function. */
        let result: R | PromiseLike<R>
        try {
          result = invokeDispatchSnapshot(snapshot, value, projection)
        } catch (error) {
          failures.push(error)
          continue
        } finally {
          if (spillCapture) {
            while (spillCapture.length) pendingValues.push(spillCapture.pop()!)
            spillCapture = undefined
            if (nativeDepth === MAX_NATIVE_RECURSION_DEPTH)
              while (pendingValues.length && remaining) dispatchValue(pendingValues.pop()!)
          }
        }
        // Primitive results cannot be thenables: skip the probe so sync listeners allocate nothing.
        if (result === null || (typeof result !== 'object' && typeof result !== 'function'))
          continue
        // The failure context is built only when a rejection is actually reported.
        observeRejection(result, (error) =>
          reportLateFailure<T, undefined, V>(
            normalizedOptions,
            createEventContext(value, snapshot, projection),
            error
          )
        )
      }
      if (projection?.outcome.diagnostic)
        reportEventProjectionFailure<T, undefined, V>(
          normalizedOptions,
          createEventContext(value, snapshots[0]!, projection),
          projection.outcome.diagnostic
        )
    } finally {
      --nativeDepth
    }
  }

  /** Delivers a value recursively by default, or drains an explicit queued policy. */
  const publishValue = (initialValue: T): void => {
    /** True when this call starts a new top-level publish and must reset its budget and failures. */
    const rootTransaction = !nativeDepth && !publishing
    if (rootTransaction) {
      remaining = publishBudget!
      budgetExhausted = false
      failures = []
      pendingValues.length = 0
      pendingIndex = 0
    }
    if (dispatchPolicy === EventDispatchPolicy.queued && publishing) {
      pendingValues.push(initialValue)
      return
    }
    if (dispatchPolicy === EventDispatchPolicy.recursive) {
      if (!remaining || nativeDepth >= MAX_NATIVE_RECURSION_DEPTH) {
        if (spillCapture) spillCapture.push(initialValue)
        else pendingValues.push(initialValue)
        return
      }
      dispatchValue(initialValue)
    } else {
      publishing = true
      pendingValues.push(initialValue)
      try {
        while (pendingIndex < pendingValues.length && remaining)
          dispatchValue(pendingValues[pendingIndex++]!)
      } finally {
        publishing = false
      }
    }
    if (
      rootTransaction &&
      (budgetExhausted || failures.length + pendingValues.length - pendingIndex)
    ) {
      /** `PUBLISH_FAILED` aggregate holding every synchronous failure of this publish. */
      const error = createEventAggregateError(
        EventSubscriberErrorCode.publishFailed,
        failures,
        eventErrorText(EventSubscriberErrorCode.publishFailed)
      )
      Object.defineProperty(error, 'detail', {
        enumerable: true,
        value: Object.freeze({
          processed: publishBudget! - remaining,
          remaining,
          causalSummary: Object.freeze(failures)
        })
      })
      throw error
    }
  }
  /** Shares chain extension across handles; registration ownership stays in each returned release. */
  const extendSubscription = (
    nextListener: IEventListener<T, R, V> | IEventValueListener<T, R>,
    nextOptions?: IEventSubscribeOptions
  ): IUnsubscribe => {
    if (typeof nextListener !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidListener,
        eventErrorText(EventSubscriberErrorCode.invalidListener)
      )
    }
    /** Task name of the next link in the chain. */
    const nextTaskId = readTaskOption(nextOptions)
    /** Argument mode is admitted with the task label before a chain can acquire a new owner. */
    const nextDelivery = readDeliveryOption(nextOptions)
    /** Release of an existing unique registration that already holds this listener. */
    const nextShared = admitUnique(nextListener, nextTaskId, nextDelivery)
    if (nextShared) return nextShared
    /** New registration for the next link of the chain. */
    const nextAdmission = registerRaw(nextListener, nextTaskId, nextDelivery)
    nextAdmission.commit()
    return nextAdmission.release
  }
  /** Public canonical channel object; its methods close over the state above. */
  const channel = {
    subscribe(
      listener: IEventListener<T, R, V> | IEventValueListener<T, R>,
      listenerOptions?: IEventSubscribeOptions
    ) {
      if (typeof listener !== 'function') {
        throw createEventTypeError(
          EventSubscriberErrorCode.invalidListener,
          eventErrorText(EventSubscriberErrorCode.invalidListener)
        )
      }
      /** Validated task name of this subscription. */
      const taskId = readTaskOption(listenerOptions)
      /** Mode stays immutable for the registration, including all handles sharing unique admission. */
      const delivery = readDeliveryOption(listenerOptions)
      /** Release of an existing unique registration, when the listener is already registered. */
      const shared = admitUnique(listener, taskId, delivery)
      /** New registration, created only when no existing one is shared. */
      const admission = shared ? undefined : registerRaw(listener, taskId, delivery)
      /** A duplicate handle may release the shared owner only after projection succeeds. */
      let bound = false
      try {
        /** Callable subscription handle with `unsubscribe`, chained `subscribe` and style aliases. */
        const handle = createRawSubscriptionOwner(
          shared
            ? () => {
                if (bound) shared()
              }
            : admission!.release,
          extendSubscription,
          stylePlan
        )
        bound = true
        admission?.commit()
        return handle
      } catch (error) {
        admission?.release()
        throw error
      }
    },
    publish(value) {
      publishValue(value)
    },
    filterTaskId(taskId) {
      /** Task name after validation. */
      const validated = validateTaskId(taskId, false) as string
      /** Opaque view object; its behaviour lives in the internal filter record. */
      const filtered = {} as IFilteredEventChannel<T, R, V>
      filteredCapabilities.set(filtered as object, {
        channel: channel as ICanonicalEventChannel<unknown, unknown, undefined, unknown>,
        taskId: validated
      })
      return filtered
    },
    clear() {
      if (count > 0) membershipEpoch += 1
      /** Cursor over the registration list. */
      let current = first
      while (current) {
        /** Next registration, read before this one is unlinked. */
        const next = current.next
        current.active = false
        current.previous = undefined
        current.next = undefined
        current = next
      }
      first = undefined
      last = undefined
      count = 0
      uniqueOwners?.clear()
    },
    get size() {
      return count
    }
  } as ICanonicalEventChannel<T, R, undefined, V>
  /** Package-internal operations of this channel, registered in a WeakMap after construction. */
  const capability: IChannelCapability<T, R, V> = {
    plan: projectionPlan,
    options: normalizedOptions,
    project(value) {
      return projectEventValue(value, projectionPlan)
    },
    snapshot(taskId) {
      /** Snapshots of the matching registrations, in registration order. */
      const snapshots: IEventDispatchSnapshot<T, R, V>[] = []
      /** Cursor over the registration list. */
      let current = first
      while (current) {
        if (taskId === undefined || current.currentTaskId === taskId)
          snapshots.push(snapshotOwner(current))
        current = current.next
      }
      return Object.freeze(snapshots)
    },
    liveVisit(value, taskId, visitor) {
      /** Membership epoch at dispatch start; any removal or clear afterwards stops admission. */
      const epoch = membershipEpoch
      /** Last owner already scanned; commits only append at the tail, so scans resume after it. */
      let scanned: IRegistrationOwner<T, R, V> | undefined
      /** True after the first pass, which admits every owner present at dispatch start. */
      let started = false
      /** Value-path projection, computed when the first registration is offered. */
      let projection:
        | { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
        | undefined
      /** Error thrown by the visitor; rethrown after every invocation is closed. */
      let primaryError: unknown
      /** Set when the visitor throws, so the original error is rethrown after cleanup. */
      let visitorFailed = false
      /** Registrations admitted to this visit and not yet offered to the visitor. */
      const pending: IRegistrationOwner<T, R, V>[] = []
      /** Close functions of every invocation offered so far. */
      const liveInvocations: Array<() => void> = []
      try {
        /**
         * Admits committed owners not yet scanned. The first pass admits every owner present at
         * dispatch start; later passes admit owners committed during dispatch only while membership
         * is unchanged, because a removal or clear unlinks nodes and ends admission.
         */
        const append = (): void => {
          if (started && membershipEpoch !== epoch) return
          started = true
          /** Cursor resuming after the last registration already scanned. */
          let current = scanned ? scanned.next : first
          while (current) {
            if (current.committed && (taskId === undefined || current.currentTaskId === taskId))
              pending.push(current)
            scanned = current
            current = current.next
          }
        }
        append()
        /** Position of the next pending registration. */
        let index = 0
        while (index < pending.length) {
          /** Registration offered next. */
          const owner = pending[index++]!
          if (!projection && capability.plan)
            projection = { plan: capability.plan, outcome: capability.project(value) }
          /** Snapshot of that registration, taken when it is offered. */
          const snapshot = snapshotOwner(owner)
          /** Set by the first `invoke()` of this invocation. */
          let invoked = false
          /** Set when the visit ends; later `invoke()` calls throw `INVOCATION_CLOSED`. */
          let closed = false
          /** Single-use invocation handed to the visitor. */
          const invocation: IEventInvocation<R> = {
            taskId: snapshot.taskId,
            invoke: () => {
              if (closed || invoked)
                throw createEventTypeError(
                  EventSubscriberErrorCode.invocationClosed,
                  eventErrorText(EventSubscriberErrorCode.invocationClosed)
                )
              invoked = true
              return invokeDispatchSnapshot(snapshot, value, projection)
            }
          }
          /** Closes this invocation. */
          const close = (): void => {
            closed = true
          }
          liveInvocations.push(close)
          visitor(invocation)
          append()
        }
      } catch (error) {
        visitorFailed = true
        primaryError = error
      } finally {
        for (const close of liveInvocations) close()
        if (projection?.outcome.diagnostic)
          reportEventProjectionFailure(
            normalizedOptions,
            createEventContext(value, snapshotOwner(pending[0]!), projection),
            projection.outcome.diagnostic
          )
      }
      if (visitorFailed)
        throw codeExistingError(primaryError, EventSubscriberErrorCode.visitorFailed)
    }
  }
  try {
    projectEventApiStyle(channel, stylePlan)
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
  channelCapabilities.set(
    channel as object,
    capability as IChannelCapability<unknown, unknown, unknown>
  )
  return channel
}

/**
 * Internal Hub injection boundary over the same factory identity, without a runtime wrapper. Public
 * overloads accept only options; the Hub alone reuses its already-admitted projection plan.
 */
export const createChannelWithProjection = createCanonicalChannel as <T, R = void, V = undefined>(
  options: IEventChannelOptions<T, IEventApiStyle | undefined, V>,
  projectionPlan: IEventProjectionPlan
) => ICanonicalEventChannel<T, R, undefined, V>

/**
 * Subscribes an object whose handle method receives events with the object as its receiver. Use for
 * subscribers that keep instance or private-field state. The current handle method is read on each
 * delivery, so no bind or cached receiver-changing wrapper is required.
 *
 * Accepts canonical, styled, or compatible structural channels and returns an idempotent canonical
 * unsubscribe function without style aliases. The source must return a callable release function
 * and must not deliver during subscribe. Invalid objects/methods throw INVALID_SUBSCRIBER;
 * malformed sources or installation-time delivery throw INVALID_CHANNEL, with owned release run
 * before a rejected installation exits. Listener failures follow the source dispatch policy.
 */
export const subscribeSubscriber = <T, R>(
  channel: IEventChannelLike<T, R>,
  subscriber: { readonly handle?: unknown }
): IUnsubscribe => {
  /** Channel after structural validation. */
  const validated = validateChannelLike<T, R>(channel)
  /** Raw `handle` member of the subscriber, read once. */
  let handleValue: unknown
  try {
    if (!isRecord(subscriber)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSubscriber,
        eventErrorText(EventSubscriberErrorCode.invalidSubscriber)
      )
    }
    handleValue = subscriber.handle
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidSubscriber)
  }
  if (typeof handleValue !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidSubscriber,
      eventErrorText(EventSubscriberErrorCode.invalidSubscriber)
    )
  }
  /** Subscriber whose `handle` has been checked to be callable. */
  const typedSubscriber = subscriber as {
    handle(event: IEventContext<T>): R | PromiseLike<R>
  }
  try {
    return installSubscriptionSource<IEventContext<T>, R | PromiseLike<R>>(
      (wrapped) => validated.subscribe(wrapped),
      (event) => typedSubscriber.handle(event)
    )
  } catch (error) {
    /** Whether the thrown value already carries a `code`, in which case it is rethrown unchanged. */
    let hasCode = false
    try {
      hasCode =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        'code' in error
    } catch {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
    }
    if (hasCode) throw error
    throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
  }
}

/**
 * Delivers at most one event and unsubscribes before calling the listener. Use when the listener
 * can publish synchronously again: reentry, a throw, or a rejected result cannot make this
 * registration fire twice. Optional taskId is forwarded without a default label.
 *
 * Accepts canonical/styled channels and structural sources that return a callable release handle
 * without delivering during installation. Returns an idempotent canonical unsubscribe function,
 * without style aliases. Invalid channel, listener, options, or taskId inputs throw their matching
 * INVALID_* errors before delivery. Listener returns and failures follow the source dispatcher.
 */
export const subscribeOnce = <T, R, V = undefined>(
  channel: IEventChannelLike<T, R, V>,
  listener: IEventListener<T, R, V>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  /** Channel after structural validation. */
  const validated = validateChannelLike<T, R, V>(channel)
  /** Validated task name forwarded to the source subscription. */
  const taskId = readTaskOption(options)
  if (typeof listener !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    )
  }
  /** Set by the first delivery; later deliveries are ignored. */
  let fired = false
  /** Release of the source subscription; replaced once installation succeeds. */
  let release: IUnsubscribe = () => undefined
  release = installSubscriptionSource<Parameters<IEventListener<T, R, V>>[0], R | PromiseLike<R>>(
    (wrapped) => validated.subscribe(wrapped, taskId === undefined ? undefined : { taskId }),
    (event) => {
      if (fired) return undefined as R
      fired = true
      release()
      return listener(event)
    }
  )
  return release
}

/**
 * Keeps a subscription until manual release or signal abort, then removes both owned listeners.
 * Accepts a standard AbortSignal or compatible object with boolean aborted and callable abort-event
 * add/remove methods. Optional taskId is forwarded without a default label. Aborting updates the
 * running context's aborted/abortReason values but does not interrupt code already executing.
 *
 * An already-aborted signal creates no registration and normally returns a no-op unsubscribe; a
 * canonical channel with throwOnAborted true throws ABORTED instead. Aborts during installation
 * also release any acquired registration before returning or throwing. Invalid inputs and cleanup
 * failures leave as coded errors, with INVALID_SIGNAL preserving signal/cleanup failures. The
 * returned idempotent function has canonical naming, without the channel's style aliases.
 */
export const subscribeUntil = <T, R, V = undefined>(
  channel: IEventChannelLike<T, R, V>,
  signal: IAbortSignal,
  listener: IEventListener<T, R, V>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  /** Channel after structural validation. */
  const validated = validateChannelLike<T, R, V>(channel)
  /** Validated task name forwarded to the source subscription. */
  const taskId = readTaskOption(options)
  if (typeof listener !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    )
  }
  /** Result of checking the signal at subscription time: invalid, already aborted, or usable. */
  let admission
  try {
    if (!isRecord(signal))
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSignal,
        eventErrorText(EventSubscriberErrorCode.invalidSignal)
      )
    admission = admitAbortSignal(signal)
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
  }
  if (admission.kind === 'invalid') {
    // A hostile `aborted` getter threw the caller's own value; the shared validator captures it
    // rather than letting it escape, so this is the throw site that owns its identity. Coding it in
    // place keeps `thrown === original` and its native type, which is what the incumbent did by
    // reading `aborted` inside the try. A shape this package rejected itself has no such original.
    if (admission.reason === 'aborted-threw')
      throw codeExistingError(admission.cause, EventSubscriberErrorCode.invalidSignal)
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidSignal,
      eventErrorText(EventSubscriberErrorCode.invalidSignal),
      admission.cause
    )
  }
  /** Whether the channel was created to throw instead of ignoring an already-aborted signal. */
  const throwOnAborted = channelCapabilities.get(channel as object)?.options.throwOnAborted === true
  if (admission.aborted) {
    if (throwOnAborted)
      throw createEventTypeError(
        EventSubscriberErrorCode.aborted,
        eventErrorText(EventSubscriberErrorCode.aborted)
      )
    return () => undefined
  }
  /** Set when the signal aborts after installation; the overlay context then reports aborted. */
  let overlayAborted = false
  /** Abort reason read from the signal; reported by the overlay context. */
  let overlayReason: unknown
  /** Set once the abort reason has been read from the signal. */
  let captured = false
  /** Set when reading the abort reason threw. */
  let captureFailed = false
  /** Failure thrown while reading the abort reason. */
  let captureFailure: unknown
  /**
   * Reads the signal's abort reason once and returns the same value, or rethrows the same failure,
   * on later calls.
   */
  const captureReason = (): unknown => {
    if (captured) {
      if (captureFailed) throw captureFailure
      return overlayReason
    }
    captured = true
    /** Cache the first getter outcome so repeated abort paths retain identity. */
    const read = tryReadProperty(signal, 'reason')
    if (read.threw) {
      captureFailed = true
      throw (captureFailure = read.error)
    }
    return (overlayReason = read.value)
  }
  /** Release of the source subscription; replaced once installation succeeds. */
  let sourceRelease: IUnsubscribe = () => undefined
  /** Set by the first release of this subscription. */
  let released = false
  /** Set before the abort listener is added, so cleanup knows whether to remove it. */
  let abortInstallAttempted = false
  /** Set when installing the source subscription failed. */
  let sourceSubscriptionFailed = false
  /** Set once the abort listener installation has finished, successfully or not. */
  let observerInstallComplete = false
  /** Set when removal was requested before installation finished. */
  let removeRequested = false
  /** Set once the abort listener has been removed from the signal. */
  let observerRemoved = false
  /**
   * Removes the abort listener once. Before installation finishes the removal is deferred unless
   * `force` is set.
   */
  const removeObserver = (force = false): void => {
    removeRequested = true
    if (observerRemoved || (!observerInstallComplete && !force)) return
    observerRemoved = true
    signal.removeEventListener(EventSubscriberState.abort, abortListener)
  }
  /** Releases the source subscription once. */
  const release = (): void => {
    if (released) return
    released = true
    try {
      sourceRelease()
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
    }
  }
  /**
   * Context passed to the listener: same payload and controls as the source event, but `aborted`
   * also reflects the signal.
   */
  const eventWrapper = (sourceEvent: IEventContext<T>): IEventContext<T> =>
    copyEventProjection(
      {
        get value() {
          return sourceEvent.value
        },
        get aborted() {
          return overlayAborted || sourceEvent.aborted
        },
        get abortReason() {
          return overlayAborted ? overlayReason : sourceEvent.abortReason
        },
        get taskId() {
          return sourceEvent.taskId
        },
        abort(reason?: unknown) {
          sourceEvent.abort(reason)
        },
        setTaskId(taskId: string | undefined) {
          sourceEvent.setTaskId(taskId)
        }
      },
      sourceEvent,
      channelCapabilities.get(channel as object)?.plan
    )
  /**
   * Finishes an abort: reads the reason, removes the listener and releases the subscription.
   * Failures are collected and thrown together as `INVALID_SIGNAL`, with the first one as `cause`.
   */
  const completeAbort = (removeSignalListener: boolean): void => {
    /** Failure thrown while reading the abort reason. */
    let primary: unknown
    /** Whether reading the abort reason failed. */
    let hasPrimary = false
    /** Failures from removing the listener and releasing the subscription. */
    const cleanup: unknown[] = []
    try {
      captureReason()
    } catch (error) {
      primary = codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
      hasPrimary = true
    }
    if (removeSignalListener) {
      try {
        removeObserver()
      } catch (error) {
        cleanup.push(error)
      }
    }
    try {
      release()
    } catch (error) {
      cleanup.push(error)
    }
    if (hasPrimary || cleanup.length > 0) {
      /** All failures, the primary one first. */
      const errors = [...(hasPrimary ? [primary] : []), ...cleanup]
      /** First failure; becomes the aggregate's `cause`. */
      const first = errors[0]
      throw attachEventErrorCode(
        new AggregateError(errors, eventErrorText(EventSubscriberErrorCode.invalidSignal), {
          cause: first
        }),
        EventSubscriberErrorCode.invalidSignal
      )
    }
  }
  /** Abort listener installed on the signal. */
  const abortListener = (): void => {
    if (released) return
    overlayAborted = true
    completeAbort(true)
  }
  try {
    abortInstallAttempted = true
    signal.addEventListener(EventSubscriberState.abort, abortListener, { once: true })
    observerInstallComplete = true
    if (removeRequested) removeObserver()
    try {
      sourceRelease = installSubscriptionSource<
        Parameters<IEventListener<T, R, V>>[0],
        R | PromiseLike<R>
      >(
        (wrapped) => validated.subscribe(wrapped, taskId === undefined ? undefined : { taskId }),
        (event) => {
          if (released) return undefined as R
          if (overlayAborted) return undefined as R
          return listener(eventWrapper(event) as never)
        },
        EventSubscriberErrorCode.invalidSignal,
        () => released || overlayAborted
      )
    } catch (error) {
      sourceSubscriptionFailed = true
      throw error
    }
    if (released) sourceRelease()
    /** Second read of `signal.aborted`, catching an abort during installation. */
    const secondAborted = signal.aborted
    if (typeof secondAborted !== 'boolean') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSignal,
        eventErrorText(EventSubscriberErrorCode.invalidSignal)
      )
    }
    if (secondAborted) {
      overlayAborted = true
      completeAbort(true)
      if (throwOnAborted)
        throw createEventTypeError(
          EventSubscriberErrorCode.aborted,
          eventErrorText(EventSubscriberErrorCode.aborted)
        )
    }
  } catch (primary) {
    /** Failures from rolling back a partly installed subscription. */
    const cleanup: unknown[] = []
    observerInstallComplete = true
    if (abortInstallAttempted) {
      try {
        removeObserver(true)
      } catch (error) {
        cleanup.push(error)
      }
    }
    try {
      release()
    } catch (error) {
      cleanup.push(error)
    }
    if (cleanup.length > 0) {
      throw attachEventErrorCode(
        new AggregateError(
          [primary, ...cleanup],
          eventErrorText(EventSubscriberErrorCode.invalidSignal),
          { cause: primary }
        ),
        EventSubscriberErrorCode.invalidSignal
      )
    }
    /** Whether the primary failure already carries a `code`. */
    let hasExistingCode = false
    try {
      hasExistingCode =
        ((typeof primary === 'object' && primary !== null) || typeof primary === 'function') &&
        'code' in primary
    } catch {
      throw codeExistingError(primary, EventSubscriberErrorCode.invalidSignal)
    }
    if (hasExistingCode) throw primary
    if (sourceSubscriptionFailed) throw primary
    throw codeExistingError(primary, EventSubscriberErrorCode.invalidSignal)
  }
  return (): void => {
    if (observerRemoved && released) return
    /** Failure thrown while removing the abort listener. */
    let removeError: unknown
    /** Whether removing the abort listener failed. */
    let hasRemoveError = false
    /** Failure thrown while releasing the source subscription. */
    let releaseError: unknown
    /** Whether releasing the source subscription failed. */
    let hasReleaseError = false
    try {
      removeObserver()
    } catch (error) {
      hasRemoveError = true
      removeError = error
    }
    try {
      release()
    } catch (error) {
      hasReleaseError = true
      releaseError = error
    }
    if (hasRemoveError && hasReleaseError) {
      /** Removal failure, coded as `INVALID_SIGNAL`; it stays first in the aggregate. */
      const primary = codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal)
      /** Release failure, coded as `INVALID_SIGNAL`. */
      const secondary = codeExistingError(releaseError, EventSubscriberErrorCode.invalidSignal)
      throw attachEventErrorCode(
        new AggregateError(
          [primary, secondary],
          eventErrorText(EventSubscriberErrorCode.invalidSignal),
          { cause: primary }
        ),
        EventSubscriberErrorCode.invalidSignal
      )
    }
    if (hasRemoveError) throw codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal)
    if (hasReleaseError)
      throw codeExistingError(releaseError, EventSubscriberErrorCode.invalidSignal)
  }
}

export { channelCapabilities, filteredCapabilities }
