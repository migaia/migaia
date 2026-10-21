import { attachErrorIdentity } from '@migaia/utils/error'
import { MicroHubErrorCode, type IMicroHubErrorCode } from './error-code.js'

export { MicroHubErrorCode, type IMicroHubErrorCode }

/** `source` attached to every error this package creates; registry rows use the same value. */
export const MICRO_HUB_SOURCE = '@migaia/micro-hub'

/** Options shared by the error factories; `cause` keeps the original error reachable. */
type IErrorOptions = { readonly cause?: unknown }

/** Converts optional factory options to native `ErrorOptions` only when a cause was given. */
const nativeOptions = (options: IErrorOptions | undefined): ErrorOptions | undefined =>
  options !== undefined && Object.hasOwn(options, 'cause') ? { cause: options.cause } : undefined

/** Builds a `(source, code)`-tagged `Error`; the stack is the construction site. */
export function createMicroHubError(
  code: IMicroHubErrorCode,
  message: string,
  options?: IErrorOptions
): Error {
  return attachErrorIdentity(new Error(message, nativeOptions(options)), {
    source: MICRO_HUB_SOURCE,
    code
  })
}

/** Builds a `(source, code)`-tagged `TypeError`, keeping the native type callers branch on. */
export function createMicroHubTypeError(
  code: IMicroHubErrorCode,
  message: string,
  options?: IErrorOptions
): TypeError {
  return attachErrorIdentity(new TypeError(message, nativeOptions(options)), {
    source: MICRO_HUB_SOURCE,
    code
  })
}
