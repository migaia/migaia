import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/lifecycle'
import { definePlugin, PluginHost } from '../src/index.js'
import { PluginHostErrorCode, type IPluginHostErrorCode } from '../src/error-code.js'
import type { IPluginConfig } from '../src/typing.js'

const options = { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } as const
class ConfigHost extends PluginHost<Record<string, never>, unknown> {
  protected createPluginDomainCore(): Record<string, never> {
    return {}
  }
}
// 形参故意保持 `object`：本文件喂给宿主的正是类型系统本该拒绝的形状（Date、类实例、含环对象、
// 访问器、符号键），要观测的是**运行期**准入守卫会拒绝它们。断言写在 `definePlugin` 的入参上，
// 这样用例仍能表达「类型上非法的值也必须被运行期拒绝」。
const install = (config: object) =>
  definePlugin({ name: 'config', config: config as IPluginConfig, install: () => ({}) })

describe('config value domain', () => {
  const expectInvalid = (
    value: object,
    path: string,
    // 显式标注为码的联合类型：默认值会把形参推断成那一个字面量，环拒绝那条用例就传不进来。
    code: IPluginHostErrorCode = PluginHostErrorCode.invalidConfigValue
  ) => {
    expect(() => install({ value })).toThrow(
      expect.objectContaining({
        code,
        detail: expect.objectContaining({ path, reason: expect.any(String) })
      })
    )
  }

  it('rejects a non-whitelisted prototype with path and reason detail', () => {
    expectInvalid(new Date() as unknown as object, 'value')
  })

  it('rejects a nested accessor with its exact path and reason detail', () => {
    const nested = Object.defineProperty({}, 'accessor', {
      get: () => 1,
      enumerable: true
    })
    expectInvalid({ nested }, 'value.nested.accessor')
  })

  it('rejects a non-enumerable own property with its exact path and reason detail', () => {
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 })
    expectInvalid({ hidden }, 'value.hidden.hidden')
  })

  it('rejects a dangerous __proto__ key with its exact path and reason detail', () => {
    const dangerous = Object.create(null)
    Object.defineProperty(dangerous, '__proto__', { value: 1, enumerable: true })
    expectInvalid({ dangerous }, 'value.dangerous')
  })

  it('rejects a constructor prototype with its exact path and reason detail', () => {
    class ConstructorValue {}
    expectInvalid({ constructorValue: new ConstructorValue() }, 'value.constructorValue')
  })

  it('rejects a symbol key with path and reason detail', () => {
    const symbolKey = Symbol('config')
    expectInvalid({ [symbolKey]: 1 }, 'value')
  })

  it('rejects a cycle with its exact path and reason detail', () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expectInvalid({ cycle }, 'value.cycle.self', PluginHostErrorCode.configCycleRejected)
  })

  it('rejects a thenable data property with its exact path and reason detail', () => {
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    const thenable = Object.defineProperty({}, thenKey, {
      value: () => undefined,
      enumerable: true
    })
    expectInvalid(thenable, 'value.then')
  })

  it('frozen root writes throw native TypeError and preserve same-path identity', async () => {
    const host = new ConfigHost(options)
    await host.use(install({ value: 1, nested: { value: 1 } }))
    const first = host.config.get('config') as { value: number }
    const repeated = host.config.get('config')
    expect(first).toBe(repeated)
    expect(() => {
      first.value = 2
    }).toThrow(TypeError)
  })

  it('frozen nested writes throw native TypeError and preserve same-path identity', async () => {
    const host = new ConfigHost(options)
    await host.use(install({ nested: { value: 1 } }))
    const first = host.config.get('config.nested') as { value: number }
    const repeated = host.config.get('config.nested')
    expect(first).toBe(repeated)
    expect(() => {
      first.value = 2
    }).toThrow(TypeError)
  })
  it('callable identity survives nested object and array config reads', async () => {
    const filter = () => true
    const host = new ConfigHost(options)
    await host.use(install({ nested: { filter }, filters: [filter] }))
    expect(host.config.get('config.nested.filter')).toBe(filter)
    expect(host.config.get('config.filters.[0]')).toBe(filter)
  })

  it('structural sharing keeps untouched roots while owning patched roots', async () => {
    const host = new ConfigHost(options)
    const shared = { value: 1 }
    const other = { value: 2 }
    await host.use(
      definePlugin({
        name: 'config',
        config: { keep: shared, other, change: { value: 1 } },
        // `update` 是返回 `void` 的通知钩子，不产出配置；保留它是为了让宿主走「插件带 update 钩子」
        // 那条分支，真正的改配置发生在下面的 `host.config.update`。
        update: () => {},
        install: () => ({})
      })
    )
    const before = host.config.get('config') as any
    await host.config.update('config', () => ({ change: { value: 2 } }))
    const after = host.config.get('config') as any
    expect(after.keep).toBe(before.keep)
    expect(after.other).toBe(before.other)
    expect(after.change).not.toBe(before.change)
    expect(Object.isFrozen(after.change)).toBe(true)
  })
  it('update rollback recipe throws', async () => {
    const host = new ConfigHost(options)
    const original = new Error('recipe')
    await host.use(
      definePlugin({ name: 'config', config: { value: 1 }, install: () => ({ extension: true }) })
    )
    const before = host.config.get('config')
    const revision = host.revision
    const view = host.getCurrentView()
    const extensions = view.extensions
    await expect(
      host.config.update('config', () => {
        throw original
      })
    ).rejects.toBe(original)
    expect(host.config.get('config')).toBe(before)
    expect(host.revision).toBe(revision)
    expect(view.extensions).toBe(extensions)
  })
  it('update rollback patch admission fails', async () => {
    const host = new ConfigHost(options)
    await host.use(
      definePlugin({ name: 'config', config: { value: 1 }, install: () => ({ extension: true }) })
    )
    const before = host.config.get('config')
    const revision = host.revision
    const view = host.getCurrentView()
    const extensions = view.extensions
    await expect(
      host.config.update('config', () => ({ value: new Map() }) as any)
    ).rejects.toMatchObject({ code: PluginHostErrorCode.invalidConfigValue })
    expect(host.config.get('config')).toBe(before)
    expect(host.revision).toBe(revision)
    expect(view.extensions).toBe(extensions)
  })
  it('update rollback update hook fails', async () => {
    const host = new ConfigHost(options)
    const original = new Error('update hook')
    await host.use(
      definePlugin({
        name: 'config',
        config: { value: 1 },
        update: () => {
          throw original
        },
        install: () => ({})
      })
    )
    const before = host.config.get('config')
    const revision = host.revision
    const view = host.getCurrentView()
    const extensions = view.extensions
    await expect(host.config.update('config', () => ({ value: 2 }))).rejects.toBe(original)
    expect(host.config.get('config')).toBe(before)
    expect(host.revision).toBe(revision)
    expect(view.extensions).toBe(extensions)
  })
  it('update rollback deadline generation supersede', async () => {
    const scheduler = createManualScheduler()
    let entered!: () => void
    let release!: () => void
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = new ConfigHost({
      ...options,
      scheduler,
      execution: { mutationTimeoutMs: 10, pipelineDrainTimeoutMs: false }
    } as any)
    await host.use(
      definePlugin({
        name: 'config',
        config: { value: 1 },
        update: async () => {
          entered()
          await gate
        },
        install: () => ({ extension: true })
      })
    )
    const before = host.config.get('config')
    const revision = host.revision
    const view = host.getCurrentView()
    const extensions = view.extensions
    const pending = host.config.update('config', () => ({ value: 2 }))
    await enteredGate
    scheduler.advance(10)
    await expect(pending).rejects.toMatchObject({
      code: PluginHostErrorCode.mutationExecutionTimeout
    })
    expect(host.config.get('config')).toBe(before)
    expect(host.revision).toBe(revision)
    expect(view.extensions).toBe(extensions)
    release()
  })
})
