import type { ICodec } from './types.ts'
import { StorageCodecOutput, EntityAdapterName } from '../adapter-constants.ts'

/**
 * Passes serialization to the backend's structured cloning, such as IndexedDB. Supports `Blob`,
 * `File`, `ArrayBuffer`, `Map`, `Set`, `Date`, and cyclic references directly. Only structured
 * backends can use it. The routing layer rejects fallback on text-only backends; see
 * `registry.ts`.
 */
export const structuredCodec: ICodec<unknown, unknown> = Object.freeze({
  name: EntityAdapterName.structured,
  output: StorageCodecOutput.structured,
  encode: async (value) => value,
  decode: async (raw) => raw
})
