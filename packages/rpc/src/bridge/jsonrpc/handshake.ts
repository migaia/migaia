import type { IScheduler, IWallClock } from '@migaia/utils/scheduler'
import {
  createRpcHello,
  completeRpcHandshake,
  type IRpcHandshakeOffer,
  type IRpcHandshakeAgreement
} from '../../contract/index.js'
import { RpcCodecId } from '../../contract/index.js'
import {
  normalizeRemoteContract,
  normalizeRemoteHostCatalog,
  type IRemoteContract,
  type IRemoteHostCatalog
} from '../../remote/index.js'
import { contractRequiresStream } from '../../remote/serve-methods.js'
import { normalizeRuntimeDescription } from '../../remote/spi.js'
import { RuntimeApiMode } from '../../remote/index.js'
import type { IProcessByteChannel, IProcessCommonOptions } from '../../process/index.js'
import {
  JSONRPC_ALLOWED_CAPABILITIES,
  JSONRPC_REQUIRED_CAPABILITIES,
  JSONRPC_REQUIRED_METHODS
} from './constants.js'
import { JsonRpcBridgeErrorCode } from './error-code.js'
import { createJsonRpcBridgeError } from './error.js'

/** Caller owns launch, authentication issuance, clocks and the physical byte connection. */
export type IJsonRpcBridgeOptions = Readonly<{
  byte: IProcessByteChannel
  peerId: string
  target:
    | Readonly<{ kind: 'plugin'; contract: IRemoteContract }>
    | Readonly<{ kind: 'host'; catalog: IRemoteHostCatalog }>
  offer: Omit<IRpcHandshakeOffer, 'auth' | 'codecs'>
  token: string
  scheduler: IScheduler
  wallClock: IWallClock
  ipc: IProcessCommonOptions['ipc']
  signal?: AbortSignal
  handshakeTimeoutMs?: number
  report(error: unknown): void
}>

/** Use remote's canonical description shape before applying the bridge's stream exclusion. */
export function validateJsonRpcDescription(value: unknown): void {
  /** The remote directory is always v2, independent of the temporary local facade declaration. */
  const description = normalizeRuntimeDescription(value)
  if (description.methods.some((method) => method.supportedModes.includes(RuntimeApiMode.stream)))
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.unsupportedMode)
}

/** Reject unsupported local options before installing readers, timers or writing any byte. */
export function prepareJsonRpcHello(
  options: IJsonRpcBridgeOptions
): Readonly<{ offer: IRpcHandshakeOffer; hello: string }> {
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
  /** Local legacy facade declarations remain configuration until their C7 API removal. */
  const contracts =
    target.kind === 'plugin'
      ? [normalizeRemoteContract(target.contract)]
      : Object.values(normalizeRemoteHostCatalog(target.catalog))
  if (contracts.some(contractRequiresStream))
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
  return { offer, hello: createRpcHello(offer) }
}

/** Preserve control errors unchanged and check the bridge extensions exactly once after accept. */
export function completeJsonRpcHello(
  offer: IRpcHandshakeOffer,
  result: unknown
): IRpcHandshakeAgreement {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !('reply' in result) ||
    typeof result.reply !== 'string'
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
  /** No reply text or agreement auth is included in a bridge error or diagnostic snapshot. */
  const agreement = completeRpcHandshake(offer, result.reply)
  /** The responder must advertise the complete extension surface before ready. */
  const methods = 'methods' in result ? result.methods : undefined
  if (
    JSONRPC_REQUIRED_CAPABILITIES.some(
      (capability) => !agreement.capabilities.includes(capability)
    ) ||
    !Array.isArray(methods) ||
    methods.some((method) => typeof method !== 'string') ||
    JSONRPC_REQUIRED_METHODS.some((method) => !methods.includes(method))
  )
    throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.extensionMissing)
  return agreement
}
