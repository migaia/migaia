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

/** Prune inlined manifest backings without changing transfer authority for unrelated codec output. */
export function rpcPreparedTransfer(
  transfer: readonly ArrayBuffer[] | undefined,
  sidecars: readonly ArrayBuffer[] | undefined,
  manifest?: IRpcPreparedMessage['manifest']
): readonly ArrayBuffer[] | undefined {
  if (!manifest || !transfer?.length) return transfer
  /** Only this final physical backing set may retain an already granted native transfer. */
  const native = new Set(sidecars)
  /** A changed list copies its accepted prefix once, in the caller's exact original order. */
  let selected: ArrayBuffer[] | undefined
  for (let index = 0; index < transfer.length; index++) {
    /** Preserve this exact caller-owned backing only when the final frame still carries it natively. */
    const backing = transfer[index]!
    if (native.has(backing)) selected?.push(backing)
    else selected ??= transfer.slice(0, index)
  }
  return selected ?? transfer
}
