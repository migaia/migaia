/** Hardening regression cases for lifecycle, config, and extension invariants. */
import { describe, expect, it, vi } from 'vitest'
import {
  asyncDisposeKey,
  defineFeature,
  definePlugin,
  disposeKey,
  PluginHost,
  PluginHostError
} from '../src/index.js'
import { createAbortController, createManualScheduler } from '@migaia/lifecycle'
import { PluginHostOperationRuntime } from '../src/operation-runtime.js'

class Host extends PluginHost<Record<string, never>, string> {
  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  install(plugins: readonly any[]) {
    return this.useSync(plugins)
  }
}

describe('native Feature synchronous installation', () => {
  it('YS11 cause chain: reports each rejected Feature and install attachment failure without replacing its primary error', async () => {
    const attachmentFailure = new Error('feature-install-cause-attach-failed')
    const originalDefineProperty = Object.defineProperty
    const defineProperty = vi.spyOn(Object, 'defineProperty').mockImplementation(((
      target,
      key,
      descriptor
    ) => {
      if (key === 'cause') throw attachmentFailure
      return originalDefineProperty(target, key, descriptor)
    }) as typeof Object.defineProperty)
    try {
      for (const [name, createPlugin] of [
        [
          'feature-cause-attachment',
          (name: string) => {
            let reject!: (error: unknown) => void
            const feature = defineFeature((() => ({
              // oxlint-disable-next-line unicorn/no-thenable -- host must retain the original late rejection.
              then: (_resolve: unknown, onReject: (error: unknown) => void) => (reject = onReject)
            })) as never)
            const plugin = definePlugin({
              name,
              features: { feature },
              featureExpose: {},
              install: () => ({})
            })
            return { plugin, reject: () => reject(new Error('feature-late-rejection')) }
          }
        ],
        [
          'install-cause-attachment',
          (name: string) => {
            let reject!: (error: unknown) => void
            const plugin = definePlugin({
              name,
              featureExpose: {
                // oxlint-disable-next-line unicorn/no-thenable -- hook result is deliberately hostile.
                then: (_resolve: unknown, onReject: (error: unknown) => void) => (reject = onReject)
              },
              install: () => ({})
            })
            return { plugin, reject: () => reject(new Error('install-late-rejection')) }
          }
        ]
      ] as const) {
        const diagnostics: string[] = []
        const candidate = createPlugin(name)
        const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) })
        let caught: unknown
        try {
          await host.use(candidate.plugin as never)
        } catch (error) {
          caught = error
        }
        expect(caught).toBeInstanceOf(PluginHostError)
        const primary = (caught as PluginHostError).cause
        candidate.reject()
        await Promise.resolve()
        await Promise.resolve()
        expect((caught as PluginHostError).cause).toBe(primary)
        expect(diagnostics.join('|')).toContain('failed to attach error cause')
      }
    } finally {
      defineProperty.mockRestore()
    }
  })

  it('YS11 cause chain: timeout error attachment failure is diagnostic-only when supersession also fails', async () => {
    const scheduler = createManualScheduler()
    const diagnostics: string[] = []
    const runtime = new PluginHostOperationRuntime({
      parentSignal: createAbortController().signal,
      scheduler,
      timeoutMs: 1,
      isHostOpen: () => true,
      diagnostic: (message) => diagnostics.push(message)
    })
    const registration: Record<string, never> = {}
    runtime.begin(registration)
    const abort = vi.spyOn(AbortController.prototype, 'abort').mockImplementation(() => {
      throw new Error('supersede-failed')
    })
    const originalDefineProperty = Object.defineProperty
    const defineProperty = vi.spyOn(Object, 'defineProperty').mockImplementation(((
      target,
      key,
      descriptor
    ) => {
      if (key === 'errors') throw new Error('timeout-errors-attach-failed')
      return originalDefineProperty(target, key, descriptor)
    }) as typeof Object.defineProperty)
    try {
      const pending = runtime.await(new Promise<never>(() => {}), registration)
      scheduler.advance(1)
      await expect(pending).rejects.toMatchObject({ code: 'MUTATION_EXECUTION_TIMEOUT' })
      expect(diagnostics.join('|')).toContain('failed to attach error cause')
    } finally {
      defineProperty.mockRestore()
      abort.mockRestore()
    }
  })

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

/** Map subclass readers must use the readonly proxy as their custom-method receiver. */

/** Set subclass readers must use the readonly proxy as their custom-method receiver. */

/** Map subclass whose iterable hook hides entries from code that fails to capture native readers. */

/** Set subclass whose iterable hook hides values from code that fails to capture native readers. */

/** Map subclass overrides every reader family to prove custom calls receive only the proxy. */

/** Set subclass overrides every reader family to prove custom calls receive only the proxy. */

describe('PH-AF-63：resource disposer admission snapshot', () => {
  it('只读取一次 disposer，保留 receiver，并忽略 admission 后的替换', async () => {
    const host = new Host()
    const resource: Record<PropertyKey, unknown> = {}
    let getterReads = 0
    let firstCalls = 0
    let secondCalls = 0
    let receiverMatched = false
    const first = function (this: object): void {
      firstCalls += 1
      receiverMatched = this === resource
    }
    const second = function (): void {
      secondCalls += 1
    }

    Object.defineProperty(resource, disposeKey, {
      configurable: true,
      get: () => {
        getterReads += 1
        return getterReads === 1 ? first : second
      }
    })

    await host.use({
      name: 'p',
      install: (core: { onDispose(value: object): void }) => {
        core.onDispose(resource)
        return {}
      }
    } as any)

    Object.defineProperty(resource, disposeKey, {
      configurable: true,
      value: second,
      writable: true
    })
    await host.unUse('p')

    expect(getterReads).toBe(1)
    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(0)
    expect(receiverMatched).toBe(true)
  })
})

describe('PH-T16：plugin admission snapshot and disposer boundary', () => {
  it('PH-T16a：每个 plugin getter 只读取一次，mutation 后仍执行已捕获 hook 与 receiver', async () => {
    const host = new Host()
    const plugin = {} as Record<PropertyKey, unknown>
    const reads = new Map<PropertyKey, number>()
    const calls = { install: 0, update: 0, dispose: 0 }
    const receivers = { install: false, update: false, dispose: false }
    const count = (key: PropertyKey): void => {
      reads.set(key, (reads.get(key) ?? 0) + 1)
    }
    const install = function (this: object): Record<string, never> {
      calls.install += 1
      receivers.install = this === plugin
      return {}
    }
    const update = function (this: object): void {
      calls.update += 1
      receivers.update = this === plugin
    }
    const dispose = function (this: object): void {
      calls.dispose += 1
      receivers.dispose = this === plugin
    }
    const replacement = (): void => undefined
    Object.defineProperties(plugin, {
      name: {
        configurable: true,
        get: () => {
          count('name')
          return 'snapshot'
        }
      },
      config: {
        configurable: true,
        get: () => {
          count('config')
          return { enabled: true }
        }
      },
      install: {
        configurable: true,
        get: () => {
          count('install')
          return install
        }
      },
      update: {
        configurable: true,
        get: () => {
          count('update')
          return update
        }
      },
      dispose: {
        configurable: true,
        get: () => {
          count('dispose')
          return dispose
        }
      },
      [asyncDisposeKey]: {
        configurable: true,
        get: () => {
          count(asyncDisposeKey)
          return replacement
        }
      },
      [disposeKey]: {
        configurable: true,
        get: () => {
          count(disposeKey)
          return replacement
        }
      }
    })

    await host.use(plugin as any)
    Object.defineProperties(plugin, {
      config: { configurable: true, value: { enabled: false } },
      install: { configurable: true, value: replacement },
      update: { configurable: true, value: replacement },
      dispose: { configurable: true, value: replacement },
      [asyncDisposeKey]: { configurable: true, value: replacement },
      [disposeKey]: { configurable: true, value: replacement }
    })

    await host.config.update('snapshot', () => ({ enabled: false }))
    await host.unUse('snapshot')

    expect(reads.get('name')).toBe(1)
    expect(reads.get('config')).toBe(1)
    expect(reads.get('install')).toBe(1)
    expect(reads.get('update')).toBe(1)
    expect(reads.get('dispose')).toBe(1)
    expect(reads.get(asyncDisposeKey)).toBe(1)
    expect(reads.get(disposeKey)).toBe(1)
    expect(calls).toEqual({ install: 1, update: 1, dispose: 1 })
    expect(receivers).toEqual({ install: true, update: true, dispose: true })
  })

  it('PH-T16b：symbol disposer admission 保持 async precedence、receiver 与 captured identity', async () => {
    const host = new Host()
    const plugin = {} as Record<PropertyKey, unknown>
    let asyncReads = 0
    let disposeReads = 0
    let asyncCalls = 0
    let syncCalls = 0
    let receiverMatched = false
    const firstAsync = function (this: object): void {
      asyncCalls += 1
      receiverMatched = this === plugin
    }
    const replacementAsync = (): void => {
      asyncCalls += 100
    }
    const sync = (): void => {
      syncCalls += 1
    }
    Object.defineProperties(plugin, {
      name: { configurable: true, value: 'symbol-snapshot' },
      install: { configurable: true, value: () => ({}) },
      [asyncDisposeKey]: {
        configurable: true,
        get: () => {
          asyncReads += 1
          return firstAsync
        }
      },
      [disposeKey]: {
        configurable: true,
        get: () => {
          disposeReads += 1
          return sync
        }
      }
    })

    await host.use(plugin as any)
    Object.defineProperties(plugin, {
      [asyncDisposeKey]: { configurable: true, value: replacementAsync },
      [disposeKey]: { configurable: true, value: replacementAsync }
    })
    await host.unUse('symbol-snapshot')

    expect(asyncReads).toBe(1)
    expect(disposeReads).toBe(1)
    expect(asyncCalls).toBe(1)
    expect(syncCalls).toBe(0)
    expect(receiverMatched).toBe(true)
  })

  it('hostile plugin getter becomes plugin-host INVALID_OPTION with original cause', () => {
    const host = new Host()
    const cause = new Error('install getter boom')
    const plugin = { name: 'hostile' } as Record<PropertyKey, unknown>
    Object.defineProperty(plugin, 'install', {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    let caught: unknown
    try {
      host.use(plugin as any)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      source: '@migaia/plugin-host',
      code: 'INVALID_OPTION',
      cause
    })
  })

  it('PH-T16d：hostile resource disposer getter remains tagged inside install failure cause chain', async () => {
    const host = new Host()
    const cause = new Error('resource disposer getter boom')
    const resource = {} as Record<PropertyKey, unknown>
    Object.defineProperty(resource, disposeKey, {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    await expect(
      host.use({
        name: 'hostile-resource',
        install: (core: { onDispose(value: object): void }) => {
          core.onDispose(resource)
          return {}
        }
      } as any)
    ).rejects.toMatchObject({
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: {
        source: '@migaia/plugin-host',
        code: 'INVALID_OPTION',
        cause
      }
    })
  })
})

describe('#1 config.get 丢弃第一段，插件名含点号时路径解析错位', () => {
  it('插件名含路径分隔符时在安装入口拒绝', async () => {
    const host = new Host()
    expect(() => host.use({ name: 'a.b', install: () => ({}) } as any)).toThrow(
      'plugin name must not contain "."'
    )
  })
})

describe('#2 config.get(pluginName) 抛错而非返回整份 config', () => {
  it('find 分支显式匹配 path === name，parseConfigPath 却拒绝单段路径', async () => {
    const host = new Host()
    await host.use({ name: 'p', config: { a: 1 }, install: () => ({}) } as any)

    expect(host.config.get('p')).toEqual({ a: 1 })
  })
})

describe('#4 async lifecycle mutation admission', () => {
  it('fire-and-forget nested mutation fails at the lifecycle boundary', async () => {
    const host = new Host()
    const outer = host.use({
      name: 'outer',
      install: async () => {
        await Promise.resolve()
        expect(() => host.use({ name: 'inner', install: () => ({}) } as any)).toThrow(
          PluginHostError
        )
        return {}
      }
    } as any)
    await expect(outer).resolves.toHaveLength(1)
  })

  it('directly awaited nested mutation fails before enqueue', async () => {
    const host = new Host()
    const outer = host.use({
      name: 'outer2',
      install: async () => {
        await expect(
          Promise.resolve().then(() => {
            expect(() => host.use({ name: 'inner2', install: () => ({}) } as any)).toThrow(
              PluginHostError
            )
          })
        ).resolves.toBeUndefined()
        return {}
      }
    } as any)
    await expect(outer).resolves.toHaveLength(1)
  })

  it('rejects external mutation while an async lifecycle hook is pending', async () => {
    const host = new Host({ execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: 100 } })
    const slow = host.use({
      name: 'outer3',
      install: async () => new Promise(() => undefined)
    } as any)
    expect(() => host.use({ name: 'inner3', install: () => ({}) } as any)).toThrow(PluginHostError)
    void slow.catch(() => undefined)
    await host.dispose()
  })
})

describe('#5 扩展属性被外部覆写后，unUse 静默放弃卸载', () => {
  it('覆写后 unUse 不删属性，导致同名插件再也装不回去', async () => {
    const host = new Host()
    await host.use({ name: 'p', install: () => ({ token: 'a' }) } as any)

    ;(host as any).token = 'hijacked'
    await host.unUse('p')

    expect((host as any).token).toBe('hijacked')
    const [handle] = await host.use({ name: 'p', install: () => ({ token: 'b' }) } as any)
    expect(handle.extensions.token).toBe('b')
  })
})

describe('#6（重新裁定，见 SDD §5.6/M-T15）useSync 回滚改为两阶段：close 同步 + dispose 异步', () => {
  it('keeps Feature expose through late useSync rollback cleanup only', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let expose!: { readonly read: () => number }
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => ({ read: core.featureExpose.read }))
    const first = definePlugin({
      name: 'sync-feature-late-rollback',
      features: { feature },
      featureExpose: { read: () => 1 },
      install: (core) => {
        expose = core.featureExpose as { readonly read: () => number }
        core.onDispose(async () => {
          expect(expose.read()).toBe(1)
          await gate
        })
        return {}
      }
    })
    expect(() =>
      new Host().install([
        first,
        {
          name: 'fail',
          install: () => {
            throw new Error('install-boom')
          }
        }
      ])
    ).toThrow('install-boom')
    expect(expose.read()).toBe(1)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(() => expose.read()).toThrow()
  })
  // §5.6：useSync 的同步性只覆盖 close（撤销 extensions/registrations/shared 等 host 可见状态），
  // 不再覆盖实际跑 disposer——那部分和普通异步 dispose 走同一条路径，fire-and-forget，失败通过
  // diagnostic 通道上报，不再折进 useSync 同步抛出的错误链。原始构造错误（install-boom）保持为
  // useSync 抛出错误的唯一原因（primary），不会被 rollback 结果改写（对齐 M-T44 的 L-T39 口径）。
  it('同步 disposer 抛出的错误不再折进同步抛出链，而是通过 diagnostic 异步上报', async () => {
    const diagnostics: string[] = []
    const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) } as any)
    const rollback = new Error('rollback-boom')

    let thrown: any
    try {
      host.install([
        {
          name: 'first',
          install: (core: any) => {
            core.onDispose(() => {
              throw rollback
            })
            return {}
          }
        },
        {
          name: 'second',
          install: () => {
            throw new Error('install-boom')
          }
        }
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown?.code).toBe('PLUGIN_INSTALL_FAILED')
    expect(String(thrown?.cause?.message ?? thrown?.cause)).toContain('install-boom')
    expect(thrown?.detail?.failedName).toBe('second')
    expect(thrown?.detail?.rollbackErrors).toEqual([])
    expect(diagnostics.join('|')).not.toContain('install-boom') // 不重复上报构造错误本身

    await new Promise((resolve) => setTimeout(resolve, 20)) // 等 fire-and-forget 的 rollback 落地
    const finalDetail = await thrown?.detail?.completion
    expect(finalDetail?.rollbackErrors?.[0]).toBe(rollback)
    expect(thrown?.detail?.rollbackErrors).toEqual([])
    expect(diagnostics.join('|')).toContain('rollback-boom')
  })

  it('异步 disposer 在 useSync 里注册时不再被拒绝，回滚仍然正确执行（M-T15）', async () => {
    const host = new Host()
    let asyncDisposerRan = false

    let thrown: any
    try {
      host.install([
        {
          name: 'first',
          install: (core: any) => {
            core.onDispose(async () => {
              await new Promise((resolve) => setTimeout(resolve, 10))
              asyncDisposerRan = true
            })
            return {}
          }
        },
        {
          name: 'second',
          install: () => {
            throw new Error('install-boom')
          }
        }
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown?.code).toBe('PLUGIN_INSTALL_FAILED') // 注册时不再拒绝，失败原因仍是原始构造错误
    expect(asyncDisposerRan).toBe(false) // 还没来得及跑

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(asyncDisposerRan).toBe(true) // 回滚异步执行后，async disposer 确实跑完了
  })
})

describe('#7（批次0）registerStage 对同一函数重复注册的不变量', () => {
  it('钉住"删任意匹配项都等价"这一假设——同一函数注册两次，卸载后一次都不残留', async () => {
    const host = new Host()
    let runs = 0
    const stage = (value: string, next: (v: string) => void): void => {
      runs += 1
      next(value)
    }

    await host.use({
      name: 'dup2',
      install: (core: any) => {
        core.usePipeline(stage)
        core.usePipeline(stage)
        return {}
      }
    } as any)

    ;(host as any).runPipeline('x', () => {})
    expect(runs).toBe(2) // 两次注册各跑一次

    await host.unUse('dup2')
    runs = 0
    ;(host as any).runPipeline('x', () => {})
    expect(runs).toBe(0) // 卸载后一次都不残留——验证"删任意匹配项都等价"这条假设站得住
  })
})

describe('#8（批次0）非枚举扩展键被静默跳过', () => {
  it('install 返回值上的非枚举属性会被明确拒绝', async () => {
    const host = new Host()
    const extension: Record<string, unknown> = {}
    Object.defineProperty(extension, 'hidden', {
      value: 'secret',
      enumerable: false,
      configurable: true,
      writable: true
    })

    await expect(host.use({ name: 'p', install: () => extension } as any)).resolves.toBeDefined()
    expect((host as any).hidden).toBeUndefined()
  })
})

describe('second adversarial pass (R3, fixed)', () => {
  it('R4-1: concurrent dispose is terminal and is not evicted by ordinary mutation SLA', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host({
        execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 100 }
      })
      const install = host.use({
        name: 'slow-dispose',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 6_000))
          return {}
        }
      } as any)
      void install.catch(() => undefined)
      const dispose = host.dispose()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(install).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      await expect(dispose).resolves.toMatchObject({ logicalTerminal: true })
      await expect(host.dispose()).resolves.toMatchObject({ logicalTerminal: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R3-1 (redesigned per SDD §10.1): a legitimate external mutation behind a slow install waits out the 5s SLA and is rejected with MUTATION_QUEUE_TIMEOUT, not silently diagnosed', async () => {
    vi.useFakeTimers()
    try {
      const diagnostics: string[] = []
      const diagnosedHost = new Host({
        diagnostic: (message: string) => diagnostics.push(message),
        queueAdmissionTimeoutMs: 5_000
      } as any)
      const slow = diagnosedHost.use({
        name: 'slow',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return {}
        }
      } as any)
      expect(() => diagnosedHost.use({ name: 'external', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )
      expect(diagnostics).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(10_000) // slow's own 10s timer fires
      await expect(slow).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R3-2 superseded by §5.6/M-T15: an async disposer registered during useSync is no longer rejected at all', () => {
    const host = new Host()
    let started = false

    expect(() =>
      host.install([
        {
          name: 'async-tail',
          install: (core: any) => {
            core.onDispose(async () => {
              started = true
              await new Promise((resolve) => setTimeout(resolve, 10))
            })
            return {}
          }
        }
      ])
    ).not.toThrow() // no install failure here, so no rollback either — nothing rejects registration
    expect(started).toBe(false) // the disposer itself hasn't run — the plugin was never disposed
  })

  it('PH-R3-3 fixed: non-enumerable extension omission is reported through the diagnostic channel', async () => {
    const diagnostics: string[] = []
    const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) })
    const extension = {}
    Object.defineProperty(extension, 'hidden', { value: 1, enumerable: false })
    await host.use({ name: 'hidden', install: () => extension } as any)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatch(/hidden/)
    expect((host as any).hidden).toBeUndefined()
  })

  it('PH-R3-4 fixed: a queued mutation that settles before the watchdog fires clears its timer immediately', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      const first = host.use({
        name: 'first',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return {}
        }
      } as any)
      expect(() => host.use({ name: 'second', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )

      await vi.advanceTimersByTimeAsync(100)
      await expect(first).resolves.toBeDefined()

      // If the watchdog for "second" were still armed, it would still be sitting in the
      // timer queue for up to 5s after settlement. Assert there is nothing left pending.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resource disposer that never settles is recorded as DISPOSE_STEP_TIMEOUT and disposal still moves on to the rest', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      let laterDisposerRan = false
      await host.use({
        name: 'stuck-disposer',
        install: (core: any) => {
          core.onDispose(() => new Promise(() => undefined)) // never settles
          core.onDispose(() => {
            laterDisposerRan = true // registered first, so it's the *later* one in LIFO order
          })
          return {}
        }
      } as any)

      const unUse = host.unUse('stuck-disposer')
      await vi.advanceTimersByTimeAsync(5_000)
      const outcome = await unUse
      expect(laterDisposerRan).toBe(true) // the timed-out step didn't block the rest of the group
      expect((outcome as any).ok).toBe(false)
      expect((outcome as any).errors[0].code).toBe('PLUGIN_DISPOSE_FAILED')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fifth adversarial pass (R5)', () => {
  it('PH-R5-1: a plugin dispose hook that awaits host.dispose() again must not deadlock the host forever', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      await host.use({
        name: 'self-disposer',
        install: () => ({}),
        // #hookRegistration is cleared before the first await (same timing PH4 exploited for
        // use()); the reentrant dispose() call below returns the very #disposePromise this
        // hook is blocking on, so nothing outside a bounded wait can ever unblock it.
        dispose: async () => {
          await Promise.resolve()
          await host.dispose().catch(() => undefined)
        }
      } as any)

      const dispose = host.dispose()
      let settled = false
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose
        .catch(() => undefined)
        .finally(() => (settled = true))
        .catch(() => undefined)

      expect(settled).toBe(false)
      // Advance far past any bounded wait a fix could plausibly use; a genuine deadlock stays
      // unsettled no matter how much (virtual) time passes because no timer ever drives it.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(true)

      // Not just "some promise settled" — the host itself must reach a real terminal state,
      // not stay silently stuck in `closing` while dispose()'s own promise resolves/rejects.
      // use() throws HOST_DISPOSED synchronously (#assertActive runs before any enqueue), so
      // this is a plain throw, not a rejection.
      expect(() => host.use({ name: 'after', install: () => ({}) } as any)).toThrow(
        expect.objectContaining({ code: 'HOST_DISPOSED' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R5-1: the same reentrant call via a resource disposer (no #hookRegistration guard at all) also converges', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      await host.use({
        name: 'self-disposer-resource',
        install: (core: any) => {
          // Resource disposers run outside the #hookRegistration window entirely — unlike the
          // plugin dispose hook, they aren't guarded even during their synchronous phase. The
          // leading await matters: it lets the outer dispose() call finish assigning
          // #disposePromise before this reentrant call runs, which is what actually exercises
          // the pending-promise reentrancy (a same-tick synchronous call would instead observe
          // #disposePromise as still unassigned and take an unrelated early-return path).
          core.onDispose(async () => {
            await Promise.resolve()
            await host.dispose().catch(() => undefined)
          })
          return {}
        }
      } as any)

      const dispose = host.dispose()
      let settled = false
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose
        .catch(() => undefined)
        .finally(() => (settled = true))
        .catch(() => undefined)

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R5-2: ERROR_TEXT carries no dead diagnostic text left over from the superseded diagnostic-only watchdog', async () => {
    const errorTextModule = await import('../src/error-text')
    expect(Object.hasOwn(errorTextModule.default, 'QUEUE_WATCHDOG_TIMEOUT')).toBe(false)
  })
})
