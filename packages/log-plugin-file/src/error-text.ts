/** File diagnostics keep their established text while capabilities move to local plugin options. */
export const LogFileErrorText = {
  /** Missing explicit/native append capability is a creation-time failure. */
  unavailable: 'logger file sink is unavailable',
  /** Original append/rotation failures remain on this wrapper's cause. */
  writeFailed: 'logger file sink write failed',
  /** Path and rotation option admission share the existing public diagnostic. */
  invalidOption: 'logger option admission failed'
} as const
