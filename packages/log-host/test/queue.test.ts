import { expect, it } from 'vitest'
import { createLogHost } from '../src/index.ts'
import { CaptureOutput, FailureCapture, messageOf } from './fixtures/output.ts'

/** Entry overflow is observable before any output begins and preserves the surviving FIFO order. */
async function queueOverflow(): Promise<void> {
  /** Transport observation occurs through the SDK output path. */
  const output = new CaptureOutput()
  /** The failure channel distinguishes admission overflow from transport failure. */
  const failures = new FailureCapture()
  /** The chosen capacity admits only the last two entries written in one synchronous producer turn. */
  const host = createLogHost({ maxPending: 2, plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  host.log('info', 'first')
  host.log('info', 'second')
  host.log('info', 'third')
  expect(output.records).toEqual([])
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['second', 'third'])
  expect(failures.failures).toHaveLength(1)
  expect(failures.failures[0].error).toMatchObject({ source: 'logging', code: 'QUEUE_OVERFLOW' })
  await host.shutdown('manual')
}
it('drops only the oldest unprocessed entry at capacity', queueOverflow)
