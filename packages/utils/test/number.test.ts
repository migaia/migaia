import { describe, expect, it } from 'vitest'
import {
  createNumberFormatter,
  formatCompactNumber,
  formatCurrency,
  formatInteger,
  formatNumber,
  formatPercent
} from '../src/number.js'

describe('number formatting', () => {
  it('formats decimal, currency, percent, inventory, and compact quantitative values', () => {
    expect(formatNumber(1234.5, { locales: 'en-US' })).toBe('1,234.5')
    expect(
      formatCurrency(1234.5, 'USD', {
        locales: 'en-US',
        format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      })
    ).toBe('$1,234.50')
    expect(formatPercent(0.125, { locales: 'en-US', format: { maximumFractionDigits: 1 } })).toBe(
      '12.5%'
    )
    expect(formatInteger(1234.8, { locales: 'en-US' })).toBe('1,235')
    expect(formatCompactNumber(1_200_000, { locales: 'en-US' })).toBe('1.2M')
  })

  it('creates reusable hot-loop formatters and preserves bigint precision', () => {
    const formatter = createNumberFormatter({
      locales: 'en-US',
      format: { useGrouping: false }
    })
    expect(formatter(9007199254740993n)).toBe('9007199254740993')
    expect(formatter(42)).toBe('42')
  })

  it('lets callers own integer precision overrides', () => {
    expect(
      formatInteger(12.34, {
        locales: 'en-US',
        format: { minimumFractionDigits: 1, maximumFractionDigits: 1 }
      })
    ).toBe('12.3')
  })

  it('keeps native Intl failures and attaches stable package identity', () => {
    try {
      formatCurrency(1, 'NOT_A_CURRENCY', { locales: 'en-US' })
      expect.fail('expected invalid currency failure')
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError)
      expect(error).toMatchObject({ code: 'NUMBER_FORMAT_INVALID', source: '@migaia/utils' })
    }
  })

  it('reads locale and each hostile option once before constructing Intl', () => {
    let localeReads = 0
    let groupingReads = 0
    const format = Object.defineProperty({}, 'useGrouping', {
      enumerable: true,
      get: () => {
        groupingReads += 1
        return false
      }
    })
    const options = Object.defineProperties(
      {},
      {
        locales: {
          enumerable: true,
          get: () => {
            localeReads += 1
            return 'en-US'
          }
        },
        format: { enumerable: true, value: format }
      }
    )
    expect(formatNumber(1234, options)).toBe('1234')
    expect(localeReads).toBe(1)
    expect(groupingReads).toBe(1)
  })
})
