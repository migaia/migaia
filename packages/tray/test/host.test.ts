import { openComposition } from '@migaia/plugin-host/composition'
import { describe, expect, it } from 'vitest'
import {
  defineFeature,
  definePlugin,
  PluginHostErrorCode,
  type IPluginConstraint
} from '@migaia/plugin-host'
import { DependencyPolicy } from '@migaia/capability/graph/dependency'
import { createHost } from '../src/host/index.ts'
import { TrayErrorCode } from '../src/error-code.ts'
import {
  overrideCompositionPortForTest,
  TestHost,
  PublicationBarrierHost,
  options,
  plugin
} from './host-helper.ts'

describe('@migaia/tray/host', () => {
  it('reads one raw Feature snapshot and keeps the required consumer blocked', async () => {
    /** Provider identity used by the consumer's Feature reference. */
    const provider = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({})) },
      install: () => ({ p: true })
    })
    /** First getter result must drive both graph admission and eventual installation. */
    const firstFeatures = {
      value: defineFeature(() => ({}), { p: provider.getFeature('value') })
    }
    /** Detects an accidental second snapshot of the raw descriptor. */
    let reads = 0
    /** Captures the concrete Host so its installed dependency projection can be compared. */
    let raw: TestHost | undefined
    /** Managed facade under the one-snapshot contract. */
    const managed = await createHost(
      options(
        [
          {
            name: 'consumer',
            get features() {
              return ++reads === 1 ? firstFeatures : {}
            },
            install: () => ({ consumer: true })
          }
        ],
        () => {
          raw = new TestHost({
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
          })
          return raw
        }
      )
    )
    expect(reads).toBe(1)
    expect(managed.pluginState('consumer')).toBe('blocked')
    expect((await managed.use(provider as never)).ok).toBe(true)
    expect(managed.readyPlugins).toEqual(['consumer', 'p'])
    expect(reads).toBe(1)
    expect(
      (await raw!.unUse('p', { dryRun: true, policy: DependencyPolicy.cascade })).edges
    ).toContainEqual({
      provider: 'p',
      consumer: 'consumer',
      optional: false
    })
    await managed.dispose()
  })

  it('reconciles a required consumer admitted through use', async () => {
    /** Provider declaration remains absent until the second mutation. */
    const provider = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({})) },
      install: () => ({})
    })
    /** Consumer declares its only lifecycle edge through a Feature. */
    const consumer = definePlugin({
      name: 'consumer',
      features: { value: defineFeature(() => ({}), { p: provider.getFeature('value') }) },
      install: () => ({})
    })
    /** Empty managed graph exercises use rather than initial admission. */
    const managed = await createHost(options([]))
    expect((await managed.use(consumer as never)).ok).toBe(true)
    expect(managed.pluginState('consumer')).toBe('blocked')
    expect((await managed.use(provider as never)).ok).toBe(true)
    expect(managed.readyPlugins).toEqual(['consumer', 'p'])
    await managed.dispose()
  })

  it.each([false, true])(
    'treats optional providers as ordering-only, present=%s',
    async (present) => {
      /** Installation log proves present optional providers precede their consumer. */
      const events: string[] = []
      /** Optional provider is installed only in the present case. */
      const provider = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({})) },
        install: () => {
          events.push('p')
          return {}
        }
      })
      /** Consumer precedes the provider in input order. */
      const consumer = definePlugin({
        name: 'consumer',
        features: {
          value: defineFeature(() => ({}), { p: provider.getFeature('value', { optional: true }) })
        },
        install: () => {
          events.push('consumer')
          return {}
        }
      })
      /** Optional absence must not prevent initial readiness. */
      const managed = await createHost(options(present ? [consumer, provider] : [consumer]))
      expect(managed.pluginState('consumer')).toBe('ready')
      expect(events).toEqual(present ? ['p', 'consumer'] : ['consumer'])
      await managed.dispose()
    }
  )

  it.each(['createHost', 'use', 'replace'] as const)(
    'rejects own requires before %s changes state',
    async (entry) => {
      /** Records installation and detects any forbidden getter read. */
      const events: string[] = []
      /** Existing replacement target must keep serving after rejection. */
      const original = { name: 'target', install: () => ({ target: 'original' }) }
      /** Canonical rejection fixture preserves the rejection proof without reading its value. */
      const stale = {
        name: 'target',
        get requires() {
          events.push('getter')
          return []
        },
        install: () => {
          events.push('install')
          return { target: 'replacement' }
        }
      }
      if (entry === 'createHost') {
        await expect(createHost(options([stale]))).rejects.toMatchObject({
          source: 'tray',
          code: TrayErrorCode.invalidEntry
        })
      } else {
        /** Captures the pre-mutation facade for both mutation entry points. */
        const managed = await createHost(options([original]))
        await expect(managed[entry](stale as never)).rejects.toMatchObject({
          source: 'tray',
          code: TrayErrorCode.invalidEntry
        })
        expect(managed.plugins).toEqual(['target'])
        expect(managed.extensions).toMatchObject({ target: 'original' })
        await managed.dispose()
      }
      expect(events).toEqual([])
    }
  )

  it.each(['createHost', 'use', 'replace'] as const)(
    'preserves the exact admission TypeError through %s',
    async (entry) => {
      /** Admission producer's exact thrown object must survive as the direct cause. */
      let original: unknown
      /** Retains the stack before Tray handles the producer's error. */
      let stack: string | undefined
      /** Wraps only the test observation point, preserving the canonical producer. */
      const create = () => {
        /** Concrete Host whose composition port records admission failures. */
        const raw = new TestHost({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        /** Original port remains owner of every admission and publication. */
        const port = openComposition(raw)
        overrideCompositionPortForTest(
          raw,
          Object.freeze({
            ...port,
            get revision() {
              return port.revision
            },
            createPluginAdmission: <TPlugin extends IPluginConstraint<any>>(candidate: TPlugin) => {
              try {
                return port.createPluginAdmission(candidate)
              } catch (error) {
                original = error
                stack = (error as Error).stack
                throw error
              }
            }
          })
        )
        return raw
      }
      /** Invalid descriptor must reject before graph mutation starts. */
      const invalid = { name: '', install: () => ({}) }
      /** Captures the boundary error without replacing the cause. */
      let boundary: unknown
      if (entry === 'createHost') {
        try {
          await createHost(options([invalid], create))
        } catch (error) {
          boundary = error
        }
      } else {
        /** Valid target and graph remain unchanged after invalid admission. */
        const managed = await createHost(
          options([{ name: 'target', install: () => ({ target: true }) }], create)
        )
        try {
          await managed[entry](invalid as never)
        } catch (error) {
          boundary = error
        }
        expect(managed.plugins).toEqual(['target'])
        expect(managed.extensions).toMatchObject({ target: true })
        await managed.dispose()
      }
      expect(boundary).toMatchObject({
        source: 'tray',
        code: TrayErrorCode.invalidEntry,
        cause: { source: 'plugin.host', code: PluginHostErrorCode.invalidOption }
      })
      expect((boundary as Error).cause).toBe(original)
      expect(original).toBeInstanceOf(TypeError)
      expect((original as Error).stack).toBe(stack)
      expect(stack).toBeTruthy()
    }
  )
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

  it('does not retain a rejected duplicate candidate for a later restart', async () => {
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

  it('fails managed reads closed inside the Host-to-Graph publication interval', async () => {
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
})
