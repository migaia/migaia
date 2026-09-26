import { normalizeRpcEnvelope } from './normalize.js'
import { rpcProtocol } from './protocol.js'

export { normalizeRpcEnvelope }
export { rpcProtocol }

/** Default V1 semantic aggregate keeps protocol ownership separate from codec and framing owners. */
const rpcV1 = Object.freeze({ rpcProtocol, normalizeRpcEnvelope })

export default rpcV1
export type {
  IRpcDiscoveryEnvelope,
  IRpcEnvelope,
  IRpcRequestEnvelope,
  IRpcResponseFailure,
  IRpcResponseSuccess,
  IRpcVariationEnvelope
} from './types.js'
