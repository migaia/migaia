import { REMOTE_SHAPE_DETAIL_PATH_CHARS } from './constants.js'

/** Stable diagnostics identify shape failures without copying untrusted input into messages. */
export const RpcShapeReason = {
  /** A closed object has an unsupported runtime shape or prototype. */ record: 'record',
  /** An object contains a field outside its registered shape. */ 'unknown-field': 'unknown-field',
  /** A mandatory registered field is absent. */ 'missing-field': 'missing-field',
  /** A declared routing segment does not match the shared grammar. */ name: 'name',
  /** A catalog exceeds the admitted plugin count before entry reads. */ 'plugins-limit':
    'plugins-limit',
  /** A contract exceeds the admitted feature count before entry reads. */ 'features-limit':
    'features-limit',
  /** A feature exceeds the admitted method count before entry reads. */ 'methods-limit':
    'methods-limit',
  /** A catalog exceeds the aggregate admitted method count. */ 'catalog-methods-limit':
    'catalog-methods-limit',
  /** A description uses a version outside its registered grammar. */ version: 'version',
  /** A required contract, feature or catalog table is empty. */ 'empty-table': 'empty-table',
  /** A declared method uses an unsupported execution mode. */ 'method-mode': 'method-mode',
  /** A method's replay declaration is missing, invalid or incompatible with its mode. */ idempotency:
    'idempotency',
  /** A catalog key disagrees with the corresponding plugin declaration. */ 'catalog-plugin':
    'catalog-plugin',
  /** A control result contains an unsupported enablement state. */ 'control-state':
    'control-state',
  /** A control result contains an invalid revision counter. */ 'control-revision':
    'control-revision',
  /** A control result contains an invalid feature list. */ 'control-features': 'control-features',
  /** A reserved control payload has an invalid operation-specific shape. */ control: 'control',
  /** The existing portable owner rejects input or its property access throws. */ portable:
    'portable',
  /** A runtime node identity is outside the negotiated wire domain. */ 'runtime-node':
    'runtime-node',
  /** A runtime directory has an invalid method table. */ 'runtime-methods': 'runtime-methods',
  /** A runtime connection identity violates its identifier budget. */ 'runtime-identity':
    'runtime-identity',
  /** A forwarded directory entry has an invalid immediate connection name. */ 'runtime-forward':
    'runtime-forward',
  /** A runtime method name is invalid or repeated. */ 'runtime-method': 'runtime-method',
  /** A runtime route has no valid unique set of supported operation modes. */ 'runtime-modes':
    'runtime-modes',
  /** A runtime route does not identify its declaration source. */ 'runtime-mode-source':
    'runtime-mode-source',
  /** An optional runtime replay declaration is not boolean. */ 'runtime-idempotency':
    'runtime-idempotency',
  /** A schema violates the registered JSON Schema subset or local reference boundary. */ schema:
    'schema',
  /** The JSON-RPC profile cannot carry a declared stream route. */ 'jsonrpc-stream':
    'jsonrpc-stream'
} as const

/** A diagnostic reason has one registered semantic meaning. */
export type RpcShapeReason = keyof typeof RpcShapeReason

/** A successful snapshot or a bounded diagnostic; callers retain their own error factories. */
export type IRpcShapeCheck<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: RpcShapeReason; path: string; cause?: unknown }>

/** Only locally minted diagnostic records participate in internal short-circuiting. */
const failures = new WeakSet<object>()

/** Stop one private traversal without constructing an error or exposing a public throw path. */
export function rejectShape(reason: RpcShapeReason, path: string, cause?: unknown): never {
  /** Paths contain only admitted routing segments or fixed schema placeholders. */
  const failure = Object.freeze({
    ok: false as const,
    reason,
    path: path.slice(0, REMOTE_SHAPE_DETAIL_PATH_CHARS),
    ...(cause === undefined ? {} : { cause })
  })
  failures.add(failure)
  throw failure
}

/** Identify only this module's private traversal records, never caller-shaped diagnostics. */
export function isShapeFailure(
  value: unknown
): value is Extract<IRpcShapeCheck<never>, { ok: false }> {
  return typeof value === 'object' && value !== null && failures.has(value)
}

/** Convert private traversal exits and original thrown access failures into nonthrowing data. */
export function inspectShape<T>(read: () => T, path = '$'): IRpcShapeCheck<T> {
  try {
    return Object.freeze({ ok: true, value: read() })
  } catch (cause) {
    if (isShapeFailure(cause)) {
      // A returned diagnostic becomes caller data, so later throws retain it as their cause.
      failures.delete(cause)
      return cause
    }
    return Object.freeze({ ok: false, reason: RpcShapeReason.portable, path, cause })
  }
}
