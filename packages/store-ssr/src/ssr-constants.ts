/** Private SSR wait-race tags, not part of any public method input or output. */
export const SsrWorkOutcome = {
  value: 'value',
  disposed: 'disposed',
  timeout: 'timeout'
} as const

/** Wire encodings accepted by the SSR stream. */
export const SsrWireType = {
  json: 'json',
  text: 'text',
  bytes: 'bytes'
} as const

export type ISsrWireType = (typeof SsrWireType)[keyof typeof SsrWireType]
