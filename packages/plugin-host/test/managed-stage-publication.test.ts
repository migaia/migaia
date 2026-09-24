import { isManagedHost, openComposition } from '../src/composition-entry.js'
import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  defineHost,
  PluginHost,
  PluginHostPipelineMode,
  type IPluginHostCore
} from '../src/index.js'
import { createView } from '../src/composition-entry.js'
import { PluginHostErrorCode } from '../src/error-code.js'

/** 八个托管协议方法；它们经 `openComposition` 取得，不再挂在宿主实例上。 */
const MANAGED_PROTOCOL = [
  'createPluginAdmission',
  'createDataOrderSlot',
  'retireDataOrderSlot',
  'prepareAdmissions',
  'commitPreparedAdmissions',
  'discardPreparedAdmissions',
  'prepareUnUseBatch',
  'commitPreparedUnUseBatch'
] as const

const hostOptions = {
  execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
}

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

  // 顺序稳定：普通的 use/unUse 路径根本不分配 data-order slot（只有 `createDataOrderSlot` 会写
  // `stageSlots`，那是组合方的入口），所以同名重装回到原位。
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
    const admission = openComposition(host).createPluginAdmission(plugin as never)
    const slot = openComposition(host).createDataOrderSlot('prepared')
    const prepared = await openComposition(host).prepareAdmissions([{ admission, slot }])
    expect(openComposition(host).getCurrentSnapshot().extensions.value).toBeUndefined()
    const [receipt] = openComposition(host).commitPreparedAdmissions(prepared)
    expect(openComposition(host).getCurrentSnapshot().extensions.value).toBe(true)
    const removal = await openComposition(host).commitPreparedUnUseBatch(
      openComposition(host).prepareUnUseBatch([receipt]),
      {
        beforeCleanup: Promise.resolve()
      }
    )
    expect(removal).toMatchObject({ ok: true, committed: true, cleanupComplete: true })
    await host.dispose()
  })

  it('publishes only the exact token extensions and revokes stale or foreign tokens', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const admission = openComposition(host).createPluginAdmission({
      name: 'viewed',
      install: () => ({ extension: true })
    } as never)
    const prepared = await openComposition(host).prepareAdmissions([
      { admission, slot: openComposition(host).createDataOrderSlot('viewed') }
    ])
    const [receipt] = openComposition(host).commitPreparedAdmissions(prepared)
    const view = createView(receipt)
    expect(view.extensions.extension).toBe(true)
    expect('host' in view).toBe(false)
    await openComposition(host).commitPreparedUnUseBatch(
      openComposition(host).prepareUnUseBatch([receipt]),
      {}
    )
    expect(() => createView(receipt)).toThrowError(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
    expect(() => createView(Object.freeze({}) as never)).toThrowError(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
    await host.dispose()
  })

  it('accepts a cleanup fence created in another realm', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const admission = openComposition(host).createPluginAdmission({
      name: 'foreign-fence',
      install: () => ({})
    } as never)
    const prepared = await openComposition(host).prepareAdmissions([
      { admission, slot: openComposition(host).createDataOrderSlot('foreign-fence') }
    ])
    const [receipt] = openComposition(host).commitPreparedAdmissions(prepared)
    const foreignPromise = runInNewContext('Promise.resolve()') as PromiseLike<void>

    await expect(
      openComposition(host).commitPreparedUnUseBatch(
        openComposition(host).prepareUnUseBatch([receipt]),
        {
          beforeCleanup: foreignPromise
        }
      )
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
    const admission = openComposition(host).createPluginAdmission({
      name: 'hostile-fence',
      install: () => ({})
    } as never)
    const prepared = await openComposition(host).prepareAdmissions([
      { admission, slot: openComposition(host).createDataOrderSlot('hostile-fence') }
    ])
    const [receipt] = openComposition(host).commitPreparedAdmissions(prepared)

    await expect(
      openComposition(host).commitPreparedUnUseBatch(
        openComposition(host).prepareUnUseBatch([receipt]),
        { beforeCleanup }
      )
    ).rejects.toMatchObject({ code: 'INVALID_OPTION', cause: failure })
    expect(reads).toBe(1)
    await openComposition(host).commitPreparedUnUseBatch(
      openComposition(host).prepareUnUseBatch([receipt]),
      {}
    )
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
    const candidate = openComposition(host).createPluginAdmission({
      name: 'candidate',
      install: () => ({}),
      dispose: () => {
        candidateDisposed = true
      }
    } as never)
    const prepared = await openComposition(host).prepareAdmissions([
      { admission: candidate, slot: openComposition(host).createDataOrderSlot('candidate') }
    ])
    const installing = host.use({
      name: 'blocking-install',
      install: async () => {
        installStarted = true
        await installGate
        return {}
      }
    } as never)
    const discarded = openComposition(host).discardPreparedAdmissions(prepared)

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
    const admission = openComposition(host).createPluginAdmission({
      name: 'drifted',
      install: (core: IPluginHostCore<string>) => {
        core.onDispose(() => {
          disposed += 1
        })
        return { drifted: true }
      }
    } as never)
    const slot = openComposition(host).createDataOrderSlot('drifted')
    const prepared = await openComposition(host).prepareAdmissions([{ admission, slot }])
    host.usePipeline((value, next) => next(value))
    expect(() => openComposition(host).commitPreparedAdmissions(prepared)).toThrowError(
      expect.objectContaining({ code: 'PLUGIN_INSTALL_FAILED' })
    )
    await openComposition(host).discardPreparedAdmissions(prepared)
    await openComposition(host).discardPreparedAdmissions(prepared)
    expect(disposed).toBe(1)
    expect(openComposition(host).getCurrentSnapshot().extensions.drifted).toBeUndefined()
    await host.dispose()
  })

  it('TPD-T53 retires exact data-order lanes without allowing a live duplicate', async () => {
    const host = new ManagedStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const first = openComposition(host).createDataOrderSlot('lane')
    expect(() => openComposition(host).createDataOrderSlot('lane')).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    openComposition(host).retireDataOrderSlot(first)
    const second = openComposition(host).createDataOrderSlot('lane')
    expect(second).not.toBe(first)
    await expect(
      openComposition(host).prepareAdmissions([
        {
          admission: openComposition(host).createPluginAdmission({
            name: 'lane',
            install: () => ({})
          } as never),
          slot: first
        }
      ])
    ).rejects.toMatchObject({ code: 'INVALID_OPTION' })
    openComposition(host).retireDataOrderSlot(second)
    await host.dispose()
  })
})

describe('managed host', () => {
  it('rejects a target this package never registered', () => {
    let failure: unknown
    try {
      openComposition({ looksLikeAHost: true })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as { code?: unknown }).code).toBe(
      PluginHostErrorCode.compositionTargetUnmanaged
    )
    expect(isManagedHost({ looksLikeAHost: true })).toBe(false)
  })

  it('returns a usable port for a PluginHost subclass instance', async () => {
    const host = new ManagedStageHost(hostOptions)
    expect(isManagedHost(host)).toBe(true)
    const composition = openComposition(host)
    // 出口可用而不只是存在：取一个 slot 再退役它，走的是真实的组合路径。
    const slot = composition.createDataOrderSlot('probe')
    expect(slot).toBeDefined()
    composition.retireDataOrderSlot(slot)
    expect(typeof composition.revision).toBe('number')
    await host.dispose()
  })

  it('returns a usable port for a defineHost handle', async () => {
    const host = defineHost({ host: hostOptions })
    expect(isManagedHost(host)).toBe(true)
    const composition = openComposition(host)
    const slot = composition.createDataOrderSlot('probe')
    expect(slot).toBeDefined()
    composition.retireDataOrderSlot(slot)
    await host.dispose()
  })

  it('answers false for values that were never constructed by this package', () => {
    expect(isManagedHost(null)).toBe(false)
    expect(isManagedHost(undefined)).toBe(false)
    expect(isManagedHost('host')).toBe(false)
    expect(isManagedHost(() => undefined)).toBe(false)
    expect(isManagedHost(Object.create(null))).toBe(false)
  })
})

describe('protocol removed from host surface', () => {
  it('keeps all eight managed methods off the instance and reachable through the port', async () => {
    const host = new ManagedStageHost(hostOptions)
    for (const method of MANAGED_PROTOCOL)
      expect((host as unknown as Record<string, unknown>)[method]).toBeUndefined()
    const composition = openComposition(host) as unknown as Record<string, unknown>
    for (const method of MANAGED_PROTOCOL) expect(typeof composition[method]).toBe('function')
    await host.dispose()
  })

  it('keeps all eight managed methods off a defineHost handle as well', async () => {
    const host = defineHost({ host: hostOptions })
    for (const method of MANAGED_PROTOCOL)
      expect((host as unknown as Record<string, unknown>)[method]).toBeUndefined()
    const composition = openComposition(host) as unknown as Record<string, unknown>
    for (const method of MANAGED_PROTOCOL) expect(typeof composition[method]).toBe('function')
    await host.dispose()
  })
})
