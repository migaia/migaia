import { openComposition, registerManagedHost } from '@migaia/plugin-host/composition'
import { describe, expect, it } from 'vitest'
import {
  PluginHost,
  type IPluginHostCore,
  type IPluginPreparedAdmissions
} from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/lifecycle'
import { createHost } from '../src/host/index.js'
import { TrayErrorCode } from '../src/error-code.js'

type ITestCore = Record<string, never>

class TestHost extends PluginHost<ITestCore, string> {}

class AsyncTestHost extends PluginHost<ITestCore, string> {
  runValue(value: string): Promise<void> {
    return Promise.resolve(this.runPipeline(value, () => undefined))
  }
}

/**
 * 在发布点插一个观察者。
 *
 * 托管协议已不在宿主实例表面，覆写方法只会得到一段永不被调用的死代码。改为重新登记一个包装过的 协议出口：`registerManagedHost`
 * 覆盖同一个宿主的条目，`openComposition` 之后取到的就是包装版。 `revision` 必须重新声明为 getter——展开对象会把它变成一次性求值的快照。
 */
class PublicationBarrierHost extends TestHost {
  observeCommit: (() => void) | undefined

  constructor(options: ConstructorParameters<typeof TestHost>[0]) {
    super(options)
    const port = openComposition(this)
    registerManagedHost(
      this,
      Object.freeze({
        createPluginAdmission: port.createPluginAdmission,
        createDataOrderSlot: port.createDataOrderSlot,
        retireDataOrderSlot: port.retireDataOrderSlot,
        prepareAdmissions: port.prepareAdmissions,
        discardPreparedAdmissions: port.discardPreparedAdmissions,
        prepareUnUseBatch: port.prepareUnUseBatch,
        commitPreparedUnUseBatch: port.commitPreparedUnUseBatch,
        getCurrentView: port.getCurrentView,
        get revision() {
          return port.revision
        },
        commitPreparedAdmissions: (prepared: IPluginPreparedAdmissions) => {
          const receipts = port.commitPreparedAdmissions(prepared)
          this.observeCommit?.()
          return receipts
        }
      })
    )
  }
}

const options = (
  plugins: readonly unknown[],
  create: () => TestHost = () =>
    new TestHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
) => ({
  create,
  plugins: plugins as never,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' as const }
})

const plugin = (name: string, requires: readonly string[] = [], events: string[] = []) => ({
  name,
  requires,
  install: (core: IPluginHostCore<string>) => {
    events.push(`install:${name}`)
    core.onDispose(() => {
      events.push(`dispose:${name}`)
    })
    return { [name]: name }
  }
})

describe('@migaia/tray/host', () => {
  it('owns one graph-backed identity and reconciles blocked dependents', async () => {
    const events: string[] = []
    const managed = await createHost(
      options([plugin('consumer', ['provider'], events), plugin('provider', [], events)])
    )
    expect(events).toEqual(['install:provider', 'install:consumer'])
    expect(managed.plugins).toEqual(['consumer', 'provider'])
    expect(managed.readyPlugins).toEqual(['consumer', 'provider'])
    expect(managed.pluginState('provider')).toBe('ready')
    const removed = await managed.unUse('provider')
    expect(removed).toMatchObject({ ok: true, committed: true, removed: true })
    expect(managed.pluginState('consumer')).toBe('blocked')
    const restored = await managed.use(plugin('provider', [], events) as never)
    expect(restored).toMatchObject({ ok: true, committed: true })
    expect(managed.readyPlugins).toEqual(['consumer', 'provider'])
    await managed.dispose()
    expect(managed.isActive).toBe(false)
  })

  it('TPD-T57 does not retain a rejected duplicate candidate for a later restart', async () => {
    const events: string[] = []
    const managed = await createHost(
      options([plugin('provider', [], events), plugin('consumer', ['provider'], events)])
    )
    const rejected = await managed.use({
      ...plugin('provider', [], events),
      install: () => {
        events.push('install:rejected')
        return { provider: 'rejected' }
      }
    } as never)
    expect(rejected).toMatchObject({ ok: false, committed: false })
    await managed.unUse('provider')
    const restored = await managed.use({
      ...plugin('provider', [], events),
      install: () => {
        events.push('install:restored')
        return { provider: 'restored' }
      }
    } as never)
    expect(restored).toMatchObject({ ok: true, committed: true })
    expect(events).not.toContain('install:rejected')
    expect(events).toContain('install:restored')
    await managed.dispose()
  })

  it('TPD-T58 fails managed reads closed inside the Host-to-Graph publication interval', async () => {
    let raw: PublicationBarrierHost | undefined
    let managed: Awaited<ReturnType<typeof createHost>>
    const observed: string[] = []
    const timeline: string[] = []
    managed = await createHost(
      options([], () => {
        raw = new PublicationBarrierHost({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        return raw
      })
    )
    raw!.observeCommit = () => {
      timeline.push('commit:published')
      try {
        void managed.readyPlugins
      } catch (error) {
        observed.push((error as { code?: string }).code ?? 'missing')
        timeline.push('commit:read:unavailable')
      }
    }
    managed.on('use', () => {
      timeline.push('event:use')
      expect(managed.readyPlugins).toEqual(['barrier'])
      timeline.push('event:read:ready')
    })
    const result = await managed.use(plugin('barrier') as never)
    expect(result).toMatchObject({ ok: true, committed: true })
    expect(observed).toEqual([TrayErrorCode.unavailable])
    expect(timeline).toEqual([
      'commit:published',
      'commit:read:unavailable',
      'event:use',
      'event:read:ready'
    ])
    expect(managed.readyPlugins).toEqual(['barrier'])
    await managed.dispose()
  })

  it('publishes settled observer events and rejects escaped raw Host mutation', async () => {
    let raw: TestHost | undefined
    const events: string[] = []
    const managed = await createHost(
      options([plugin('one', [], events)], () => {
        raw = new TestHost({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        return raw
      })
    )
    const observed: string[] = []
    managed.on('use', (event) => {
      observed.push(`use:${String(event.value.name)}`)
    })
    await managed.use(plugin('two', [], events) as never)
    expect(observed).toEqual(['use:two'])
    await raw!.use({ name: 'escaped', install: () => ({}) } as never)
    expect(() => managed.plugins).toThrowError(
      expect.objectContaining({ code: TrayErrorCode.hostMutationBypass })
    )
    await managed.dispose()
  })

  it('keeps managed config writes inside the expected Host receipt', async () => {
    const managed = await createHost(
      options([
        {
          ...plugin('configurable'),
          config: { enabled: false },
          update: () => undefined
        }
      ])
    )
    await managed.config.update('configurable', () => ({ enabled: true }))
    expect(managed.config.get('configurable.enabled')).toBe(true)
    await managed.dispose()
  })

  it('keeps a missing-provider definition blocked without admitting it to Host', async () => {
    const events: string[] = []
    const managed = await createHost(options([plugin('consumer', ['missing'], events)]))
    expect(managed.plugins).toEqual(['consumer'])
    expect(managed.readyPlugins).toEqual([])
    expect(events).toEqual([])
    await managed.dispose()
  })

  it('TPD-T54 uses quiescenceMs as a logical wait budget without premature cleanup', async () => {
    const scheduler = createManualScheduler()
    const timeline: string[] = []
    let raw: AsyncTestHost | undefined
    let releaseStage!: () => void
    let started!: () => void
    const stageStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve
    })
    let disposed = false
    const managed = await createHost({
      ...options([], () => {
        raw = new AsyncTestHost({
          scheduler,
          pipeline: { mode: 'async' },
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        return raw
      }),
      quiescenceMs: 10,
      plugins: [
        {
          name: 'provider',
          install: (core: IPluginHostCore<string>) => {
            core.onDispose(() => {
              timeline.push('dispose:provider')
            })
            return { provider: true }
          }
        },
        {
          name: 'staged',
          requires: ['provider'],
          install: (core: IPluginHostCore<string>) => {
            core.useAsyncPipeline(async (value: string, next: (value: string) => Promise<void>) => {
              timeline.push('stage:start')
              started()
              await stageGate
              timeline.push('stage:release')
              await next(value)
            })
            core.onDispose(() => {
              disposed = true
              timeline.push('dispose:staged')
            })
            return {}
          }
        }
      ]
    } as never)
    const running = raw!.runValue('value')
    await stageStarted
    const removalPromise = managed.unUse('provider')
    await Promise.resolve()
    scheduler.advance(10)
    const removal = await removalPromise
    const physicalCompletion = removal.physicalCompletion
    expect(removal.cleanupComplete).toBe(false)
    expect(removal.cleanupErrors).toEqual([])
    expect(physicalCompletion).toBeDefined()
    expect(removal.physicalCompletion).toBe(physicalCompletion)
    expect(disposed).toBe(false)
    expect(timeline).toEqual(['stage:start'])
    releaseStage()
    await running
    await physicalCompletion
    expect(disposed).toBe(true)
    expect(timeline).toEqual(['stage:start', 'stage:release', 'dispose:staged', 'dispose:provider'])
    await managed.dispose()
  })

  it('keeps creation cleanupErrors immediate and physicalCompletion separate', async () => {
    const pending = new Promise<never>(() => {})
    class FailingHost extends TestHost {
      override dispose() {
        return Promise.resolve({
          logicalTerminal: true as const,
          cleanupComplete: false,
          cleanupErrors: Object.freeze([]),
          physicalCompletion: pending
        })
      }
    }
    await expect(
      createHost({
        ...options(
          [],
          () =>
            new FailingHost({
              execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
            })
        ),
        plugins: [plugin('first', ['second']), plugin('second', ['first'])]
      } as never)
    ).rejects.toMatchObject({
      detail: {
        cleanupErrors: [],
        cleanupComplete: false,
        physicalCompletion: pending
      }
    })
  })
})
