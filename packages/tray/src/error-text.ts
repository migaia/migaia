/** Stable Tray boundary messages used by callers and tests. */
export const TrayErrorText = {
  invalidEntry: 'tray entry is invalid',
  duplicateEntry: 'tray entry is duplicated',
  unknownEntry: 'tray entry is unknown',
  unavailable: 'tray entry is unavailable',
  gateReadFailed: 'tray readiness gate failed',
  /** Stable diagnostic for raw Host interference detected by the managed session receipt. */
  hostMutationBypass: 'managed host detected an escaped concrete host mutation'
} as const
