import { describe, expect, it } from 'vitest'
import { sliceByFrameBudget } from '../src/index.ts'

import { rows, immediateYield, scheduler } from './fixtures/stream.ts'

describe('sliceByFrameBudget：按实测耗时定片大小', () => {
  it('covers every item exactly once and in order', async () => {
    const items = rows(1000)
    const seen: number[] = []
    for await (const slice of sliceByFrameBudget(items, {
      initialItems: 128,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      for (const row of slice) seen.push(row.id)
    }
    expect(seen).toEqual(items.map((row) => row.id))
  })

  it('shrinks the slice when the consumer overruns the budget', async () => {
    const sizes: number[] = []
    const clock = scheduler()

    for await (const slice of sliceByFrameBudget(rows(20_000), {
      targetMs: 8,
      initialItems: 8_192,
      yieldTo: immediateYield,
      scheduler: clock
    })) {
      sizes.push(slice.length)
      // 每片都假装花了 64ms，是预算的 8 倍 → 片大小必须一路缩小
      clock.advance(64)
    }

    expect(sizes[0]).toBe(8_192)
    expect(sizes[1]).toBeLessThan(sizes[0])
    expect(sizes[sizes.length - 1]).toBeLessThan(sizes[0])
  })

  it('grows the slice when the consumer finishes well under budget', async () => {
    const sizes: number[] = []
    const clock = scheduler()

    for await (const slice of sliceByFrameBudget(rows(200_000), {
      targetMs: 8,
      initialItems: 1_000,
      yieldTo: immediateYield,
      scheduler: clock
    })) {
      sizes.push(slice.length)
      clock.advance(0.5) // 远低于预算 → 应当放大
    }

    expect(sizes[1]).toBeGreaterThan(sizes[0])
  })

  it('never leaves the configured bounds', async () => {
    const sizes: number[] = []
    const clock = scheduler()

    for await (const slice of sliceByFrameBudget(rows(5_000), {
      targetMs: 8,
      minItems: 100,
      maxItems: 500,
      initialItems: 500,
      yieldTo: immediateYield,
      scheduler: clock
    })) {
      sizes.push(slice.length)
      clock.advance(sizes.length % 2 === 0 ? 0.01 : 500) // 剧烈抖动
    }

    // 末片可能不足 minItems（数据就剩那么多），其余都必须落在界内
    for (const size of sizes.slice(0, -1)) {
      expect(size).toBeGreaterThanOrEqual(100)
      expect(size).toBeLessThanOrEqual(500)
    }
  })

  it('stops as soon as the caller aborts', async () => {
    const controller = new AbortController()
    const seen: number[] = []
    const run = async () => {
      // 钳住 maxItems，否则片大小会指数放大、三片就吃完数据，取消根本没机会发生
      for await (const slice of sliceByFrameBudget(rows(10_000), {
        initialItems: 100,
        maxItems: 100,
        yieldTo: immediateYield,
        signal: controller.signal,
        scheduler: scheduler()
      })) {
        seen.push(slice.length)
        if (seen.length === 3) controller.abort()
      }
    }
    await expect(run()).rejects.toThrow()
    expect(seen).toHaveLength(3)
  })

  it('rejects a nonsensical budget up front', async () => {
    await expect(
      sliceByFrameBudget(rows(1), { targetMs: 0, scheduler: scheduler() }).next()
    ).rejects.toThrow('targetMs must be a finite positive number')
    await expect(
      sliceByFrameBudget(rows(1), { minItems: 10, maxItems: 5, scheduler: scheduler() }).next()
    ).rejects.toThrow('maxItems must be at least minItems')
  })

  it('rejects a missing scheduler (core 无默认 timer)', async () => {
    await expect(sliceByFrameBudget(rows(1), {} as never).next()).rejects.toThrow(
      'serialize scheduler must be { now, schedule }'
    )
  })

  it('rejects NaN before it can spin forever', async () => {
    // NaN <= 0 是 false，能穿过朴素的范围检查；随后 slice(0, NaN) 得到空数组、
    // index 不前进，while 永不结束。这一格就是守着那个死循环。
    for (const bad of [
      { initialItems: Number.NaN },
      { minItems: Number.NaN },
      { maxItems: Number.NaN },
      { targetMs: Number.NaN },
      { targetMs: Number.POSITIVE_INFINITY },
      { initialItems: 1.5 },
      { initialItems: 0 }
    ]) {
      await expect(
        sliceByFrameBudget(rows(10), { ...bad, scheduler: scheduler() }).next()
      ).rejects.toThrow(RangeError)
    }
  })

  it('handles an empty input without yielding anything', async () => {
    const slices: unknown[] = []
    for await (const slice of sliceByFrameBudget([], {
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      slices.push(slice)
    }
    expect(slices).toEqual([])
  })
})
