import { expect, it, vi } from 'vitest'
import { createRuntime } from '../src/index.ts'
import { assertOwnedBy, claimOwnership, ownerOf } from '../src/entry/extension.ts'

it('returns the registered runtime for callable objects', () => {
  /** Callable extension values share the same object ownership contract as ordinary nodes. */
  const runtime = createRuntime()
  /** The actual function remains callable after registration installs its diagnostic brand. */
  const value = () => 42
  claimOwnership(value, runtime)
  expect(ownerOf(value)).toBe(runtime)
  expect(value()).toBe(42)
})

it('rejects a registered callable at another runtime boundary', () => {
  /** Independent graphs cannot share a registered extension value. */
  const owner = createRuntime()
  /** The receiving graph must reject the existing owner before admitting the value. */
  const other = createRuntime()
  /** A function is a valid TypeScript object input to the public registration API. */
  const value = () => 42
  claimOwnership(value, owner)
  expect(() => assertOwnedBy(value, other, 'callable')).toThrow(
    expect.objectContaining({ source: 'reactive', code: 'CROSS_RUNTIME' })
  )
})

it('rejects foreign-copy callable ownership through the public extension entry', async () => {
  /** The original module owns a real registered callable before the second copy loads. */
  const runtime = createRuntime()
  /** No diagnostic brand is forged; public registration installs the original copy identity. */
  const value = () => 42
  claimOwnership(value, runtime)
  vi.resetModules()
  /** Reloading the public entry models a second module copy with its own ownership WeakMap. */
  const foreign = await import('../src/entry/extension.ts')
  expect(() => foreign.ownerOf(value)).toThrow(
    expect.objectContaining({ source: 'reactive', code: 'COPY_CONFLICT' })
  )
})
