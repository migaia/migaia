/** Internal operation labels and collector policies have one package owner. */
/** Stable location labels shared by registry and stream option admission. */
export const SerializeContext = {
  /** Default diagnostic label for a single registry operation. */
  anonymous: 'anonymous',
  /** Default diagnostic label and type for public streaming helpers. */
  stream: 'stream',
  /** Routing lookup failures identify the registry boundary. */
  registry: 'registry'
} as const

/** Empty-stream policies are shared by collector admission and execution. */
export const SerializeCollectEmpty = {
  /** Preserve the historical empty text output when no chunk is produced. */
  text: 'text',
  /** Reject an empty stream when the consumer explicitly requests it. */
  reject: 'reject'
} as const
