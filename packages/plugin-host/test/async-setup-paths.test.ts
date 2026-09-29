import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

/** Creates one unbounded host so path tests control setup settlement directly. */
const createHost = (diagnostic?: (...args: any[]) => void) =>
  new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    diagnostic
  })

/** One externally released setup result or rejection. */
const deferred = <T>() => {
  /** Completes the held setup. */
  let resolve!: (value: T) => void
  /** Rejects the held setup with its original error. */
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Versioned provider whose Feature gives dependents a stable dependency edge. */
const provider = (version: number) =>
  definePlugin({
    name: 'p',
    features: { value: defineFeature(() => ({ version })) },
    install: () => ({ read: () => version })
  })

/** Builds a transitive restart closure p ← d ← t with observable setup and feature order. */
const restartChain = (lateFailure?: Error, lazy = false) => {
  const first = provider(1)
  const events: string[] = []
  /** Count of the dependent's re-instantiations. */
  let downstreamInstalls = 0
  /** Count of the tail's setup attempts. */
  let tailSetups = 0
  const dependent = definePlugin({
    name: 'd',
    features: {
      value: defineFeature((_core, dependencies) => ({ version: dependencies.p.version }), {
        p: first.getFeature('value')
      })
    },
    install: () => {
      downstreamInstalls += 1
      events.push('d.install')
      return {}
    }
  })
  const tail = definePlugin({
    name: 't',
    activation: lazy ? ('lazy' as const) : ('eager' as const),
    features: {
      value: defineFeature((_core, dependencies) => ({ version: dependencies.d.version }), {
        d: dependent.getFeature('value')
      })
    },
    setup: () => {
      tailSetups += 1
      events.push('t.setup')
      if (tailSetups === 2 && lateFailure) throw lateFailure
      return tailSetups
    },
    featureExpose: () => {
      events.push('t.expose')
      return {}
    },
    install: () => {
      events.push('t.install')
      return {}
    }
  })
  return {
    first,
    dependent,
    tail,
    events,
    downstreamInstalls: () => downstreamInstalls,
    tailSetups: () => tailSetups
  }
}

describe('async setup entry paths', () => {
  it('A5(a) retries lazy setup after exact failure and activates required providers first', async () => {
    const host = createHost()
    const failure = new Error('first activation failed')
    const events: string[] = []
    let attempts = 0
    const lazy = definePlugin({
      name: 'l',
      activation: 'lazy',
      features: { value: defineFeature(() => ({ value: 1 })) },
      setup: () => {
        attempts += 1
        events.push(`l.setup:${attempts}`)
        if (attempts === 1) throw failure
        return { ready: true }
      },
      featureExpose: (_core, output) => {
        events.push('l.expose')
        expect(output.ready).toBe(true)
        return {}
      },
      install: () => {
        events.push('l.install')
        return {}
      }
    })
    await host.use(lazy)
    await expect(host.activate('l')).rejects.toBe(failure)
    await host.activate('l')
    expect(events).toEqual(['l.setup:1', 'l.setup:2', 'l.expose', 'l.install'])
    await host.dispose()

    const nextHost = createHost()
    const preactivation: string[] = []
    const upstream = definePlugin({
      name: 'upstream',
      activation: 'lazy',
      features: { value: defineFeature(() => ({ value: 1 })) },
      setup: () => {
        preactivation.push('upstream.setup')
        return 1
      },
      install: () => {
        preactivation.push('upstream.install')
        return {}
      }
    })
    const dependent = definePlugin({
      name: 'dependent',
      features: {
        use: defineFeature(() => ({ value: 1 }), { value: upstream.getFeature('value') })
      },
      featureExpose: () => {
        preactivation.push('dependent.expose')
        return {}
      },
      install: () => ({})
    })
    await nextHost.use(upstream)
    await nextHost.use(dependent)
    expect(preactivation).toEqual(['upstream.setup', 'upstream.install', 'dependent.expose'])
    await nextHost.dispose()
  })

  it('A5(b) keeps the prior provider usable while a failed replacement setup rolls back', async () => {
    const host = createHost()
    const [handle] = await host.use(provider(1))
    const gate = deferred<number>()
    const failure = new Error('replacement setup failed')
    const release = vi.fn()
    const next = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ version: 2 })) },
      setup: (context) => {
        context.onDispose(release)
        return gate.promise
      },
      install: () => ({ read: () => 2 })
    })
    const replacing = host.replace('p', next)
    expect(handle.extensions.read()).toBe(1)
    gate.reject(failure)
    await expect(replacing).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: failure
    })
    expect(release).toHaveBeenCalledTimes(1)
    expect(handle.extensions.read()).toBe(1)
    await host.dispose()
  })

  it('A5(c) reruns dependent setup when replacement restarts its closure', async () => {
    const host = createHost()
    const first = provider(1)
    let setups = 0
    const dependent = definePlugin({
      name: 'd',
      features: {
        use: defineFeature(() => ({ ready: true }), { p: first.getFeature('value') })
      },
      setup: () => ++setups,
      install: () => ({})
    })
    await host.use(first, dependent)
    await host.replace('p', provider(2))
    expect(setups).toBe(2)
    await host.dispose()
  })

  it('A5(i) rebinds a dependent with a hook without rerunning setup', async () => {
    const host = createHost()
    const first = provider(1)
    const setup = vi.fn(() => 1)
    const rebound = vi.fn()
    const dependent = definePlugin({
      name: 'a',
      features: {
        value: defineFeature(() => ({ ready: true }), { p: first.getFeature('value') })
      },
      setup,
      onDependencyReplaced: rebound,
      install: () => ({})
    })
    await host.use(first, dependent)
    await host.replace('p', provider(2))
    expect(rebound).toHaveBeenCalledTimes(1)
    expect(setup).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('A5(j) restarts a transitive setup only after its provider dependency commits', async () => {
    const host = createHost()
    const chain = restartChain()
    await host.use(chain.first, chain.dependent, chain.tail)
    chain.events.length = 0
    await host.replace('p', provider(2))
    expect(chain.downstreamInstalls()).toBe(2)
    expect(chain.tailSetups()).toBe(2)
    expect(chain.events).toEqual(['d.install', 't.setup', 't.expose', 't.install'])
    await host.dispose()
  })

  it('A5(k) reports eager tail setup failure after publishing replacement', async () => {
    const host = createHost()
    const failure = new Error('tail restart setup failed')
    const chain = restartChain(failure)
    await host.use(chain.first, chain.dependent, chain.tail)
    let caught: unknown
    try {
      await host.replace('p', provider(2))
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: PluginHostErrorCode.dependentRestartFailed })
    const nested = (caught as Error).cause as AggregateError
    expect(nested).toBeInstanceOf(AggregateError)
    expect(nested.errors[0]).toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: failure
    })
    await host.dispose()
  })

  it('A5(l) retains a failed lazy restart as a retryable unactivated registration', async () => {
    const host = createHost()
    const inner = new Error('inner cause')
    const failure = new Error('lazy tail setup failed', { cause: inner })
    const chain = restartChain(failure, true)
    await host.use(chain.first, chain.dependent, chain.tail)
    await host.activate('t')
    let caught: unknown
    try {
      await host.replace('p', provider(2))
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: PluginHostErrorCode.dependentRestartFailed })
    const nested = (caught as Error).cause as AggregateError
    expect(nested.errors[0]).toBe(failure)
    await host.activate('t')
    expect(chain.tailSetups()).toBe(3)
    await host.dispose()
  })

  it('A5(d,e) waits for returning provider setup, rebinds hooks, and restarts no-hook dependents', async () => {
    const host = createHost()
    const releaseFirst = vi.fn()
    const first = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ version: 1 })) },
      setup: (context) => {
        context.onDispose(releaseFirst)
        return 1
      },
      install: () => ({})
    })
    const rebind = vi.fn()
    const setupA = vi.fn(() => 1)
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ version: dependencies.p.version }), {
          p: first.getFeature('value')
        })
      },
      setup: setupA,
      onDependencyReplaced: rebind,
      install: () => ({})
    })
    const setupB = vi.fn(() => 1)
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature((_core, dependencies) => ({ version: dependencies.a.version }), {
          a: a.getFeature('value')
        })
      },
      setup: setupB,
      install: () => ({})
    })
    const setupS = vi.fn(() => 1)
    const s = definePlugin({
      name: 's',
      features: {
        value: defineFeature(() => ({ ready: true }), { p: first.getFeature('value') })
      },
      setup: setupS,
      install: () => ({})
    })
    await host.use(first, a, b, s)
    await host.unUse('p', { policy: 'suspend' })
    expect(releaseFirst).toHaveBeenCalledTimes(1)
    const gate = deferred<number>()
    const next = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ version: 2 })) },
      setup: () => gate.promise,
      install: () => ({})
    })
    const restoring = host.use(next)
    expect(rebind).not.toHaveBeenCalled()
    gate.resolve(2)
    await restoring
    expect(rebind).toHaveBeenCalledTimes(1)
    expect(setupA).toHaveBeenCalledTimes(1)
    expect(setupB).toHaveBeenCalledTimes(1)
    expect(setupS).toHaveBeenCalledTimes(2)
    await host.dispose()
  })

  it('A5(h) restarts a stale suspended dependent when its provider is re-enabled', async () => {
    const host = createHost()
    const first = provider(1)
    const setupS = vi.fn(() => 1)
    const s = definePlugin({
      name: 's',
      features: {
        value: defineFeature(() => ({ ready: true }), { p: first.getFeature('value') })
      },
      setup: setupS,
      install: () => ({})
    })
    await host.use(first, s)
    await host.plugin.disable('p', { policy: 'suspend' })
    const setupP2 = vi.fn(() => 2)
    await host.replace(
      'p',
      definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ version: 2 })) },
        setup: setupP2,
        install: () => ({})
      })
    )
    await host.plugin.enable('p')
    expect(setupP2).toHaveBeenCalledTimes(1)
    expect(setupS).toHaveBeenCalledTimes(2)
    await host.dispose()
  })

  it('A5(m) preserves the lazy setup error identity through resume diagnostics', async () => {
    const reports: Array<{ code: unknown; error: unknown }> = []
    const host = createHost((_message, code, error) => reports.push({ code, error }))
    const first = provider(1)
    const inner = new Error('nested')
    const failure = new Error('lazy resume setup failed', { cause: inner })
    let setups = 0
    const lazy = definePlugin({
      name: 'b',
      activation: 'lazy',
      features: {
        value: defineFeature(() => ({ ready: true }), { p: first.getFeature('value') })
      },
      setup: () => {
        setups += 1
        if (setups === 2) throw failure
        return setups
      },
      install: () => ({})
    })
    await host.use(first, lazy)
    await host.activate('b')
    await host.unUse('p', { policy: 'suspend' })
    await host.use(provider(2))
    const reported = reports.find(
      (entry) => entry.code === PluginHostErrorCode.dependentRestartFailed
    )
    expect(reported).toBeDefined()
    const cause = (reported!.error as Error).cause as AggregateError
    expect(cause.errors[0]).toBe(failure)
    await host.dispose()
  })

  it('A5(f) does not rerun setup on enablement or config update', async () => {
    const host = createHost()
    const setup = vi.fn(() => 1)
    await host.use(
      definePlugin({
        name: 'p',
        config: { n: 1 },
        setup,
        install: () => ({}),
        update: () => undefined
      })
    )
    await host.plugin.disable('p')
    await host.plugin.enable('p')
    await host.config.update('p' as never, () => ({ n: 2 }))
    expect(setup).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('A5(g) runs setup during composition preparation and releases it on discard', async () => {
    const host = createHost()
    const composition = openComposition(host)
    const release = vi.fn()
    const setup = vi.fn((context: { onDispose(resource: () => void): void }) => {
      context.onDispose(release)
      return 1
    })
    const plugin = definePlugin({ name: 'p', setup, install: () => ({}) })
    const admission = composition.createPluginAdmission(plugin)
    const slot = composition.createDataOrderSlot('p')
    const prepared = await composition.prepareAdmissions([{ admission, slot }])
    expect(setup).toHaveBeenCalledTimes(1)
    await composition.discardPreparedAdmissions(prepared)
    expect(release).toHaveBeenCalledTimes(1)
    await host.dispose()
  })
})
