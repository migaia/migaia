import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import {
  RpcWireKind,
  RpcStreamEvent,
  RpcWireStreamFinish,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcStreamLimit } from '@migaia/rpc-contract'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'

import { connectedCoreHosts } from '../host/core-fixture.ts'

/** Keep deadlines virtual while preserving the endpoint's ordinary zero-delay data handoff. */
function controlledDeadlineScheduler(): IScheduler & { advance(ms: number): void } {
  const manual = createManualScheduler()
  return {
    now: () => manual.now(),
    schedule: (task, delayMs) =>
      delayMs === 0 ? systemScheduler.schedule(task, 0) : manual.schedule(task, delayMs),
    advance: (ms) => manual.advance(ms)
  }
}

/** Return keeps its local value and releases the remote generator once. */
describe('streaming cancellation', () => {
  it('does not report an opened before-start stream failure again at its caller', async () => {
    /** The provider failure remains visible through the stream and its actual provider reporter. */
    const providerFailure = new RangeError('before-start provider failed')
    /** Caller diagnostics must not repeat a failure already delivered by next(). */
    const reports: unknown[] = []
    /** A provider report remains independently owned and must not be suppressed. */
    const providerReports: unknown[] = []
    /** Both ends use the same ordinary native handshake and real stream owner. */
    const fixture = await connectedCoreHosts(
      {
        values: function* () {
          yield 1
          throw providerFailure
        },
        barrier: () => true
      },
      {},
      (error) => providerReports.push(error),
      undefined,
      (error) => reports.push(error)
    )
    try {
      /** Opening detaches before-start cancellation without transferring error-report ownership. */
      const stream = fixture.b.memory.stream('values', null, {
        cancel: 'before-start'
      }) as AsyncIterableIterator<unknown>
      expect(await stream.next()).toEqual({ done: false, value: 1 })
      await expect(stream.next()).rejects.toMatchObject({
        name: 'RangeError',
        message: providerFailure.message
      })
      await fixture.b.memory.send('a', 'barrier')
      expect(providerReports).toEqual([providerFailure])
      expect(reports).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  it('does not send finish after a before-start stream has already ended', async () => {
    /** One finite provider completes before the caller returns its already-terminal iterator. */
    const fixture = await connectedCoreHosts({
      values: function* () {
        yield 1
      },
      barrier: () => true
    })
    try {
      /** The real before-start option activates the original finish-without-items protocol. */
      const stream = fixture.b.memory.stream('values', null, {
        cancel: 'before-start'
      }) as AsyncIterableIterator<unknown>
      expect(await stream.next()).toEqual({ done: false, value: 1 })
      expect(await stream.next()).toEqual({ done: true, value: undefined })
      expect(await stream.return?.('local')).toEqual({ done: true, value: undefined })
      await fixture.b.memory.send('a', 'barrier')
      expect(
        fixture.pair[1].written.filter(
          (frame) => frame.kind === RpcWireKind.stream && frame.stream.event === RpcWireStreamFinish
        )
      ).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  it('ignores an in-flight item and cancellation acknowledgement after local cancellation', async () => {
    /** Model a native-accepted item whose delivery completes after caller cancellation. */
    const accepted = deferred<void>()
    const deliver = deferred<void>()
    const acknowledged = deferred<void>()
    /** Only consumer diagnostics are relevant; provider cancellation keeps its existing owner. */
    const reports: unknown[] = []
    /** Cancellation of a provider's outstanding write is an acknowledgement, not a provider error. */
    const providerReports: unknown[] = []
    const fixture = await connectedCoreHosts(
      {
        values: function* () {
          yield 0
          yield 1
        },
        barrier: () => true
      },
      {},
      (error) => providerReports.push(error),
      undefined,
      (error) => reports.push(error)
    )
    /** Capture the real acknowledgement to prove its tombstone is removed after first receipt. */
    let acknowledgement: IRpcCarrierFrame | undefined
    const write = fixture.pair[0].write
    const delivery = vi
      .spyOn(fixture.pair[0], 'write')
      .mockImplementation(async (frame, options) => {
        const message = frame.data as IRpcSemanticFrame
        if (
          message.kind === RpcWireKind.stream &&
          message.stream.event === RpcStreamEvent.item &&
          message.stream.value === 1
        ) {
          /** Native acceptance consumes this handoff once before the held delivery completes. */
          await options?.onWriteStart?.()
          accepted.resolve()
          await deliver.promise
          return write(frame, { ...options, onWriteStart: undefined })
        }
        await write(frame, options)
        if (
          message.kind === RpcWireKind.stream &&
          message.stream.event === RpcStreamEvent.cancelled
        ) {
          acknowledgement = frame
          acknowledged.resolve()
        }
      })
    try {
      const caller = new AbortController()
      const reason = new Error('local stream cancellation')
      const stream = fixture.b.memory.stream('values', null, {
        signal: caller.signal
      }) as AsyncIterableIterator<unknown>
      expect(await stream.next()).toEqual({ done: false, value: 0 })
      const pending = stream.next()
      const rejection = expect(pending).rejects.toBe(reason)
      await accepted.promise
      caller.abort(reason)
      await rejection
      deliver.resolve()
      await acknowledged.promise
      await fixture.b.memory.send('a', 'barrier')
      expect(reports).toEqual([])
      expect(providerReports).toEqual([])
      /** An extra acknowledgement is unknown again after the expected terminal cleared history. */
      expect(acknowledgement).toBeDefined()
      await write(acknowledgement!)
      await fixture.b.memory.send('a', 'barrier')
      expect(reports).toEqual([expect.objectContaining({ code: 'INVALID_STREAM' })])
      await expect(stream.next()).rejects.toBe(reason)
    } finally {
      deliver.resolve()
      delivery.mockRestore()
      await fixture.close()
    }
  })

  it('bounds cancelled stream history while keeping the newest acknowledgement admissible', async () => {
    /** Lost acknowledgements keep history resident until its fixed capacity evicts old headers. */
    const acknowledgements: IRpcCarrierFrame[] = []
    const reports: unknown[] = []
    let acknowledged = deferred<void>()
    const fixture = await connectedCoreHosts(
      {
        values: function* () {
          yield 0
          yield 1
        },
        barrier: () => true
      },
      {},
      () => undefined,
      undefined,
      (error) => reports.push(error)
    )
    /** Drop only genuine generated acknowledgements at the native boundary, preserving all calls. */
    const write = fixture.pair[0].write
    const delivery = vi
      .spyOn(fixture.pair[0], 'write')
      .mockImplementation(async (frame, options) => {
        const message = frame.data as IRpcSemanticFrame
        if (
          message.kind === RpcWireKind.stream &&
          message.stream.event === RpcStreamEvent.cancelled
        ) {
          acknowledgements.push(frame)
          acknowledged.resolve()
          return
        }
        await write(frame, options)
      })
    try {
      /** The existing compile-time stream ceiling bounds history; this is a count, not a timer. */
      const count = RpcStreamLimit.maxOpenStreamsPerPeer + 1
      for (let index = 0; index < count; index++) {
        acknowledged = deferred<void>()
        const caller = new AbortController()
        const reason = new Error('bounded cancellation history')
        const stream = fixture.b.memory.stream('values', null, {
          signal: caller.signal
        }) as AsyncIterableIterator<unknown>
        expect(await stream.next()).toEqual({ done: false, value: 0 })
        caller.abort(reason)
        await expect(stream.next()).rejects.toBe(reason)
        await acknowledged.promise
      }
      expect(acknowledgements).toHaveLength(count)
      expect(reports).toEqual([])
      /** An evicted oldest task must remain an unknown stream rather than permanent history. */
      await write(acknowledgements[0]!)
      await fixture.b.memory.send('a', 'barrier')
      expect(reports).toEqual([expect.objectContaining({ code: 'INVALID_STREAM' })])
      /** The newest task still owns a marker; consuming it must not add a second diagnostic. */
      await write(acknowledgements.at(-1)!)
      await fixture.b.memory.send('a', 'barrier')
      expect(reports).toEqual([expect.objectContaining({ code: 'INVALID_STREAM' })])
    } finally {
      delivery.mockRestore()
      await fixture.close()
    }
  })

  it.each(['end', 'fail'] as const)(
    'absorbs an in-flight %s after local cancellation and removes its tombstone',
    async (event) => {
      /** The native terminal write is accepted before its delivery crosses local cancellation. */
      const accepted = deferred<void>()
      /** Release only this original native terminal after local cancellation becomes observable. */
      const deliver = deferred<void>()
      /** Caller diagnostics must absorb the expected first terminal. */
      const reports: unknown[] = []
      /** Genuine provider failure retains its separate reporting owner. */
      const providerReports: unknown[] = []
      /** The fail variant must report this exact original application Error at the provider. */
      const failure = new Error('natural stream failure')
      /** Both endpoints use their real public Host and streaming implementation. */
      const fixture = await connectedCoreHosts(
        {
          values: function* () {
            yield 0
            if (event === 'fail') throw failure
          },
          barrier: () => true
        },
        {},
        (error) => providerReports.push(error),
        undefined,
        (error) => reports.push(error)
      )
      /** Keep the genuine terminal frame for one duplicate after its marker has been consumed. */
      let terminal: IRpcCarrierFrame | undefined
      /** Hold only native delivery; production remains the sole terminal-construction owner. */
      const write = fixture.pair[0].write
      /** The native write spy preserves every unrelated frame and its real physical options. */
      const delivery = vi
        .spyOn(fixture.pair[0], 'write')
        .mockImplementation(async (frame, options) => {
          /** Identity codec frames expose the exact original semantic terminal. */
          const message = frame.data as IRpcSemanticFrame
          if (message.kind === RpcWireKind.stream && message.stream.event === event) {
            terminal = frame
            await options?.onWriteStart?.()
            accepted.resolve()
            await deliver.promise
            return write(frame, { ...options, onWriteStart: undefined })
          }
          /** A lost cancellation acknowledgment leaves the marker for the natural terminal. */
          if (
            message.kind === RpcWireKind.stream &&
            message.stream.event === RpcStreamEvent.cancelled
          )
            return
          await write(frame, options)
        })
      try {
        /** Caller cancellation controls its existing stream lifetime without retiring the source. */
        const caller = new AbortController()
        /** Iterator rejection must preserve this original caller-owned reason. */
        const reason = new Error('consumer cancelled before terminal delivery')
        /** The actual consumer admits its genuine provider before the terminal is intercepted. */
        const stream = fixture.b.memory.stream('values', null, {
          signal: caller.signal
        }) as AsyncIterableIterator<unknown>
        expect(await stream.next()).toEqual({ done: false, value: 0 })
        /** Real pull demand causes the provider to emit its natural terminal. */
        const pending = stream.next()
        /** Observe rejection before aborting to keep all promise ownership explicit. */
        const rejection = expect(pending).rejects.toBe(reason)
        await accepted.promise
        caller.abort(reason)
        await rejection
        deliver.resolve()
        await fixture.b.memory.send('a', 'barrier')
        expect(reports).toEqual([])
        expect(providerReports).toEqual(event === 'fail' ? [failure] : [])
        expect(terminal).toBeDefined()
        /** Replaying the already-consumed terminal is unclaimed, proving marker removal. */
        await write(terminal!)
        await fixture.b.memory.send('a', 'barrier')
        expect(reports).toEqual([expect.objectContaining({ code: 'INVALID_STREAM' })])
      } finally {
        deliver.resolve()
        delivery.mockRestore()
        await fixture.close()
      }
    }
  )

  it('sends one cancel and receives the producer cleanup acknowledgement', async () => {
    /** The complete call-only feature owns this clock; the Host retains its real clock. */
    const clientClock = controlledDeadlineScheduler()
    /** Count only the original generator's finally operations. */
    let cleaned = 0
    /** Release the original pending provider after observing local cancellation. */
    let resume!: () => void
    /** Provider suspension is application work, separate from production cancellation. */
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    /** Release the original deadline provider before final Host cleanup. */
    let resumeDeadline!: () => void
    /** A separate application Promise prevents the second generator from finishing early. */
    const deadlineBlocked = new Promise<void>((resolve) => {
      resumeDeadline = resolve
    })
    /** Providers are compiled before the one real native Session handshake. */
    const { a: server, b: client } = await connectedCoreHosts(
      {
        count: function* () {
          try {
            yield 'a'
            yield 'b'
          } finally {
            cleaned += 1
          }
        },
        wait: async function* () {
          yield 'a'
          await blocked
          yield 'b'
        },
        deadline: async function* () {
          yield 'a'
          await deadlineBlocked
          yield 'b'
        }
      },
      {},
      () => undefined,
      undefined,
      undefined,
      [
        rpcFeaturesPlugin({
          features: { deadline: timeoutFeature({ ms: 50, scheduler: clientClock }) }
        })
      ]
    )
    try {
      const iterator = client.memory.stream('count', null, {
        timeout: false
      }) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(await iterator.return?.('local')).toEqual({ done: true, value: undefined })
      expect(cleaned).toBe(1)
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      const thrown = client.memory.stream('count', null, {
        timeout: false
      }) as AsyncIterableIterator<unknown>
      expect(await thrown.next()).toEqual({ done: false, value: 'a' })
      const reason = new Error('caller stopped')
      await expect(thrown.throw?.(reason)).rejects.toBe(reason)
      expect(cleaned).toBe(2)
      const controller = new AbortController()
      const waiting = client.memory.stream('wait', null, {
        signal: controller.signal,
        timeout: false
      }) as AsyncIterableIterator<unknown>
      expect(await waiting.next()).toEqual({ done: false, value: 'a' })
      const pending = waiting.next()
      const abortReason = new Error('cancelled by caller')
      controller.abort(abortReason)
      await expect(pending).rejects.toBe(abortReason)
      await expect(waiting.next()).rejects.toBe(abortReason)
      resume()
      const timed = client.memory.stream('deadline', null) as AsyncIterableIterator<unknown>
      expect(await timed.next()).toEqual({ done: false, value: 'a' })
      const pendingDeadline = timed.next()
      clientClock.advance(50)
      let deadlineError: unknown
      try {
        await pendingDeadline
      } catch (error) {
        deadlineError = error
      }
      expect(deadlineError).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await expect(timed.next()).rejects.toBe(deadlineError)
      resumeDeadline()
    } finally {
      resume()
      resumeDeadline()
      await client.close()
      await server.close()
    }
  })
})
