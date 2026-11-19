import { ERROR_SOURCE, type IPartRemoteErrorCode } from './error-code.ts'

/** Error carrying `(source, code)` plus optional fields, without replacing the native error. */
export type IPartRemoteError = Error & {
  readonly source: string
  readonly code: IPartRemoteErrorCode
}

/** Creates a tagged error; `fields` are attached as enumerable properties, `cause` is kept. */
export function createPartRemoteError(
  code: IPartRemoteErrorCode,
  message: string,
  cause?: unknown,
  fields: Readonly<Record<string, unknown>> = {}
): IPartRemoteError {
  /** One construction keeps stack and cause intact. */
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  for (const [key, value] of Object.entries(fields))
    Object.defineProperty(error, key, { value, enumerable: true })
  return error as IPartRemoteError
}
