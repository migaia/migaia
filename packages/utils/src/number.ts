import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'

/** Public numeric values accepted without lossy coercion from strings. */
export type INumericValue = number | bigint

/** Locale and Intl policy used by all numeric format helpers. */
export type INumberFormatOptions = {
  readonly locales?: Intl.LocalesArgument
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
    source: '@migaia/utils',
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
  const keys = Object.keys(source).sort()
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
