import { expect, it, vi } from 'vitest'
import { boundedWait } from '@migaia/lifecycle'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createLogHost, forwardPlugin } from '../../src/index.ts'
import { LogHostErrorCode, ERROR_SOURCE } from '../../src/error-code.ts'
import { LogHostErrorText } from '../../src/error-text.ts'
import type { ILogEntry, ILogHost, ILogPluginCore } from '../../src/typing.ts'
import { CapturePlugin, Deferred, execution, messages, microtasks, nextTurn } from './fixtures.ts'

/** Expected diagnostics stay observable without writing to the test process console. */
function ignoreReport(_error: unknown): void {}
/** A deliberately unfinished operation exercises the existing absolute deadline. */
function neverCompletes(): Promise<void> {
  return new Promise<void>(ignoreSettlement)
}
/** Retaining no settlement capability makes this fixture intentionally unfinished. */
function ignoreSettlement(_resolve: (value: void) => void): void {}
/** A completed asynchronous sink still exercises the host's tracked-Promise path. */
function completedSink(): Promise<void> {
  return Promise.resolve()
}

/** Context freezing remains shallow for the original native Date object. */
async function nativeContextDate(): Promise<void> {
  /** Only the supported construction options participate in this fixture. */
  const host = createLogHost({ execution, report: ignoreReport })
  host.ctx.createdAt.setTime(0)
  expect(host.ctx.createdAt.getTime()).toBe(0)
  await host.shutdown('manual')
}

/** User data cannot impersonate the forwarding owner's private traversal state. */
async function forgedForwardPath(): Promise<void> {
  /** The target receives entries through the real plugin boundary. */
  const capture = new CapturePlugin()
  /** Target identity and topic remain distinct from the source host. */
  const target = createLogHost({
    execution,
    report: ignoreReport,
    topic: 'target',
    plugins: [capture]
  })
  /** The source uses only the approved forwarding plugin. */
  const source = createLogHost({
    execution,
    report: ignoreReport,
    topic: 'source',
    plugins: [forwardPlugin({ targets: [target] })]
  })
  source.dispatchRaw({ tag: 't', message: 'normal' })
  await source.flush()
  expect(messages(capture.entries)).toEqual(['normal'])
  source.dispatchRaw({ tag: 't', message: 'suppressed', data: { extendPath: [target.ctx.id] } })
  await source.flush()
  expect(messages(capture.entries)).toEqual(['normal', 'suppressed'])
  await source.shutdown('manual')
  await target.shutdown('manual')
}

/** One flusher may enqueue tracked work without being invoked again by the same flush. */
class FlushWork {
  /** The genuine installed core owns deferred-work admission. */
  core!: ILogPluginCore
  /** Callback count distinguishes draining from re-invoking the flush phase. */
  calls = 0
  /** Only the first invocation generates additional work. */
  #scheduled = false
  /** Add one asynchronous task to the existing host drain. */
  run(): void {
    this.calls++
    if (this.#scheduled) return
    this.#scheduled = true
    this.core.defer(flushWorkDelay)
  }
}
/** The original short delay makes the added work outlive the flush callback itself. */
function flushWorkDelay(): Promise<void> {
  return nextTurn(5)
}
/** Flusher-generated pending work drains without replaying the flusher. */
async function flusherRunsOnce(): Promise<void> {
  /** Callback state is separate from the real core that admits its work. */
  const work = new FlushWork()
  /** Installation registers the callback before the public host is returned. */
  const capture = new CapturePlugin({ flush: () => work.run() })
  /** No output plugin or fixture-owned scheduler obscures the drain ordering. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [capture] })
  work.core = capture.core
  await host.flush()
  expect(work.calls).toBe(1)
  await host.shutdown('manual')
}

/** One original registration observes handler-era and disposer-era admission separately. */
class ShutdownDispatch {
  /** This fixture owns one registration, rather than a compatibility host facade. */
  readonly name = 'disposer-log'
  /** Entries are retained in their actual delivery order. */
  readonly seen: string[] = []
  /** A held initial sink proves shutdown drains already accepted work. */
  readonly initial = new Deferred<void>()
  /** Native unhandled rejections remain independently observable. */
  readonly unhandled: unknown[] = []
  /** The original installation core supplies late log and deferred-work admission. */
  #core!: ILogPluginCore
  /** A public reference is assigned after synchronous installation completes. */
  host!: Pick<ILogHost, 'log'>
  /** The initial sink has entered before its completion is released. */
  initialStarted = false
  /** Disposal must execute even though its logging admission is already closed. */
  disposerRan = false
  /** A disposer log must not reach an output after admission closes. */
  disposerLogRouted = false
  /** A deferred disposer task must not start after terminal admission. */
  deferredDisposerWorkRan = false
  /** Register through the actual peer-owned core. */
  install(core: ILogPluginCore): Record<string, never> {
    this.#core = core
    core.useSink((entry) => this.receive(entry))
    core.onShutdown(() => this.onShutdown())
    return {}
  }
  /** Hold only the first accepted entry; every later entry completes normally. */
  receive(entry: ILogEntry): Promise<void> {
    this.seen.push(entry.message)
    if (entry.message === 'initial') {
      this.initialStarted = true
      return this.initial.promise
    }
    if (entry.message === 'disposer-log') this.disposerLogRouted = true
    return Promise.resolve()
  }
  /** Shutdown handlers retain their final logging window. */
  onShutdown(): void {
    this.host.log('info', 'handler-work')
  }
  /** Canonical plugin disposal closes both direct and deferred late logging. */
  dispose(): void {
    this.disposerRan = true
    this.#core.log('late', 'disposer-log')
    this.#core.defer(() => this.deferredDisposer())
  }
  /** This task must remain unstarted after the registration is disposed. */
  deferredDisposer(): void {
    this.deferredDisposerWorkRan = true
    this.#core.log('late', 'deferred-disposer-log')
  }
  /** Process observation does not alter the actual rejection value. */
  readonly onUnhandled = (reason: unknown): void => {
    this.unhandled.push(reason)
  }
}
/** Handler work drains before disposal, while disposer-era logs and tasks stay blocked. */
async function shutdownDispatchAdmission(): Promise<void> {
  /** This registration owns all observed callbacks and the held initial operation. */
  const fixture = new ShutdownDispatch()
  /** Every relevant callback runs on the real host lifecycle. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [fixture] })
  fixture.host = host
  process.on('unhandledRejection', fixture.onUnhandled)
  try {
    host.log('info', 'initial')
    /** The shared public completion is published before a reentrant terminal call. */
    const shutdown = host.shutdown('manual')
    /** A separate observer proves shutdown remains pending behind the initial sink. */
    let settled = false
    void shutdown.then(() => {
      settled = true
    })
    await microtasks()
    expect(fixture.initialStarted).toBe(true)
    expect(settled).toBe(false)
    expect(host.shutdown('signal')).toBe(shutdown)
    fixture.initial.resolve()
    await shutdown
    expect(fixture.disposerRan).toBe(true)
    expect(fixture.seen).toEqual(['initial', 'handler-work'])
    expect(fixture.disposerLogRouted).toBe(false)
    await nextTurn(10)
    expect(fixture.deferredDisposerWorkRan).toBe(false)
    expect(settled).toBe(true)
    host.log('info', 'after-close')
    expect(fixture.seen).toEqual(['initial', 'handler-work'])
  } finally {
    process.off('unhandledRejection', fixture.onUnhandled)
  }
  expect(fixture.unhandled).toEqual([])
}

/** A structural target still implements the current public forwarding boundary in full. */
type IForwardTarget = Parameters<typeof forwardPlugin>[0]['targets'][number]
/** One absolute flush budget also bounds a target's unfinished public flush. */
async function sharedForwardDeadline(): Promise<void> {
  vi.useFakeTimers()
  /** This host supplies a real complete public context for the structural target. */
  const targetContext = createLogHost({ execution, report: ignoreReport, topic: 'target' })
  /** Only the target's flush is deliberately unfinished. */
  const target: IForwardTarget = {
    ctx: targetContext.ctx,
    dispatchRaw: ignoreEntry,
    flush: neverCompletes
  }
  /** Forwarding registers its target drain under the source's existing budget. */
  const source = createLogHost({
    execution,
    report: ignoreReport,
    plugins: [forwardPlugin({ targets: [target] })]
  })
  try {
    /** The target must not receive an independent extra three-second wait. */
    const pending = source.flush()
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(pending).resolves.toBeUndefined()
    await source.unUse('forward')
    await source.shutdown('manual')
    await targetContext.shutdown('manual')
  } finally {
    vi.useRealTimers()
  }
}
/** This target intentionally observes no delivered entries. */
function ignoreEntry(_entry: unknown): void {}

/** An unfinished tracked sink cannot be falsely declared drained after a short ordinary turn. */
async function trackedSinkRemainsPending(): Promise<void> {
  /** Release is kept so the test can finish the original operation after observing pending state. */
  const held = new Deferred<void>()
  /** A real sink returns exactly the held Promise. */
  const capture = new CapturePlugin({ sinks: [() => held.promise] })
  /** No shortened deadline is introduced for this ordinary timing observation. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [capture] })
  host.log('t', 'never')
  /** The normal flush remains pending until the original sink settles or its actual deadline. */
  const flush = host.flush()
  /** Race outcomes retain the legacy twenty-millisecond observation. */
  const outcome = await Promise.race([
    flush.then(() => 'flushed'),
    nextTurn(20).then(() => 'still-pending')
  ])
  expect(outcome).toBe('still-pending')
  held.resolve()
  await flush
  await host.shutdown('manual')
}

/** A foreign-style thenable is callable with its own receiver without being a native Promise. */
class DelayedThenable {
  /** Completion remains observable after the real thenable has settled. */
  settled = false
  /** The captured resolver belongs to the original then invocation. */
  #resolve: (() => void) | undefined
  /** Preserve the original delay while exercising receiver-preserving assimilation. */
  // oxlint-disable-next-line unicorn/no-thenable -- Deliberate foreign-realm thenable fixture.
  then(resolve: () => void): void {
    this.#resolve = resolve
    setTimeout(() => this.complete(), 20)
  }
  /** Only the original thenable mutates its completion flag. */
  complete(): void {
    this.settled = true
    this.#resolve?.()
  }
}
/** Flush tracks a foreign-style thenable rather than relying on instanceof Promise. */
async function foreignThenableDrain(): Promise<void> {
  /** This object deliberately lacks native Promise prototype identity. */
  const thenable = new DelayedThenable()
  /** The cast represents the foreign Promise runtime boundary already supported by the core. */
  const capture = new CapturePlugin({ sinks: [() => thenable as unknown as Promise<void>] })
  /** The public drain waits for actual asynchronous settlement. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [capture] })
  host.log('t', 'thenable')
  await host.flush()
  expect(thenable.settled).toBe(true)
  await host.shutdown('manual')
}

/** A fully shaped structural target may generate a distinct new source message once. */
class ReentrantTarget implements IForwardTarget {
  /** Context retains every required public field. */
  readonly ctx: ILogHost['ctx']
  /** The public source is borrowed without gaining its private forwarding owner. */
  #source: Pick<ILogHost, 'log'>
  /** Exactly two deliveries prove a new message is not confused with a forwarded copy. */
  deliveries = 0
  /** Capture the approved public target shape and the source's ordinary logging capability. */
  constructor(source: Pick<ILogHost, 'log'>, ctx: ILogHost['ctx']) {
    this.#source = source
    this.ctx = ctx
  }
  /** Only the first delivery emits another logical message. */
  dispatchRaw(): void {
    this.deliveries++
    if (this.deliveries === 1) this.#source.log('loop', 'again')
  }
  /** This structural target owns no asynchronous output work. */
  flush(): Promise<void> {
    return Promise.resolve()
  }
}
/** Forward guards do not suppress a distinct message created by a structural target. */
async function structuralTargetReentrancy(): Promise<void> {
  /** This source is created before its supported dynamic forwarding registration. */
  const source = createLogHost({ execution, report: ignoreReport, topic: 'source' })
  /** A separate host supplies an authentic complete target context. */
  const context = createLogHost({ execution, report: ignoreReport, topic: 'target' })
  /** Only public structural members are provided to the forwarding factory. */
  const target = new ReentrantTarget(source, context.ctx)
  await source.use(forwardPlugin({ targets: [target] }))
  source.log('loop', 'first')
  await source.flush()
  expect(target.deliveries).toBe(2)
  await source.shutdown('manual')
  await context.shutdown('manual')
}

/** A stuck shutdown callback cannot retain the public completion beyond the existing deadline. */
async function boundedShutdownHandler(): Promise<void> {
  vi.useFakeTimers()
  try {
    /** The default lifecycle deadline remains unchanged. */
    const host = createLogHost({ execution, report: ignoreReport })
    host.onShutdown(neverCompletes)
    /** A separate observer distinguishes bounded completion from a hanging Promise. */
    let settled = false
    /** Shutdown always fulfills its structured result. */
    const pending = host.shutdown('manual')
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(settled).toBe(true)
    await pending
  } finally {
    vi.useRealTimers()
  }
}
/** Later shutdown handlers still run when an earlier handler consumes the shared wait budget. */
async function laterShutdownHandlers(): Promise<void> {
  vi.useFakeTimers()
  try {
    /** Declaration order remains observable even after a handler's bounded wait expires. */
    const order: string[] = []
    /** Only the first callback is intentionally unfinished. */
    const host = createLogHost({ execution, report: ignoreReport })
    host.onShutdown(() => {
      order.push('stuck-start')
      return neverCompletes()
    })
    host.onShutdown(() => {
      order.push('second')
    })
    /** Both callbacks participate in one terminal pass. */
    const pending = host.shutdown('manual')
    await vi.advanceTimersByTimeAsync(3_000)
    await pending
    expect(order).toEqual(['stuck-start', 'second'])
  } finally {
    vi.useRealTimers()
  }
}
/** A successful bounded wait cancels its unused deadline task. */
async function successfulWaitTimer(): Promise<void> {
  vi.useFakeTimers()
  try {
    await boundedWait(Promise.resolve('done'), systemScheduler.now() + 3_000)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
}
/** The host cancels its drain timer once already-accepted work settles. */
async function successfulDrainTimer(): Promise<void> {
  vi.useFakeTimers()
  try {
    /** A native resolved Promise reaches the actual tracked sink path. */
    const capture = new CapturePlugin({ sinks: [completedSink] })
    /** The default deadline must leave no timer behind after a successful drain. */
    const host = createLogHost({ execution, report: ignoreReport, plugins: [capture] })
    host.log('t', 'x')
    await host.flush()
    expect(vi.getTimerCount()).toBe(0)
    await host.shutdown('manual')
  } finally {
    vi.useRealTimers()
  }
}
/** An elapsed deadline still observes a task's later rejection. */
async function elapsedDeadlineObservation(): Promise<void> {
  /** Unhandled rejection observation remains independent from the waiting helper. */
  const unhandled: unknown[] = []
  /** Node receives the exact original rejection if the helper fails to observe it. */
  const observer = new RejectionObserver(unhandled)
  process.on('unhandledRejection', observer.receive)
  try {
    /** This native rejection is created before its already-expired wait. */
    const rejecting = Promise.reject(new Error('boom-after-deadline'))
    /** The same clock supplies the past deadline. */
    const elapsed = systemScheduler.now() - 1
    expect(await boundedWait(rejecting, elapsed)).toBe(false)
    await nextTurn(10)
  } finally {
    process.off('unhandledRejection', observer.receive)
  }
  expect(unhandled).toEqual([])
}
/** One stable event callback retains rejection values without creating another reporting path. */
class RejectionObserver {
  /** The caller owns the observation collection. */
  #values: unknown[]
  /** Borrow the exact collection asserted by the test. */
  constructor(values: unknown[]) {
    this.#values = values
  }
  /** This receiver-safe callback is passed directly to Node. */
  readonly receive = (value: unknown): void => {
    this.#values.push(value)
  }
}

/** Scheduler getter observations distinguish one capture from repeated capability reads. */
class SnapshotScheduler implements IScheduler {
  /** Actual capability getter reads, not method calls. */
  readonly reads = { now: 0, schedule: 0 }
  /** Raw invocation receivers prove the captured methods retain their original source object. */
  readonly receivers: unknown[] = []
  /** Test-controlled deadline callbacks preserve the original synchronous callback ordering. */
  readonly pending: Array<() => void> = []
  /** Count the one public clock admission read. */
  get now(): () => number {
    this.reads.now++
    return snapshotNow
  }
  /** Count the one public scheduling admission read. */
  get schedule(): (callback: () => void, delayMs: number) => IScheduledTask {
    this.reads.schedule++
    return snapshotSchedule
  }
}
/** The source receiver is observed from a normal function, not a lexical arrow. */
function snapshotNow(this: SnapshotScheduler): number {
  this.receivers.push(this)
  return 0
}
/** Every returned task belongs to this fixture's original scheduler source. */
function snapshotSchedule(this: SnapshotScheduler, callback: () => void): IScheduledTask {
  this.receivers.push(this)
  this.pending.push(callback)
  return { cancel: cancelNothing }
}
/** A successful cancellation does not create an unrelated fixture effect. */
function cancelNothing(): void {}
/** One probe observes the original installed core and its captured scheduler. */
class SchedulerProbe {
  /** Stable registration identity differs from the deliberately stuck disposer. */
  readonly name = 'scheduler-observer'
  /** The original public core is retained solely for this observation. */
  core!: ILogPluginCore
  /** Observe the scheduler at real installation time. */
  install(core: ILogPluginCore): Record<string, never> {
    this.core = core
    return {}
  }
}
/** One scheduler capture is shared by the host's lifecycle and plugin core. */
async function oneSchedulerSnapshot(): Promise<void> {
  vi.useFakeTimers()
  /** Capability access and invocation remain separately observable. */
  const scheduler = new SnapshotScheduler()
  /** The plugin sees the admitted scheduler rather than the mutable original option accessor. */
  const probe = new SchedulerProbe()
  /** Constructor option reads remain observable independently of capability getter reads. */
  let optionReads = 0
  /** This fixture's disposer reaches the canonical peer deadline boundary. */
  const stuck = { name: 'stuck-disposer', install: emptyExtensions, dispose: neverCompletes }
  /** The getter participates in ordinary supported public configuration admission. */
  const options = {
    execution,
    report: ignoreReport,
    get scheduler() {
      optionReads++
      return scheduler
    },
    plugins: [probe, stuck] as const
  }
  try {
    /** Both the host and peer must reuse this one admitted scheduler snapshot. */
    const host = createLogHost(options)
    expect(optionReads).toBe(1)
    expect(scheduler.reads).toEqual({ now: 1, schedule: 1 })
    expect(probe.core.scheduler.now()).toBe(0)
    /** Cleanup must use the same captured capability receiver. */
    const shutdown = host.shutdown('manual')
    // Twenty turns retain the original fixed admission bound, independent of package count.
    for (let index = 0; index < 20 && scheduler.pending.length === 0; index++)
      await Promise.resolve()
    expect(scheduler.pending.length).toBeGreaterThan(0)
    /** Callback admission uses the original fixed snapshot rather than a growing live list. */
    const callbacks = scheduler.pending.splice(0)
    for (const callback of callbacks) callback()
    /** Deadline failure remains in the structured nonrejecting shutdown result. */
    const result = await shutdown
    expect(result.cleanupComplete).toBe(false)
    expect(result.cleanupErrors.length).toBeGreaterThan(0)
    expect(scheduler.receivers.length).toBeGreaterThan(0)
    expect(scheduler.receivers.every((receiver) => receiver === scheduler)).toBe(true)
  } finally {
    vi.useRealTimers()
  }
}
/** A fixture plugin adds no public methods. */
function emptyExtensions(): Record<string, never> {
  return {}
}

/** Test-only host observation preserves real microtask progress while recording escaped throws. */
class HostExceptionCapture {
  /** The original scheduler is invoked directly to avoid recursive interception. */
  #enqueue: typeof queueMicrotask
  /** Escaped callback failures must remain empty under terminal containment. */
  readonly errors: unknown[] = []
  /** Native rejection events independently observe failures that escaped Promise containment. */
  readonly rejections: unknown[] = []
  /** Borrow the native microtask implementation before replacing the global method. */
  constructor(enqueue: typeof queueMicrotask) {
    this.#enqueue = enqueue
  }
  /** The outer forwarding callback contains no nested callback allocation. */
  readonly enqueue = (callback: () => void): void => this.schedule(callback)
  /** Schedule one observed callback through the original native implementation. */
  schedule(callback: () => void): void {
    this.#enqueue(() => this.invoke(callback))
  }
  /** Record only failures that actually escaped the logging reporter boundary. */
  invoke(callback: () => void): void {
    try {
      callback()
    } catch (error) {
      this.errors.push(error)
    }
  }
  /** Stable Node event callback retains the exact rejected reason. */
  readonly onUnhandled = (error: unknown): void => {
    this.rejections.push(error)
  }
}
/** An output rejection drives the same original failure listener boundary. */
function rejectSink(): Promise<void> {
  return Promise.reject(new Error('sink-failed'))
}
/** A synchronous listener failure must be contained by the terminal reporter. */
function throwFailureListener(): never {
  throw new Error('sync-hook-failed')
}
/** An asynchronous listener failure follows the same terminal containment policy. */
async function rejectFailureListener(): Promise<void> {
  throw new Error('async-hook-failed')
}
/** The default console reporter itself may fail without throwing back into its host. */
function throwConsole(): never {
  throw new Error('console-failed')
}
/** Logging contains listener and console reporter failures without host throws or rejections. */
async function terminalReporterContainment(): Promise<void> {
  /** Real microtasks still run while their escaped failures are independently captured. */
  const observed = new HostExceptionCapture(globalThis.queueMicrotask)
  /** Replace only the observation boundary, preserving native callback scheduling. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(observed.enqueue)
  /** The default reporter receives its actual borrowed console implementation. */
  const consoleError = vi.spyOn(console, 'error').mockImplementation(throwConsole)
  process.on('unhandledRejection', observed.onUnhandled)
  try {
    /** The normal sink drives both supported failure-listener shapes. */
    const capture = new CapturePlugin({ sinks: [rejectSink] })
    /** The default reporter is deliberately used rather than a silent custom reporter. */
    const host = createLogHost({ execution, plugins: [capture] })
    host.onFailure(throwFailureListener)
    host.onFailure(rejectFailureListener)
    host.log('error', 'reporter-boundary')
    await expect(host.flush()).resolves.toBeUndefined()
    await nextTurn(10)
    await host.shutdown('manual')
    expect(consoleError).toHaveBeenCalledTimes(2)
  } finally {
    process.off('unhandledRejection', observed.onUnhandled)
    queue.mockRestore()
    consoleError.mockRestore()
  }
  expect(observed.rejections).toEqual([])
  expect(observed.errors).toEqual([])
}

/** A real never-settling sink emits the original deadline identity and no spurious terminal report. */
async function realLifecycleDeadline(): Promise<void> {
  /** The supported injected clock controls both deadline arithmetic and timer callbacks. */
  const scheduler = createManualScheduler()
  /** The original sink can be released after the deadline assertion to close its owner normally. */
  const held = new Deferred<void>()
  /** Successful failure handling prevents an additional terminal report. */
  const report = vi.fn()
  /** The actual sink returns a held native Promise. */
  const capture = new CapturePlugin({ sinks: [() => held.promise] })
  /** The host keeps its existing shared default deadline. */
  const host = createLogHost({ execution, scheduler, report, plugins: [capture] })
  /** Preserve the exact error selected by the real failure channel. */
  let failure: unknown
  host.onFailure((event) => {
    failure = event.error
  })
  try {
    host.log('info', 'deadline')
    /** Flush must fulfill even though the output did not finish before its deadline. */
    const flush = host.flush()
    await microtasks()
    scheduler.advance(3_000)
    await microtasks()
    await flush
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      source: ERROR_SOURCE,
      code: LogHostErrorCode.lifecycleDeadline,
      message: LogHostErrorText.flushDeadline
    })
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
    expect(report).not.toHaveBeenCalled()
    held.resolve()
    await microtasks()
    await host.shutdown('manual')
  } finally {
    held.resolve()
  }
}

it('createdAt 与 options 的嵌套值仍可被插件改写 — native Date branch', nativeContextDate)
it('调用方伪造 extendPath 即可让目标收不到日志', forgedForwardPath)
it('flusher 自身产生 pending 时循环会重跑 flusher', flusherRunsOnce)
it(
  'drains handler-era work, then blocks disposer-era logs before PluginHost disposal',
  shutdownDispatchAdmission
)
it(
  'one flush shares one absolute deadline across phases and extends targets',
  sharedForwardDeadline
)
it('flush deadline cannot interrupt a never-settling tracked sink', trackedSinkRemainsPending)
it(
  'fixed: cross-realm-style thenables (not instanceof Promise) are tracked by flush',
  foreignThenableDrain
)
it(
  'runtime extend guard does not propagate through a structural logger target',
  structuralTargetReentrancy
)
it(
  'a never-settling onShutdown handler no longer blocks shutdown() past the shared deadline',
  boundedShutdownHandler
)
it(
  'shutdown handlers registered after a stuck one are still invoked, only their wait is bounded',
  laterShutdownHandlers
)
it('waitUntil clears its deadline timer once the raced task settles first', successfulWaitTimer)
it(
  '#drain clears its per-round deadline timer once pending work settles before the deadline',
  successfulDrainTimer
)
it(
  'waitUntil must observe a task even when the deadline has already elapsed, or a later rejection goes unhandled',
  elapsedDeadlineObservation
)
it(
  'uses one scheduler snapshot for the host disposer, logger lifecycle, and plugin core',
  oneSchedulerSnapshot
)
it(
  'contains synchronous, asynchronous, console, and write reporter failures — retained console boundary',
  terminalReporterContainment
)
it(
  'LIFECYCLE_DEADLINE reports a real never-settling sink after its deadline',
  realLifecycleDeadline
)
