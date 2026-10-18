export { normalizeRpcEnvelope } from './normalize.js'
export { normalizeStreamPayload } from './stream.js'
export { rpcProtocol } from './protocol.js'

export type {
  IRpcDiscoveryEnvelope,
  IRpcEnvelope,
  IRpcRequestEnvelope,
  IRpcResponseFailure,
  IRpcResponseSuccess,
  IRpcVariationEnvelope
} from './types.js'
export type { IRpcStreamEnvelope } from './types.js'
export type { IRpcStreamPayload } from './stream.js'

export type { IRpcBinaryDigest } from '../runtime-api/binary.js'
export type { IRpcRuntimeStepOutcome } from '../runtime-api/types.js'
