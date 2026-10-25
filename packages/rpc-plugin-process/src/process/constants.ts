/**
 * Owns Process bootstrap markers and bounds, stderr redaction limits, the default namespace and
 * actual byte-carrier facts. These stable native values do not define another RPC semantic
 * profile.
 */
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding
} from '@migaia/rpc-contract/interfaces'

/** Stable body emitted for child stderr; raw chunks remain solely in supervision's reader. */
export const CHILD_STDERR_REDACTED = '[child stderr redacted]'

/** Reject oversized unauthenticated handshake frames at the length header. */
export const PROCESS_HANDSHAKE_MAX_FRAME_BYTES = 64 * 1024

/** Nonsecret discovery selects the library bootstrap; authentication still requires its token. */
export const PROCESS_RUNTIME_API_ENV = 'MIGAIA_RPC_RUNTIME_API_BOOTSTRAP'
/** Only this discovery version selects the independent first-frame envelope. */
export const PROCESS_RUNTIME_API_ENV_VERSION = '1'
/** Bootstrap metadata has its own profile and never changes frozen RPC handshake grammar. */
export const PROCESS_RUNTIME_API_BOOTSTRAP_KIND = 'rpc-runtime-api-bootstrap'
/** Both launch and child admission require this private metadata version. */
export const PROCESS_RUNTIME_API_BOOTSTRAP_VERSION = 1
/** Launcher-owned monotonic identities distinguish opt-in launches without exposing native PIDs. */
export const PROCESS_RUNTIME_API_FINGERPRINT_PREFIX = 'rpc-process-'
/** Discovery has a bounded wait before the original ordinary handshake deadline starts. */
export const PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS = 10_000

/** This private native token gate precedes Session codec/handshake and carries no RPC negotiation. */
export const PROCESS_CONNECTION_BOOTSTRAP_KIND = 'rpc-process-connection'
/** Native admission has one fixed record version independent of the semantic RPC profile. */
export const PROCESS_CONNECTION_BOOTSTRAP_VERSION = 1
/** Connection bootstrap requests/replies use fixed steps without owning a second RPC handshake. */
export const ProcessConnectionBootstrapStep = {
  hello: 'hello',
  accept: 'accept',
  reject: 'reject'
} as const
/** The fixed native admission steps do not grant any semantic RPC negotiation authority. */
export type ProcessConnectionBootstrapStep = keyof typeof ProcessConnectionBootstrapStep
/** Native peer metadata matches the current Host's portable JavaScript runtime label. */
export const PROCESS_CONNECTION_RUNTIME = 'javascript'

/** Fixed session log quota; USEGUIDE documents normal records separately from one overflow summary. */
export const PROCESS_STDERR_EVENT_BUDGET = 32
/** Session diagnostics reset every second using the connection's existing monotonic scheduler. */
export const PROCESS_STDERR_INTERVAL_MS = 1000

/** The default native transport namespace and plugin identity remain stable across the clean cut. */
export const PROCESS_NAMESPACE = 'process'

/** Native stdio and sockets deliver original byte chunks through one acquired direct connection. */
export const ProcessByteCarrierFacts = Object.freeze({
  platform: RpcCarrierPlatform.process,
  topology: RpcCarrierTopology.exclusive,
  encodedType: RpcCarrierEncoding.uint8Array
})
