import { describe, expect, it, vi } from 'vitest'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { defineFeature, definePlugin, PluginHost, PluginHostError } from '../src/index.js'

/**
 * A4, A5, A6, A7 and A14 cover suspended access, recovery, failure containment, teardown and
 * stale-generation restarts.
 */
type IRecoveryDiagnostic = { code?: string; error?: unknown }

/** Sync pipeline host used to observe suspended-stage exclusion. */
class SuspendHost extends PluginHost<Record<string, never>, number> {
  run(value: number): number {
    let result = value
    this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Async pipeline host used by the program-level recovery integration acceptance. */
class RecoveryHost extends PluginHost<Record<string, never>, number> {
  constructor(diagnostics: IRecoveryDiagnostic[]) {
    super({
      execution,
      pipeline: { mode: MiddlewarePipelineMode.async },
      diagnostic: (_message, code, error) => diagnostics.push({ code, error })
    })
  }

  async run(value: number): Promise<number> {
    let result = value
    await this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Unbounded host options shared by dependency recovery fixtures. */
const execution = { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }

describe('dependency suspension and recovery', () => {
  it('suspends active required dependents without disposing them', async () => {
    const host = new SuspendHost({ execution })
    const stages: string[] = []
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const aValue = defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
      p: p.getFeature('value')
    })
    const a = definePlugin({
      name: 'a',
      features: { value: aValue },
      install: (core: any) => {
        core.usePipeline((value: number, next: (value: number) => void) => {
          stages.push('a')
          next(value + 1)
        })
        return { read: () => 'a' }
      },
      dispose: disposeA
    })
    const bValue = defineFeature((_core, dependencies) => ({ value: dependencies.a.value }), {
      a: a.getFeature('value')
    })
    const b = definePlugin({
      name: 'b',
      features: { value: bValue },
      install: () => ({ readB: () => 'b' }),
      dispose: disposeB
    })
    const cValue = defineFeature(
      (_core, dependencies) => ({ present: dependencies.p !== undefined }),
      { p: p.getFeature('value', { optional: true }) }
    )
    const c = definePlugin({
      name: 'c',
      features: { value: cValue },
      install: (core: any) => {
        core.usePipeline((value: number, next: (value: number) => void) => {
          stages.push('c')
          next(value + 10)
        })
        return {}
      }
    })
    const lValue = defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
      p: p.getFeature('value')
    })
    const l = definePlugin({
      name: 'l',
      activation: 'lazy',
      features: { value: lValue },
      install: () => ({})
    })
    const [, handleA, handleB] = await host.use(p, a, b, c, l)
    const extracted = handleA.extensions.read

    await expect(host.unUse('p', { policy: 'suspend' })).resolves.toEqual({ ok: true })
    expect(() => handleA.getFeature('value')).toThrow(
      expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
    )
    expect(() => handleB.extensions).toThrow(expect.objectContaining({ code: 'PLUGIN_SUSPENDED' }))
    expect(() => extracted()).toThrow(expect.objectContaining({ code: 'PLUGIN_SUSPENDED' }))
    expect(disposeA).not.toHaveBeenCalled()
    expect(disposeB).not.toHaveBeenCalled()
    expect(host.run(0)).toBe(10)
    expect(stages).toEqual(['c'])
    await expect(host.activate('l')).rejects.toMatchObject({ code: 'PREREQUISITE_REMOVED' })
    await expect(host.replace('a', a)).rejects.toMatchObject({ code: 'PLUGIN_SUSPENDED' })
    const installX = vi.fn(() => ({}))
    const x = definePlugin({
      name: 'x',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.a.value }), {
          a: a.getFeature('value')
        })
      },
      install: installX
    })
    await expect(host.use(x)).rejects.toMatchObject({ code: 'PLUGIN_SUSPENDED' })
    expect(installX).not.toHaveBeenCalled()
    await expect(host.unUse('b')).resolves.toEqual({ ok: true })
    await host.dispose()
  })

  it('restores same-generation dependents without reinstalling them', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const installs = { a: 0, b: 0 }
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const aValue = defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
      p: p.getFeature('value')
    })
    const a = definePlugin({
      name: 'a',
      features: { value: aValue },
      install: () => {
        installs.a += 1
        return { read: () => 'a' }
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
    const [, handleA, handleB] = await host.use(p, a, b)
    const extensions = handleA.extensions
    const disabled = await host.plugin.disable('p', { policy: 'suspend' })
    expect(() => handleB.extensions).toThrow(expect.objectContaining({ code: 'PLUGIN_SUSPENDED' }))
    await disabled.token.enable()
    expect(handleA.extensions).toBe(extensions)
    expect(handleB.name).toBe('b')
    expect(installs).toEqual({ a: 1, b: 1 })
    await host.dispose()
  })

  it('keeps a transitive dependent suspended while another provider is disabled', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const pValue = defineFeature(() => ({ value: 'p' }))
    const qValue = defineFeature(() => ({ value: 'q' }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const q = definePlugin({ name: 'q', features: { value: qValue }, install: () => ({}) })
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      install: () => ({})
    })
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature(
          (_core, dependencies) => ({ value: `${dependencies.a.value}:${dependencies.q.value}` }),
          { a: a.getFeature('value'), q: q.getFeature('value') }
        )
      },
      install: () => ({})
    })
    const [, , handleA, handleB] = await host.use(p, q, a, b)
    await host.plugin.disable('q', { policy: 'suspend' })
    const disabledP = await host.plugin.disable('p', { policy: 'suspend' })
    await disabledP.token.enable()
    expect(handleA.name).toBe('a')
    expect(() => handleB.extensions).toThrow(expect.objectContaining({ code: 'PLUGIN_SUSPENDED' }))
    await host.dispose()
  })

  it('uses the upstream resume plan after a provider generation changes', async () => {
    const diagnostics: IRecoveryDiagnostic[] = []
    const stages: string[] = []
    const host = new RecoveryHost(diagnostics)
    const pValue = defineFeature(() => ({ value: 1 }))
    const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({}) })
    const hook = vi.fn()
    const installs = { a: 0, b: 0 }
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    const a = definePlugin({
      name: 'a',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: p.getFeature('value')
        })
      },
      onDependencyReplaced: hook,
      install: (core: any) => {
        installs.a += 1
        core.usePipeline((value: number, next: (value: number) => void) => {
          stages.push('a')
          next(value + 1)
        })
        return {}
      },
      dispose: disposeA
    })
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.a.value }), {
          a: a.getFeature('value')
        })
      },
      install: (core: any) => {
        installs.b += 1
        core.usePipeline((value: number, next: (value: number) => void) => {
          stages.push('b')
          next(value * 2)
        })
        return {}
      },
      dispose: disposeB
    })
    const [, handleA, handleB] = await host.use(p, a, b)
    await host.unUse('p', { policy: 'suspend' })
    const nextOutput = { value: 2 }
    const p2 = definePlugin({
      name: 'p',
      features: { value: defineFeature(() => nextOutput) },
      install: () => ({})
    })
    await expect(host.use(p2)).resolves.toHaveLength(1)
    expect(hook).toHaveBeenCalledWith('p', { value: nextOutput })
    expect(installs).toEqual({ a: 1, b: 1 })
    expect(disposeA).not.toHaveBeenCalled()
    expect(disposeB).not.toHaveBeenCalled()
    expect(handleA.name).toBe('a')
    expect(handleB.name).toBe('b')
    await expect(host.run(1)).resolves.toBe(4)
    expect(stages).toEqual(['a', 'b'])
    expect(diagnostics).toEqual([])
    await host.dispose()
  })

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

  it('A16 keeps a disabled rebindable middle node disabled while its provider returns', async () => {
    for (const newDefinition of [false, true]) {
      const host = new PluginHost<Record<string, never>>({ execution })
      const p = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 1 })) },
        install: () => ({})
      })
      const hook = vi.fn()
      const installs = { m: 0, s: 0 }
      const m = definePlugin({
        name: 'm',
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
            p: p.getFeature('value')
          })
        },
        onDependencyReplaced: hook,
        install: () => {
          installs.m += 1
          return {}
        }
      })
      const s = definePlugin({
        name: 's',
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.m.value }), {
            m: m.getFeature('value')
          })
        },
        install: () => {
          installs.s += 1
          return {}
        }
      })
      const [, handleM, handleS] = await host.use(p, m, s)
      await host.plugin.disable('m', { policy: 'suspend' })
      await host.unUse('p', { policy: 'suspend' })
      const returningProvider = newDefinition
        ? definePlugin({
            name: 'p',
            features: { value: defineFeature(() => ({ value: 2 })) },
            install: () => ({})
          })
        : p
      await host.use(returningProvider)
      const readError = (read: () => unknown): unknown => {
        try {
          read()
        } catch (error) {
          return error
        }
        return undefined
      }
      const middleError = readError(() => handleM.getFeature('value'))
      const successorError = readError(() => handleS.getFeature('value'))
      expect(middleError).toBeInstanceOf(PluginHostError)
      expect(middleError).toMatchObject({ code: 'PLUGIN_DISABLED' })
      expect(successorError).toBeInstanceOf(PluginHostError)
      expect(successorError).toMatchObject({ code: 'PLUGIN_SUSPENDED' })
      expect(hook).toHaveBeenCalledTimes(1)
      expect(hook.mock.calls[0]?.[0]).toBe('p')
      await host.plugin.enable('m')
      expect(handleM.getFeature('value')).toMatchObject({ value: expect.any(Number) })
      expect(handleS.getFeature('value')).toMatchObject({ value: expect.any(Number) })
      expect(installs).toEqual({ m: 1, s: 1 })
      await host.dispose()
    }
  })

  it('A17 restarts a disabled dependent without a hook and rebinds one with a hook', async () => {
    for (const withHook of [false, true]) {
      const host = new PluginHost<Record<string, never>>({ execution })
      const p = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 1 })) },
        install: () => ({})
      })
      const hook = vi.fn()
      let installs = 0
      const d = definePlugin({
        name: 'd',
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
            p: p.getFeature('value')
          })
        },
        ...(withHook ? { onDependencyReplaced: hook } : {}),
        install: () => {
          installs += 1
          return {}
        }
      })
      const [, handleD] = await host.use(p, d)
      await host.plugin.disable('d')
      const p2 = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 2 })) },
        install: () => ({})
      })
      await host.replace('p', p2)
      expect(() => handleD.getFeature('value')).toThrow(
        expect.objectContaining({ code: 'PLUGIN_DISABLED' })
      )
      expect(installs).toBe(withHook ? 1 : 2)
      if (withHook) {
        expect(hook).toHaveBeenCalledTimes(1)
        expect(hook.mock.calls[0]?.[0]).toBe('p')
        expect(hook.mock.calls[0]?.[1]).toMatchObject({ value: { value: 2 } })
      }
      await host.plugin.enable('d')
      if (withHook) expect(handleD.getFeature('value')).toMatchObject({ value: expect.any(Number) })
      else expect(handleD.getFeature('value')).toEqual({ value: 2 })
      await host.dispose()
    }
  })
})
