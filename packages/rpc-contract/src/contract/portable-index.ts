/** Protocol implementers snapshot portable/native business data without loading the binary encoder. */
export { normalizePortable, RPC_PORTABLE_MAX_DEPTH } from './normalize.js'
export type {
  IRpcPortableBytes,
  IRpcPortableRecord,
  IRpcPortableValue,
  IRpcWirePortableValue
} from './types.js'
