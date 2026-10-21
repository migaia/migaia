import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cpus, loadavg } from 'node:os'
import { PerformanceObserver } from 'node:perf_hooks'
/** Each invocation uses immutable dist capsules with no primary-checkout resolution. */
const [mode, left, right, output, selection = 'all'] = process.argv.slice(2)
/** Collection starts before module load and warmup, then drains twice before final output. */
const gcEvents: unknown[] = []
const observer = new PerformanceObserver((entries) => {
  for (const entry of entries.getEntries())
    gcEvents.push({
      start: entry.startTime,
      duration: entry.duration,
      detail: (entry as any).detail
    })
})
observer.observe({ entryTypes: ['gc'] })
/** Raw evidence is append-only; caller supplies unique run name. */
const emit = (row: unknown): void => appendFileSync(output!, JSON.stringify(row) + '\n')
/** Explicit stage module identity keeps separate versions independently linked. */
const load = async (stage: string, pkg: string, file = 'index.js'): Promise<any> =>
  import(pathToFileURL(resolve(stage, 'packages', pkg, 'dist', file)).href)
emit({
  type: 'manifest',
  mode,
  left,
  right,
  pid: process.pid,
  node: process.version,
  cpu: cpus()[0]?.model,
  startLoad: loadavg(),
  start: new Date().toISOString(),
  threading: 'one JS main thread',
  leftManifest: JSON.parse(readFileSync(resolve(left!, 'manifest.json'), 'utf8')),
  rightManifest: JSON.parse(readFileSync(resolve(right!, 'manifest.json'), 'utf8'))
})
/** Same cases run after every accepted combination. Counters exist only in evidence fixtures. */
function fixture(api: any, scenario: string, instrumented: boolean): any {
  const errors: unknown[] = []
  const runtime = api.createRuntime({ onError: (error: unknown) => errors.push(error) })
  const sequence: string[] = []
  let calls = 0
  let derivations = 0
  let value = 0
  const stops: any[] = []
  const count = Number(scenario.split(':')[1] ?? 1)
  const signals = Array.from({ length: scenario.startsWith('batch') ? count : 1 }, () =>
    runtime.signal(0)
  )
  let sink: any
  const listen = (read: () => number, label: string): void => {
    stops.push(
      runtime.effect(
        instrumented
          ? () => {
              read()
              calls++
              if (sequence.length < 96) sequence.push(label)
            }
          : () => {
              read()
            }
      )
    )
  }
  if (scenario.startsWith('fanout'))
    for (let i = 0; i < count; i++) listen(() => signals[0].value, String(i))
  else if (scenario.startsWith('batch')) {
    for (let i = 0; i < count; i++) listen(() => signals[i].value, String(i))
    listen(() => signals.reduce((sum, item) => sum + item.value, 0), 'all')
  } else if (scenario === 'diamond') {
    const a = runtime.computed(
      instrumented
        ? () => {
            derivations++
            return signals[0].value + 1
          }
        : () => signals[0].value + 1
    )
    const b = runtime.computed(
      instrumented
        ? () => {
            derivations++
            return signals[0].value + 2
          }
        : () => signals[0].value + 2
    )
    sink = runtime.computed(
      instrumented
        ? () => {
            derivations++
            return a.value + b.value
          }
        : () => a.value + b.value
    )
    listen(() => sink.value, 'diamond')
  } else listen(() => signals[0].value, 'single')
  return {
    update: scenario.startsWith('batch')
      ? (next: number) => {
          value = next
          runtime.batch(() => {
            for (const signal of signals) signal.value = next
          })
        }
      : (next: number) => {
          value = next
          signals[0].value = next
          runtime.flush()
        },
    reset: () => {
      calls = 0
      derivations = 0
      sequence.length = 0
    },
    inspect: (operations: number) => {
      assert.equal(signals[0].peek(), value)
      assert.equal(errors.length, 0)
      if (instrumented) {
        assert.equal(
          calls,
          operations *
            (scenario.startsWith('fanout') ? count : scenario.startsWith('batch') ? count + 1 : 1)
        )
        if (scenario === 'diamond') {
          assert.equal(derivations, operations * 3)
          assert.equal(sink.value, value * 2 + 3)
        }
      }
      return { calls, derivations, sequence, operations, finalValue: value }
    },
    dispose: () => {
      for (const stop of stops) stop.dispose()
    }
  }
}
try {
  if (mode === 'memory' || mode === 'memory-one') {
    /**
     * Scope each retained graph in a function so predecessor locals cannot inflate the next
     * baseline.
     */
    async function memorySample(api: any, label: string, kind: string): Promise<void> {
      const baseKind = kind.replace(/-warm$/, '')
      await new Promise(setImmediate)
      await new Promise(setImmediate)
      global.gc!()
      global.gc!()
      const before = process.memoryUsage().heapUsed
      const runtime = api.createRuntime()
      const nodes = Array.from({ length: 10000 }, () => runtime.signal(0))
      const effects: any[] = []
      if (baseKind !== 'signal')
        for (let i = 0; i < 10000; i++)
          effects.push(
            runtime.effect(() => {
              for (let j = 0; j < (baseKind === 'edge1' ? 1 : 5); j++)
                void nodes[(i + j) % nodes.length].value
            })
          )
      /** A second graph shape measures retained notification snapshots after every source publishes. */
      if (kind.endsWith('-warm'))
        runtime.batch(() => {
          for (const node of nodes) node.value = 1
        })
      ;(globalThis as any).__retained = { runtime, nodes, effects }
      global.gc!()
      global.gc!()
      emit({
        type: 'memory',
        label,
        kind,
        nodes: 10000,
        observers: effects.length,
        edges: effects.length * (baseKind === 'edge1' ? 1 : 5),
        bytes: process.memoryUsage().heapUsed - before
      })
      for (const effect of effects) effect.dispose()
      ;(globalThis as any).__retained = undefined
    }
    if (mode === 'memory-one') {
      const [label, kind] = selection.split(':')
      await memorySample(await load(label === 'A' ? left! : right!, 'reactive'), label!, kind!)
    } else
      for (const [label, stage] of [
        ['A', left],
        ['B', right]
      ]) {
        const api = await load(stage!, 'reactive')
        for (const kind of ['signal', 'edge1', 'edge5']) await memorySample(api, label!, kind)
      }
  } else if (mode === 'store-memory-one') {
    const label = selection
    const stage = label === 'A' ? left! : right!
    const reactive = await load(stage, 'reactive')
    const api = await load(stage, 'store-keyed')
    const runtime = reactive.createRuntime()
    const store = api.createAtomStore(runtime)
    const definitions = Array.from({ length: 10000 }, () => api.atomDef(0))
    for (const definition of definitions) store.get(definition)
    ;(globalThis as any).__retained = { store, definitions }
    await new Promise(setImmediate)
    await new Promise(setImmediate)
    global.gc!()
    global.gc!()
    const before = process.memoryUsage().heapUsed
    const stops = definitions.map((definition: any) => store.sub(definition, () => undefined))
    ;(globalThis as any).__retained = { store, definitions, stops }
    global.gc!()
    global.gc!()
    emit({
      type: 'memory',
      label,
      kind: 'store-sub',
      subscriptions: 10000,
      bytes: process.memoryUsage().heapUsed - before
    })
    for (const stop of stops) stop()
    store.dispose()
    ;(globalThis as any).__retained = undefined
  } else if (mode === 'store') {
    const stages = { A: left!, B: right! }
    /**
     * Public store operations consume observable final values; timing callbacks contain no
     * counters.
     */
    async function storeFixture(stage: string, count: number, instrumented: boolean): Promise<any> {
      const reactive = await load(stage, 'reactive')
      const api = await load(stage, 'store-keyed')
      const runtime = reactive.createRuntime({
        onError: (error: any, context: any) =>
          emit({
            type: 'setupDiagnostic',
            source: error?.source,
            code: error?.code,
            name: error?.name,
            message: error?.message,
            phase: context?.phase
          })
      })
      const store = api.createAtomStore(runtime)
      const definitions = Array.from({ length: count }, () => api.atomDef(0))
      const entries = definitions.map((definition: any) => [definition, 0])
      let calls = 0
      const sequence: number[] = []
      const stops = definitions.map((definition: any, index: number) =>
        store.sub(
          definition,
          instrumented
            ? () => {
                calls++
                if (sequence.length < 100) sequence.push(index)
              }
            : () => undefined
        )
      )
      const write = store.setMany
        ? () => store.setMany(entries)
        : () =>
            runtime.batch(() => {
              for (const [definition, update] of entries) store.set(definition, update)
            })
      return {
        update(next: number) {
          for (const entry of entries) entry[1] = next
          write()
        },
        reset() {
          calls = 0
          sequence.length = 0
        },
        inspect(operations: number, last: number) {
          for (const definition of definitions) assert.equal(store.get(definition), last)
          if (instrumented) assert.equal(calls, operations * count)
          return { calls, sequence, operations, finalValue: last }
        },
        dispose() {
          for (const stop of stops) stop()
          store.dispose()
        }
      }
    }
    for (const count of [1, 10, 50]) {
      for (const label of ['A', 'B']) {
        const measured = await storeFixture(stages[label as 'A' | 'B'], count, true)
        measured.reset()
        for (let i = 1; i <= 3; i++) measured.update(i)
        emit({ type: 'evidence', label, scenario: 'store:' + count, ...measured.inspect(3, 3) })
        measured.dispose()
      }
      for (let pair = 0; pair < 12; pair++)
        for (const label of pair % 2 ? ['B', 'A'] : ['A', 'B']) {
          const measured = await storeFixture(stages[label as 'A' | 'B'], count, false)
          for (let i = 1; i <= 5000; i++) measured.update(i)
          const start = process.hrtime.bigint()
          for (let i = 5001; i <= 30000; i++) measured.update(i)
          emit({
            type: 'sample',
            label,
            scenario: 'store:' + count,
            pair,
            iterations: 25000,
            nsPerOperation: Number(process.hrtime.bigint() - start) / 25000
          })
          measured.inspect(25000, 30000)
          measured.dispose()
        }
    }
  } else if (mode === 'thenable') {
    const variants = {
      A: await load(left!, 'utils', 'function.js'),
      B: await load(right!, 'utils', 'function.js')
    }
    for (const kind of ['primitive', 'object', 'thenable', 'throws']) {
      let reads = 0
      const failure = new Error('fixture')
      const then = () => undefined
      const value =
        kind === 'primitive'
          ? 0
          : kind === 'object'
            ? {}
            : // Intentional protocol fixture: measure exactly one guarded then-property read.
              // oxlint-disable-next-line unicorn/no-thenable
              Object.defineProperty({}, 'then', {
                get: () => {
                  reads++
                  if (kind === 'throws') throw failure
                  return then
                }
              })
      for (const label of ['A', 'B']) {
        const api = variants[label as 'A' | 'B']
        reads = 0
        const inspection = api.inspectThenable(value)
        assert.equal(reads, kind === 'thenable' || kind === 'throws' ? 1 : 0)
        emit({
          type: 'inspection',
          label,
          kind,
          reads,
          keys: Reflect.ownKeys(inspection),
          descriptors: Object.getOwnPropertyDescriptors(inspection),
          frozen: Object.isFrozen(inspection),
          errorIdentity: kind !== 'throws' || inspection.error === failure,
          thenIdentity: kind !== 'thenable' || inspection.then === then
        })
      }
      for (let pair = 0; pair < 12; pair++)
        for (const label of pair % 2 ? ['B', 'A'] : ['A', 'B']) {
          const api = variants[label as 'A' | 'B']
          for (let i = 0; i < 10000; i++) api.inspectThenable(value)
          const start = process.hrtime.bigint()
          for (let i = 0; i < 200000; i++) api.inspectThenable(value)
          emit({
            type: 'sample',
            scenario: kind,
            pair,
            label,
            iterations: 200000,
            nsPerOperation: Number(process.hrtime.bigint() - start) / 200000
          })
        }
    }
  } else {
    const variants = { A: await load(left!, 'reactive'), B: await load(right!, 'reactive') }
    /** Deliberate isolated copies report their expected deployment diagnostic before measurement. */
    for (const label of ['A', 'B'])
      variants[label as 'A' | 'B'].createRuntime({
        onError: (error: any, context: any) =>
          emit({
            type: 'setupDiagnostic',
            label,
            source: error?.source,
            code: error?.code,
            name: error?.name,
            message: error?.message,
            phase: context?.phase
          })
      })
    const scenarios =
      selection === 'all'
        ? [
            'fanout:1',
            'fanout:10',
            'fanout:100',
            'batch:1',
            'batch:10',
            'batch:50',
            'single',
            'diamond'
          ]
        : selection.split(',')
    for (const scenario of scenarios) {
      for (const label of ['A', 'B']) {
        const measured = fixture(variants[label as 'A' | 'B'], scenario, true)
        measured.reset()
        for (let i = 1; i <= 3; i++) measured.update(i)
        emit({ type: 'evidence', label, scenario, ...measured.inspect(3) })
        measured.dispose()
      }
      for (let pair = 0; pair < 12; pair++)
        for (const label of pair % 2 ? ['B', 'A'] : ['A', 'B']) {
          const measured = fixture(variants[label as 'A' | 'B'], scenario, false)
          for (let i = 1; i <= 5000; i++) measured.update(i)
          const start = process.hrtime.bigint()
          for (let i = 5001; i <= 30000; i++) measured.update(i)
          emit({
            type: 'sample',
            scenario,
            pair,
            label,
            iterations: 25000,
            nsPerOperation: Number(process.hrtime.bigint() - start) / 25000
          })
          measured.inspect(25000)
          measured.dispose()
        }
    }
  }
} catch (error) {
  const value = error as any
  emit({
    type: 'failure',
    source: value?.source,
    code: value?.code,
    name: value?.name,
    message: String(value?.message).replace(/(?:token|secret|password)=[^ ]+/gi, '<REDACTED>')
  })
  throw error
}
await new Promise(setImmediate)
await new Promise(setImmediate)
emit({ type: 'end', endLoad: loadavg(), end: new Date().toISOString(), gcEvents })
observer.disconnect()
