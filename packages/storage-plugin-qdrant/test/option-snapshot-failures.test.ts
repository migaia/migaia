import { expect, it } from 'vitest'
import { snapshotRescoreOptions } from '../src/feature-input.ts'

it('passes a coded validation failure through unchanged', () => {
  let thrown: unknown
  try {
    snapshotRescoreOptions(null as never)
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
    snapshotRescoreOptions(options as never)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code: 'INVALID_ARGUMENT' })
  expect([thrown, (thrown as Error).cause]).toContain(getterFailure)
})
