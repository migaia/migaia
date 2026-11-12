import { expect, it } from 'vitest'
import { filePlugin } from '../src/index.ts'

it('codes a throwing option getter as INVALID_OPTION with the getter error on cause', () => {
  const getterFailure = new Error('option getter failed')
  expect(() =>
    filePlugin({
      get path(): never {
        throw getterFailure
      }
    } as never)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: getterFailure }))
})
