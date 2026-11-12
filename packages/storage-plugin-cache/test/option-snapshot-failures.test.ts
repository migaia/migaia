import { expect, it } from 'vitest'
import { snapshotCacheOptions } from '../src/policy.ts'

it('passes a coded validation failure through unchanged', () => {
  let thrown: unknown
  try {
    snapshotCacheOptions(null as never)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(Error)
  expect(typeof (thrown as { code?: unknown }).code).toBe('string')
})

it('codes a throwing option getter and keeps the getter error reachable', () => {
  const getterFailure = new Error('option getter failed')
  const options = new Proxy(
    {},
    {
      get() {
        throw getterFailure
      }
    }
  )
  let thrown: unknown
  try {
    snapshotCacheOptions(options as never)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code: 'CACHE_TIER_INVALID' })
  expect([thrown, (thrown as Error).cause]).toContain(getterFailure)
})
