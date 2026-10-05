import ERROR_TEXT, { createPluginHostTypeError } from './error-text.js'

/** Public, immutable identity assigned by this module to one Host surface. */
export type IPluginHostIdentity = Readonly<{
  /** Human-readable label supplied by the caller, or `DEFAULT` when omitted. */
  readonly name: string
  /** Process-local identifier issued from this module's monotonic sequence. */
  readonly id: string
}>

/** Module-private identity authority; entries disappear with their Host targets. */
const identities = new WeakMap<
  object,
  Readonly<{ identity: IPluginHostIdentity; nodeId: string }>
>()
/** Monotonic process-local sequence used only after an identity name passes validation. */
let issued = 0

/** Validates, issues, freezes, and records one identity for an exact Host target. */
export const issueHostIdentity = (
  host: object,
  name = 'DEFAULT',
  nodeOwner?: object
): IPluginHostIdentity => {
  if (typeof name !== 'string' || name.length === 0)
    throw createPluginHostTypeError(ERROR_TEXT.HOST_IDENTITY_NAME)
  issued += 1
  const identity = Object.freeze({ name, id: `${name}#${issued}` })
  /**
   * A defineHost facade shares the actual runtime's private random node, while keeping its public
   * id.
   */
  let nodeId = nodeOwner ? identities.get(nodeOwner)?.nodeId : undefined
  if (nodeId === undefined) {
    try {
      /** Host identity owns exactly sixteen secure bytes; adapters cannot substitute PID or labels. */
      const entropy = Reflect.get(globalThis, 'crypto') as
        | { getRandomValues(buffer: Uint8Array): Uint8Array }
        | undefined
      /** The supported runtime supplies crypto; unavailable entropy is caught with its native cause. */
      const bytes = entropy!.getRandomValues(new Uint8Array(16))
      nodeId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.HOST_IDENTITY_ENTROPY, { cause })
    }
  }
  identities.set(host, Object.freeze({ identity, nodeId }))
  return identity
}

/** Reads an identity only when this module issued one for the exact target. */
export const readHostIdentity = (target: unknown): IPluginHostIdentity | undefined =>
  (typeof target === 'object' || typeof target === 'function') && target !== null
    ? identities.get(target as object)?.identity
    : undefined

/**
 * Only the original integration owner reads the private node fact; it is absent from public
 * identity.
 */
export const readHostNodeId = (target: object): string => identities.get(target)!.nodeId
