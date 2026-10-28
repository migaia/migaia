/** Token writes report their original capability failures through the host, so no local code exists. */
export const LogReasoningErrorCode = {} as const

/** The intentionally empty table has no error source or semantic values. */
export type ILogReasoningErrorCode =
  (typeof LogReasoningErrorCode)[keyof typeof LogReasoningErrorCode]
