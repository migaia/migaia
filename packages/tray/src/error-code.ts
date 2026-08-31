/** Stable error codes exposed by the Tray admission and lookup boundary. */
export const TrayErrorCode = {
  /** Invalid entry descriptor or start result; caller must provide a complete static entry. */
  invalidEntry: 'TRAY_INVALID_ENTRY',
  /** Duplicate key during factory admission; caller must provide unique keys. */
  duplicateEntry: 'TRAY_DUPLICATE_ENTRY',
  /** Unknown lookup or dependency key; caller must use an admitted key. */
  unknownEntry: 'TRAY_UNKNOWN_ENTRY',
  /** Entry is not ready or gate failed; caller must await readiness or repair the gate. */
  unavailable: 'TRAY_UNAVAILABLE',
  /** Readiness getter failed; caller must inspect the preserved cause and fix the source. */
  gateReadFailed: 'TRAY_GATE_READ_FAILED',
  /** Managed reads detect a mutation made through the escaped concrete Host. */
  hostMutationBypass: 'HOST_MUTATION_BYPASS'
} as const

export type ITrayErrorCode = (typeof TrayErrorCode)[keyof typeof TrayErrorCode]
