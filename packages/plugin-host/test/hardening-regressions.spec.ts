import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin } from '../src/index.js'
import { createManualScheduler } from '@migaia/utils/testing'
import { Host } from './hardening-fixtures.js'

describe('native Feature synchronous installation', () => {
  it('uses the same registration initializer for useSync', () => {
    const feature = defineFeature(() => ({ value: () => 7 }))
    const plugin = definePlugin({
      name: 'sync-feature',
      features: { feature },
      featureExpose: {},
      install: (core) => ({ value: core.features.feature.value() })
    })
    const [handle] = new Host().install([plugin])
    expect(handle.extensions.value).toBe(7)
  })

  it('keeps Feature expose valid through disposer execution and revokes it after cleanup', async () => {
    let expose: { readonly read: () => number } | undefined
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => ({ read: core.featureExpose.read }))
    const plugin = definePlugin({
      name: 'feature-physical-dispose',
      features: { feature },
      featureExpose: { read: () => 1 },
      install: (core) => {
        expose = core.featureExpose as { readonly read: () => number }
        core.onDispose(() => expect(core.features.feature.read()).toBe(1))
        return {}
      }
    })
    const host = new Host()
    host.install([plugin])
    await host.dispose()
    expect(() => expose!.read()).toThrow()
  })

  // `featureExposeValid` 的置位从物理完成层提到逻辑撤销层：撤销一发生该标志即为 `false`，不再挂在
  // `featurePending.drain()` 之后的浮动 Promise 上。旧行为让「插件已离开 registry 但 expose 仍可调用」
  // 成为可观测窗口，并且在 disposer 永不 settle 时永远不生效——这里观测的正是它不再存在。
  it('invalidates Feature expose at logical revocation, not at physical cleanup', async () => {
    {
      const scheduler = createManualScheduler()
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let expose: { readonly read: () => number } | undefined
      let oldCore: any
      let entered!: () => void
      const enteredGate = new Promise<void>((resolve) => {
        entered = resolve
      })
      const feature = defineFeature<
        { readonly read: () => number },
        Record<never, never>,
        { readonly read: () => number }
      >((core) => ({ read: core.featureExpose.read }))
      const plugin = definePlugin({
        name: 'feature-timeout-dispose',
        features: { feature },
        featureExpose: { read: () => 1 },
        install: (core) => {
          oldCore = core
          expose = core.featureExpose as { readonly read: () => number }
          core.onDispose(async () => {
            // 撤销已经发生，expose 在 disposer 运行之前就已失效。
            expect(() => expose!.read()).toThrow()
            expect(() => oldCore.getShared('missing')).toThrow()
            entered()
            await gate
          })
          return {}
        }
      })
      const host = new Host({ scheduler, disposeStepTimeoutMs: 10 } as any)
      host.install([plugin])
      const dispose = host.dispose().catch((error: unknown) => error as any)
      await enteredGate
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
      scheduler.advance(10)
      const outcome: any = await dispose
      // 物理清理超时，调用方先拿回控制权；expose 的失效不依赖它落定。
      expect(outcome.cleanupComplete).toBe(false)
      expect(() => expose!.read()).toThrow()
      release()
      await outcome.physicalCompletion
      expect(() => expose!.read()).toThrow()
    }
  })

  it('does not let another registration pending cleanup extend a settled Feature expose', async () => {
    let firstExpose!: { readonly read: () => number }
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve
    })
    const scheduler = createManualScheduler()
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => ({ read: core.featureExpose.read }))
    const first = definePlugin({
      name: 'first-isolated-feature',
      features: { feature },
      featureExpose: { read: () => 1 },
      install: (core) => {
        firstExpose = core.featureExpose as { readonly read: () => number }
        return {}
      }
    })
    const second = {
      name: 'second-pending-dispose',
      install: (core: any) => {
        core.onDispose(async () => {
          entered()
          await gate
        })
        return {}
      }
    }
    const host = new Host({ scheduler, disposeStepTimeoutMs: 10 } as any)
    host.install([first, second])
    const dispose = host.dispose().catch((error: unknown) => error as any)
    await enteredGate
    scheduler.advance(10)
    await dispose
    expect(() => firstExpose.read()).toThrow()
    release()
    await dispose
  })
})
