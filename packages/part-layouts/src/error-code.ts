/**
 * Error codes of `@migaia/part-layouts`. The table is empty on purpose: `defineLayout` reports
 * invalid layouts through `validateDescriptor`, which throws `DESCRIPTOR_INVALID` from
 * `part.contract`, and the built-in layouts cannot fail. A package-local code would duplicate it.
 */
export const PartLayoutsErrorCode = {} as const

/** Value union of the (empty) code table. */
export type IPartLayoutsErrorCode = (typeof PartLayoutsErrorCode)[keyof typeof PartLayoutsErrorCode]
