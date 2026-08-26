import type { ICodec } from './types.js'
import { StorageCodecOutput } from '../constants.js'

/**
 * 不做序列化，交给后端的 structured clone（IndexedDB）。可直接存 Blob/File/ArrayBuffer/Map/Set/Date，甚至循环引用。仅结构化后端可用；
 * 遇到 text-only 后端时选路层拒绝降级，见 registry.ts。
 */
export const structuredCodec: ICodec<unknown, unknown> = Object.freeze({
  name: 'structured',
  output: StorageCodecOutput.structured,
  encode: async (value) => value,
  decode: async (raw) => raw
})
