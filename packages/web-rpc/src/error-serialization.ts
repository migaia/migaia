import { safeRead } from './internal/safe-value.js';

/**
 * Cross-realm error shape (`docs/contracts/error-codes.md` §3.4). `Error` cannot survive
 * `structuredClone` with its prototype, so anything crossing a Worker/RPC/persistence boundary is
 * serialized to this plain record and rebuilt on the other side.
 */
export type ISerializedError = {
  readonly source: string;
  readonly code: string;
  /** Original constructor name, used to restore `AbortError`-style type checks. */
  readonly name: string;
  readonly message: string;
  /** Preserved verbatim; the receiving side must NOT regenerate it. */
  readonly stack?: string;
  readonly phase?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  /** Web-rpc 领域错误的结构化 `data`（`WebRpcRemoteError`/`WebRpcSchemaValidationError`），跨 realm 原样保留。 */
  readonly data?: unknown;
  /** Flattened `cause` chain + `AggregateError.errors` + `cleanupErrors[].error`, in reach order. */
  readonly causes?: readonly ISerializedError[];
};

/**
 * Walks the error graph the same way `error-codes.md` §3.2 specifies for cause-reachability: yield
 * the root, then `cause`, then every `cleanupErrors[].error`, then every `AggregateError.errors`
 * entry — each recursively. Cycle-guarded so a malformed cyclic chain terminates.
 */
export function* reachError(error: unknown): Generator<unknown> {
  yield error;
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return;
  const seen = new Set<object>([error as object]);
  yield* reachInner(error, seen);
}

function* reachInner(error: unknown, seen: Set<object>): Generator<unknown> {
  const cause = safeRead(error, 'cause');
  if (cause !== undefined && cause !== null) {
    yield cause;
    yield* visit(cause, seen);
  }
  const cleanupErrors = safeRead(error, 'cleanupErrors');
  if (Array.isArray(cleanupErrors)) {
    for (const entry of cleanupErrors) {
      const inner = safeRead(entry, 'error');
      if (inner !== undefined) {
        yield inner;
        yield* visit(inner, seen);
      }
    }
  }
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      yield inner;
      yield* visit(inner, seen);
    }
  }
}

function* visit(value: unknown, seen: Set<object>): Generator<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  if (seen.has(value)) return;
  seen.add(value);
  yield* reachInner(value, seen);
}

/** Serializes one error node without flattening its descendants. */
function serializeLeaf(error: unknown): ISerializedError {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return { source: '', code: '', name: 'Error', message: String(error) };
  }
  const source = safeRead(error, 'source');
  const code = safeRead(error, 'code');
  const name = safeRead(error, 'name');
  const message = safeRead(error, 'message');
  const stack = safeRead(error, 'stack');
  const phase = safeRead(error, 'phase');
  const detail = safeRead(error, 'detail');
  const data = safeRead(error, 'data');
  return {
    source: typeof source === 'string' ? source : '',
    code: typeof code === 'string' ? code : '',
    name: typeof name === 'string' ? name : 'Error',
    message: typeof message === 'string' ? message : String(error),
    ...(typeof stack === 'string' ? { stack } : {}),
    ...(typeof phase === 'string' ? { phase } : {}),
    ...(detail !== undefined ? { detail: detail as Readonly<Record<string, unknown>> } : {}),
    ...(data !== undefined ? { data } : {})
  };
}

/** Collects the flattened descendant list for `error` in §3.2 reach order. */
function collectCauses(error: unknown, seen: Set<object>): ISerializedError[] {
  const result: ISerializedError[] = [];
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return result;
  const cause = safeRead(error, 'cause');
  if (cause !== undefined && cause !== null) {
    result.push(serializeLeaf(cause));
    pushInner(cause, result, seen);
  }
  const cleanupErrors = safeRead(error, 'cleanupErrors');
  if (Array.isArray(cleanupErrors)) {
    for (const entry of cleanupErrors) {
      const inner = safeRead(entry, 'error');
      if (inner !== undefined) {
        result.push(serializeLeaf(inner));
        pushInner(inner, result, seen);
      }
    }
  }
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      result.push(serializeLeaf(inner));
      pushInner(inner, result, seen);
    }
  }
  return result;
}

function pushInner(value: unknown, result: ISerializedError[], seen: Set<object>): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  if (seen.has(value)) return;
  seen.add(value);
  result.push(...collectCauses(value, seen));
}

/** Serializes an error and its whole reachable graph into a plain, cross-realm-safe record. */
export function serializeError(error: unknown): ISerializedError {
  let root = serializeLeaf(error);
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return root;
  const causes = collectCauses(error, new Set([error as object]));
  if (causes.length > 0) root = { ...root, causes };
  return root;
}

/** Rebuilds one serialized node into a real `Error` without touching `stack`. */
function buildError(serialized: ISerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) {
    // Preserve the original stack verbatim; do not let the engine regenerate one.
    Object.defineProperty(error, 'stack', {
      value: serialized.stack,
      writable: true,
      configurable: true,
      enumerable: false
    });
  }
  Object.defineProperty(error, 'source', { value: serialized.source, enumerable: true });
  Object.defineProperty(error, 'code', { value: serialized.code, enumerable: true });
  if (serialized.phase !== undefined) {
    Object.defineProperty(error, 'phase', { value: serialized.phase, enumerable: true });
  }
  if (serialized.detail !== undefined) {
    Object.defineProperty(error, 'detail', { value: serialized.detail, enumerable: true });
  }
  if (serialized.data !== undefined) {
    Object.defineProperty(error, 'data', { value: serialized.data, enumerable: true });
  }
  return error;
}

function defineCause(target: Error, cause: Error): void {
  Object.defineProperty(target, 'cause', {
    value: cause,
    writable: true,
    configurable: true,
    enumerable: false
  });
}

/**
 * Rebuilds a serialized error graph into real `Error` objects, linking the flattened `causes` list
 * back into a singly-linked `cause` chain so a subsequent `serializeError()` round-trips to the
 * same flat list.
 */
export function deserializeError(serialized: ISerializedError): Error {
  const error = buildError(serialized);
  const causes = (serialized.causes ?? []).map(deserializeError);
  for (let i = 0; i < causes.length - 1; i++) defineCause(causes[i], causes[i + 1]);
  if (causes.length > 0) defineCause(error, causes[0]);
  return error;
}
