import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { openBootstrapFrameChannel } from '../../src/process/bootstrap.js'
import type { IProcessByteChannel } from '../../src/process/types.js'

vi.mock('@migaia/utils/promise', async (original) => ({
  ...(await original<typeof import('@migaia/utils/promise')>()),
  hostRethrowReporter: vi.fn()
}))

it('[A3] original bootstrap deadline survives failed physical cleanup and reports that cleanup', async () => {
  /** The existing scheduler owns the only startup deadline; no native timer is introduced. */
  const scheduler = createManualScheduler()
  /** This precise native failure must remain independently reported rather than replacing timeout. */
  const cleanup = new Error('c3-native-bootstrap-cleanup')
  /** The physical owner's invocation count proves timeout and cleanup share one teardown. */
  let closes = 0
  /** A supported channel may reject close while no library bootstrap ever arrives. */
  const channel: IProcessByteChannel = {
    kind: 'byte',
    write: async () => undefined,
    onData: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => {
      closes += 1
      throw cleanup
    }
  }
  /** Observe the actual bootstrap promise before advancing the canonical scheduler. */
  const result = openBootstrapFrameChannel(channel, 'stdin', {
    bootstrapTimeoutMs: 10,
    scheduler
  }).catch((error: unknown) => error)
  scheduler.advance(10)
  const failure = await result
  assert.equal(
    (failure as { code?: string }).code,
    'PROCESS_HANDSHAKE_TIMEOUT',
    '[A3] cleanup must not replace the real startup failure'
  )
  assert.equal(closes, 1, '[A3] timeout requests exactly one physical teardown')
  assert.equal(
    vi.mocked(hostRethrowReporter).mock.calls.filter(([error]) => error === cleanup).length,
    1,
    '[A3] the original cleanup error is reported once'
  )
})
