/** Abbreviated weekdays accepted by IMF-fixdate and asctime-date. */
const HTTP_DATE_SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Full weekdays accepted only by the obsolete RFC 850 HTTP-date form. */
const HTTP_DATE_LONG_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const

/** Three-letter months shared by every HTTP-date grammar variant. */
const HTTP_DATE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

type IHttpDateParts = {
  readonly day: number
  readonly month: number
  readonly year: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly weekday: number
}

/** Turns a strict four-digit or obsolete two-digit HTTP year into a calendar year. */
function resolveHttpDateYear(value: string, nowYear: number): number {
  if (value.length === 4) return Number(value)
  /** Resolve obsolete two-digit years in the current century before applying the fifty-year rule. */
  const centuryYear = Math.floor(nowYear / 100) * 100 + Number(value)
  return centuryYear > nowYear + 50 ? centuryYear - 100 : centuryYear
}

/** Validates a parsed HTTP-date calendar tuple without relying on permissive Date.parse rules. */
function toHttpDateTimestamp(parts: IHttpDateParts): number | undefined {
  if (parts.year < 1 || parts.day < 1 || parts.hour > 23 || parts.minute > 59 || parts.second > 59)
    return undefined
  /** Date instance whose UTC fields are checked after the calendar tuple is materialized. */
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0)
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second ||
    date.getUTCDay() !== parts.weekday
  )
    return undefined
  return date.getTime()
}

/** Parses one strict HTTP-date grammar variant without accepting Date.parse extensions. */
function parseHttpDate(value: string): number | undefined {
  /** Current UTC year used only for RFC 850 two-digit-year interpretation. */
  const nowYear = new Date(Date.now()).getUTCFullYear()
  /** The fixed weekday token list is used only to construct the strict HTTP grammar. */
  const shortWeekday = HTTP_DATE_SHORT_WEEKDAYS.join('|')
  /** RFC 850 alone accepts the full weekday spelling. */
  const longWeekday = HTTP_DATE_LONG_WEEKDAYS.join('|')
  /** Month alternatives come from the fixed HTTP-date token table. */
  const month = HTTP_DATE_MONTHS.join('|')
  /** IMF-fixdate requires exact separators, GMT and four-digit years. */
  const imf = new RegExp(
    `^(${shortWeekday}), ([0-3][0-9]) (${month}) ([0-9]{4}) ([0-2][0-9]):([0-5][0-9]):([0-5][0-9]) GMT$`
  ).exec(value)
  if (imf) {
    return toHttpDateTimestamp({
      weekday: HTTP_DATE_SHORT_WEEKDAYS.indexOf(
        imf[1] as (typeof HTTP_DATE_SHORT_WEEKDAYS)[number]
      ),
      day: Number(imf[2]),
      month: HTTP_DATE_MONTHS.indexOf(imf[3] as (typeof HTTP_DATE_MONTHS)[number]),
      year: Number(imf[4]),
      hour: Number(imf[5]),
      minute: Number(imf[6]),
      second: Number(imf[7])
    })
  }
  /** The obsolete RFC 850 form retains its separate two-digit-year admission. */
  const rfc850 = new RegExp(
    `^(${longWeekday}), ([0-3][0-9])-(${month})-([0-9]{2}) ([0-2][0-9]):([0-5][0-9]):([0-5][0-9]) GMT$`
  ).exec(value)
  if (rfc850) {
    return toHttpDateTimestamp({
      weekday: HTTP_DATE_LONG_WEEKDAYS.indexOf(
        rfc850[1] as (typeof HTTP_DATE_LONG_WEEKDAYS)[number]
      ),
      day: Number(rfc850[2]),
      month: HTTP_DATE_MONTHS.indexOf(rfc850[3] as (typeof HTTP_DATE_MONTHS)[number]),
      year: resolveHttpDateYear(rfc850[4], nowYear),
      hour: Number(rfc850[5]),
      minute: Number(rfc850[6]),
      second: Number(rfc850[7])
    })
  }
  /** Asctime permits its exact single-digit-day padding and no other whitespace variants. */
  const asctime = new RegExp(
    `^(${shortWeekday}) (${month}) ((?: [1-9])|(?:[0-3][0-9])) ([0-2][0-9]):([0-5][0-9]):([0-5][0-9]) ([0-9]{4})$`
  ).exec(value)
  if (!asctime) return undefined
  return toHttpDateTimestamp({
    weekday: HTTP_DATE_SHORT_WEEKDAYS.indexOf(
      asctime[1] as (typeof HTTP_DATE_SHORT_WEEKDAYS)[number]
    ),
    day: Number(asctime[3].trim()),
    month: HTTP_DATE_MONTHS.indexOf(asctime[2] as (typeof HTTP_DATE_MONTHS)[number]),
    year: Number(asctime[7]),
    hour: Number(asctime[4]),
    minute: Number(asctime[5]),
    second: Number(asctime[6])
  })
}

/** Parses one strict Retry-After value and clamps valid delays to the admitted bound. */
export function parseRetryAfter(value: string | null, maxDelayMs: number): number | undefined {
  if (!value) return undefined
  if (/^[0-9]+$/.test(value)) {
    /** Numeric Retry-After values are seconds; finite excess and overflow clamp to the same bound. */
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.min(maxDelayMs, seconds * 1000)
    return maxDelayMs
  }
  /** A validated absolute date becomes a nonnegative delay from the current native clock. */
  const timestamp = parseHttpDate(value)
  if (timestamp !== undefined) return Math.min(maxDelayMs, Math.max(0, timestamp - Date.now()))
  return undefined
}
