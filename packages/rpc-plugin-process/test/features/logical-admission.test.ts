import { nativeFeatureOutput } from '../native-feature.ts'
/** Exercises original Process capacity/FIFO owners with logical credits shared by physical writes. */
import { describe, expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  sendQueueFeature,
  flowControlFeature,
  IpcSendClass,
  IpcLogEventName,
  type IIpcBacklogEvent,
  type IProcessFeatureContext
} from '@migaia/rpc-plugin-process/features'

/** One genuine feature installation supplies connection facts without another queue or Host. */
function context(connectionId: string): IProcessFeatureContext {
  return {
    owner: connectionId,
    connectionId,
    signal: new AbortController().signal,
    report: (error) => {
      throw error
    }
  }
}

/** Native class facts remain local and independent from opaque codec data. */
const data = { sendClass: IpcSendClass.data }

describe('logical native write admission', () => {
  it('rejects admission when its high-watermark listener synchronously closes the original flow', async () => {
    /** Capacity one publishes its first high crossing during the reservation itself. */
    const installed = (
      await nativeFeatureOutput(flowControlFeature({ maxPendingData: 1 }))
    ).install(context('logical-reentrant-close'))
    /** The first close reason must survive the pre-frame admission boundary. */
    const reason = new Error('close during high-watermark delivery')
    installed.value.onEvent((event) => {
      if (event.name === IpcLogEventName['ipc.backlog.high']) installed.dispose(reason)
    })
    expect(() => installed.value.reserveWrite(data)).toThrow(reason)
    await installed.value.whenIdle()
  })

  it('returns shared-flow credit when a synchronous watermark observer closes only the borrowing queue', async () => {
    /** This exact complete definition owns capacity independently from its borrowing queue. */
    const feature = flowControlFeature({ maxPendingData: 1 })
    /** The explicit shared installation must remain usable after its queue closes. */
    const shared = (await nativeFeatureOutput(feature)).install(context('logical-shared-close'))
    /** Native queue borrows the original definition and value, without installing another flow. */
    const queue = (await nativeFeatureOutput(sendQueueFeature({ flow: feature }))).install({
      ...context('logical-shared-close'),
      flow: { feature, value: shared.value }
    })
    /** Only the queue closes during this reservation; its flow stays independently owned. */
    const reason = new Error('close borrowing queue during watermark')
    shared.value.onEvent((event) => {
      if (event.name === IpcLogEventName['ipc.backlog.high']) queue.dispose(reason)
    })
    expect(() => queue.value.reserveWrite(data)).toThrow(reason)
    await shared.value.whenIdle()
    /** Returned logical capacity can be borrowed directly from the original still-open owner. */
    const next = shared.value.reserveWrite(data)
    next.release()
    shared.dispose()
    await shared.value.whenIdle()
  })

  it('holds three logical credits for one physical flush and rejects the fourth', async () => {
    /** The original queue owns all three admitted messages and their shared physical completion. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 3 }))).install(
      context('logical-batch')
    )
    /** Actual native completion remains unresolved while capacity is inspected. */
    const native = deferred<void>()
    /** The Utils limiter exposes actual sender entry separately from scheduling admission. */
    const entered = deferred<void>()
    /** Each real message obtains its own capacity receipt before physical coalescing. */
    const credits = [
      installed.value.reserveWrite(data),
      installed.value.reserveWrite(data),
      installed.value.reserveWrite(data)
    ]
    /** Only the one genuine physical writer is counted here. */
    let writes = 0
    try {
      expect(() => installed.value.reserveWrite(data)).toThrowError(
        expect.objectContaining({ code: 'OVERLOADED' })
      )
      /** The physical flush borrows one original receipt without allocating a fourth credit. */
      const writing = installed.value.run(
        data,
        () => {
          writes += 1
          entered.resolve()
          return native.promise
        },
        { admission: credits[0] }
      )
      await entered.promise
      expect(writes).toBe(1)
      /** Logical capacity outlives physical completion until each original member settles. */
      const idle = installed.value.whenIdle()
      expect(installed.value.whenIdle()).toBe(idle)
      /** A resolved physical write alone cannot release any member's separately held credit. */
      let drained = false
      void idle.then(() => {
        drained = true
      })
      native.resolve()
      await writing
      expect(drained).toBe(false)
      for (const credit of credits) credit.release()
      await idle
      expect(drained).toBe(true)
      expect(writes).toBe(1)
    } finally {
      native.resolve()
      for (const credit of credits) credit.release()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('shares one credit across several physical fragments and releases it exactly once', async () => {
    /** Capacity one would reject a fragment if any physical write were counted again. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 1 }))).install(
      context('logical-chunks')
    )
    /** Existing events expose actual logical high/low crossings, not a parallel counter. */
    const events: IIpcBacklogEvent[] = []
    installed.value.onEvent((event) => {
      events.push(event)
    })
    /** All fragments borrow this exact reservation. */
    const credit = installed.value.reserveWrite(data)
    /** Real writer entry order still belongs to the original FIFO. */
    const written: number[] = []
    try {
      for (let fragment = 0; fragment < 4; fragment += 1)
        await installed.value.run(
          data,
          () => {
            written.push(fragment)
          },
          { admission: credit }
        )
      expect(written).toEqual([0, 1, 2, 3])
      expect(() => installed.value.reserveWrite(data)).toThrowError(
        expect.objectContaining({ code: 'OVERLOADED' })
      )
      credit.release()
      credit.release()
      await installed.value.whenIdle()
      expect(
        events.filter((event) => event.name === IpcLogEventName['ipc.backlog.high'])
      ).toHaveLength(1)
      expect(
        events.filter((event) => event.name === IpcLogEventName['ipc.backlog.low'])
      ).toHaveLength(1)
      /** Idempotent release cannot underflow capacity or prevent its next original admission. */
      const next = installed.value.reserveWrite(data)
      next.release()
    } finally {
      credit.release()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('cancels an unflushed member through the original queue guard with the exact close reason', async () => {
    /** The native queue owns cancellation while the batch member has no physical write yet. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 1 }))).install(
      context('logical-close')
    )
    /** Logical completion is supplied by the real batch-member owner. */
    const member = deferred<void>()
    /** One accepted member borrows the existing queued-cancellation registration. */
    const credit = installed.value.reserveWrite(data)
    /** First native close reason must survive the original cancellation and drain path. */
    const reason = new Error('original queue close')
    /** The original guard remover must also remain idempotent. */
    const remove = credit.guard!((failure) => member.reject(failure))
    /** Session releases the member receipt only after its actual completion rejects. */
    const completion = member.promise.finally(() => credit.release())
    installed.dispose(reason)
    await expect(completion).rejects.toBe(reason)
    remove?.()
    remove?.()
    await installed.value.whenIdle()
  })

  it('keeps active physical completion in drain after close and preserves its original failure once', async () => {
    /** A borrowed shared flow still owns the original pending native write. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 1 }))).install(
      context('logical-native-failure')
    )
    /** Native write completion remains strict even after local queue closure. */
    const native = deferred<void>()
    /** Closing starts only after the actual original physical sender has entered. */
    const entered = deferred<void>()
    /** The single logical call retains capacity around the accepted physical write. */
    const credit = installed.value.reserveWrite(data)
    /** Existing diagnostic events retain the actual original IO failure. */
    const events: IIpcBacklogEvent[] = []
    installed.value.onEvent((event) => {
      events.push(event)
    })
    /** Business promise observes the native failure while its finally returns capacity. */
    const writing = installed.value
      .run(
        data,
        () => {
          entered.resolve()
          return native.promise
        },
        { admission: credit }
      )
      .finally(() => credit.release())
    /** The original native failure must stay the rejected value. */
    const failure = new Error('native write failed')
    await entered.promise
    /** Drain is borrowed before shutdown and cannot complete merely because admission closes. */
    const idle = installed.value.whenIdle()
    /** Actual settlement is observed without a timing fixture. */
    let drained = false
    void idle.then(() => {
      drained = true
    })
    installed.dispose(new Error('close during native write'))
    await Promise.resolve()
    expect(drained).toBe(false)
    native.reject(failure)
    await expect(writing).rejects.toBe(failure)
    await idle
    expect(drained).toBe(true)
    // Original queue close removes subscribers, so no post-close diagnostic is delivered twice.
    expect(
      events.filter((event) => event.name === IpcLogEventName['ipc.send.failed'])
    ).toHaveLength(0)
  })
})
