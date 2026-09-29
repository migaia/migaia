/** Unit kind shared by the thread profile and its budget. */
export const ThreadUnitKind = { thread: 'thread' } as const
export type ThreadUnitKind = (typeof ThreadUnitKind)[keyof typeof ThreadUnitKind]

/** Capability names that only a thread launcher can promise. */
export const ThreadCapability = {
  heapLimit: 'heap-limit',
  exitObservation: 'exit-observation'
} as const
export type ThreadCapability = (typeof ThreadCapability)[keyof typeof ThreadCapability]

/** Runtime-reported limit names follow the public specification. */
export const ThreadLimit = { heapBytes: 'heapBytes' } as const
export type ThreadLimit = (typeof ThreadLimit)[keyof typeof ThreadLimit]
