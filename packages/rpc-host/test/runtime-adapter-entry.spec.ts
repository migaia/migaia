import { describe, expect, it } from 'vitest'
import { resolveAdapterEntry, retainAdapterRuntimeFlags } from '../dist/runtime-adapter/entry.js'

describe('short-source main entry policy', () => {
  it('preserves loaders while removing eval and test controller arguments for another entry', () => {
    expect(
      retainAdapterRuntimeFlags([
        '--import',
        './loader.mjs',
        '--eval',
        'sideEffect()',
        '--test',
        '--test-name-pattern',
        'pattern',
        '--trace-warnings'
      ])
    ).toEqual(['--import', './loader.mjs', '--trace-warnings'])
    expect(
      retainAdapterRuntimeFlags([
        '--input-type=module',
        '--eval=sideEffect()',
        '--print',
        'value',
        '--import=./loader.mjs'
      ])
    ).toEqual(['--import=./loader.mjs'])
  })
  it('uses the main entry directory and preserves exact URLs', () => {
    expect(resolveAdapterEntry('./service.ts', { mainEntry: 'file:///app/main.ts' })).toBe(
      'file:///app/service.ts'
    )
    expect(
      resolveAdapterEntry('./service.ts', {
        mainEntry: 'file:///app/main.ts',
        base: 'file:///other/main.ts'
      })
    ).toBe('file:///other/service.ts')
    expect(resolveAdapterEntry(new URL('file:///exact/service.ts?variant=1'), {})).toBe(
      'file:///exact/service.ts?variant=1'
    )
    expect(resolveAdapterEntry(true, { mainEntry: 'file:///app/main.ts' })).toBe(
      'file:///app/main.ts'
    )
  })

  it.each([
    {},
    { mainEntry: 'file:///app/main.ts', execArgv: ['--eval=1'] },
    { mainEntry: 'file:///app/main.ts', execArgv: ['--test'] },
    { mainEntry: 'file:///app/node_modules/vitest/vitest.mjs' },
    { mainEntry: 'file:///app/main.ts', electron: true },
    { mainEntry: 'file:///app/main.ts', singleBinary: true },
    { mainEntry: 'file:///$bunfs/root/main.ts' },
    { mainEntry: 'file:///app/main.ts', selfAllowed: false }
  ])('rejects unusable self entries before launch: %o', (options) => {
    expect(() => resolveAdapterEntry(true, options)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  })

  it('retains the native URL error as the cause of invalid configuration', () => {
    expect(() => resolveAdapterEntry('./service.ts', {})).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(() => resolveAdapterEntry('./service.ts', { base: 'invalid base' })).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG', cause: expect.any(TypeError) })
    )
  })
})
