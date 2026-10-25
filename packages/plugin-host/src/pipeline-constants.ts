/** Construction-time stage order is shared by spec typing and snapshot compilation. */
export const PipelineOrder = {
  /** Stages follow the Host's original shared allocation slots. */
  install: 'install',
  /** Snapshot compilation reverses the same installed sequence once per visible revision. */
  reverse: 'reverse'
} as const

/** The finite order domain adds no runtime state or separate execution implementation. */
export type PipelineOrder = keyof typeof PipelineOrder
