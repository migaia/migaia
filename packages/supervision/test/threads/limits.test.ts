import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import {
  createThreadSupervisor,
  ThreadUnitKind,
  type IThreadSpec
} from '../../src/threads/index.js'
import { memoryThreadLauncher, settle, threadSpec } from './support/memory-thread-launcher.js'

describe('A5 thread limits and A6 exit observation', () => {
  it('admits only capabilities the launcher can enforce', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher({
      termination: 'enforced',
      'fault-isolation': 'unsupported',
      'heap-limit': 'unsupported',
      'exit-observation': 'enforced'
    })
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 2, scheduler })
    const make = (spec: IThreadSpec, extra: Record<string, unknown> = {}) =>
      createThreadSupervisor({
        id: 'limits',
        spec,
        launcher,
        budget,
        scheduler,
        report: () => undefined,
        ...extra
      })
    expect(() => make({ entry: 'x', limits: { heapBytes: 1_048_576 } })).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.capabilityUnsupported,
        detail: expect.objectContaining({
          capability: 'heap-limit',
          level: 'unsupported',
          kind: 'thread'
        })
      })
    )
    const normal = make(threadSpec())
    expect(normal.inspect().state).toBe('idle')
    await normal.dispose()
    const reports: unknown[] = []
    const degraded = make(
      { entry: 'x', limits: { heapBytes: 1_048_576 } },
      {
        isolation: 'best-effort',
        report: (error: unknown) => {
          reports.push(error)
        }
      }
    )
    expect(degraded.inspect().degraded).toContain('heap-limit')
    await degraded.start()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ code: SupervisionErrorCode.capabilityUnsupported })
    await degraded.dispose()
    expect(() => make(threadSpec(), { requires: ['fault-isolation'] })).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.capabilityUnsupported,
        detail: expect.objectContaining({ capability: 'fault-isolation' })
      })
    )
    expect(launcher.handles).toHaveLength(1)
  })

  it('rejects invalid declarations and specifications before launch', () => {
    const scheduler = createManualScheduler()
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const make = (spec: IThreadSpec, capabilities = memoryThreadLauncher().capabilities) => {
      const launcher = memoryThreadLauncher(capabilities)
      return {
        launcher,
        create: () =>
          createThreadSupervisor({
            id: 'invalid',
            spec,
            launcher,
            budget,
            scheduler,
            report: () => undefined
          })
      }
    }
    const missingTermination = make(threadSpec(), { 'exit-observation': 'enforced' })
    expect(missingTermination.create).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.capabilityUnsupported,
        detail: expect.objectContaining({ capability: 'termination' })
      })
    )
    const overclaim = make(threadSpec(), {
      'heap-limit': 'monitored',
      'exit-observation': 'enforced'
    })
    expect(overclaim.create).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'launcher.capabilities' })
      })
    )
    for (const heapBytes of [0, -1, NaN]) {
      const invalid = make({ entry: 'x', limits: { heapBytes } })
      expect(invalid.create).toThrowError(
        expect.objectContaining({
          code: SupervisionErrorCode.invalidOption,
          detail: expect.objectContaining({ field: 'spec.limits.heapBytes' })
        })
      )
    }
    for (const entry of ['', 12 as never]) {
      const invalid = make({ entry })
      expect(invalid.create).toThrowError(
        expect.objectContaining({
          code: SupervisionErrorCode.invalidOption,
          detail: expect.objectContaining({ field: 'spec.entry' })
        })
      )
    }
  })

  it('forwards positive limits and reports the original OOM error', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher()
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const spec = { entry: './task.js', limits: { heapBytes: 1_048_576, callWallTimeMs: 50 } }
    const supervisor = createThreadSupervisor({
      id: 'oom',
      spec,
      launcher,
      budget,
      scheduler,
      report: () => undefined
    })
    await supervisor.start()
    expect(launcher.specs[0]).toBe(spec)
    const oom = new Error('out of memory')
    const stack = oom.stack
    launcher.handles[0]!.complete({ code: 1, limit: 'heapBytes', error: oom })
    await settle()
    expect(supervisor.inspect().lastExit?.reason).toBe('resource-violation')
    const error = supervisor.inspect().lastExit?.error as Error & {
      code: string
      detail: { limit: string }
    }
    expect(error.code).toBe(SupervisionErrorCode.resourceLimitExceeded)
    expect(error.detail.limit).toBe('heapBytes')
    expect(error.cause).toBe(oom)
    expect(oom).not.toHaveProperty('source')
    expect(oom).not.toHaveProperty('code')
    expect(oom.stack).toBe(stack)
    scheduler.advance(250)
    await settle()
    expect(launcher.handles).toHaveLength(2)
    await supervisor.dispose()
  })

  it('requires health when actual exit cannot be observed', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher({
      termination: 'enforced',
      'fault-isolation': 'unsupported',
      'heap-limit': 'unsupported',
      'exit-observation': 'unsupported'
    })
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const base = {
      id: 'health',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined
    }
    expect(() => createThreadSupervisor(base)).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'health' })
      })
    )
    const missing = memoryThreadLauncher({ termination: 'enforced' })
    expect(() => createThreadSupervisor({ ...base, launcher: missing })).toThrowError(
      expect.objectContaining({ code: SupervisionErrorCode.invalidOption })
    )
    expect(launcher.handles).toHaveLength(0)
    const signals: Array<{ readonly aborted: boolean }> = []
    const supervisor = createThreadSupervisor({
      ...base,
      health: {
        intervalMs: 5_000,
        timeoutMs: 2_000,
        failureThreshold: 3,
        check: (_handle, signal) => {
          signals.push(signal)
          return new Promise<void>(() => undefined)
        }
      }
    })
    await supervisor.start()
    for (let index = 0; index < 3; index++) {
      scheduler.advance(index === 0 ? 5_000 : 3_000)
      await settle()
      scheduler.advance(2_000)
      await settle()
    }
    expect(signals).toHaveLength(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(launcher.handles[0]?.terminations).toBe(1)
    expect(supervisor.inspect().lastExit?.reason).toBe('unhealthy')
    const error = supervisor.inspect().lastExit?.error as Error & {
      code: string
      detail: { timedOut: boolean; kind: string }
    }
    expect(error.code).toBe(SupervisionErrorCode.unhealthy)
    expect(error.detail).toMatchObject({ timedOut: true, kind: 'thread' })
    await supervisor.dispose()
  })

  it('rejects an unsupported replacement limit without stopping the serving thread', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryThreadLauncher({
      termination: 'enforced',
      'fault-isolation': 'unsupported',
      'heap-limit': 'unsupported',
      'exit-observation': 'enforced'
    })
    const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 1, scheduler })
    const supervisor = createThreadSupervisor({
      id: 'replace-limit',
      spec: threadSpec(),
      launcher,
      budget,
      scheduler,
      report: () => undefined
    })
    await supervisor.start()
    const result = await supervisor.replace({
      spec: { entry: './next.js', limits: { heapBytes: 1_048_576 } }
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed')
      expect(result.error).toMatchObject({ code: SupervisionErrorCode.capabilityUnsupported })
    expect(launcher.handles[0]?.terminations).toBe(0)
    expect(supervisor.inspect().state).toBe('ready')
    await supervisor.dispose()
  })
})
