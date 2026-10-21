/**
 * Best-effort diagnostics only; this intentionally observes mutable prototype/constructor/name
 * properties and must never participate in security or protocol classification. Returns the
 * observed prototype constructor name, or undefined for non-objects and failed reads. No intrinsic
 * brand check is performed; use the canonical byte guards when a type decision matters.
 */
export const intrinsicConstructorName = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const constructor = Object.getPrototypeOf(value)?.constructor
    return typeof constructor?.name === 'string' ? constructor.name : undefined
  } catch {
    return undefined
  }
}
