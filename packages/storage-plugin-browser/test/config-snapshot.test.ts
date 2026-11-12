import { expect, it } from 'vitest'
import { snapshotBrowserConfig } from '../src/utils/config-snapshot.ts'

it('returns non-objects and arrays unchanged and codes an unreadable options object', () => {
  expect(snapshotBrowserConfig(undefined)).toBeUndefined()
  const list = [1]
  expect(snapshotBrowserConfig(list)).toBe(list)
  const readFailure = new Error('option read failed')
  const options = new Proxy(
    {},
    {
      ownKeys() {
        throw readFailure
      }
    }
  )
  expect(() => snapshotBrowserConfig(options)).toThrowError(
    expect.objectContaining({ code: 'INVALID_CONFIG', cause: readFailure })
  )
})
