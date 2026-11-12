import { describe, expect, it } from 'vitest'
import { runAtomCallback } from '../src/atom/callback-failure.ts'

describe('atom callback failure classification', () => {
  it('returns the callback value when it succeeds', () => {
    expect(runAtomCallback(() => 7)).toBe(7)
  })

  it('passes through an error that already has source and code', () => {
    const coded = Object.assign(new Error('coded'), { source: 'app', code: 'APP_FAILED' })
    expect(() =>
      runAtomCallback(() => {
        throw coded
      })
    ).toThrow(coded)
  })

  it('wraps an uncoded or non-object failure as CALLBACK_FAILED with it on cause', () => {
    for (const failure of [new Error('plain'), 'text', null]) {
      let thrown: unknown
      try {
        runAtomCallback(() => {
          throw failure
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ code: 'CALLBACK_FAILED' })
      expect((thrown as Error).cause).toBe(failure)
    }
  })
})
