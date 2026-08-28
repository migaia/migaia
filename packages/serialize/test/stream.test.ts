import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createManualScheduler } from '@migaia/lifecycle'
import {
  SerializeCodecError,
  chunkToText,
  collectStream,
  createSerializeRegistry,
  decodeStream,
  encodeStream,
  jsonPlugin,
  sliceByFrameBudget,
  type ISerializeChunk,
  type ISerializePlugin
} from '../src/index'

const rows = (count: number) => Array.from({ length: count }, (_, id) => ({ id }))

/** 立即让出，测试里不必真的等 setTimeout。 */
const immediateYield = () => Promise.resolve()

/** 每个需要 scheduler 的流测试各取一个独立手动时钟，避免用例间共享可变时钟。 */
const scheduler = () => createManualScheduler()

/** 局部类型化访问 node 的 process：应用工程刻意不引 @types/node， 不该为了一个测试把它拉进整个 src 的类型环境。 */
type IRejectionHost = {
  on(event: 'unhandledRejection', listener: () => void): void
  off(event: 'unhandledRejection', listener: () => void): void
}
const rejectionHost = (globalThis as { process?: IRejectionHost }).process

type ITestAbortSignal = {
  readonly aborted: boolean
  readonly reason: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Await one hostile-signal result and verify its rejection is observed without a detached event. */
const observeYieldResult = async (promise: Promise<unknown>): Promise<unknown> => {
  const unhandled = vi.fn()
  rejectionHost?.on('unhandledRejection', unhandled)
  const result = await promise.catch((caught: unknown) => caught)
  await Promise.resolve()
  rejectionHost?.off('unhandledRejection', unhandled)
  expect(unhandled).not.toHaveBeenCalled()
  return result
}

describe('sliceByFrameBudget：按实测耗时定片大小', () => {
  it('owns scheduler getter and clock failures at the serialize core boundary', async () => {
    const getterFailure = new Error('now getter failed')
    const getterScheduler = {
      get now(): () => number {
        throw getterFailure
      },
      schedule: () => ({ cancel() {} })
    }
    const callFailure = new Error('now call failed')
    const callScheduler = {
      now: () => {
        throw callFailure
      },
      schedule: () => ({ cancel() {} })
    }

    for (const schedulerOption of [getterScheduler, callScheduler]) {
      const error = await sliceByFrameBudget(rows(1), {
        scheduler: schedulerOption
      })
        .next()
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: '@migaia/serialize',
        code: 'INVALID_OPTION',
        cause: schedulerOption === getterScheduler ? getterFailure : callFailure,
        message:
          schedulerOption === getterScheduler
            ? 'serialize scheduler accessor could not be read'
            : 'serialize scheduler now() must return a number'
      })
    }
  })

  it('owns non-finite scheduler clock values with native RangeError semantics', async () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const error = await sliceByFrameBudget(rows(1), {
        scheduler: { now: () => value, schedule: () => ({ cancel() {} }) }
      })
        .next()
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(RangeError)
      expect(error).toMatchObject({
        source: '@migaia/serialize',
        code: 'INVALID_OPTION',
        message: 'serialize scheduler now() must return a finite number'
      })
    }
  })

  it('owns scheduler schedule and task cancel-accessor failures with causes', async () => {
    const scheduleFailure = new Error('schedule failed')
    const scheduleThrowing = {
      now: () => 0,
      schedule: () => {
        throw scheduleFailure
      }
    }
    const cancelGetterFailure = new Error('cancel getter failed')
    const cancelGetterThrowing = {
      now: () => 0,
      schedule: () => ({
        get cancel(): () => void {
          throw cancelGetterFailure
        }
      })
    }

    for (const schedulerOption of [scheduleThrowing, cancelGetterThrowing]) {
      const iterator = sliceByFrameBudget(rows(2), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        scheduler: schedulerOption
      })
      await iterator.next()
      const error = await iterator.next().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: '@migaia/serialize',
        code: 'INVALID_OPTION',
        cause: schedulerOption === scheduleThrowing ? scheduleFailure : cancelGetterFailure,
        message:
          schedulerOption === scheduleThrowing
            ? 'serialize scheduler must be { now, schedule }'
            : 'serialize scheduler task cancel accessor could not be read'
      })
    }
  })

  it('retains the default-yield task and cancels it once after asynchronous callback settlement', async () => {
    let runCallback: (() => void) | undefined
    const cancel = vi.fn()
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          runCallback = callback
          return { cancel }
        }
      }
    })

    await expect(iterator.next()).resolves.toMatchObject({ value: [{ id: 0 }], done: false })
    const next = iterator.next()
    await Promise.resolve()
    expect(cancel).not.toHaveBeenCalled()
    runCallback?.()
    await expect(next).resolves.toMatchObject({ value: [{ id: 1 }], done: false })
    expect(cancel).toHaveBeenCalledTimes(1)
    await iterator.return(undefined)
  })

  it('cancels a task returned after a synchronous default-yield callback', async () => {
    const cancel = vi.fn()
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return { cancel }
        }
      }
    })

    await iterator.next()
    await expect(iterator.next()).resolves.toMatchObject({ value: [{ id: 1 }], done: false })
    expect(cancel).toHaveBeenCalledTimes(1)
    await iterator.return(undefined)
  })

  it('settles default yield on abort and preserves cancel failure as secondary', async () => {
    const controller = new AbortController()
    const cancelFailure = new Error('yield cancel failed')
    let runCallback: (() => void) | undefined
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal: controller.signal,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          runCallback = callback
          return {
            cancel: () => {
              throw cancelFailure
            }
          }
        }
      }
    })

    await iterator.next()
    const next = iterator.next()
    await Promise.resolve()
    controller.abort('stream disposed')
    const error = await next.catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'ABORTED',
      cause: 'stream disposed',
      errors: [
        expect.objectContaining({
          source: '@migaia/serialize',
          code: 'INVALID_OPTION',
          cause: cancelFailure
        })
      ]
    })
    expect(cancelFailure).not.toBe(error)
    runCallback?.()
  })

  it('translates default-yield cancel failure to serialize INVALID_OPTION', async () => {
    const cancelFailure = new Error('cancel failed')
    let runCallback: (() => void) | undefined
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          runCallback = callback
          return {
            cancel: () => {
              throw cancelFailure
            }
          }
        }
      }
    })

    await iterator.next()
    const next = iterator.next()
    await Promise.resolve()
    runCallback?.()
    await expect(next).rejects.toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause: cancelFailure,
      message: 'serialize scheduler task cancel() failed'
    })
  })

  it.each(['stored-then-abort', 'abort-then-store'] as const)(
    'rechecks a signal that aborts synchronously during %s registration without scheduling',
    async (registrationOrder) => {
      const reason = `${registrationOrder} reason`
      let aborted = false
      let storedListener: (() => void) | undefined
      let removeCalls = 0
      let scheduleCalls = 0
      const signal: ITestAbortSignal = {
        get aborted() {
          return aborted
        },
        get reason() {
          return reason
        },
        addEventListener(_type, listener) {
          if (registrationOrder === 'abort-then-store') aborted = true
          storedListener = listener
          if (registrationOrder === 'stored-then-abort') aborted = true
        },
        removeEventListener(_type, listener) {
          removeCalls++
          expect(listener).toBe(storedListener)
        }
      }
      const iterator = sliceByFrameBudget(rows(2), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        signal,
        scheduler: {
          now: () => 0,
          schedule: () => {
            scheduleCalls++
            return { cancel: vi.fn() }
          }
        }
      })

      await iterator.next()
      const error = await observeYieldResult(iterator.next())
      expect(error).toMatchObject({
        source: '@migaia/serialize',
        code: 'ABORTED',
        cause: reason
      })
      expect(scheduleCalls).toBe(0)
      expect(removeCalls).toBe(1)
      expect(storedListener).toBeDefined()
    }
  )

  it('preserves stored-then-throw registration failure and listener cleanup failure', async () => {
    const registrationFailure = new Error('registration failed')
    const removeFailure = new Error('remove failed')
    let storedListener: (() => void) | undefined
    let removeCalls = 0
    let scheduleCalls = 0
    const signal: ITestAbortSignal = {
      aborted: false,
      reason: 'unused',
      addEventListener(_type, listener) {
        storedListener = listener
        throw registrationFailure
      },
      removeEventListener(_type, listener) {
        removeCalls++
        expect(listener).toBe(storedListener)
        throw removeFailure
      }
    }
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal,
      scheduler: {
        now: () => 0,
        schedule: () => {
          scheduleCalls++
          return { cancel: vi.fn() }
        }
      }
    })

    await iterator.next()
    const error = await observeYieldResult(iterator.next())
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      message: 'serialize abort signal listener registration failed',
      cause: registrationFailure,
      errors: [
        expect.objectContaining({
          source: '@migaia/serialize',
          code: 'INVALID_OPTION',
          cause: removeFailure
        })
      ]
    })
    expect(scheduleCalls).toBe(0)
    expect(removeCalls).toBe(1)
  })

  it.each([false, true] as const)(
    'keeps registration primary when addEventListener invokes abort before it %s',
    async (throwsAfterCallback) => {
      const registrationFailure = new Error('registration failed after callback')
      const reason = 'callback reason'
      let storedListener: (() => void) | undefined
      let removeCalls = 0
      let scheduleCalls = 0
      const signal: ITestAbortSignal = {
        get aborted() {
          return storedListener !== undefined
        },
        reason,
        addEventListener(_type, listener) {
          storedListener = listener
          listener()
          if (throwsAfterCallback) throw registrationFailure
        },
        removeEventListener(_type, listener) {
          removeCalls++
          expect(listener).toBe(storedListener)
        }
      }
      const iterator = sliceByFrameBudget(rows(2), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        signal,
        scheduler: {
          now: () => 0,
          schedule: () => {
            scheduleCalls++
            return { cancel: vi.fn() }
          }
        }
      })

      await iterator.next()
      const error = await observeYieldResult(iterator.next())
      if (throwsAfterCallback) {
        expect(error).toMatchObject({
          source: '@migaia/serialize',
          code: 'INVALID_OPTION',
          message: 'serialize abort signal listener registration failed',
          cause: registrationFailure
        })
      } else {
        expect(error).toMatchObject({
          source: '@migaia/serialize',
          code: 'ABORTED',
          cause: reason
        })
      }
      expect(scheduleCalls).toBe(0)
      expect(removeCalls).toBe(1)
    }
  )

  it('preserves abort primary when partial-registration listener removal fails', async () => {
    const removeFailure = new Error('abort listener remove failed')
    const reason = 'partial registration abort'
    let storedListener: (() => void) | undefined
    let aborted = false
    let removeCalls = 0
    const signal: ITestAbortSignal = {
      get aborted() {
        return aborted
      },
      reason,
      addEventListener(_type, listener) {
        storedListener = listener
        aborted = true
      },
      removeEventListener(_type, listener) {
        removeCalls++
        expect(listener).toBe(storedListener)
        throw removeFailure
      }
    }
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal,
      scheduler: {
        now: () => 0,
        schedule: () => {
          throw new Error('schedule must not run')
        }
      }
    })

    await iterator.next()
    const error = await observeYieldResult(iterator.next())
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'ABORTED',
      cause: reason,
      errors: [
        expect.objectContaining({
          source: '@migaia/serialize',
          code: 'INVALID_OPTION',
          cause: removeFailure
        })
      ]
    })
    expect(removeCalls).toBe(1)
  })

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

  it('rejects a missing scheduler (R-4: core 无默认 timer)', async () => {
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

describe('encodeStream：不拼装地吐流', () => {
  it('emits one chunk per slice instead of one blob', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunks: ISerializeChunk[] = []
    for await (const chunk of encodeStream(registry, rows(1_000), {
      initialItems: 250,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      chunks.push(chunk)
    }

    // 分了多片就该有多段，而不是被合并成一整块
    expect(chunks.length).toBeGreaterThan(1)
    const decoded = chunks.flatMap(
      (chunk) => JSON.parse(chunkToText(chunk, new TextDecoder())) as { id: number }[]
    )
    expect(decoded).toHaveLength(1_000)
    expect(decoded[0].id).toBe(0)
    expect(decoded[999].id).toBe(999)
    await registry.dispose()
  })

  it('keeps only maxInFlight requests outstanding', async () => {
    let live = 0
    let peak = 0
    const slow: ISerializePlugin = {
      type: 'slow',
      parser: {
        name: 'slow',
        encode: async (value) => {
          live++
          peak = Math.max(peak, live)
          await Promise.resolve()
          live--
          return ['text', JSON.stringify(value)] as ISerializeChunk
        },
        decode: (chunk) => JSON.parse(String(chunk[1]))
      }
    }
    const registry = createSerializeRegistry([slow])

    for await (const _chunk of encodeStream(registry, rows(2_000), {
      initialItems: 200,
      maxInFlight: 2,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      void _chunk
    }
    // 背压生效：在途永远不超过配置上限
    expect(peak).toBeLessThanOrEqual(2)
    await registry.dispose()
  })

  it('rejects an invalid in-flight limit', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    for (const bad of [0, -1, Number.NaN, 1.5]) {
      await expect(
        encodeStream(registry, rows(1), { maxInFlight: bad, scheduler: scheduler() }).next()
      ).rejects.toThrow('maxInFlight must be a positive integer')
    }
    await registry.dispose()
  })

  it('reports which slice failed', async () => {
    let calls = 0
    const flaky: ISerializePlugin = {
      type: 'flaky',
      parser: {
        name: 'flaky',
        encode: (value) => {
          if (++calls === 3) throw new Error('disk full')
          return ['text', JSON.stringify(value)] as ISerializeChunk
        },
        decode: (chunk) => JSON.parse(String(chunk[1]))
      }
    }
    const registry = createSerializeRegistry([flaky])

    const run = async () => {
      for await (const _chunk of encodeStream(registry, rows(1_000), {
        initialItems: 100,
        maxItems: 100,
        yieldTo: immediateYield,
        scheduler: scheduler()
      })) {
        void _chunk
      }
    }
    const error = await run().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(String(error)).toContain('disk full')
    await registry.dispose()
  })

  it('does not leave an unhandled rejection when the consumer bails early', async () => {
    const failing: ISerializePlugin = {
      type: 'failing',
      parser: {
        name: 'failing',
        encode: async () => {
          await Promise.resolve()
          throw new Error('later failure')
        },
        decode: () => undefined
      }
    }
    const registry = createSerializeRegistry([failing])
    const unhandled = vi.fn()
    rejectionHost?.on('unhandledRejection', unhandled)

    const stream = encodeStream(registry, rows(1_000), {
      initialItems: 100,
      maxInFlight: 4,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })
    // 只取一次就走人，剩下的在途请求必须被静默接住
    await stream.next().catch(() => undefined)
    await stream.return(undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rejectionHost?.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    await registry.dispose()
  })

  it('observes a rejecting queued encode immediately while draining in order', async () => {
    let resolveFirst!: (chunk: ISerializeChunk) => void
    const first = new Promise<ISerializeChunk>((resolve) => {
      resolveFirst = resolve
    })
    const secondFailure = new Error('second encode failed')
    let encodeCalls = 0
    const registry = {
      primaryType: 'test',
      encode: () => (++encodeCalls === 1 ? first : Promise.reject(secondFailure)),
      decode: async () => undefined,
      close: () => undefined,
      dispose: async () => undefined,
      types: ['test'] as const,
      has: () => true
    }
    const unhandled = vi.fn()
    rejectionHost?.on('unhandledRejection', unhandled)
    const stream = encodeStream(registry as never, rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      maxInFlight: 2,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })

    const firstRead = stream.next()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(unhandled).not.toHaveBeenCalled()

    resolveFirst(['text', 'first'])
    await expect(firstRead).resolves.toMatchObject({
      value: ['text', 'first'],
      done: false
    })
    const secondError = await stream.next().catch((error: unknown) => error)
    expect(secondError).toBeInstanceOf(SerializeCodecError)
    expect(secondError).toMatchObject({
      source: '@migaia/serialize',
      code: 'ENCODE_FAILED',
      cause: secondFailure
    })
    await stream.return(undefined)
    rejectionHost?.off('unhandledRejection', unhandled)
  })
})

describe('decodeStream 与 collectStream', () => {
  it('round-trips a stream slice by slice', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunks: ISerializeChunk[] = []
    for await (const chunk of encodeStream(registry, rows(500), {
      initialItems: 100,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      chunks.push(chunk)
    }

    const restored: { id: number }[] = []
    for await (const slice of decodeStream(registry, chunks)) {
      restored.push(...(slice as { id: number }[]))
    }
    expect(restored).toHaveLength(500)
    expect(restored[499].id).toBe(499)
    await registry.dispose()
  })

  it('reports which chunk failed to decode', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunks: ISerializeChunk[] = [
      ['text', '[{"id":1}]'],
      ['text', '{ broken']
    ]
    const run = async () => {
      for await (const _value of decodeStream(registry, chunks)) {
        void _value
      }
    }
    const error = await run().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SerializeCodecError)
    expect((error as SerializeCodecError).chunkIndex).toBe(1)
    await registry.dispose()
  })

  it('merges a stream back into one chunk when a full blob is required', async () => {
    const encoder = new TextEncoder()
    async function* mixed(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'AB']
      yield ['bytes', encoder.encode('CD')]
      yield ['text', 'EF']
    }
    expect(chunkToText(await collectStream(mixed(), encoder), new TextDecoder())).toBe('ABCDEF')

    async function* textOnly(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'a']
      yield ['text', 'b']
    }
    expect(await collectStream(textOnly())).toEqual(['text', 'ab'])

    async function* empty(): AsyncGenerator<ISerializeChunk> {}
    expect(await collectStream(empty())).toEqual(['text', ''])
  })

  it('MRC-SOL-F03 captures one encoder accessor and preserves its receiver', async () => {
    let getterReads = 0
    let receiver: unknown
    const encoder = {
      get encode() {
        getterReads += 1
        return function (this: unknown, input: string): Uint8Array {
          // oxlint-disable-next-line typescript/no-this-alias
          receiver = this
          return new TextEncoder().encode(input)
        }
      }
    }
    async function* mixed(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'A']
      yield ['bytes', new Uint8Array([66])]
    }

    expect(chunkToText(await collectStream(mixed(), encoder), new TextDecoder())).toBe('AB')
    expect(getterReads).toBe(1)
    expect(receiver).toBe(encoder)
  })

  it('MRC-C-T02 keeps Option A as one documented stream receiver boundary', () => {
    const source = readFileSync(new URL('../src/stream.ts', import.meta.url), 'utf8')
    expect(source).toContain('MRC-C-R02-only receiver boundary')
    expect(source).toContain('invokeCollectEncoderWithReceiver')
    expect(source.match(/Reflect\.apply/g)).toHaveLength(6)
  })

  it('refuses to merge a value chunk into a wire stream', async () => {
    async function* withValue(): AsyncGenerator<ISerializeChunk> {
      yield ['value', { a: 1 }]
    }
    await expect(collectStream(withValue())).rejects.toThrow('cannot collect a value chunk')
  })

  it('wraps hostile async and sync iterator protocol failures for decode and collect', async () => {
    type IProtocolScenario = {
      readonly name: string
      readonly cause: Error
      readonly make: () => unknown
      readonly cleanupCalls: { value: number }
      readonly expectedCleanup: number
    }
    const scenarios: IProtocolScenario[] = []
    const addGetterScenario = (
      name: string,
      key: typeof Symbol.asyncIterator | typeof Symbol.iterator
    ) => {
      const cause = new Error(`${name} getter failed`)
      const cleanupCalls = { value: 0 }
      scenarios.push({
        name,
        cause,
        cleanupCalls,
        expectedCleanup: 0,
        make: () => {
          const source: Record<PropertyKey, unknown> = {}
          Object.defineProperty(source, key, {
            get: () => {
              throw cause
            }
          })
          return source
        }
      })
    }

    addGetterScenario('async iterator', Symbol.asyncIterator)
    addGetterScenario('sync iterator', Symbol.iterator)
    for (const name of ['next', 'done', 'value', 'thenable'] as const) {
      const kinds =
        name === 'thenable' ? [Symbol.asyncIterator] : [Symbol.asyncIterator, Symbol.iterator]
      for (const kind of kinds) {
        const cause = new Error(
          `${name}-${kind === Symbol.asyncIterator ? 'async' : 'sync'} failed`
        )
        const cleanupCalls = { value: 0 }
        scenarios.push({
          name: `${name}-${kind === Symbol.asyncIterator ? 'async' : 'sync'}`,
          cause,
          cleanupCalls,
          expectedCleanup: kind === Symbol.asyncIterator ? 1 : 2,
          make: () => ({
            [kind]() {
              return {
                next: () => {
                  if (name === 'next') throw cause
                  if (name === 'done')
                    return {
                      get done() {
                        throw cause
                      }
                    }
                  if (name === 'value')
                    return {
                      done: false,
                      get value() {
                        throw cause
                      }
                    }
                  return {
                    // oxlint-disable-next-line unicorn/no-thenable -- hostile protocol fixture.
                    then: () => {
                      throw cause
                    }
                  }
                },
                return: () => {
                  cleanupCalls.value += 1
                  return { done: true, value: undefined }
                }
              }
            }
          })
        })
      }
    }

    for (const scenario of scenarios) {
      const decodeRegistry = createSerializeRegistry([jsonPlugin()])
      const decodeError = await decodeStream(decodeRegistry, scenario.make() as never, {
        type: 'json',
        context: 'hostile-protocol'
      })
        .next()
        .catch((error: unknown) => error)
      expect(decodeError, scenario.name).toBeInstanceOf(SerializeCodecError)
      expect((decodeError as { readonly cause?: unknown }).cause, scenario.name).toBe(
        scenario.cause
      )
      expect(decodeError, scenario.name).toMatchObject({
        source: '@migaia/serialize',
        code: 'DECODE_FAILED',
        phase: 'decode',
        type: 'json',
        context: 'hostile-protocol',
        chunkIndex: 0,
        cause: scenario.cause
      })
      await decodeRegistry.dispose()

      const collectError = await collectStream(scenario.make() as never).catch(
        (error: unknown) => error
      )
      expect(collectError, scenario.name).toBeInstanceOf(SerializeCodecError)
      expect(collectError, scenario.name).toMatchObject({
        source: '@migaia/serialize',
        code: 'ENCODE_FAILED',
        phase: 'encode',
        type: 'stream',
        context: 'stream',
        chunkIndex: 0,
        cause: scenario.cause
      })
      expect(scenario.cleanupCalls.value, scenario.name).toBe(scenario.expectedCleanup)
    }
  })
})
