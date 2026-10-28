/** Exercises named pipeline execution, shared publication/drain and existing lane cost counters. */
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  defineHost,
  definePlugin,
  pipelineSpec,
  PluginHostError,
  type IPluginHostCoreFor,
  type IPluginInstallFailureDetail
} from '../../src/index.ts'
import { StageLaneCollection, StageLanes, type IStageSnapshot } from '../../src/stage-lanes.ts'

/** The sync lane's payload stays distinct from the asynchronous text lane. */
type INumberValue = Readonly<{ count: number }>
/** Text stages can transform content without widening the numeric lane's domain. */
type ITextValue = Readonly<{ text: string }>

/** Explicit unbounded budgets keep these business barriers independent from wall-clock deadlines. */
function createNamedHost() {
  return defineHost({
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    },
    pipelines: {
      numbers: pipelineSpec<INumberValue>()({ mode: 'sync' }),
      text: pipelineSpec<ITextValue>()({ mode: 'async', next: 'multiple', order: 'reverse' }),
      plain: pipelineSpec<number>()({})
    }
  })
}

/** Installers receive this exact host's inferred named payload and mode axes. */
type INamedCore = IPluginHostCoreFor<ReturnType<typeof createNamedHost>>

/** Both async lanes can hold independent leases for one installed owner. */
function createDrainHost() {
  return defineHost({
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    },
    pipelines: {
      first: pipelineSpec<number>()({ mode: 'async' }),
      second: pipelineSpec<number>()({ mode: 'async' })
    }
  })
}

/** The drain fixture borrows the same inferred plugin-facing stage registration contract. */
type IDrainCore = IPluginHostCoreFor<ReturnType<typeof createDrainHost>>

describe('named pipelines', () => {
  it('keeps distinct payloads, install/reverse order and multiple terminals under one owner', async () => {
    /** The actual stage entries establish order independently from the final payload. */
    const events: string[] = []
    /** One host owns all three declared lanes. */
    const host = createNamedHost()
    try {
      await host.use(
        definePlugin({
          name: 'first',
          install: (core: INamedCore) => {
            expect('run' in core.pipeline('numbers')).toBe(false)
            core.pipeline('numbers').use((value, next) => {
              events.push('first:number')
              next({ count: value.count + 1 })
            })
            core.pipeline('text').use(async (value, next) => {
              events.push(`first:${value.text}`)
              await next({ text: `${value.text}/first` })
            })
            return {}
          }
        }),
        definePlugin({
          name: 'second',
          install: (core: INamedCore) => {
            core.pipeline('numbers').use((value, next) => {
              events.push('second:number')
              next({ count: value.count * 2 })
            })
            core.pipeline('text').use(async (value, next) => {
              events.push('second:text')
              await next({ text: `${value.text}/second-a` })
              await next({ text: `${value.text}/second-b` })
            })
            return {}
          }
        })
      )
      expect(host.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(4)
      /** Each original branch contributes its own actual final terminal. */
      const completed: string[] = []
      await host.pipeline('text').run({ text: 'input' }, async (value) => {
        completed.push(value.text)
        return value.text
      })
      expect(events).toEqual([
        'first:number',
        'second:number',
        'second:text',
        'first:input/second-a',
        'first:input/second-b'
      ])
      expect(completed).toEqual(['input/second-a/first', 'input/second-b/first'])
    } finally {
      await host.dispose()
    }
  })

  it('defaults named next to single and rejects undeclared names at lookup', async () => {
    /** Omitted mode, next and order use the ordinary sync/single/install policy. */
    const host = createNamedHost()
    try {
      host.pipeline('plain').use((value, next) => {
        next(value + 1)
        next(value + 2)
      })
      expect(() => host.pipeline('plain').run(1, (value) => value)).toThrowError(
        expect.objectContaining({ code: 'PIPELINE_NEXT_DUPLICATE' })
      )
      expect(() => host.pipeline('missing' as never)).toThrowError(
        expect.objectContaining({ source: 'plugin.host', code: 'PIPELINE_UNKNOWN' })
      )
    } finally {
      await host.dispose()
    }
  })

  it('isolates same-named lanes across hosts and permits a nested run on another lane', async () => {
    /** Independent hosts deliberately declare identical public names. */
    const first = createNamedHost()
    /** The second lane inventory cannot borrow the first host's stage registrations. */
    const second = createNamedHost()
    /** Nested terminal output proves the inner run completes before the outer continuation. */
    const inner: number[] = []
    first.pipeline('plain').use((value, next) => next(value + 10))
    first.pipeline('numbers').use((value, next) => {
      inner.push(first.pipeline('plain').run(value.count, (item) => item)!)
      next({ count: value.count + 1 })
    })
    second.pipeline('numbers').use((value, next) => next({ count: value.count + 100 }))
    try {
      expect(first.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(2)
      expect(second.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(101)
      expect(inner).toEqual([11])
      expect(second.pipeline('plain').run(1, (value) => value)).toBe(1)
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('withdraws every lane atomically and drains both original snapshots before removal finishes', async () => {
    /** One plugin contributes stages to two independent, genuinely active async lanes. */
    const host = createDrainHost()
    /** Both original stages must enter before removal begins. */
    const firstEntered = deferred<void>()
    /** The second original run has its own lifecycle barrier. */
    const secondEntered = deferred<void>()
    /** Native completion of each lane releases only that lane's original lease. */
    const firstRelease = deferred<void>()
    /** Removal cannot finish after only the first lane settles. */
    const secondRelease = deferred<void>()
    /** Disposal observes the actual registration, not the first lane's completion. */
    const state = { removed: false, disposed: 0 }
    await host.use(
      definePlugin({
        name: 'held',
        install: (core: IDrainCore) => {
          core.pipeline('first').use(async (value, next) => {
            firstEntered.resolve()
            await firstRelease.promise
            await next(value + 1)
          })
          core.pipeline('second').use(async (value, next) => {
            secondEntered.resolve()
            await secondRelease.promise
            await next(value + 2)
          })
          core.onDispose(() => {
            state.disposed += 1
          })
          return {}
        }
      })
    )
    /** Each public result belongs to its own pre-removal snapshot. */
    const firstRunning = host.pipeline('first').run(10, async (value) => value)
    /** The second run keeps the same owner alive after the first one finishes. */
    const secondRunning = host.pipeline('second').run(10, async (value) => value)
    /** Visibility withdraws before cleanup, while the public revision commits after cleanup. */
    const withdrawn = deferred<void>()
    /** Observe the actual shared owner withdrawal without replacing its lifecycle work. */
    const originalRetire = StageLaneCollection.prototype.retireLeaseOwner
    /** This exact native withdrawal is the barrier for the two subsequent public execution checks. */
    const retirement = vi
      .spyOn(StageLaneCollection.prototype, 'retireLeaseOwner')
      .mockImplementation(function (this: StageLaneCollection<unknown>, ...args) {
        Reflect.apply(originalRetire, this, args)
        if (args[0].name === 'held') withdrawn.resolve()
      })
    try {
      await Promise.all([firstEntered.promise, secondEntered.promise])
      /** This original removal Promise must wait for both pipeline owner leases. */
      const removing = host.unUse('held').then((result) => {
        state.removed = true
        return result
      })
      await withdrawn.promise
      expect(await host.pipeline('first').run(10, async (value) => value)).toBe(10)
      expect(await host.pipeline('second').run(10, async (value) => value)).toBe(10)
      expect(state.removed).toBe(false)
      expect(state.disposed).toBe(0)
      firstRelease.resolve()
      expect(await firstRunning).toBe(11)
      expect(state.removed).toBe(false)
      expect(state.disposed).toBe(0)
      secondRelease.resolve()
      expect(await secondRunning).toBe(12)
      await expect(removing).resolves.toMatchObject({ ok: true })
      expect(state.removed).toBe(true)
      expect(state.disposed).toBe(1)
    } finally {
      firstRelease.resolve()
      secondRelease.resolve()
      await Promise.allSettled([firstRunning, secondRunning])
      await host.dispose()
      retirement.mockRestore()
    }
  })

  it('replaces both lanes in one publication and keeps only the new generation visible', async () => {
    /** Both versions use the same native registration name and original data-order slot. */
    const host = createNamedHost()
    /** The first actual owner supplies a distinct value in each named lane. */
    const previous = definePlugin({
      name: 'versioned',
      install: (core: INamedCore) => {
        core.pipeline('numbers').use((value, next) => next({ count: value.count + 1 }))
        core.pipeline('text').use(async (value, next) => next({ text: `${value.text}/old` }))
        return {}
      }
    })
    /** Replacement registers both new stages before the old owner loses visibility. */
    const replacement = definePlugin({
      name: 'versioned',
      install: (core: INamedCore) => {
        core.pipeline('numbers').use((value, next) => next({ count: value.count + 100 }))
        core.pipeline('text').use(async (value, next) => next({ text: `${value.text}/new` }))
        return {}
      }
    })
    try {
      await host.use(previous)
      expect(host.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(2)
      expect(await host.pipeline('text').run({ text: 'value' }, async (value) => value.text)).toBe(
        'value/old'
      )
      await host.replace('versioned', replacement)
      expect(host.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(101)
      expect(await host.pipeline('text').run({ text: 'value' }, async (value) => value.text)).toBe(
        'value/new'
      )
    } finally {
      await host.dispose()
    }
  })

  it('rolls back both named registrations without replacing the install primary with cleanup', async () => {
    /** Candidate registrations remain invisible if a later install step fails. */
    const host = createNamedHost()
    /** This primary must remain the first public failure after rollback. */
    const primary = new TypeError('named install primary')
    /** Cleanup failure is secondary and remains the original native instance. */
    const cleanup = new RangeError('named rollback cleanup')
    /** Public failure detail retains canonical rollback evidence, rather than a test collector. */
    const failure = await host
      .use(
        definePlugin({
          name: 'broken',
          install: (core: INamedCore) => {
            core.pipeline('numbers').use((value, next) => next({ count: value.count + 1 }))
            core.pipeline('text').use(async (value, next) => next({ text: `${value.text}/bad` }))
            core.onDispose(() => {
              throw cleanup
            })
            throw primary
          }
        })
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )
    try {
      expect(failure).toBeInstanceOf(PluginHostError)
      expect((failure as Error).cause).toBe(primary)
      expect(
        (failure as PluginHostError<IPluginInstallFailureDetail>).detail?.rollbackErrors
      ).toEqual([cleanup])
      expect(host.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(1)
      expect(await host.pipeline('text').run({ text: 'value' }, async (value) => value.text)).toBe(
        'value'
      )
      await host.use(definePlugin({ name: 'later', install: () => ({}) }))
      expect(host.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(1)
    } finally {
      await host.dispose()
    }
  })

  it('rejects host-owned registration on another lane during execution without publishing it', async () => {
    /** Registration guards apply to the whole host while any named lane executes. */
    const host = createNamedHost()
    host.pipeline('numbers').use((value, next) => {
      expect(() => host.pipeline('plain').use((item, forward) => forward(item + 100))).toThrowError(
        expect.objectContaining({ code: 'PIPELINE_EXECUTING' })
      )
      next(value)
    })
    try {
      expect(host.pipeline('numbers').run({ count: 1 }, (value) => value.count)).toBe(1)
      expect(host.pipeline('plain').run(1, (value) => value)).toBe(1)
      host.pipeline('plain').use((value, next) => next(value + 1))
      expect(host.pipeline('plain').run(1, (value) => value)).toBe(2)
    } finally {
      await host.dispose()
    }
  })

  it('cancels an active named run and closes every retained named execution handle', async () => {
    /** Retained handles must keep the canonical close fence after the host stops. */
    const host = createNamedHost()
    /** The sync handle checks the same host lifetime as the running async lane. */
    const numbers = host.pipeline('numbers')
    /** This actual async handle remains held after host disposal. */
    const text = host.pipeline('text')
    /** The stage must have entered before disposal supplies its original cancellation signal. */
    const entered = deferred<void>()
    /** Original stage signal proves cooperative cancellation reaches this real execution. */
    let signal: AbortSignal | undefined
    text.use(async (_value, _next, context) => {
      signal = context?.signal as AbortSignal
      entered.resolve()
      await new Promise<void>((resolve) => {
        signal!.addEventListener('abort', () => resolve(), { once: true })
      })
    })
    /** One pending pipeline execution owns its original lease until the abort is observed. */
    const running = text.run({ text: 'value' }, async (value) => value.text)
    await entered.promise
    /** Disposal joins pending work, with no extra test-side cancellation controller. */
    const closing = host.dispose()
    expect(signal?.aborted).toBe(true)
    await expect(running).rejects.toMatchObject({ code: 'HOST_DISPOSING' })
    await closing
    expect(() => numbers.run({ count: 1 }, (value) => value.count)).toThrowError(
      expect.objectContaining({ code: 'HOST_DISPOSED' })
    )
    await expect(text.run({ text: 'late' }, async (value) => value.text)).rejects.toMatchObject({
      code: 'HOST_DISPOSED'
    })
  })

  it('builds no empty snapshot and reuses one nonempty revision across one thousand runs', async () => {
    /** Existing lane methods provide counters without introducing production diagnostic ports. */
    const snapshot = vi.spyOn(StageLanes.prototype, 'snapshot')
    /** Retention delegates to the same original tracker and records each returned release. */
    const originalRetain = StageLanes.prototype.retainLeases
    /** Acquisition and release counts measure real execution leases, not terminal invocation. */
    const counts = { retained: 0, released: 0, terminals: 0 }
    /** The original receiver is required by StageLanes' private state; Reflect.apply preserves it. */
    const retained = vi.spyOn(StageLanes.prototype, 'retainLeases').mockImplementation(function (
      this: StageLanes<unknown>,
      key: object,
      current: IStageSnapshot<unknown>
    ) {
      counts.retained += 1
      /** This exact receipt belongs to the actual canonical quiescence tracker. */
      const release = Reflect.apply(originalRetain, this, [key, current])
      return () => {
        counts.released += 1
        release()
      }
    })
    /** Construction itself must not request snapshots or acquire execution leases. */
    const host = createNamedHost()
    /** Reuse one cold payload; the test counts runner overhead, not input allocations. */
    const input = { count: 1 }
    try {
      // The 1,000-run bound is the fixed acceptance count, not a growable collection.
      for (let index = 0; index < 1_000; index += 1)
        host.pipeline('numbers').run(input, (value) => {
          counts.terminals += 1
          return value.count
        })
      expect(counts).toEqual({ retained: 0, released: 0, terminals: 1_000 })
      expect(snapshot).not.toHaveBeenCalled()
      host.pipeline('numbers').use((value, next) => next({ count: value.count + 1 }))
      // The same fixed count exercises one unchanged nonempty lane revision.
      for (let index = 0; index < 1_000; index += 1)
        expect(host.pipeline('numbers').run(input, (value) => value.count)).toBe(2)
      expect(counts.retained).toBe(1_000)
      expect(counts.released).toBe(1_000)
      /** Repeated snapshot reads must return one existing compiled version, not rebuild arrays. */
      const versions = new Set(snapshot.mock.results.map((result) => result.value))
      expect(versions.size).toBe(1)
      host.pipeline('numbers').use((value, next) => next({ count: value.count + 10 }))
      expect(host.pipeline('numbers').run(input, (value) => value.count)).toBe(12)
      expect(new Set(snapshot.mock.results.map((result) => result.value)).size).toBe(2)
      expect(counts.retained).toBe(1_001)
      expect(counts.released).toBe(1_001)
    } finally {
      await host.dispose()
      retained.mockRestore()
      snapshot.mockRestore()
    }
  })

  it.each(['sync', 'async'] as const)(
    'releases the actual execution once after %s failure and still drains the owner',
    async (mode) => {
      /** Both supported failure paths must retain this exact original value. */
      const original = new Error('named execution failed')
      /** The existing observation counts actual acquisition and its original release callback. */
      const counts = { retained: 0, released: 0 }
      /** Delegation preserves the real quiescence tracker and its generation leases. */
      const originalRetain = StageLanes.prototype.retainLeases
      /** Only the existing lane seam is observed; no production counter or alternate runner exists. */
      const retained = vi.spyOn(StageLanes.prototype, 'retainLeases').mockImplementation(function (
        this: StageLanes<unknown>,
        key: object,
        snapshot: IStageSnapshot<unknown>
      ) {
        counts.retained++
        /** The real original receipt supplies all cleanup; the wrapper only counts invocation. */
        const release = Reflect.apply(originalRetain, this, [key, snapshot])
        return () => {
          counts.released++
          release()
        }
      })
      /** Existing declarations exercise both native execution modes without another fixture. */
      const host = createNamedHost()
      try {
        await host.use(
          definePlugin({
            name: 'settlement-failure',
            install(core: INamedCore) {
              if (mode === 'sync')
                core.pipeline('numbers').use(() => {
                  throw original
                })
              else
                core.pipeline('text').use(async () => {
                  throw original
                })
              return {}
            }
          })
        )
        if (mode === 'sync') {
          /** Capture the actual thrown value rather than comparing only its message. */
          let thrown: unknown
          try {
            host.pipeline('numbers').run({ count: 1 }, (value) => value.count)
          } catch (error) {
            thrown = error
          }
          expect(thrown).toBe(original)
        } else
          await expect(
            host.pipeline('text').run({ text: 'x' }, async (value) => value.text)
          ).rejects.toBe(original)
        expect(counts).toEqual({ retained: 1, released: 1 })
        await expect(host.unUse('settlement-failure')).resolves.toMatchObject({ ok: true })
        await expect(host.dispose()).resolves.toMatchObject({ cleanupComplete: true })
        expect(counts).toEqual({ retained: 1, released: 1 })
      } finally {
        await host.dispose()
        retained.mockRestore()
      }
    }
  )
})
