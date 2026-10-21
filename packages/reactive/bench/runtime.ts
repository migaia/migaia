import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cpus, loadavg } from 'node:os'
import { PerformanceObserver } from 'node:perf_hooks'
import { Session } from 'node:inspector'
import { writeHeapSnapshot } from 'node:v8'
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

/** A phase-zero fixture keeps observable work identical between counting and timing rounds. */
type IEdgeFixture = {
  update: (next: number) => void
  inspect: (operations: number, last: number) => Record<string, unknown>
  dispose: () => void
}

/** Classifies fixture failures without exposing credential-like values in diagnostic text. */
function edgeFailure(error: unknown): Record<string, unknown> {
  /** Package diagnostics are optional on native assertion errors. */
  const failure = error as any
  return {
    source: failure?.source ?? null,
    code: failure?.code ?? null,
    name: failure?.name ?? null,
    reason: failure?.reason ?? null,
    message: String(failure?.message ?? error).replace(
      /(?:token|secret|password)=[^\s]+/gi,
      '<REDACTED>'
    )
  }
}

/** Builds only supported public graph operations; counters never run in timing callbacks. */
function edgeFixture(
  reactive: any,
  storeApi: any,
  scenario: string,
  instrumented: boolean
): IEdgeFixture {
  /** Runtime reports invalidate evidence rather than disappearing into the default reporter. */
  const errors: unknown[] = []
  /** Each fixture owns an isolated runtime, including lifecycle and subscription cleanup. */
  const runtime = reactive.createRuntime({ onError: (error: unknown) => errors.push(error) })
  /** Scenario width is also the number of nodes created per lifecycle operation. */
  const count = Number(scenario.split(':')[1] ?? 1)
  /** Listener order is retained completely in the separate evidence round. */
  const sequence: number[] = []
  /** Only evidence callbacks increment listener work. */
  let calls = 0
  /** Only evidence computed callbacks increment derivation work. */
  let derivations = 0
  /** Only the evidence update wrapper increments the measured entry-point count. */
  let executions = 0
  /** Final observed result prevents dead-code elimination in both kinds of round. */
  let value = 0
  /** Persistent graph nodes are released by the fixture after each sample. */
  const owned: any[] = []
  /** Effects are released before their sources to avoid terminal-source notifications. */
  const effects: any[] = []
  /** Lifecycle evidence retains one terminal pair for post-timing disposal assertions. */
  let terminal: any[] = []
  /** Store lifecycle belongs to this fixture and is never shared between samples. */
  let store: any
  /** The expected listener fanout is fixed by graph construction. */
  let listenersPerOperation = 1
  /** The expected derivation count excludes initial graph materialization. */
  let derivationsPerOperation = 0
  /** Scenario updates never include assertions or evidence serialization. */
  let operation: (next: number) => void
  /** Expected values are checked after the measured interval. */
  let expected: (last: number) => number = (last) => last
  /** One observer records its output through the same assignment in both rounds. */
  const listen = (read: () => number, index: number): any => {
    /** Select counting once at construction, outside the hot callback. */
    const effect = runtime.effect(
      instrumented
        ? () => {
            value = read()
            calls++
            sequence.push(index)
          }
        : () => {
            value = read()
          }
    )
    effects.push(effect)
    return effect
  }
  /** Derived reads share the same user function without a counter in timing rounds. */
  const derive = (read: () => number): any => {
    /** Ownership includes intermediates in deep and diamond graphs. */
    const node = runtime.computed(
      instrumented
        ? () => {
            derivations++
            return read()
          }
        : read
    )
    owned.push(node)
    return node
  }
  if (scenario.startsWith('lifecycle:')) {
    listenersPerOperation = count
    expected = (last) => last + count - 1
    operation = (next) => {
      /** One operation includes construction and disposal of the complete requested graph. */
      const signals = Array.from({ length: count }, (_, index) => runtime.signal(next + index))
      /** Local observers cannot escape beyond disposal except for the final terminal assertion. */
      const observers = signals.map((signal, index) =>
        runtime.effect(
          instrumented
            ? () => {
                value = signal.value
                calls++
                sequence.push(index)
              }
            : () => {
                value = signal.value
              }
        )
      )
      for (const observer of observers) observer.dispose()
      for (const signal of signals) signal.dispose()
      terminal = [signals[count - 1], observers[count - 1]]
    }
  } else if (scenario.startsWith('store-sub:')) {
    store = storeApi.createAtomStore(runtime)
    /** Atom materialization is outside the interval measuring subscription establishment/release. */
    const definitions = Array.from({ length: count }, () => storeApi.atomDef(0))
    for (const definition of definitions) store.get(definition)
    listenersPerOperation = 0
    expected = () => 0
    /** No store writes occur: subscription listeners correctly execute zero times. */
    const listener = instrumented
      ? () => {
          calls++
          sequence.push(0)
        }
      : () => undefined
    operation = () => {
      /** Each unsubscribe belongs to the matching newly established static observer. */
      const stops = definitions.map((definition) => store.sub(definition, listener))
      for (const stop of stops) stop()
    }
  } else {
    /** Fan-in updates all inputs within one batch; other graphs share one writable source. */
    const signals = Array.from({ length: scenario.startsWith('fanin:') ? count : 1 }, () =>
      runtime.signal(0)
    )
    owned.push(...signals)
    if (scenario.startsWith('fanout:')) {
      listenersPerOperation = count
      for (let i = 0; i < count; i++) listen(() => signals[0].value, i)
    } else if (scenario.startsWith('fanin:')) {
      /** Exactly one derived node owns the wide input dependency set. */
      const sink = derive(() => signals.reduce((sum, signal) => sum + signal.value, 0))
      listen(() => sink.value, 0)
      derivationsPerOperation = 1
      expected = (last) => last * count
    } else if (scenario === 'conditional') {
      /** Switching parity changes one data dependency while preserving the gate dependency. */
      const alternate = [runtime.signal(10), runtime.signal(20)]
      owned.push(...alternate)
      /** Repeated gate reads deliberately exercise duplicate dependency tracking. */
      const sink = derive(() => alternate[signals[0].value % 2].value + signals[0].value)
      listen(() => sink.value, 0)
      derivationsPerOperation = 1
      expected = (last) => last + (last % 2 ? 20 : 10)
    } else if (scenario.startsWith('deep:')) {
      /** Capture each predecessor before moving the tail to avoid a self-referential closure. */
      let tail = signals[0]
      for (let i = 0; i < count; i++) {
        /** Each layer adds one to the single source value. */
        const previous = tail
        tail = derive(() => previous.value + 1)
      }
      listen(() => tail.value, 0)
      derivationsPerOperation = count
      expected = (last) => last + count
    } else if (scenario === 'diamond') {
      /** Both arms feed one join, which must derive once per update. */
      const first = derive(() => signals[0].value + 1)
      /** A distinct second arm preserves the diamond topology. */
      const second = derive(() => signals[0].value + 2)
      /** The join consumes both updated arms before notifying the single listener. */
      const sink = derive(() => first.value + second.value)
      listen(() => sink.value, 0)
      derivationsPerOperation = 3
      expected = (last) => last * 2 + 3
    } else {
      assert.equal(scenario, 'single')
      listen(() => signals[0].value, 0)
    }
    operation = scenario.startsWith('fanin:')
      ? (next) =>
          runtime.batch(() => {
            for (const signal of signals) signal.value = next
          })
      : (next) => {
          signals[0].value = next
          runtime.flush()
        }
  }
  // Initial materialization is setup rather than a measured update.
  calls = 0
  derivations = 0
  sequence.length = 0
  return {
    update: instrumented
      ? (next) => {
          executions++
          operation(next)
        }
      : operation,
    inspect(operations, last) {
      assert.equal(errors.length, 0, JSON.stringify(errors.map(edgeFailure)))
      assert.equal(value, expected(last))
      for (const node of terminal) assert.equal(node.disposed, true)
      if (instrumented) {
        assert.equal(executions, operations)
        assert.equal(calls, operations * listenersPerOperation)
        assert.equal(derivations, operations * derivationsPerOperation)
      }
      return {
        operations,
        executions: instrumented ? executions : null,
        calls: instrumented ? calls : null,
        derivations: instrumented ? derivations : null,
        sequence: instrumented ? sequence : null,
        finalValue: value,
        creates: scenario.startsWith('lifecycle:') ? operations * count * 2 : null,
        subscriptions: scenario.startsWith('store-sub:') ? operations * count : null,
        disposals: scenario.startsWith('lifecycle:')
          ? operations * count * 2
          : scenario.startsWith('store-sub:')
            ? operations * count
            : null
      }
    },
    dispose() {
      for (const effect of effects) effect.dispose()
      for (let i = owned.length - 1; i >= 0; i--) owned[i].dispose()
      store?.dispose()
      terminal = []
    }
  }
}

/** Promisifies inspector transport without using the profiler clock for latency samples. */
function edgePost(
  session: Session,
  method: string,
  parameters: Record<string, unknown> = {}
): Promise<any> {
  return new Promise((resolveResponse, reject) => {
    session.post(method, parameters, (error, result) => {
      if (error) reject(error)
      else resolveResponse(result)
    })
  })
}

/** Profiles a warmed, uninstrumented fixture in its own round, separate from latency samples. */
async function edgeProfile(reactive: any, storeApi: any, scenario: string): Promise<void> {
  /** One profile instance cannot retain the timing sample graph. */
  const measured = edgeFixture(reactive, storeApi, scenario, false)
  /** Large lifecycle operations already include substantial construction work per iteration. */
  const warmup = scenario.includes('10000') ? 2 : 500
  /** Fixed work avoids polluting profiler self time with a per-operation clock read. */
  const profileIterations: Record<string, number> = {
    single: 1000000,
    conditional: 500000,
    'fanin:100': 100000,
    'fanout:100': 50000,
    'deep:100': 25000,
    diamond: 250000,
    'lifecycle:10000': 20,
    'store-sub:10000': 50
  }
  /** Unknown selections are rejected rather than producing an empty profile. */
  const iterations = profileIterations[scenario]
  assert.ok(iterations, 'Missing fixed profile iteration count for ' + scenario)
  for (let i = 1; i <= warmup; i++) measured.update(i)
  /** Inspector self time is derived later from the emitted raw profile. */
  const session = new Session()
  session.connect()
  try {
    await edgePost(session, 'Profiler.enable')
    await edgePost(session, 'Profiler.setSamplingInterval', { interval: 100 })
    await edgePost(session, 'Profiler.start')
    for (let i = warmup + 1; i <= warmup + iterations; i++) measured.update(i)
    /** The profiler's clock and samples remain raw attribution data. */
    const { profile } = await edgePost(session, 'Profiler.stop')
    /** Profile paths are adjacent to the caller's append-only evidence file. */
    const profilePath = output + '.' + scenario.replace(':', '-') + '.cpuprofile'
    writeFileSync(profilePath, JSON.stringify(profile))
    measured.inspect(warmup + iterations, warmup + iterations)
    emit({
      type: 'profile',
      scenario,
      label: 'A',
      profilePath,
      iterations,
      profileDurationUs: profile.endTime - profile.startTime,
      samples: profile.samples?.length ?? 0
    })
  } finally {
    session.disconnect()
    measured.dispose()
  }
}

/** Saves identified native graph collections without treating whole-graph heap deltas as edge cost. */
async function edgeHeap(reactive: any): Promise<void> {
  assert.equal(typeof global.gc, 'function', 'edge-heap requires --expose-gc')
  /** Raw snapshots live next to the JSON evidence, in a directory unique to this invocation. */
  const directory = output + '.snapshots'
  mkdirSync(directory, { recursive: true })
  /** Each call releases its graph before the next graph is allocated. */
  function graphSnapshot(dependencies: number): void {
    global.gc!()
    global.gc!()
    /** Baseline bytes are context only; edge estimates must inspect collection backing tables. */
    const before = process.memoryUsage().heapUsed
    /** One runtime owns all nodes in this snapshot. */
    const runtime = reactive.createRuntime()
    /** Ten thousand source nodes have stable names through the named global root. */
    const signals = Array.from({ length: 10000 }, () => runtime.signal(0))
    /** Every observer uses exactly one or five adjacent sources, with no shared callback state. */
    const effects = signals.map((_, index) =>
      runtime.effect(() => {
        for (let j = 0; j < dependencies; j++) void signals[(index + j) % signals.length].value
      })
    )
    /**
     * Matching array indices map each public view to its owner's native private collection.
     * Snapshot consumers follow Effect.#deps/#depVersions and Signal.#subs, then their tables;
     * readonly views are not themselves counted as native Set/Map edge storage.
     */
    const collectionOwners = effects.map((effect, index) => ({
      observer: effect,
      depsView: effect.deps,
      depVersionsView: effect.depVersions,
      source: signals[index],
      subsView: signals[index].subs
    }))
    ;(globalThis as any).__edgeHeap = {
      kind: 'graph',
      dependencies,
      runtime,
      signals,
      effects,
      collectionOwners
    }
    for (const effect of effects) {
      assert.equal(effect.deps.size, dependencies)
      assert.equal(effect.depVersions.size, dependencies)
    }
    global.gc!()
    global.gc!()
    /** The post-GC value excludes snapshot-generation allocations. */
    const heapUsed = process.memoryUsage().heapUsed
    /** Each dependency width gets an independent snapshot for marginal table analysis. */
    const snapshotPath = writeHeapSnapshot(
      resolve(directory, 'graph-edge' + dependencies + '.heapsnapshot')
    )
    emit({
      type: 'heapSnapshot',
      kind: 'graph',
      dependencies,
      snapshotPath,
      heapUsed,
      heapDelta: heapUsed - before,
      signals: signals.length,
      observers: effects.length,
      edges: effects.length * dependencies,
      root: '__edgeHeap',
      nativeCollectionPaths: ['observer.#deps', 'observer.#depVersions', 'source.#subs'],
      edgeBytes: null,
      note: 'Whole-graph heapDelta is context only; compute edge storage from snapshot collection tables.'
    })
    for (const effect of effects) effect.dispose()
    for (const signal of signals) signal.dispose()
    ;(globalThis as any).__edgeHeap = undefined
  }
  for (const dependencies of [1, 5]) {
    graphSnapshot(dependencies)
    await new Promise(setImmediate)
    await new Promise(setImmediate)
  }
  global.gc!()
  global.gc!()
  /** Synthetic Link storage is deliberately measured without retaining an actual runtime graph. */
  const before = process.memoryUsage().heapUsed
  /** Shared inert endpoints model pointer slots without conflating node or runtime sizes. */
  const endpoints = [{}, {}]
  /** Four pointer fields and two endpoints follow the proposed seven-field object shape. */
  const links = Array.from({ length: 40000 }, () => ({
    dep: endpoints[0],
    sub: endpoints[1],
    version: 0,
    depPrev: null,
    depNext: null,
    subPrev: null,
    subNext: null
  }))
  ;(globalThis as any).__edgeHeap = { kind: 'synthetic-link', endpoints, links }
  global.gc!()
  global.gc!()
  /** Heap delta remains auxiliary; the snapshot's object self_size supplies the Link estimate. */
  const heapUsed = process.memoryUsage().heapUsed
  /** No actual graph is retained by this final snapshot's named root. */
  const snapshotPath = writeHeapSnapshot(resolve(directory, 'synthetic-links.heapsnapshot'))
  emit({
    type: 'heapSnapshot',
    kind: 'synthetic-link',
    snapshotPath,
    heapUsed,
    heapDelta: heapUsed - before,
    links: links.length,
    root: '__edgeHeap',
    fields: ['dep', 'sub', 'version', 'depPrev', 'depNext', 'subPrev', 'subNext'],
    note: 'Use per-object shallow self_size; this is an estimate, not an implemented graph.'
  })
  ;(globalThis as any).__edgeHeap = undefined
}
try {
  if (mode === 'edge' || mode === 'edge-heap') {
    /** A/A capsules contain the same accepted main revision but remain independently linked. */
    const variants = { A: await load(left!, 'reactive'), B: await load(right!, 'reactive') }
    /**
     * Loading both stores before measurement keeps import and module initialization outside
     * samples.
     */
    const stores = { A: await load(left!, 'store-keyed'), B: await load(right!, 'store-keyed') }
    for (const label of ['A', 'B'] as const)
      variants[label].createRuntime({
        onError: (error: unknown) => emit({ type: 'setupDiagnostic', label, ...edgeFailure(error) })
      })
    if (mode === 'edge-heap') await edgeHeap(variants.A)
    else {
      /** Selection remains compatible with existing comma-separated scenario arguments. */
      const scenarios =
        selection === 'all'
          ? [
              'single',
              'conditional',
              'fanin:100',
              'fanout:100',
              'deep:100',
              'diamond',
              'lifecycle:10000',
              'store-sub:10000'
            ]
          : selection.split(',')
      for (const scenario of scenarios) {
        /** Expensive full-graph lifecycle operations require only one complete operation per sample. */
        const iterations = scenario.includes('10000') ? 1 : scenario.includes('100') ? 1000 : 5000
        /** Every timed sample gets independent warmup; counting rounds use the same measured width. */
        const warmup = scenario.includes('10000') ? 1 : 500
        for (const label of ['A', 'B'] as const) {
          /** One independent counting round proves the work for this exact sample configuration. */
          const evidence = edgeFixture(variants[label], stores[label], scenario, true)
          for (let i = 1; i <= iterations; i++) evidence.update(i)
          emit({
            type: 'evidence',
            label,
            scenario,
            ...evidence.inspect(iterations, iterations)
          })
          evidence.dispose()
        }
        for (let group = 0; group < 2; group++)
          for (let pair = 0; pair < 6; pair++)
            for (const label of (group + pair) % 2
              ? (['B', 'A'] as const)
              : (['A', 'B'] as const)) {
              /** Timing state has no listener, derivation, sequence or execution counters. */
              const measured = edgeFixture(variants[label], stores[label], scenario, false)
              for (let i = 1; i <= warmup; i++) measured.update(i)
              /** Latency uses an independent monotonic clock outside the profiled round. */
              const start = process.hrtime.bigint()
              for (let i = warmup + 1; i <= warmup + iterations; i++) measured.update(i)
              /** Stop the clock before assertions, disposal and JSON serialization. */
              const elapsed = process.hrtime.bigint() - start
              measured.inspect(warmup + iterations, warmup + iterations)
              measured.dispose()
              emit({
                type: 'sample',
                group,
                pair,
                label,
                scenario,
                iterations,
                warmup,
                nsPerOperation: Number(elapsed) / iterations,
                evidence: { type: 'evidence', label, scenario, operations: iterations },
                operationsPerSample: scenario.includes('10000') ? 10000 : 1
              })
            }
        await edgeProfile(variants.A, stores.A, scenario)
      }
    }
  } else if (mode === 'memory' || mode === 'memory-one') {
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
    source: value?.source ?? null,
    code: value?.code ?? null,
    name: value?.name ?? null,
    reason: value?.reason ?? null,
    message: String(value?.message).replace(/(?:token|secret|password)=[^ ]+/gi, '<REDACTED>')
  })
  throw error
}
await new Promise(setImmediate)
await new Promise(setImmediate)
emit({ type: 'end', endLoad: loadavg(), end: new Date().toISOString(), gcEvents })
observer.disconnect()
