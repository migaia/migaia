import { describe, expect, it, vi } from 'vitest'
import { definePlugin, PluginHost, type IPluginHostCore } from '../src/index.js'
import { PluginHostState } from '../src/host-state.js'

/** Sync host exposes stage identity while an install candidate remains unpublished. */
class ArchitectureHost extends PluginHost<Record<string, never>, string> {
  run(): string {
    let result = ''
    this.runPipeline('', (value) => {
      result = value
    })
    return result
  }
}

describe('host mutation architecture', () => {
  it('A19 preserves committed table and lane identities after a staged replace rollback', async () => {
    /** Original publication method retained while the test captures the exact host state. */
    const publish = PluginHostState.prototype.publishInstallBatch
    /** State captured through the actual host publication, not reconstructed in the test. */
    const states: PluginHostState<Record<string, never>, string>[] = []
    const spy = vi
      .spyOn(PluginHostState.prototype, 'publishInstallBatch')
      .mockImplementation(function (this: PluginHostState<Record<string, never>, string>, ...args) {
        states.push(this)
        return Reflect.apply(publish, this, args)
      })
    try {
      const host = new ArchitectureHost({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      await host.use(
        definePlugin({
          name: 'A',
          install: (core: IPluginHostCore<string>) => {
            core.usePipeline((value, next) => next(`${value}old`))
            return { old: () => 1 }
          }
        })
      )
      const committed = states.at(-1)!
      /** Exact committed registration and extension owner before candidate admission. */
      const previous = committed.registrations.get('A')
      const extensionOwner = committed.extensionOwners.get('old')
      /** Frozen stage snapshot must remain the same object after the failed candidate. */
      const snapshot = committed.lanes.snapshot()
      expect(host.run()).toBe('old')

      await expect(
        host.replace(
          'A',
          definePlugin({
            name: 'A',
            install: (core: IPluginHostCore<string>) => {
              core.usePipeline((value, next) => next(`${value}new`))
              return { candidate: () => 2, config: 1 }
            }
          })
        )
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(committed.registrations.get('A')).toBe(previous)
      expect(committed.extensionOwners.get('old')).toBe(extensionOwner)
      expect(committed.extensionOwners.has('candidate')).toBe(false)
      const after = committed.lanes.snapshot()
      expect(after).toBe(snapshot)
      expect(after.stages).toHaveLength(snapshot.stages.length)
      for (let index = 0; index < after.stages.length; index += 1)
        expect(after.stages[index]).toBe(snapshot.stages[index])

      await expect(
        host.use(
          definePlugin({
            name: 'B',
            install: (core: IPluginHostCore<string>) => {
              core.usePipeline((value, next) => next(`${value}B`))
              return { temporary: () => 3, config: 1 }
            }
          })
        )
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(committed.registrations.get('A')).toBe(previous)
      expect(committed.registrations.has('B')).toBe(false)
      expect(committed.extensionOwners.get('old')).toBe(extensionOwner)
      expect(committed.extensionOwners.has('temporary')).toBe(false)
      expect(committed.lanes.snapshot()).toBe(snapshot)
      expect(host.run()).toBe('old')
      await host.dispose()
    } finally {
      spy.mockRestore()
    }
  })
})
