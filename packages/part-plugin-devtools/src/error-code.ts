/**
 * Error codes of the devtools panel. The panel only reads host Features and shows `undefined` for
 * unreadable values, so it throws nothing across its boundary and declares no codes yet.
 */
export const PartDevtoolsErrorCode = {} as const

/** Value union of every `part.devtools` error code (none yet). */
export type IPartDevtoolsErrorCode =
  (typeof PartDevtoolsErrorCode)[keyof typeof PartDevtoolsErrorCode]
