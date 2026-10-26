import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { systemScheduler } from '@migaia/utils/scheduler'
import { walkErrorCauses } from '@migaia/utils/error'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { expandThreadSpawn } from '../../dist/threads/short-spawn.js'
import { threadRuntimeResource } from '../../dist/threads/runtime-resource.js'
import * as web from '../../dist/threads/web-launcher.js'
import * as node from '../../dist/threads/node-launcher.js'

/** Runtime markers are restored after each actual source-selection case. */
const nativeProcess = process

afterEach(() => vi.unstubAllGlobals())

describe('native thread runtime selection', () => {
  it('selects each canonical runtime marker and excludes browser Worker globals from thread sources', async () => {
    const webFactory = vi.spyOn(web, 'createWebThreadLauncher')
    const nodeFactory = vi.spyOn(node, 'createNodeThreadLauncher')
    try {
      for (const [kind, versions, bun, deno] of [
        ['bun', { node: '24' }, {}, undefined],
        ['bun', { node: '24', bun: '1' }, undefined, undefined],
        ['bun', { node: '24', bun: '1' }, {}, undefined],
        ['node', { node: '24' }, undefined, undefined],
        [
          'deno',
          { node: '24' },
          undefined,
          { version: { deno: '2' }, mainModule: import.meta.url }
        ],
        ['node', { node: '24', electron: '44' }, undefined, undefined]
      ] as const) {
        vi.stubGlobal('process', { ...nativeProcess, versions, type: 'browser' })
        vi.stubGlobal('Bun', bun)
        vi.stubGlobal('Deno', deno)
        const priorWeb = webFactory.mock.calls.length
        const priorNode = nodeFactory.mock.calls.length
        const source = await expandThreadSpawn(
          { spawn: new URL('./fixtures/adapter-idle.mts', import.meta.url) },
          threadRuntimeResource,
          () => undefined
        )
        expect(webFactory.mock.calls.length - priorWeb).toBe(kind === 'node' ? 0 : 1)
        expect(nodeFactory.mock.calls.length - priorNode).toBe(kind === 'node' ? 1 : 0)
        expect(source.launcher.capabilities).toEqual({
          termination: kind === 'deno' ? 'unsupported' : 'enforced',
          'exit-observation': kind === 'deno' ? 'unsupported' : 'enforced',
          'heap-limit': kind === 'node' ? 'enforced' : 'unsupported'
        })
      }
      vi.stubGlobal('process', { ...nativeProcess, versions: {} })
      vi.stubGlobal('Bun', undefined)
      vi.stubGlobal('Deno', undefined)
      vi.stubGlobal('Window', { [Symbol.hasInstance]: () => true })
      vi.stubGlobal('DedicatedWorkerGlobalScope', { [Symbol.hasInstance]: () => true })
      expect(() => threadPlugin({ spawn: new URL(import.meta.url) })).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(await isThreadChild()).toBe(false)
    } finally {
      webFactory.mockRestore()
      nodeFactory.mockRestore()
      vi.unstubAllGlobals()
    }
    for (const file of ['child.ts', 'plugin.ts', 'short-spawn.ts']) {
      const source = await readFile(new URL(`../../src/threads/${file}`, import.meta.url), 'utf8')
      expect(source).toContain('detectServerRuntime()')
      expect(source).not.toContain('process.versions')
      if (file === 'child.ts') {
        expect(source).toContain('detectGlobalScope()')
        expect(source).not.toContain('DedicatedWorkerGlobalScope')
      }
    }
  })

  it('runs genuine Bun and Deno Workers through the new source and retains each native capability vector', () => {
    const entry = fileURLToPath(new URL('./fixtures/host-plugin-native.mts', import.meta.url))
    for (const runtime of ['bun', 'deno'] as const) {
      const output = execFileSync(runtime, runtime === 'deno' ? ['run', '-A', entry] : [entry], {
        encoding: 'utf8',
        timeout: 15000
      })
      const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
      expect(receipt).toMatchObject({
        runtime,
        value: 'native-worker',
        values: [1, 2],
        capabilities: {
          termination: runtime === 'bun' ? 'enforced' : 'unsupported',
          'exit-observation': runtime === 'bun' ? 'enforced' : 'unsupported',
          'heap-limit': 'unsupported'
        }
      })
      if (runtime === 'bun') expect(receipt.reports).toEqual([])
      else
        expect(receipt.reports).toContainEqual(
          expect.objectContaining({
            source: 'supervision',
            code: 'EXIT_UNOBSERVABLE',
            name: 'Error',
            reason: null,
            detail: expect.any(Object),
            message: expect.any(String)
          })
        )
      expect(receipt.reports).not.toContainEqual(expect.objectContaining({ code: 'REAP_TIMEOUT' }))
    }
  }, 40000)

  it('fails a silent Worker at the default handshake deadline', async () => {
    /** Default Session handshake budget for transports that do not set their own. */
    const handshakeMs = 10_000
    const delays: number[] = []
    /** Records every delay the launcher requests; the deadline itself runs on real time. */
    const scheduler = {
      ...systemScheduler,
      schedule: (callback: () => void, delay: number) => {
        delays.push(delay)
        return systemScheduler.schedule(callback, delay)
      }
    }
    const failure = await createRpcHost({
      plugins: [
        threadPlugin({
          spawn: { entry: new URL('./fixtures/adapter-idle.mts', import.meta.url), scheduler }
        })
      ],
      report: () => undefined
    }).catch((error: unknown) => error)
    expect(delays).toContain(handshakeMs)
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({
        source: 'rpc.endpoint',
        code: 'DEADLINE_EXCEEDED'
      })
    )
  }, 25000)
})
