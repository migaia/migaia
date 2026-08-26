/** Canonical serialized chunk kinds. */
export const SerializeChunkKind = {
  value: 'value',
  text: 'text',
  bytes: 'bytes'
} as const

/** Codec output representations used by serializers and persistence adapters. */
export const SerializeOutput = {
  text: 'text',
  structured: 'structured',
  binary: 'binary'
} as const

/** Instrumentation phases emitted while encoding or decoding. */
export const SerializePhase = { encode: 'encode', decode: 'decode' } as const

/** Cleanup policies and diagnostic kinds used by the serializer registry. */
export const SerializeCleanupPolicy = { throw: 'throw', report: 'report' } as const
export const SerializeCleanupKind = {
  cleanupError: 'cleanup-error',
  drainTimeout: 'drain-timeout'
} as const

/** Built-in serializer plugin identifiers used in registry metadata. */
export const SerializePluginType = { json: 'json' } as const

export type ISerializeChunkKind = (typeof SerializeChunkKind)[keyof typeof SerializeChunkKind]
export type ISerializeOutputFormat = (typeof SerializeOutput)[keyof typeof SerializeOutput]
export type ISerializePhase = (typeof SerializePhase)[keyof typeof SerializePhase]
export type ISerializeCleanupPolicy =
  (typeof SerializeCleanupPolicy)[keyof typeof SerializeCleanupPolicy]
export type ISerializeCleanupKind = (typeof SerializeCleanupKind)[keyof typeof SerializeCleanupKind]
export type ISerializePluginType = (typeof SerializePluginType)[keyof typeof SerializePluginType]
