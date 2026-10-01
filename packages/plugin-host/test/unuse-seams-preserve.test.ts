import { describe, expect, it } from 'vitest'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostErrorCode,
  type IPluginConstraint
} from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

/** Builds the same three-level dependency chain for every unchanged-behavior check. */
const createChain = async () => {
  /** Records the exact physical disposer order after dependency planning. */
  const events: string[] = []
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const providerFeature = defineFeature(() => ({ value: 1 }))
  const provider = definePlugin({
    name: 'provider',
    features: { providerFeature },
    install: () => ({}),
    dispose: () => {
      events.push('provider')
    }
  })
  const directFeature = defineFeature(
    (_core, dependencies) => ({ value: dependencies.provider.value }),
    {
      provider: provider.getFeature('providerFeature')
    }
  )
  const direct = definePlugin({
    name: 'direct',
    features: { directFeature },
    install: () => ({}),
    dispose: () => {
      events.push('direct')
    }
  })
  const transitiveFeature = defineFeature(
    (_core, dependencies) => ({ value: dependencies.direct.value }),
    {
      direct: direct.getFeature('directFeature')
    }
  )
  const transitive = definePlugin({
    name: 'transitive',
    features: { transitiveFeature },
    install: () => ({}),
    dispose: () => {
      events.push('transitive')
    }
  })
  const unrelated = definePlugin({
    name: 'unrelated',
    install: () => ({}),
    dispose: () => {
      events.push('unrelated')
    }
  })
  await host.use(provider, direct, transitive, unrelated)
  return { host, events, provider, direct, transitive }
}

/** Exposes the existing protected synchronous admission only for its preservation oracle. */
class SyncHost extends PluginHost<Record<string, never>> {
  installSync(plugins: readonly IPluginConstraint<Record<string, never>>[]) {
    return this.useSync(plugins)
  }
}

describe('A7 unUse seams unchanged behavior', () => {
  it('keeps reject, dry-run shape, and dependent-first cascade disposal', async () => {
    const { host, events } = await createChain()
    await expect(host.unUse('provider')).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyBlocked,
      detail: { blockedBy: ['transitive', 'direct'] }
    })
    expect(events).toEqual([])
    const plan = await host.unUse('provider', { policy: 'cascade', dryRun: true })
    expect(Object.keys(plan).sort()).toEqual(['edges', 'order', 'policy', 'steps'])
    expect(plan.order).toEqual(['transitive', 'direct', 'provider'])
    expect(plan.steps.map((step) => [step.name, step.action])).toEqual([
      ['transitive', 'release'],
      ['direct', 'release'],
      ['provider', 'release']
    ])
    expect(plan.edges).toEqual(expect.any(Array))
    await expect(host.unUse('provider', { policy: 'cascade' })).resolves.toMatchObject({ ok: true })
    expect(events).toEqual(['transitive', 'direct', 'provider'])
    await host.dispose()
    expect(events).toEqual(['transitive', 'direct', 'provider', 'unrelated'])
  })

  it('keeps suspend non-destructive and replacement cleanup order', async () => {
    const { host, events, provider } = await createChain()
    await expect(host.unUse('provider', { policy: 'suspend' })).resolves.toMatchObject({
      ok: true
    })
    expect(events).toEqual(['provider'])
    const replacement = definePlugin({
      name: 'provider',
      features: { providerFeature: defineFeature(() => ({ value: 2 })) },
      install: () => ({}),
      dispose: () => {
        events.push('replacement')
      }
    })
    await host.use(replacement)
    await host.replace('provider', provider)
    expect(events.at(-1)).toBe('replacement')
    await host.dispose()
    expect(events.filter((entry) => entry === 'provider')).toHaveLength(2)
  })

  it('keeps prepared composition removal result shape', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const composition = openComposition(host)
    const admission = composition.createPluginAdmission({ name: 'managed', install: () => ({}) })
    const slot = composition.createDataOrderSlot('managed')
    const prepared = await composition.prepareAdmissions([{ admission, slot }])
    const [receipt] = composition.commitPreparedAdmissions(prepared)
    const result = await composition.commitPreparedUnUseBatch(
      composition.prepareUnUseBatch([receipt!]),
      { beforeCleanup: Promise.resolve() }
    )
    expect(result).toMatchObject({ ok: true, committed: true, cleanupComplete: true })
    expect(result.cleanupErrors).toEqual([])
    await host.dispose()
  })

  it('keeps synchronous installation and disposal', async () => {
    const host = new SyncHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const plugin = definePlugin({ name: 'sync', install: () => ({}) })
    const [handle] = host.installSync([plugin])
    expect(handle?.name).toBe('sync')
    await expect(host.unUse('sync')).resolves.toMatchObject({ ok: true })
    await host.dispose()
  })
})
