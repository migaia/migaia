import { ERROR_SOURCE } from './error-code.ts'
/** `source` value stamped onto every error this package throws. */
export const CAPABILITY_SOURCE = ERROR_SOURCE

/**
 * Shared error identity for the capability boundary. Source and code are attached as properties
 * without replacing the error. Checks such as `instanceof TypeError` and `instanceof RangeError`
 * keep their meaning.
 */
export type ICapabilityError = Error & {
  readonly source: string
  readonly code: string
}
