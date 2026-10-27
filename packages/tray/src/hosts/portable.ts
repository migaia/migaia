import { normalizeRpcPortable, type IRpcPortableValue } from '@migaia/rpc-host/contract'
import { TrayErrorCode } from '../error-code.js'
import { createTrayError } from '../errors.js'

/**
 * Snapshots config or payload with the rpc portable owner and preserves native binary. The absent
 * top-level payload remains undefined; undefined object fields still reject at that owner
 * boundary.
 */
export function toWire(value: unknown): IRpcPortableValue | undefined {
  if (value === undefined) return undefined
  try {
    return normalizeRpcPortable(value)
  } catch (error) {
    throw createTrayError(TrayErrorCode.valueNotPortable, error)
  }
}
