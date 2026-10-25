/**
 * Defines stable bounded shape diagnostics and operation-local failure identity for pure
 * inspectors. Inspectors retain original causes as data while callers own error construction and
 * reporting; this module retains no registry or resource lifetime.
 */
import { REMOTE_SHAPE_DETAIL_PATH_CHARS } from './limits.js'

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

/** One traversal's exact exit is data owned only by that synchronous operation. */
type IShapeFailure = Extract<IRpcShapeCheck<never>, { ok: false }>

/** Explicit parse context carries no timer, I/O, class instance or module-retained identity. */
export type IShapeInspection = {
  /** Only the currently running operation may recognize this exact bounded exit. */
  failure?: IShapeFailure
}

/** Stop this traversal with fixed diagnostics while retaining its original thrown cause. */
export function rejectShape(
  inspection: IShapeInspection,
  reason: RpcShapeReason,
  path: string,
  cause?: unknown
): never {
  inspection.failure = Object.freeze({
    ok: false as const,
    reason,
    path: path.slice(0, REMOTE_SHAPE_DETAIL_PATH_CHARS),
    ...(cause === undefined ? {} : { cause })
  })
  throw inspection.failure
}

/** Public diagnostic shape or strings never establish this invocation's local exit identity. */
export function isShapeFailure(
  inspection: IShapeInspection,
  value: unknown
): value is IShapeFailure {
  return inspection.failure !== undefined && value === inspection.failure
}

/** Each public shape check consumes one explicit operation-local context and retains no registry. */
export function inspectShape<T>(
  read: (inspection: IShapeInspection) => T,
  path = '$'
): IRpcShapeCheck<T> {
  /** Nested checks receive independent failure identity even when they return public diagnostics. */
  const inspection: IShapeInspection = {}
  try {
    return Object.freeze({ ok: true, value: read(inspection) })
  } catch (cause) {
    if (isShapeFailure(inspection, cause)) return cause
    return Object.freeze({ ok: false, reason: RpcShapeReason.portable, path, cause })
  }
}
