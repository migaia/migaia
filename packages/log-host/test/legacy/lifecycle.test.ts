import { expect, it } from 'vitest'
import { createLogHost, forwardPlugin, type ILogPlugin, type ILogFailure } from '../../src/index.ts'
import { CapturePlugin, Deferred, execution, messages, microtasks } from './fixtures.ts'

/** Async queue admission must preserve the old entry-container snapshots. */
async function entrySnapshots(): Promise<void> {
  /** A real sink receives each owner-created shallow snapshot. */
  const capture = new CapturePlugin()
  /** The producer uses only the supported public entry methods. */
  const logger = createLogHost({ execution, plugins: [capture] })
  /** Later array mutation must not alter an already admitted log call. */
  const args: unknown[] = [{ consoleOnly: true }]
  /** Later data mutation must not alter an already admitted raw entry. */
  const data = { requestId: 'one' }
  logger.log('info', 'console', ...args)
  logger.dispatchRaw({ tag: 'info', message: 'structured', meta: { userId: 'u1' }, data })
  args.push('later')
  data.requestId = 'two'
  await logger.flush()
  expect(capture.entries[0]?.meta).toBeUndefined()
  expect(capture.entries[0]?.args).toEqual([{ consoleOnly: true }])
  expect(capture.entries[1]?.meta).toEqual({ userId: 'u1' })
  expect(capture.entries[1]?.data).toEqual({ requestId: 'one' })
  await logger.shutdown('manual')
}
it(
  'keeps console arguments separate from explicit meta and snapshots sink containers',
  entrySnapshots
)

/** One self-removing sink must not skip the following live subscriptions. */
async function removeDuringDelivery(): Promise<void> {
  /** Call order is the independent oracle for snapshot-safe subscription traversal. */
  const called: string[] = []
  /** The first callback removes its own registration during delivery. */
  const capture = new CapturePlugin({
    sinks: [
      () => {
        called.push('a')
        capture.removals[0]()
      },
      () => {
        called.push('b')
      },
      () => {
        called.push('c')
      }
    ]
  })
  /** All callbacks are installed before producer admission. */
  const logger = createLogHost({ execution, plugins: [capture] })
  logger.log('t', 'x')
  await logger.flush()
  expect(called).toEqual(['a', 'b', 'c'])
  await logger.shutdown('manual')
}
it('#sinks 是活数组，splice 使 for...of 漏项', removeDuringDelivery)

/** Both entry methods retain final-work admission during the shutdown-handler phase. */
async function finalStructuredEntry(): Promise<void> {
  /** The fixture records business entries independently of the shutdown state. */
  const capture = new CapturePlugin()
  /** Final handlers may use the ordinary structured log method. */
  const logger = createLogHost({ execution, plugins: [capture] })
  logger.onShutdown(() => {
    logger.log('t', 'dispatch-during-shutdown')
  })
  await logger.shutdown('manual')
  expect(messages(capture.entries)).toContain('dispatch-during-shutdown')
}
it('两条入口对同一状态的判定不一致', finalStructuredEntry)

/** A shared flush Promise waits on its initial work and remains harmless after shutdown. */
async function concurrentFlush(): Promise<void> {
  /** A controlled sink leaves business delivery unfinished until the test explicitly releases it. */
  const controlled = new Deferred()
  /** The old sent-message assertion remains independent of host pending internals. */
  const sent: string[] = []
  /** A named callback owner avoids nesting a Promise executor inside a sink callback. */
  const sink = new ControlledSink(controlled, sent)
  /** The real installation owns sink registration. */
  const capture = new CapturePlugin({ sinks: [(entry) => sink.receive(entry.message)] })
  /** The host's public barrier is the subject of the identity assertion. */
  const logger = createLogHost({ execution, plugins: [capture] })
  logger.log('info', 'before')
  /** Concurrent callers must receive this exact Promise. */
  const first = logger.flush()
  /** A second call joins the same operation instead of allocating another wait. */
  const second = logger.flush()
  expect(second).toBe(first)
  await microtasks()
  controlled.resolve()
  await first
  await logger.shutdown('manual')
  logger.log('info', 'after')
  await logger.flush()
  expect(sent).toEqual(['before'])
}
it('shares concurrent flush work and ignores entries after shutdown', concurrentFlush)

/** One controlled sink appends only after its original asynchronous work fulfills. */
class ControlledSink {
  /** The fixture owns fulfillment independently of the host. */
  #controlled: Deferred
  /** Delivered business messages are supplied by the surrounding case. */
  #sent: string[]
  /** Capture the controlled operation and its observation array. */
  constructor(controlled: Deferred, sent: string[]) {
    this.#controlled = controlled
    this.#sent = sent
  }
  /** Keep the old asynchronous sink ordering without adding an alternative host path. */
  async receive(message: string): Promise<void> {
    await this.#controlled.promise
    this.#sent.push(message)
  }
}

/** Rejected sink work remains observable without throwing into producer code. */
async function rejectedSink(): Promise<void> {
  /** Failure provenance is the same assertion used by the original real sink test. */
  const failures: string[] = []
  /** The original rejection remains the only failed operation. */
  const primary = new Error('sink failed')
  /** The sink itself returns a rejected Promise, exercising asynchronous observation. */
  const capture = new CapturePlugin({ sinks: [() => Promise.reject(primary)] })
  /** Listener-based reporting keeps the diagnostic inside the business-visible failure channel. */
  const logger = createLogHost({ execution, plugins: [capture] })
  logger.onFailure((failure) => {
    failures.push(failure.source)
  })
  expect(() => logger.log('info', 'message')).not.toThrow()
  await logger.flush()
  expect(failures).toEqual(['sink'])
  await logger.shutdown('manual')
}
it('reports rejected sink work without rejecting business dispatch', rejectedSink)

/** Repeated terminal calls retain the first requested shutdown reason and exact Promise. */
async function concurrentShutdown(): Promise<void> {
  /** The ordered callback list exposes whether another shutdown pass was started. */
  const reasons: string[] = []
  /** The observer installs its callback during the peer-owned installation window. */
  const capture = new CapturePlugin({
    shutdown: (reason) => {
      reasons.push(reason)
    }
  })
  /** Public terminal calls retain single-flight behavior. */
  const logger = createLogHost({ execution, plugins: [capture] })
  /** First trigger owns the reason for all concurrent followers. */
  const first = logger.shutdown('signal')
  /** A different later reason must not replace it. */
  const second = logger.shutdown('manual')
  expect(second).toBe(first)
  await first
  expect(reasons).toEqual(['signal'])
}
it('shares concurrent shutdown work and preserves the first reason', concurrentShutdown)

/** Handler reentrancy joins the published terminal operation rather than calling handlers twice. */
async function reentrantShutdown(): Promise<void> {
  /** The original assertion counts actual handler executions. */
  let calls = 0
  /** A reentrant call is observed only after the asynchronous handler starts. */
  let reentrantPromise: ReturnType<ReturnType<typeof createLogHost>['shutdown']> | undefined
  /** The public host supplies the only terminal operation. */
  const logger = createLogHost({ execution })
  logger.onShutdown(() => {
    calls++
    reentrantPromise = logger.shutdown('manual')
  })
  /** This Promise must be visible before a handler can reenter. */
  const outer = logger.shutdown('manual')
  await microtasks()
  expect(reentrantPromise).toBe(outer)
  await outer
  expect(calls).toBe(1)
}
it(
  'fixed: reentrant shutdown() calls alias to the same in-flight promise instead of starting a second pass',
  reentrantShutdown
)

/** A failed disposer is terminal; later producer calls cannot enter the disposed host. */
async function failedDisposalIsTerminal(): Promise<void> {
  /** Real disposal failure remains in the peer result rather than becoming a producer exception. */
  const primary = new Error('dispose-boom')
  /** A real sink proves that admission stays closed after failed cleanup. */
  const capture = new CapturePlugin()
  /** Failure listeners preserve the original count assertion. */
  const failures: ILogFailure[] = []
  /** The plugin's explicit disposer fails once under the canonical lifecycle. */
  const logger = createLogHost({
    execution,
    plugins: [
      capture,
      {
        name: 'boom',
        install: empty,
        dispose: () => {
          throw primary
        }
      }
    ]
  })
  logger.onFailure((failure) => {
    failures.push(failure)
  })
  /** Disposal returns the same structured result on every terminal call. */
  const shutdown = await logger.shutdown('manual')
  expect(shutdown.cleanupComplete).toBe(true)
  expect(shutdown.cleanupErrors.length).toBeGreaterThan(0)
  logger.log('t', 'after-failed-shutdown')
  expect(capture.entries).toEqual([])
  expect(failures).toHaveLength(0)
  /** The terminal result is retained by the shared completion Promise. */
  const repeated = await logger.shutdown('manual')
  expect(repeated).toBe(shutdown)
}
it('插件 dispose 抛错后 shutdown 返回结构化错误，且实例仍拒绝日志', failedDisposalIsTerminal)

/** A no-extension fixture keeps assertions focused on configuration and lifecycle. */
function empty(): Record<string, never> {
  return {}
}

/** Concurrent removal executes physical cleanup exactly once. */
async function concurrentRemoval(): Promise<void> {
  /** The physical cleanup count is independent of removal receipts. */
  let disposed = 0
  /** The disposer crosses one microtask so the second removal is truly concurrent. */
  const plugin: ILogPlugin = {
    name: 'serial-dispose',
    install: empty,
    async dispose() {
      disposed++
      await Promise.resolve()
    }
  }
  /** Canonical plugin-host owns both removal operations. */
  const logger = createLogHost({ execution, plugins: [plugin] })
  /** Both receipts remain visible, including the rejected duplicate request. */
  const concurrent = await Promise.allSettled([
    logger.unUse('serial-dispose'),
    logger.unUse('serial-dispose')
  ])
  expect(disposed).toBe(1)
  expect(concurrent.filter(fulfilled)).toHaveLength(1)
  expect(concurrent.filter(rejected)).toHaveLength(1)
  await expect(logger.unUse('serial-dispose')).rejects.toMatchObject({
    code: 'PLUGIN_NOT_INSTALLED'
  })
  await logger.shutdown('manual')
}
it('disposes once when unUse is concurrent', concurrentRemoval)

/** Preserve the original allSettled fulfillment classification. */
function fulfilled(value: PromiseSettledResult<unknown>): boolean {
  return value.status === 'fulfilled'
}
/** Preserve the original allSettled rejection classification. */
function rejected(value: PromiseSettledResult<unknown>): boolean {
  return value.status === 'rejected'
}

/** A failing install releases only resources actually acquired before failure. */
async function installationRollback(): Promise<void> {
  /** Resource cleanup is counted separately from a never-installed plugin's disposer. */
  let disposed = 0
  /** The peer must run the acquired onDispose callback when installation fails. */
  const plugin: ILogPlugin = {
    name: 'failed-install',
    install(core) {
      core.onDispose(() => {
        disposed++
      })
      throw new Error('install failed')
    },
    dispose() {
      disposed++
    }
  }
  /** Dynamic use follows the real public installation path. */
  const logger = createLogHost({ execution })
  await expect(logger.use(plugin)).rejects.toThrow('install failed')
  expect(disposed).toBe(1)
  await logger.shutdown('manual')
}
it('starts rollback cleanup after sync install fails', installationRollback)

/** Synchronous installation failures leave through the constructor-equivalent factory. */
function synchronousInstallFailure(): void {
  /** The install error message is unchanged by the renamed entry point. */
  const plugin: ILogPlugin = {
    name: 'constructor-failure',
    install() {
      throw new Error('constructor install failed')
    }
  }
  expect(() => createLogHost({ execution, plugins: [plugin] })).toThrow(
    'constructor install failed'
  )
}
it(
  'throws synchronous plugin installation failures from the constructor',
  synchronousInstallFailure
)

/** A synchronous factory must reject async install results before publishing a partial facade. */
function asynchronousInstallFailure(): void {
  /** This plugin deliberately returns the unsupported asynchronous constructor result. */
  const plugin: ILogPlugin<{ ready: boolean }> = {
    name: 'constructor-async',
    async install() {
      return { ready: true }
    }
  }
  /** Retain the complete thrown value for native type and nested semantic-code assertions. */
  let failure: unknown
  try {
    createLogHost({ execution, plugins: [plugin] })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect((failure as { code?: unknown }).code).toBe('PLUGIN_INSTALL_FAILED')
  /** The canonical peer's inner error identifies the rejected thenable install result. */
  const cause = (failure as { cause?: { code?: unknown } }).cause
  expect(cause?.code).toBe('INSTALL_RESULT_THENABLE')
}
it(
  'rejects async plugins in the constructor before returning a partial logger',
  asynchronousInstallFailure
)

/** A plugin that never completed install does not receive its physical dispose hook. */
async function failedAsyncInstallation(): Promise<void> {
  /** The old empty event-list assertion distinguishes rollback ownership from full installation. */
  const events: string[] = []
  /** This host starts empty and admits the failing plugin dynamically. */
  const logger = createLogHost({ execution })
  /** A never-installed explicit disposer must not execute. */
  const plugin: ILogPlugin = {
    name: 'async-failed-install',
    install() {
      throw new Error('install failed')
    },
    async dispose() {
      await Promise.resolve()
      events.push('disposed')
    }
  }
  await expect(logger.use(plugin)).rejects.toThrow('install failed')
  expect(events).toEqual([])
  await logger.shutdown('manual')
}
it('awaits async cleanup when async installation fails', failedAsyncInstallation)

/** A source flush includes asynchronous work on each real downstream forwarding host. */
async function forwardedAsyncWork(): Promise<void> {
  /** The leaf operation remains blocked until this scenario releases it explicitly. */
  const controlled = new Deferred()
  /** The real leaf sink participates in the leaf host's pending set. */
  const capture = new CapturePlugin({ sinks: [() => controlled.promise] })
  /** The acyclic three-host chain replaces the removed fluent forwarding entry point. */
  const leaf = createLogHost({ execution, plugins: [capture] })
  /** Middle draining must include the leaf rather than only its local queue. */
  const middle = createLogHost({ execution, plugins: [forwardPlugin({ targets: [leaf] })] })
  /** Source draining must include both remaining hops. */
  const root = createLogHost({ execution, plugins: [forwardPlugin({ targets: [middle] })] })
  root.log('info', 'message')
  /** The original awaited barrier remains pending until the leaf is released. */
  const flushed = root.flush()
  await microtasks()
  controlled.resolve()
  await flushed
  await root.shutdown('manual')
  await middle.shutdown('manual')
  await leaf.shutdown('manual')
}
it('drains asynchronous work forwarded through multiple extends targets', forwardedAsyncWork)
