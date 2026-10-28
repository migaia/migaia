/** Owns thread diagnostic field paths; runtime supervision and lifecycle remain in core. */
/** Stable option paths identify the invalid thread configuration without exposing its value. */
export const ThreadField = {
  entry: 'spec.entry',
  name: 'spec.name',
  limits: 'spec.limits',
  callWallTimeMs: 'callWallTimeMs',
  capabilities: 'launcher.capabilities',
  health: 'health'
} as const
/** Invalid limits retain the public spec.limits prefix across constructor and replacement admission. */
export function threadLimitField(field: string): string {
  return `spec.limits.${field}`
}
