import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it } from 'vitest'
import { createNodeThreadChannelFactory } from '../../src/threads/node-launcher.ts'
import { nativeFixture, workerEntry } from './fixture.ts'
import { RpcCallMode, RpcWireKind } from '@migaia/rpc-contract/protocol'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import type { IRpcNotifyOptions } from '@migaia/rpc-host'
import { threadFrames } from './frame.ts'
describe('thread Host facade', () => {
  it.each([false, true])(
    'Host forwards callWallTimeMs as the total request deadline (timeout disabled: %s)',
    async (disabled) => {
      /** The clock is advanced only after a real Worker has received the logical call. */
      const scheduler = createManualScheduler()
      /** Host requests use the same remote deadline owner as Plugin requests. */
      const host = nativeFixture({
        scheduler,
        channelFactory: createNodeThreadChannelFactory({ scheduler }),
        spec: { entry: workerEntry, limits: { callWallTimeMs: 100 } }
      })
      try {
        /** Adoption creates the actual Worker-side plugin before its never-finishing request. */
        await host.host.use(host.plugin)
        const outlet = host.host.thread!

        /** Caller allowance is larger, so the facade's 100 ms cap must win. */
        const result = outlet
          .send('p', 'p.hold', undefined, {
            timeout: disabled ? false : timeoutFeature({ ms: 200, scheduler })
          })
          .catch((error: unknown) => error)
        await expect
          .poll(
            async () =>
              (await threadFrames(host.frames)).some(
                (frame) =>
                  frame.kind === RpcWireKind.call &&
                  frame.task.mode === RpcCallMode.request &&
                  frame.task.method === 'p.hold'
              ),
            { timeout: 1000 }
          )
          .toBe(true)
        scheduler.advance(100)
        /** Allow cancellation settlement without waiting for a wall-clock timeout. */
        let settled = false
        void result.then(() => {
          settled = true
        })
        for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
        expect(settled).toBe(true)
        expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
        expect(
          (await threadFrames(host.frames)).filter(
            (frame) =>
              frame.kind === RpcWireKind.call &&
              frame.task.mode === RpcCallMode.request &&
              frame.task.method === 'p.hold'
          )
        ).toHaveLength(1)
      } finally {
        await host.close()
      }
      expect(scheduler.pendingCount).toBe(0)
    }
  )

  it('applies the native registration wall cap to a live stream with timeout disabled', async () => {
    /** The original native source clock is the only deadline owner in this case. */
    const scheduler = createManualScheduler()
    /** Only this fixture's actual provider selects the opt-in held stream. */
    const fixture = nativeFixture(
      { scheduler, spec: { entry: workerEntry, limits: { callWallTimeMs: 100 } } },
      { holdStream: true }
    )
    try {
      await fixture.host.use(fixture.plugin)
      /** Real stream opening and its first value precede the measured native cap. */
      const stream = fixture.host.thread.stream('p.stream', 'first', { timeout: false })
      expect(await stream.next()).toEqual({ value: 'first', done: false })
      /** A second original pull remains pending until the same cap cancels this stream. */
      const pending = stream.next()
      const failure = pending.catch((error: unknown) => error)
      scheduler.advance(100)
      expect(await failure).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    } finally {
      await fixture.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })

  it('uses two independent Worker Hosts and closes only one connection', async () => {
    const first = nativeFixture()
    const second = nativeFixture()
    try {
      await first.host.use(first.plugin)
      await second.host.use(second.plugin)
      const left = first.host.thread!
      const right = second.host.thread!

      expect(await left.send('p', 'p.read', 'first')).toBe('first')
      expect(await right.send('p', 'p.read', 'second')).toBe('second')

      const frames = first.frames.length
      await expect(left.send('p', 'unknown.read')).rejects.toMatchObject({
        code: 'PROVIDER_NOT_FOUND'
      })
      expect(first.frames).toHaveLength(frames)
      /** The actual public notify options include directed selection beyond this fixture's view. */
      const target: IRpcNotifyOptions = { targetId: 'p' }
      /** One-way methods obey the same current-directory refusal before their physical write. */
      await expect(left.notify('unknown.read', undefined, target)).rejects.toMatchObject({
        code: 'PROVIDER_NOT_FOUND'
      })
      /** A missing stream remains a plain lazy iterator and never sends its opening frame. */
      const unavailable = left.stream('unknown.read')
      expect(first.frames).toHaveLength(frames)
      /** The first local failure remains the exact sticky error on a repeated pull. */
      const failure = await unavailable.next().catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
      await expect(unavailable.next()).rejects.toBe(failure)
      expect(await unavailable.return('local')).toEqual({ done: true, value: 'local' })
      /** An unopened return closes locally before a scheduled first pull can start. */
      const unopened = left.stream('unknown.read')
      const pull = unopened.next()
      expect(await unopened.return('unopened')).toEqual({ done: true, value: 'unopened' })
      expect(await pull).toEqual({ done: true, value: undefined })
      expect(first.frames).toHaveLength(frames)
      await first.close()
      expect(await right.send('p', 'p.read', 'still live')).toBe('still live')
      expect(first.handles[0]!.identity.fingerprint).not.toBe(
        second.handles[0]!.identity.fingerprint
      )
    } finally {
      await first.close()
      await second.close()
    }
  })
})
