import { attachErrorIdentity } from '@migaia/utils/error'
import { SUPERVISION_SOURCE, type ISupervisionErrorCode } from './error-code.js'

/** Native constructors retained so callers can branch on TypeError and RangeError. */
export type ISupervisionErrorConstructor =
  | ErrorConstructor
  | TypeErrorConstructor
  | RangeErrorConstructor

/** Constructs a native error and adds the package semantic identity without replacing it. */
export function createSupervisionError(
  Constructor: ISupervisionErrorConstructor,
  code: ISupervisionErrorCode,
  text: string,
  options: { readonly cause?: unknown; readonly detail?: Readonly<Record<string, unknown>> } = {}
): Error {
  const error =
    options.cause === undefined
      ? new Constructor(text)
      : new Constructor(text, { cause: options.cause })
  return attachErrorIdentity(error, {
    source: SUPERVISION_SOURCE,
    code,
    ...(options.detail === undefined ? {} : { detail: options.detail })
  })
}
