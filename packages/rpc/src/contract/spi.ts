/** Supported integration operations; this entry carries an integrator stability tier. */

export { createRpcStreamFrameDecoderWithLimit } from './framing/stream.js'
export { isExcerptFree, redactHandshake } from './handshake.js'
export {
  isRpcBinaryIntegrityFailure,
  measureRpcNativeBinaryFrame,
  prepareRpcBinary,
  readRpcNativeBinary,
  restoreRpcBinary,
  rpcBinaryBackingLength,
  rpcBinaryView
} from './runtime-api/binary.js'
export { runtimeOperationCapabilities } from './runtime-api/capabilities.js'
export { readRuntimeCarrier, wrapRuntimeCarrier } from './runtime-api/carrier.js'
export {
  normalizeRuntimeEnvelope,
  normalizeRuntimeGeneration,
  normalizeRuntimeSteps
} from './runtime-api/normalize.js'
