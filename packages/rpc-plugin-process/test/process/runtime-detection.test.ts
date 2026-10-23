import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeProcessRuntimeLoader } from '../../dist/process/runtime-loader.js'

/** Native globals remain real except the runtime markers whose canonical precedence is exercised. */
const originalProcess = process

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('process native runtime selection', () => {
  it('selects node, bun and deno through canonical markers while Electron stays on node I/O', async () => {
    for (const [runtime, versions, deno, bun] of [
      ['node', { node: '24' }, undefined, undefined],
      ['bun', { node: '24', bun: '1' }, undefined, {}],
      [
        'deno',
        { node: '24' },
        {
          version: { deno: '2' },
          env: { get: () => undefined },
          permissions: { querySync: () => ({ state: 'denied' }) }
        },
        undefined
      ],
      ['node', { node: '24', electron: '44' }, undefined, undefined]
    ] as const) {
      vi.stubGlobal('process', { ...originalProcess, versions, type: 'browser', env: {} })
      vi.stubGlobal('Deno', deno)
      vi.stubGlobal('Bun', bun)
      const loaded = await new NativeProcessRuntimeLoader().load()
      expect(loaded?.processRuntimeIO.discover().runtime).toBe(runtime)
    }
  })

  it('uses canonical runtime and Electron selection in all three original native owning modules', async () => {
    const loader = await readFile(
      new URL('../../src/process/runtime-loader.ts', import.meta.url),
      'utf8'
    )
    const node = await readFile(
      new URL('../../src/process/adapters/node-peer.ts', import.meta.url),
      'utf8'
    )
    const source = await readFile(
      new URL('../../src/process/adapters/short-source.ts', import.meta.url),
      'utf8'
    )
    expect(loader).toContain('detectServerRuntime()')
    expect(node).toContain('detectServerRuntime()')
    expect(source).toContain('detectElectronProcessType()')
    expect(loader).not.toContain('process.versions')
    expect(node).not.toContain('process.versions')
    expect(source).not.toContain('process.versions.electron')
  })
})
