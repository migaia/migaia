import type {
  IObservable,
  IObserver,
  IRuntimeErrorContext,
  IRuntimeErrorReportContext,
  IRuntimeNodeDescriptor,
  IRuntimeNodeKind,
  IRuntimeTraceEvent
} from './types.js';
import { ReactiveTracePhase, ReactiveTraceType } from './trace-constants.js';
import { assimilateThenable } from './receiver.js';

type INodeRole = 'observable' | 'observer';

/** Host callbacks used to contain every trace clock and sink failure at the diagnostic boundary. */
export type ITraceDiagnosticHost = {
  readonly timestamp: () => number;
  readonly emitTrace: (event: IRuntimeTraceEvent) => void;
  readonly reportError: (error: unknown) => void;
};

/** Host callbacks needed to keep one observer-run trace span failure-contained. */
export type IObserverRunTraceHost = ITraceDiagnosticHost & {
  readonly now: () => number;
};

/** Controls one observer-run trace span and prevents duplicate terminal events. */
export type IObserverRunTrace = {
  start(): void;
  end(): void;
  error(error: unknown): void;
};

const nodeDescriptors = new WeakMap<object, IRuntimeNodeDescriptor>();
const copiedDescriptors = new WeakMap<object, IRuntimeNodeDescriptor>();
let nextNodeId = 1;

const NODE_KINDS: ReadonlySet<string> = new Set<IRuntimeNodeKind>([
  'observable',
  'observer',
  'computed'
]);

/**
 * Diagnostic callbacks are typed `void`, but TypeScript intentionally accepts async functions
 * there. Contain a returned thenable without reading `then` twice, so diagnostics can never create
 * an unhandled rejection.
 */
export function containDiagnosticRejection(
  value: unknown,
  onRejected: (error: unknown) => void
): void {
  if ((value === null || typeof value !== 'object') && typeof value !== 'function') {
    return;
  }
  let then: unknown;
  try {
    then = (value as { then?: unknown }).then;
  } catch (error) {
    onRejected(error);
    return;
  }
  if (typeof then !== 'function') return;
  // Reuse the `then` we already read — `assimilateThenable` invokes it exactly once with the
  // thenable as receiver, so we never hand the value back to `Promise.resolve()` to read `.then`
  // twice (a stateful getter could return a different function or throw on the second read).
  const settled = assimilateThenable(then as (resolve: unknown, reject: unknown) => void, value);
  void settled.catch((error: unknown) => {
    try {
      onRejected(error);
    } catch {
      // This is the terminal diagnostic boundary.
    }
  });
}

/** Report a diagnostic failure without allowing a failing reporter to escape the boundary. */
function reportDiagnosticFailure(host: ITraceDiagnosticHost, error: unknown): void {
  try {
    host.reportError(error);
  } catch {
    // Reporting is already the terminal diagnostic boundary.
  }
}

/** Read one diagnostic clock and return a fallback sample when the host clock fails. */
export function readDiagnosticClock(
  read: () => number,
  fallback: number,
  reportFailure: (error: unknown) => void
): number {
  try {
    return read();
  } catch (error) {
    try {
      reportFailure(error);
    } catch {
      // Reporting is already the terminal diagnostic boundary.
    }
    return fallback;
  }
}

/** Emit one diagnostic event with timestamp and sink containment; never changes caller control flow. */
export function emitTraceSafely(
  host: ITraceDiagnosticHost,
  createEvent: (timestamp: number) => IRuntimeTraceEvent,
  fallbackTimestamp = 0
): void {
  const timestamp = readDiagnosticClock(host.timestamp, fallbackTimestamp, (error) =>
    reportDiagnosticFailure(host, error)
  );
  try {
    host.emitTrace(createEvent(timestamp));
  } catch (error) {
    reportDiagnosticFailure(host, error);
  }
}

/**
 * Creates a failure-contained observer-run trace span. Clock and sink failures are reported through
 * the existing diagnostic boundary, while fallback samples preserve a terminal event and never
 * replace the observer's primary error or lifecycle result.
 */
export function createObserverRunTrace(
  observer: IRuntimeNodeDescriptor,
  host: IObserverRunTraceHost
): IObserverRunTrace {
  /** Reports a diagnostic failure without allowing a failing reporter to escape this boundary. */
  const reportFailure = (error: unknown): void => {
    reportDiagnosticFailure(host, error);
  };

  /** Reads one diagnostic clock and reports failures before returning its fallback sample. */
  const readClock = (read: () => number, fallback: number): number => {
    return readDiagnosticClock(read, fallback, reportFailure);
  };

  /** Attempts one trace emission and reports failures without changing observer control flow. */
  const emit = (event: IRuntimeTraceEvent): void => {
    try {
      host.emitTrace(event);
    } catch (error) {
      reportFailure(error);
    }
  };

  /** Tracks whether this controller attempted its single start emission. */
  let started = false;
  /** Prevents catch/finally or reentrant callers from emitting two terminal events. */
  let terminal = false;
  /** Last valid monotonic sample used to calculate or recover terminal duration. */
  let startedAt = 0;
  /** Last valid event timestamp used to recover terminal event timestamps. */
  let startedTimestamp = 0;

  /** Emits exactly one start event, using zero when either start clock is unavailable. */
  const start = (): void => {
    if (started) return;
    started = true;
    startedAt = readClock(host.now, 0);
    startedTimestamp = readClock(host.timestamp, 0);
    emit({
      type: ReactiveTraceType.observerRun,
      timestamp: startedTimestamp,
      phase: ReactiveTracePhase.start,
      observer
    });
  };

  /** Emits one successful terminal event and ignores later terminal attempts. */
  const end = (): void => {
    if (!started || terminal) return;
    terminal = true;
    emit({
      type: ReactiveTraceType.observerRun,
      timestamp: readClock(host.timestamp, startedTimestamp),
      phase: ReactiveTracePhase.end,
      observer,
      durationMs: readClock(host.now, startedAt) - startedAt
    });
  };

  /** Emits one error terminal event while preserving the caller's original error identity. */
  const error = (primaryError: unknown): void => {
    if (!started || terminal) return;
    terminal = true;
    emit({
      type: ReactiveTraceType.observerRun,
      timestamp: readClock(host.timestamp, startedTimestamp),
      phase: ReactiveTracePhase.error,
      observer,
      durationMs: readClock(host.now, startedAt) - startedAt,
      error: primaryError
    });
  };

  return { start, end, error };
}

/**
 * Build the public identity for an internal graph node.
 *
 * The descriptor is cached and frozen: trace events can correlate edges by both object identity and
 * `id`, while diagnostics never expose the mutable node.
 */
function describeNode(node: object, role: INodeRole): IRuntimeNodeDescriptor {
  const existing = nodeDescriptors.get(node);
  if (existing) return existing;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(node);
  } catch {
    return anonymousDescriptor(role);
  }
  // `subs`/`deps` are intentionally accessors on built-in nodes so callers
  // cannot mutate the graph through a public Set. Use membership rather than
  // own-property descriptors; prototype accessors still identify the role.
  const observable = role === 'observable' || 'subs' in node;
  const observer = role === 'observer' || 'deps' in node;
  const kind: IRuntimeNodeKind =
    observable && observer ? 'computed' : observable ? 'observable' : 'observer';
  const debugNameDescriptor = descriptors.debugName;
  const debugName =
    debugNameDescriptor && 'value' in debugNameDescriptor ? debugNameDescriptor.value : undefined;
  const descriptor = Object.freeze({
    id: `reactive:${nextNodeId++}`,
    kind,
    ...(typeof debugName === 'string' ? { debugName } : {})
  });
  nodeDescriptors.set(node, descriptor);
  return descriptor;
}

export const describeObservable = (observable: IObservable): IRuntimeNodeDescriptor =>
  describeNode(observable, 'observable');

export const describeObserver = (observer: IObserver): IRuntimeNodeDescriptor =>
  describeNode(observer, 'observer');

/** Copy untrusted descriptors before publishing them to diagnostic callbacks. */
function sanitizeDescriptor(value: unknown, role: INodeRole): IRuntimeNodeDescriptor {
  if (typeof value !== 'object' || value === null) {
    return anonymousDescriptor(role);
  }
  const internal = nodeDescriptors.get(value);
  if (internal) return sanitizeDescriptor(internal, role);
  const copied = copiedDescriptors.get(value);
  if (copied) return copied;
  let properties: PropertyDescriptorMap;
  try {
    properties = Object.getOwnPropertyDescriptors(value);
  } catch {
    return anonymousDescriptor(role);
  }
  const dataValue = (name: string): unknown => {
    const descriptor = properties[name];
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const id = dataValue('id');
  const kind = dataValue('kind');
  const debugName = dataValue('debugName');
  // A raw reactive node has no public id. Describe it instead of copying any
  // internal fields, which also hardens direct JS calls to emitTrace/reportError.
  if (typeof id !== 'string' || typeof kind !== 'string' || !NODE_KINDS.has(kind)) {
    try {
      return sanitizeDescriptor(describeNode(value, role), role);
    } catch {
      return anonymousDescriptor(role);
    }
  }
  const descriptor = Object.freeze({
    id,
    kind: kind as IRuntimeNodeKind,
    ...(typeof debugName === 'string' ? { debugName } : {})
  });
  copiedDescriptors.set(value, descriptor);
  return descriptor;
}

/** Metadata poisoning must degrade diagnostics, never suppress the error. */
function anonymousDescriptor(role: INodeRole): IRuntimeNodeDescriptor {
  return Object.freeze({
    id: `reactive:${nextNodeId++}`,
    kind: role
  });
}

/** Normalize a public trace event into an immutable, graph-safe snapshot. */
export function sanitizeTraceEvent(event: IRuntimeTraceEvent): IRuntimeTraceEvent {
  switch (event.type) {
    case 'observable-change':
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        observable: sanitizeDescriptor(event.observable, 'observable'),
        reason: event.reason
      });
    case 'dependency':
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        phase: event.phase,
        observable: sanitizeDescriptor(event.observable, 'observable'),
        observer: sanitizeDescriptor(event.observer, 'observer'),
        ...(event.reason === undefined ? {} : { reason: event.reason })
      });
    case 'observer-run':
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        phase: event.phase,
        observer: sanitizeDescriptor(event.observer, 'observer'),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.error === undefined ? {} : { error: event.error })
      });
    case 'action':
      return Object.freeze({
        type: event.type,
        timestamp: event.timestamp,
        phase: event.phase,
        name: event.name,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.error === undefined ? {} : { error: event.error })
      });
  }
}

/** Normalize error metadata before it crosses the Runtime callback boundary. */
export function sanitizeErrorContext(context: IRuntimeErrorReportContext): IRuntimeErrorContext {
  return Object.freeze({
    phase: context.phase,
    ...(context.observer === undefined
      ? {}
      : {
          observer: sanitizeDescriptor(context.observer, 'observer')
        }),
    ...(context.observable === undefined
      ? {}
      : {
          observable: sanitizeDescriptor(context.observable, 'observable')
        })
  });
}
