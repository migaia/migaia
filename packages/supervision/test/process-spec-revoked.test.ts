import { expect, it } from 'vitest'
import { validateProcessSpec } from '../src/process/spec.ts'

it('codes a revoked Proxy spec as INVALID_OPTION with the Proxy error on cause', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  let thrown: unknown
  try {
    validateProcessSpec(proxy)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code: 'INVALID_OPTION' })
  expect((thrown as Error).cause).toBeInstanceOf(TypeError)
})

it('rejects a spec that is not an object', () => {
  expect(() => validateProcessSpec(null)).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION' })
  )
})
