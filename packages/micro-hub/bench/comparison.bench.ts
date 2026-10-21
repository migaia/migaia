import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { arch, cpus, loadavg, platform } from 'node:os'
import { resolve, dirname } from 'node:path'
import { PerformanceObserver, performance, type PerformanceEntry } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { isMainThread, threadId } from 'node:worker_threads'
import { it } from 'vitest'
import type { IBenchFixture, ILibrary, IObservation, IParameters } from './types.js'

/** One scenario cell fixes work before any samples run; calibration never changes mid-run. */
type ICell = {
  scenario: string
  parameters: IParameters
  libraries: ILibrary[]
  iterations: number
  warmupIterations: number
}
/** GC entries use their actual V8 event interval, independently of observer delivery time. */
type IGc = { startTime: number; duration: number; kind: number; flags: number }

/** Run settings are part of the manifest and raw rows, rather than inferred from the report. */
const Settings = {
  rounds: 11,
  groups: ['A', 'B'],
  date: '2026-10-21',
  sequencePrefixOnly: true
} as const
/** Stable scenario identities and record kinds shared by the raw-data reader. */
const Text = {
  states: ['micro-hub', 'nanostores', 'zustand', 'global-state'] as ILibrary[],
  events: ['micro-hub', 'mitt', 'event-target'] as ILibrary[],
  memory: ['micro-hub', 'mitt'] as ILibrary[],
  unitTime: 'ns/op',
  unitMemory: 'bytes/sub',
  instrument: 'instrument',
  sample: 'sample',
  failed: 'scene stopped after a prior invalid sample',
  missingGc: 'Run with --expose-gc',
  missingDist: 'Native module inventory missed a measured entry',
  changedDist: 'Loaded dist changed during measurement',
  changedSource: 'micro-hub/src changed during measurement'
} as const

/** SHA-256 binds raw evidence to the bytes that actually ran. */
const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
/** Source fingerprints enforce the requested read-only implementation boundary. */
const sourceHashes = (directory: string): { path: string; sha256: string }[] =>
  readdirSync(directory, { recursive: true })
    .filter((file) => String(file).endsWith('.ts'))
    .sort()
    .map((file) => ({
      path: resolve(directory, String(file)),
      sha256: sha(readFileSync(resolve(directory, String(file))))
    }))

/** Errors retain classification while redacting common credential-bearing text patterns. */
function failureOf(error: unknown): Record<string, unknown> {
  /** Only own measurement errors are recorded, never environment dumps or arbitrary object graphs. */
  const value = error as {
    source?: unknown
    code?: unknown
    name?: unknown
    message?: unknown
    reason?: unknown
    cause?: unknown
  }
  return {
    source: value?.source ?? null,
    code: value?.code ?? null,
    name: value?.name ?? typeof error,
    reason: value?.reason ?? null,
    message: String(value?.message ?? error).replace(
      /(Bearer\s+|(?:token|password|secret)=)[^\s&]+/gi,
      '$1<REDACTED>'
    ),
    ...(value?.cause ? { cause: failureOf(value.cause) } : {})
  }
}

/** All requested parameter cells are declared up front so recomputation can detect omissions. */
function cells(): ICell[] {
  /** The same four state implementations appear in each applicable cell. */
  const result: ICell[] = []
  for (const apps of [1, 10, 50])
    for (const subscribersPerApp of [1, 10, 100]) {
      result.push({
        scenario: 'S1',
        parameters: { apps, subscribersPerApp, fields: 100 },
        libraries: Text.states,
        iterations: 200,
        warmupIterations: 40
      })
    }
  for (const fields of [1, 10, 50])
    result.push({
      scenario: 'S2',
      parameters: { fields },
      libraries: Text.states,
      iterations: 200,
      warmupIterations: 40
    })
  for (const listeners of [1, 10, 100])
    result.push({
      scenario: 'S3',
      parameters: { listeners },
      libraries: Text.events,
      iterations: 100_000,
      warmupIterations: 10_000
    })
  result.push({
    scenario: 'S4',
    parameters: { subscriptions: 100_000 },
    libraries: Text.memory,
    iterations: 100_000,
    warmupIterations: 1_000
  })
  result.push({
    scenario: 'S5',
    parameters: { entities: 10_000 },
    libraries: Text.states,
    iterations: 100,
    warmupIterations: 20
  })
  for (const cycles of [100, 1000])
    result.push({
      scenario: 'S6',
      parameters: { cycles },
      libraries: ['micro-hub'],
      iterations: cycles,
      warmupIterations: 10
    })
  return result
}

/**
 * Timer records are delivered between samples; GC work itself remains part of measured elapsed
 * time.
 */
const nextTask = (): Promise<void> => new Promise((done) => setImmediate(done))

it('captures all six scenarios with paired A/A rounds and independent execution evidence', async () => {
  assert.equal(typeof globalThis.gc, 'function', Text.missingGc)
  /** Package root stays stable whether Vitest starts here or via a filtered workspace command. */
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** Evidence remains ignored workspace-local documentation. */
  const evidenceRoot = resolve(packageRoot, '../../docs/micro-hub/bench')
  mkdirSync(resolve(evidenceRoot, 'raw'), { recursive: true })
  /** Unique run identity prevents combining samples after a fixture/settings change. */
  const runId = `${Settings.date}-${Date.now()}-${process.pid}-${randomBytes(3).toString('hex')}`
  /** Pseudorandom cyclic starts are reproducible from this persisted seed. */
  const seed = randomBytes(4).readUInt32LE()
  /** LCG state affects order only, never fixture input values. */
  let randomState = seed
  /** Every row is appended immediately so a failed window retains its partial evidence. */
  const rawPath = resolve(evidenceRoot, 'raw', `${runId}.jsonl`)
  /** Initial source hashes are checked again before successful completion. */
  const initialSource = sourceHashes(resolve(packageRoot, 'src'))
  /** Actual native-loaded modules are inventoried before timing and then hooks are removed. */
  const loaded = new Map<string, string>()
  /** No loader instrumentation remains installed in timing samples. */
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context)
      if (url.startsWith('file:')) {
        const path = realpathSync(fileURLToPath(url))
        if (
          /\/packages\/[^/]+\/dist\//.test(path) ||
          /\/node_modules\/\.pnpm\/(?:nanostores|zustand|mitt)@/.test(path)
        )
          loaded.set(path, sha(readFileSync(path)))
      }
      return result
    }
  })
  /** Adapters load only after the native module inventory hook is installed. */
  const stateModule = await import('./state-scenarios.js')
  /** Event/lifecycle adapters share no fixture or singleton with the state adapters. */
  const eventModule = await import('./event-lifecycle-scenarios.js')
  /** Canonical freshness implementation is reused for initial/final dist checks. */
  const stamp: {
    assertClosureFresh(path: string): void
    assertFresh(paths: string[]): void
    STAMP_FILE: string
  } = await import(new URL('../../../scripts/dist-stamp.mjs', import.meta.url).href)
  hook.deregister()
  stamp.assertClosureFresh(packageRoot)
  for (const suffix of [
    '/micro-hub/dist/index.js',
    '/micro-hub/dist/state/index.js',
    '/micro-hub/dist/events/index.js'
  ])
    assert(
      [...loaded.keys()].some((path) => path.endsWith(suffix)),
      Text.missingDist
    )
  for (const library of ['nanostores', 'zustand', 'mitt'])
    assert(
      [...loaded.keys()].some((path) => path.includes(`/${library}@`)),
      `${Text.missingDist}: ${library}`
    )
  /** Loaded workspace owners are the dist-stamp evidence inventory, not a guessed dependency list. */
  const owners = [
    ...new Set(
      [...loaded.keys()]
        .map((path) => /^(.*\/packages\/[^/]+)\/dist\//.exec(path)?.[1])
        .filter((path): path is string => Boolean(path))
    )
  ].sort()
  stamp.assertFresh(owners)
  /** Complete fixed matrix enables the independent reader to reject whole missing cells. */
  const matrix = cells()
  /** This run is one measured JS main thread; the Vitest controller is a separate process. */
  const manifest = {
    environment: {
      pid: process.pid,
      node: process.version,
      cpu: cpus()[0]?.model,
      platform: platform(),
      arch: arch(),
      threadId,
      isMainThread,
      loadStart: loadavg(),
      startedAt: new Date().toISOString(),
      pool: 'forks',
      processModel:
        'one measured JS main thread; Vitest controller separate; V8 internal threads unchanged'
    },
    settings: {
      ...Settings,
      seed,
      cells: matrix,
      stateTiming: 'update plus one shared Promise notification fence per operation',
      p95: 'nearest-rank p95 of sample-average ns/op or retained bytes/sub; not per-operation tail latency',
      memory:
        'event subscriptions only; fixture base excluded; distinct callbacks and retained stop handles for both implementations'
    },
    versions: {
      nanostores: { version: '1.5.5', released: '2026-10-06T13:03:07.271Z' },
      zustand: { version: '5.0.15', released: '2026-08-13T00:39:55.466Z' },
      mitt: { version: '3.0.1', released: '2023-07-04T17:31:47.638Z' },
      source: 'npm registry time metadata, verified 2026-10-21'
    },
    modules: [...loaded]
      .map(([path, sha256]) => ({ path, sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    distStamps: owners.map((path) => ({
      path,
      status: 'fresh',
      stamp: JSON.parse(readFileSync(resolve(path, 'dist', stamp.STAMP_FILE), 'utf8'))
    })),
    sourceSha256: initialSource,
    dirtyWorktree: true
  }
  /** All sample rows must match this single immutable manifest. */
  const manifestHash = sha(JSON.stringify(manifest))
  /** Raw data is newline-delimited and durable after each observation. */
  const write = (row: Record<string, unknown>): void =>
    appendFileSync(rawPath, `${JSON.stringify({ ...row, runId, manifestHash })}\n`)
  write({ kind: 'manifest', manifest })
  console.log(`BENCH_RAW=${rawPath}`)
  /** Same-run GC records are attributed by event timestamps after observer delivery drains. */
  const gcEvents: IGc[] = []
  /** Collects native V8 event detail without adding callbacks to the measured libraries. */
  const collectGc = (entries: PerformanceEntry[]): void => {
    for (const entry of entries) {
      const detail = (entry as PerformanceEntry & { detail: { kind: number; flags: number } })
        .detail
      gcEvents.push({
        startTime: entry.startTime,
        duration: entry.duration,
        kind: detail.kind,
        flags: detail.flags
      })
    }
  }
  /** One observer covers all timed samples and all explicit S4 collections in this run. */
  const observer = new PerformanceObserver((list) => collectGc(list.getEntries()))
  observer.observe({ entryTypes: ['gc'] })
  /** A real scene failure stops that scene; subsequent rows are marked invalid, never fabricated. */
  const stopped = new Map<string, Record<string, unknown>>()
  /** Includes the original failure and reproduction cell for each stopped scene. */
  const defects: Record<string, unknown>[] = []
  /** Monotonic process clock records the complete measured run interval. */
  const began = performance.now()

  /** Chooses exactly the adapter appropriate for the fixed scenario. */
  const create = (
    cell: ICell,
    library: ILibrary,
    instrumented: boolean
  ): Promise<IBenchFixture> => {
    if (cell.scenario === 'S3')
      return eventModule.createEventFixture(
        library,
        { listeners: cell.parameters.listeners! },
        instrumented
      )
    if (cell.scenario === 'S4')
      return eventModule.createEventFixture(
        library,
        { listeners: 0, capacity: 100_000 },
        instrumented
      )
    if (cell.scenario === 'S6')
      return eventModule.createLifecycleFixture({ cycles: cell.parameters.cycles! }, instrumented)
    return stateModule.createStateFixture(
      cell.scenario as 'S1' | 'S2' | 'S5',
      library,
      cell.parameters,
      instrumented
    )
  }
  /**
   * Calls exactly the declared workload; only state scenarios include per-update notification
   * fences.
   */
  const execute = async (
    fixture: IBenchFixture,
    cell: ICell,
    count: number,
    warmup: boolean
  ): Promise<void> => {
    if (cell.scenario === 'S6') {
      for (let index = 0; index < count; index++)
        await fixture.update(warmup ? index - count : index + 1)
    } else if (cell.scenario === 'S3') {
      for (let index = 0; index < count; index++) fixture.update(warmup ? index - count : index + 1)
    } else {
      for (let index = 0; index < count; index++) {
        fixture.update(warmup ? index - count : index + 1)
        await fixture.settle()
      }
    }
    await fixture.settle()
  }
  /** Three explicit collections bound retained-heap samples without timing GC as subscription work. */
  const gc = async (): Promise<number> => {
    for (let index = 0; index < 3; index++) {
      globalThis.gc!()
      await nextTask()
    }
    return process.memoryUsage().heapUsed
  }

  try {
    for (const cell of matrix) {
      console.log(`BENCH_CELL=${cell.scenario} ${JSON.stringify(cell.parameters)}`)
      for (let round = 0; round < Settings.rounds; round++) {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        const first = randomState % cell.libraries.length
        const order = cell.libraries.map(
          (_, index) => cell.libraries[(first + index) % cell.libraries.length]!
        )
        for (const [groupIndex, group] of Settings.groups.entries())
          for (const [orderIndex, library] of order.entries()) {
            const base = {
              scenario: cell.scenario,
              library,
              parameters: cell.parameters,
              round,
              group,
              position: groupIndex * order.length + orderIndex,
              iterations: cell.iterations,
              warmupIterations: cell.warmupIterations
            }
            const id = `${cell.scenario}:${JSON.stringify(cell.parameters)}:${library}:${round}:${group}`
            const instrumentId = `${id}:instrument`
            if (stopped.has(cell.scenario)) {
              write({
                ...base,
                kind: Text.instrument,
                id: instrumentId,
                valid: false,
                failure: { ...stopped.get(cell.scenario), skippedAfterFailure: true }
              })
              write({
                ...base,
                kind: Text.sample,
                id,
                instrumentId,
                valid: false,
                value: null,
                unit: cell.scenario === 'S4' ? Text.unitMemory : Text.unitTime,
                failure: { ...stopped.get(cell.scenario), skippedAfterFailure: true }
              })
              continue
            }
            let fixture: IBenchFixture | undefined
            let instrumentWritten = false
            try {
              fixture = await create(cell, library, true)
              await fixture.settle()
              let evidence: IObservation
              if (cell.scenario === 'S4') {
                fixture.addSubscriptions!(cell.iterations)
                fixture.update(1)
                await fixture.settle()
                evidence = fixture.inspect(1, 1)
              } else {
                await execute(fixture, cell, cell.warmupIterations, true)
                fixture.resetEvidence()
                await execute(fixture, cell, cell.iterations, false)
                evidence = fixture.inspect(cell.iterations, cell.iterations)
              }
              write({
                ...base,
                kind: Text.instrument,
                id: instrumentId,
                valid: true,
                evidence,
                measuredFunctionCalls: cell.iterations
              })
              instrumentWritten = true
              await fixture.dispose()
              fixture = undefined
              // Timing uses a separate fixture with no counters, traces, or evidence callbacks.
              if (cell.scenario === 'S4') {
                fixture = await create(cell, library, false)
                fixture.addSubscriptions!(cell.warmupIterations)
                await fixture.dispose()
                fixture = await create(cell, library, false)
                const heapBefore = await gc()
                const startMs = performance.now()
                fixture.addSubscriptions!(cell.iterations)
                const elapsedMs = performance.now() - startMs
                const heapAfter = await gc()
                const endMs = performance.now()
                fixture.inspect(0, 0)
                await fixture.dispose()
                fixture = undefined
                const heapAfterCleanup = await gc()
                write({
                  ...base,
                  kind: Text.sample,
                  id,
                  instrumentId,
                  valid: true,
                  value: (heapAfter - heapBefore) / cell.iterations,
                  unit: Text.unitMemory,
                  elapsedMs,
                  startMs,
                  endMs,
                  heapBefore,
                  heapAfter,
                  heapAfterCleanup,
                  operationCalls: null,
                  listenerCalls: null
                })
              } else {
                fixture = await create(cell, library, false)
                await fixture.settle()
                await execute(fixture, cell, cell.warmupIterations, true)
                fixture.resetEvidence()
                const startMs = performance.now()
                await execute(fixture, cell, cell.iterations, false)
                const endMs = performance.now()
                const final = fixture.inspect(cell.iterations, cell.iterations)
                await fixture.dispose()
                fixture = undefined
                write({
                  ...base,
                  kind: Text.sample,
                  id,
                  instrumentId,
                  valid: true,
                  value: ((endMs - startMs) * 1e6) / cell.iterations,
                  unit: Text.unitTime,
                  elapsedMs: endMs - startMs,
                  startMs,
                  endMs,
                  finalState: final.finalState,
                  operationCalls: null,
                  listenerCalls: null
                })
              }
              await nextTask()
            } catch (error) {
              const failure = failureOf(error)
              if (!instrumentWritten)
                write({ ...base, kind: Text.instrument, id: instrumentId, valid: false, failure })
              write({
                ...base,
                kind: Text.sample,
                id,
                instrumentId,
                valid: false,
                value: null,
                unit: cell.scenario === 'S4' ? Text.unitMemory : Text.unitTime,
                failure
              })
              stopped.set(cell.scenario, failure)
              defects.push({
                ...base,
                failure,
                classification: 'existing defect or invalid measurement; no implementation changes'
              })
              console.error(`BENCH_INVALID=${cell.scenario} ${library} ${JSON.stringify(failure)}`)
            } finally {
              await fixture?.dispose()
            }
          }
      }
    }
  } finally {
    await nextTask()
    collectGc(observer.takeRecords())
    observer.disconnect()
    const distUnchanged = [...loaded].every(([path, hash]) => sha(readFileSync(path)) === hash)
    const sourceUnchanged =
      JSON.stringify(initialSource) === JSON.stringify(sourceHashes(resolve(packageRoot, 'src')))
    let stampStatus = 'fresh'
    try {
      stamp.assertClosureFresh(packageRoot)
    } catch (error) {
      stampStatus = 'DIST_STALE'
      defects.push({ failure: failureOf(error) })
    }
    write({
      kind: 'end',
      loadEnd: loadavg(),
      endedAt: new Date().toISOString(),
      elapsedMs: performance.now() - began,
      gcEvents,
      distUnchanged,
      sourceUnchanged,
      stampStatus,
      defects,
      complete: stopped.size === 0 && distUnchanged && sourceUnchanged && stampStatus === 'fresh'
    })
    assert(distUnchanged, Text.changedDist)
    assert(sourceUnchanged, Text.changedSource)
    assert.equal(stampStatus, 'fresh')
  }
  assert.equal(stopped.size, 0, `Invalid scenes retained in ${rawPath}`)
})
