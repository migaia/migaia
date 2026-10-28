import { expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createLogHost, type ILogPluginCore, type ILogFailure } from '../../src/index.ts'
import { CapturePlugin, execution, messages, nextTurn } from './fixtures.ts'

/** An explicit clock owner changes failure state only after construction/admission has completed. */
class AuditClock {
  /** The original error must remain reachable through the runtime report and disposal receipt. */
  readonly failure = new Error('shutdown clock failed')
  /** Test-controlled failure admission preserves the original synchronous timing scenario. */
  failing = false
  /** Clock reads keep the actual scheduler receiver and current fixture state. */
  readonly now = (): number => {
    if (this.failing) throw this.failure
    return 0
  }
  /** No timer callback is needed when this fixture's clock failure stops draining. */
  readonly schedule = () => ({ cancel: ignore })
}
/** An inert diagnostic callback keeps assertions independent of console output. */
function ignore(): void {}

/** Physical cleanup is observed separately from the public terminal completion. */
class AuditCleanupPlugin {
  /** The real registration owns this fixture's cleanup. */
  readonly name = 'owned'
  /** Counts actual physical releases, independently of shutdown callers. */
  disposed = 0
  /** Optional cleanup failure must remain reachable together with the clock primary. */
  readonly failure = new Error('cleanup failed')
  /** Selected failure behavior is fixed before plugin admission. */
  #fails: boolean
  /** Capture this case's cleanup outcome without allocating a separate host layer. */
  constructor(fails: boolean) {
    this.#fails = fails
  }
  /** Register an actual peer-owned cleanup action before terminal work begins. */
  install(core: ILogPluginCore): Record<string, never> {
    core.onDispose(() => this.runCleanup())
    return {}
  }
  /** Run physical cleanup exactly once, optionally returning its original failure. */
  runCleanup(): void {
    this.disposed++
    if (this.#fails) throw this.failure
  }
}

/**
 * Clock failures are reported and included in the fulfilled terminal receipt without skipping
 * cleanup.
 */
async function shutdownClockFailure(cleanupFails: boolean): Promise<void> {
  /** Clock state is toggled only for the actual public shutdown admission read. */
  const clock = new AuditClock()
  /** The peer still owns cleanup even if the clock fails before handlers run. */
  const plugin = new AuditCleanupPlugin(cleanupFails)
  /**
   * Failure events retain original logging semantic identity after the nonrejecting behavior
   * change.
   */
  const failures: ILogFailure[] = []
  /** The real scheduler snapshot captures callable capabilities before state is changed. */
  const host = createLogHost({ execution, scheduler: clock, report: ignore, plugins: [plugin] })
  host.onFailure((failure) => {
    failures.push(failure)
  })
  clock.failing = true
  /** Shutdown must publish one settling Promise rather than throwing outside its completion. */
  let pending: ReturnType<typeof host.shutdown> | undefined
  expect(() => {
    pending = host.shutdown('manual')
  }).not.toThrow()
  clock.failing = false
  /** The approved nonrejecting boundary keeps runtime failure evidence in this structured result. */
  const result = await pending!
  expect(result.logicalTerminal).toBe(true)
  expect(failures[0].error).toMatchObject({ source: 'logging', code: 'INVALID_OPTION' })
  expect([...walkErrorCauses(failures[0].error)]).toContain(clock.failure)
  /** Every receipt error is traversed without dropping the original cleanup failure. */
  const reachable: unknown[] = []
  for (const error of result.cleanupErrors)
    for (const cause of walkErrorCauses(error)) reachable.push(cause)
  expect(reachable).toContain(clock.failure)
  if (cleanupFails) expect(reachable).toContain(plugin.failure)
  expect(plugin.disposed).toBe(1)
  expect(host.shutdown('manual')).toBe(pending)
}

/** The deleted raw entry is absent while the supported final structured log still reaches its sink. */
async function finalStructuredLog(): Promise<void> {
  /** Actual sink observation preserves the original final-log business assertion. */
  const capture = new CapturePlugin()
  /** The frozen facade deliberately exposes no removed raw-output channel. */
  const host = createLogHost({ execution, plugins: [capture] })
  expect(host).not.toHaveProperty('raw')
  host.onShutdown(() => host.log('info', 'final structured'))
  await host.shutdown('manual')
  expect(messages(capture.entries)).toEqual(['final structured'])
}

/** A terminal reporter owner can fail synchronously or with a rejected Promise. */
class TerminalReporter {
  /** One original terminal failure identifies the forbidden host-rethrow path. */
  readonly failure = new Error('terminal reporter failed')
  /** Actual reporter calls must not recursively grow when the reporter itself fails. */
  calls = 0
  /** The selected failure shape is fixed before business logging begins. */
  #kind: 'sync' | 'async'
  /** Capture which original terminal branch is under observation. */
  constructor(kind: 'sync' | 'async') {
    this.#kind = kind
  }
  /** Return the real rejection instead of making a test wrapper absorb it first. */
  readonly report = (): void | Promise<void> => {
    this.calls++
    if (this.#kind === 'async') return Promise.reject(this.failure)
    throw this.failure
  }
}
/** Both terminal reporter branches explicitly avoid the deleted queue-based host-rethrow behavior. */
async function terminalReporterFailure(kind: 'sync' | 'async'): Promise<void> {
  /** Captured callbacks would expose any remaining host-rethrow path. */
  const callbacks: Array<() => void> = []
  /** This spy observes only the previous explicit terminal diagnostic queue. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    callbacks.push(callback)
  })
  /** The real user reporter returns/throws its original failure shape. */
  const reporter = new TerminalReporter(kind)
  /** Business sink failure remains separate from terminal reporter failure. */
  const capture = new CapturePlugin({ sinks: [throwBusinessSink] })
  /** No failure listener is present, so the actual direct-report branch is exercised. */
  const host = createLogHost({ execution, report: reporter.report, plugins: [capture] })
  try {
    expect(() => host.log('info', 'entry')).not.toThrow()
    await expect(host.flush()).resolves.toBeUndefined()
    await nextTurn()
    expect(callbacks).toHaveLength(0)
    expect(reporter.calls).toBe(1)
    await expect(host.shutdown('manual')).resolves.toMatchObject({ logicalTerminal: true })
  } finally {
    queue.mockRestore()
  }
}
/** One synchronous original sink failure exercises the standard business-containment path. */
function throwBusinessSink(): never {
  throw new Error('business sink failed')
}

it.each([false, true])(
  'settles the shared shutdown and disposes after clock failure (cleanup failure: %s)',
  shutdownClockFailure
)
it('ignores removed raw entry while allowing final structured logs', finalStructuredLog)
it.each(['sync', 'async'] as const)(
  'contains %s terminal reporter failure without the retired host queue',
  terminalReporterFailure
)
