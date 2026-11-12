import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { sharedInt32, sharedInt32Array } from '../src/shared-state.ts'

const describeShared = typeof SharedArrayBuffer !== 'undefined' ? describe : describe.skip

describeShared('shared buffer admission', () => {
  it('rejects a null buffer for a signal and for an array', () => {
    expect(() => sharedInt32(createRuntime(), 0, null as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(() => sharedInt32Array(createRuntime(), 1, { buffer: null as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  })

  it('rejects a zeroed shared buffer whose header was never written', () => {
    expect(() => sharedInt32(createRuntime(), 0, new SharedArrayBuffer(32))).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  })

  it('codes a throwing array option getter', () => {
    const getterFailure = new Error('buffer getter failed')
    expect(() =>
      sharedInt32Array(createRuntime(), 1, {
        get buffer(): never {
          throw getterFailure
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: getterFailure }))
  })
})
