import { expect, it } from 'vitest'
import { defineOutputPlugin } from '../src/plugin.ts'

it('codes an output feature record whose descriptors cannot be read', () => {
  const readFailure = new Error('descriptor read failed')
  const features = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw readFailure
      },
      ownKeys() {
        return ['threshold']
      }
    }
  )
  let thrown: unknown
  try {
    defineOutputPlugin({
      name: 'unreadable',
      batchable: false,
      deliver: () => {},
      features
    } as never)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code: 'INVALID_OPTION' })
})

it('accepts false only for roles an output may disable locally', () => {
  /** Output definition with the given features record. */
  const define = (features: Record<string, false>) => () =>
    defineOutputPlugin({
      name: 'local',
      batchable: true,
      defaultFormat: 'json',
      deliver: () => {},
      features
    } as never)
  expect(define({ format: false })).not.toThrow()
  expect(define({ threshold: false })).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION' })
  )
})
