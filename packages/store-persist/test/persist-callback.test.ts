import { describe, expect, it } from 'vitest'
import { runPersistCallback } from '../src/core/persist-callback.ts'

/** Code used for the classified failures in these cases. */
const code = 'PARTIALIZE_FAILED' as never

describe('persist callback failure classification', () => {
  it('returns the callback value when it succeeds', () => {
    expect(runPersistCallback(code, 'failed', () => 3)).toBe(3)
  })

  it('passes through an error that already has source and code', () => {
    const coded = Object.assign(new Error('coded'), { source: 'app', code: 'APP_FAILED' })
    expect(() =>
      runPersistCallback(code, 'failed', () => {
        throw coded
      })
    ).toThrow(coded)
  })

  it('codes any other failure and keeps it on cause', () => {
    for (const failure of [new Error('plain'), 'text', null]) {
      let thrown: unknown
      try {
        runPersistCallback(code, 'failed', () => {
          throw failure
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ code: 'PARTIALIZE_FAILED' })
      expect((thrown as Error).cause).toBe(failure)
    }
  })
})
