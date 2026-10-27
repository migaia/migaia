/** Exercises through at the public named-pipeline registration and native lifetime boundaries. */
import { expect, it, vi } from 'vitest'
import { defineHost, definePlugin, pipelineSpec, type IPluginHostCoreFor } from '../../src/index.js'
import { StageLanes } from '../../src/stage-lanes.js'

/** Every compatible lane carries the same application value without an implicit conversion. */
type IThroughValue = Readonly<{ count: number }>

/** Fixed declarations distinguish traversal order, runner mode and multiple-next admission. */
function createThroughHost(order: 'install' | 'reverse' = 'install') {
  return defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
    pipelines: {
      y: pipelineSpec<IThroughValue>()({ mode: 'async', order }),
      z: pipelineSpec<IThroughValue>()({ mode: 'async' }),
      synchronous: pipelineSpec<IThroughValue>()({ mode: 'sync' }),
      multipleSource: pipelineSpec<IThroughValue>()({ mode: 'async', next: 'multiple' }),
      multipleTarget: pipelineSpec<IThroughValue>()({ mode: 'async', next: 'multiple' })
    }
  })
}

/** Native install callbacks infer all named lanes from this one actual Host declaration. */
type IThroughCore = IPluginHostCoreFor<ReturnType<typeof createThroughHost>>

it('through splices every target stage before the remaining source and exposes its result', async () => {
  /** These entries observe original stage entry and post-next continuation order. */
  const events: string[] = []
  /** Target stages receive the actual result returned by the source terminal. */
  const results: unknown[] = []
  /** One native owner supplies both named pipeline declarations. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-onion',
        install: (core: IThroughCore) => {
          core.pipeline('y').use(async (value, next) => {
            events.push('y:before')
            await next({ count: value.count + 1 })
            events.push('y:before:after-next')
          })
          core.pipeline('y').through('z')
          core.pipeline('y').use(async (value, next) => {
            events.push('y:after')
            await next({ count: value.count + 1 })
          })
          core.pipeline('z').use(async (value, next) => {
            events.push('z:first')
            results.push(await next({ count: value.count + 3 }))
            events.push('z:first:after-next')
          })
          core.pipeline('z').use(async (value, next) => {
            events.push('z:second')
            results.push(await next({ count: value.count * 2 }))
            events.push('z:second:after-next')
          })
          return {}
        }
      })
    )
    expect(
      await host.pipeline('y').run({ count: 1 }, async (value) => {
        events.push('done')
        return value.count * 10
      })
    ).toBe(110)
    expect(events).toEqual([
      'y:before',
      'z:first',
      'z:second',
      'y:after',
      'done',
      'z:second:after-next',
      'z:first:after-next',
      'y:before:after-next'
    ])
    expect(results).toEqual([110, 110])
  } finally {
    await host.dispose()
  }
})

it('a target short circuit skips the remaining source stages and terminal', async () => {
  /** The remaining source callback cannot run after the target deliberately withholds next. */
  const after = vi.fn()
  /** The actual terminal remains independently observable from source stage entry. */
  const done = vi.fn(async (value: IThroughValue) => value.count)
  /** No private runner is substituted for either real pipeline. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-short-circuit',
        install: (core: IThroughCore) => {
          core.pipeline('y').through('z')
          core.pipeline('y').use(async (value, next) => {
            after()
            await next(value)
          })
          core.pipeline('z').use(async () => undefined)
          return {}
        }
      })
    )
    expect(await host.pipeline('y').run({ count: 1 }, done)).toBeUndefined()
    expect(after).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
  } finally {
    await host.dispose()
  }
})

it('an empty target adds no lease beyond the original nonempty source lane', async () => {
  /** The existing behavior test observes this canonical lease method without a production counter. */
  const retained = vi.spyOn(StageLanes.prototype, 'retainLeases')
  /** The source has a real through occurrence while the target has no visible stage. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-empty',
        install: (core: IThroughCore) => {
          core.pipeline('y').through('z')
          return {}
        }
      })
    )
    retained.mockClear()
    expect(await host.pipeline('y').run({ count: 7 }, async (value) => value.count)).toBe(7)
    /** One source execution lease means the empty target acquired zero additional leases. */
    expect(retained).toHaveBeenCalledTimes(1)
  } finally {
    await host.dispose()
    retained.mockRestore()
  }
})

it('the through occurrence follows the source pipeline reverse order', async () => {
  /** Source order applies to the bridge at its actual registration position. */
  const events: string[] = []
  /** Only the source reverses its installation sequence. */
  const host = createThroughHost('reverse')
  try {
    await host.use(
      definePlugin({
        name: 'through-reverse',
        install: (core: IThroughCore) => {
          core.pipeline('y').use(async (value, next) => {
            events.push('y:first')
            await next(value)
          })
          core.pipeline('y').through('z')
          core.pipeline('y').use(async (value, next) => {
            events.push('y:last')
            await next(value)
          })
          core.pipeline('z').use(async (value, next) => {
            events.push('z')
            await next(value)
          })
          return {}
        }
      })
    )
    await host.pipeline('y').run({ count: 1 }, async () => events.push('done'))
    expect(events).toEqual(['y:last', 'z', 'y:first', 'done'])
  } finally {
    await host.dispose()
  }
})

it.each([
  ['synchronous', 'PIPELINE_MODE_MISMATCH'],
  ['multipleTarget', 'INVALID_PIPELINE_OPTION']
] as const)('through rejects incompatible %s at registration', async (target, code) => {
  /** The target name is known; the deliberate assertion bypass reaches runtime option admission. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-incompatible',
        install: (core: IThroughCore) => {
          expect(() => core.pipeline('y').through(target as never)).toThrowError(
            expect.objectContaining({ source: 'plugin.host', code })
          )
          return {}
        }
      })
    )
  } finally {
    await host.dispose()
  }
})

it('through rejects a registration cycle without corrupting the preceding acyclic link', async () => {
  /** The target remains traversable exactly once after the rejected reverse edge. */
  const reached = vi.fn()
  /** Cycle admission is exercised on one actual native registration generation. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-cycle',
        install: (core: IThroughCore) => {
          core.pipeline('y').through('z')
          expect(() => core.pipeline('z').through('y')).toThrowError(
            expect.objectContaining({ source: 'plugin.host', code: 'INVALID_PIPELINE_OPTION' })
          )
          core.pipeline('z').use(async (value, next) => {
            reached()
            await next(value)
          })
          return {}
        }
      })
    )
    expect(await host.pipeline('y').run({ count: 4 }, async (value) => value.count)).toBe(4)
    expect(reached).toHaveBeenCalledTimes(1)
  } finally {
    await host.dispose()
  }
})

it('compatible multiple lanes retain both source continuations and their original order', async () => {
  /** Every original target branch reaches the source terminal once. */
  const completed: number[] = []
  /** Both lanes explicitly permit multiple calls to their continuation. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-multiple',
        install: (core: IThroughCore) => {
          core.pipeline('multipleSource').through('multipleTarget')
          core.pipeline('multipleTarget').use(async (value, next) => {
            await next({ count: value.count + 1 })
            await next({ count: value.count + 2 })
          })
          return {}
        }
      })
    )
    expect(
      await host.pipeline('multipleSource').run({ count: 1 }, async (value) => {
        completed.push(value.count)
        return value.count
      })
    ).toBe(3)
    expect(completed).toEqual([2, 3])
  } finally {
    await host.dispose()
  }
})

it('through and use return the same idempotent native occurrence removal handle', async () => {
  /** The original target callback remains installed after only its caller occurrence is removed. */
  const reached = vi.fn()
  /** One native install lends its actual bridge removal receipt to the public assertion. */
  let bridge: Readonly<{ remove(): void }> | undefined
  /** Ordinary use has the same removal surface and retains its own distinct occurrence. */
  let ordinary: Readonly<{ remove(): void }> | undefined
  /** The real source lane can outlive either registration occurrence. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-removal',
        install: (core: IThroughCore) => {
          ordinary = core.pipeline('y').use(async (value, next) => {
            await next({ count: value.count + 10 })
          })
          bridge = core.pipeline('y').through('z')
          core.pipeline('z').use(async (value, next) => {
            reached()
            await next({ count: value.count + 1 })
          })
          return {}
        }
      })
    )
    expect(await host.pipeline('y').run({ count: 1 }, async (value) => value.count)).toBe(12)
    bridge!.remove()
    bridge!.remove()
    expect(await host.pipeline('y').run({ count: 1 }, async (value) => value.count)).toBe(11)
    ordinary!.remove()
    ordinary!.remove()
    expect(await host.pipeline('y').run({ count: 1 }, async (value) => value.count)).toBe(1)
    expect(await host.pipeline('z').run({ count: 1 }, async (value) => value.count)).toBe(2)
    expect(reached).toHaveBeenCalledTimes(2)
  } finally {
    await host.dispose()
  }
})

it('unusing the native caller removes its through occurrence while the target owner remains', async () => {
  /** The target belongs to a different actual native registration. */
  const reached = vi.fn()
  /** This Host owns declared lanes; the bridge itself belongs only to the caller plugin. */
  const host = createThroughHost()
  try {
    await host.use(
      definePlugin({
        name: 'through-target-owner',
        install: (core: IThroughCore) => {
          core.pipeline('z').use(async (value, next) => {
            reached()
            await next({ count: value.count + 1 })
          })
          return {}
        }
      }),
      definePlugin({
        name: 'through-caller-owner',
        install: (core: IThroughCore) => {
          core.pipeline('y').through('z')
          return {}
        }
      })
    )
    expect(await host.pipeline('y').run({ count: 1 }, async (value) => value.count)).toBe(2)
    await expect(host.unUse('through-caller-owner')).resolves.toMatchObject({ ok: true })
    expect(await host.pipeline('y').run({ count: 1 }, async (value) => value.count)).toBe(1)
    expect(await host.pipeline('z').run({ count: 1 }, async (value) => value.count)).toBe(2)
    expect(reached).toHaveBeenCalledTimes(2)
  } finally {
    await host.dispose()
  }
})
