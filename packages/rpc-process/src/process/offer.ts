import type { IRpcHandshakeOffer, IRpcPeerInfo } from '@migaia/rpc-contract'
import { RpcCapability, RpcCodecId, RpcProtocol } from '@migaia/rpc-contract'

/** Only locally created offers that omit extensions allow a runtime listener to supply defaults. */
const defaultNativeOffers = new WeakSet<IRpcHandshakeOffer>()

/** Native byte connections advertise only capabilities installed by their endpoint owner. */
export function createNativeProcessOffer(
  options: Readonly<{
    peer: IRpcPeerInfo
    auth?: IRpcHandshakeOffer['auth']
    stream?: boolean
    capabilities?: readonly string[]
  }>
): IRpcHandshakeOffer {
  /** Default control capabilities are available to native process endpoints. */
  const capabilities: string[] = [RpcCapability.ping, RpcCapability.close, RpcCapability.batch]
  if (options.stream) capabilities.push(RpcCapability.stream)
  /** Omission selects defaults; an explicit empty list remains an intentionally narrow proposal. */
  const extensions = options.capabilities
  capabilities.push(...(extensions ?? []))
  /** Set preserves first occurrence and makes caller-added duplicates harmless. */
  const unique = Object.freeze([...new Set(capabilities)])
  /** Freeze the negotiated version tuple instead of repeating protocol numbers. */
  const versions = Object.freeze([
    Object.freeze({ major: RpcProtocol.major, minor: RpcProtocol.minor })
  ])
  /** This offer's local default marker carries configuration intent, never negotiated trust. */
  const offer: IRpcHandshakeOffer = Object.freeze({
    versions,
    codecs: Object.freeze([RpcCodecId.json]),
    capabilities: unique,
    peer: Object.freeze({ ...options.peer }),
    ...(options.auth === undefined ? {} : { auth: options.auth })
  })
  if (extensions === undefined) defaultNativeOffers.add(offer)
  return offer
}

/**
 * Complete a plain listener proposal from Core's installed capabilities without widening explicit
 * offers.
 */
export function resolveNativeProcessRuntimeOffer(
  offer: IRpcHandshakeOffer,
  capabilities: readonly string[]
): IRpcHandshakeOffer {
  if (!defaultNativeOffers.has(offer)) return offer
  return Object.freeze({
    ...offer,
    capabilities: Object.freeze([...new Set([...offer.capabilities, ...capabilities])])
  })
}
