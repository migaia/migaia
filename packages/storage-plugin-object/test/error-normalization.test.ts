import { describe, expect, it } from 'vitest'
import { isMissing, normalizeObjectError } from '../src/errors.ts'

describe('normalizeObjectError', () => {
  it('replaces frozen native errors with the same class and keeps them on cause', () => {
    for (const cause of [
      Object.freeze(new TypeError('frozen type')),
      Object.freeze(new RangeError('frozen range')),
      Object.freeze(new DOMException('frozen dom', 'AbortError'))
    ]) {
      const error = normalizeObjectError(cause)
      expect(error.constructor).toBe(cause.constructor)
      expect(error.cause).toBe(cause)
      expect(error).toHaveProperty('code')
    }
  })

  it('codes a non-native failure and recognises missing-file errors', () => {
    expect(normalizeObjectError('text')).toHaveProperty('code')
    expect(isMissing(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissing(new Error('other'))).toBe(false)
  })
})
