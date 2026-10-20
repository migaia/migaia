import { describe, expect, it } from 'vitest'
import { createPipeline } from '../src/index.js'
import { walkErrorCauses } from '@migaia/utils/error'

describe('audited middleware contracts', () => {
  it.each(['generator', 'async-generator'] as const)(
    'uses %s runner signals when lifting sync stages',
    async (mode) => {
      /** One runner owns all three sentinel identities, including those returned by lifted stages. */
      const signals = {
        halt: Symbol('halt'),
        continue: Symbol('continue'),
        undefined: Symbol('undefined')
      }
      const pipeline = createPipeline<number, typeof mode>({ mode, signals })
      /** Forwarded numbers must stay in the payload domain rather than becoming default symbols. */
      const values: number[] = []
      await pipeline.run([pipeline.lift((value, next) => next(value + 1), 'sync')], 1, (value) => {
        values.push(value)
      })
      expect(values).toEqual([2])
      /** A non-forwarding sync stage must halt under the same injected control set. */
      await pipeline.run([pipeline.lift(() => undefined, 'sync')], 1, (value) => {
        values.push(value)
      })
      expect(values).toEqual([2])
    }
  )

  it.each(['abort', 'inactive'] as const)(
    'checks %s after an outer stage returns from done',
    async (kind) => {
      /** Cancellation and host authority may change in supported onion tail work. */
      const controller = new AbortController()
      const inactive = new Error('host no longer active')
      let active = true
      let done = 0
      const pipeline = createPipeline<number>({
        mode: 'async',
        signal: controller.signal,
        assertActive: () => {
          if (!active) throw inactive
        }
      })
      await expect(
        pipeline.run(
          [
            async (value, next) => {
              await next(value)
              if (kind === 'abort') controller.abort()
              else active = false
            }
          ],
          1,
          () => {
            done++
          }
        )
      ).rejects.toBeInstanceOf(Error)
      expect(done).toBe(1)
    }
  )

  it('reads and validates one immutable option snapshot with getter causes', () => {
    /** A mode getter cannot change the admitted execution algebra on a second read. */
    let reads = 0
    const pipeline = createPipeline<number>({
      get mode() {
        return ++reads === 1 ? 'sync' : 'invalid'
      }
    } as never)
    expect(reads).toBe(1)
    expect(pipeline.mode).toBe('sync')
    /** Other constructor fields share the same option failure boundary. */
    const original = new Error('callback getter failed')
    expect(() =>
      createPipeline<number>({
        mode: 'sync',
        get assertActive(): () => void {
          throw original
        }
      })
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/middleware-pipeline',
        code: 'INVALID_OPTION',
        cause: original
      })
    )
  })

  it.each(['sync', 'async', 'generator', 'async-generator'] as const)(
    'identifies the original native stage failure in %s mode',
    async (mode) => {
      /** A native error keeps its identity and stack while gaining the owning boundary's code. */
      const original = new RangeError('stage failed')
      const pipeline = createPipeline<number, typeof mode>({ mode })
      let failure: unknown
      try {
        await pipeline.run(
          [
            () => {
              throw original
            }
          ],
          1,
          () => undefined
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toBe(original)
      expect(failure).toMatchObject({
        source: '@migaia/middleware-pipeline',
        code: 'EXECUTION_FAILED'
      })
    }
  )

  it.each([false, true])(
    'retains both failures when the error combiner throws (frozen: %s)',
    async (frozen) => {
      /** Three independently occurring failures must remain distinguishable through the boundary. */
      const stageFailure = new Error('stage failed')
      const downstreamFailure = new TypeError('downstream failed')
      const combinerFailure = new Error('combiner failed')
      if (frozen) Object.freeze(combinerFailure)
      const pipeline = createPipeline<number>({
        mode: 'async',
        combineStageAndDownstreamError: () => {
          throw combinerFailure
        }
      })
      const failure = await pipeline
        .run(
          [
            (_value, next) => {
              void next(1)
              throw stageFailure
            },
            () => {
              throw downstreamFailure
            }
          ],
          1,
          () => undefined
        )
        .catch((error: unknown) => error)
      if (!frozen) expect(failure).toBe(combinerFailure)
      expect([...walkErrorCauses(failure)]).toEqual(
        expect.arrayContaining([combinerFailure, stageFailure, downstreamFailure])
      )
    }
  )

  it.each([false, true])('propagates one downstream failure once (lifted: %s)', async (lifted) => {
    /** Awaiting next propagates the same failure; it does not create an independent stage failure. */
    const original = new TypeError('downstream failed')
    const pipeline = createPipeline<number>({ mode: 'async' })
    const outer = lifted
      ? pipeline.lift((value, next) => next(value), 'sync')
      : async (value: number, next: (value: number) => Promise<void>) => {
          await next(value)
        }
    const failure = await pipeline
      .run(
        [
          outer,
          () => {
            throw original
          }
        ],
        1,
        () => undefined
      )
      .catch((error: unknown) => error)
    expect(failure).toBe(original)
    expect(failure).not.toBeInstanceOf(AggregateError)
  })
  it('identifies a violation callback failure reached by a late captured next', () => {
    /** A captured next remains callable after run returns; its reporter owns this failure boundary. */
    let late!: (value: number) => void
    const original = new Error('late violation reporter failed')
    const pipeline = createPipeline<number>({
      mode: 'sync',
      onViolation: () => {
        throw original
      }
    })
    pipeline.run(
      [
        (_value, next) => {
          late = next
        }
      ],
      1,
      () => undefined
    )
    expect(() => late(2)).toThrow(original)
    expect(original).toMatchObject({
      source: '@migaia/middleware-pipeline',
      code: 'EXECUTION_FAILED'
    })
  })
})
