import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost } from '../src/index.js'

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
