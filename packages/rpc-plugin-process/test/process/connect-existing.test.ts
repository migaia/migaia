/** Original rendezvous resource and authentication effects use genuine current native owners. */
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { systemScheduler } from '@migaia/utils/scheduler'
import { NativeSocketAuth } from './fixtures/native-socket-auth.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../dist/process/adapters/node-socket.js'

describe('Node rendezvous sockets', () => {
  it('rejects a held pending accept after listener close', async () => {
    /** Legal selected authentication remains idle before its genuine raw candidate is adopted. */
    const verify = vi.fn(() => 'principal')
    /** The actual native listener retains the original pending capability and close owner. */
    const fixture = new NativeSocketAuth()
    fixture.holdNextPending()
    await fixture.listen(verify)
    /** The original independent native socket sends no handshake or credential. */
    const raw = await dialProcessByteChannel({ address: fixture.listener!.address })
    try {
      /** This is the actual listener's pending object, without a reconstructed accept API. */
      const pending = await fixture.pending.promise
      await fixture.listener!.close()
      await expect(pending.accept(async (channel) => channel)).rejects.toMatchObject({
        code: 'PROCESS_CHANNEL_CLOSED'
      })
      expect(verify).toHaveBeenCalledTimes(0)
    } finally {
      await raw.close()
      await fixture.close()
    }
  })

  it('aborts an in-flight accept when the listener closes', async () => {
    /** No authentication may start when no native hello has been received. */
    const verify = vi.fn(() => 'principal')
    /** The real Process owner starts its own Session and pending-accept race. */
    const fixture = new NativeSocketAuth()
    await fixture.listen(verify)
    /** Actual native acquisition remains distinct from semantic admission. */
    const raw = await dialProcessByteChannel({ address: fixture.listener!.address })
    try {
      await fixture.nativeAttached.promise
      /** The original native error outlet retains the actual pending-close failure object. */
      const outcome = fixture.connection.catch((error: unknown) => error)
      await fixture.listener!.close()
      await expect(outcome).resolves.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      expect(verify).toHaveBeenCalledTimes(0)
    } finally {
      await raw.close()
      await fixture.close()
    }
  })

  it('rejects a 16 MiB header before verifier admission', async () => {
    /** Native auth is selected, so this zero-call assertion has a real configured receiver. */
    const verify = vi.fn(() => 'principal')
    /** The actual native Process carrier and Session own framing and startup rejection. */
    const fixture = new NativeSocketAuth()
    await fixture.listen(verify)
    /**
     * Advance only the original actual handshake timer if the header is wrongly retained as
     * pending.
     */
    const scheduler = createManualScheduler()
    /**
     * This native deadline backend prevents an actual header regression from leaking a hanging
     * test.
     */
    const clock = vi
      .spyOn(systemScheduler, 'schedule')
      .mockImplementation((run, delay) => scheduler.schedule(run, delay))
    /** The original attacker supplies only its same four-byte length header. */
    const raw = await dialProcessByteChannel({ address: fixture.listener!.address })
    try {
      await fixture.nativeAttached.promise
      /** This actual native failure is never synthesized or recoded by the fixture. */
      const rejected = fixture.connection.catch((error: unknown) => error)
      await raw.write(new Uint8Array([1, 0, 0, 0])).catch(() => undefined)
      await fixture.inbound.promise
      scheduler.advance(10_000)
      expect(verify).toHaveBeenCalledTimes(0)
      await expect(rejected).resolves.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
    } finally {
      await raw.close()
      await fixture.close()
      clock.mockRestore()
    }
  })

  it('accepts only a verified pending connection and keeps it after listener close', async () => {
    /** The original token and principal belong solely to this genuine native verification recipe. */
    const verify = vi.fn((credential: unknown) => {
      expect(credential).toBe('socket-secret')
      return 'stable-principal'
    })
    /** Both real roots expose actual accepted Session views through the original SDK lookup. */
    const fixture = new NativeSocketAuth()
    await fixture.listen(verify)
    try {
      /** The public initiating root still performs native bilateral admission itself. */
      const initiator = await fixture.connect('socket-secret')
      await fixture.connection
      await fixture.admitted.promise
      /**
       * This exact original pending object is still independently observable at the native
       * boundary.
       */
      const pending = await fixture.pending.promise
      /** Current metadata remains the original read-only accepted view, with no invented principal. */
      const ready = fixture.context!.lookup('dialer-route')!.view
      expect(Object.keys(pending)).toEqual(['accept', 'close'])
      expect(ready.peerId).toBe('dialer-route')
      expect(JSON.stringify(ready)).not.toContain('socket-secret')
      await expect(pending.accept(async (channel) => channel)).rejects.toMatchObject({
        code: 'PROCESS_CHANNEL_CLOSED'
      })
      /** The original close promises, rather than deleted transport flags, expose physical terminal. */
      let initiatorClosed = false
      /** The independent accepting Session must also outlive its native listener. */
      let acceptedClosed = false
      void fixture.clientContext!.lookup('listener-route')!.handle.closed.then(() => {
        initiatorClosed = true
      })
      void fixture.context!.lookup('dialer-route')!.handle.closed.then(() => {
        acceptedClosed = true
      })
      await fixture.listener!.close()
      expect(initiatorClosed).toBe(false)
      expect(acceptedClosed).toBe(false)
      expect(await initiator.process.send('listener-route', 'echo', 7)).toBe(7)
      expect(ready.authentication?.principalId).toBe('stable-principal')
    } finally {
      await fixture.close()
    }
  })

  it('rejects absent verifier and non-loopback addresses before bind or dial', async () => {
    /** Public native construction receives the same missing-verifier condition at its current owner. */
    const fixture = new NativeSocketAuth()
    try {
      await expect(dialProcessByteChannel({ address: 'tcp://192.0.2.1:1' })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
      await expect(
        listenProcessByteChannel({
          address: 'tcp://0.0.0.0:0',
          onConnection: () => undefined,
          report: () => undefined
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      await expect(fixture.listen(undefined as never).then(() => undefined)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
    } finally {
      await fixture.close()
    }
  })

  it('closes both held and handshaking pending sockets without invoking the verifier', async () => {
    /** Only the first genuine pending is held; the second enters the original native Session owner. */
    const fixture = new NativeSocketAuth()
    fixture.holdNextPending()
    /** The actual configured verifier must remain untouched when neither peer sends hello. */
    const verify = vi.fn(() => 'principal')
    await fixture.listen(verify)
    /** Independent actual sockets retain the same two physical cleanup obligations. */
    const first = await dialProcessByteChannel({ address: fixture.listener!.address })
    /** The first original pending has not transferred its raw socket to a Session. */
    const pending = await fixture.pending.promise
    /** This second original socket enters actual Process carrier/Session preparation. */
    const second = await dialProcessByteChannel({ address: fixture.listener!.address })
    try {
      await fixture.nativeAttached.promise
      /** The real native report object is retained through observation without an error wrapper. */
      const attempt = fixture.connection
      await fixture.listener!.close()
      await expect(pending.accept(async (channel) => channel)).rejects.toMatchObject({
        code: 'PROCESS_CHANNEL_CLOSED'
      })
      await expect(attempt).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      expect(verify).toHaveBeenCalledTimes(0)
    } finally {
      await first.close()
      await second.close()
      await fixture.close()
    }
  })
})
