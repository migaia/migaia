/**
 * Owns failure-contained trace emission and immutable diagnostic node snapshots. It never changes
 * graph admission, lifecycle outcomes, or primary errors when a diagnostic clock or sink fails.
 */
import type {
  IObservable,
  IObserver,
  IRuntimeErrorContext,
  IRuntimeErrorReportContext,
  IRuntimeNodeDescriptor,
  IRuntimeNodeKind,
  IRuntimeTraceEvent
} from './types.ts'
import { ReactiveNodeKind, ReactiveTracePhase, ReactiveTraceType } from './trace-constants.ts'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'

/** Describing one graph role can discover a computed's other role through native membership. */
type INodeRole = Exclude<ReactiveNodeKind, typeof ReactiveNodeKind.computed>

/** Stable namespace used by every generated diagnostic node identity. */
const NODE_ID_PREFIX = 'reactive:'

/** Host callbacks used to contain every trace clock and sink failure at the diagnostic boundary. */
export type ITraceDiagnosticHost = {
  readonly timestamp: () => number
  readonly emitTrace: (event: IRuntimeTraceEvent) => void
  readonly reportError: (error: unknown) => void
}

/** Host callbacks needed to keep one observer-run trace span failure-contained. */
export type IObserverRunTraceHost = ITraceDiagnosticHost & {
  readonly now: () => number
}

/** Controls one observer-run trace span and prevents duplicate terminal events. */
export type IObserverRunTrace = {
  start(): void
  end(): void
  error(error: unknown): void
}

/** Cached node identities are weak so diagnostics never retain a disposed graph. */
const nodeDescriptors = new WeakMap<object, IRuntimeNodeDescriptor>()
/** Frozen public copies preserve identity without publishing mutable or hostile inputs. */
const copiedDescriptors = new WeakMap<object, IRuntimeNodeDescriptor>()
/** Monotonic diagnostic identities correlate nodes without consuming the runtime value clock. */
let nextNodeId = 1

/** The allowed descriptor kinds are fixed by the three runtime node roles. */
const NODE_KINDS: ReadonlySet<string> = new Set<IRuntimeNodeKind>([
  ReactiveNodeKind.observable,
  ReactiveNodeKind.observer,
  ReactiveNodeKind.computed
])

/**
 * Diagnostic callbacks are typed `void`, but TypeScript intentionally accepts async functions
 * there. Contain a returned thenable without reading `then` twice, so diagnostics can never create
 * an unhandled rejection.
 */
export function containDiagnosticRejection(
  value: unknown,
  onRejected: (error: unknown) => void
): void {
  observeThenableRejection(value, inspectThenable(value), onRejected)
}

/** Report a diagnostic failure without allowing a failing reporter to escape the boundary. */
function reportDiagnosticFailure(error: unknown, host: ITraceDiagnosticHost): void {
  try {
    host.reportError(error)
  } catch {
    // Reporting is already the terminal diagnostic boundary.
  }
}

/** Reads one clock with an explicit reporter context, avoiding per-span callback ownership. */
export function readDiagnosticClock<T>(
  read: () => number,
  fallback: number,
  reportFailure: (error: unknown, context: T) => void,
  context: T
): number {
  try {
    return read()
  } catch (error) {
    try {
      reportFailure(error, context)
    } catch {
      // Reporting is already the terminal diagnostic boundary.
    }
    return fallback
  }
}

/** Emit one diagnostic event with timestamp and sink containment; never changes caller control flow. */
export function emitTraceSafely(
  host: ITraceDiagnosticHost,
  createEvent: (timestamp: number) => IRuntimeTraceEvent,
  fallbackTimestamp = 0
): void {
  /** Clock failures are reported before the sink receives its fallback timestamp. */
  const timestamp = readDiagnosticClock(
    host.timestamp,
    fallbackTimestamp,
    reportDiagnosticFailure,
    host
  )
  try {
    host.emitTrace(createEvent(timestamp))
  } catch (error) {
    reportDiagnosticFailure(error, host)
  }
}

/** Owns one observer-run span while its public handle retains the original plain-object shape. */
class ObserverRunTrace {
  /** Descriptor identity is shared by every event in this observer's span. */
  readonly #observer: IRuntimeNodeDescriptor
  /** The original host retains dynamic clock and sink property reads at their existing points. */
  readonly #host: IObserverRunTraceHost
  /** Records the single start admission before clocks or listeners can reenter. */
  #started = false
  /** Commits terminal admission before clocks or listeners can attempt another terminal event. */
  #terminal = false
  /** Last monotonic start sample supplies duration and the terminal-clock fallback. */
  #startedAt = 0
  /** Last timestamp sample supplies the terminal event's fallback timestamp. */
  #startedTimestamp = 0

  /** Retains the observer and host without reading any diagnostic clock or sink during creation. */
  constructor(observer: IRuntimeNodeDescriptor, host: IObserverRunTraceHost) {
    this.#observer = observer
    this.#host = host
  }

  /** Preserves own method keys, descriptors, prototype, and detached-call behavior of the handle. */
  createHandle(): IObserverRunTrace {
    return {
      start: () => this.#start(),
      end: () => this.#end(),
      error: (error) => this.#error(error)
    }
  }

  /** Contains sink failures without replacing the observer's primary result or exception. */
  #emit(event: IRuntimeTraceEvent): void {
    try {
      this.#host.emitTrace(event)
    } catch (error) {
      reportDiagnosticFailure(error, this.#host)
    }
  }

  /** Attempts one start event, sampling monotonic time before its event timestamp. */
  #start(): void {
    if (this.#started) return
    this.#started = true
    this.#startedAt = readDiagnosticClock(this.#host.now, 0, reportDiagnosticFailure, this.#host)
    this.#startedTimestamp = readDiagnosticClock(
      this.#host.timestamp,
      0,
      reportDiagnosticFailure,
      this.#host
    )
    this.#emit({
      type: ReactiveTraceType.observerRun,
      timestamp: this.#startedTimestamp,
      phase: ReactiveTracePhase.start,
      observer: this.#observer
    })
  }

  /** Attempts one successful terminal event and preserves timestamp-before-duration sampling. */
  #end(): void {
    if (!this.#started || this.#terminal) return
    this.#terminal = true
    this.#emit({
      type: ReactiveTraceType.observerRun,
      timestamp: readDiagnosticClock(
        this.#host.timestamp,
        this.#startedTimestamp,
        reportDiagnosticFailure,
        this.#host
      ),
      phase: ReactiveTracePhase.end,
      observer: this.#observer,
      durationMs:
        readDiagnosticClock(this.#host.now, this.#startedAt, reportDiagnosticFailure, this.#host) -
        this.#startedAt
    })
  }

  /** Attempts one failed terminal event while retaining the caller's original error identity. */
  #error(primaryError: unknown): void {
    if (!this.#started || this.#terminal) return
    this.#terminal = true
    this.#emit({
      type: ReactiveTraceType.observerRun,
      timestamp: readDiagnosticClock(
        this.#host.timestamp,
        this.#startedTimestamp,
        reportDiagnosticFailure,
        this.#host
      ),
      phase: ReactiveTracePhase.error,
      observer: this.#observer,
      durationMs:
        readDiagnosticClock(this.#host.now, this.#startedAt, reportDiagnosticFailure, this.#host) -
        this.#startedAt,
      error: primaryError
    })
  }
}

/** Constructs a failure-contained observer span without changing its public handle's shape. */
export function createObserverRunTrace(
  observer: IRuntimeNodeDescriptor,
  host: IObserverRunTraceHost
): IObserverRunTrace {
  return new ObserverRunTrace(observer, host).createHandle()
}

/**
 * Build the public identity for an internal graph node.
 *
 * The descriptor is cached and frozen: trace events can correlate edges by both object identity and
 * `id`, while diagnostics never expose the mutable node.
 */
function describeNode(node: object, role: INodeRole): IRuntimeNodeDescriptor {
  /** A graph node keeps the same frozen diagnostic identity across every publication. */
  const existing = nodeDescriptors.get(node)
  if (existing) return existing
  /** Capture metadata without invoking a user-defined debugName getter. */
  let descriptors: PropertyDescriptorMap
  try {
    descriptors = Object.getOwnPropertyDescriptors(node)
  } catch {
    return anonymousDescriptor(role)
  }
  // `subs`/`deps` are intentionally accessors on built-in nodes so callers
  // cannot mutate the graph through a public Set. Use membership rather than
  // own-property descriptors; prototype accessors still identify the role.
  /** Explicit role or graph membership identifies the observable half of a computed. */
  const observable = role === ReactiveNodeKind.observable || 'subs' in node
  /** Explicit role or graph membership identifies the observer half of a computed. */
  const observer = role === ReactiveNodeKind.observer || 'deps' in node
  /** Dual-role nodes publish one computed identity rather than separate graph descriptors. */
  const kind: IRuntimeNodeKind =
    observable && observer
      ? ReactiveNodeKind.computed
      : observable
        ? ReactiveNodeKind.observable
        : ReactiveNodeKind.observer
  /** Only an own data label can cross the diagnostic boundary without running user code. */
  const debugNameDescriptor = descriptors.debugName
  /** Non-string metadata is omitted rather than coerced through user callbacks. */
  const debugName =
    debugNameDescriptor && 'value' in debugNameDescriptor ? debugNameDescriptor.value : undefined
  /** Immutable public metadata exposes identity and label, never mutable graph authority. */
  const descriptor = Object.freeze({
    id: `${NODE_ID_PREFIX}${nextNodeId++}`,
    kind,
    ...(typeof debugName === 'string' ? { debugName } : {})
  })
  nodeDescriptors.set(node, descriptor)
  return descriptor
}

/** Describes the observable graph role without exposing its mutable subscriber collection. */
export const describeObservable = (observable: IObservable): IRuntimeNodeDescriptor =>
  describeNode(observable, ReactiveNodeKind.observable)

/** Describes the observer graph role without exposing its mutable dependency collection. */
export const describeObserver = (observer: IObserver): IRuntimeNodeDescriptor =>
  describeNode(observer, ReactiveNodeKind.observer)

/** Reads a captured own data property without evaluating accessors on untrusted descriptors. */
function descriptorDataValue(properties: PropertyDescriptorMap, name: string): unknown {
  /** Reflection already captured this descriptor; inspecting it cannot invoke the original getter. */
  const descriptor = properties[name]
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

/** Copy untrusted descriptors before publishing them to diagnostic callbacks. */
function sanitizeDescriptor(value: unknown, role: INodeRole): IRuntimeNodeDescriptor {
  if (typeof value !== 'object' || value === null) {
    return anonymousDescriptor(role)
  }
  /** Previously described raw nodes must reuse their canonical identity before copying. */
  const internal = nodeDescriptors.get(value)
  if (internal) return sanitizeDescriptor(internal, role)
  /** Repeated sanitization preserves the same frozen snapshot for the same input object. */
  const copied = copiedDescriptors.get(value)
  if (copied) return copied
  /** Reflection captures descriptor data while leaving accessor properties unevaluated. */
  let properties: PropertyDescriptorMap
  try {
    properties = Object.getOwnPropertyDescriptors(value)
  } catch {
    return anonymousDescriptor(role)
  }
  /** Stable own data values are copied without evaluating hostile descriptor getters. */
  const id = descriptorDataValue(properties, 'id')
  /** The discriminant is checked against the finite diagnostic node-kind contract below. */
  const kind = descriptorDataValue(properties, 'kind')
  /** Only string labels survive the public diagnostic snapshot. */
  const debugName = descriptorDataValue(properties, 'debugName')
  // A raw reactive node has no public id. Describe it instead of copying any
  // internal fields, which also hardens direct JS calls to emitTrace/reportError.
  if (typeof id !== 'string' || typeof kind !== 'string' || !NODE_KINDS.has(kind)) {
    try {
      return sanitizeDescriptor(describeNode(value, role), role)
    } catch {
      return anonymousDescriptor(role)
    }
  }
  /** Immutable public metadata exposes identity and label, never mutable graph authority. */
  const descriptor = Object.freeze({
    id,
    kind: kind as IRuntimeNodeKind,
    ...(typeof debugName === 'string' ? { debugName } : {})
  })
  copiedDescriptors.set(value, descriptor)
  return descriptor
}

/** Metadata poisoning must degrade diagnostics, never suppress the error. */
function anonymousDescriptor(role: INodeRole): IRuntimeNodeDescriptor {
  return Object.freeze({
    id: `${NODE_ID_PREFIX}${nextNodeId++}`,
    kind: role
  })
}

/** Normalize a public trace event into an immutable, graph-safe snapshot. */
export function sanitizeTraceEvent(event: IRuntimeTraceEvent): IRuntimeTraceEvent {
  switch (event.type) {
    case ReactiveTraceType.observableChange:
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        observable: sanitizeDescriptor(event.observable, ReactiveNodeKind.observable),
        reason: event.reason
      })
    case ReactiveTraceType.dependency:
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        phase: event.phase,
        observable: sanitizeDescriptor(event.observable, ReactiveNodeKind.observable),
        observer: sanitizeDescriptor(event.observer, ReactiveNodeKind.observer),
        ...(event.reason === undefined ? {} : { reason: event.reason })
      })
    case ReactiveTraceType.observerRun:
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        phase: event.phase,
        observer: sanitizeDescriptor(event.observer, ReactiveNodeKind.observer),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.error === undefined ? {} : { error: event.error })
      })
    case ReactiveTraceType.action:
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        phase: event.phase,
        name: event.name,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.error === undefined ? {} : { error: event.error })
      })
  }
}

/** Normalize error metadata before it crosses the Runtime callback boundary. */
export function sanitizeErrorContext(context: IRuntimeErrorReportContext): IRuntimeErrorContext {
  return Object.freeze({
    phase: context.phase,
    ...(context.observer === undefined
      ? {}
      : {
          observer: sanitizeDescriptor(context.observer, ReactiveNodeKind.observer)
        }),
    ...(context.observable === undefined
      ? {}
      : {
          observable: sanitizeDescriptor(context.observable, ReactiveNodeKind.observable)
        })
  })
}
