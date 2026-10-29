import { expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { UTILS_SOURCE, UtilsErrorCode } from '@migaia/utils/error'
import { createManualScheduler } from '@migaia/utils/testing'
import { createLogHost } from '../src/index.ts'
import { retryFeature } from '../src/features/retry.ts'
import { timeoutFeature } from '../src/features/timeout.ts'
import { CaptureOutput, FailureCapture, nextTurn } from './fixtures/output.ts'

/** Intermediate retry failures remain internal while transport retry hints are invoked exactly once. */
async function retryAttempts(): Promise<void> {
  /** The first two real transport calls fail; the third succeeds. */
  const output = new CaptureOutput({
    features: { retry: retryFeature({ attempts: 3 }) },
    failures: 2,
    retryDelay: 0
  })
  /** The failure channel must remain empty after a successful retry sequence. */
  const failures = new FailureCapture()
  /** All delivery policy belongs to the SDK host rather than a fixture retry loop. */
  const host = createLogHost({ plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  host.log('info', 'retry')
  await host.flush()
  expect(output.attempts).toBe(3)
  expect(output.hints).toBe(2)
  expect(output.records).toHaveLength(1)
  expect(failures.failures).toEqual([])
  await host.shutdown('manual')
}

/** Per-attempt timeouts keep the canonical utils failure on cause and contain the caller boundary. */
async function deliveryTimeout(): Promise<void> {
  /** Virtual time independently proves the configured deadline without wall-clock races. */
  const scheduler = createManualScheduler()
  /** A borrowed promise prevents transport completion before the selected deadline. */
  const blocked = deferred<void>()
  /** The output uses the actual transport signal passed by the timeout operation. */
  const output = new CaptureOutput({
    features: { timeout: timeoutFeature({ ms: 10 }) },
    blocked: blocked.promise
  })
  /** Timeout must be reported once after the canonical delivery boundary settles. */
  const failures = new FailureCapture()
  /** The host's own flush budget uses the same virtual clock domain. */
  const host = createLogHost({ scheduler, plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  host.log('info', 'timeout')
  await output.started.promise
  scheduler.advance(10)
  await nextTurn()
  await host.flush()
  expect(failures.failures).toHaveLength(1)
  expect(failures.failures[0].error).toMatchObject({
    source: 'logging',
    code: 'DELIVERY_FAILED',
    cause: { source: UTILS_SOURCE, code: UtilsErrorCode.deadlineExceeded }
  })
  expect(output.signals[0].aborted).toBe(true)
  blocked.resolve()
  await nextTurn()
  await host.shutdown('manual')
}
it('uses utils retry with transport hints and no intermediate failure events', retryAttempts)
it('contains timeout failure with the original utils error on cause', deliveryTimeout)
