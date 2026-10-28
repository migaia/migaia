/**
 * Owns Host identity admission, monotonic issuance and entropy; the authority leaf owns
 * exact-target records.
 */
import ERROR_TEXT, { createPluginHostTypeError } from './error-text.js'
import type { IPluginHostIdentity } from './host-identity-types.js'
import { readHostIdentityRecord, recordHostIdentity } from './host-identity-authority.js'
export type { IPluginHostIdentity } from './host-identity-types.js'
export { readHostIdentity, readHostNodeId } from './host-identity-authority.js'

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
  /** A public facade and its runtime represent one Host, including identity and private node. */
  const owner = nodeOwner ? readHostIdentityRecord(nodeOwner) : undefined
  if (owner) {
    recordHostIdentity(host, owner)
    return owner.identity
  }
  issued += 1
  /** The label and monotonic sequence retain their exact original issuance order. */
  const identity = Object.freeze({ name, id: `${name}#${issued}` })
  /** Each newly issued Host owns one private random node; facade issuance reuses the original. */
  let nodeId: string
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
  recordHostIdentity(host, Object.freeze({ identity, nodeId }))
  return identity
}
