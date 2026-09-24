import { expect, it } from 'vitest'
import { defineFeature } from '../src/index.js'
import { compileFeatures, instantiateFeatures } from '../src/feature-runtime.js'

it('re-reports a rejected Feature with both the rejection and reporter failure reachable', async () => {
  const originalCause = new Error('original cause')
  const original = new Error('feature rejection', { cause: originalCause })
  const reporterFailure = new Error('reporter failure')
  const invalid = defineFeature((() => Promise.reject(original)) as never)
  const roots = { invalid }
  const observed: unknown[] = []
  let calls = 0

  expect(() =>
    instantiateFeatures(roots, {}, compileFeatures(roots), (error) => {
      calls += 1
      if (calls === 1) throw reporterFailure
      observed.push(error)
    })
  ).toThrow(TypeError)
  await Promise.resolve()
  await Promise.resolve()
  expect(observed).toHaveLength(1)
  const wrapped = observed[0] as Error & { readonly code: string }
  expect(wrapped.code).toBe('PLUGIN_INSTALL_FAILED')
  expect(wrapped.cause).toBeInstanceOf(AggregateError)
  expect((wrapped.cause as AggregateError).errors).toEqual([original, reporterFailure])
  expect(original.cause).toBe(originalCause)
})
