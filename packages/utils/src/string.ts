import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'

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
  return attachErrorIdentity(error, { source: '@migaia/utils', code })
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

/** Collapses doubled closing delimiters in literal spans without compiling a dynamic RegExp. */
function appendLiteral(
  output: string[],
  source: string,
  start: number,
  end: number,
  close: string
): void {
  let cursor = start
  const escapedClose = close + close
  while (cursor < end) {
    const escapeAt = source.indexOf(escapedClose, cursor)
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
