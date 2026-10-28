/**
 * Own scalar-safe sanitization and portable-data text accounting; no error-tree traversal or
 * boundary authority.
 */
import { ErrorChainLimit } from '../error-chain-constants.ts'
import type { IErrorChainData, IErrorChainStrategy, IErrorChainText } from '../error-chain-types.ts'

/** Replace lone surrogates and retain the longest allowed UTF-8 scalar prefix. */
export function sanitizeErrorText(
  value: string,
  maxBytes: number = ErrorChainLimit.maxStringBytes,
  truncate = true
): IErrorChainText {
  /** Allocate replacement pieces only when the original string cannot be returned unchanged. */
  let chunks: string[] | undefined
  /** The unmodified substring after the last replacement is appended only once. */
  let segmentStart = 0
  /** Only admitted complete scalars contribute to the existing UTF-8 budget. */
  let bytes = 0
  for (let index = 0; index < value.length;) {
    /** Read UTF-16 directly so one scan validates pairs and computes their scalar width. */
    const first = value.charCodeAt(index)
    /** A valid pair consumes two units; a lone half is replaced with the existing U+FFFD. */
    let units = 1
    /** ASCII, two-byte, and three-byte scalar ranges avoid creating one string per character. */
    let size = first <= 0x7f ? 1 : first <= 0x7ff ? 2 : 3
    /** Replacement is recorded only after this scalar fits, matching the old admitted prefix. */
    let replace = false
    if (first >= 0xd800 && first <= 0xdbff) {
      /** The next code unit is inspected once, even when this scalar exceeds the byte budget. */
      const second = value.charCodeAt(index + 1)
      if (second >= 0xdc00 && second <= 0xdfff) {
        units = 2
        size = 4
      } else replace = true
    } else if (first >= 0xdc00 && first <= 0xdfff) replace = true
    if (truncate && bytes + size > maxBytes) {
      if (chunks === undefined) return { value: value.slice(0, index), bytes, changed: true }
      chunks.push(value.slice(segmentStart, index))
      return { value: chunks.join(''), bytes, changed: true }
    }
    if (replace) {
      chunks ??= []
      chunks.push(value.slice(segmentStart, index), '\ufffd')
      segmentStart = index + 1
    }
    bytes += size
    index += units
  }
  if (chunks === undefined) return { value, bytes, changed: false }
  chunks.push(value.slice(segmentStart))
  return { value: chunks.join(''), bytes, changed: true }
}

/** Sanitize portable data and count only its text units, excluding error-node field names. */
export function sanitizeData(
  value: IErrorChainData,
  sanitize: (value: string, truncate: boolean) => IErrorChainText,
  strategy: IErrorChainStrategy
): { value: IErrorChainData; bytes: number; replaced: boolean } | undefined {
  if (typeof value === 'string') {
    /**
     * The text strategy reports both replacement and UTF-8 size without modifying the original
     * input.
     */
    const text = sanitize(value, false)
    return { value: text.value, bytes: text.bytes, replaced: text.changed }
  }
  if (Array.isArray(value)) {
    /** Sanitized arrays are copied and frozen so callers cannot mutate admitted portable data. */
    const items: IErrorChainData[] = []
    /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
    let bytes = 0
    /** Propagate nested text replacement to the enclosing error truncation flag. */
    let replaced = false
    for (const item of value) {
      /** Reject data-key collisions or malformed descendants rather than returning a lossy record. */
      const next = sanitizeData(item, sanitize, strategy)
      if (!next) return undefined
      items.push(next.value)
      bytes += next.bytes
      replaced ||= next.replaced
    }
    return { value: Object.freeze(items), bytes, replaced }
  }
  if (value !== null && typeof value === 'object') {
    /** A boundary may own an atomic text-bearing representation inside otherwise plain data. */
    const leaf = strategy.dataTextLeaf?.(value as Readonly<Record<string, IErrorChainData>>)
    if (leaf) return { value, bytes: utf8Bytes(leaf.text), replaced: false }
    /** Fresh null-prototype data records keep source keys inert and preserve insertion order. */
    const record: Record<string, IErrorChainData> = Object.create(null) as Record<
      string,
      IErrorChainData
    >
    /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
    let bytes = 0
    /** Propagate nested text replacement to the enclosing error truncation flag. */
    let replaced = false
    for (const [key, item] of Object.entries(value)) {
      /**
       * The text strategy reports both replacement and UTF-8 size without modifying the original
       * input.
       */
      const text = sanitize(key, false)
      if (Object.hasOwn(record, text.value)) return undefined
      /** Reject data-key collisions or malformed descendants rather than returning a lossy record. */
      const next = sanitizeData(item, sanitize, strategy)
      if (!next) return undefined
      record[text.value] = next.value
      bytes += text.bytes + next.bytes
      replaced ||= text.changed || next.replaced
    }
    return { value: Object.freeze(record), bytes, replaced }
  }
  return { value, bytes: 0, replaced: false }
}

/** Keep the original array/key/atomic-leaf order and return its scalar subtotal directly. */
function countErrorDataValue(
  value: IErrorChainData,
  path: string,
  pointer: string,
  countText: (text: string, pointer: string) => number,
  maxBytes: number,
  invalid: (pointer: string) => never,
  dataTextLeaf: IErrorChainStrategy['dataTextLeaf'],
  bytes: number
): number {
  if (typeof value === 'string') bytes += countText(value, path)
  else if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++)
      bytes = countErrorDataValue(
        value[index]!,
        `${path}/${index}`,
        pointer,
        countText,
        maxBytes,
        invalid,
        dataTextLeaf,
        bytes
      )
  } else if (value !== null && typeof value === 'object') {
    /** Boundary-owned atomic text representations retain their original charging rule. */
    const leaf = dataTextLeaf?.(value as Readonly<Record<string, IErrorChainData>>)
    if (leaf) bytes += countText(leaf.text, `${path}/${escapePointer(leaf.key)}`)
    else
      for (const [key, item] of Object.entries(value)) {
        bytes += countText(key, `${path}/${escapePointer(key)}`)
        bytes = countErrorDataValue(
          item,
          `${path}/${escapePointer(key)}`,
          pointer,
          countText,
          maxBytes,
          invalid,
          dataTextLeaf,
          bytes
        )
      }
  }
  if (bytes > maxBytes) invalid(pointer)
  return bytes
}

/** Count portable diagnostic text once using the caller's unchanged scalar and overflow policies. */
export function countErrorDataText(
  value: IErrorChainData,
  pointer: string,
  countText: (text: string, pointer: string) => number,
  maxBytes: number,
  invalid: (pointer: string) => never,
  dataTextLeaf?: IErrorChainStrategy['dataTextLeaf']
): number {
  return countErrorDataValue(value, pointer, pointer, countText, maxBytes, invalid, dataTextLeaf, 0)
}

/** Escape an RFC 6901 pointer segment without interpreting the source key. */
export function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** Reject lone UTF-16 surrogate halves instead of silently replacing them on receive. */
export function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    /** Inspect the scalar encoding without a host-specific TextEncoder dependency. */
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      /** Reject data-key collisions or malformed descendants rather than returning a lossy record. */
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

/** Count UTF-8 bytes from Unicode scalar values without a host-specific encoder. */
export function utf8Bytes(value: string): number {
  /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
  let bytes = 0
  for (const scalar of value) {
    /** Inspect the scalar encoding without a host-specific TextEncoder dependency. */
    const code = scalar.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}
