import { describe, expect, it } from 'vitest'
import {
  defineFeature,
  definePlugin,
  MiddlewarePipelineMode,
  PluginHost,
  type IPluginHostCore
} from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

/** Sync host exposes the current pipeline result for allocation-order assertions. */
class StageOrderHost extends PluginHost<Record<string, never>, string> {
  run(value = ''): string {
    let result = value
    this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Async host exposes stage results while an install hook awaits publication. */
class AsyncStageOrderHost extends PluginHost<Record<string, never>, string> {
  async run(value = ''): Promise<string> {
    let result = value
    await this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Creates one plugin whose single stage appends its stable label. */
const stagePlugin = (name: string, label = name) =>
  definePlugin({
    name,
    install: (core: IPluginHostCore<string>) => {
      core.usePipeline((value, next) => next(`${value}${label}`))
      return {}
    }
  })

describe('stage allocation order', () => {
  it('A20 preserves host and plugin allocation positions across visibility and generations', async () => {
    /** Provider gives a a real required dependency for suspend and restart transitions. */
    const value = defineFeature(() => ({ value: 1 }))
    /** First provider generation, installed before any stage slot exists. */
    const provider = definePlugin({ name: 'p', features: { value }, install: () => ({}) })
    /** Dependent stage definition reused after provider generations change. */
    const dependent = definePlugin({
      name: 'a',
      features: {
        use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
          value: provider.getFeature('value')
        })
      },
      install: (core: IPluginHostCore<string>) => {
        core.usePipeline((input, next) => next(`${input}a`))
        return {}
      }
    })
    const host = new StageOrderHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(provider)
    host.usePipeline((input, next) => next(`${input}H1`))
    await host.use(dependent as never)
    host.usePipeline((input, next) => next(`${input}H2`))
    await host.use(stagePlugin('b') as never)
    expect(host.run()).toBe('H1aH2b')

    await host.plugin.disable('a')
    expect(host.run()).toBe('H1H2b')
    await host.plugin.enable('a')
    expect(host.run()).toBe('H1aH2b')

    await host.unUse('p', { policy: 'suspend' })
    expect(host.run()).toBe('H1H2b')
    await host.use(definePlugin({ name: 'p', features: { value }, install: () => ({}) }))
    expect(host.run()).toBe('H1aH2b')

    await host.replace('a', dependent as never)
    expect(host.run()).toBe('H1aH2b')
    await host.replace('p', definePlugin({ name: 'p', features: { value }, install: () => ({}) }))
    expect(host.run()).toBe('H1aH2b')

    const slot = openComposition(host).createDataOrderSlot('c')
    host.usePipeline((input, next) => next(`${input}H3`))
    await host.use(stagePlugin('c') as never)
    expect(host.run()).toBe('H1aH2bcH3')
    openComposition(host).retireDataOrderSlot(slot)
    await host.dispose()
  })

  it('A21 switches the visible generation at publication before rebind hooks run', async () => {
    /** Host whose hook reads a fresh pipeline snapshot during replacement. */
    const host = new StageOrderHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** Required feature keeps the dependent in the replacement plan. */
    const value = defineFeature(() => ({ value: 1 }))
    /** Old generation contributes one stage. */
    const previous = definePlugin({
      name: 'p',
      features: { value },
      install: (core: IPluginHostCore<string>) => {
        core.usePipeline((input, next) => next(`${input}old`))
        return {}
      }
    })
    /** Result observed by the dependent rebind hook. */
    let duringHook: string | undefined
    /** Dependent stays installed and inspects the publication boundary. */
    const dependent = definePlugin({
      name: 'd',
      features: {
        use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
          value: previous.getFeature('value')
        })
      },
      install: () => ({}),
      onDependencyReplaced: () => {
        duringHook = host.run()
      }
    })
    await host.use(previous, dependent as never)
    await host.replace(
      'p',
      definePlugin({
        name: 'p',
        features: { value },
        install: (core: IPluginHostCore<string>) => {
          core.usePipeline((input, next) => next(`${input}new`))
          return {}
        }
      })
    )
    expect(duringHook).toBe('new')
    expect(host.run()).toBe('new')
    await host.dispose()
  })

  it('A22 retains a host stage registered while an async install is pending', async () => {
    /** Releases the plugin install only after the host stage is registered. */
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Signals that install reached its asynchronous waiting point. */
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const host = new AsyncStageOrderHost({
      pipeline: { mode: MiddlewarePipelineMode.async },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const installing = host.use(
      definePlugin({
        name: 'x',
        install: async () => {
          entered()
          await gate
          return {}
        }
      })
    )
    await waiting
    host.useAsyncPipeline(async (input, next) => next(`${input}X`))
    release()
    await installing
    expect(await host.run()).toBe('X')
    await host.dispose()
  })

  it('A24 keeps identical stage functions as independent owner entries', async () => {
    const host = new StageOrderHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** Shared function registered once by the host and once by plugin p. */
    const f = (input: string, next: (value: string) => void): void => next(`${input}f`)
    host.usePipeline(f)
    await host.use(
      definePlugin({
        name: 'p',
        install: (core: IPluginHostCore<string>) => {
          core.usePipeline(f)
          return {}
        }
      })
    )
    expect(host.run()).toBe('ff')
    await host.plugin.disable('p')
    expect(host.run()).toBe('f')
    await host.plugin.enable('p')
    expect(host.run()).toBe('ff')
    await host.unUse('p')
    expect(host.run()).toBe('f')

    /** Another exact function object registered by two different plugins. */
    const g = (input: string, next: (value: string) => void): void => next(`${input}g`)
    /** Creates a plugin that registers the same function without sharing ownership state. */
    const shared = (name: string) =>
      definePlugin({
        name,
        install: (core: IPluginHostCore<string>) => {
          core.usePipeline(g)
          return {}
        }
      })
    await host.use(shared('p'), shared('q'))
    expect(host.run()).toBe('fgg')
    await host.unUse('p')
    expect(host.run()).toBe('fg')
    await host.dispose()
  })

  it('A25 omits draining stages from new runs during removal and restart', async () => {
    /** Builds one stage that holds its first run until the mutation enters drain. */
    const createGate = () => {
      let release!: () => void
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      return { wait, release, started, entered }
    }
    const host = new AsyncStageOrderHost({
      pipeline: { mode: MiddlewarePipelineMode.async },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const removalGate = createGate()
    let removalCalls = 0
    await host.use(
      definePlugin({
        name: 'x',
        install: (core: IPluginHostCore<string>) => {
          core.useAsyncPipeline(async (input, next) => {
            removalCalls += 1
            if (removalCalls === 1) {
              removalGate.entered()
              await removalGate.wait
            }
            return next(`${input}x`)
          })
          return {}
        }
      })
    )
    const oldRemovalRun = host.run()
    await removalGate.started
    const removing = host.unUse('x')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await host.run()).toBe('')
    expect(removalCalls).toBe(1)
    removalGate.release()
    expect(await oldRemovalRun).toBe('x')
    await removing

    /** Dependent stage is retired while replacing its required provider. */
    const value = defineFeature(() => ({ value: 1 }))
    const provider = definePlugin({ name: 'p', features: { value }, install: () => ({}) })
    const restartGate = createGate()
    let restartCalls = 0
    const dependent = definePlugin({
      name: 'd',
      features: {
        use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
          value: provider.getFeature('value')
        })
      },
      install: (core: IPluginHostCore<string>) => {
        core.useAsyncPipeline(async (input, next) => {
          restartCalls += 1
          if (restartCalls === 1) {
            restartGate.entered()
            await restartGate.wait
          }
          return next(`${input}d`)
        })
        return {}
      }
    })
    await host.use(provider, dependent as never)
    const oldRestartRun = host.run()
    await restartGate.started
    const replacing = host.replace(
      'p',
      definePlugin({ name: 'p', features: { value }, install: () => ({}) })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await host.run()).toBe('')
    expect(restartCalls).toBe(1)
    restartGate.release()
    expect(await oldRestartRun).toBe('d')
    await replacing
    expect(await host.run()).toBe('d')
    await host.dispose()
  })
  it('A28 rejects a prepared admission whose data-order slot was retired before commit', async () => {
    const host = new StageOrderHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const composition = openComposition(host)
    // Enough retired, ownerless slots to trigger tombstone compaction once more are retired.
    for (let index = 0; index < 80; index += 1)
      composition.retireDataOrderSlot(composition.createDataOrderSlot(`spent-${index}`))
    const admission = composition.createPluginAdmission(stagePlugin('late') as never)
    const slot = composition.createDataOrderSlot('late')
    const prepared = await composition.prepareAdmissions([{ admission, slot }])
    composition.retireDataOrderSlot(slot)
    for (let index = 80; index < 160; index += 1)
      composition.retireDataOrderSlot(composition.createDataOrderSlot(`spent-${index}`))
    // Top-level PluginHostError; the candidate never binds to the tombstoned segment.
    expect(() => composition.commitPreparedAdmissions(prepared)).toThrowError(
      expect.objectContaining({ code: 'PLUGIN_INSTALL_FAILED' })
    )
    await composition.discardPreparedAdmissions(prepared)
    expect(host.run()).toBe('')
    // A fresh slot for the same name admits the plugin and its stage runs.
    const retry = composition.createPluginAdmission(stagePlugin('late') as never)
    composition.commitPreparedAdmissions(
      await composition.prepareAdmissions([
        { admission: retry, slot: composition.createDataOrderSlot('late') }
      ])
    )
    expect(host.run()).toBe('late')
    await host.dispose()
  })
})
