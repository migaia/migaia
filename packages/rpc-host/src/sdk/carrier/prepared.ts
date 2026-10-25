/**
 * Joins or splits prepared metadata and original binary sidecars at the shallow carrier boundary.
 * These projections preserve the existing roots without walking business graphs; codec restore
 * remains the sole semantic admission and binary reconstruction owner.
 */
import type { IRpcPreparedMessage } from '@migaia/rpc-contract/interfaces'
import { RpcWireBinaryProfile } from '@migaia/rpc-contract/protocol'

/** Join only the fixed prepared root; original sidecars/backings and business key order stay held. */
export function joinRpcPreparedMetadata(value: IRpcPreparedMessage): unknown {
  return value.manifest ? { ...value.manifest, envelope: value.message } : value.message
}

/** Shallowly expose binary metadata; only the eventual sole restore performs semantic admission. */
export function splitRpcPreparedMetadata(
  value: unknown,
  sidecars: readonly ArrayBuffer[]
): IRpcPreparedMessage {
  if (
    value &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'profile')?.value === RpcWireBinaryProfile
  )
    return {
      message: Object.getOwnPropertyDescriptor(value, 'envelope')?.value,
      manifest: value as NonNullable<IRpcPreparedMessage['manifest']>,
      sidecars
    }
  return { message: value, sidecars }
}
