import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHostError } from '../src/index.ts'
import { Host } from './hardening-fixtures.ts'

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

describe('#6 useSync 回滚改为两阶段：close 同步 + dispose 异步', () => {
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
  // useSync 的同步性只覆盖 close（撤销 extensions/registrations/shared 等 host 可见状态），
  // 不再覆盖实际跑 disposer——那部分和普通异步 dispose 走同一条路径，fire-and-forget，失败通过
  // diagnostic 通道上报，不再折进 useSync 同步抛出的错误链。原始构造错误（install-boom）保持为
  // useSync 抛出错误的唯一原因（primary），不会被 rollback 结果改写。
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

  it('异步 disposer 在 useSync 里注册时不再被拒绝，回滚仍然正确执行', async () => {
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
