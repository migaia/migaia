/**
 * Stable strings of `partom doctor` output that consumers match on: the rule id and fallback code
 * of a blueprint whose load threw, and the reasons a blueprint skips the rendered check.
 */
export const DoctorText = {
  /** Rule id of the issue recorded when loading one blueprint throws (parse or expansion error). */
  loadRule: 'doctor.load',
  /** Code used when a load error carries no code of its own. */
  loadFallbackCode: 'LOAD_FAILED',
  /** Skip reason of a blueprint with static errors. */
  skippedStaticErrors: 'static errors',
  /** Skip reason of a blueprint whose load threw. */
  skippedLoadError: 'load error'
} as const
