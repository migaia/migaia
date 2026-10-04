import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import { RpcWireLimit } from '../contract/wire-constants.js'
import type { IRuntimePeerIdentity } from '../remote/runtime-api/description.js'
import {
  PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
  PROCESS_RUNTIME_API_FINGERPRINT_PREFIX
} from './constants.js'
import { RpcProcessErrorText } from './error-text.js'

/** Safe launch selection belongs to the original process launcher, outside the process spec. */
export type IProcessRuntimeBootstrapOptions = Readonly<{
  name: string
  parentInstanceId: string
}>

/** Secret first-frame material is never projected into business metadata or supervisor identity. */
export type IProcessRuntimeBootstrap = Readonly<{
  self: IRuntimePeerIdentity
  parentInstanceId: string
  token: string
}>

/** All opt-in platform launchers allocate from this original bootstrap owner exactly once. */
let sequence = 0

/** Reject malformed secret-bearing input without retaining parser diagnostics or payload bytes. */
export function invalidProcessRuntimeBootstrap(): never {
  throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcProcessErrorText.runtimeBootstrapInvalid)
}

/** Identity labels use the same bounded domain as the canonical RPC handshake. */
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= RpcWireLimit.maxIdentifierChars
  )
}

/** The closed JSON profile admits only safe identity plus the existing private auth token. */
function snapshot(value: unknown): IProcessRuntimeBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidProcessRuntimeBootstrap()
  /** Bootstrap JSON supplies own data properties; extra fields never enter the projection. */
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 5 ||
    record.kind !== PROCESS_RUNTIME_API_BOOTSTRAP_KIND ||
    record.version !== PROCESS_RUNTIME_API_BOOTSTRAP_VERSION ||
    !identifier(record.parentInstanceId) ||
    typeof record.token !== 'string' ||
    !record.token ||
    !record.self ||
    typeof record.self !== 'object' ||
    Array.isArray(record.self)
  )
    invalidProcessRuntimeBootstrap()
  /** Native PIDs, environment and source configuration are outside this safe identity. */
  const self = record.self as Record<string, unknown>
  if (Object.keys(self).length !== 2 || !identifier(self.name) || !identifier(self.instanceId))
    invalidProcessRuntimeBootstrap()
  return Object.freeze({
    self: Object.freeze({ name: self.name, instanceId: self.instanceId }),
    parentInstanceId: record.parentInstanceId,
    token: record.token
  })
}

/** Read only after explicit platform discovery; primitive legacy token bytes are never guessed. */
export function decodeProcessRuntimeBootstrap(bytes: Uint8Array): IProcessRuntimeBootstrap {
  if (bytes.byteLength > PROCESS_HANDSHAKE_MAX_FRAME_BYTES) invalidProcessRuntimeBootstrap()
  try {
    return snapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return invalidProcessRuntimeBootstrap()
  }
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
    kind: PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
    version: PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
    self,
    parentInstanceId: options.parentInstanceId,
    token
  }
  snapshot(record)
  /** The original unauthenticated frame bound also caps complete encoded metadata. */
  const payload = new TextEncoder().encode(JSON.stringify(record))
  if (payload.byteLength > PROCESS_HANDSHAKE_MAX_FRAME_BYTES) invalidProcessRuntimeBootstrap()
  return Object.freeze({ self, payload })
}
