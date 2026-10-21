/** Private SSR wait-race tags, not part of any public method input or output. */
export const SsrWorkOutcome = {
  value: 'value',
  disposed: 'disposed',
  timeout: 'timeout'
} as const

/** Codec/chunk labels used by SSR encoding; data-wire=b64 is a separate HTML carrier attribute. */
export const SsrWireType = {
  /** Registry type eligible for direct JSON-safe text embedding. */
  json: 'json',
  /** Text chunk category; non-JSON formats are base64-wrapped without rewriting their syntax. */
  text: 'text',
  /** Byte chunk category, always base64-wrapped for script content. */
  bytes: 'bytes'
} as const

/** Union of the maintained JSON codec and text/bytes chunk labels, not all registry codec ids. */
export type ISsrWireType = (typeof SsrWireType)[keyof typeof SsrWireType]
