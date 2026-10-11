/** Carrier receivers retain the existing cold stream parser while validating the full runtime union. */
export { normalizeRuntimeEnvelopeLazy as normalizeRuntimeEnvelope } from './normalize-lazy.js'
export { normalizeStreamPayloadLazy as normalizeStreamPayload } from '../stream-lazy.js'
export type * from './types.js'
export type { IRpcStreamPayload } from '../v1/stream.js'
