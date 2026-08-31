import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { PluginHost, PluginHostPipelineMode, type IPluginHostCore } from '../src/index.js'
import { createView } from '../src/composition-entry.js'

class ManagedStageHost extends PluginHost<Record<string, never>, string> {
  /** Executes the current pipeline and exposes its final value to the test fixture. */
  async run(value: string): Promise<string> {
    let result = value
    await this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

describe('PluginHost managed stage publication', () => {
  it('keeps a pending stage out of live snapshots until the install commit', async () => {
    let releaseInstall!: () => void
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve
    })
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode: PluginHostPipelineMode.async }
    })
    const installing = host.use({
      name: 'pending-stage',
      install: async (core: IPluginHostCore<string>) => {
        core.useAsyncPipeline(async (value, next) => next(`${value}!`))
        await installGate
        return {}
      }
    } as never)
    await Promise.resolve()
    expect(await host.run('value')).toBe('value')
    releaseInstall()
    await installing
    expect(await host.run('value')).toBe('value!')
    await host.dispose()
  })

  it('reuses a plugin data slot when a same-name registration is reinstalled', async () => {
    const calls: string[] = []
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use({
      name: 'first',
      install: (core: IPluginHostCore<string>) => {
        core.usePipeline((value, next) => {
          calls.push('A')
          next(`${value}A`)
        })
        return {}
      }
    } as never)
    expect(await host.run('')).toBe('A')
    calls.length = 0
    await host.use({
      name: 'second',
      install: (core: IPluginHostCore<string>) => {
        core.usePipeline((value, next) => {
          calls.push('B')
          next(`${value}B`)
        })
        return {}
      }
    } as never)
    expect(await host.run('')).toBe('AB')
    expect(calls).toEqual(['A', 'B'])
    await host.unUse('first')
    calls.length = 0
    expect(await host.run('')).toBe('B')
    await host.use({
      name: 'first',
      install: (core: IPluginHostCore<string>) => {
        core.usePipeline((value, next) => next(`${value}A`))
        return {}
      }
    } as never)
    expect(await host.run('')).toBe('AB')
    await host.dispose()
  })

  it('admits a staged plugin while an older async dispatch is in flight', async () => {
    let releaseStage!: () => void
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve
    })
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode: PluginHostPipelineMode.async }
    })
    host.useAsyncPipeline(async (value, next) => {
      await stageGate
      await next(value)
    })
    const first = host.run('old')
    await Promise.resolve()
    const installing = host.use({
      name: 'new-stage',
      install: (core: IPluginHostCore<string>) => {
        core.useAsyncPipeline(async (value, next) => next(`${value}!`))
        return {}
      }
    } as never)
    await installing
    releaseStage()
    expect(await first).toBe('old')
    expect(await host.run('next')).toBe('next!')
    await host.dispose()
  })

  it('publishes prepared admissions atomically and removes by exact receipts', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const plugin = { name: 'prepared', install: () => ({ value: true }) }
    const admission = host.createPluginAdmission(plugin as never)
    const slot = host.createDataOrderSlot('prepared')
    const prepared = await host.prepareAdmissions([{ admission, slot }])
    expect(host.getCurrentView().extensions.value).toBeUndefined()
    const [receipt] = host.commitPreparedAdmissions(prepared)
    expect(host.getCurrentView().extensions.value).toBe(true)
    const removal = await host.commitPreparedUnUseBatch(host.prepareUnUseBatch([receipt]), {
      beforeCleanup: Promise.resolve()
    })
    expect(removal).toMatchObject({ ok: true, committed: true, cleanupComplete: true })
    await host.dispose()
  })

  it('publishes only the exact token extensions and revokes stale or foreign tokens', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const admission = host.createPluginAdmission({
      name: 'viewed',
      install: () => ({ extension: true })
    } as never)
    const prepared = await host.prepareAdmissions([
      { admission, slot: host.createDataOrderSlot('viewed') }
    ])
    const [receipt] = host.commitPreparedAdmissions(prepared)
    const view = createView(receipt)
    expect(view.extensions.extension).toBe(true)
    expect('host' in view).toBe(false)
    await host.commitPreparedUnUseBatch(host.prepareUnUseBatch([receipt]), {})
    expect(() => createView(receipt)).toThrowError(
      expect.objectContaining({ code: 'VIEW_REVOKED' })
    )
    expect(() => createView(Object.freeze({}) as never)).toThrowError(
      expect.objectContaining({ code: 'VIEW_REVOKED' })
    )
    await host.dispose()
  })

  it('accepts a cleanup fence created in another realm', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const admission = host.createPluginAdmission({
      name: 'foreign-fence',
      install: () => ({})
    } as never)
    const prepared = await host.prepareAdmissions([
      { admission, slot: host.createDataOrderSlot('foreign-fence') }
    ])
    const [receipt] = host.commitPreparedAdmissions(prepared)
    const foreignPromise = runInNewContext('Promise.resolve()') as PromiseLike<void>

    await expect(
      host.commitPreparedUnUseBatch(host.prepareUnUseBatch([receipt]), {
        beforeCleanup: foreignPromise
      })
    ).resolves.toMatchObject({ ok: true, cleanupComplete: true })
    await host.dispose()
  })

  it('reads a hostile cleanup-fence then once and preserves its cause', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const failure = new Error('hostile then')
    let reads = 0
    // oxlint-disable-next-line unicorn/no-thenable -- hostile then access is the boundary under test.
    const beforeCleanup = Object.defineProperty({}, 'then', {
      get: () => {
        reads += 1
        throw failure
      }
    }) as PromiseLike<void>
    const admission = host.createPluginAdmission({
      name: 'hostile-fence',
      install: () => ({})
    } as never)
    const prepared = await host.prepareAdmissions([
      { admission, slot: host.createDataOrderSlot('hostile-fence') }
    ])
    const [receipt] = host.commitPreparedAdmissions(prepared)

    await expect(
      host.commitPreparedUnUseBatch(host.prepareUnUseBatch([receipt]), { beforeCleanup })
    ).rejects.toMatchObject({ code: 'INVALID_OPTION', cause: failure })
    expect(reads).toBe(1)
    await host.commitPreparedUnUseBatch(host.prepareUnUseBatch([receipt]), {})
    await host.dispose()
  })

  it('serializes prepared discard behind an already admitted mutation', async () => {
    let releaseInstall!: () => void
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve
    })
    let installStarted = false
    let candidateDisposed = false
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const candidate = host.createPluginAdmission({
      name: 'candidate',
      install: () => ({}),
      dispose: () => {
        candidateDisposed = true
      }
    } as never)
    const prepared = await host.prepareAdmissions([
      { admission: candidate, slot: host.createDataOrderSlot('candidate') }
    ])
    const installing = host.use({
      name: 'blocking-install',
      install: async () => {
        installStarted = true
        await installGate
        return {}
      }
    } as never)
    const discarded = host.discardPreparedAdmissions(prepared)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(installStarted).toBe(true)
    expect(candidateDisposed).toBe(false)
    releaseInstall()
    await installing
    await discarded
    expect(candidateDisposed).toBe(true)
    await host.dispose()
  })

  it('TPD-T52 rejects prepared revision drift and rolls the candidate back exactly once', async () => {
    let disposed = 0
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const admission = host.createPluginAdmission({
      name: 'drifted',
      install: (core: IPluginHostCore<string>) => {
        core.onDispose(() => {
          disposed += 1
        })
        return { drifted: true }
      }
    } as never)
    const slot = host.createDataOrderSlot('drifted')
    const prepared = await host.prepareAdmissions([{ admission, slot }])
    host.usePipeline((value, next) => next(value))
    expect(() => host.commitPreparedAdmissions(prepared)).toThrowError(
      expect.objectContaining({ code: 'PLUGIN_INSTALL_FAILED' })
    )
    await host.discardPreparedAdmissions(prepared)
    await host.discardPreparedAdmissions(prepared)
    expect(disposed).toBe(1)
    expect(host.getCurrentView().extensions.drifted).toBeUndefined()
    await host.dispose()
  })

  it('TPD-T53 retires exact data-order lanes without allowing a live duplicate', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const first = host.createDataOrderSlot('lane')
    expect(() => host.createDataOrderSlot('lane')).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    host.retireDataOrderSlot(first)
    const second = host.createDataOrderSlot('lane')
    expect(second).not.toBe(first)
    await expect(
      host.prepareAdmissions([
        {
          admission: host.createPluginAdmission({ name: 'lane', install: () => ({}) } as never),
          slot: first
        }
      ])
    ).rejects.toMatchObject({ code: 'INVALID_OPTION' })
    host.retireDataOrderSlot(second)
    await host.dispose()
  })
})
