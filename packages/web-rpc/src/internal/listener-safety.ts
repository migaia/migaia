import { WebRpcErrorText } from '../error-text.js'
import { WEBRPC_SOURCE, WebRpcErrorCode, tagWebRpcError, type IWebRpcErrorCode } from '../errors.js'

/** Canonical WebRPC codes accepted on an already package-tagged native error. */
const WEBRPC_ERROR_CODES: ReadonlySet<unknown> = new Set(Object.values(WebRpcErrorCode))

/** Describes how a listener boundary identifies and surfaces collected failures. */
export type IListenerFailureBoundary = Readonly<{
  code?: IWebRpcErrorCode
  message?: string
  secondaryFailures?: IListenerFailureState | readonly IListenerFailureState[]
  aggregateSingle?: boolean
}>

type IListenerFailureEntry = Readonly<{ order: number; error: unknown }>

/** Tracks ordered reporter failures and their still-pending asynchronous settlements. */
export type IListenerFailureState = {
  readonly failures: IListenerFailureEntry[]
  readonly pending: Set<Promise<void>>
  nextOrder: number
}

/** Creates one adapter-local reporter failure state. */
export function createListenerFailureState(): IListenerFailureState {
  return { failures: [], pending: new Set(), nextOrder: 0 }
}

/** Records a reporter failure under its invocation order. */
function recordFailure(state: IListenerFailureState, order: number, error: unknown): void {
  state.failures.push({ order, error })
}

/** Collects one already-observed secondary failure under the same ordered adapter state. */
export function collectListenerFailure(state: IListenerFailureState, error: unknown): void {
  recordFailure(state, state.nextOrder++, error)
}

/** Returns true when a callback result requires asynchronous settlement tracking. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  return typeof (value as { readonly then?: unknown }).then === 'function'
}

/** Observes a callback without allowing either synchronous throws or Promise rejection to escape. */
function observeFailure<T>(
  invoke: () => T | PromiseLike<T>,
  onFailure: (error: unknown) => void,
  state?: IListenerFailureState
): void {
  const order = state === undefined ? undefined : state.nextOrder++
  try {
    const result = invoke()
    if (!isPromiseLike(result)) return
    const settlement = Promise.resolve(result).then(
      () => undefined,
      (error) => {
        if (state !== undefined && order !== undefined) recordFailure(state, order, error)
        else onFailure(error)
      }
    )
    if (state !== undefined) {
      state.pending.add(settlement)
      void settlement.then(() => state.pending.delete(settlement))
    }
  } catch (error) {
    if (state !== undefined && order !== undefined) recordFailure(state, order, error)
    else onFailure(error)
  }
}

/** Observes sync, Promise, and thenable listener failures without rethrowing them. */
export function observeListener<T>(
  invoke: () => T | PromiseLike<T>,
  report: (error: unknown) => unknown,
  reporterFailures: IListenerFailureState = createListenerFailureState()
): void {
  observeFailure(invoke, (error) => {
    observeFailure(
      () => report(error),
      () => undefined,
      reporterFailures
    )
  })
}

/** Reports one adapter failure to every listener while collecting reporter failures once. */
export function reportListenerFailure(
  error: unknown,
  reporters: ReadonlySet<(error: unknown) => unknown>,
  reporterFailures: IListenerFailureState
): void {
  for (const reporter of Array.from(reporters)) {
    observeFailure(
      () => reporter(error),
      () => undefined,
      reporterFailures
    )
  }
}

/** Removes and returns every settled reporter failure in invocation order. */
function listenerFailureStates(
  boundary: IListenerFailureBoundary
): readonly IListenerFailureState[] {
  const state = boundary.secondaryFailures
  if (state === undefined) return []
  if (Array.isArray(state)) return state
  return [state as IListenerFailureState]
}

/** Removes and returns settled reporter failures in state and invocation order. */
function takeListenerFailures(boundary: IListenerFailureBoundary): unknown[] {
  return listenerFailureStates(boundary).flatMap((state) =>
    state.failures
      .splice(0)
      .sort((left, right) => left.order - right.order)
      .map(({ error }) => error)
  )
}

/** Returns whether an error already owns a complete canonical WebRPC identity. */
function hasWebRpcErrorIdentity(error: Error): boolean {
  const source = Object.getOwnPropertyDescriptor(error, 'source')
  const code = Object.getOwnPropertyDescriptor(error, 'code')
  return (
    source !== undefined &&
    'value' in source &&
    source.value === WEBRPC_SOURCE &&
    code !== undefined &&
    'value' in code &&
    WEBRPC_ERROR_CODES.has(code.value)
  )
}

/** Runs listener removals in reverse order and returns every exact cleanup failure. */
export function collectListenerCleanupFailures(removals: readonly (() => void)[]): unknown[] {
  const errors: unknown[] = []
  for (const remove of [...removals].reverse()) {
    try {
      remove()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

/** Creates the native, package-tagged failure for one adapter cleanup boundary. */
export function createListenerFailure(
  errors: readonly unknown[],
  boundary: IListenerFailureBoundary = {}
): Error | undefined {
  if (errors.length === 0) return undefined
  const code = boundary.code ?? WebRpcErrorCode.internal
  if (errors.length === 1 && boundary.aggregateSingle !== true && errors[0] instanceof Error) {
    if (hasWebRpcErrorIdentity(errors[0])) return errors[0]
    return tagWebRpcError(errors[0], code)
  }
  return tagWebRpcError(
    new AggregateError(errors, boundary.message ?? WebRpcErrorText.listenerCleanupFailed),
    code
  )
}

/** Drains endpoint-local secondary failures exactly once and throws the canonical native error. */
export function drainListenerFailures(
  errors: readonly unknown[],
  boundary: IListenerFailureBoundary = {}
): void {
  const failures = [...errors, ...takeListenerFailures(boundary)]
  const failure = createListenerFailure(failures, boundary)
  if (failure !== undefined) throw failure
}

/** Waits for every pending reporter before completing a terminal cleanup boundary. */
export function drainTerminalListenerFailures(
  errors: readonly unknown[],
  boundary: IListenerFailureBoundary = {}
): void | Promise<void> {
  const states = listenerFailureStates(boundary)
  if (states.every((state) => state.pending.size === 0))
    return drainListenerFailures(errors, boundary)
  return (async () => {
    while (states.some((state) => state.pending.size > 0))
      await Promise.all(states.flatMap((state) => Array.from(state.pending)))
    drainListenerFailures(errors, boundary)
  })()
}

/** Registers a listener group atomically and removes earlier registrations on failure. */
export function registerListeners(
  registrations: readonly Readonly<{
    add: () => void
    remove: () => void
  }>[],
  boundary: IListenerFailureBoundary = {}
): void {
  const registered: Array<() => void> = []
  try {
    for (const registration of registrations) {
      registration.add()
      registered.push(registration.remove)
    }
  } catch (error) {
    drainListenerFailures([error, ...collectListenerCleanupFailures(registered)], {
      ...boundary,
      message: boundary.message ?? WebRpcErrorText.listenerRegistrationCleanupFailed
    })
  }
}

/** Removes every listener in reverse order and reports all release failures together. */
export function releaseListeners(
  removals: readonly (() => void)[],
  boundary: IListenerFailureBoundary = {}
): void {
  drainListenerFailures(collectListenerCleanupFailures(removals), {
    ...boundary,
    aggregateSingle: boundary.aggregateSingle ?? true
  })
}

/** Releases physical listeners before committing logical removal, preserving retry on failure. */
export function releaseListenerRegistration(
  removals: readonly (() => void)[],
  commitRelease: () => void,
  boundary: IListenerFailureBoundary = {}
): void {
  const cleanupErrors = collectListenerCleanupFailures(removals)
  if (cleanupErrors.length === 0) commitRelease()
  drainListenerFailures(cleanupErrors, {
    ...boundary,
    aggregateSingle: boundary.aggregateSingle ?? false
  })
}
