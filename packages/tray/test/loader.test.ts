/* oxlint-disable unicorn/no-thenable -- this suite intentionally models foreign thenables. */
import { describe, expect, it } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createAbortController } from '@migaia/lifecycle'
import { createHost } from '../src/host/index.js'
import { defineAdapter } from '../src/adapter/index.js'
import { defineLoader, loadIntoHost } from '../src/loader/index.js'

class TestHost extends PluginHost<Record<string, never>, string> {}

const createManagedHost = async (plugins: readonly unknown[] = []) =>
  createHost({
    create: () =>
      new TestHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
    plugins: plugins as never,
    mutationAdmissionMs: 100,
    quiescenceMs: 100,
    shutdown: { mode: 'bounded' as const }
  })

const adapterFor = (name: string) => defineAdapter({ adapt: () => ({ name, install: () => ({}) }) })

describe('@migaia/tray/loader', () => {
  it('reads a synchronous loader result exactly once and commits its artifact', async () => {
    const host = (await createManagedHost()) as any
    let loads = 0
    let releases = 0
    const result = await loadIntoHost({
      host,
      source: 'sync-source',
      loader: defineLoader({
        load: () => {
          loads += 1
          return {
            value: 'sync-artifact',
            release: {
              force: () => {
                releases += 1
              }
            }
          }
        }
      }),
      adapter: adapterFor('sync-plugin'),
      mutation: 'use',
      timeoutMs: false
    })
    expect(result).toMatchObject({ committed: true })
    expect(loads).toBe(1)
    await host.unUse('sync-plugin')
    expect(releases).toBe(1)
    await host.dispose()
  })

  it('assimilates a Promise loader completion exactly once', async () => {
    const host = (await createManagedHost()) as any
    let loads = 0
    const result = await loadIntoHost({
      host,
      source: 'promise-source',
      loader: defineLoader({
        load: async () => {
          loads += 1
          return { value: 'promise-artifact', release: { force: () => undefined } }
        }
      }),
      adapter: adapterFor('promise-plugin'),
      mutation: 'use',
      timeoutMs: false
    })
    expect(result).toMatchObject({ committed: true })
    expect(loads).toBe(1)
    await host.dispose()
  })

  it('reads a foreign thenable then method exactly once', async () => {
    const host = (await createManagedHost()) as any
    let thenReads = 0
    const thenable = Object.create(null) as Record<string, unknown>
    Object.defineProperty(thenable, 'then', {
      get: () => {
        thenReads += 1
        return (resolve: (value: unknown) => void) =>
          resolve({ value: 'foreign-artifact', release: { force: () => undefined } })
      }
    })
    const result = await loadIntoHost({
      host,
      source: 'foreign-source',
      loader: defineLoader({ load: () => thenable as never }),
      adapter: adapterFor('foreign-plugin'),
      mutation: 'use',
      timeoutMs: false
    })
    expect(result).toMatchObject({ committed: true })
    expect(thenReads).toBe(1)
    await host.dispose()
  })

  it('preserves a loader primary error and observes the loader boundary code', async () => {
    const host = (await createManagedHost()) as any
    const primary = new TypeError('loader failed')
    await expect(
      loadIntoHost({
        host,
        source: 'source',
        loader: defineLoader({
          load: () => {
            throw primary
          }
        }),
        adapter: adapterFor('never-installed'),
        mutation: 'use',
        timeoutMs: false
      })
    ).rejects.toBe(primary)
    expect(primary).toMatchObject({ code: 'LOADER_EXECUTION_FAILED' })
    expect(host.plugins).toEqual([])
    await host.dispose()
  })

  it('preserves loader rejection identity and rolls back a late adapted artifact after cancellation', async () => {
    const host = (await createManagedHost()) as any
    const loaderPrimary = new Error('loader rejection')
    await expect(
      loadIntoHost({
        host,
        source: 'rejected-source',
        loader: defineLoader({ load: () => Promise.reject(loaderPrimary) }),
        adapter: adapterFor('never-installed'),
        mutation: 'use',
        timeoutMs: false
      })
    ).rejects.toBe(loaderPrimary)
    expect(loaderPrimary).toMatchObject({ code: 'LOADER_EXECUTION_FAILED' })
    const caller = createAbortController()
    let releaseCount = 0
    let resolveLoad!: (value: unknown) => void
    const pendingLoad = new Promise<unknown>((resolve) => {
      resolveLoad = resolve
    })
    const primary = new Error('late adapter failure')
    const loading = loadIntoHost({
      host,
      source: 'late-source',
      signal: caller.signal,
      loader: defineLoader({ load: () => pendingLoad as never }),
      adapter: defineAdapter({ adapt: () => Promise.reject(primary) }),
      mutation: 'use',
      timeoutMs: false
    })
    caller.abort('cancelled')
    await Promise.resolve()
    resolveLoad({
      value: 'late-artifact',
      release: {
        force: () => {
          releaseCount += 1
        }
      }
    })
    await expect(loading).rejects.toBe(primary)
    expect(primary).toMatchObject({ code: 'ADAPTER_EXECUTION_FAILED' })
    expect(releaseCount).toBe(1)
    expect(host.plugins).toEqual([])
    await host.dispose()
  })

  it('rolls back the artifact at the loader-host adapter boundary', async () => {
    const host = (await createManagedHost()) as any
    let releaseCount = 0
    const primary = new Error('adapter boundary failure')
    await expect(
      loadIntoHost({
        host,
        source: 'source',
        loader: defineLoader({
          load: () => ({
            value: 'artifact',
            release: {
              force: () => {
                releaseCount += 1
              }
            }
          })
        }),
        adapter: defineAdapter({ adapt: () => Promise.reject(primary) }),
        mutation: 'use',
        timeoutMs: false
      })
    ).rejects.toBe(primary)
    expect(releaseCount).toBe(1)
    expect(host.plugins).toEqual([])
    await host.dispose()
  })

  it('rolls back an uncommitted duplicate mutation and releases its loser artifact', async () => {
    const host = (await createManagedHost([{ name: 'existing', install: () => ({}) }])) as any
    let releases = 0
    const result = await loadIntoHost({
      host,
      source: 'duplicate-source',
      loader: defineLoader({
        load: () => ({
          value: 'duplicate-artifact',
          release: {
            force: () => {
              releases += 1
            }
          }
        })
      }),
      adapter: adapterFor('existing'),
      mutation: 'use',
      timeoutMs: false
    })
    expect(result).toMatchObject({ committed: false })
    expect(releases).toBe(1)
    expect(host.plugins).toEqual(['existing'])
    await host.dispose()
  })

  it('allows only one committed generation across concurrent duplicate loads', async () => {
    const host = (await createManagedHost()) as any
    const releases = [0, 0]
    const results = await Promise.all(
      [0, 1].map((index) =>
        loadIntoHost({
          host,
          source: `concurrent-${index}`,
          loader: defineLoader({
            load: () => ({
              value: `artifact-${index}`,
              release: {
                force: () => {
                  releases[index] += 1
                }
              }
            })
          }),
          adapter: adapterFor('concurrent-plugin'),
          mutation: 'use',
          timeoutMs: false
        })
      )
    )
    expect(results.filter((result) => (result as { committed: boolean }).committed)).toHaveLength(1)
    expect(releases.reduce((total, count) => total + count, 0)).toBe(1)
    expect(host.plugins).toEqual(['concurrent-plugin'])
    await host.dispose()
  })

  it('retains committed blocked and failed definitions until exact later cleanup', async () => {
    const host = (await createManagedHost()) as any
    let blockedRelease = 0
    const blocked = await loadIntoHost({
      host,
      source: 'blocked-source',
      loader: defineLoader({
        load: () => ({
          value: 'blocked-artifact',
          release: {
            force: () => {
              blockedRelease += 1
            }
          }
        })
      }),
      adapter: defineAdapter({
        adapt: () => ({ name: 'blocked-plugin', requires: ['missing'], install: () => ({}) })
      }),
      mutation: 'use',
      timeoutMs: false
    })
    expect(blocked).toMatchObject({ ok: true, committed: true })
    expect(host.pluginState('blocked-plugin')).toBe('blocked')
    expect(blockedRelease).toBe(0)
    const removedBlocked = await host.unUse('blocked-plugin')
    expect(removedBlocked).toMatchObject({ ok: true, committed: true, removed: true })
    expect(blockedRelease).toBe(1)

    let failedRelease = 0
    const failed = await loadIntoHost({
      host,
      source: 'failed-source',
      loader: defineLoader({
        load: () => ({
          value: 'failed-artifact',
          release: {
            force: () => {
              failedRelease += 1
            }
          }
        })
      }),
      adapter: defineAdapter({
        adapt: () => ({
          name: 'failed-plugin',
          install: () => {
            throw new Error('failed install')
          }
        })
      }),
      mutation: 'use',
      timeoutMs: false
    })
    expect(failed).toMatchObject({ ok: false, committed: true })
    expect(host.pluginState('failed-plugin')).toBe('failed')
    expect(failedRelease).toBe(0)
    const replaced = await host.replace({ name: 'failed-plugin', install: () => ({}) })
    expect(replaced).toMatchObject({ ok: true, committed: true })
    const removedFailed = await host.unUse('failed-plugin')
    expect(removedFailed).toMatchObject({ ok: true, committed: true, removed: true })
    expect(failedRelease).toBe(1)
    await host.dispose()
  })

  it('reports artifact cleanup failure as secondary and isolates old generation cleanup', async () => {
    const host = (await createManagedHost()) as any
    const cleanupFailure = new Error('artifact cleanup failed')
    await loadIntoHost({
      host,
      source: 'cleanup-source',
      loader: defineLoader({
        load: () => ({
          value: 'cleanup-artifact',
          release: {
            force: () => {
              throw cleanupFailure
            }
          }
        })
      }),
      adapter: adapterFor('cleanup-plugin'),
      mutation: 'use',
      timeoutMs: false
    })
    const removed = await host.unUse('cleanup-plugin')
    expect(removed).toMatchObject({
      ok: true,
      committed: true,
      removed: true,
      cleanupComplete: false
    })
    expect(removed.cleanupErrors[0]).toBe(cleanupFailure)
    expect(removed.cleanupErrors[0]).toMatchObject({ code: 'ARTIFACT_CLEANUP_FAILED' })

    let releaseOld!: () => void
    let oldReleaseCount = 0
    let freshReleaseCount = 0
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    await loadIntoHost({
      host,
      source: 'old-source',
      loader: defineLoader({
        load: () => ({
          value: 'old-artifact',
          release: {
            force: async () => {
              oldReleaseCount += 1
              await oldGate
            }
          }
        })
      }),
      adapter: adapterFor('generation-plugin'),
      mutation: 'use',
      timeoutMs: false
    })
    const replacing = loadIntoHost({
      host,
      source: 'fresh-source',
      loader: defineLoader({
        load: () => ({
          value: 'fresh-artifact',
          release: {
            force: () => {
              freshReleaseCount += 1
            }
          }
        })
      }),
      adapter: adapterFor('generation-plugin'),
      mutation: 'replace',
      timeoutMs: false
    })
    await Promise.resolve()
    expect(freshReleaseCount).toBe(0)
    releaseOld()
    await expect(replacing).resolves.toMatchObject({ committed: true })
    expect(oldReleaseCount).toBe(1)
    await host.unUse('generation-plugin')
    expect(freshReleaseCount).toBe(1)
    await host.dispose()
  })
})
