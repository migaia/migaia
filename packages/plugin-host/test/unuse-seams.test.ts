import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import {
  definePlugin,
  defineFeature,
  PluginHost,
  type IPluginBeforeReleaseContext,
  type IPluginConstraint,
  type IPluginHostCore,
  type IPluginRemoval
} from '../src/index.js'
import { readDefinedPluginDefinition } from '../src/define-plugin.js'
import { snapshotPluginDefinitions } from '../src/admission-runtime.js'
import ERROR_TEXT from '../src/error-text.js'

/** Exposes synchronous admission to prove it rejects malformed hooks before mutation. */
class SyncHost extends PluginHost<Record<string, never>> {
  admit(plugins: readonly IPluginConstraint<any>[]) {
    return this.useSync(plugins)
  }
}

/** Exposes one sync pipeline traversal to observe lease visibility during release. */
class NumberHost extends PluginHost<Record<string, never>, number> {
  run(value: number): number {
    let output = value
    this.runPipeline(value, (next) => {
      output = next
    })
    return output
  }
}

describe('A1 committed removal result', () => {
  it('returns the applied frozen plan rather than a dry-run result', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(definePlugin({ name: 'a', install: () => ({}) }))
    const dryRun = await host.unUse('a', { dryRun: true })
    expect('ok' in dryRun).toBe(false)
    const result = await host.unUse('a')
    expect(result).toMatchObject({
      ok: true,
      affected: {
        policy: 'reject',
        order: ['a'],
        steps: [{ name: 'a', action: 'release' }],
        edges: []
      }
    })
    expect(Object.isFrozen(result.affected)).toBe(true)
    expect(Object.isFrozen(result.affected.steps)).toBe(true)
    expect(Object.isFrozen(result.affected.order)).toBe(true)
    expect(Object.isFrozen(result.affected.edges)).toBe(true)
    await host.dispose()
  })

  it('uses the mutation-time plan after an intervening admission and omits old suspensions', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const p = definePlugin({
      name: 'P',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({})
    })
    const q = definePlugin({
      name: 'Q',
      features: { value: defineFeature(() => ({ value: 2 })) },
      install: () => ({})
    })
    const d1 = definePlugin({
      name: 'D1',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => ({})
    })
    const d2 = definePlugin({
      name: 'D2',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.d1.value }), {
          d1: d1.getFeature('value')
        })
      },
      install: () => ({})
    })
    const d3 = definePlugin({
      name: 'D3',
      features: {
        value: defineFeature(
          (_core, dependencies) => ({ value: dependencies.p.value + dependencies.q.value }),
          { p: p.getFeature('value'), q: q.getFeature('value') }
        )
      },
      install: () => ({})
    })
    const unrelated = definePlugin({ name: 'U', install: () => ({}) })
    await host.use(p, q, d1, d2, d3, unrelated)
    await host.unUse('Q', { policy: 'suspend' })
    const stalePlan = await host.unUse('P', { policy: 'suspend', dryRun: true })
    const d4 = definePlugin({
      name: 'D4',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => ({})
    })
    await host.use(d4)
    const freshPlan = await host.unUse('P', { policy: 'suspend', dryRun: true })
    expect(stalePlan.order).not.toContain('D4')
    const result = await host.unUse('P', { policy: 'suspend' })
    expect(result.ok).toBe(true)
    const affected = result.affected
    expect(affected.policy).toBe('suspend')
    expect(new Set(affected.steps.map((step) => step.name))).toEqual(
      new Set(['P', 'D1', 'D2', 'D4'])
    )
    expect(affected.steps.find((step) => step.name === 'P')?.action).toBe('release')
    expect(
      affected.steps.filter((step) => step.name !== 'P').every((step) => step.action === 'suspend')
    ).toBe(true)
    expect(affected.order).toEqual(freshPlan.order.filter((name) => name !== 'D3'))
    expect(
      affected.edges.every(
        (edge) => affected.order.includes(edge.provider) || affected.order.includes(edge.consumer)
      )
    ).toBe(true)
    expect(affected.steps).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'D3' })])
    )
    expect(Object.isFrozen(affected)).toBe(true)
    expect(affected.steps.every(Object.isFrozen)).toBe(true)
    await host.dispose()
  })
})

describe('A4 release hook definition capture', () => {
  it('rejects malformed function values at define, async use, and sync use admission', () => {
    const invalid = { name: 'bad', install: vi.fn(() => ({})), beforeRelease: 1 }
    expect(() => definePlugin(invalid as never)).toThrow(
      expect.objectContaining({
        code: 'INVALID_OPTION',
        message: ERROR_TEXT.PLUGIN_BEFORE_RELEASE_FUNCTION
      })
    )
    const host = new SyncHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    expect(() => host.use(invalid as never)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(() => host.admit([invalid as never])).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(host.revision).toBe(0)
    expect(invalid.install).not.toHaveBeenCalled()
  })

  it('rejects a getter and never re-reads an accepted mutable hook', () => {
    const getter = { name: 'getter', install: () => ({}) }
    const getterRead = vi.fn(() => () => {})
    Object.defineProperty(getter, 'beforeRelease', { get: getterRead })
    expect(() => definePlugin(getter as never)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    const host = new SyncHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    expect(() => host.use(getter as never)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(getterRead).not.toHaveBeenCalled()
    const original = vi.fn()
    const replacement = vi.fn()
    const source = { name: 'valid', install: () => ({}), beforeRelease: original }
    const defined = definePlugin(source)
    const trusted = readDefinedPluginDefinition(defined)
    expect(trusted?.beforeRelease).toBe(defined.beforeRelease)
    source.beforeRelease = replacement
    trusted?.beforeRelease?.({
      signal: new AbortController().signal,
      deadlineAt: undefined,
      remainingMs: () => undefined
    } as never)
    expect(original).toHaveBeenCalledOnce()
    expect(replacement).not.toHaveBeenCalled()
    const raw = { name: 'raw', install: () => ({}), beforeRelease: original }
    const [snapshot] = snapshotPluginDefinitions<Record<string, never>, never>([raw])
    raw.beforeRelease = replacement
    expect(snapshot?.beforeRelease).toBe(original)
  })
})

describe('A2/A5 pre-release transaction', () => {
  it('leaves optional dependents and owned pipeline stages callable during the hook', async () => {
    const events: string[] = []
    /** Keeps the hook open while callers exercise the still-published registration. */
    let enterHook: (() => void) | undefined
    let finishHook: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      enterHook = resolve
    })
    const pending = new Promise<void>((resolve) => {
      finishHook = resolve
    })
    const host = new NumberHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const provider = definePlugin({
      name: 'provider',
      features: { value: defineFeature(() => ({ read: () => 7 })) },
      install: (core: IPluginHostCore<number>) => {
        core.usePipeline((value, next) => {
          events.push('stage')
          next(value + 1)
        })
        return {}
      },
      beforeRelease: () => {
        events.push('before')
        enterHook?.()
        return pending
      },
      dispose: () => {
        events.push('dispose')
      }
    })
    const consumer = definePlugin({
      name: 'optional',
      features: {
        value: defineFeature(
          (_core, dependencies) => ({ read: () => dependencies.provider?.read() }),
          {
            provider: provider.getFeature('value', { optional: true })
          }
        )
      },
      install: () => ({})
    })
    const [, consumerHandle] = await host.use(provider, consumer)
    const removal = host.unUse('provider')
    await entered
    expect(consumerHandle?.getFeature('value').read()).toBe(7)
    expect(host.run(4)).toBe(5)
    expect(events).toEqual(['before', 'stage'])
    finishHook?.()
    await removal
    expect(events.at(-1)).toBe('dispose')
    await host.dispose()
  })

  it('keeps the registration live through its bounded hook and blocks reentrant mutations', async () => {
    const scheduler = createManualScheduler()
    const events: string[] = []
    /** Allows the test to inspect the Host while the exact hook is pending. */
    let enterHook: (() => void) | undefined
    let finishHook: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      enterHook = resolve
    })
    const pending = new Promise<void>((resolve) => {
      finishHook = resolve
    })
    let hookContext: IPluginBeforeReleaseContext | undefined
    const host = new SyncHost({
      scheduler,
      disposeStepTimeoutMs: 100,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const plugin = definePlugin({
      name: 'live',
      install: (core: IPluginHostCore<never>) => {
        core.onDispose(() => {
          events.push('resource')
        })
        return { read: () => 'live' }
      },
      beforeRelease: (context) => {
        hookContext = context
        events.push('before')
        enterHook?.()
        return pending
      },
      dispose: () => {
        events.push('dispose')
      }
    })
    const [handle] = await host.use(plugin)
    const removal = host.unUse('live')
    await entered
    expect(events).toEqual(['before'])
    expect(hookContext?.signal.aborted).toBe(false)
    expect(hookContext?.deadlineAt).toBe(scheduler.now() + 100)
    expect(hookContext?.remainingMs()).toBe(100)
    expect(handle?.extensions.read()).toBe('live')
    const other = definePlugin({ name: 'other', install: () => ({}) })
    expect(() => host.use(other)).toThrow(expect.objectContaining({ code: 'LIFECYCLE_MUTATION' }))
    expect(() => host.admit([other])).toThrow(
      expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
    )
    expect(() => host.unUse('live')).toThrow(
      expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
    )
    expect(() => host.replace('live', plugin)).toThrow(
      expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
    )
    expect(() => host.activate('live')).toThrow(
      expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
    )
    expect(() => host.config.update('live', () => ({}))).toThrow(
      expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
    )
    await expect(host.plugin.disable('live')).rejects.toMatchObject({
      code: 'LIFECYCLE_MUTATION'
    })
    await expect(host.plugin.enable('live')).rejects.toMatchObject({
      code: 'LIFECYCLE_MUTATION'
    })
    scheduler.advance(40)
    expect(hookContext?.remainingMs()).toBe(60)
    finishHook?.()
    const result = await removal
    expect(result).toMatchObject({ ok: true, affected: { order: ['live'] } })
    expect(events).toEqual(['before', 'dispose', 'resource'])
    expect(() => handle?.extensions.read()).toThrow()
    await host.dispose()
  })

  it('collects a hook rejection before dispose failure without rolling back removal', async () => {
    const hookFailure = new Error('hook failure')
    const disposeFailure = new Error('dispose failure')
    const resourceFailure = new Error('resource failure')
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(
      definePlugin({
        name: 'broken',
        install: (core: IPluginHostCore<never>) => {
          core.onDispose(() => {
            throw resourceFailure
          })
          return {}
        },
        beforeRelease: () => {
          throw hookFailure
        },
        dispose: () => {
          throw disposeFailure
        }
      })
    )
    const result: IPluginRemoval = await host.unUse('broken')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable fixture branch')
    expect(result.errors).toHaveLength(3)
    expect(result.errors[0]).toMatchObject({ code: 'PLUGIN_DISPOSE_FAILED', cause: hookFailure })
    expect(result.errors[1]).toMatchObject({ code: 'PLUGIN_DISPOSE_FAILED', cause: disposeFailure })
    expect(result.errors[2]).toMatchObject({
      code: 'PLUGIN_DISPOSE_FAILED',
      cause: resourceFailure
    })
    expect(result.affected.steps).toEqual([{ name: 'broken', action: 'release' }])
    await expect(host.unUse('broken')).rejects.toMatchObject({ code: 'PLUGIN_NOT_INSTALLED' })
    await host.dispose()
  })

  it('rejects precommit failures without changing the Host revision or disposing work', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const dispose = vi.fn()
    const p = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({}),
      dispose
    })
    const d = definePlugin({
      name: 'd',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => ({})
    })
    await host.use(p, d)
    const revision = host.revision
    await expect(host.unUse('absent')).rejects.toMatchObject({ code: 'PLUGIN_NOT_INSTALLED' })
    await expect(host.unUse('p', { cascade: true } as never)).rejects.toMatchObject({
      code: 'INVALID_OPTION'
    })
    await expect(host.unUse('p')).rejects.toMatchObject({ code: 'DEPENDENCY_BLOCKED' })
    expect(host.revision).toBe(revision)
    expect(dispose).not.toHaveBeenCalled()
    await host.dispose()
  })

  it('runs once for disabled and suspended registrations but skips an inactive lazy plugin', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const disabledHook = vi.fn((context: IPluginBeforeReleaseContext) => {
      expect(context.signal.aborted).toBe(false)
    })
    const disabled = definePlugin({
      name: 'disabled',
      install: () => ({}),
      beforeRelease: disabledHook
    })
    await host.use(disabled)
    await host.plugin.disable('disabled')
    await host.unUse('disabled')
    expect(disabledHook).toHaveBeenCalledOnce()

    const q = definePlugin({
      name: 'q',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({})
    })
    const suspendedHook = vi.fn((context: IPluginBeforeReleaseContext) => {
      expect(context.signal.aborted).toBe(false)
    })
    const suspended = definePlugin({
      name: 'suspended',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.q.value }), {
          q: q.getFeature('value')
        })
      },
      install: () => ({}),
      beforeRelease: suspendedHook
    })
    await host.use(q, suspended)
    await host.unUse('q', { policy: 'suspend' })
    expect(suspendedHook).not.toHaveBeenCalled()
    await host.unUse('suspended')
    expect(suspendedHook).toHaveBeenCalledOnce()

    const lazyHook = vi.fn()
    await host.use(
      definePlugin({
        name: 'lazy',
        activation: 'lazy',
        install: () => ({}),
        beforeRelease: lazyHook
      })
    )
    await host.unUse('lazy')
    expect(lazyHook).not.toHaveBeenCalled()
    await host.dispose()
  })

  it('ends the reentrancy window at the injected timeout even if the hook never settles', async () => {
    const scheduler = createManualScheduler()
    /** Signals that the stalled hook has entered without using wall-clock sleeps. */
    let enterHook: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      enterHook = resolve
    })
    const host = new PluginHost<Record<string, never>>({
      scheduler,
      disposeStepTimeoutMs: 100,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(
      definePlugin({
        name: 'stuck',
        install: () => ({}),
        beforeRelease: () => {
          enterHook?.()
          return new Promise<void>(() => {})
        }
      })
    )
    const removal = host.unUse('stuck')
    await entered
    scheduler.advance(100)
    const result = await removal
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable fixture branch')
    expect(result.errors[0]).toMatchObject({
      code: 'PLUGIN_DISPOSE_FAILED',
      cause: expect.objectContaining({ code: 'DISPOSE_STEP_TIMEOUT' })
    })
    /** Holds the accepted mutation until it settles before disposing its Host. */
    let nextUse: Promise<unknown> | undefined
    expect(() => {
      nextUse = host.use(definePlugin({ name: 'next', install: () => ({}) }))
    }).not.toThrow()
    await nextUse
    await host.dispose()
  })

  it('does not let a late first hook clear the next registration guard', async () => {
    const scheduler = createManualScheduler()
    /** Separately controls two dependent hooks in their planned release order. */
    let enterFirst: (() => void) | undefined
    let enterSecond: (() => void) | undefined
    let settleFirst: (() => void) | undefined
    let settleSecond: (() => void) | undefined
    const firstEntered = new Promise<void>((resolve) => {
      enterFirst = resolve
    })
    const secondEntered = new Promise<void>((resolve) => {
      enterSecond = resolve
    })
    const firstPending = new Promise<void>((resolve) => {
      settleFirst = resolve
    })
    const secondPending = new Promise<void>((resolve) => {
      settleSecond = resolve
    })
    let hookCalls = 0
    const beforeRelease = () => {
      hookCalls += 1
      if (hookCalls === 1) {
        enterFirst?.()
        return firstPending
      }
      enterSecond?.()
      return secondPending
    }
    const host = new PluginHost<Record<string, never>>({
      scheduler,
      disposeStepTimeoutMs: 100,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const provider = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({})
    })
    /** Both registrations must release before their provider under cascade. */
    const dependents = ['d1', 'd2'].map((name) =>
      definePlugin({
        name,
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
            p: provider.getFeature('value')
          })
        },
        install: () => ({}),
        beforeRelease
      })
    )
    await host.use(provider, ...dependents)
    const removal = host.unUse('p', { policy: 'cascade' })
    await firstEntered
    scheduler.advance(100)
    await secondEntered
    settleFirst?.()
    await Promise.resolve()
    expect(() => host.use(definePlugin({ name: 'other', install: () => ({}) }))).toThrow(
      expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
    )
    settleSecond?.()
    const result = await removal
    expect(result).toMatchObject({ ok: false, affected: { order: expect.arrayContaining(['p']) } })
    expect(hookCalls).toBe(2)
    await host.dispose()
  })

  it('reports no deadline when the admitted disposer budget is unbounded', async () => {
    let observed: IPluginBeforeReleaseContext | undefined
    const host = new PluginHost<Record<string, never>>({
      disposeStepTimeoutMs: false,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(
      definePlugin({
        name: 'unbounded',
        install: () => ({}),
        beforeRelease: (context) => {
          observed = context
        }
      })
    )
    await host.unUse('unbounded')
    expect(observed?.deadlineAt).toBeUndefined()
    expect(observed?.remainingMs()).toBeUndefined()
    await host.dispose()
  })
})
