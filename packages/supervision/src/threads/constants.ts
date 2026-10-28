import { EXIT_OBSERVATION_CAPABILITY } from '../constants.ts'

/** Unit kind shared by the thread profile and its budget. */
export const ThreadUnitKind = { thread: 'thread' } as const
export type ThreadUnitKind = (typeof ThreadUnitKind)[keyof typeof ThreadUnitKind]

/** Capability names used by thread admission, with shared observation semantics owned by core. */
export const ThreadCapability = {
  heapLimit: 'heap-limit',
  exitObservation: EXIT_OBSERVATION_CAPABILITY
} as const
export type ThreadCapability = (typeof ThreadCapability)[keyof typeof ThreadCapability]

/** Runtime-reported limit names follow the public specification. */
export const ThreadLimit = { heapBytes: 'heapBytes' } as const
export type ThreadLimit = (typeof ThreadLimit)[keyof typeof ThreadLimit]
