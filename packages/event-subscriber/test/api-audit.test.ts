import { describe, expect, it } from 'vitest'
import { createEventChannel, invokeEachLive, withSnapshotEntries } from '../src/index.ts'
import { subscribeUntil } from '../src/subscriber.ts'

describe('audited event delivery contracts', () => {
  it('preserves an explicitly thrown undefined visitor value as cause', () => {
    /** Primitive visitor throws still need a reachable original on their coded wrapper. */
    const channel = createEventChannel<number>()
    try {
      withSnapshotEntries(channel, 0, () => {
        throw undefined
      })
      throw new Error('expected visitor failure')
    } catch (error) {
      expect(error).toMatchObject({ source: 'event.subscriber', code: 'VISITOR_FAILED' })
      expect(Object.hasOwn(error as object, 'cause')).toBe(true)
      expect((error as Error).cause).toBeUndefined()
    }
  })
  it.each(['recursive', 'queued'] as const)(
    'reports unfinished snapshot delivery under %s dispatch',
    (dispatchPolicy) => {
      /** Two targets exceed one top-level transaction invocation budget. */
      const channel = createEventChannel<number>({ dispatchPolicy, publishBudget: 1 })
      /** Only the admitted first delivery may execute before the budget failure. */
      const calls: number[] = []
      channel.subscribe(() => {
        calls.push(1)
      })
      channel.subscribe(() => {
        calls.push(2)
      })
      expect(() => channel.publish(0)).toThrowError(
        expect.objectContaining({ source: 'event.subscriber', code: 'PUBLISH_FAILED' })
      )
      expect(calls).toEqual([1])
    }
  )

  it('retains the projected alias through abort-linked context controls', () => {
    /** Canonical projection is evaluated once before either subscription sees the payload. */
    const channel = createEventChannel<
      { count: number },
      void,
      undefined,
      { readonly readPath: 'count'; readonly alias: 'total' }
    >({
      valueConfig: { readPath: 'count', alias: 'total' }
    })
    /** Abort must retain its helper-owned overlay rather than copy channel control methods. */
    const signal = new AbortController()
    /** Retained context proves projection data and live cancellation survive together. */
    let retained:
      | {
          readonly total: number | undefined
          readonly aborted: boolean
          readonly abortReason: unknown
        }
      | undefined
    subscribeUntil(channel, signal.signal, (event) => {
      retained = event
    })
    channel.publish({ count: 7 })
    expect(retained?.total).toBe(7)
    signal.abort('stop')
    expect(retained?.aborted).toBe(true)
    expect(retained?.abortReason).toBe('stop')
    expect(channel.size).toBe(0)
  })

  it.each(['snapshot', 'live'] as const)(
    'annotates a native %s visitor failure in place',
    (kind) => {
      /** Public visitor failure retains its exact native instance and stack. */
      const failure = new RangeError('visitor failed')
      /** A live invocation needs one registration to reach the visitor. */
      const channel = createEventChannel<number>()
      channel.subscribe(() => undefined)
      expect(() =>
        kind === 'snapshot'
          ? withSnapshotEntries(channel, 1, () => {
              throw failure
            })
          : invokeEachLive(channel, 1, () => {
              throw failure
            })
      ).toThrow(failure)
      expect(failure).toMatchObject({ source: 'event.subscriber', code: 'VISITOR_FAILED' })
    }
  )

  it('codes asynchronous snapshot visitor rejection and closes its entries', async () => {
    /** Rejection observation must use the same package boundary as a synchronous visitor throw. */
    const failure = new Error('async visitor failed')
    /** Retained invocation cannot be called after the failed visitor settles. */
    let invoke!: () => unknown
    /** A single registration is sufficient to capture the invocation lifetime. */
    const channel = createEventChannel<number>()
    channel.subscribe(() => undefined)
    await expect(
      withSnapshotEntries(channel, 1, async (entries) => {
        invoke = entries[0]!.invoke
        throw failure
      })
    ).rejects.toBe(failure)
    expect(failure).toMatchObject({ source: 'event.subscriber', code: 'VISITOR_FAILED' })
    expect(invoke).toThrowError(expect.objectContaining({ code: 'INVOCATION_CLOSED' }))
  })
})
