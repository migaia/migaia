/** Effects belong only to this original native attempt and are discarded at its actual terminal. */
export type ISqliteJournalTerminal = {
  readonly committed: Set<() => void>
  readonly rolledBack: Set<() => void>
  /** Native cleanup completion does not assert a known data commit or rollback. */
  readonly ended: Set<() => void>
}
