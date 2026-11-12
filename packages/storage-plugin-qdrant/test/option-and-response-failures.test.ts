import { expect, it } from 'vitest'
import { qdrantBackendPlugin } from '../src/plugin.ts'
import { nativeResult } from '../src/protocol.ts'

/** Proxy whose own-key listing fails, so the option snapshot fails. */
function unreadable(failure: Error): object {
  return new Proxy(
    {},
    {
      ownKeys() {
        throw failure
      }
    }
  )
}

it('codes unreadable or ill-typed plugin options as INVALID_ARGUMENT', () => {
  const readFailure = new Error('options unreadable')
  expect(() => qdrantBackendPlugin(unreadable(readFailure) as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: readFailure })
  )
  expect(() => qdrantBackendPlugin({ url: 1 } as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT' })
  )
})

it('rejects route results with the wrong shape', () => {
  expect(() => nativeResult('createSnapshot' as never, [] as never)).toThrow()
  expect(() => nativeResult('retrieve' as never, {} as never)).toThrow()
  expect(nativeResult('createSnapshot' as never, undefined as never)).toBeNull()
})
