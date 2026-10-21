import { describe, expect, it, vi } from 'vitest'
import { timeSlice, timeSliceMap, timeSliceReduce } from '../src/scheduler.js'

/** Clock that advances by `step` milliseconds on every read, so slices end deterministically. */
const steppingClock = (step: number) => {
  /** Current fake time. */
  let now = 0
  return {
    now: () => {
      now += step
      return now
    }
  }
}

describe('timeSlice', () => {
  it('splits work into slices and reports progress', async () => {
    /** Handled items in order. */
    const seen: number[] = []
    /** Progress reports. */
    const onProgress = vi.fn()
    // Each item costs one clock read of 4ms, so a budget of 8ms fits two items per slice.
    /** Final report. */
    const report = await timeSlice([1, 2, 3, 4, 5], (item) => seen.push(item), {
      budget: 8,
      clock: steppingClock(4),
      strategy: 'immediate',
      onProgress
    })
    expect(seen).toEqual([1, 2, 3, 4, 5])
    expect(report.processed).toBe(5)
    expect(report.slices).toBeGreaterThan(1)
    expect(onProgress).toHaveBeenCalledTimes(report.slices)
    expect(onProgress).toHaveBeenLastCalledWith(report)
  })

  it('runs at least one item per slice even when one item exceeds the budget', async () => {
    /** Report with one slice per item. */
    const report = await timeSlice(['a', 'b', 'c'], () => undefined, {
      budget: 1,
      clock: steppingClock(100),
      strategy: 'promise'
    })
    expect(report).toMatchObject({ processed: 3, slices: 4 })
  })

  it('maps and reduces in source order, including async sources and handlers', async () => {
    /** Async source. */
    async function* source() {
      yield 1
      yield 2
      yield 3
    }
    await expect(timeSliceMap(source(), async (value) => value * 2)).resolves.toEqual([2, 4, 6])
    await expect(timeSliceReduce([1, 2, 3], (sum, value) => sum + value, 0)).resolves.toBe(6)
    /** Generator work can be sliced directly. */
    function* job() {
      for (let index = 0; index < 3; index += 1) yield index
    }
    await expect(timeSliceMap(job(), (value) => value)).resolves.toEqual([0, 1, 2])
  })

  it('closes the iterator and rejects with the original handler error', async () => {
    /** Iterator cleanup spy. */
    const close = vi.fn()
    /** Iterable whose return() must run on failure. */
    const source = {
      [Symbol.iterator]() {
        /** Next value. */
        let value = 0
        return { next: () => ({ done: false, value: value++ }), return: close }
      }
    }
    /** Original failure. */
    const failure = new Error('handler')
    await expect(
      timeSlice(source, (value) => {
        if (value === 2) throw failure
      })
    ).rejects.toBe(failure)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('attaches iterator cleanup failures without replacing the primary error', async () => {
    /** Primary and cleanup failures. */
    const failure = new Error('primary')
    const cleanup = new Error('cleanup')
    /** Iterable whose return() throws. */
    const source = {
      [Symbol.iterator]() {
        return {
          next: () => ({ done: false, value: 1 }),
          return: () => {
            throw cleanup
          }
        }
      }
    }
    /** Rejection value. */
    const error = await timeSlice(source, () => {
      throw failure
    }).catch((reason: unknown) => reason)
    expect(error).toBe(failure)
    expect((error as { errors: unknown[] }).errors).toEqual([cleanup])
  })

  it('stops at the next item boundary on abort', async () => {
    /** Controller aborted by the handler. */
    const controller = new AbortController()
    /** Handled items. */
    const seen: number[] = []
    await expect(
      timeSlice(
        [1, 2, 3],
        (value) => {
          seen.push(value)
          if (value === 1) controller.abort('stop')
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'ABORTED', cause: 'stop' })
    expect(seen).toEqual([1])
  })

  it('validates arguments synchronously', () => {
    expect(() => timeSlice(1 as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => timeSlice([], 1 as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => timeSlice([], () => undefined, { budget: 0 })).toThrowError(
      expect.objectContaining({ name: 'RangeError', code: 'INVALID_ARGUMENT' })
    )
    expect(() => timeSlice([], () => undefined, { strategy: 'animationFrame' })).toThrowError(
      expect.objectContaining({ code: 'ENV_UNSUPPORTED' })
    )
  })
})
