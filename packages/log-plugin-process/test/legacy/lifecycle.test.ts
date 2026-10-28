import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { processPlugin } from '../../src/index.ts'
import {
  MemoryProcess,
  SetterProcess,
  FlushObserver,
  execution,
  findProcessError,
  nextTurn
} from '../fixtures.ts'

/** Final cleanup preserves frozen/sealed/primitive failures and attempts every listener removal. */
async function frozenCleanup(): Promise<void> {
  /** Frozen restoration needs a native-type wrapper without replacing its original stack. */
  const frozenRestore = Object.freeze(new TypeError('frozen-exit'))
  /** The original stack remains unchanged after wrapper creation. */
  const originalStack = frozenRestore.stack
  /** A distinct frozen listener error follows restoration in the aggregate. */
  const frozenListener = Object.freeze(new Error('frozen-listener'))
  /** A sealed native subclass must keep its runtime type. */
  const sealedListener = Object.seal(new RangeError('sealed-listener'))
  /** A non-Error object remains reachable as the exact original cause. */
  const objectThrow = Object.freeze({ marker: 'object' })
  /** Event order is fixed by the existing process integration contract. */
  const events = [
    'SIGINT',
    'SIGTERM',
    'beforeExit',
    'uncaughtException',
    'unhandledRejection'
  ] as const
  /** Every supported cleanup category retains its original position. */
  const cleanupThrows: readonly unknown[] = [
    frozenListener,
    sealedListener,
    'primitive',
    objectThrow,
    null
  ]
  /** Successful installation precedes all injected final cleanup failures. */
  const process = new SetterProcess()
  process.restoreFailure = frozenRestore
  for (let index = 0; index < events.length; index++) {
    // Exactly five fixed process events are covered, independent of runtime member count.
    process.removalFailures.set(events[index], cleanupThrows[index])
  }
  /** The interception first succeeds, distinguishing this from install rollback. */
  const first = createLogHost({
    execution,
    plugins: [processPlugin({ process, interceptProcessExit: true })]
  })
  expect([...process.listeners.keys()]).toEqual(events)
  /** Logical removal must attempt every cleanup even when earlier actions fail. */
  const failure = await first.unUse('process')
  expect(process.removalAttempts).toEqual(events)
  /** Nested cleanup order survives canonical peer receipt aggregation. */
  const tagged = findProcessError(failure, 'PLUGIN_UNINSTALL_CLEANUP_FAILED')
  /** Exit restoration is first, followed by all five event removals. */
  const cleanup = (tagged.cause as AggregateError).errors
  expect(cleanup).toHaveLength(6)
  expect(cleanup[0]).not.toBe(frozenRestore)
  expect((cleanup[0] as Error).cause).toBe(frozenRestore)
  expect(cleanup[0]).toBeInstanceOf(TypeError)
  expect(Object.getPrototypeOf(cleanup[0])).toBe(TypeError.prototype)
  expect((cleanup[0] as Error).message).toBe('logger error tagging failed')
  expect(Object.hasOwn(cleanup[0], 'stack')).toBe(true)
  expect(typeof (cleanup[0] as Error).stack).toBe('string')
  expect((cleanup[0] as Error).stack).not.toBe('')
  expect((cleanup[0] as Error).stack).not.toBe(originalStack)
  expect(frozenRestore.stack).toBe(originalStack)
  expect((cleanup[1] as Error).cause).toBe(frozenListener)
  expect(cleanup[1]).toBeInstanceOf(Error)
  expect((cleanup[2] as Error).cause).toBe(sealedListener)
  expect(cleanup[2]).toBeInstanceOf(RangeError)
  expect((cleanup[3] as Error).cause).toBe('primitive')
  expect((cleanup[4] as Error).cause).toBe(objectThrow)
  expect((cleanup[5] as Error).cause).toBeNull()
  expect(tagged).toMatchObject({
    source: 'logging.process',
    code: 'PLUGIN_UNINSTALL_CLEANUP_FAILED'
  })
  process.restoreFailure = undefined
  process.removalFailures.clear()
  process.listeners.clear()
  /** The failed group must have released ownership before a new installation starts. */
  const second = createLogHost({
    execution,
    plugins: [processPlugin({ process, interceptProcessExit: true })]
  })
  expect(process.exit).not.toBe(process.originalExit)
  await expect(second.unUse('process')).resolves.toMatchObject({ ok: true })
  expect(process.exit).toBe(process.originalExit)
  await first.shutdown('manual')
  await second.shutdown('manual')
}
it('continues frozen, sealed, primitive, and non-Error cleanup failures in order', frozenCleanup)

/** Final group removal releases listener ownership so the same process can be installed again. */
async function reinstallListeners(): Promise<void> {
  /** One exact capability is reused by successive hosts. */
  const process = new MemoryProcess()
  /** A separate real plugin records flushes from the first host. */
  const observer = new FlushObserver()
  /** First membership owns the initial event subscriptions. */
  const first = createLogHost({ execution, plugins: [processPlugin({ process }), observer] })
  expect(process.listeners.get('SIGINT')?.size).toBe(1)
  process.fire('beforeExit')
  process.fire('beforeExit')
  await nextTurn()
  expect(observer.count).toBe(1)
  await first.unUse('process')
  expect(process.listeners.get('SIGINT')?.size).toBe(0)
  /** The next installation must acquire fresh listeners without an obsolete group. */
  const second = createLogHost({ execution, plugins: [processPlugin({ process })] })
  expect(process.listeners.get('SIGINT')?.size).toBe(1)
  await second.unUse('process')
  await first.shutdown('manual')
  await second.shutdown('manual')
}
it('reinstalls process listeners after the final process plugin is removed', reinstallListeners)

/** Detached intercepted exit preserves its captured original receiver and exact identity on removal. */
async function interceptExit(): Promise<void> {
  /** The borrowed method records calls without ending the test runner. */
  const process = new SetterProcess()
  /** One flusher proves the intercepted call waits for the actual host drain. */
  const observer = new FlushObserver()
  /** Interception remains an explicit opt-in with its existing fifty-millisecond budget. */
  const first = createLogHost({
    execution,
    plugins: [
      processPlugin({ process, interceptProcessExit: true, shutdownTimeoutMs: 50 }),
      observer
    ]
  })
  /** The detached wrapper must still supply the original process receiver. */
  const interceptedExit = process.exit
  expect(interceptedExit).not.toBe(process.originalExit)
  interceptedExit(23)
  await nextTurn()
  expect(process.exits).toEqual([23])
  expect(process.exitReceivers).toEqual([process])
  expect(observer.count).toBe(1)
  await first.unUse('process')
  expect(process.exit).toBe(process.originalExit)
  /** Reinstallation captures the original again instead of capturing its own old wrapper. */
  const second = createLogHost({
    execution,
    plugins: [processPlugin({ process, interceptProcessExit: true, shutdownTimeoutMs: 50 })]
  })
  expect(process.exit).not.toBe(process.originalExit)
  process.exit(24)
  await nextTurn()
  expect(process.exits).toEqual([23, 24])
  expect(process.exitReceivers).toEqual([process, process])
  await second.unUse('process')
  expect(process.exit).toBe(process.originalExit)
  await first.shutdown('manual')
  await second.shutdown('manual')
}
it(
  'intercepts exit with the captured function and receiver, then restores exact identity',
  interceptExit
)

/** Committing a wrapper before a setter throws still obligates exact restoration during rollback. */
async function setterCommitRollback(): Promise<void> {
  /** A one-shot wrap failure leaves restoration itself available. */
  const process = new SetterProcess()
  process.wrapFailure = new Error('exit-setter-after-commit')
  process.failWrapOnce = true
  expect(() =>
    createLogHost({ execution, plugins: [processPlugin({ process, interceptProcessExit: true })] })
  ).toThrow('exit-setter-after-commit')
  expect(process.exit).toBe(process.originalExit)
  /** A later successful install proves the failed group is no longer retained. */
  const reinstall = createLogHost({ execution, plugins: [processPlugin({ process })] })
  expect(process.exit).toBe(process.originalExit)
  await reinstall.unUse('process')
  await reinstall.shutdown('manual')
}
it(
  'restores exit after a setter commits the wrapper and then throws during install rollback',
  setterCommitRollback
)

/** Restoration and listener rollback errors follow the original install primary without replacement. */
function setterRollbackFailures(): void {
  /** The exact installation primary must remain first. */
  const primary = new Error('exit-wrapper-commit-failed')
  /** Exit restoration happens before listener cleanup. */
  const restoration = new Error('exit-restore-failed')
  /** Listener cleanup contributes a distinct final failure. */
  const listener = new Error('listener-rollback-failed')
  /** The setter stores every value before throwing the selected error. */
  const process = new SetterProcess()
  process.wrapFailure = primary
  process.restoreFailure = restoration
  process.removalFailures.set('SIGTERM', listener)
  /** Retain the factory's actual wrapped installation error. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [processPlugin({ process, interceptProcessExit: true })] })
  } catch (error) {
    failure = error
  }
  /** The process-owned aggregate stays under the peer boundary unchanged. */
  const aggregate = (failure as Error).cause as AggregateError
  expect(aggregate.errors).toEqual([
    expect.objectContaining({ message: 'exit-wrapper-commit-failed' }),
    restoration,
    expect.objectContaining({ message: 'listener-rollback-failed' })
  ])
  expect(aggregate.errors[0]).toBe(primary)
  expect(aggregate.errors[1]).toBe(restoration)
  expect(aggregate.errors[2]).toBe(listener)
}
it(
  'joins exit restoration failure with listener rollback errors without replacing install primary',
  setterRollbackFailures
)
