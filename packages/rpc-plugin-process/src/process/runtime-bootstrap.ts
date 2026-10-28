/**
 * Encodes and admits the bounded private launch record containing exact self, parent, token and
 * optional generation facts. This native first frame stays separate from semantic RPC negotiation.
 */
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  RpcWireLimit,
  normalizeRpcGeneration,
  type IRpcGeneration
} from '@migaia/rpc-contract/protocol'
import { defaultRpcId } from '@migaia/rpc-host/sdk'
import type { IRpcLocalSourceFacts } from '@migaia/rpc-contract/interfaces'
import {
  PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  PROCESS_RUNTIME_API_FINGERPRINT_PREFIX,
  PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  PROCESS_RUNTIME_API_BOOTSTRAP_VERSION
} from './constants.ts'
import { RpcProcessErrorText } from './error-text.ts'

/** Safe launch selection belongs to the original process launcher, outside the process spec. */
export type IProcessRuntimeBootstrapOptions = Readonly<{
  /** An omitted logical name lets the child publish its configured/default name at handshake. */
  name?: string
  /** Nonempty bounded parent instance identity written into the original private first frame. */
  parentInstanceId: string
  /** Only an original supervised launch supplies real restart facts. */
  generation?: IRpcGeneration
}>

/** Secret first-frame material is never projected into business metadata or supervisor identity. */
export type IProcessRuntimeBootstrap = Readonly<{
  self: NonNullable<IRpcLocalSourceFacts['self']>
  parentInstanceId: string
  token: string
  /** Execution identity is separate from the new physical instance fingerprint. */
  generation?: IRpcGeneration
}>

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

/** Admit the single native bootstrap record without retaining secret parser diagnostics. */
function readBootstrap(value: unknown): IProcessRuntimeBootstrap | undefined {
  try {
    /** Secret-bearing native bootstrap parsing deliberately retains no input excerpt on failure. */
    const parsed =
      value instanceof Uint8Array
        ? value.byteLength > PROCESS_HANDSHAKE_MAX_FRAME_BYTES
          ? undefined
          : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value))
        : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    /** This closed record is native launch data, separate from the sole semantic Session profile. */
    const record = parsed as Record<string, unknown>
    if (
      Object.keys(record).length !== (record.generation === undefined ? 5 : 6) ||
      record.kind !== PROCESS_RUNTIME_API_BOOTSTRAP_KIND ||
      record.version !== PROCESS_RUNTIME_API_BOOTSTRAP_VERSION ||
      !identifier(record.parentInstanceId) ||
      typeof record.token !== 'string' ||
      !record.token ||
      !record.self ||
      typeof record.self !== 'object' ||
      Array.isArray(record.self)
    )
      return undefined
    /** Runtime PIDs and arbitrary environment values never enter the safe identity projection. */
    const self = record.self as Record<string, unknown>
    if (
      Object.keys(self).length !== (self.name === undefined ? 1 : 2) ||
      (self.name !== undefined && !identifier(self.name)) ||
      !identifier(self.instanceId)
    )
      return undefined
    /** The one protocol generation grammar admits data without granting source authority. */
    const generation =
      record.generation === undefined ? undefined : normalizeRpcGeneration(record.generation)
    return Object.freeze({
      self: Object.freeze({
        ...(self.name === undefined ? {} : { name: self.name as string }),
        instanceId: self.instanceId
      }),
      parentInstanceId: record.parentInstanceId,
      token: record.token,
      ...(generation ? { generation } : {})
    })
  } catch {
    return undefined
  }
}

/** Invalid native launch input is sanitized once at this package's existing error boundary. */
function snapshot(value: unknown): IProcessRuntimeBootstrap {
  /** The sole native parser does not mint or retain errors while classifying secret-bearing input. */
  const received = readBootstrap(value)
  return received ?? invalidProcessRuntimeBootstrap()
}

/** Read explicit discovery data through the same canonical grammar used by Core's actual receiver. */
export function decodeProcessRuntimeBootstrap(bytes: Uint8Array): IProcessRuntimeBootstrap {
  return snapshot(bytes)
}

/** Prepare metadata before spawn; the returned identity is the exact one written to bootstrap. */
export function prepareProcessRuntimeBootstrap(
  options: IProcessRuntimeBootstrapOptions,
  tokenBytes: Uint8Array | undefined
): Readonly<{ self: NonNullable<IRpcLocalSourceFacts['self']>; payload: Uint8Array }> {
  if (
    !options ||
    (options.name !== undefined && !identifier(options.name)) ||
    !identifier(options.parentInstanceId) ||
    !tokenBytes
  )
    invalidProcessRuntimeBootstrap()
  /** Invalid UTF-8 token diagnostics remain secret even when local launch admission fails. */
  let token: string
  try {
    token = new TextDecoder('utf-8', { fatal: true }).decode(tokenBytes)
  } catch {
    return invalidProcessRuntimeBootstrap()
  }
  /** Native entropy prevents independent parent processes from reusing the same launch identity. */
  const self = Object.freeze({
    ...(options.name === undefined ? {} : { name: options.name }),
    instanceId: `${PROCESS_RUNTIME_API_FINGERPRINT_PREFIX}${defaultRpcId()}`
  })
  /** A single metadata encoder is shared by Node/Bun and Deno launchers. */
  const record = {
    kind: PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
    version: PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
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
