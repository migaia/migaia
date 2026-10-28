import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.ts'
import { type IRecoveryDiagnostic, execution } from './dependency-suspend-fixtures.ts'

describe('dependency suspension and recovery', () => {
  it('reports restart failure without rejecting the restored provider', async () => {
    const diagnostics: Array<{ code?: string; error?: unknown }> = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: (_message, code, error) => diagnostics.push({ code, error })
    })
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => ({})
    })
    const failure = new Error('b restart failed')
    let installs = 0
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.a.value }), {
          a: a.getFeature('value')
        })
      },
      install: () => {
        installs += 1
        if (installs > 1) throw failure
        return {}
      }
    })
    await host.use(p, a, b)
    await host.unUse('p', { policy: 'suspend' })
    const p2 = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    await expect(host.use(p2)).resolves.toHaveLength(1)
    const reported = diagnostics.find((entry) => entry.code === 'DEPENDENT_RESTART_FAILED')
    expect(reported).toBeDefined()
    expect(reported!.error).toMatchObject({ code: 'DEPENDENT_RESTART_FAILED' })
    const cause = (reported!.error as Error).cause as AggregateError
    expect(cause).toBeInstanceOf(AggregateError)
    expect(cause.errors[0]).toBe(failure)
    await expect(host.unUse('b')).rejects.toMatchObject({ code: 'PLUGIN_NOT_INSTALLED' })
    await host.dispose()
  })

  it('falls back to restarting a failed rebind closure', async () => {
    const hookFailure = new Error('rebind failed')
    const diagnostics: unknown[] = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: (_message, _code, error) => diagnostics.push(error)
    })
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const installs = { a: 0, b: 0 }
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      onDependencyReplaced: () => {
        throw hookFailure
      },
      install: () => {
        installs.a += 1
        return {}
      }
    })
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.a.value }), {
          a: a.getFeature('value')
        })
      },
      install: () => {
        installs.b += 1
        return {}
      }
    })
    await host.use(p, a, b)
    await host.unUse('p', { policy: 'suspend' })
    await host.use(definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) }))
    expect(diagnostics).toContain(hookFailure)
    expect(installs).toEqual({ a: 2, b: 2 })
    await host.dispose()
  })

  it('disposes suspended registrations in dependent-first order', async () => {
    const order: string[] = []
    const host = new PluginHost<Record<string, never>>({ execution })
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => ({}),
      dispose: () => {
        order.push('a')
      }
    })
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature((_core, dependencies: any) => ({ value: dependencies.a.value }), {
          a: a.getFeature('value')
        })
      },
      install: () => ({}),
      dispose: () => {
        order.push('b')
      }
    })
    await host.use(p, a, b)
    await host.unUse('p', { policy: 'suspend' })
    await host.dispose()
    expect(order).toEqual(['b', 'a'])
  })

  it('defers suspended members of a replace restart closure until their providers return', async () => {
    const diagnostics: IRecoveryDiagnostic[] = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: (_message, code, error) => diagnostics.push({ code, error })
    })
    const p = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({})
    })
    const q = definePlugin({
      name: 'q',
      features: { value: defineFeature(() => ({ value: 100 })) },
      install: () => ({})
    })
    const installs = { x: 0, y: 0 }
    const x = definePlugin({
      name: 'x',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => {
        installs.x += 1
        return {}
      }
    })
    const y = definePlugin({
      name: 'y',
      features: {
        value: defineFeature(
          (_core, dependencies) => ({ value: dependencies.x.value + dependencies.q.value }),
          { x: x.getFeature('value'), q: q.getFeature('value') }
        )
      },
      install: () => {
        installs.y += 1
        return {}
      }
    })
    const [, , handleX, handleY] = await host.use(p, q, x, y)
    await host.unUse('q', { policy: 'suspend' })
    const p2 = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ value: 10 })) },
      install: () => ({})
    })
    // x restarts against p2; suspended y cannot reinstall without q and must not fail the batch.
    await expect(host.replace('p', p2)).resolves.toMatchObject({ name: 'p' })
    expect(installs).toEqual({ x: 2, y: 1 })
    expect(handleX.getFeature('value')).toEqual({ value: 10 })
    expect(() => handleY.getFeature('value')).toThrow(
      expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
    )
    expect(diagnostics.map((entry) => entry.code)).not.toContain('DEPENDENT_RESTART_FAILED')
    // y's retained instance is bound to x's disposed generation, so recovery reinstalls it.
    await host.use(
      definePlugin({
        name: 'q',
        features: { value: defineFeature(() => ({ value: 200 })) },
        install: () => ({})
      })
    )
    expect(installs).toEqual({ x: 2, y: 2 })
    expect(handleY.getFeature('value')).toEqual({ value: 210 })
    await host.dispose()
  })

  it('reinstalls a suspended direct dependent whose provider was replaced while suspended', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const p = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({})
    })
    const q = definePlugin({
      name: 'q',
      features: { value: defineFeature(() => ({ value: 100 })) },
      install: () => ({})
    })
    const hook = vi.fn()
    let installs = 0
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature(
          (_core, dependencies) => ({ value: dependencies.p.value + dependencies.q.value }),
          { p: p.getFeature('value'), q: q.getFeature('value') }
        )
      },
      onDependencyReplaced: hook,
      install: () => {
        installs += 1
        return {}
      }
    })
    const [, , handleA] = await host.use(p, q, a)
    await host.unUse('q', { policy: 'suspend' })
    await host.replace(
      'p',
      definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 10 })) },
        install: () => ({})
      })
    )
    expect(installs).toBe(1)
    await host.use(q)
    // A rebind for q alone would leave a bound to the replaced p generation.
    expect(hook).not.toHaveBeenCalled()
    expect(installs).toBe(2)
    expect(handleA.getFeature('value')).toEqual({ value: 110 })
    await host.dispose()
  })

  it('recovers suspended dependents of a synchronously installed provider inside the queue', async () => {
    /** Host exposing the protected synchronous install entry. */
    class SyncInstallHost extends PluginHost<Record<string, never>> {
      installNow(plugins: readonly any[]) {
        return this.useSync(plugins)
      }
    }
    const host = new SyncInstallHost({ execution })
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    let installs = 0
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => {
        installs += 1
        return {}
      }
    })
    const [, handleA] = await host.use(p, a)
    await host.unUse('p', { policy: 'suspend' })
    host.installNow([
      definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 5 })) },
        install: () => ({})
      })
    ])
    // Recovery is a queued mutation: it has not run when the synchronous install returns.
    expect(() => handleA.getFeature('value')).toThrow(
      expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
    )
    await host.unUse('p', { policy: 'cascade', dryRun: true })
    expect(installs).toBe(2)
    expect(handleA.getFeature('value')).toEqual({ value: 5 })
    await host.dispose()
  })
})
