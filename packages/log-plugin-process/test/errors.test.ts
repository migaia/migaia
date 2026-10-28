import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import type { IScheduler } from '@migaia/utils/scheduler'
import { processPlugin } from '../src/index.ts'
import {
  MemoryProcess,
  FailureProcess,
  SetterProcess,
  execution,
  findProcessError,
  nextTurn
} from './fixtures.ts'

/** The same process refuses new members while its current shutdown is still in flight. */
async function shuttingDownAdmission(): Promise<void> {
  /** The process is borrowed directly, so all hosts address the same ownership group. */
  const process = new MemoryProcess()
  /** First installation owns the listener set before the signal arrives. */
  const first = createLogHost({ execution, plugins: [processPlugin({ process })] })
  process.fire('SIGINT')
  /** Factory failure remains a canonical peer install error with a process-owned cause. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [processPlugin({ process })] })
  } catch (error) {
    failure = error
  }
  /** The outer peer result must not replace the process semantic identity. */
  const tagged = (failure as Error).cause
  expect(failure).toBeInstanceOf(Error)
  expect(tagged).toMatchObject({ source: 'logging.process', code: 'RUNTIME_SHUTTING_DOWN' })
  expect((tagged as Error).cause).toBeUndefined()
  await first.shutdown('manual')
  await nextTurn()
}
it(
  'RUNTIME_SHUTTING_DOWN rejects process plugin/logger installation during runtime shutdown',
  shuttingDownAdmission
)

/** Existing same-process configuration remains the sole accepted group policy. */
async function configurationConflict(): Promise<void> {
  /** Group identity is the exact injected object, not process-like structural equality. */
  const process = new MemoryProcess()
  /** The original default policy owns the current listener set. */
  const first = createLogHost({ execution, plugins: [processPlugin({ process })] })
  /** The mismatched budget is rejected before another core is retained. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [processPlugin({ process, shutdownTimeoutMs: 7 })] })
  } catch (error) {
    failure = error
  }
  /** The peer wrapper keeps the process failure on cause without rebuilding it. */
  const tagged = (failure as Error).cause
  expect(failure).toBeInstanceOf(Error)
  expect(tagged).toMatchObject({ source: 'logging.process', code: 'PLUGIN_CONFIG_CONFLICT' })
  expect((tagged as Error).cause).toBeUndefined()
  await first.shutdown('manual')
}
it('PLUGIN_CONFIG_CONFLICT rejects a second process configuration', configurationConflict)

/** A failed installation keeps its primary before rollback failure in the native aggregate. */
function rollbackFailure(): void {
  /** The exact original installation failure is the first aggregate element. */
  const primary = new Error('process-install-primary')
  /** A distinct rollback failure must remain the second element. */
  const rollback = new Error('process-install-rollback')
  /** Independent failures occur at the same event boundaries as the legacy fixture. */
  const process = new FailureProcess()
  process.installEvent = 'beforeExit'
  process.installFailure = primary
  process.removalFailures.set('SIGTERM', rollback)
  /** Read the exact error returned by the factory's canonical installation boundary. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [processPlugin({ process })] })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  /** The aggregate is retained under the peer wrapper. */
  const tagged = (failure as Error).cause
  expect(tagged).toBeInstanceOf(AggregateError)
  expect(tagged).toMatchObject({
    source: 'logging.process',
    code: 'PROCESS_INSTALL_ROLLBACK_FAILED'
  })
  expect((tagged as AggregateError).errors).toEqual([primary, rollback])
  expect((tagged as AggregateError).errors[0]).toBe(primary)
  expect((tagged as AggregateError).errors[1]).toBe(rollback)
  expect((tagged as Error).cause).toBeUndefined()
}
it('PROCESS_INSTALL_ROLLBACK_FAILED preserves primary and rollback errors', rollbackFailure)

/** Final cleanup failures remain distinct from a never-completed installation's rollback. */
async function uninstallFailure(): Promise<void> {
  /** The exact original exit-restoration failure precedes listener cleanup errors. */
  const restorationError = new Error('uninstall-exit-restore')
  /** The exact listener failure is the second ordered cause. */
  const listenerError = new Error('uninstall-listener-remove')
  /** This setter commits restoration before failing, matching the original fixture. */
  const process = new SetterProcess()
  process.restoreFailure = restorationError
  process.removalFailures.set('SIGTERM', listenerError)
  /** Interception first succeeds, so this is a real final uninstall failure. */
  const host = createLogHost({
    execution,
    plugins: [processPlugin({ process, interceptProcessExit: true })]
  })
  /** Logical removal commits while cleanup remains reported in the result. */
  const failure = await host.unUse('process')
  expect(failure).toBeDefined()
  /** Find the package-owned error through canonical peer cleanup receipts. */
  const tagged = findProcessError(failure, 'PLUGIN_UNINSTALL_CLEANUP_FAILED')
  expect(tagged).toMatchObject({
    source: 'logging.process',
    code: 'PLUGIN_UNINSTALL_CLEANUP_FAILED'
  })
  expect(tagged).not.toMatchObject({ code: 'PROCESS_INSTALL_ROLLBACK_FAILED' })
  expect((tagged.cause as AggregateError).errors).toEqual([restorationError, listenerError])
  process.restoreFailure = undefined
  process.removalFailures.clear()
  await host.shutdown('manual')
}
it(
  'PLUGIN_UNINSTALL_CLEANUP_FAILED identifies final process cleanup, not install rollback',
  uninstallFailure
)

/** A scheduler can fail cancellation of the process-owned timer without failing host drain timers. */
class CancellationScheduler implements IScheduler {
  /** Only the process's explicit budget task fails its cancel operation. */
  #failure: Error
  /** Capture the exact original cancellation failure. */
  constructor(failure: Error) {
    this.#failure = failure
  }
  /** A fixed clock leaves lifecycle timing deterministic. */
  now(): number {
    return 0
  }
  /** Return a named task owner so no nested closure hides the cancellation failure. */
  schedule(_callback: () => void, delay: number) {
    return new CancellationTask(delay === 10 ? this.#failure : undefined)
  }
}

/** One scheduler receipt either cancels successfully or throws its original error. */
class CancellationTask {
  /** The selected error remains owned by this single receipt. */
  #failure: Error | undefined
  /** Capture the receipt's controlled outcome. */
  constructor(failure: Error | undefined) {
    this.#failure = failure
  }
  /** Throw only the original injected cancellation failure. */
  cancel(): void {
    if (this.#failure) throw this.#failure
  }
}

/** Shutdown preserves cancellation primary before a subsequent exit failure. */
async function shutdownCleanupFailure(): Promise<void> {
  /** The first cleanup failure comes from the process timeout task. */
  const cancelError = new Error('shutdown-timer-cancel')
  /** Exit still runs after timer cleanup fails and contributes the second error. */
  const exitError = new Error('shutdown-exit')
  /** The fake process cannot terminate the test runner. */
  const process = new FailureProcess()
  process.exitFailure = exitError
  /** Terminal reporting is observed through the same default reporter owner as production. */
  const diagnostic = vi.spyOn(globalThis.console, 'error').mockImplementation(() => undefined)
  /** All timers share one source, with only the process budget cancellation made hostile. */
  const host = createLogHost({
    execution,
    scheduler: new CancellationScheduler(cancelError),
    plugins: [processPlugin({ process, shutdownTimeoutMs: 10 })]
  })
  try {
    process.fire('SIGINT')
    await nextTurn()
    /** The original error code is selected without flattening its ordered aggregate cause. */
    const tagged = findProcessError(diagnostic.mock.calls, 'PLUGIN_SHUTDOWN_CLEANUP_FAILED')
    expect(tagged).toMatchObject({
      source: 'logging.process',
      code: 'PLUGIN_SHUTDOWN_CLEANUP_FAILED',
      message: 'logger shutdown cleanup failed'
    })
    expect(tagged).not.toMatchObject({ code: 'PROCESS_INSTALL_ROLLBACK_FAILED' })
    expect((tagged.cause as AggregateError).errors).toEqual([cancelError, exitError])
    await host.shutdown('manual')
  } finally {
    diagnostic.mockRestore()
  }
}
it(
  'PLUGIN_SHUTDOWN_CLEANUP_FAILED preserves cancel and exit failures in order',
  shutdownCleanupFailure
)
