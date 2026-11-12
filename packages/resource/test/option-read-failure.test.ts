import { expect, it } from 'vitest'
import { createResource } from '../src/index.ts'

it('codes an options object that cannot be read as INVALID_OPTION', () => {
  const getterFailure = new Error('options read failed')
  const options = new Proxy(
    {},
    {
      ownKeys() {
        throw getterFailure
      }
    }
  )
  expect(() => createResource(() => async () => 1, options as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION', cause: getterFailure })
  )
})

it('releases a subscription whose first delivery disposes the resource', () => {
  const resource = createResource(() => async () => 1)
  let calls = 0
  const stop = resource.subscribe(() => {
    calls += 1
    resource.dispose()
  })
  expect(calls).toBe(1)
  expect(() => stop()).not.toThrow()
})

it('rejects a non-function cleanup during setup', () => {
  expect(() =>
    createResource((context) => {
      context.onDispose(1 as never)
      return async () => 1
    })
  ).toThrowError(expect.objectContaining({ code: 'RESOURCE_SETUP_INVALID' }))
})

it('codes a cleanup failure during dispose and keeps the original error reachable', () => {
  const cleanupFailure = new Error('cleanup failed')
  const resource = createResource((context) => {
    context.onDispose(() => {
      throw cleanupFailure
    })
    return async () => 1
  })
  let thrown: unknown
  try {
    resource.dispose()
  } catch (error) {
    thrown = error
  }
  expect([thrown, (thrown as Error).cause]).toContain(cleanupFailure)
})
