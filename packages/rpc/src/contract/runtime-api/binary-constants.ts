/** The independent manifest profile is protected once by the original codec/auth owner. */
export const RpcBinaryProfile = 'migaia.rpc.portable-binary/1'

/** Representation is chosen before sending; explicit transfer never falls back to inline. */
export const RpcBinaryStorage = { inline: 'inline', native: 'native' } as const
export type RpcBinaryStorage = (typeof RpcBinaryStorage)[keyof typeof RpcBinaryStorage]

/** Native framing contains one protected manifest and its exact ordered original backing list. */
export const RpcNativeBinaryKind = 'rpc.native-binary.v1'

/** Local codec failures distinguish backing integrity from structural grammar for the core reporter. */
export const RpcBinaryViolation = { integrity: 'binary-integrity' } as const

/** Every business node has a tag, so tag-shaped ordinary data cannot become a binary reference. */
export const RpcBinaryTag = {
  null: 'null',
  boolean: 'boolean',
  number: 'number',
  string: 'string',
  array: 'array',
  object: 'object',
  buffer: 'buffer',
  uint8array: 'uint8array'
} as const

/** Manifest and native carrier accept only these fields, never application-controlled options. */
export const RpcBinaryField = {
  profile: 'profile',
  storage: 'storage',
  envelope: 'envelope',
  backings: 'backings',
  byteLength: 'byteLength',
  sha256: 'sha256',
  kind: 'kind',
  protectedMetadata: 'protectedMetadata',
  sidecars: 'sidecars'
} as const
