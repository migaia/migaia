import { describe, expect, it, vi } from 'vitest'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { matrixFixture } from './matrix-fixture.js'

describe('real native generation departure', () => {
  it.concurrent.each([false, true])(
    'real %s departure rejects inflight request and stream; proxy resumes only after describe',
    async (borrowed) => {
      const test = await matrixFixture({ borrowed, gated: true })
      try {
        await test.host.use(test.plugin)
        const peer = readRuntimeOutletConnection(test.outlet, 'p')!.peer
        expect(await peer.request('p.f.request', ['ready'])).toBe('child:ready')
        const request = peer.request('p.f.request', ['pending']).catch((error: unknown) => error)
        const stream = peer.stream('p.f.generator', ['departed'])
        expect(await stream.next()).toEqual({ done: false, value: 'departed:1' })
        expect(await stream.next()).toEqual({ done: false, value: 'departed:2' })
        const next = stream.next().catch((error: unknown) => error)
        await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:request-entered'))
        await test.closeGate('describe')
        if (borrowed) await test.rawChannels[0]!.close()
        else {
          await peer.request('p.f.request', ['exit'])
          expect(await test.handles[0]!.exited).toMatchObject({ code: 9 })
        }
        const departed = await request
        expect(departed, 'plugin departure contract').toMatchObject({
          code: 'REMOTE_RESULT_UNKNOWN',
          detail: { generation: 1 },
          cause: expect.anything()
        })
        expect(await next).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
        const closed = await peer
          .request('p.f.request', ['closed'])
          .catch((error: unknown) => error)
        expect(closed).toMatchObject({
          code: 'REMOTE_CLOSED',
          detail: { generation: 1 },
          cause: expect.anything()
        })
        const before = test.business
        await peer.request('p.f.request', ['again-closed']).catch(() => undefined)
        expect(test.business).toBe(before)
        if (!borrowed) {
          await vi.waitFor(async () =>
            expect((await peer.describe()).connections[0]!.unit).toMatchObject({ state: 'backoff' })
          )
          /** The real native lease retires independently from the supervisor's backoff transition. */
          await vi.waitFor(() => expect(test.budget.inUse).toBe(0))
        }
        test.scheduler.advance(1)
        await vi.waitFor(() =>
          expect(test.chunks.join('').split('matrix:describe-entered').length - 1).toBe(2)
        )
        await test.gate('describe')
        await vi.waitFor(
          async () =>
            expect(await peer.request('p.f.request', ['restored'])).toBe('child:restored'),
          { timeout: 5000 }
        )
        expect(readRuntimeOutletConnection(test.outlet, 'p')!.peer).toBe(peer)
        expect(test.chunks.join('').split('matrix:request-entered').length - 1).toBe(1)
        expect(test.chunks.join('').split('matrix:stream-entered:departed').length - 1).toBe(1)
        expect(await stream.next()).toEqual({ done: true, value: undefined })
        if (borrowed) {
          process.kill(test.handles[0]!.identity.pid!, 0)
          expect(await peer.request('p.f.request', ['peer-live'])).toBe('child:peer-live')
        }
      } finally {
        await test.cleanup()
      }
      expect(test.budget.inUse).toBe(0)
    },
    20000
  )
})
