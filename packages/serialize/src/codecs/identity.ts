import type { ICodec } from '../codec.js'

/**
 * Frozen identity/v1 codec for whole-frame transports that already carry values directly. Encode
 * and decode return the exact supplied value, including nonportable values; they do not clone,
 * validate, or freeze it. This entry imports no optional format runtime.
 */
export const identityCodec = Object.freeze({
  /** Stable whole-frame format identity. */
  id: 'identity',
  /** Fixed owner revision exposed by the versioned entry. */
  version: 1,
  /** No representation conversion is performed. */
  encodedType: 'unknown',
  /** Returns the original input without serialization. */
  encode: <T>(value: T): T => value,
  /** Returns the original frame without parsing. */
  decode: <T>(value: T): T => value
} satisfies ICodec<unknown, unknown, 'identity', 1>)
