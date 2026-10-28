import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { processPlugin } from '../../src/index.ts'
import { FailureProcess, execution, nextTurn } from '../fixtures.ts'

/** Every supported hostile reporter boundary retains its original observation case. */
type IReporterMode = 'getter' | 'invoke' | 'reject'

/** Original thenable receiver identity is independent of the owner's method receiver. */
const reporterOwners = new WeakMap<object, ReporterThenable>()

/** The captured method is invoked with the exact object whose then getter was read. */
function reporterThen(
  this: object,
  resolve: (value?: unknown) => void,
  reject: (reason?: unknown) => void
): void {
  reporterOwners.get(this)!.invoke(this, resolve, reject)
}

/** A real reporter protocol exposes one getter read and one invocation or rejection. */
class ReporterThenable {
  /** The terminal failure remains the original value at every protocol boundary. */
  readonly error: Error
  /** The actual object is returned directly from console.error without assimilation in the fixture. */
  readonly thenable: object = {}
  /** Getter mode fails before any invocation can occur. */
  #mode: IReporterMode
  /** Native reject is retained until the explicit later microtask runs. */
  #reject: ((reason?: unknown) => void) | undefined
  /** Reflective reads distinguish one captured observation from repeated Promise assimilation. */
  reads = 0
  /** Captured invocation preserves the original thenable as this. */
  receiverMatches = false
  /** Getter failure must leave this false. */
  invoked = false

  /** Install the hostile accessor without adding an artificial Promise boundary. */
  constructor(mode: IReporterMode) {
    this.#mode = mode
    this.error = new Error(`console-${mode}`)
    reporterOwners.set(this.thenable, this)
    // oxlint-disable-next-line unicorn/no-thenable -- Deliberate protocol fixture checks reporter containment.
    Object.defineProperty(this.thenable, 'then', {
      configurable: true,
      get: () => this.readThen()
    })
  }

  /** Capture the method once or preserve the original getter failure. */
  readThen(): typeof reporterThen {
    this.reads++
    if (this.#mode === 'getter') throw this.error
    return reporterThen
  }

  /** Preserve receiver and invocation before throwing or rejecting as selected. */
  invoke(
    receiver: object,
    resolve: (value?: unknown) => void,
    reject: (reason?: unknown) => void
  ): void {
    this.receiverMatches = receiver === this.thenable
    this.invoked = true
    if (this.#mode === 'invoke') throw this.error
    this.#reject = reject
    queueMicrotask(this.rejectLater)
    if (this.#mode === 'getter') resolve(undefined)
  }

  /** The rejected-result mode remains observably asynchronous. */
  readonly rejectLater = (): void => {
    this.#reject?.(this.error)
  }

  /** Returning the raw hostile object ensures production owns all protocol observation. */
  readonly result = (): never => this.thenable as never
}

/** Terminal host exceptions and unhandled rejections remain independent observations. */
class EscapeObservations {
  /** Original enqueue is retained before the spy replaces the public slot. */
  #enqueue = globalThis.queueMicrotask
  /** Reporter containment must leave host-thrown microtask failures absent. */
  readonly hostErrors: unknown[] = []
  /** Reporter result rejection must not reach the native unhandled-rejection event. */
  readonly unhandled: unknown[] = []

  /** Preserve the usual microtask schedule while recording escaped callback exceptions. */
  readonly intercept = (callback: VoidFunction): void => this.enqueue(callback)
  /** Native detector registration retains this exact callback identity for removal. */
  readonly onUnhandled = (reason: unknown): void => {
    this.unhandled.push(reason)
  }

  /** Schedule one ordinary microtask without a nested callback body. */
  enqueue(callback: VoidFunction): void {
    this.#enqueue(() => this.observe(callback))
  }

  /** Capture host throws independently of the reporter's own rejected result. */
  observe(callback: VoidFunction): void {
    try {
      callback()
    } catch (error) {
      this.hostErrors.push(error)
    }
  }
}

/** Signal exit failure causes one terminal diagnostic despite each hostile reporter result mode. */
async function reporterContainment(mode: IReporterMode): Promise<void> {
  /** The exact exit primary must remain the diagnostic cause. */
  const exitError = new Error('exit')
  /** This injected capability never terminates the test runner. */
  const runtimeProcess = new FailureProcess()
  runtimeProcess.exitFailure = exitError
  /** The reporter's raw protocol and all observation counts remain independent. */
  const reporter = new ReporterThenable(mode)
  /** Native and queued terminal escapes are checked separately. */
  const escapes = new EscapeObservations()
  /** A console diagnostic is the real default reporter boundary used by the process plugin. */
  const consoleError = vi.spyOn(console, 'error').mockImplementation(reporter.result)
  /** Normal microtasks still execute while their uncaught failures are recorded. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(escapes.intercept)
  /** All runtime callbacks belong to this real public host. */
  const host = createLogHost({ execution, plugins: [processPlugin({ process: runtimeProcess })] })
  process.on('unhandledRejection', escapes.onUnhandled)
  try {
    expect(() => runtimeProcess.fire('SIGINT')).not.toThrow()
    await nextTurn()
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(reporter.reads).toBe(1)
    if (mode === 'getter') {
      expect(reporter.invoked).toBe(false)
    } else {
      expect(reporter.invoked).toBe(true)
      expect(reporter.receiverMatches).toBe(true)
    }
    /** The same diagnostic retains process ownership after the package split. */
    const diagnostic = consoleError.mock.calls[0]?.[0] as Error
    expect(diagnostic).toMatchObject({
      source: 'logging.process',
      code: 'PLUGIN_SHUTDOWN_CLEANUP_FAILED'
    })
    expect(diagnostic.cause).toBe(exitError)
    expect(escapes.unhandled).toEqual([])
    expect(escapes.hostErrors).toEqual([])
  } finally {
    process.removeListener('unhandledRejection', escapes.onUnhandled)
    queue.mockRestore()
    consoleError.mockRestore()
    await host.shutdown('manual')
  }
}

it.each(['getter', 'invoke', 'reject'] as const)(
  'contains hostile console reporter %s with one diagnostic attempt',
  reporterContainment
)
