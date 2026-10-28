import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import type { IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { processPlugin } from '../../src/index.ts'
import {
  MemoryProcess,
  FailureProcess,
  FlushObserver,
  execution,
  findProcessError,
  nextTurn
} from '../fixtures.ts'

/** Same-source scheduler snapshots remain one compatible process time domain. */
async function sameScheduler(): Promise<void> {
  /** The exact process identity owns one shared listener set. */
  const process = new MemoryProcess()
  /** Both hosts borrow one canonical source scheduler. */
  const scheduler = createManualScheduler()
  /** A real plugin counts the first host's flush callback. */
  const observer = new FlushObserver()
  /** First group member establishes scheduler and policy compatibility. */
  const first = createLogHost({
    execution,
    scheduler,
    plugins: [processPlugin({ process }), observer]
  })
  /** A second same-source member must not create another native listener. */
  const second = createLogHost({ execution, scheduler, plugins: [processPlugin({ process })] })
  expect(process.listeners.get('SIGINT')?.size).toBe(1)
  await first.flush()
  expect(observer.count).toBe(1)
  await second.unUse('process')
  await first.unUse('process')
  await first.shutdown('manual')
  await second.shutdown('manual')
}
it('accepts two cores from one injected scheduler source despite separate snapshots', sameScheduler)

/** Different scheduler domains are refused before they can retain another process-group member. */
async function differentScheduler(): Promise<void> {
  /** Only one native capability is involved in the conflict. */
  const process = new MemoryProcess()
  /** The first source establishes the group's timing domain. */
  const firstScheduler = createManualScheduler()
  /** A separately owned manual source must not be treated as the same domain. */
  const secondScheduler = createManualScheduler()
  /** The original host's flusher remains usable after the failed installation. */
  const observer = new FlushObserver()
  /** The first member acquires the group's listeners. */
  const first = createLogHost({
    execution,
    scheduler: firstScheduler,
    plugins: [processPlugin({ process }), observer]
  })
  /** Exact callback identities must not change on rejected admission. */
  const before = [...(process.listeners.get('SIGINT') ?? [])]
  /** The original wrapped error remains visible after a synchronous failed construction. */
  let failure: unknown
  try {
    createLogHost({ execution, scheduler: secondScheduler, plugins: [processPlugin({ process })] })
  } catch (error) {
    failure = error
  }
  expect(findProcessError(failure, 'PLUGIN_CONFIG_CONFLICT')).toMatchObject({
    source: 'logging.process',
    code: 'PLUGIN_CONFIG_CONFLICT'
  })
  expect([...(process.listeners.get('SIGINT') ?? [])]).toEqual(before)
  await first.flush()
  expect(observer.count).toBe(1)
  await first.unUse('process')
  /** Once the last original member leaves, a new scheduler domain can own the process. */
  const replacement = createLogHost({
    execution,
    scheduler: secondScheduler,
    plugins: [processPlugin({ process })]
  })
  expect(process.listeners.get('SIGINT')?.size).toBe(1)
  await replacement.unUse('process')
  await first.shutdown('manual')
  await replacement.shutdown('manual')
}
it('rejects a different scheduler domain before adding the second core', differentScheduler)

/** The old option-spread admission fixture retains its one getter read. */
async function sourceReadOnce(): Promise<void> {
  /** The source is reused rather than reconstructed by the getter. */
  const scheduler = createManualScheduler()
  /** The original count must remain one. */
  let reads = 0
  /** This getter is evaluated by the same option spread as the legacy use. */
  const options = {
    get scheduler() {
      reads++
      return scheduler
    }
  }
  /** A borrowed process retains its normal structural methods. */
  const process = new MemoryProcess()
  /** The supported public option path remains observable without a removed facade scheduler field. */
  const logger = createLogHost({ execution, ...options, plugins: [processPlugin({ process })] })
  expect(reads).toBe(1)
  await logger.unUse('process')
  await logger.shutdown('manual')
}
it(
  'keeps scheduler source admission single-read while preserving the source domain',
  sourceReadOnce
)

/** A partially registered native listener must be removed even when on() then throws. */
async function storedListenerRollback(): Promise<void> {
  /** The exact native installation error remains on the peer wrapper's cause. */
  const primary = new Error('process-on')
  /** The native capability deliberately stores the callback before throwing. */
  const process = new FailureProcess()
  process.installEvent = 'beforeExit'
  process.installFailure = primary
  process.storeBeforeFailure = true
  /** Retain the actual synchronous installation failure. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [processPlugin({ process })] })
  } catch (error) {
    failure = error
  }
  expect((failure as Error).cause).toBe(primary)
  expect([...process.listeners.values()].every(emptyGroup)).toBe(true)
  process.installEvent = undefined
  /** Reinstallation must not inherit failed-attempt callbacks or stale group state. */
  const reinstall = createLogHost({ execution, plugins: [processPlugin({ process })] })
  await reinstall.unUse('process')
  expect([...process.listeners.values()].every(emptyGroup)).toBe(true)
  await reinstall.shutdown('manual')
}
it(
  'rolls back a ProcessPlugin listener stored before runtimeProcess.on throws',
  storedListenerRollback
)

/** A rollback that removes ownership and then throws still retains primary-first error order. */
async function storedRollbackFailure(): Promise<void> {
  /** Installation primary and rollback secondary remain distinct original instances. */
  const primary = new Error('process-primary')
  /** Native cleanup reports failure after it released the actual registration. */
  const rollback = new Error('process-rollback')
  /** Both hostile boundaries are configured on the real injected process shape. */
  const process = new FailureProcess()
  process.installEvent = 'beforeExit'
  process.installFailure = primary
  process.storeBeforeFailure = true
  process.removeBeforeFailure = true
  process.removalFailures.set('SIGTERM', rollback)
  /** Preserve the actual canonical peer failure instead of reconstructing a receipt. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [processPlugin({ process })] })
  } catch (error) {
    failure = error
  }
  /** The process-owned aggregate remains nested under the peer install boundary. */
  const installFailure = (failure as Error).cause as AggregateError
  expect(installFailure).toMatchObject({
    source: 'logging.process',
    code: 'PROCESS_INSTALL_ROLLBACK_FAILED'
  })
  expect(installFailure.errors).toEqual([primary, rollback])
  expect([...process.listeners.values()].every(emptyGroup)).toBe(true)
  process.installEvent = undefined
  process.removalFailures.clear()
  /** A new installation proves the failed group was reset. */
  const reinstall = createLogHost({ execution, plugins: [processPlugin({ process })] })
  await reinstall.unUse('process')
  expect([...process.listeners.values()].every(emptyGroup)).toBe(true)
  await reinstall.shutdown('manual')
}
it(
  'preserves ProcessPlugin install primary plus rollback failure and resets for reinstall',
  storedRollbackFailure
)

/** The original listener-count assertion inspects each independent event group. */
function emptyGroup(group: Set<(...args: unknown[]) => void>): boolean {
  return group.size === 0
}

/** A synchronous scheduler callback still returns a receipt that the process owner must cancel. */
class SyncScheduler implements IScheduler {
  /** Every admitted task is retained with its original timeout value. */
  readonly schedules: Array<{ delayMs: number; task: { cancel: ReturnType<typeof vi.fn> } }> = []
  /** One fixed clock keeps all timeout races deterministic. */
  now(): number {
    return 0
  }
  /** Invoke before returning, reproducing the original scheduler ownership failure mode. */
  schedule(callback: () => void, delayMs: number) {
    callback()
    /** The original returned receipt must be cancelled even though the callback already ran. */
    const task = { cancel: vi.fn() }
    this.schedules.push({ delayMs, task })
    return task
  }
}

/** Returned timeout ownership survives a scheduler that calls back synchronously. */
async function synchronousTimeoutTask(): Promise<void> {
  /** This source invokes every admitted callback before returning its receipt. */
  const scheduler = new SyncScheduler()
  /** The process event triggers one bounded beforeExit flush. */
  const process = new MemoryProcess()
  /** Explicit process budget isolates the task from other host deadlines. */
  const logger = createLogHost({
    execution,
    scheduler,
    plugins: [processPlugin({ process, shutdownTimeoutMs: 10 })]
  })
  process.fire('beforeExit')
  await nextTurn()
  await logger.unUse('process')
  /** Select only the process's ten-millisecond timeout task. */
  const timeoutTask = scheduler.schedules.find(processTimeout)?.task
  expect(timeoutTask?.cancel).toHaveBeenCalledOnce()
  await logger.shutdown('manual')
}

/** The explicit process budget distinguishes this task from host-owned deadlines. */
function processTimeout(task: { delayMs: number }): boolean {
  return task.delayMs === 10
}
it(
  'cancels a synchronous ProcessPlugin timeout handle after callback return',
  synchronousTimeoutTask
)
