/** Outcomes used while waiting for SSR work to settle or be disposed. */
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

export type ISsrWorkOutcome = (typeof SsrWorkOutcome)[keyof typeof SsrWorkOutcome]
export type ISsrWireType = (typeof SsrWireType)[keyof typeof SsrWireType]
