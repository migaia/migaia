import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'

/**
 * Best-effort diagnostics only; this intentionally observes mutable prototype/constructor/name
 * properties and must never participate in security or protocol classification.
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

// Compatibility exports intentionally preserve the canonical utils function identities.
export { isArrayBuffer, isUint8Array }
