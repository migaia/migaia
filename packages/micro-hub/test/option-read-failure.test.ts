import { expect, it } from 'vitest'
import { createMicroHub, defineContract } from '../src/index.ts'

/** Proxy whose own-key listing fails, so any snapshot of it fails. */
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

it('codes unreadable hub options as INVALID_OPTION with the error on cause', () => {
  const failure = new Error('options unreadable')
  expect(() => createMicroHub(unreadable(failure) as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION', cause: failure })
  )
})

it('codes an unreadable contract spec as INVALID_OPTION with the error on cause', () => {
  const failure = new Error('spec unreadable')
  expect(() => defineContract('broken', unreadable(failure) as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION', cause: failure })
  )
})
