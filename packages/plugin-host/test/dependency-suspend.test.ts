import { describe, expect, it, vi } from 'vitest'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'

/** A4, A5, A6 and A7 cover suspended access, recovery, failure containment and teardown. */
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
})
