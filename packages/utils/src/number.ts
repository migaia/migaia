/** Numeric and stable-key calculations own their validation; scheduling and IO remain external. */
import { ERROR_SOURCE, UtilsErrorCode } from './error-code.ts'
import { UtilsErrorText } from './error-text.ts'
import { attachErrorIdentity } from './error.ts'
import { orderStringKeys } from './internal/string-order.ts'

/** Builds a native argument error while retaining an injected random callback's thrown value. */
function jitterArgumentError(message: string, cause?: unknown): RangeError {
  return attachErrorIdentity(new RangeError(message, { cause }), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.invalidArgument
  })
}

/**
 * Shortens a finite non-negative value by at most `ratio`, which must be between zero and one.
 * Calls `random` once after argument validation; its result must also be between zero and one.
 * Invalid inputs and callback failures throw a coded RangeError, retaining callback failures as
 * cause.
 */
export function jitter(value: number, ratio: number, random: () => number = Math.random): number {
  if (!Number.isFinite(value) || value < 0) {
    throw jitterArgumentError(UtilsErrorText.jitterValueInvalid)
  }
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw jitterArgumentError(UtilsErrorText.jitterRatioInvalid)
  }
  /** One sample determines the reduction and is never retried if the callback fails. */
  let sample: number
  try {
    sample = random()
  } catch (cause) {
    throw jitterArgumentError(UtilsErrorText.jitterRandomFailed, cause)
  }
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw jitterArgumentError(UtilsErrorText.jitterRandomInvalid)
  }
  return value * (1 - ratio * sample)
}

/** Public numeric values accepted without lossy coercion from strings. */
export type INumericValue = number | bigint

/** Locale and Intl policy used by all numeric format helpers. */
export type INumberFormatOptions = {
  /** Locale preference passed through canonical `Intl.getCanonicalLocales` normalization. */
  readonly locales?: Intl.LocalesArgument
  /** Native `Intl.NumberFormat` policy merged with the helper-specific defaults. */
  readonly format?: Intl.NumberFormatOptions
}

/** Reusable formatter for hot loops such as inventory tables and market data. */
export type INumberFormatter = (value: INumericValue) => string

/** Immutable locale/options snapshot shared by cache identity and Intl construction. */
type INumberFormatSnapshot = {
  readonly locales: readonly string[]
  readonly format: Intl.NumberFormatOptions
  readonly key: string
}

/** Small FIFO cache bounds retained Intl instances while accelerating repeated one-shot calls. */
const numberFormatterCache = new Map<string, Intl.NumberFormat>()
/** Cache bound prevents user-controlled option combinations from retaining unbounded formatters. */
const numberFormatterCacheLimit = 64

/** Attaches utils identity to the original native Intl error. */
function codeNumberFormatError(error: unknown): Error {
  const nativeError =
    error instanceof Error
      ? error
      : new TypeError(UtilsErrorText.numberFormatInvalid, { cause: error })
  return attachErrorIdentity(nativeError, {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.numberFormatInvalid
  })
}

/** Reads every caller option once, then derives cache identity from the same Intl input. */
function snapshotNumberFormat(options: INumberFormatOptions | undefined): INumberFormatSnapshot {
  const locales = options?.locales
  const source = options?.format ?? {}
  const normalizedLocales =
    locales === undefined
      ? []
      : Intl.getCanonicalLocales(Array.isArray(locales) ? locales.map(String) : [String(locales)])
  const keys = orderStringKeys(Object.keys(source))
  const format: Record<string, unknown> = {}
  const entries: Array<readonly [string, unknown]> = []
  for (const key of keys) {
    const value = source[key as keyof Intl.NumberFormatOptions]
    format[key] = value
    entries.push([key, value])
  }
  return {
    locales: normalizedLocales,
    format: format as Intl.NumberFormatOptions,
    key: JSON.stringify([normalizedLocales, entries])
  }
}

/** Returns one cached Intl formatter while containing invalid locale and option failures. */
function getNumberFormatter(options: INumberFormatOptions | undefined): Intl.NumberFormat {
  try {
    const snapshot = snapshotNumberFormat(options)
    const cached = numberFormatterCache.get(snapshot.key)
    if (cached) return cached
    const formatter = new Intl.NumberFormat(snapshot.locales, snapshot.format)
    if (numberFormatterCache.size >= numberFormatterCacheLimit) {
      const oldest = numberFormatterCache.keys().next().value
      if (oldest !== undefined) numberFormatterCache.delete(oldest)
    }
    numberFormatterCache.set(snapshot.key, formatter)
    return formatter
  } catch (error) {
    throw codeNumberFormatError(error)
  }
}

/** Creates a reusable formatter so hot loops pay option parsing and cache lookup only once. */
export function createNumberFormatter(options?: INumberFormatOptions): INumberFormatter {
  const formatter = getNumberFormatter(options)
  return (value) => {
    try {
      return formatter.format(value)
    } catch (error) {
      throw codeNumberFormatError(error)
    }
  }
}

/** Formats one number or bigint with explicit Intl policy and cached formatter reuse. */
export function formatNumber(value: INumericValue, options?: INumberFormatOptions): string {
  const formatter = getNumberFormatter(options)
  try {
    return formatter.format(value)
  } catch (error) {
    throw codeNumberFormatError(error)
  }
}

/** Formats money while requiring the caller to own currency and rounding policy. */
export function formatCurrency(
  value: INumericValue,
  currency: string,
  options?: INumberFormatOptions
): string {
  return formatNumber(value, {
    locales: options?.locales,
    format: { ...options?.format, style: 'currency', currency }
  })
}

/** Formats a ratio as a percentage while leaving precision policy configurable. */
export function formatPercent(value: INumericValue, options?: INumberFormatOptions): string {
  return formatNumber(value, {
    locales: options?.locales,
    format: { ...options?.format, style: 'percent' }
  })
}

/** Formats inventory-style whole numbers; callers may override fraction policy explicitly. */
export function formatInteger(value: INumericValue, options?: INumberFormatOptions): string {
  return formatNumber(value, {
    locales: options?.locales,
    format: { maximumFractionDigits: 0, ...options?.format }
  })
}

/** Formats large quantitative values with compact notation and caller-owned precision. */
export function formatCompactNumber(value: INumericValue, options?: INumberFormatOptions): string {
  return formatNumber(value, {
    locales: options?.locales,
    format: { ...options?.format, notation: 'compact' }
  })
}
