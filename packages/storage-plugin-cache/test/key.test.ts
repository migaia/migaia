import { describe, expect, it } from 'vitest'
import { cacheKey, CacheWriteMode, CacheErrorCode, ERROR_SOURCE } from '../src/index.js'
import { cacheError } from '../src/errors.js'

describe('canonical cache inputs', () => {
  it('uses portable object ordering while retaining part order and content', async () => {
    const first = await cacheKey('response', { model: 'one', options: { seed: 1, temperature: 0 } })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(await cacheKey('response', { options: { temperature: 0, seed: 1 }, model: 'one' })).toBe(
      first
    )
    expect(
      await cacheKey('response', { model: 'two', options: { seed: 1, temperature: 0 } })
    ).not.toBe(first)
    expect(await cacheKey({ model: 'one' }, 'response')).not.toBe(first)
    expect(CacheWriteMode).toEqual({ through: 'through', back: 'back' })
  })
  it('retains the original portable failure and rejects an empty request before hashing', async () => {
    await expect(cacheKey({ callback: (() => undefined) as never })).rejects.toMatchObject({
      code: expect.any(String)
    })
    await expect(Reflect.apply(cacheKey, undefined, [])).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })
  it('wraps a loader failure without dropping its native type, stack or original cause', () => {
    const original = Object.freeze(new RangeError('original loader failure')),
      error = cacheError(CacheErrorCode.loadFailed, original)
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({
      source: ERROR_SOURCE,
      code: 'CACHE_LOAD_FAILED',
      cause: original
    })
    expect(error.stack).toBeTruthy()
    expect(original.stack).toBeTruthy()
  })
})
