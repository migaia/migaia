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
