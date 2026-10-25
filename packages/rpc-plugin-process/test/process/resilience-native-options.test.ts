/**
 * Preserve the original native diagnostic schedule rejection independently of retired session
 * policy.
 */
import { createManualScheduler } from '@migaia/utils/testing'
import { expect, it, vi } from 'vitest'
import { createProcessResilience } from '../../dist/process/resilience/index.js'

it('rejects a report schedule without a zero origin before scheduling work', () => {
  /** Construction must reject an invalid schedule without acquiring timer ownership. */
  const scheduler = createManualScheduler()
  /** A synchronous option error must not escape through the asynchronous report sink. */
  const report = vi.fn()
  expect(() => createProcessResilience({ scheduler, report, reportAtMs: [5, 10] })).toThrowError(
    expect.objectContaining({
      constructor: RangeError,
      source: 'rpc.transport.process',
      code: 'PROCESS_RESILIENCE_INVALID_OPTION',
      message: 'process resilience options are invalid',
      detail: { field: 'reportAtMs' },
      stack: expect.stringMatching(/\S/)
    })
  )
  expect(report).not.toHaveBeenCalled()
  expect(scheduler.pendingCount).toBe(0)
})
