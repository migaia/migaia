import { describe, expect, it, vi } from 'vitest'
import { definePlugin, PluginHost, type IPluginConstraint } from '../src/index.js'
import { readDefinedPluginDefinition } from '../src/define-plugin.js'
import { snapshotPluginDefinitions } from '../src/admission-runtime.js'
import ERROR_TEXT from '../src/error-text.js'

/** Exposes synchronous admission to prove it rejects malformed hooks before mutation. */
class SyncHost extends PluginHost<Record<string, never>> {
  admit(plugins: readonly IPluginConstraint<any>[]) {
    return this.useSync(plugins)
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
