import { describe, expect, it, vi } from 'vitest'
import { RuntimeStreamFixture } from './stream-fixture.js'
import { RpcStreamOwner } from '../../dist/core/internal/stream/owner.js'
import { RpcOutboundAttachment } from '../../dist/core/internal/outbound-attachment.js'

describe('remote stream dispatch', () => {
  it.each(['generator', 'asyncGenerator'] as const)(
    '%s opens the stream only at first next and never sends a request',
    async (mode) => {
      /** Genuine canonical stream and outbound owners retain lazy admission. */
      const fixture = await RuntimeStreamFixture.open()
      /** These spies observe actual endpoint operations after its one real description exchange. */
      const streamOpen = vi.spyOn(RpcStreamOwner.prototype, 'open')
      /** Stream execution must never fall through to scalar request dispatch. */
      const send = vi.spyOn(RpcOutboundAttachment.prototype, 'send')
      try {
        const iterator = fixture.registration.invokeStream(`p.f.${mode}`, [])
        expect(streamOpen).not.toHaveBeenCalled()
        await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false })
        expect(streamOpen).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()
        await iterator.return!()
      } finally {
        streamOpen.mockRestore()
        send.mockRestore()
        await fixture.close()
      }
    }
  )

  it('rejects stream-only forbidden idempotency options before guard or open', async () => {
    /** Only actual runtime option admission precedes opening; the old optional call guard is gone. */
    const fixture = await RuntimeStreamFixture.open()
    /** Forbidden stream options must fail before the actual stream owner starts. */
    const streamOpen = vi.spyOn(RpcStreamOwner.prototype, 'open')
    try {
      const iterator = fixture.registration.invokeStream('p.f.generator', [], {
        idempotencyKey: 'key'
      })
      await expect(iterator.next()).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'CAPABILITY_UNSUPPORTED'
      })
      expect(streamOpen).not.toHaveBeenCalled()
    } finally {
      streamOpen.mockRestore()
      await fixture.close()
    }
  })
})
