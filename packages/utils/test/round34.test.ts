import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  base64ToBytes,
  combineConfig,
  diagnosticSnapshot,
  ownConfig,
  onceAsync,
  patchConfig,
  retry,
  set,
  createManualScheduler,
  walkErrorCauses
} from '../src/index.js'

describe('round 34 contract regressions', () => {
  it('preserves missing-versus-undefined presence and array descriptors', () => {
    const source = [] as unknown[] & { hidden?: number }
    Object.defineProperty(source, 'hidden', { value: 4, enumerable: false, writable: false })
    const updated = (set as unknown as (object: unknown, path: unknown, value: unknown) => unknown)(
      source,
      ['value'],
      undefined
    ) as typeof source
    expect(Object.hasOwn(updated, 'value')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(updated, 'hidden')).toMatchObject({
      value: 4,
      enumerable: false,
      writable: false
    })
  })

  it('assimilates a promise from another realm exactly once', async () => {
    let calls = 0
    const foreignPromise = runInNewContext('Promise.resolve(7)') as Promise<number>
    const operation = onceAsync(() => {
      calls += 1
      return foreignPromise
    })
    const first = operation()
    expect(operation()).toBe(first)
    await expect(first).resolves.toBe(7)
    expect(calls).toBe(1)
    const plain = onceAsync(() => ({ value: 1 }) as never)
    await expect(plain()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    let thenReads = 0
    // oxlint-disable-next-line unicorn/no-thenable -- PromiseLike admission is the contract under test.
    const thenable = Object.defineProperty({}, 'then', {
      get: () => {
        thenReads += 1
        return (resolve: (value: number) => void) => resolve(8)
      }
    })
    await expect(onceAsync(() => thenable as never)()).resolves.toBe(8)
    expect(thenReads).toBe(1)
  })

  it('advances manual time at each due callback and preserves FIFO nesting', () => {
    const scheduler = createManualScheduler()
    const events: number[] = []
    scheduler.schedule(() => {
      events.push(scheduler.now())
      scheduler.schedule(() => events.push(scheduler.now()), 1)
    }, 5)
    scheduler.advance(10)
    expect(events).toEqual([5, 6])
    expect(scheduler.pendingCount).toBe(0)
  })

  it('does not cross the advance target after removing a cancelled heap root', () => {
    const scheduler = createManualScheduler()
    const events: number[] = []
    const cancelled = scheduler.schedule(() => events.push(0), 0)
    scheduler.schedule(() => events.push(scheduler.now()), 10)
    cancelled.cancel()
    scheduler.advance(0)
    expect(events).toEqual([])
    expect(scheduler.now()).toBe(0)
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(10)
    expect(events).toEqual([10])
  })

  it('does not spend the callback runaway budget on cancelled tombstones', () => {
    const scheduler = createManualScheduler()
    for (let index = 0; index < 10_001; index += 1) scheduler.schedule(() => undefined, 0).cancel()
    expect(() => scheduler.advance(0)).not.toThrow()
    expect(scheduler.pendingCount).toBe(0)
  })

  it('preserves the active heap task at the runaway boundary', () => {
    const scheduler = createManualScheduler()
    const events: number[] = []
    for (let index = 0; index < 10_002; index += 1) scheduler.schedule(() => events.push(index), 0)
    expect(() => scheduler.advance(0)).toThrowError(
      '[utils] manual scheduler exceeded the 10000-task advance guard'
    )
    expect(events).toHaveLength(10_000)
    expect(scheduler.pendingCount).toBe(2)
    scheduler.advance(0)
    expect(events.slice(-2)).toEqual([10_000, 10_001])
    expect(scheduler.pendingCount).toBe(0)
  })

  it('keeps large same-due batches within the ordered-queue operation budget', () => {
    const filterSpy = vi.spyOn(Array.prototype, 'filter')
    const sortSpy = vi.spyOn(Array.prototype, 'sort')
    try {
      for (const size of [2_000, 10_000]) {
        const scheduler = createManualScheduler()
        let executed = 0
        for (let index = 0; index < size; index += 1)
          scheduler.schedule(() => {
            executed += 1
          }, 0)
        scheduler.advance(0)
        expect(executed).toBe(size)
        expect(scheduler.pendingCount).toBe(0)
      }
      expect(filterSpy).not.toHaveBeenCalled()
      expect(sortSpy).not.toHaveBeenCalled()
    } finally {
      filterSpy.mockRestore()
      sortSpy.mockRestore()
    }
  })

  it('eagerly releases far-future cancellations before their due time', () => {
    const scheduler = createManualScheduler()
    for (let index = 0; index < 10_000; index += 1)
      scheduler.schedule(() => undefined, 1_000_000).cancel()
    expect(scheduler.pendingCount).toBe(0)
    scheduler.advance(0)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('preserves due-time and FIFO order across mixed active and cancelled tasks', () => {
    const scheduler = createManualScheduler()
    const events: string[] = []
    scheduler.schedule(() => events.push('late'), 10)
    const cancelled = scheduler.schedule(() => events.push('cancelled'), 5)
    scheduler.schedule(() => events.push('first'), 5)
    scheduler.schedule(() => events.push('middle'), 7)
    cancelled.cancel()
    scheduler.advance(10)
    expect(events).toEqual(['first', 'middle', 'late'])
    expect(scheduler.pendingCount).toBe(0)
  })

  it('combines isolated source graphs with default replace and undefined-ignore semantics', () => {
    const left = ownConfig({ nested: { value: 1 }, x: 1, map: new Map([['left', 1]]) })
    const right = ownConfig({ nested: { other: 2 }, x: undefined, map: new Map([['right', 2]]) })
    const combined = combineConfig([left, right])
    expect(left.nested).not.toHaveProperty('other')
    expect(combined.x).toBe(1)
    expect([...(combined.map as Map<string, number>).keys()]).toEqual(['right'])
  })

  it('keeps patch descriptors and built-in own state', () => {
    const date = new Date(0)
    Object.defineProperty(date, 'marker', { value: 'kept', enumerable: false })
    const base = ownConfig({ date, hidden: 1 })
    Object.defineProperty(base, 'hidden', { value: 1, enumerable: false, writable: false })
    const next = patchConfig(base, { changed: true })
    expect((next.date as Date & { marker: string }).marker).toBe('kept')
    expect(Object.getOwnPropertyDescriptor(next, 'hidden')).toMatchObject({
      enumerable: false,
      writable: false
    })
  })

  it('clones supported diagnostic subtrees beside unsupported leaves', () => {
    const map = new Map([['count', 1]])
    const date = new Date(0)
    const snapshot = diagnosticSnapshot({ map, date, fn: () => undefined })
    map.set('count', 2)
    date.setUTCFullYear(2030)
    expect((snapshot.value as { map: Map<string, number> }).map.get('count')).toBe(1)
    expect((snapshot.value as { date: Date }).date.getUTCFullYear()).toBe(1970)
  })

  it('recognizes foreign errors and rejects externally supplied timeout reasons', async () => {
    const foreignError = runInNewContext('new Error("foreign")') as Error
    expect(walkErrorCauses(foreignError)[0]).toBe(foreignError)
    const controller = new AbortController()
    const reason = new Error('user timeout reason')
    const pending = retry(() => new Promise<never>(() => undefined), {
      maxAttempts: 1,
      shouldRetry: () => false,
      signal: controller.signal
    })
    controller.abort(reason)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
  })

  it('rejects non-canonical padding bits without a second encoded copy', () => {
    expect(() => base64ToBytes('AB==')).toThrow()
    expect(base64ToBytes('AQ==')).toEqual(new Uint8Array([1]))
  })
})
