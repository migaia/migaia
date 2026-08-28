/** JavaScript primitive values; functions remain callable objects and are intentionally excluded. */
export type IPrimitive = undefined | null | string | number | bigint | boolean | symbol

/** Narrows null and undefined without treating other falsy business values as absent. */
export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

/** Detects empty or whitespace-only strings without coercing non-string values. */
export const isBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length === 0

/**
 * Detects common business-form emptiness while preserving `0`, `0n`, and `false` as real values.
 * Arrays and objects are never inferred empty because collection policy belongs to their owners.
 */
export const isEmptyValue = (value: unknown): value is null | undefined | string | number =>
  isNullish(value) || isBlankString(value) || (typeof value === 'number' && Number.isNaN(value))

/** Narrows all JavaScript primitives without allocating a runtime type tag. */
export const isPrimitive = (value: unknown): value is IPrimitive =>
  value === null || (typeof value !== 'object' && typeof value !== 'function')
