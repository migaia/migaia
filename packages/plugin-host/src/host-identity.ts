import ERROR_TEXT, { createPluginHostTypeError } from './error-text.js'

/** Public, immutable identity assigned by this module to one Host surface. */
export type IPluginHostIdentity = Readonly<{
  /** Human-readable label supplied by the caller, or `DEFAULT` when omitted. */
  readonly name: string
  /** Process-local identifier issued from this module's monotonic sequence. */
  readonly id: string
}>

/** Module-private identity authority; entries disappear with their Host targets. */
const identities = new WeakMap<object, IPluginHostIdentity>()
/** Monotonic process-local sequence used only after an identity name passes validation. */
let issued = 0

/** Validates, issues, freezes, and records one identity for an exact Host target. */
export const issueHostIdentity = (host: object, name = 'DEFAULT'): IPluginHostIdentity => {
  if (typeof name !== 'string' || name.length === 0)
    throw createPluginHostTypeError(ERROR_TEXT.HOST_IDENTITY_NAME)
  issued += 1
  const identity = Object.freeze({ name, id: `${name}#${issued}` })
  identities.set(host, identity)
  return identity
}

/** Reads an identity only when this module issued one for the exact target. */
export const readHostIdentity = (target: unknown): IPluginHostIdentity | undefined =>
  (typeof target === 'object' || typeof target === 'function') && target !== null
    ? identities.get(target as object)
    : undefined
