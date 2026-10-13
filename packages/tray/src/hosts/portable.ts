import { normalizePortable, type IRpcPortableValue } from '@migaia/rpc-contract'
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
    return normalizePortable(value, 0, new Set<object>(), true)
  } catch (error) {
    throw createTrayError(TrayErrorCode.valueNotPortable, error)
  }
}
