import { SerializeErrorCode } from '../error-code.ts'
import { SERIALIZE_SOURCE } from '../errors.ts'
import { CodecErrorText } from '../codec-text.ts'

/** Construct a native error with package identity while retaining the original cause. */
export function createCodecError(
  code: (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode],
  message: string,
  cause?: unknown
): Error {
  /** The original native TypeError receives serialize identity without replacing its stack. */
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
