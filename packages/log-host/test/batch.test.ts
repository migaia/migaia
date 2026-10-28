import { expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createLogHost } from '../src/index.ts'
import { batchFeature } from '../src/features/batch.ts'
import { CaptureOutput, FailureCapture, nextTurn, messageOf } from './fixtures/output.ts'

/** A bounded batch owner drops the oldest queued batch while an in-flight attempt retains ownership. */
async function batchOverflow(): Promise<void> {
  /** Holding the first output creates a deterministic occupied concurrency slot. */
  const blocked = deferred<void>()
  /** One active and one queued batch exhaust the admitted pending capacity. */
  const output = new CaptureOutput({
    features: [batchFeature({ maxSize: 1, maxConcurrentBatches: 1, maxPendingBatches: 2 })],
    blocked: blocked.promise
  })
  /** Failure detail must retain dropped entry counts rather than only a shared code. */
  const failures = new FailureCapture()
  /** Host ingress remains independent of output concurrency. */
  const host = createLogHost({ plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  host.log('info', 'first')
  await output.started.promise
  host.log('info', 'second')
  host.log('info', 'third')
  await nextTurn()
  expect(failures.failures).toHaveLength(1)
  expect(failures.failures[0].error).toMatchObject({
    source: 'logging',
    code: 'BATCH_OVERFLOW',
    detail: { dropped: 1 }
  })
  blocked.resolve()
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['first', 'third'])
  await host.shutdown('manual')
}

/** The established default size boundary starts a full batch before an explicit host flush. */
async function batchDefaults(): Promise<void> {
  /** Full default batches contain twenty entries and are independently visible to the transport. */
  const output = new CaptureOutput({ features: [batchFeature()] })
  /** A normal host exercises real asynchronous entry traversal and the class-owned batch buffer. */
  const host = createLogHost({ plugins: [output.plugin()] })
  for (let index = 0; index < 20; index++) host.log('info', String(index))
  await output.delivered.promise
  expect(output.batches).toHaveLength(1)
  expect(output.batches[0]).toHaveLength(20)
  await host.shutdown('manual')
}
it('drops oldest queued batches and reports complete overflow classification', batchOverflow)
it('retains the established default size boundary before flush', batchDefaults)

/** Final buffered output must be delivered before canonical registration lifetime revocation. */
async function releaseFinalBatch(): Promise<void> {
  /** The partial batch cannot be delivered by its size boundary before removal starts. */
  const output = new CaptureOutput({ features: [batchFeature({ maxSize: 2 })] })
  /** Removal uses the same supported public configuration operation as real output replacement. */
  const host = createLogHost({ plugins: [output.plugin()] })
  host.log('info', 'final-buffered')
  await nextTurn()
  expect(output.attempts).toBe(0)
  expect((await host.unUse('capture')).ok).toBe(true)
  expect(output.records.map(messageOf)).toEqual(['final-buffered'])
  expect(output.signalStates).toEqual([false])
  await host.shutdown('manual')
}
it('drains final buffered output before its registration signal is aborted', releaseFinalBatch)
