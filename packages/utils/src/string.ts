/**
 * Owns safe string conversion and literal template formatting, plus the canonical key-order export.
 * Exposes text operations without host formatting, lifecycle or configuration ownership.
 */
import { ERROR_SOURCE, UtilsErrorCode } from './error-code.ts'
import { UtilsErrorText } from './error-text.ts'
import { attachErrorIdentity } from './error.ts'

/** Wire and fingerprint consumers share the same stable, linear UTF-16 key ordering. */
export { orderStringKeys } from './internal/string-order.ts'

/** Outcome of one conversion; failures retain the exact value thrown by user coercion. */
export type IStringConversion =
  | { readonly threw: false; readonly value: string }
  | { readonly threw: true; readonly error: unknown }

/**
 * Converts a value once with native String semantics, keeping strings unchanged. A hostile
 * conversion returns its original thrown value; the caller owns fallback, reporting, and rethrow.
 */
export function tryString(value: unknown): IStringConversion {
  try {
    return { threw: false, value: typeof value === 'string' ? value : String(value) }
  } catch (error) {
    return { threw: true, error }
  }
}

/** Placeholder delimiters used by the linear template scanner. */
export type IFormatPlaceholder = {
  readonly open: string
  readonly close: string
}

/** String-template policies; defaults preserve missing placeholders and blank nullish values. */
export type IFormatOptions = {
  readonly placeholder?: IFormatPlaceholder
  readonly missing?: 'preserve' | 'empty' | 'throw'
  readonly nullish?: 'empty' | 'stringify'
}

/** Resolved and validated formatting policy used by one scan. */
type IFormatPolicy = {
  readonly open: string
  readonly close: string
  readonly missing: 'preserve' | 'empty' | 'throw'
  readonly nullish: 'empty' | 'stringify'
}

/** Result of an own-property-only placeholder path lookup. */
type IFormatProbe =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly error: unknown }

/** Prototype-sensitive names are never traversed by a display template. */
const blockedFormatKeys = new Set(['__proto__', 'prototype', 'constructor'])
/** Default placeholder syntax kept immutable and allocation-free across calls. */
const defaultFormatPlaceholder: IFormatPlaceholder = Object.freeze({ open: '{', close: '}' })

/** Creates a native TypeError carrying the stable utils package identity. */
function createFormatError(
  code: typeof UtilsErrorCode.formatInvalid | typeof UtilsErrorCode.formatValueMissing,
  message: string,
  cause?: unknown
): TypeError {
  const error = new TypeError(message, cause === undefined ? undefined : { cause })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
}

/** Snapshots formatting options once before scanning user-controlled text. */
function snapshotFormatPolicy(options: IFormatOptions | undefined): IFormatPolicy {
  try {
    const placeholder = options?.placeholder ?? defaultFormatPlaceholder
    const open = placeholder.open
    const close = placeholder.close
    const missing = options?.missing ?? 'preserve'
    const nullish = options?.nullish ?? 'empty'
    if (
      typeof open !== 'string' ||
      typeof close !== 'string' ||
      open.length === 0 ||
      close.length === 0 ||
      open === close ||
      open.length > 64 ||
      close.length > 64
    )
      throw createFormatError(
        UtilsErrorCode.formatInvalid,
        UtilsErrorText.formatInvalid('placeholder boundaries must be distinct non-empty strings')
      )
    if (missing !== 'preserve' && missing !== 'empty' && missing !== 'throw')
      throw createFormatError(
        UtilsErrorCode.formatInvalid,
        UtilsErrorText.formatInvalid('missing policy is unsupported')
      )
    if (nullish !== 'empty' && nullish !== 'stringify')
      throw createFormatError(
        UtilsErrorCode.formatInvalid,
        UtilsErrorText.formatInvalid('nullish policy is unsupported')
      )
    return { open, close, missing, nullish }
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error as { readonly code?: unknown }).code === UtilsErrorCode.formatInvalid
    )
      throw error
    throw createFormatError(
      UtilsErrorCode.formatInvalid,
      UtilsErrorText.formatInvalid('options could not be read'),
      error
    )
  }
}

/** Traverses a dot path through own properties only and contains hostile getters. */
function probeFormatValue(values: Readonly<Record<string, unknown>>, path: string): IFormatProbe {
  if (path.length === 0) return { kind: 'missing' }
  const segments = path.split('.')
  let current: unknown = values
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      blockedFormatKeys.has(segment) ||
      current === null ||
      (typeof current !== 'object' && typeof current !== 'function')
    )
      return { kind: 'missing' }
    try {
      if (!Object.hasOwn(current, segment)) return { kind: 'missing' }
      current = (current as Record<string, unknown>)[segment]
    } catch (error) {
      return { kind: 'failed', error }
    }
  }
  return { kind: 'value', value: current }
}

/**
 * Collapses doubled closing delimiters without rescanning the entire remaining template per span.
 * Lookahead retains the original handling of a doubled delimiter beginning before the span ends.
 * Delimiters are capped at 64 units by snapshotFormatPolicy, so overlap adds at most 127 units.
 */
function appendLiteral(
  output: string[],
  source: string,
  start: number,
  end: number,
  close: string
): void {
  if (start >= end) return
  /** Only the current literal span is consumed by this invocation. */
  let cursor = start
  /** A doubled delimiter has the compile-time admitted maximum width of 128 UTF-16 units. */
  const escapedClose = close + close
  /** Bound native substring search while preserving matches that start inside the literal span. */
  const span = source.slice(start, end + escapedClose.length - 1)
  while (cursor < end) {
    /** Relative search position is translated back to the original template for unchanged slices. */
    const found = span.indexOf(escapedClose, cursor - start)
    /** Negative means absent, rather than the original start minus one. */
    const escapeAt = found < 0 ? -1 : start + found
    if (escapeAt < 0 || escapeAt >= end) {
      output.push(source.slice(cursor, end))
      return
    }
    output.push(source.slice(cursor, escapeAt), close)
    cursor = escapeAt + escapedClose.length
  }
}

/** Converts one resolved value without silently swallowing hostile coercion failures. */
function stringifyFormatValue(value: unknown, policy: IFormatPolicy): string {
  if (value === null || value === undefined) return policy.nullish === 'empty' ? '' : String(value)
  try {
    return String(value)
  } catch (error) {
    throw createFormatError(
      UtilsErrorCode.formatInvalid,
      UtilsErrorText.formatInvalid('placeholder value could not be converted'),
      error
    )
  }
}

/**
 * Replaces placeholder paths in one linear scan. Doubled delimiters emit literal delimiters.
 * Missing paths are preserved by default so malformed user-visible templates fail visibly.
 */
export function format(
  source: string,
  values: Readonly<Record<string, unknown>>,
  options?: IFormatOptions
): string {
  if (typeof source !== 'string' || values === null || typeof values !== 'object')
    throw createFormatError(
      UtilsErrorCode.formatInvalid,
      UtilsErrorText.formatInvalid('source and values must be a string and object')
    )
  const policy = snapshotFormatPolicy(options)
  const output: string[] = []
  const escapedOpen = policy.open + policy.open
  let cursor = 0
  while (cursor < source.length) {
    const openAt = source.indexOf(policy.open, cursor)
    if (openAt < 0) {
      appendLiteral(output, source, cursor, source.length, policy.close)
      break
    }
    appendLiteral(output, source, cursor, openAt, policy.close)
    if (source.startsWith(escapedOpen, openAt)) {
      output.push(policy.open)
      cursor = openAt + escapedOpen.length
      continue
    }
    const keyStart = openAt + policy.open.length
    const closeAt = source.indexOf(policy.close, keyStart)
    if (closeAt < 0) {
      output.push(source.slice(openAt))
      break
    }
    const path = source.slice(keyStart, closeAt)
    const probe = probeFormatValue(values, path)
    if (probe.kind === 'value') output.push(stringifyFormatValue(probe.value, policy))
    else if (probe.kind === 'failed')
      throw createFormatError(
        UtilsErrorCode.formatInvalid,
        UtilsErrorText.formatInvalid(`value at ${path} could not be read`),
        probe.error
      )
    else if (policy.missing === 'preserve')
      output.push(source.slice(openAt, closeAt + policy.close.length))
    else if (policy.missing === 'throw')
      throw createFormatError(
        UtilsErrorCode.formatValueMissing,
        UtilsErrorText.formatValueMissing(path)
      )
    cursor = closeAt + policy.close.length
  }
  return output.join('')
}
