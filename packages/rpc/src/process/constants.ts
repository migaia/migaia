/** Stable body emitted for child stderr; raw chunks remain solely in supervision's reader. */
export const CHILD_STDERR_REDACTED = '[child stderr redacted]'

/** Reject oversized unauthenticated handshake frames at the length header. */
export const PROCESS_HANDSHAKE_MAX_FRAME_BYTES = 64 * 1024
