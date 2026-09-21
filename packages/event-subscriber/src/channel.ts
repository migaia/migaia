import { EventSubscriberErrorCode } from './error-code.js'
import { MAX_NATIVE_RECURSION_DEPTH } from '@migaia/utils/function'
import { admitAbortSignal } from '@migaia/utils/promise'
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
  IEventDispatchSnapshot,
  IEventInvocation,
  IEventInvocationVisitor,
  IEventListener,
  IEventAbortSignal,
  IFilteredEventChannel,
  IUnsubscribe,
  IStyledEventChannel,
  IStyledEventChannelOptions
} from './types.js'
import { createSubscriptionHandle } from './internal/subscription.js'
import { EventDispatchPolicy, EventSubscriberState } from './state-constants.js'
import {
  normalizeEventApiStyle,
  projectEventApiStyle,
  type IEventApiStyle,
  type IEventApiStylePlan
} from './style.js'
import {
  createSystemTerminalRuntime,
  type IEventTerminalRuntime
} from './internal/terminal-runtime.js'
import {
  addEventProjection,
  createEventValueProjectionPlan,
  projectEventValue,
  reportEventProjectionFailure,
  type IEventProjectionOutcome,
  type IEventProjectionPlan
} from './value-projection.js'

type IRegistrationOwner<T, R, V> = {
  listener: IEventListener<T, R, V>
  active: boolean
  aborted: boolean
  abortReason: unknown
  currentTaskId: string | undefined
  previous: IRegistrationOwner<T, R, V> | undefined
  next: IRegistrationOwner<T, R, V> | undefined
  release: IUnsubscribe
  committed: boolean
  admissionEpoch: number
}

type IActiveLiveDispatch<T, R, V> = {
  readonly epoch: number
  readonly seen: Set<IRegistrationOwner<T, R, V>>
}

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

type IFilteredCapability<T, R, V = undefined> = {
  readonly channel: ICanonicalEventChannel<T, R, undefined, V>
  readonly taskId: string
}

type IValidatedChannel<T, R, V = undefined> = IEventChannelLike<T, R, V> & {
  readonly subscribe: IEventChannelLike<T, R, V>['subscribe']
}

/** Runtime identity for canonical channels; structural lookalikes never enter async helpers. */
const channelCapabilities = new WeakMap<object, IChannelCapability<unknown, unknown, unknown>>()

/** Runtime identity for filtered views; the public object carries no mutable channel state. */
const filteredCapabilities = new WeakMap<object, IFilteredCapability<unknown, unknown, unknown>>()

/** The host adapter is lazy and does not inspect globals until a terminal failure occurs. */
const systemTerminalRuntime = createSystemTerminalRuntime()

/** Reads an own/public option object without accepting null, arrays, or functions. */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  return !Array.isArray(value)
}

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
        return (channel as IEventChannelLike<T, R, V>).subscribe(listener, options)
      } catch (error) {
        throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
      }
    }
  }
}

/** Creates a live event context over a registration owner. */
export const createEventContext = <T, R, V = undefined>(
  value: T,
  snapshot: IEventDispatchSnapshot<T, R, V>,
  projection?: { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
): IEventContext<T> => {
  const context = {
    get value() {
      return value
    },
    get aborted() {
      return snapshot.control.aborted
    },
    get abortReason() {
      return snapshot.control.abortReason
    },
    get taskId() {
      return snapshot.taskId
    },
    abort(reason?: unknown) {
      snapshot.control.abort(reason)
    },
    setTaskId(taskId: string | undefined) {
      snapshot.control.setTaskId(taskId)
    }
  }
  if (projection) addEventProjection(context, projection.plan, projection.outcome)
  return context
}

/** Builds a snapshot whose task label is frozen while abort state remains live. */
const snapshotOwner = <T, R, V>(
  owner: IRegistrationOwner<T, R, V>
): IEventDispatchSnapshot<T, R, V> =>
  Object.freeze({
    listener: owner.listener,
    taskId: owner.currentTaskId,
    control: Object.freeze({
      get active() {
        return owner.active
      },
      get aborted() {
        return owner.aborted
      },
      get abortReason() {
        return owner.abortReason
      },
      abort(reason?: unknown) {
        if (!owner.active) return
        owner.aborted = true
        owner.abortReason = reason
        owner.release()
      },
      setTaskId(taskId: string | undefined) {
        if (!owner.active) return
        owner.currentTaskId = validateTaskId(taskId, true)
      }
    })
  })

/** Invokes one snapshot entry and returns its raw listener result. */
export const invokeDispatchSnapshot = <T, R, V = undefined>(
  snapshot: IEventDispatchSnapshot<T, R, V>,
  value: T,
  projection?: { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
): R | PromiseLike<R> => snapshot.listener(createEventContext(value, snapshot, projection) as never)

/** Runs a callback over one immutable target snapshot and always closes its invocations. */
export const withSnapshotEntries = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
  value: T,
  visitor: IEventInvocationVisitor<R>
): void | Promise<void> => {
  const { capability, taskId } = getCapability(channel)
  const snapshots = capability.snapshot(taskId)
  const projection =
    snapshots.length > 0 && capability.plan
      ? { plan: capability.plan, outcome: capability.project(value) }
      : undefined
  let closed = false
  const entries = snapshots.map((snapshot) => {
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
        throw error
      }
    )
  } catch (error) {
    close()
    throw error
  }
}

/** Visits registrations with append-live visibility while always releasing dispatch bookkeeping. */
export const invokeEachLive = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
  value: T,
  visitor: (invocation: IEventInvocation<R>) => void
): void => {
  const { capability, taskId } = getCapability(channel)
  const liveVisit = capability.liveVisit
  if (!liveVisit) return
  liveVisit(value, taskId, visitor)
}

/** Reads one dispatch snapshot from a canonical channel or filtered capability. */
export const getCapability = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>
): { readonly capability: IChannelCapability<T, R, V>; readonly taskId: string | undefined } => {
  const filtered = filteredCapabilities.get(channel as object) as
    | IFilteredCapability<T, R, V>
    | undefined
  if (filtered) {
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
  const diagnostic = createEventAggregateError(
    EventSubscriberErrorCode.unhandledListenerFailure,
    [failure],
    eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
  )
  const report = options.report
  if (report) {
    let reportResult: void | PromiseLike<void>
    try {
      reportResult = report({ event: event as never, error: failure })
    } catch (error) {
      reportTerminal(options, diagnostic, error)
      return
    }
    observePromiseLike(
      reportResult,
      () => undefined,
      (error) => reportTerminal(options, diagnostic, error)
    )
    return
  }
  reportTerminal(options, diagnostic, undefined)
}

/**
 * Observes any promise-like value through native Promise assimilation. Native assimilation
 * preserves the original thenable receiver and turns a hostile `then` getter into an asynchronously
 * observed rejection instead of a synchronous publish failure.
 */
export const observePromiseLike = (
  value: unknown,
  onFulfilled: () => void,
  onRejected: (error: unknown) => void
): void => {
  Promise.resolve(value).then(onFulfilled, onRejected)
}

/** Final fallback chain. Runtime access is isolated here so core channel code has no host branch. */
const reportTerminal = <T, S extends IEventApiStyle | undefined = undefined, V = undefined>(
  options: IEventChannelOptions<T, S, V>,
  diagnostic: AggregateError,
  failure: unknown
): void => {
  const errors = failure === undefined ? diagnostic.errors : [...diagnostic.errors, failure]
  const nextDiagnostic = createEventAggregateError(
    EventSubscriberErrorCode.unhandledListenerFailure,
    errors,
    eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
  )
  const terminal = options.terminalReport
  if (terminal) {
    try {
      const result = terminal(nextDiagnostic)
      observePromiseLike(
        result,
        () => undefined,
        (error) => reportSystemTerminal(nextDiagnostic, error)
      )
      return
    } catch (error) {
      reportSystemTerminal(nextDiagnostic, error)
      return
    }
  }
  reportSystemTerminal(nextDiagnostic, undefined)
}

/** Uses host terminal sinks only after user-owned reporters have failed or are absent. */
const reportSystemTerminal = (
  diagnostic: AggregateError,
  failure: unknown,
  runtime: IEventTerminalRuntime = systemTerminalRuntime
): void => {
  const errors = failure === undefined ? [...diagnostic.errors] : [...diagnostic.errors, failure]
  const appendFailure = (error: unknown): void => {
    errors.push(error)
  }
  const currentDiagnostic = (): AggregateError =>
    createEventAggregateError(
      EventSubscriberErrorCode.unhandledListenerFailure,
      errors,
      eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
    )
  try {
    if (runtime.reportError(currentDiagnostic())) {
      return
    }
  } catch (error) {
    appendFailure(error)
  }
  try {
    if (runtime.consoleError(currentDiagnostic())) {
      return
    }
  } catch (error) {
    appendFailure(error)
  }
  runtime.enqueueThrow(currentDiagnostic())
}

/** Creates a canonical transient channel backed by an O(1) linked registration list. */
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
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: IEventChannelOptions<T, undefined, V>
): ICanonicalEventChannel<T, R, undefined, V>
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & {
    readonly style: 'subscribe-publish'
  }
): ICanonicalEventChannel<T, R>
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & { readonly style: 'on-emit' }
): ICanonicalEventChannel<T, R, 'on-emit', V> & IStyledEventChannel<T, R, 'on-emit', V>
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & { readonly style: 'on-trigger' }
): ICanonicalEventChannel<T, R, 'on-trigger', V> & IStyledEventChannel<T, R, 'on-trigger', V>
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options: Omit<IEventChannelOptions<T, undefined, V>, 'style'> & { readonly style: 'listen-fire' }
): ICanonicalEventChannel<T, R, 'listen-fire', V> & IStyledEventChannel<T, R, 'listen-fire', V>
export function createCanonicalChannel<T, R = void, const V = undefined>(
  options?: IEventChannelOptions<T, undefined, V>
): ICanonicalEventChannel<T, R, undefined, V>
export function createCanonicalChannel<T, R = void, V = undefined>(
  options: IEventChannelOptions<T, IEventApiStyle | undefined, V>,
  projectionPlan: IEventProjectionPlan
): ICanonicalEventChannel<T, R, undefined, V>
export function createCanonicalChannel<T, R = void, V = undefined>(
  options: IEventChannelOptions<T, IEventApiStyle | undefined, V> = {},
  suppliedProjectionPlan?: IEventProjectionPlan
): ICanonicalEventChannel<T, R, undefined, V> {
  let report: IEventChannelOptions<T, undefined, V>['report']
  let terminalReport: IEventChannelOptions<T, undefined, V>['terminalReport']
  let dispatchPolicy: IEventChannelOptions<T, undefined, V>['dispatchPolicy']
  let removalPolicy: IEventChannelOptions<T, undefined, V>['removalPolicy']
  let publishBudget: number | undefined
  let throwOnAborted: boolean
  let valueConfig: unknown
  let style: IEventApiStyle | undefined
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
    removalPolicy = options.removalPolicy ?? 'handle'
    publishBudget = options.publishBudget ?? 100_000
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
    dispatchPolicy !== EventDispatchPolicy.recursive &&
    dispatchPolicy !== EventDispatchPolicy.queued
  ) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
  }
  if (removalPolicy !== 'handle' && removalPolicy !== 'listener-all')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions)
    )
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
  const normalizedOptions: IEventChannelOptions<T, undefined, V> = {
    report,
    terminalReport,
    valueConfig: valueConfig as IEventChannelOptions<T, undefined, V>['valueConfig'],
    removalPolicy,
    dispatchPolicy,
    publishBudget,
    throwOnAborted
  }
  const projectionPlan = suppliedProjectionPlan ?? createEventValueProjectionPlan(valueConfig)
  let first: IRegistrationOwner<T, R, V> | undefined
  let last: IRegistrationOwner<T, R, V> | undefined
  let count = 0
  let membershipEpoch = 0
  const activeLiveDispatches = new Set<IActiveLiveDispatch<T, R, V>>()
  /** Queued values used only when the caller explicitly opts into queued reentrancy. */
  let publishing = false
  const pendingValues: T[] = []
  let pendingIndex = 0
  const registerRaw = (
    listener: IEventListener<T, R, V>,
    taskId: string | undefined
  ): { readonly release: IUnsubscribe; readonly commit: () => void } => {
    let released = false
    let committed = false
    const owner = {} as IRegistrationOwner<T, R, V>
    const removeOwner = (target: IRegistrationOwner<T, R, V>, incrementEpoch: boolean): void => {
      if (!target.active || !target.committed) return
      target.active = false
      if (target.previous) target.previous.next = target.next
      else first = target.next
      if (target.next) target.next.previous = target.previous
      else last = target.previous
      target.previous = undefined
      target.next = undefined
      count -= 1
      if (incrementEpoch) membershipEpoch += 1
    }
    const release = (): void => {
      if (released) return
      released = true
      if (removalPolicy === 'listener-all' && committed) {
        const matching: IRegistrationOwner<T, R, V>[] = []
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
    owner.active = true
    owner.aborted = false
    owner.abortReason = undefined
    owner.currentTaskId = taskId
    owner.previous = last
    owner.next = undefined
    owner.release = release
    owner.committed = false
    owner.admissionEpoch = membershipEpoch
    const commit = (): void => {
      if (committed || released) return
      committed = true
      owner.committed = true
      owner.admissionEpoch = membershipEpoch
      owner.previous = last
      owner.next = undefined
      if (last) last.next = owner
      else first = owner
      last = owner
      count += 1
    }
    return { release, commit }
  }
  /** Delivers one value while preserving listener snapshots and late-failure reporting. */
  let remaining: number
  let failures: unknown[] = []
  let nativeDepth = 0
  let spillCapture: T[] | undefined
  /** Delivers one value while preserving listener snapshots and late-failure reporting. */
  const dispatchValue = (value: T): void => {
    ++nativeDepth
    const snapshots = capability.snapshot()
    try {
      if (!snapshots.length) return
      const projection = projectionPlan
        ? { plan: projectionPlan, outcome: capability.project(value) }
        : undefined
      for (const snapshot of snapshots) {
        if (!remaining) return
        --remaining
        if (nativeDepth >= MAX_NATIVE_RECURSION_DEPTH) spillCapture = []
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
        const context = createEventContext(value, snapshot, projection)
        observePromiseLike(
          result,
          () => undefined,
          (error) => reportLateFailure<T, undefined, V>(normalizedOptions, context, error)
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
    const rootTransaction = !nativeDepth && !publishing
    if (rootTransaction) {
      remaining = publishBudget!
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
    if (rootTransaction && failures.length + pendingValues.length - pendingIndex) {
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
  const channel = {
    subscribe(listener, listenerOptions) {
      if (typeof listener !== 'function') {
        throw createEventTypeError(
          EventSubscriberErrorCode.invalidListener,
          eventErrorText(EventSubscriberErrorCode.invalidListener)
        )
      }
      const taskId = readTaskOption(listenerOptions)
      const admission = registerRaw(listener, taskId)
      try {
        const handle = createSubscriptionHandle(
          admission.release,
          (nextListener, nextOptions) => {
            if (typeof nextListener !== 'function') {
              throw createEventTypeError(
                EventSubscriberErrorCode.invalidListener,
                eventErrorText(EventSubscriberErrorCode.invalidListener)
              )
            }
            const nextTaskId = readTaskOption(nextOptions)
            const nextAdmission = registerRaw(nextListener, nextTaskId)
            nextAdmission.commit()
            return nextAdmission.release
          },
          stylePlan
        )
        admission.commit()
        return handle
      } catch (error) {
        admission.release()
        throw error
      }
    },
    subscribeOnce(listener, listenerOptions) {
      return subscribeOnce(channel, listener, listenerOptions)
    },
    subscribeUntil(signal, listener, listenerOptions) {
      return subscribeUntil(channel, signal, listener, listenerOptions)
    },
    publish(value) {
      publishValue(value)
    },
    filterTaskId(taskId) {
      const validated = validateTaskId(taskId, false) as string
      const filtered = {} as IFilteredEventChannel<T, R, V>
      filteredCapabilities.set(filtered as object, {
        channel: channel as ICanonicalEventChannel<unknown, unknown, undefined, unknown>,
        taskId: validated
      })
      return filtered
    },
    clear() {
      if (count > 0) membershipEpoch += 1
      let current = first
      while (current) {
        const next = current.next
        current.active = false
        current.previous = undefined
        current.next = undefined
        current = next
      }
      first = undefined
      last = undefined
      count = 0
    },
    get size() {
      return count
    }
  } as ICanonicalEventChannel<T, R, undefined, V>
  const capability: IChannelCapability<T, R, V> = {
    plan: projectionPlan,
    options: normalizedOptions,
    project(value) {
      return projectEventValue(value, projectionPlan)
    },
    snapshot(taskId) {
      const snapshots: IEventDispatchSnapshot<T, R, V>[] = []
      let current = first
      while (current) {
        if (taskId === undefined || current.currentTaskId === taskId)
          snapshots.push(snapshotOwner(current))
        current = current.next
      }
      return Object.freeze(snapshots)
    },
    liveVisit(value, taskId, visitor) {
      const active: IActiveLiveDispatch<T, R, V> = {
        epoch: membershipEpoch,
        seen: new Set()
      }
      activeLiveDispatches.add(active)
      let projection:
        | { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
        | undefined
      let primaryError: unknown
      let visitorFailed = false
      const pending: IRegistrationOwner<T, R, V>[] = []
      const liveInvocations: Array<() => void> = []
      try {
        const append = (): void => {
          let current = first
          while (current) {
            if (
              current.committed &&
              !active.seen.has(current) &&
              (taskId === undefined || current.currentTaskId === taskId) &&
              current.admissionEpoch === active.epoch
            ) {
              active.seen.add(current)
              pending.push(current)
            }
            current = current.next
          }
        }
        append()
        let index = 0
        while (index < pending.length) {
          const owner = pending[index++]!
          if (!projection && capability.plan)
            projection = { plan: capability.plan, outcome: capability.project(value) }
          const snapshot = snapshotOwner(owner)
          let invoked = false
          let closed = false
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
        activeLiveDispatches.delete(active)
        for (const close of liveInvocations) close()
        if (projection?.outcome.diagnostic)
          reportEventProjectionFailure(
            normalizedOptions,
            createEventContext(value, snapshotOwner(pending[0]!), projection),
            projection.outcome.diagnostic
          )
      }
      if (visitorFailed) throw primaryError
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

/** Registers a subscriber object without introducing a class hierarchy. */
export const subscribeSubscriber = <T, R>(
  channel: IEventChannelLike<T, R>,
  subscriber: { readonly handle?: unknown }
): IUnsubscribe => {
  const validated = validateChannelLike<T, R>(channel)
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
  const typedSubscriber = subscriber as {
    handle(event: IEventContext<T>): R | PromiseLike<R>
  }
  let released = false
  let releaseReady = false
  let sourceReleaseCalled = false
  let syncDelivered = false
  let sourceRelease: IUnsubscribe | undefined
  const release = (): void => {
    if (released) return
    released = true
    if (releaseReady && !sourceReleaseCalled) {
      sourceReleaseCalled = true
      try {
        sourceRelease?.()
      } catch (error) {
        throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
      }
    }
  }
  let candidate: IUnsubscribe
  try {
    candidate = validated.subscribe((event) => {
      if (released) return undefined as R
      if (!releaseReady) {
        syncDelivered = true
        return undefined as R
      }
      return typedSubscriber.handle(event)
    })
    if (typeof candidate !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    sourceRelease = candidate
    releaseReady = true
    if (released) release()
    if (syncDelivered) {
      const primary = createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
      try {
        release()
      } catch (error) {
        throw createEventAggregateError(
          EventSubscriberErrorCode.invalidChannel,
          [primary, error],
          eventErrorText(EventSubscriberErrorCode.invalidChannel)
        )
      }
      throw primary
    }
  } catch (error) {
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
  return release
}

/** Installs once semantics on any event-subscriber-compatible structural channel. */
export const subscribeOnce = <T, R, V = undefined>(
  channel: IEventChannelLike<T, R, V>,
  listener: IEventListener<T, R, V>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  const validated = validateChannelLike<T, R, V>(channel)
  const taskId = readTaskOption(options)
  if (typeof listener !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    )
  }
  let sourceRelease: IUnsubscribe | undefined
  let released = false
  let syncDelivered = false
  const release = (): void => {
    if (released) return
    released = true
    try {
      sourceRelease?.()
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
    }
  }
  let releaseReady = false
  let fired = false
  const candidate = validated.subscribe(
    (event) => {
      if (released) return undefined as R
      if (!releaseReady) {
        syncDelivered = true
        return undefined as R
      }
      if (fired) return undefined as R
      fired = true
      release()
      return listener(event)
    },
    taskId === undefined ? undefined : { taskId }
  )
  if (typeof candidate !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
  }
  sourceRelease = candidate
  releaseReady = true
  if (syncDelivered) {
    const primary = createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
    try {
      release()
    } catch (error) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.invalidChannel,
        [primary, error],
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    throw primary
  }
  return release
}

/** Installs abort-linked subscription with a helper-owned overlay and closed race protocol. */
export const subscribeUntil = <T, R, V = undefined>(
  channel: IEventChannelLike<T, R, V>,
  signal: IEventAbortSignal,
  listener: IEventListener<T, R, V>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  const validated = validateChannelLike<T, R, V>(channel)
  const taskId = readTaskOption(options)
  if (typeof listener !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    )
  }
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
  const throwOnAborted = channelCapabilities.get(channel as object)?.options.throwOnAborted === true
  if (admission.aborted) {
    if (throwOnAborted)
      throw createEventTypeError(
        EventSubscriberErrorCode.aborted,
        eventErrorText(EventSubscriberErrorCode.aborted)
      )
    return () => undefined
  }
  let overlayAborted = false
  let overlayReason: unknown
  let captured = false
  let captureFailed = false
  let captureFailure: unknown
  const captureReason = (): unknown => {
    if (captured) {
      if (captureFailed) throw captureFailure
      return overlayReason
    }
    captured = true
    try {
      overlayReason = signal.reason
      return overlayReason
    } catch (error) {
      captureFailed = true
      captureFailure = error
      throw error
    }
  }
  let sourceRelease: IUnsubscribe = () => undefined
  let sourceReleaseReady = false
  let released = false
  let sourceReleaseCalled = false
  let abortInstallAttempted = false
  let sourceSubscriptionFailed = false
  let observerInstallComplete = false
  let removeRequested = false
  let observerRemoved = false
  const removeObserver = (force = false): void => {
    removeRequested = true
    if (observerRemoved || (!observerInstallComplete && !force)) return
    observerRemoved = true
    signal.removeEventListener(EventSubscriberState.abort, abortListener)
  }
  const releaseSourceIfReady = (): void => {
    if (sourceReleaseReady && !sourceReleaseCalled) {
      sourceReleaseCalled = true
      sourceRelease()
    }
  }
  const release = (): void => {
    if (released) return
    released = true
    try {
      releaseSourceIfReady()
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
    }
  }
  const eventWrapper = (sourceEvent: IEventContext<T>): IEventContext<T> => ({
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
  })
  const completeAbort = (removeSignalListener: boolean): void => {
    let primary: unknown
    let hasPrimary = false
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
      const errors = [...(hasPrimary ? [primary] : []), ...cleanup]
      const first = errors[0]
      throw attachEventErrorCode(
        new AggregateError(errors, eventErrorText(EventSubscriberErrorCode.invalidSignal), {
          cause: first
        }),
        EventSubscriberErrorCode.invalidSignal
      )
    }
  }
  const abortListener = (): void => {
    if (released) return
    overlayAborted = true
    completeAbort(true)
  }
  let installing = true
  let syncDelivered = false
  try {
    abortInstallAttempted = true
    signal.addEventListener(EventSubscriberState.abort, abortListener, { once: true })
    observerInstallComplete = true
    if (removeRequested) removeObserver()
    let candidate: IUnsubscribe
    try {
      candidate = validated.subscribe(
        (event) => {
          if (released) return undefined as R
          if (installing) {
            syncDelivered = true
            return undefined as R
          }
          if (overlayAborted) return undefined as R
          return listener(eventWrapper(event) as never)
        },
        taskId === undefined ? undefined : { taskId }
      )
    } catch (error) {
      sourceSubscriptionFailed = true
      throw error
    }
    if (typeof candidate !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    sourceRelease = candidate
    sourceReleaseReady = true
    if (released) releaseSourceIfReady()
    if (syncDelivered) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
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
    installing = false
  } catch (primary) {
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
    let removeError: unknown
    let hasRemoveError = false
    let releaseError: unknown
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
      const primary = codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal)
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
