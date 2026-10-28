import { expect, it, vi } from 'vitest'
import { createLogHost, type ILogFailure, type ILogHost } from '../../src/index.ts'
import type { IAsyncMiddlewareStage } from '@migaia/middleware-pipeline'
import { CapturePlugin, execution, microtasks, nextTurn } from './fixtures.ts'

/** Deleted hook/fireHook branches are excluded; all supported task boundaries retain their cases. */
type IBoundary = 'sink' | 'pipeline' | 'flush'
/** Every hostile failure mode is independently observed through each supported owner boundary. */
type IFailureMode = 'getter' | 'invoke' | 'reject'
/** Module-private fixture provenance preserves the exact then method receiver without bind/call. */
const thenableOwners = new WeakMap<object, HostileThenable>()

/** Captured first then is shared and receives the original thenable as its native receiver. */
function firstThen(
  this: object,
  resolve: (value?: unknown) => void,
  reject: (error?: unknown) => void
): void {
  thenableOwners.get(this)!.invoke(this, resolve, reject)
}
/** A second getter read intentionally yields an invalid protocol function. */
function secondThen(this: object): never {
  throw thenableOwners.get(this)!.secondReadError
}

/** Named fixture state retains single-read, receiver, invocation and explicit completion oracles. */
class HostileThenable {
  /** Failure reason identity must remain the same through the actual host boundary. */
  readonly error: Error
  /** An accidental second then read has a distinct failure reason. */
  readonly secondReadError: Error
  /** The exact protocol object is returned directly to the actual task boundary. */
  readonly thenable: object = {}
  /** The selected mode belongs to this fixture alone. */
  #mode: IFailureMode | 'success'
  /** Counts original getter admissions rather than Promise reactions. */
  reads = 0
  /** Records actual receiver identity inside the captured protocol function. */
  receiverMatches = false
  /** Records actual protocol invocation independently from the getter count. */
  invoked = false
  /** The successful protocol retains its original native resolve capability. */
  #resolve: ((value?: unknown) => void) | undefined
  /** Deferred reject capability belongs to the selected protocol invocation. */
  #reject: ((error?: unknown) => void) | undefined
  /** Build one protocol object and give it a deliberately hostile then accessor. */
  constructor(mode: IFailureMode | 'success', label: string) {
    this.#mode = mode
    this.error = new Error(`${label}-${mode}`)
    this.secondReadError = new Error(`${label}-second-then-read`)
    thenableOwners.set(this.thenable, this)
    // oxlint-disable-next-line unicorn/no-thenable -- Deliberate protocol fixture checks single getter admission.
    Object.defineProperty(this.thenable, 'then', { get: () => this.readThen(), configurable: true })
  }
  /** Capture one protocol method; a second read returns another observable method. */
  readThen(): typeof firstThen | typeof secondThen {
    this.reads++
    if (this.#mode === 'getter') throw this.error
    return this.reads === 1 ? firstThen : secondThen
  }
  /** Preserve actual method receiver while selecting success, invocation throw or late rejection. */
  invoke(
    receiver: object,
    resolve: (value?: unknown) => void,
    reject: (error?: unknown) => void
  ): void {
    this.receiverMatches = receiver === this.thenable
    this.invoked = true
    if (this.#mode === 'success') this.#resolve = resolve
    else if (this.#mode === 'invoke') throw this.error
    else {
      this.#reject = reject
      queueMicrotask(this.rejectLater)
    }
  }
  /** Rejection runs after protocol invocation without nesting a callback inside that function. */
  readonly rejectLater = (): void => {
    this.#reject?.(this.error)
  }
  /** Successful fixture fulfillment stays controlled by the business scenario. */
  release(): void {
    this.#resolve?.(undefined)
  }
  /** Deliberately return the real protocol object, preserving runtime thenable coverage. */
  readonly result = (): Promise<void> => this.thenable as Promise<void>
  /** A public async pipeline stage has the same raw runtime result as sink and flush callbacks. */
  readonly stage: IAsyncMiddlewareStage<import('../../src/typing.ts').ILogEntry> = () =>
    this.thenable as Promise<void>
}

/** Install observations through actual public host/core entries rather than compatibility methods. */
function boundaryHost(
  boundary: IBoundary,
  hostile: HostileThenable
): ILogHost<readonly [CapturePlugin]> {
  /** The selected boundary alone receives the hostile result. */
  const capture = new CapturePlugin(
    boundary === 'sink'
      ? { sinks: [hostile.result] }
      : boundary === 'flush'
        ? { flush: hostile.result }
        : {}
  )
  /** The real host owns draining and every registration resource. */
  const host = createLogHost({ execution, plugins: [capture] })
  if (boundary === 'pipeline') host.usePipeline(hostile.stage)
  return host
}

/** Successful non-native thenables retain original receiver and delay the actual public flush. */
async function successfulBoundary(boundary: IBoundary): Promise<void> {
  /** The successful fixture can be released only after the host has observed its actual protocol. */
  const hostile = new HostileThenable('success', boundary)
  /** Each supported task boundary has its own actual host. */
  const host = boundaryHost(boundary, hostile)
  /** Failures remain absent throughout a successful protocol operation. */
  const failures: ILogFailure[] = []
  host.onFailure((failure) => {
    failures.push(failure)
  })
  if (boundary !== 'flush') host.log('info', `thenable-${boundary}`)
  /** Promise identity and pending completion remain independently observable. */
  const completion = host.flush()
  /** Completion is observed without reading private host pending state. */
  let flushed = false
  void completion.then(() => {
    flushed = true
  })
  await microtasks()
  expect(hostile.invoked).toBe(true)
  expect(hostile.receiverMatches).toBe(true)
  expect(hostile.reads).toBe(1)
  expect(flushed).toBe(false)
  hostile.release()
  await expect(completion).resolves.toBeUndefined()
  expect(flushed).toBe(true)
  expect(failures).toHaveLength(0)
}

/** Getter, invocation and rejected-result failures preserve identity and are observed only once. */
async function failedBoundary(scenario: {
  boundary: IBoundary
  mode: IFailureMode
}): Promise<void> {
  /** Each failure mode has a distinct original object, getter count and protocol invocation. */
  const hostile = new HostileThenable(scenario.mode, scenario.boundary)
  /** The public logging owner sees the actual hostile result, not a Promise.resolve adapter. */
  const host = boundaryHost(scenario.boundary, hostile)
  /** A successful listener intentionally handles this failure without terminal reporting. */
  const failures: ILogFailure[] = []
  host.onFailure((failure) => {
    failures.push(failure)
  })
  /** The new handled-failure policy explicitly suppresses the old duplicate console diagnostic. */
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(ignoreDiagnostic)
  try {
    if (scenario.boundary !== 'flush')
      expect(() => host.log('info', `thenable-${scenario.boundary}-${scenario.mode}`)).not.toThrow()
    await expect(host.flush()).resolves.toBeUndefined()
    expect(failures).toHaveLength(1)
    expect(failures[0].source).toBe(scenario.boundary)
    expect(failures[0].error).toBe(hostile.error)
    expect(diagnostic).toHaveBeenCalledTimes(0)
    expect(hostile.reads).toBe(1)
    if (scenario.mode !== 'getter') expect(hostile.invoked).toBe(true)
  } finally {
    diagnostic.mockRestore()
  }
}
/** A diagnostic spy must not itself create asynchronous work. */
function ignoreDiagnostic(): void {}

/** Failure-listener rejection yields one terminal diagnostic without an unhandled rejection. */
async function failureObserverRejection(): Promise<void> {
  /** The original rejecting listener protocol is read exactly once by the host. */
  const hostile = new HostileThenable('reject', 'failure-listener')
  /** Original sink failure remains observable through a separate successful listener. */
  const primary = new Error('sink-primary')
  /** Real sink registration returns a rejection through the supported core. */
  const capture = new CapturePlugin({ sinks: [() => Promise.reject(primary)] })
  /** All listener and reporter behavior belongs to this real host. */
  const host = createLogHost({ execution, plugins: [capture] })
  /** The original primary stays visible even though duplicate terminal reporting is removed. */
  const failures: ILogFailure[] = []
  host.onFailure((failure) => {
    failures.push(failure)
  })
  host.onFailure(hostile.result)
  /** Terminal reporting is observed independently of the failure event channel. */
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(ignoreDiagnostic)
  /** Native detector events must stay absent after listener rejection settles. */
  const unhandled: unknown[] = []
  /** This callback is intentionally detached from the host's own error reporting. */
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    host.log('info', 'failure-listener')
    await expect(host.flush()).resolves.toBeUndefined()
    await nextTurn()
    expect(failures[0].error).toBe(primary)
    expect(diagnostic).toHaveBeenCalledTimes(1)
    expect(diagnostic.mock.calls[0]?.[0]).toMatchObject({
      code: 'HOOK_FAILED',
      cause: hostile.error
    })
    expect(hostile.reads).toBe(1)
    expect(hostile.receiverMatches).toBe(true)
    expect(unhandled).toEqual([])
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
    diagnostic.mockRestore()
  }
}

/**
 * Supported boundaries are fixed by the public callback contract; removed hook is accounted
 * separately.
 */
const boundaries: readonly IBoundary[] = ['sink', 'pipeline', 'flush']
/** Every supported protocol failure must retain its original observation assertions. */
const modes: readonly IFailureMode[] = ['getter', 'invoke', 'reject']
/** Parameter rows are explicitly constructed without nested callback expressions. */
const failures: Array<{ boundary: IBoundary; mode: IFailureMode }> = []
for (const boundary of boundaries) for (const mode of modes) failures.push({ boundary, mode })
it.each(boundaries)(
  '%s reads then once, preserves receiver, and flush drains successful work',
  successfulBoundary
)
it.each(failures)('$boundary observes $mode failure once with original identity', failedBoundary)
it(
  'contains failure-hook rejection without duplicate diagnostics or unhandled rejection',
  failureObserverRejection
)
