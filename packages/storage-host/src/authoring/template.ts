import { type StorageContractError } from '@migaia/storage-contract'

/**
 * SQL and SPARQL capture the same real frozen template protocol in the original field order. Format
 * owners capture each interpolated value in place; this helper owns no text grammar.
 */
export function captureStorageTemplatePieces<T>(
  strings: TemplateStringsArray,
  values: readonly unknown[],
  capture: (value: unknown) => T,
  invalid: (cause?: unknown) => StorageContractError
): (string | T)[] {
  if (!Array.isArray(strings) || !Object.isFrozen(strings)) throw invalid()
  /** Native raw metadata and cooked pieces must describe the same template. */
  const raw = strings.raw
  /** Frozen template arrays supply one exact interpolation count. */
  const length = strings.length
  if (
    !Array.isArray(raw) ||
    !Object.isFrozen(raw) ||
    raw.length !== length ||
    length !== values.length + 1
  )
    throw invalid()
  /** Each static block precedes its adjacent captured interpolation without expanding nodes. */
  const pieces: (string | T)[] = []
  for (let index = 0; index < length; index++) {
    /** Invalid cooked escapes and sparse/raw non-string slots never become executable text. */
    const text = strings[index]
    if (
      !Object.hasOwn(strings, index) ||
      !Object.hasOwn(raw, index) ||
      typeof text !== 'string' ||
      typeof raw[index] !== 'string'
    )
      throw invalid()
    pieces.push(text)
    if (index < values.length) pieces.push(capture(values[index]))
  }
  return pieces
}
