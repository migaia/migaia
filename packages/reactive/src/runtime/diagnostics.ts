import type {
  IObservable,
  IObserver,
  IRuntimeErrorContext,
  IRuntimeErrorReportContext,
  IRuntimeNodeDescriptor,
  IRuntimeNodeKind,
  IRuntimeTraceEvent
} from './types';

type INodeRole = 'observable' | 'observer';

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
  const settled = new Promise<unknown>((resolve, reject) => {
    try {
      Reflect.apply(then, value, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
  void settled.catch((error: unknown) => {
    try {
      onRejected(error);
    } catch {
      // This is the terminal diagnostic boundary.
    }
  });
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
