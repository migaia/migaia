/** Generation and atomic-group wire data can be admitted before a carrier loads stream codecs. */
export {
  normalizeRuntimeGeneration,
  normalizeRuntimeSteps,
  createRuntimeCallEnvelope
} from './metadata.js'
export type { IRpcRuntimeCallHeader } from './metadata.js'
export type { IRpcRuntimeGeneration, IRpcRuntimeStep } from './types.js'
