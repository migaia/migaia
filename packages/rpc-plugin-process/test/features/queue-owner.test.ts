import { nativeFeatureOutput } from '../native-feature.ts'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  sendQueueFeature,
  flowControlFeature,
  ipcLogFeature,
  IpcSendClass,
  IpcLogEventName,
  type IIpcLogRecord,
  type IProcessFeatureContext
} from '@migaia/rpc-plugin-process/features'

/** One original native installation supplies facts without a host, endpoint or alternate queue. */
function context(connectionId: string, sessionId?: string): IProcessFeatureContext {
  return {
    owner: connectionId,
    connectionId,
    sessionId,
    signal: new AbortController().signal,
    report: (error) => {
      throw error
    }
  }
}
/** Actual admitted classification is supplied by the concrete source, never reconstructed from wire. */
const data = { sendClass: IpcSendClass.data }
/** Reserved controls borrow the same physical FIFO while retaining their independent capacity. */
const control = { sendClass: IpcSendClass.control }

describe('process-owned IPC execution', () => {
  it('bounds original writes before execution and preserves their FIFO', async () => {
    /** The first genuine IO completion is held while the queue owns its actual capacity. */
    const first = deferred<void>()
    /** The original order oracle counts only actual physical sender entry. */
    const order: string[] = []
    /** One complete native feature installation owns the original utils FIFO. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 3 }))).install(
      context('a1')
    )
    /** Each application write enters the exact same installed owner. */
    const run = (id: string) =>
      installed.value.run(data, async () => {
        order.push(id)
        if (id === 'one') await first.promise
      })
    try {
      const accepted = [run('one'), run('two'), run('three')]
      await expect(run('four')).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(order, 'only the first admitted envelope may write').toEqual(['one'])
      first.resolve()
      await Promise.all(accepted)
      expect(order, 'admitted envelopes keep their order').toEqual(['one', 'two', 'three'])
    } finally {
      first.resolve()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('captures data capacity once and keeps the original reserved control capacity', async () => {
    /** Caller mutation must not reconfigure the native connection after cold definition capture. */
    const capacity = { maxPendingData: 1, maxPendingControl: 1 }
    const feature = sendQueueFeature(capacity)
    capacity.maxPendingData = 8
    const installed = (await nativeFeatureOutput(feature)).install(context('original-process-gate'))
    const records: IIpcLogRecord[] = []
    const remove = installed.value.onEvent((record) => records.push(record))
    const released = deferred<void>()
    try {
      const pending = installed.value.run(data, () => released.promise)
      await expect(installed.value.run(data, () => undefined)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      const acceptedControl = installed.value.run(control, () => undefined)
      await expect(installed.value.run(control, () => undefined)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(
        records.filter((record) => record.name === IpcLogEventName['ipc.backlog.rejected'])
      ).toHaveLength(2)
      released.resolve()
      await Promise.all([pending, acceptedControl])
    } finally {
      released.resolve()
      remove()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('waits for actual writability and emits one high/low crossing per capacity cycle', async () => {
    /** Four accepted writes cross high75%; physical completion alone returns them through low50%. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 4 }))).install(
      context('watermark')
    )
    const events: string[] = []
    const remove = installed.value.onEvent((event) => events.push(event.name))
    const first = deferred<void>()
    let idle = false
    const pending = [
      installed.value.run(data, () => first.promise),
      ...Array.from({ length: 3 }, () => installed.value.run(data, () => undefined))
    ]
    const drained = installed.value.whenIdle().then(() => {
      idle = true
    })
    try {
      await Promise.resolve()
      expect(idle).toBe(false)
      expect(events.filter((name) => name === 'ipc.backlog.high')).toHaveLength(1)
      first.resolve()
      await Promise.all([...pending, drained])
      expect(idle).toBe(true)
      expect(events.filter((name) => name === 'ipc.backlog.low')).toHaveLength(1)
    } finally {
      first.resolve()
      remove()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('reclaims cancelled queued capacity and never enters its original physical write', async () => {
    /** Only the existing utils limiter handles this actual caller cancellation. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 2 }))).install(
      context('queued-cancel')
    )
    const first = deferred<void>()
    const controller = new AbortController()
    const written: string[] = []
    const active = installed.value.run(data, () => first.promise)
    const cancelled = installed.value.run(
      data,
      () => {
        written.push('cancelled')
      },
      { signal: controller.signal }
    )
    controller.abort(new Error('cancelled'))
    try {
      await expect(cancelled).rejects.toBeDefined()
      const replacement = installed.value.run(data, () => {
        written.push('replacement')
      })
      first.resolve()
      await Promise.all([active, replacement])
      expect(written, 'cancelled queued work must never reach physical send').toEqual([
        'replacement'
      ])
    } finally {
      first.resolve()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('retains backlog/stderr identity while isolating synchronous and asynchronous sink failure', async () => {
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 1 }))).install(
      context('a5', 'session')
    )
    const records: IIpcLogRecord[] = []
    const reportErrors: unknown[] = []
    const sinkFailure = new Error('sink failure')
    const logging = (
      await nativeFeatureOutput(
        ipcLogFeature({
          report(record) {
            records.push(record)
            if (record.name === 'ipc.backlog.rejected') throw sinkFailure
            if (record.name === 'ipc.send.failed') return Promise.reject(sinkFailure)
          }
        })
      )
    ).install({
      ...context('a5', 'session'),
      gate: installed.value,
      onReportError: (error) => {
        reportErrors.push(error)
      }
    })
    const first = deferred<void>()
    try {
      logging.value.recordStderr({
        name: 'ipc.stderr',
        connectionId: 'a5',
        sessionId: 'session',
        text: 'stderr line'
      })
      const active = installed.value.run(data, () => first.promise)
      await expect(
        installed.value.run({ ...data, trace: 't1' }, () => undefined),
        'reporter failure must not rewrite capacity error'
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(reportErrors).toContain(sinkFailure)
      expect(records).toContainEqual(
        expect.objectContaining({
          name: 'ipc.backlog.rejected',
          connectionId: 'a5',
          sessionId: 'session',
          pendingData: 1,
          trace: 't1'
        })
      )
      first.resolve()
      await active
      const original = new Error('physical send failed')
      await expect(installed.value.run(data, () => Promise.reject(original))).rejects.toBe(original)
      await vi.waitFor(() => expect(reportErrors).toHaveLength(2))
      expect(
        records,
        'stderr must retain connection/session without invented trace'
      ).toContainEqual({
        name: 'ipc.stderr',
        connectionId: 'a5',
        sessionId: 'session',
        text: 'stderr line'
      })
    } finally {
      first.resolve()
      logging.dispose()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('contains sink reentry and disposes the exact shared-flow log subscription once', async () => {
    /** A shared complete flow is installed exactly once and lent to the queue's real native context. */
    const feature = flowControlFeature({ maxPendingData: 1 })
    const native = context('fixture-reentry')
    const flow = (await nativeFeatureOutput(feature)).install(native)
    const installed = (await nativeFeatureOutput(sendQueueFeature({ flow: feature }))).install({
      ...native,
      flow: { feature, value: flow.value }
    })
    const reentrantErrors: unknown[] = []
    const subscriptions = vi.spyOn(installed.value, 'onEvent')
    const logging = (
      await nativeFeatureOutput(
        ipcLogFeature({
          report(record) {
            if (record.name === 'ipc.backlog.high')
              void installed.value
                .run(data, () => undefined)
                .catch((error) => reentrantErrors.push(error))
          }
        })
      )
    ).install({ ...native, gate: installed.value, onReportError: () => undefined })
    const first = deferred<void>()
    try {
      expect(installed.value.flow).toBe(flow.value)
      expect(subscriptions).toHaveBeenCalledTimes(1)
      const release = logging.value.activate()
      expect(logging.value.activate()).toBe(release)
      expect(subscriptions).toHaveBeenCalledTimes(1)
      const active = installed.value.run(data, () => first.promise)
      await vi.waitFor(() =>
        expect(reentrantErrors, 'reporter reentry rejects at the same capacity bound').toEqual([
          expect.objectContaining({ code: 'OVERLOADED' })
        ])
      )
      first.resolve()
      await active
      logging.dispose()
      logging.dispose()
      const count = reentrantErrors.length
      await installed.value.run(data, () => undefined)
      expect(reentrantErrors).toHaveLength(count)
    } finally {
      first.resolve()
      logging.dispose()
      installed.dispose()
      flow.dispose()
      subscriptions.mockRestore()
      await installed.value.whenIdle()
    }
  })

  it('close retains active completion, cancels queued work by identity and shares pending drain', async () => {
    /** A genuine unresolved native write remains active even after logical admission closes. */
    const installed = (await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 2 }))).install(
      context('fixture-close')
    )
    const first = deferred<void>()
    /** Limiter admission precedes its task microtask; close starts only after real sender entry. */
    const entered = deferred<void>()
    const written: string[] = []
    const reason = new Error('original close reason')
    const active = installed.value.run(data, () => {
      entered.resolve()
      return first.promise
    })
    /** Observe failure immediately while retaining the original Promise for the completion oracle. */
    void active.catch(() => undefined)
    await entered.promise
    const queued = installed.value.run(data, () => {
      written.push('queued')
    })
    const idle = installed.value.whenIdle()
    expect(installed.value.whenIdle()).toBe(idle)
    let drained = false
    void idle.then(() => {
      drained = true
    })
    installed.dispose(reason)
    installed.dispose(new Error('later close reason'))
    try {
      await expect(queued).rejects.toBe(reason)
      await expect(installed.value.run(data, () => undefined)).rejects.toMatchObject({
        code: 'ENDPOINT_DISPOSED'
      })
      expect(written).toEqual([])
      expect(drained, 'whenIdle waits for the admitted physical send').toBe(false)
      first.resolve()
      await Promise.all([active, idle])
      expect(drained).toBe(true)
    } finally {
      first.resolve()
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('closes only the still-queued original batch member and preserves thrown undefined', async () => {
    const installed = (await nativeFeatureOutput(sendQueueFeature())).install(
      context('coalesced-close')
    )
    const pending = deferred<void>()
    const reason = new Error('coalesced original close')
    const cancel = vi.fn((failure: unknown) => pending.reject(failure))
    const write = installed.value.run(
      data,
      (guard) => {
        guard!(cancel)
        return pending.promise
      },
      { coalesced: true }
    )
    installed.dispose(reason)
    await expect(write).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    await installed.value.whenIdle()
    const independent = (await nativeFeatureOutput(flowControlFeature())).install(
      context('throw-undefined')
    )
    const failures: unknown[] = []
    try {
      await independent.value
        .run(data, () => {
          throw undefined
        })
        .then(
          () => expect.fail('the original native write must reject'),
          (error) => {
            failures.push(error)
          }
        )
      expect(failures).toEqual([undefined])
    } finally {
      independent.dispose()
      await independent.value.whenIdle()
    }
  })

  it('keeps duplicate callback receipts independent across removal and reentrant snapshots', async () => {
    const installed = (
      await nativeFeatureOutput(flowControlFeature({ maxPendingData: 1 }))
    ).install(context('listener-receipts'))
    const calls: string[] = []
    const duplicate = (event: IIpcLogRecord) => {
      if (event.name === 'ipc.backlog.high') calls.push('same')
    }
    const removeFirst = installed.value.onEvent(duplicate)
    const removeSecond = installed.value.onEvent(duplicate)
    await installed.value.run(data, () => undefined)
    expect(calls).toEqual(['same', 'same'])
    removeFirst()
    removeFirst()
    await installed.value.run(data, () => undefined)
    expect(calls).toEqual(['same', 'same', 'same'])
    removeSecond()
    const sequence: string[] = []
    let removeB: () => void = () => undefined
    installed.value.onEvent((event) => {
      if (event.name !== 'ipc.backlog.high') return
      sequence.push('A')
      removeB()
      installed.value.onEvent((next) => {
        if (next.name === 'ipc.backlog.high') sequence.push('D')
      })
    })
    removeB = installed.value.onEvent((event) => {
      if (event.name === 'ipc.backlog.high') sequence.push('B')
    })
    try {
      await installed.value.run(data, () => undefined)
      expect(sequence).toEqual(['A', 'B'])
      await installed.value.run(data, () => undefined)
      expect(sequence).toEqual(['A', 'B', 'A', 'D'])
    } finally {
      installed.dispose()
      await installed.value.whenIdle()
    }
  })

  it('coldly rejects a second capacity policy without altering the original installed flow', async () => {
    const first = flowControlFeature({ maxPendingData: 1 })
    const native = context('cold-policy-conflict')
    const installed = (await nativeFeatureOutput(first)).install(native)
    const other = flowControlFeature()
    /** Construct the second native output before the synchronous resource-admission assertion. */
    const otherExecution = await nativeFeatureOutput(sendQueueFeature({ flow: other }))
    const write = vi.fn()
    try {
      expect(() => sendQueueFeature({ flow: first, maxPendingData: 1 })).toThrowError(TypeError)
      expect(() =>
        otherExecution.install({
          ...native,
          flow: { feature: first, value: installed.value }
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
      await installed.value.run(data, write)
      expect(write).toHaveBeenCalledTimes(1)
    } finally {
      installed.dispose()
      await installed.value.whenIdle()
    }
  })
})
