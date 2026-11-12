import { expect, it } from 'vitest'
import { httpEndpoint } from '../src/http.ts'

it('codes unreadable options and an unsendable bearer token as INVALID_ARGUMENT', () => {
  const readFailure = new Error('options unreadable')
  const options = new Proxy(
    {},
    {
      ownKeys() {
        throw readFailure
      }
    }
  )
  expect(() => httpEndpoint(options as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: readFailure })
  )
  expect(() =>
    httpEndpoint({
      queryUrl: 'http://example.invalid/query',
      updateUrl: 'http://example.invalid/update',
      auth: { bearer: 'bad\u0000token' }
    } as never)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
})
