import { SerializeErrorCode } from '../error-code.js'
import { SERIALIZE_SOURCE } from '../errors.js'
import { CodecErrorText } from '../codec-text.js'

/** Construct a native error with package identity while retaining the original cause. */
export function createCodecError(
  code: (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode],
  message: string,
  cause?: unknown
): Error {
  const error = new TypeError(message, cause === undefined ? undefined : { cause })
  Object.defineProperty(error, 'source', { value: SERIALIZE_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

/** Validate format version and retain its literal type for factory callers. */
export function assertCodecVersion<const TVersion extends number>(version: TVersion): TVersion {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.invalidVersion)
  }
  return version
}
