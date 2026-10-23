import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { detectServerRuntime } from '../src/index.js'

afterEach(() => vi.unstubAllGlobals())

describe('detectServerRuntime', () => {
  it.each([
    ['deno', {}, { bun: '1.3.0', node: '24.0.0' }],
    ['deno', {}, { node: '24.0.0' }],
    ['bun', undefined, { bun: '1.3.0', node: '24.0.0' }],
    ['node', undefined, { node: '24.0.0' }],
    [undefined, undefined, {}]
  ] as const)('returns %s from the supported host signals', (expected, deno, versions) => {
    vi.stubGlobal('Deno', deno)
    vi.stubGlobal('process', { versions })
    expect(detectServerRuntime()).toBe(expected)
  })

  it('returns undefined when a browser provides no server globals', () => {
    vi.stubGlobal('Deno', undefined)
    vi.stubGlobal('process', undefined)
    expect(detectServerRuntime()).toBeUndefined()
  })

  it('exposes only the documented runtime names and the browser result', () => {
    expectTypeOf(detectServerRuntime).returns.toEqualTypeOf<'deno' | 'bun' | 'node' | undefined>()
  })
})
