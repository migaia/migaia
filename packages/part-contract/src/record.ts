/** True for a non-null, non-array object; the shared shape guard of this package's parsers. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
