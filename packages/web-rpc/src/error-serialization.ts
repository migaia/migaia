import { safeRead, safeString } from './internal/safe-value.js';
import { WebRpcSerializationError } from './errors.js';

/** Maximum error-graph depth accepted by either boundary direction. */
const MAX_ERROR_GRAPH_DEPTH = 64;
/** Maximum serialized error records allocated by either boundary direction. */
const MAX_ERROR_GRAPH_NODES = 1024;
/** Stable diagnostic for malformed or over-budget error graphs. */
const SERIALIZED_ERROR_GRAPH_INVALID =
  'Serialized error graph exceeds safety limits or is malformed';

/**
 * Cross-realm error record. Serialization rejects an over-budget graph with existing coded
 * `PAYLOAD_INVALID`; it never returns partial or unbounded record.
 */
export type ISerializedError = {
  readonly source: string;
  readonly code: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly phase?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly data?: unknown;
  readonly errors?: readonly ISerializedError[];
  readonly causes?: readonly ISerializedError[];
};

type ISourceSnapshot = {
  readonly source: string;
  readonly code: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly phase?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly data?: unknown;
  readonly cause?: unknown;
  readonly cleanup: readonly unknown[];
  readonly aggregate: readonly unknown[] | undefined;
};

type ISerializedSnapshot = Omit<ISerializedError, 'errors' | 'causes'> & {
  readonly errors?: readonly ISerializedSnapshot[];
  readonly causes?: readonly ISerializedSnapshot[];
};

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function readArrayOnce(value: unknown): readonly unknown[] | undefined {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch (cause) {
    throwMalformedSerializedError(cause);
  }
  if (!isArray) return undefined;

  try {
    const lengthValue = (value as readonly unknown[]).length;
    if (
      typeof lengthValue !== 'number' ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < 0 ||
      lengthValue > MAX_ERROR_GRAPH_NODES
    ) {
      throwMalformedSerializedError();
    }
    const result: unknown[] = [];
    for (let index = 0; index < lengthValue; index++)
      result.push((value as readonly unknown[])[index]);
    return result;
  } catch (cause) {
    if (cause instanceof WebRpcSerializationError) throw cause;
    throwMalformedSerializedError(cause);
  }
}

/**
 * Classifies and snapshots native aggregate entries once; hostile traps become coded boundary
 * errors.
 */
function readAggregateEntries(value: unknown): readonly unknown[] | undefined {
  let aggregateValue: unknown;
  try {
    if (!(value instanceof AggregateError)) return undefined;
    aggregateValue = value.errors;
  } catch (cause) {
    throw new WebRpcSerializationError(SERIALIZED_ERROR_GRAPH_INVALID, cause);
  }
  return readArrayOnce(aggregateValue);
}

function sourceChildren(snapshot: ISourceSnapshot): readonly unknown[] {
  return [
    ...(snapshot.cause === undefined || snapshot.cause === null ? [] : [snapshot.cause]),
    ...snapshot.cleanup,
    ...(snapshot.aggregate ?? [])
  ];
}

/** Reads every source property once and stores results in an owned snapshot. */
function snapshotSource(
  value: unknown,
  snapshots: Map<object, ISourceSnapshot>,
  active: Set<object>,
  depth: number
): ISourceSnapshot | undefined {
  if (!isObjectLike(value)) return undefined;
  if (depth > MAX_ERROR_GRAPH_DEPTH) throwMalformedSerializedError();
  const object = value as object;
  const existing = snapshots.get(object);
  if (existing !== undefined) return existing;
  if (snapshots.size >= MAX_ERROR_GRAPH_NODES) throwMalformedSerializedError();

  const sourceValue = safeRead(value, 'source');
  const codeValue = safeRead(value, 'code');
  const nameValue = safeRead(value, 'name');
  const messageValue = safeRead(value, 'message');
  const stackValue = safeRead(value, 'stack');
  const phaseValue = safeRead(value, 'phase');
  const detailValue = safeRead(value, 'detail');
  const dataValue = safeRead(value, 'data');
  const causeValue = safeRead(value, 'cause');
  const cleanupValue = safeRead(value, 'cleanupErrors');
  const cleanupEntries = readArrayOnce(cleanupValue) ?? [];
  const cleanup = cleanupEntries.map((entry) => safeRead(entry, 'error'));
  const snapshot: ISourceSnapshot = {
    source: typeof sourceValue === 'string' ? sourceValue : '',
    code: typeof codeValue === 'string' ? codeValue : '',
    name: typeof nameValue === 'string' ? nameValue : 'Error',
    message: typeof messageValue === 'string' ? messageValue : safeString(value),
    ...(typeof stackValue === 'string' ? { stack: stackValue } : {}),
    ...(typeof phaseValue === 'string' ? { phase: phaseValue } : {}),
    ...(detailValue !== undefined
      ? { detail: detailValue as Readonly<Record<string, unknown>> }
      : {}),
    ...(dataValue !== undefined ? { data: dataValue } : {}),
    ...(causeValue !== undefined ? { cause: causeValue } : {}),
    cleanup,
    aggregate: readAggregateEntries(value)
  };
  snapshots.set(object, snapshot);
  if (active.has(object)) return snapshot;
  active.add(object);
  for (const child of sourceChildren(snapshot)) snapshotSource(child, snapshots, active, depth + 1);
  active.delete(object);
  return snapshot;
}

/** Walks cause, cleanup, and aggregate edges in contract-defined reach order. */
export function* reachError(error: unknown): Generator<unknown> {
  yield error;
  if (!isObjectLike(error)) return;
  const snapshots = new Map<object, ISourceSnapshot>();
  snapshotSource(error, snapshots, new Set<object>(), 0);
  const seen = new Set<object>([error]);
  const pending: unknown[] = sourceChildren(snapshots.get(error)!).slice().reverse();
  while (pending.length > 0) {
    const current = pending.pop();
    yield current;
    if (!isObjectLike(current) || seen.has(current)) continue;
    seen.add(current);
    const snapshot = snapshots.get(current);
    if (snapshot !== undefined) pending.push(...sourceChildren(snapshot).slice().reverse());
  }
}

type ISerializationState = { nodes: number };

function serializePrimitive(value: unknown): ISerializedError {
  return { source: '', code: '', name: 'Error', message: safeString(value) };
}

function serializeSnapshot(
  snapshot: ISourceSnapshot,
  snapshots: Map<object, ISourceSnapshot>,
  state: ISerializationState,
  depth: number,
  active: Set<ISourceSnapshot>,
  includeCauseGraph = false
): ISerializedError {
  if (depth > MAX_ERROR_GRAPH_DEPTH || state.nodes >= MAX_ERROR_GRAPH_NODES) {
    throwMalformedSerializedError();
  }
  state.nodes++;
  const base = {
    source: snapshot.source,
    code: snapshot.code,
    name: snapshot.name,
    message: snapshot.message,
    ...(snapshot.stack !== undefined ? { stack: snapshot.stack } : {}),
    ...(snapshot.phase !== undefined ? { phase: snapshot.phase } : {}),
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
    ...(snapshot.data !== undefined ? { data: snapshot.data } : {})
  };
  const aggregate = snapshot.aggregate;
  if (active.has(snapshot)) return aggregate === undefined ? base : { ...base, errors: [] };
  active.add(snapshot);
  const nestedCauses = includeCauseGraph
    ? [
        ...(snapshot.cause === undefined || snapshot.cause === null ? [] : [snapshot.cause]),
        ...snapshot.cleanup
      ].map((child) => {
        if (!isObjectLike(child)) return serializePrimitive(child);
        const childSnapshot = snapshots.get(child);
        if (childSnapshot === undefined) throwMalformedSerializedError();
        return serializeSnapshot(childSnapshot, snapshots, state, depth + 1, active, true);
      })
    : undefined;
  if (aggregate === undefined) {
    active.delete(snapshot);
    return {
      ...base,
      ...(nestedCauses !== undefined && nestedCauses.length > 0 ? { causes: nestedCauses } : {})
    };
  }
  const errors = aggregate.map((child) => {
    if (!isObjectLike(child)) return serializePrimitive(child);
    const childSnapshot = snapshots.get(child);
    if (childSnapshot === undefined) throwMalformedSerializedError();
    return serializeSnapshot(childSnapshot, snapshots, state, depth + 1, active, true);
  });
  active.delete(snapshot);
  return {
    ...base,
    ...(nestedCauses !== undefined && nestedCauses.length > 0 ? { causes: nestedCauses } : {}),
    errors
  };
}

/** Serializes bounded snapshots; overflow deterministically throws coded `PAYLOAD_INVALID`. */
export function serializeError(error: unknown): ISerializedError {
  if (!isObjectLike(error)) return serializePrimitive(error);
  const snapshots = new Map<object, ISourceSnapshot>();
  snapshotSource(error, snapshots, new Set<object>(), 0);
  const state: ISerializationState = { nodes: 0 };
  const rootSnapshot = snapshots.get(error)!;
  const includeNestedCauseGraph = rootSnapshot.aggregate !== undefined;
  let root = serializeSnapshot(rootSnapshot, snapshots, state, 0, new Set());
  const causes: ISerializedError[] = [];
  const seen = new Set<object>([error]);
  const pending: unknown[] = sourceChildren(rootSnapshot).slice().reverse();
  while (pending.length > 0) {
    const current = pending.pop();
    if (isObjectLike(current)) {
      const snapshot = snapshots.get(current);
      if (snapshot === undefined) throwMalformedSerializedError();
      causes.push(
        serializeSnapshot(snapshot, snapshots, state, 0, new Set(), includeNestedCauseGraph)
      );
      if (!seen.has(current)) {
        seen.add(current);
        pending.push(...sourceChildren(snapshot).slice().reverse());
      }
    } else {
      causes.push(serializePrimitive(current));
    }
  }
  if (causes.length > 0) root = { ...root, causes };
  return root;
}

function buildError(serialized: ISerializedSnapshot, children: readonly Error[] = []): Error {
  const domException = (
    globalThis as typeof globalThis & {
      DOMException?: new (message?: string, name?: string) => Error;
    }
  ).DOMException;
  const error =
    serialized.name === 'AggregateError'
      ? new AggregateError(children, serialized.message)
      : serialized.name === 'TypeError'
        ? new TypeError(serialized.message)
        : serialized.name === 'RangeError'
          ? new RangeError(serialized.message)
          : serialized.name === 'SyntaxError'
            ? new SyntaxError(serialized.message)
            : serialized.name === 'ReferenceError'
              ? new ReferenceError(serialized.message)
              : serialized.name === 'URIError'
                ? new URIError(serialized.message)
                : serialized.name === 'EvalError'
                  ? new EvalError(serialized.message)
                  : serialized.name === 'AbortError' && typeof domException === 'function'
                    ? new domException(serialized.message, 'AbortError')
                    : new Error(serialized.message);
  if (error.name !== serialized.name)
    Object.defineProperty(error, 'name', {
      value: serialized.name,
      writable: true,
      configurable: true
    });
  if (serialized.stack !== undefined) {
    Object.defineProperty(error, 'stack', {
      value: serialized.stack,
      writable: true,
      configurable: true
    });
  } else {
    Reflect.deleteProperty(error, 'stack');
  }
  Object.defineProperty(error, 'source', { value: serialized.source, enumerable: true });
  Object.defineProperty(error, 'code', { value: serialized.code, enumerable: true });
  if (serialized.phase !== undefined)
    Object.defineProperty(error, 'phase', { value: serialized.phase, enumerable: true });
  if (serialized.detail !== undefined)
    Object.defineProperty(error, 'detail', { value: serialized.detail, enumerable: true });
  if (serialized.data !== undefined)
    Object.defineProperty(error, 'data', { value: serialized.data, enumerable: true });
  return error;
}

function defineCause(target: Error, cause: Error): void {
  Object.defineProperty(target, 'cause', { value: cause, writable: true, configurable: true });
}

/** Compares wire snapshots by owned graph shape after structured cloning removed identity. */
function serializedNodeEqual(left: ISerializedSnapshot, right: ISerializedSnapshot): boolean {
  if (
    left.source !== right.source ||
    left.code !== right.code ||
    left.name !== right.name ||
    left.message !== right.message ||
    left.stack !== right.stack
  )
    return false;
  const leftCauses = left.causes ?? [];
  const rightCauses = right.causes ?? [];
  const leftErrors = left.errors ?? [];
  const rightErrors = right.errors ?? [];
  return (
    leftCauses.length === rightCauses.length &&
    leftErrors.length === rightErrors.length &&
    leftCauses.every((child, index) => serializedNodeEqual(child, rightCauses[index]!)) &&
    leftErrors.every((child, index) => serializedNodeEqual(child, rightErrors[index]!))
  );
}

/** Lists one serialized node's diagnostic reach in source traversal order. */
function serializedReach(node: ISerializedSnapshot): ISerializedSnapshot[] {
  const reached = [node];
  for (const cause of node.causes ?? []) reached.push(...serializedReach(cause));
  for (const child of node.errors ?? []) reached.push(...serializedReach(child));
  return reached;
}

/** Removes aggregate children already represented by nested `errors` graphs from flat causes. */
function removeAggregateErrorReach(
  causes: readonly ISerializedSnapshot[],
  errors: readonly ISerializedSnapshot[]
): ISerializedSnapshot[] {
  const remaining = [...causes];
  for (const error of errors) {
    const reach = serializedReach(error);
    for (let start = remaining.length - reach.length; start >= 0; start--) {
      if (reach.every((entry, index) => serializedNodeEqual(entry, remaining[start + index]!))) {
        remaining.splice(start, reach.length);
        break;
      }
    }
  }
  return remaining;
}

function snapshotSerializedGraph(serialized: unknown): {
  root: ISerializedSnapshot;
  records: ISerializedSnapshot[];
} {
  const snapshots = new Map<object, ISerializedSnapshot>();
  const active = new Set<object>();
  const records: ISerializedSnapshot[] = [];
  const visit = (value: unknown, depth: number): ISerializedSnapshot => {
    if (!isObjectLike(value) || depth > MAX_ERROR_GRAPH_DEPTH) throwMalformedSerializedError();
    const object = value as object;
    const existing = snapshots.get(object);
    if (existing !== undefined) {
      if (active.has(object)) throwMalformedSerializedError();
      return existing;
    }
    if (snapshots.size >= MAX_ERROR_GRAPH_NODES) throwMalformedSerializedError();
    const source = safeRead(value, 'source');
    const code = safeRead(value, 'code');
    const name = safeRead(value, 'name');
    const message = safeRead(value, 'message');
    const stack = safeRead(value, 'stack');
    const phase = safeRead(value, 'phase');
    const detail = safeRead(value, 'detail');
    const data = safeRead(value, 'data');
    const errorsValue = safeRead(value, 'errors');
    const causesValue = safeRead(value, 'causes');
    if (
      typeof source !== 'string' ||
      typeof code !== 'string' ||
      typeof name !== 'string' ||
      typeof message !== 'string'
    )
      throwMalformedSerializedError();
    const errors = readArrayOnce(errorsValue);
    const causes = readArrayOnce(causesValue);
    if (errorsValue !== undefined && errors === undefined) throwMalformedSerializedError();
    if (causesValue !== undefined && causes === undefined) throwMalformedSerializedError();
    const base: ISerializedSnapshot = {
      source,
      code,
      name,
      message,
      ...(typeof stack === 'string' ? { stack } : {}),
      ...(typeof phase === 'string' ? { phase } : {}),
      ...(detail !== undefined ? { detail: detail as Readonly<Record<string, unknown>> } : {}),
      ...(data !== undefined ? { data } : {})
    };
    snapshots.set(object, base);
    active.add(object);
    const ownedErrors = errors?.map((child) => visit(child, depth + 1));
    const ownedCauses = causes?.map((child) => visit(child, depth + 1));
    active.delete(object);
    const owned = {
      ...base,
      ...(ownedErrors !== undefined ? { errors: ownedErrors } : {}),
      ...(ownedCauses !== undefined ? { causes: ownedCauses } : {})
    };
    snapshots.set(object, owned);
    records.push(owned);
    return owned;
  };
  return { root: visit(serialized, 0), records };
}

/** Rebuilds only owned snapshots; hostile wire getters are never read during reconstruction. */
export function deserializeError(serialized: ISerializedError): Error {
  const { root, records } = snapshotSerializedGraph(serialized);
  const rebuilt = new Map<ISerializedSnapshot, Error>();
  for (const node of records) {
    rebuilt.set(node, buildError(node, node.errors?.map((entry) => rebuilt.get(entry)!) ?? []));
  }
  for (const node of records) {
    const error = rebuilt.get(node)!;
    const causes =
      error instanceof AggregateError && node.errors !== undefined
        ? removeAggregateErrorReach(node.causes ?? [], node.errors)
        : [...(node.causes ?? [])];
    for (let index = 0; index < causes.length - 1; index++)
      defineCause(rebuilt.get(causes[index])!, rebuilt.get(causes[index + 1])!);
    if (causes.length > 0) defineCause(error, rebuilt.get(causes[0])!);
  }
  return rebuilt.get(root)!;
}

/** Throws existing coded payload error for malformed or over-budget graphs. */
function throwMalformedSerializedError(cause?: unknown): never {
  throw new WebRpcSerializationError(SERIALIZED_ERROR_GRAPH_INVALID, cause);
}
