import { expect, it } from 'vitest'
import { consolePlugin } from '../src/index.ts'

it('codes a throwing option getter as INVALID_OPTION with the getter error on cause', () => {
  const getterFailure = new Error('option getter failed')
  expect(() =>
    consolePlugin({
      get colors(): never {
        throw getterFailure
      }
    } as never)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: getterFailure }))
})
