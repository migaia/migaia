import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

/** Builds a real host with the requested number of unrelated committed registrations. */
const createHost = async (size: number): Promise<PluginHost<Record<string, never>>> => {
  /** Host whose config facade is measured after all installations finish. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Independent registrations make lookup cost the only size-dependent read work. */
  const plugins = Array.from({ length: size }, (_, index) =>
    definePlugin({
      name: `config-${index}`,
      config: { value: index },
      install: () => ({})
    })
  )
  await host.use(...(plugins as never))
  return host
}

/** Measures one 10,000-read sample after a short JIT warmup. */
const measureConfigGet = (host: PluginHost<Record<string, never>>): number => {
  for (let index = 0; index < 1000; index += 1) host.config.get('config-0.value' as never)
  /** Monotonic clock around the exact A27 operation count. */
  const started = performance.now()
  /** Final observed value prevents timing an unused result. */
  let value: unknown
  for (let index = 0; index < 10000; index += 1) value = host.config.get('config-0.value' as never)
  expect(value).toBe(0)
  return (performance.now() - started) / 10000
}

/** Builds the required dependency chain before measuring leaf-only work. */
const createChainHost = async (size: number): Promise<PluginHost<Record<string, never>>> => {
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const plugins: any[] = []
  let previous: any
  for (let index = 0; index < size; index += 1) {
    const feature = previous
      ? defineFeature((_core, dependencies: any) => ({ value: dependencies.previous.value + 1 }), {
          previous: previous.getFeature('value')
        })
      : defineFeature(() => ({ value: 0 }))
    previous = definePlugin({
      name: `node-${index}`,
      features: { value: feature },
      install: () => ({})
    })
    plugins.push(previous)
  }
  await host.use(...(plugins as never))
  return host
}

/** Returns the median of exactly three timed samples. */
const median = (samples: number[]): number => [...samples].sort((left, right) => left - right)[1]!

/** Measures 1,000 exact receipt removals, excluding the first 50 warmup calls. */
const measureReceiptRemoval = async (
  size: number
): Promise<{ prepare: number; commit: number; view: number }> => {
  const host = await createChainHost(size)
  const composition = openComposition(host)
  try {
    const receipts = []
    for (let index = 0; index < 1000; index += 1) {
      const name = `receipt-${index}`
      const admission = composition.createPluginAdmission(
        definePlugin({ name, install: () => ({}) }) as never
      )
      const slot = composition.createDataOrderSlot(name)
      const prepared = await composition.prepareAdmissions([{ admission, slot }])
      const [receipt] = composition.commitPreparedAdmissions(prepared)
      receipts.push(receipt!)
    }
    let prepare = 0
    let commit = 0
    let view = 0
    for (const [index, receipt] of receipts.entries()) {
      const started = performance.now()
      const prepared = composition.prepareUnUseBatch([receipt])
      const prepareElapsed = performance.now() - started
      const commitStarted = performance.now()
      await composition.commitPreparedUnUseBatch(prepared, {
        beforeCleanup: Promise.resolve()
      })
      const commitElapsed = performance.now() - commitStarted
      const viewStarted = performance.now()
      composition.getCurrentSnapshot()
      const viewElapsed = performance.now() - viewStarted
      if (index < 50) continue
      prepare += prepareElapsed
      commit += commitElapsed
      view += viewElapsed
    }
    return { prepare: prepare / 950, commit: commit / 950, view: view / 950 }
  } finally {
    await host.dispose()
  }
}

/** Times exactly 200 mutations without including fixture construction. */
const time200 = async (operation: (index: number) => Promise<unknown>): Promise<number> => {
  const started = performance.now()
  for (let index = 0; index < 200; index += 1) await operation(index)
  return (performance.now() - started) / 200
}

type IOperation =
  | 'use'
  | 'batchUse'
  | 'composition'
  | 'activate'
  | 'replace'
  | 'toggle'
  | 'suspend'
  | 'rollback'

/** Exercises one R17 mutation category against an installed dependency chain. */
const measureMutation = async (size: number, operation: IOperation): Promise<number> => {
  const host = await createChainHost(size)
  try {
    if (operation === 'use') {
      return await time200((index) =>
        host.use(definePlugin({ name: `leaf-${index}`, install: () => ({}) }))
      )
    }
    if (operation === 'batchUse') {
      return await time200((index) =>
        host.use(
          ...(Array.from({ length: 10 }, (_, member) =>
            definePlugin({ name: `batch-${index}-${member}`, install: () => ({}) })
          ) as never)
        )
      )
    }
    if (operation === 'composition') {
      const composition = openComposition(host)
      return await time200(async (index) => {
        const candidates = Array.from({ length: 10 }, (_, member) => {
          const name = `composition-${index}-${member}`
          return {
            admission: composition.createPluginAdmission(
              definePlugin({ name, install: () => ({}) }) as never
            ),
            slot: composition.createDataOrderSlot(name)
          }
        })
        const prepared = await composition.prepareAdmissions(candidates)
        composition.commitPreparedAdmissions(prepared)
      })
    }
    if (operation === 'activate') {
      await host.use(
        ...(Array.from({ length: 200 }, (_, index) =>
          definePlugin({ name: `lazy-${index}`, activation: 'lazy', install: () => ({}) })
        ) as never)
      )
      return await time200((index) => host.activate(`lazy-${index}`))
    }
    if (operation === 'replace') {
      await host.use(definePlugin({ name: 'replace-leaf', install: () => ({}) }))
      return await time200(() =>
        host.replace('replace-leaf', definePlugin({ name: 'replace-leaf', install: () => ({}) }))
      )
    }
    if (operation === 'toggle') {
      await host.use(definePlugin({ name: 'toggle-leaf', install: () => ({}) }))
      return await time200((index) =>
        index % 2 === 0 ? host.plugin.disable('toggle-leaf') : host.plugin.enable('toggle-leaf')
      )
    }
    if (operation === 'suspend') {
      const feature = defineFeature(() => ({ value: 1 }))
      const provider = () =>
        definePlugin({ name: 'cycle-provider', features: { value: feature }, install: () => ({}) })
      const dependent = definePlugin({
        name: 'cycle-dependent',
        features: {
          value: defineFeature((_core, dependencies) => dependencies.value, {
            value: provider().getFeature('value')
          })
        },
        install: () => ({})
      })
      await host.use(provider(), dependent as never)
      return await time200(async () => {
        await host.unUse('cycle-provider', { policy: 'suspend' })
        await host.use(provider())
      })
    }
    return await time200(async (index) => {
      const batch = Array.from({ length: 10 }, (_, member) =>
        definePlugin({
          name: `rollback-${index}-${member}`,
          install: () => {
            if (member === 9) throw new Error('expected rollback')
            return {}
          }
        })
      )
      try {
        await host.use(...(batch as never))
        throw new Error('failed batch unexpectedly succeeded')
      } catch (error) {
        expect(error).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      }
    })
  } finally {
    await host.dispose()
  }
}

/** Measures constructor-only synchronous leaf installations after the chain is present. */
const measureUseSync = async (size: number): Promise<number> => {
  class ConstructorHost extends PluginHost<Record<string, never>> {
    /** Mean cost of 950 timed single-leaf calls after 50 warmup calls. */
    readonly leafMs: number

    constructor() {
      super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
      const plugins: any[] = []
      let previous: any
      for (let index = 0; index < size; index += 1) {
        const feature = previous
          ? defineFeature(
              (_core, dependencies: any) => ({ value: dependencies.previous.value + 1 }),
              {
                previous: previous.getFeature('value')
              }
            )
          : defineFeature(() => ({ value: 0 }))
        previous = definePlugin({
          name: `sync-node-${index}`,
          features: { value: feature },
          install: () => ({})
        })
        plugins.push(previous)
      }
      this.useSync(plugins as never)
      const leaves = Array.from({ length: 1000 }, (_, index) =>
        definePlugin({ name: `sync-leaf-${index}`, install: () => ({}) })
      )
      for (let index = 0; index < 50; index += 1) this.useSync([leaves[index]] as never)
      const started = performance.now()
      for (let index = 50; index < 1000; index += 1) this.useSync([leaves[index]] as never)
      this.leafMs = (performance.now() - started) / 950
    }
  }
  const host = new ConstructorHost()
  await host.dispose()
  return host.leafMs
}

/** Records E-c's alternating mutation and run cost without imposing a ratio. */
const measureAlternatingRun = async (size: number): Promise<number> => {
  class RunningHost extends PluginHost<Record<string, never>, number> {
    run(): void {
      this.runPipeline(0, () => {})
    }
  }
  const host = new RunningHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  try {
    const plugins = Array.from({ length: size }, (_, index) =>
      definePlugin({ name: `run-node-${index}`, install: () => ({}) })
    )
    await host.use(...(plugins as never))
    return await time200(async (index) => {
      await host.use(definePlugin({ name: `run-leaf-${index}`, install: () => ({}) }))
      host.run()
    })
  } finally {
    await host.dispose()
  }
}

describe('host mutation scaling', () => {
  it('A18 bounds non-view mutation costs by the affected registrations', async () => {
    const operations: IOperation[] = [
      'use',
      'batchUse',
      'composition',
      'activate',
      'replace',
      'toggle',
      'suspend',
      'rollback'
    ]
    for (const operation of operations) {
      const small = []
      const large = []
      for (let sample = 0; sample < 3; sample += 1) {
        small.push(await measureMutation(500, operation))
        large.push(await measureMutation(4000, operation))
      }
      console.info('A18 mutation timing (ms/op)', JSON.stringify({ operation, small, large }))
      expect(median(large), operation).toBeLessThanOrEqual(3 * median(small))
    }
  }, 120000)

  it('A18 bounds constructor useSync and records the E-c alternating sequence', async () => {
    const small = []
    const large = []
    for (let sample = 0; sample < 5; sample += 1) {
      small.push(await measureUseSync(500))
      large.push(await measureUseSync(4000))
    }
    console.info('A18 useSync timing (ms/call)', JSON.stringify({ small, large }))
    expect(Math.min(...large)).toBeLessThanOrEqual(3 * Math.min(...small))
    const alternating = {
      small: await measureAlternatingRun(500),
      large: await measureAlternatingRun(4000)
    }
    console.info('A18 alternating use/run timing (ms/pair)', JSON.stringify(alternating))
  }, 120000)

  it('A18 bounds receipt preparation and records the E-a commit and view costs', async () => {
    const small = []
    const large = []
    for (let sample = 0; sample < 5; sample += 1) {
      small.push(await measureReceiptRemoval(500))
      large.push(await measureReceiptRemoval(4000))
    }
    console.info('A18 receipt raw timing (ms/op)', JSON.stringify({ small, large }))
    expect(Math.min(...large.map((entry) => entry.prepare))).toBeLessThanOrEqual(
      3 * Math.min(...small.map((entry) => entry.prepare))
    )
  }, 120000)

  it('A27 keeps config.get independent of unrelated registration count', async () => {
    /** Lower comparison scale from R19(d). */
    const small = await createHost(500)
    /** Higher comparison scale from R19(d). */
    const large = await createHost(4000)
    try {
      /** Alternating samples exclude one JIT or collection pause from the 10,000-read ratio. */
      const smallSamples: number[] = []
      const largeSamples: number[] = []
      for (let sample = 0; sample < 3; sample += 1) {
        smallSamples.push(measureConfigGet(small))
        largeSamples.push(measureConfigGet(large))
      }
      smallSamples.sort((left, right) => left - right)
      largeSamples.sort((left, right) => left - right)
      expect(largeSamples[1]).toBeLessThanOrEqual(2 * smallSamples[1]!)
    } finally {
      await small.dispose()
      await large.dispose()
    }
  })
})
