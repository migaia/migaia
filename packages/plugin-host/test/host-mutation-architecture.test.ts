import { describe, expect, it, vi } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
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
  it('A19 has no whole-table or whole-lane mutation paths in host source', async () => {
    /** Owning source tree after the package build uses the same TypeScript implementation. */
    const sourceRoot = new URL('../src/', import.meta.url)
    /** Every direct source file participates in the forbidden-path scan. */
    const files = (await readdir(sourceRoot)).filter((name) => name.endsWith('.ts'))
    /** Source text keyed by module name for both global and targeted checks. */
    const sources = new Map<string, string>()
    for (const name of files) sources.set(name, await readFile(new URL(name, sourceRoot), 'utf8'))
    /** Retired whole-table and function-identity paths must have no surviving caller. */
    const allSource = [...sources.values()].join('\n')
    for (const retired of [
      'new Map(this.#state.',
      'lanes.copy',
      'lanes.rebuild(',
      'stageOwners',
      'pipelineOwnerKeys',
      'readLiveStages',
      'activeBatch'
    ])
      expect(allSource).not.toContain(retired)
    for (const name of ['stage-lanes.ts', 'pipeline-runtime.ts'])
      for (const retired of ['.splice(', '.sort(', 'indexOf('])
        expect(sources.get(name)).not.toContain(retired)
    for (const retired of ['registrations.entries()', '.sort('])
      expect(sources.get('config-runtime.ts')).not.toContain(retired)
    for (const [name, source] of sources)
      if (name !== 'host-state.ts' && name !== 'install-runtime.ts')
        expect(source).not.toMatch(/\.(?:enabled|suspended|stale)\s*=(?!=)/)
  })

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
