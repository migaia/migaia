/** Public persistence hydration, write and terminal status vocabulary. */
export const PersistState = {
  /** No write/removal is currently running; hydration has its own independent phase. */
  idle: 'idle',
  /** An initial or recovery hydration attempt is reading/restoring the archive. */
  loading: 'loading',
  /** A serialized write or removal is executing. */
  writing: 'writing',
  /** Combined status after successful hydration without a retained hydration/write error. */
  ready: 'ready',
  /** Hydration completed, including a missing archive that required no restoration. */
  success: 'success',
  /** The corresponding hydration/write lane retains a failure; inspect its error value. */
  error: 'error',
  /** The attachment has retired; an unawaited final write may still settle afterwards. */
  disposed: 'disposed'
} as const

/** Persistence codec representations. */
export const PersistCodecOutput = {
  /** Encoded strings use the storage text channel. */
  text: 'text',
  /** Structured records need a richer storage channel and are rejected by persistence writes. */
  structured: 'structured',
  /** Intrinsic Uint8Array output uses the byte channel when the backend advertises support. */
  binary: 'binary'
} as const

/** Stable observation operation names at the persistence codec boundary. */
export const PersistCodecOperation = {
  /** One complete envelope conversion preceding a backend write. */
  encode: 'persist.encode',
  /** One archived envelope conversion after a successful backend read. */
  decode: 'persist.decode'
} as const

/** Full public vocabulary; each handle status uses only its relevant subset. */
export type IPersistState = (typeof PersistState)[keyof typeof PersistState]
