/** Public pre-acquisition cancellation retains a throwing structural reason as original cause. */
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { throwingSignal } from '../fixtures/throwing-signal.js'

it('keeps the original failed reason read on CANCELLED before acquiring a carrier', async () => {
  /** A supported structural signal can throw while supplying its terminal reason. */
  const original = new Error('construction getter')
  /** The controlled getter records every actual reason read independently from cancellation. */
  const source = throwingSignal(original, true)
  /** Cold registration must not acquire a native resource after the signal is already terminal. */
  const open = vi.fn(async () => ({ dispose: () => undefined }))
  /** Capture the real public failure regardless of its construction phase. */
  let failure: unknown
  try {
    await createRpcHost({
      self: { name: 'construction-reason-client', instanceId: 'construction-reason-client' },
      signal: source.signal,
      plugins: [defineTransportPlugin({ name: 'construction-reason', namespace: 'native', open })]
    })
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED', cause: original })
  expect((failure as Error).cause).toBe(original)
  expect(source.reads()).toBe(1)
  expect(open).not.toHaveBeenCalled()
})
