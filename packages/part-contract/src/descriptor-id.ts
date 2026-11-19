/** Descriptor id grammar shared by descriptor validation and data-layer checks. */

/** Descriptor id grammar: name, `@`, non-negative integer major. */
const ID_PATTERN = /^[A-Za-z0-9_.:/-]+@\d+$/

/** True when a string has the `name@major` form. */
export function isDescriptorId(id: string): boolean {
  return ID_PATTERN.test(id)
}

/** Splits `name@major` into its parts; callers have already validated the grammar. */
export function splitDescriptorId(id: string): { readonly name: string; readonly major: number } {
  /** Position of the major separator. */
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), major: Number(id.slice(at + 1)) }
}
