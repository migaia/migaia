import { createAdapterConfigurationError } from '@migaia/rpc-core/adapter/internal-advanced'
import { RpcWireLimit } from '@migaia/rpc-contract'
import type { IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
import type { IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import { rpcByteRuntimeBootstrap } from '@migaia/rpc-contract/runtime'
import {
  PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  PROCESS_RUNTIME_API_FINGERPRINT_PREFIX
} from './constants.js'
import { RpcProcessErrorText } from './error-text.js'

/** Safe launch selection belongs to the original process launcher, outside the process spec. */
export type IProcessRuntimeBootstrapOptions = Readonly<{
  /** Nonempty bounded logical child name, independent of a native PID. */
  name: string
  /** Nonempty bounded parent instance identity written into the original private first frame. */
  parentInstanceId: string
  /** Only an original supervised launch supplies real restart facts. */
  generation?: IRpcRuntimeGeneration
}>

/** Secret first-frame material is never projected into business metadata or supervisor identity. */
export type IProcessRuntimeBootstrap = Readonly<{
  self: IRuntimePeerIdentity
  parentInstanceId: string
  token: string
  /** Execution identity is separate from the new physical instance fingerprint. */
  generation?: IRpcRuntimeGeneration
}>

/** All opt-in platform launchers allocate from this original bootstrap owner exactly once. */
let sequence = 0

/** Reject malformed secret-bearing input without retaining parser diagnostics or payload bytes. */
export function invalidProcessRuntimeBootstrap(): never {
  throw createAdapterConfigurationError(RpcProcessErrorText.runtimeBootstrapInvalid)
}

/** Identity labels use the same bounded domain as the canonical RPC handshake. */
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= RpcWireLimit.maxIdentifierChars
  )
}

/** Use the one canonical closed Contract grammar, without exposing parser diagnostics or secrets. */
function snapshot(value: unknown): IProcessRuntimeBootstrap {
  const received = rpcByteRuntimeBootstrap.read(value)
  if (!received.valid) invalidProcessRuntimeBootstrap()
  return received.value
}

/** Read explicit discovery data through the same canonical grammar used by Core's actual receiver. */
export function decodeProcessRuntimeBootstrap(bytes: Uint8Array): IProcessRuntimeBootstrap {
  return snapshot(bytes)
}

/** Prepare metadata before spawn; the returned identity is the exact one written to bootstrap. */
export function prepareProcessRuntimeBootstrap(
  options: IProcessRuntimeBootstrapOptions,
  tokenBytes: Uint8Array | undefined
): Readonly<{ self: IRuntimePeerIdentity; payload: Uint8Array }> {
  if (!options || !identifier(options.name) || !identifier(options.parentInstanceId) || !tokenBytes)
    invalidProcessRuntimeBootstrap()
  /** Invalid UTF-8 token diagnostics remain secret even when local launch admission fails. */
  let token: string
  try {
    token = new TextDecoder('utf-8', { fatal: true }).decode(tokenBytes)
  } catch {
    return invalidProcessRuntimeBootstrap()
  }
  /** This ID belongs to the launch attempt and is never replaced by a facade allocation. */
  const self = Object.freeze({
    name: options.name,
    instanceId: `${PROCESS_RUNTIME_API_FINGERPRINT_PREFIX}${++sequence}`
  })
  /** A single metadata encoder is shared by Node/Bun and Deno launchers. */
  const record = {
    kind: rpcByteRuntimeBootstrap.kind,
    version: rpcByteRuntimeBootstrap.version,
    self,
    parentInstanceId: options.parentInstanceId,
    token,
    ...(options.generation ? { generation: options.generation } : {})
  }
  snapshot(record)
  /** The original unauthenticated frame bound also caps complete encoded metadata. */
  const payload = new TextEncoder().encode(JSON.stringify(record))
  if (payload.byteLength > PROCESS_HANDSHAKE_MAX_FRAME_BYTES) invalidProcessRuntimeBootstrap()
  return Object.freeze({ self, payload })
}
