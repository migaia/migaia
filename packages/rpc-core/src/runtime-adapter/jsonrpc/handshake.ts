import type { IScheduler, IWallClock } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer } from '@migaia/rpc-contract'
import { RpcCodecId } from '@migaia/rpc-contract'
import {
  normalizeRemoteContract,
  normalizeRemoteHostCatalog,
  type IRemoteContract,
  type IRemoteHostCatalog
} from '../../remote/contract.js'
import { adapterContractRequiresStream, normalizeAdapterDescription } from '../data.js'
import { RuntimeApiMode } from '../../remote/runtime-api/constants.js'
import type { IRuntimeByteIO, IRuntimeConnectionOptions } from '../byte/types.js'
import {
  JSONRPC_ALLOWED_CAPABILITIES,
  JSONRPC_REQUIRED_CAPABILITIES,
  JSONRPC_REQUIRED_METHODS
} from './constants.js'
import { JsonRpcBridgeErrorCode } from '@migaia/rpc-contract/framing/jsonrpc'
import { createJsonRpcBridgeError } from './error.js'

/** Caller owns launch, authentication issuance, clocks and the physical byte connection. */
export type IAdapterJsonRpcChannelOptions = Readonly<{
  /** Actual ordered byte I/O held by this adapter. */
  byte: IRuntimeByteIO
  /** Direct peer address for the bridge. */
  peerId: string
  /** Explicit plugin contract or Host catalog selecting the bridge method whitelist. */
  target:
    | Readonly<{ kind: 'plugin'; contract: IRemoteContract }>
    | Readonly<{ kind: 'host'; catalog: IRemoteHostCatalog }>
  /** Local capability proposal; the bridge supplies its existing JSON/authentication fields. */
  offer: Omit<IRpcHandshakeOffer, 'auth' | 'codecs'>
  /** Local authentication token consumed by the handshake; never put it in diagnostics. */
  token: string
  /** Borrowed monotonic scheduler for local deadlines. */
  scheduler: IScheduler
  /** Borrowed epoch clock for handshake wall-time fields. */
  wallClock: IWallClock
  /** Original flow-control and diagnostic configuration for this byte connection. */
  ipc: IRuntimeConnectionOptions['ipc']
  /** Cancel the original handshake/opening operation. */
  signal?: import('@migaia/utils/promise').IAbortSignal
  /** Optional non-negative handshake budget; omission uses the canonical 10000 ms default. */
  handshakeTimeoutMs?: number
  /** Required reporter for background and secondary failures. */
  report(error: unknown): void
}>

/** Use remote's canonical description shape before applying the bridge's stream exclusion. */
export function validateJsonRpcDescription(value: unknown): void {
  /** The remote directory is always v2, independent of the temporary local facade declaration. */
  const description = normalizeAdapterDescription(value)
  if (description.methods.some((method) => method.supportedModes.includes(RuntimeApiMode.stream)))
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.unsupportedMode)
}

/** Reject unsupported local options before installing readers, timers or writing any byte. */
export function prepareJsonRpcOffer(options: IAdapterJsonRpcChannelOptions): IRpcHandshakeOffer {
  if (
    !options ||
    !options.byte ||
    options.byte.kind !== 'byte' ||
    typeof options.peerId !== 'string' ||
    options.peerId.length === 0 ||
    typeof options.token !== 'string' ||
    options.token.length === 0 ||
    typeof options.report !== 'function' ||
    !options.ipc ||
    !options.scheduler ||
    !options.wallClock ||
    !options.offer ||
    !Array.isArray(options.offer.capabilities)
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
  if (
    options.handshakeTimeoutMs !== undefined &&
    (!Number.isFinite(options.handshakeTimeoutMs) || options.handshakeTimeoutMs < 0)
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
  /** The discriminant and payload are checked together; malformed JS options cannot select both. */
  const target = options.target
  if (
    !target ||
    (target.kind !== 'plugin' && target.kind !== 'host') ||
    (target.kind === 'plugin'
      ? !Object.hasOwn(target, 'contract') || Object.hasOwn(target, 'catalog')
      : !Object.hasOwn(target, 'catalog') || Object.hasOwn(target, 'contract'))
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
  /** Local legacy facade declarations remain configuration until their API removal. */
  const contracts =
    target.kind === 'plugin'
      ? [normalizeRemoteContract(target.contract)]
      : Object.values(normalizeRemoteHostCatalog(target.catalog))
  if (contracts.some(adapterContractRequiresStream))
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.unsupportedMode)
  if (
    options.offer.capabilities.some(
      (capability) => !JSONRPC_ALLOWED_CAPABILITIES.includes(capability)
    )
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
  /** Only this boundary adds auth and JSON; the control owner validates all offer grammar. */
  const offer: IRpcHandshakeOffer = {
    ...options.offer,
    auth: options.token,
    codecs: [RpcCodecId.json],
    capabilities: [...new Set([...JSONRPC_REQUIRED_CAPABILITIES, ...options.offer.capabilities])]
  }
  return offer
}

/** Preserve control errors unchanged and check the bridge extensions exactly once after accept. */
export function readJsonRpcReply(result: unknown): string {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !('reply' in result) ||
    typeof result.reply !== 'string'
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
  /** No reply text or agreement auth is included in a bridge error or diagnostic snapshot. */
  return result.reply
}

/** Check adapter extensions only after Core completes the actual control exchange. */
export function assertJsonRpcExtensions(capabilities: readonly string[], result: unknown): void {
  /** Reply admission already established this exact response object before Core completion. */
  const received = result as Record<string, unknown>
  /** The responder must advertise the complete extension surface before ready. */
  const methods = 'methods' in received ? received.methods : undefined
  if (
    JSONRPC_REQUIRED_CAPABILITIES.some((capability) => !capabilities.includes(capability)) ||
    !Array.isArray(methods) ||
    methods.some((method) => typeof method !== 'string') ||
    JSONRPC_REQUIRED_METHODS.some((method) => !methods.includes(method))
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.extensionMissing)
}
