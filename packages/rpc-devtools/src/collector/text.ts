import { RpcProbeStage, RpcProbeStageName } from '@migaia/rpc-core/probe'

/** Collector-owned diagnostics and service vocabulary stay stable across local and remote calls. */
export const CollectorText = {
  /** Construction and query validation report a domain failure without exposing input values. */
  invalidOption: 'invalid rpc devtools option',
  /** Terminal instances never revive retained storage or watcher ownership. */
  closed: 'rpc devtools collector is closed',
  /** A collector owns at most one recording ring at a time. */
  recordActive: 'rpc devtools recording is already active',
  /** A recording handle may stop only its own currently active recording. */
  recordNotActive: 'rpc devtools recording is not active',
  /** Content is discarded while the original redactor failure remains on cause. */
  redactFailed: 'rpc devtools redaction failed',
  /** Overflow id zero is intentionally distinguishable from absent optional fields. */
  overflow: '<overflow>',
  /** Service describes the frozen v1 observation/record boundary. */
  version: '1',
  /** Native cancellation names supplement the Core source/code identity at observation boundaries. */
  abortName: 'AbortError',
  /** Native deadline names supplement the Core source/code identity at observation boundaries. */
  timeoutName: 'TimeoutError'
} as const

/** Capacity defaults are construction-only; hot ingestion reads preallocated columns. */
export const CollectorLimit = {
  /** Sparse reference columns use JavaScript Array lengths, bounded by the language domain. */
  arrayCapacity: 0xffffffff,
  /** Endpoint * stride + method must remain an exact integer for every supported intern id. */
  pairCapacity: Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER)) - 1,
  events: 10_000,
  contentBytes: 8 * 1024 * 1024,
  interned: 65_536,
  query: 1000,
  batch: 256,
  batches: 64,
  histogram: 24
} as const

/**
 * Default observation keeps message/control and peer lifecycle events; physical stages are explicit
 * opt-in.
 */
export const CollectorDefaultStages = [
  RpcProbeStageName[RpcProbeStage.message],
  RpcProbeStageName[RpcProbeStage.peer]
] as const
