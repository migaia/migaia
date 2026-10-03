import type { IRpcHandshakeOffer, IRpcPeerInfo } from '../contract/handshake.js'
import { RpcCapability, RpcCodecId, RpcProtocol } from '../contract/wire-constants.js'

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
  capabilities.push(...(options.capabilities ?? []))
  /** Set preserves first occurrence and makes caller-added duplicates harmless. */
  const unique = Object.freeze([...new Set(capabilities)])
  /** Freeze the negotiated version tuple instead of repeating protocol numbers. */
  const versions = Object.freeze([
    Object.freeze({ major: RpcProtocol.major, minor: RpcProtocol.minor })
  ])
  return Object.freeze({
    versions,
    codecs: Object.freeze([RpcCodecId.json]),
    capabilities: unique,
    peer: Object.freeze({ ...options.peer }),
    ...(options.auth === undefined ? {} : { auth: options.auth })
  })
}
