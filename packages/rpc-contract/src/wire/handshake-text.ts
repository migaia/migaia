/** Fixed replacement for a secret-bearing or oversize handshake value in an error chain. */
export const RpcHandshakeRedactionText = { marker: '[redacted]' } as const

/** Names the source of a redacted handshake summary without retaining its value. */
export const RpcHandshakeInputForm = {
  text: 'text',
  bytes: 'bytes',
  offer: 'offer',
  other: 'other'
} as const

export type RpcHandshakeInputForm = keyof typeof RpcHandshakeInputForm

/** Fixed locations permitted in child-value diagnostics. */
export const RpcHandshakeRedactionPath = {
  peer: '/peer',
  implementation: '/peer/implementation',
  versions: '/versions',
  codecs: '/codecs',
  capabilities: '/capabilities',
  error: '/error'
} as const
export type RpcHandshakeRedactionPath =
  (typeof RpcHandshakeRedactionPath)[keyof typeof RpcHandshakeRedactionPath]

/** Value shapes permitted in child diagnostics without exposing a value. */
export const RpcHandshakeValueType = {
  object: 'object',
  array: 'array',
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  null: 'null'
} as const
export type RpcHandshakeValueType =
  (typeof RpcHandshakeValueType)[keyof typeof RpcHandshakeValueType]
