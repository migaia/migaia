import { describe, expect, it } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createHost } from '../src/host/index.js'
import { defineAdapter } from '../src/adapter/index.js'
import { defineLoader, loadIntoHost } from '../src/loader/index.js'

class TestHost extends PluginHost<Record<string, never>, string> {}

const createManagedHost = async () =>
  createHost({
    create: () =>
      new TestHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
    plugins: [],
    mutationAdmissionMs: 100,
    quiescenceMs: 100,
    shutdown: { mode: 'bounded' as const }
  })

describe('@migaia/tray/adapter', () => {
  it('invokes one adapter and publishes the exact canonical descriptor to Host admission', async () => {
    const host = (await createManagedHost()) as any
    const plugin = { name: 'adapted', install: () => ({ exact: true }) }
    let adaptations = 0
    const result = await loadIntoHost({
      host,
      source: 'source',
      loader: defineLoader({
        load: () => ({ value: plugin, release: { force: () => undefined } })
      }),
      adapter: defineAdapter({
        adapt: (artifact) => {
          adaptations += 1
          expect(artifact).toBe(plugin)
          return plugin
        }
      }),
      mutation: 'use',
      timeoutMs: false
    })
    expect(result).toMatchObject({ committed: true })
    expect(adaptations).toBe(1)
    expect(host.plugins).toEqual(['adapted'])
    await host.dispose()
  })

  it('rejects an invalid adapter result before publication and releases the artifact once', async () => {
    const host = (await createManagedHost()) as any
    let releases = 0
    await expect(
      loadIntoHost({
        host,
        source: 'source',
        loader: defineLoader({
          load: () => ({
            value: 'artifact',
            release: {
              force: () => {
                releases += 1
              }
            }
          })
        }),
        adapter: defineAdapter({ adapt: () => null as never }),
        mutation: 'use',
        timeoutMs: false
      })
    ).rejects.toMatchObject({ code: 'ADAPTER_CONTRACT_INVALID' })
    expect(releases).toBe(1)
    expect(host.plugins).toEqual([])
    await host.dispose()
  })

  it('preserves the adapter primary error and attaches the adapter execution code', async () => {
    const host = (await createManagedHost()) as any
    const primary = new TypeError('adapter failed')
    await expect(
      loadIntoHost({
        host,
        source: 'source',
        loader: defineLoader({
          load: () => ({ value: 'artifact', release: { force: () => undefined } })
        }),
        adapter: defineAdapter({ adapt: () => Promise.reject(primary) }),
        mutation: 'use',
        timeoutMs: false
      })
    ).rejects.toBe(primary)
    expect(primary).toMatchObject({ code: 'ADAPTER_EXECUTION_FAILED' })
    expect(host.plugins).toEqual([])
    await host.dispose()
  })
})
