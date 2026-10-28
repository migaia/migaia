import { expect, it, vi } from 'vitest'
import { createLogHost, defaultLogFailureReporter } from '../src/index.ts'
import { defineOutputPlugin } from '../src/plugin.ts'
import type { ILogEntry, ILogFailure } from '../src/typing.ts'
import { nextTurn } from './fixtures/output.ts'

/** One stable original failure is shared by the transport/listener containment fixtures. */
const deliveryFailure = new Error('delivery fixture')
/** One stable listener failure proves original identity remains reachable on the reported cause. */
const listenerFailure = new Error('listener fixture')
/** A transport throw must never leave a logging call, flush, or shutdown. */
function throwDelivery(): never {
  throw deliveryFailure
}
/** The terminal reporter may itself throw; that failure must not recursively reenter the host. */
function throwReporter(): never {
  throw new Error('reporter fixture')
}
/** Rejected reporter Promises must be observed, even though the public callback type returns void. */
function rejectReporter(): Promise<void> {
  return Promise.reject(new Error('rejected reporter fixture'))
}
/** A throwing listener exercises the supported onFailure diagnostic path. */
function throwListener(_failure: ILogFailure): never {
  throw listenerFailure
}
/** An async stage rejection is contained inside the queued pipeline. */
async function rejectStage(_entry: ILogEntry): Promise<void> {
  throw deliveryFailure
}

/** Host runtime containment is observed through real SDK transport and public barriers. */
async function containsRuntimeFailures(): Promise<void> {
  /** Reporter observations distinguish listener failure from transport failure. */
  const reporter = new ReporterCapture()
  /** This output throws before returning any Promise. */
  const output = defineOutputPlugin({
    name: 'throws',
    batchable: false,
    defaultFormat: 'json',
    deliver: throwDelivery
  })
  /** Public logging must return normally before queued delivery begins. */
  const host = createLogHost({ report: reporter.receive, plugins: [output] })
  host.onFailure(throwListener)
  expect(() => host.log('info', 'message')).not.toThrow()
  await expect(host.flush()).resolves.toBeUndefined()
  expect(reporter.errors).toHaveLength(1)
  expect(reporter.errors[0]).toMatchObject({
    source: 'logging',
    code: 'HOOK_FAILED',
    cause: listenerFailure
  })
  host.usePipeline(rejectStage)
  host.log('info', 'pipeline')
  await expect(host.flush()).resolves.toBeUndefined()
  expect(reporter.errors).toHaveLength(2)
  await expect(host.shutdown('manual')).resolves.toMatchObject({ logicalTerminal: true })
}

/** Reporter state is a named owner rather than a nested callback test fixture. */
class ReporterCapture {
  /** Original reported values remain available for source/code/cause assertions. */
  readonly errors: unknown[] = []
  /** The public reporter callback is stable across every diagnostic branch. */
  readonly receive = (error: unknown): void => {
    this.errors.push(error)
  }
}

/**
 * Both synchronous and rejected terminal reporter failures stay contained with and without
 * listeners.
 */
async function containsReporterFailures(): Promise<void> {
  for (const report of [throwReporter, rejectReporter]) {
    for (const observe of [false, true]) {
      /** Transport failure always reaches one terminal path; no business exception is produced. */
      const output = defineOutputPlugin({
        name: 'throws',
        batchable: false,
        defaultFormat: 'json',
        deliver: throwDelivery
      })
      /** Each fixture owns a fresh failure/listener state. */
      const host = createLogHost({ report, plugins: [output] })
      if (observe) host.onFailure(throwListener)
      expect(() => host.log('info', 'message')).not.toThrow()
      await expect(host.flush()).resolves.toBeUndefined()
      await expect(host.shutdown('manual')).resolves.toMatchObject({ logicalTerminal: true })
      await nextTurn()
    }
  }
}

/** A hostile returned then getter must be consumed without calling terminal reporting recursively. */
class ThrowingThen {
  /** Getter access fails exactly at the canonical thenable admission boundary. */
  // oxlint-disable-next-line unicorn/no-thenable -- Intentional hostile thenable at the public reporter boundary.
  get then(): never {
    throw new Error('console then getter fixture')
  }
}
/** Console terminal fixtures retain their own method failure shapes. */
function consoleThrows(): never {
  throw new Error('console fixture')
}
/** A rejected native Promise represents a failing console implementation in another host. */
function consoleRejects(): Promise<void> {
  return Promise.reject(new Error('console rejection fixture'))
}
/** Then access is delayed until the default reporter observes the returned value. */
function consoleGetterFails(): ThrowingThen {
  return new ThrowingThen()
}

/** Direct default reporter calls must contain every supported terminal failure shape. */
async function defaultTerminalBoundaries(): Promise<void> {
  for (const implementation of [consoleThrows, consoleRejects, consoleGetterFails]) {
    /** Replacing only the console method keeps native global installation outside product code. */
    const spy = vi.spyOn(console, 'error').mockImplementation(implementation)
    try {
      expect(() => defaultLogFailureReporter(deliveryFailure)).not.toThrow()
      await nextTurn()
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  }
}
it('contains transport and pipeline failures and traces listener errors', containsRuntimeFailures)
it('contains both synchronous and rejected reporter failures', containsReporterFailures)
it('contains default console throws, rejection and then getter failures', defaultTerminalBoundaries)
