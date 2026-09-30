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
