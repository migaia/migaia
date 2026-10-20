import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createSupervisor, createUnitBudget } from '../src/index.js'
import { createCoroutineSupervisor } from '../src/coroutine/index.js'
import { createMemoryLauncher, deferred } from './support/memory-launcher.js'
import { createMemoryProfile } from './support/memory-profile.js'
import {
  createPrewarmPool,
  createProcessSupervisor,
  reclaimOrphanProcesses
} from '../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './process/support/memory-process-launcher.js'
import { memoryRegistry } from './process/support/memory-registry.js'

/** Drains the existing task, scope, and budget continuations without advancing deadlines. */
async function flush(): Promise<void> {
  for (let index = 0; index < 60; index++) await Promise.resolve()
}

describe('audited supervision contracts', () => {
  it('handles acquireUnit failure through launch policy without acquiring a lease', async () => {
    /** Acquisition can fail before any unit or lifecycle scope exists. */
    const primary = new Error('acquire unit failed')
    /** The policy report preserves the original hook error on its cause chain. */
    const reports: unknown[] = []
    /** A failed adoption must not consume local capacity. */
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false })
    /** The public hook is exercised through the normal start command. */
    const supervisor = createSupervisor({
      id: 'audit-acquire',
      spec: 'unit',
      budget,
      launcher: createMemoryLauncher(),
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      restart: { mode: 'never' },
      report: (error) => {
        reports.push(error)
      },
      hooks: {
        acquireUnit: () => {
          throw primary
        }
      }
    })
    try {
      expect(await supervisor.start()).toEqual({ state: 'terminal' })
      expect(supervisor.state).toBe('terminal')
      expect(budget.inUse).toBe(0)
      expect(reports).toContainEqual(
        expect.objectContaining({
          code: 'SUPERVISION_EXHAUSTED',
          cause: expect.objectContaining({ code: 'LAUNCH_FAILED', cause: primary })
        })
      )
    } finally {
      await supervisor.dispose()
      budget.close()
    }
  })

  it('reports an aborted health check own failure after its monitor closes', async () => {
    /** Manual health scheduling avoids any real polling or timer race. */
    const scheduler = createManualScheduler()
    /** The checker rejects its own error while observing cancellation. */
    const primary = new Error('health cancellation cleanup failed')
    /** The existing report outlet must retain that exact error. */
    const reports: unknown[] = []
    /** Stop waits until the checker is genuinely active. */
    const checking = deferred<void>()
    /** The task itself is cooperative, so health cleanup cannot be blamed on a hung task. */
    const budget = createUnitBudget({
      kind: 'coroutine',
      maxUnits: 1,
      launchRate: false,
      scheduler
    })
    /** Closing the monitor cancels the pending check without applying another failure policy. */
    const supervisor = createCoroutineSupervisor({
      id: 'audit-health',
      budget,
      scheduler,
      report: (error) => {
        reports.push(error)
      },
      health: {
        intervalMs: 1,
        check: (_handle, signal) => {
          checking.resolve()
          return new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(primary), { once: true })
          )
        }
      },
      spec: {
        task: ({ signal }) =>
          new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true })
          )
      }
    })
    try {
      await supervisor.start()
      scheduler.advance(1)
      await checking.promise
      await supervisor.stop()
      await flush()
      expect(supervisor.state).toBe('stopped')
      expect(reports).toContain(primary)
    } finally {
      await supervisor.dispose()
      budget.close()
    }
  })

  it('adopts the exact warm durable record without duplicate add or removal', async () => {
    /** The registry rejects duplicate ids, like the supported durable port. */
    const registry = memoryRegistry()
    /** Counts only removal of the original warm record, independently of pool refill. */
    const removals: string[] = []
    /** Original storage function retains its own closed-over registry state. */
    const remove = registry.port.remove
    registry.port.remove = async (id) => {
      removals.push(id)
      await remove(id)
    }
    /** The same native handle/spec/budget is transferred, not relaunched. */
    const launcher = memoryProcessLauncher()
    /** Pool refill may coexist with the adopted handle. */
    const budget = createUnitBudget({ kind: 'process', maxUnits: 2, launchRate: false })
    /** Pool and supervisor deliberately use the same legal record id and registry owner. */
    const spec = processSpec()
    /** Identical registry port and namespace determine whether the record can be reused. */
    const registration = { port: registry.port, namespace: 'audit' }
    /** Ready idle units already own their durable records. */
    const pool = createPrewarmPool({
      id: 'audit',
      spec,
      launcher,
      budget,
      size: 1,
      registry: registration,
      report: () => undefined
    })
    await flush()
    /** The retained warm handle must remain the exact adopted execution. */
    const warm = launcher.handles[0]!
    /** The supervisor reuses only an exact matching warm registry record. */
    const supervisor = createProcessSupervisor({
      id: 'audit',
      spec,
      launcher,
      budget,
      prewarm: pool,
      registry: registration,
      restart: { mode: 'never' },
      report: () => undefined
    })
    try {
      expect(await supervisor.start()).toMatchObject({ state: 'ready', unit: warm })
      expect(registry.records.has(`audit/${warm.identity.fingerprint}`)).toBe(true)
      await supervisor.stop()
      await flush()
      expect(removals.filter((id) => id === `audit/${warm.identity.fingerprint}`)).toHaveLength(1)
    } finally {
      await supervisor.dispose()
      await pool.dispose()
      budget.close()
    }
  })

  it('contains and reports both replayed and live prewarm output observer failures', async () => {
    /** The output callback fails without owning the process drain loop. */
    const primary = new Error('prewarm output sink failed')
    /** Reports retain one exact failure per delivery. */
    const reports: unknown[] = []
    /** The inert native handle can independently emit buffered and live output. */
    const launcher = memoryProcessLauncher()
    /** One lease prevents an unrelated refill execution. */
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, launchRate: false })
    /** The pool owns buffering before take transfers the handle. */
    const pool = createPrewarmPool({
      id: 'output',
      spec: processSpec(),
      launcher,
      budget,
      size: 1,
      report: (error) => {
        reports.push(error)
      }
    })
    await flush()
    launcher.handles[0]!.emit('stdout', new Uint8Array([1]))
    /** The returned entry is the public replay and forwarding boundary. */
    const entry = pool.take()!
    try {
      expect(() =>
        entry.bindOutput(() => {
          throw primary
        })
      ).not.toThrow()
      expect(() => launcher.handles[0]!.emit('stdout', new Uint8Array([2]))).not.toThrow()
      expect(reports).toEqual([primary, primary])
    } finally {
      entry.handle.terminate('force')
      await entry.handle.exited
      entry.lease.release()
      await pool.dispose()
      budget.close()
    }
  })

  it('collects and reports registry list failure with its original cause', async () => {
    /** No process record is touched when listing fails. */
    const primary = new Error('registry list failed')
    /** Recovery already exposes collected failures instead of a raw rejection. */
    const reports: unknown[] = []
    /** The public recovery result uses the existing ORPHAN_RECLAIM_FAILED domain. */
    const result = await reclaimOrphanProcesses({
      namespace: 'audit',
      launcher: memoryProcessLauncher(),
      registry: {
        add: async () => undefined,
        remove: async () => undefined,
        list: async () => {
          throw primary
        }
      },
      report: (error) => {
        reports.push(error)
      }
    })
    expect(result.terminated).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.error).toMatchObject({
      code: 'ORPHAN_RECLAIM_FAILED',
      cause: primary,
      detail: { step: 'list' }
    })
    expect(reports).toEqual([result.failures[0]!.error])
  })

  it.each(['intervalMs', 'failureThreshold'] as const)(
    'rejects zero pool usage %s before filling',
    async (field) => {
      /** Admission is tested with an empty pool, never a zero-interval polling loop. */
      const budget = createUnitBudget({ kind: 'process', maxUnits: 1, launchRate: false })
      /** Baseline acceptance is cleaned up even when the assertion is red. */
      let pool: ReturnType<typeof createPrewarmPool> | undefined
      try {
        expect(() => {
          pool = createPrewarmPool({
            id: 'admission',
            spec: processSpec(),
            launcher: memoryProcessLauncher(),
            budget,
            size: 0,
            usage: { [field]: 0 },
            report: () => undefined
          })
        }).toThrow(
          expect.objectContaining({
            code: 'INVALID_OPTION',
            detail: expect.objectContaining({ field: `usage.${field}` })
          })
        )
      } finally {
        await pool?.dispose()
        budget.close()
      }
    }
  )

  it('settles startup timeout through the existing failure policy', async () => {
    /** One manual clock owns startup and teardown deadlines. */
    const scheduler = createManualScheduler()
    /** Reports expose the actual timeout as the terminal policy cause. */
    const reports: unknown[] = []
    /** The cooperative task releases its lease when its startup is cancelled. */
    const budget = createUnitBudget({
      kind: 'coroutine',
      maxUnits: 1,
      launchRate: false,
      scheduler
    })
    /** Readiness intentionally never exposes a port before the startup deadline. */
    const supervisor = createCoroutineSupervisor({
      id: 'audit-timeout',
      scheduler,
      budget,
      startupTimeoutMs: 1,
      restart: { mode: 'never' },
      report: (error) => {
        reports.push(error)
      },
      spec: {
        task: ({ signal }) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
      },
      ready: (handle) => handle.exposed.then(() => undefined)
    })
    /** Startup reaches its original ready wait before the deterministic timeout. */
    const starting = supervisor.start()
    try {
      await flush()
      scheduler.advance(1)
      expect(await starting).toEqual({ state: 'terminal' })
      expect(supervisor.state).toBe('terminal')
      expect(reports).toContainEqual(
        expect.objectContaining({
          code: 'SUPERVISION_EXHAUSTED',
          cause: expect.objectContaining({ code: 'STARTUP_TIMEOUT' })
        })
      )
      expect(await supervisor.start()).toEqual({ state: 'terminal' })
      expect(budget.inUse).toBe(0)
    } finally {
      await supervisor.dispose()
      budget.close()
    }
  })

  it('keeps the old coroutine alive until the candidate is ready and switched', async () => {
    /** Two leases allow a serving task and its replacement to overlap. */
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2, launchRate: false })
    /** The second task starts before its readiness gate is opened. */
    const candidateStarted = deferred<void>()
    /** Only the actual readiness owner can release the candidate to the switch point. */
    const ready = deferred<void>()
    /** Distinguishes both real task invocations without adding an execution abstraction. */
    let calls = 0
    /** Switch publication is independently observed from cancellation. */
    let switches = 0
    /** Ports reveal each task's own cancellation signal. */
    const supervisor = createCoroutineSupervisor<{ id: number; aborted(): boolean }>({
      id: 'audit-switch',
      budget,
      report: () => undefined,
      spec: {
        task: ({ signal, expose }) => {
          /** Each task keeps its immutable invocation ordinal. */
          const id = ++calls
          expose({ id, aborted: () => signal.aborted })
          if (id === 2) candidateStarted.resolve()
          return new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true })
          )
        }
      },
      ready: (handle) => handle.exposed.then((port) => (port.id === 2 ? ready.promise : undefined))
    })
    supervisor.subscribe((event) => {
      if (event.type === 'switched') switches++
    })
    /** Initial startup and replacement share the canonical supervisor queue. */
    const first = await supervisor.start()
    if (first.state !== 'ready') throw new Error('fixture failed to start')
    /** The retained port observes the original task rather than a copied state. */
    const port = await first.unit.exposed
    /** Actual exit remains independent of a requested replacement. */
    let exited = false
    void first.unit.exited.then(() => {
      exited = true
    })
    /** The candidate must remain pending until this test releases its existing readiness gate. */
    const replacing = supervisor.replace({ strategy: 'start-then-switch' })
    try {
      await candidateStarted.promise
      await flush()
      expect(switches).toBe(0)
      expect(port.aborted()).toBe(false)
      expect(exited).toBe(false)
      expect(budget.inUse).toBe(2)
      ready.resolve()
      expect((await replacing).kind).toBe('replaced')
      expect(switches).toBe(1)
      expect(port.aborted()).toBe(true)
      expect(exited).toBe(true)
    } finally {
      ready.resolve()
      await replacing
      await supervisor.dispose()
      budget.close()
    }
  })

  it('retains the lease and pending exit when iterator return rejects before next settles', async () => {
    /** Reap is bounded while the original iterator next is independently held. */
    const scheduler = createManualScheduler()
    /** Actual pending work, rather than a return request, determines disappearance. */
    const next = deferred<IteratorResult<unknown>>()
    /** The cleanup failure remains the original task exit cause. */
    const primary = new Error('iterator return failure')
    /** A legal custom iterator need not serialize return with next like an async generator. */
    const iterator = {
      [Symbol.asyncIterator]() {
        return this
      },
      next: () => next.promise,
      return: () => Promise.reject(primary)
    }
    /** Capacity must remain reserved throughout abandonment until actual consumption ends. */
    const budget = createUnitBudget({
      kind: 'coroutine',
      maxUnits: 1,
      launchRate: false,
      scheduler
    })
    /** Observer failures and cleanup errors use the supervisor's existing report channel. */
    const reports: unknown[] = []
    /** The canonical coroutine adapter owns the pending iterator. */
    const supervisor = createCoroutineSupervisor({
      id: 'audit-return',
      budget,
      scheduler,
      stop: { reapTimeoutMs: 5 },
      report: (error) => {
        reports.push(error)
      },
      spec: { task: () => iterator }
    })
    /** The handle's exited promise is the sole disappearance evidence. */
    const started = await supervisor.start()
    if (started.state !== 'ready') throw new Error('fixture failed to start')
    /** Records actual exited fulfillment while the pending next remains held. */
    let exited = false
    void started.unit.exited.then(() => {
      exited = true
    })
    /** Bounded stop can finish without pretending the task already exited. */
    const stopping = supervisor.stop()
    try {
      await flush()
      scheduler.advance(5)
      await stopping
      expect(exited).toBe(false)
      expect(budget.inUse).toBe(1)
      expect(reports).toContain(primary)
    } finally {
      next.resolve({ done: true, value: undefined })
      expect(await started.unit.exited).toEqual({ outcome: 'rejected', error: primary })
      await flush()
      await stopping
      await supervisor.dispose()
      budget.close()
    }
    expect(budget.inUse).toBe(0)
  })
})
