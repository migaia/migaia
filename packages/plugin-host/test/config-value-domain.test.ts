import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { definePlugin, PluginHost } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'
import { PluginHostErrorCode, type IPluginHostErrorCode } from '../src/error-code.js'
import type { IPluginConfig } from '../src/plugin-lifecycle-types.js'

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

/** Plain-data DAG node admits only the original object grammar and repeated child identities. */
type ISharedConfigNode = {
  readonly left?: ISharedConfigNode
  readonly right?: ISharedConfigNode
  readonly value?: number
}

/** Counts source enumeration while exposing only ordinary plain-data Proxy nodes. */
class SharedConfigGraph {
  /** Root retains the complete shared graph supplied to installation or one patch operation. */
  readonly #root: ISharedConfigNode
  /** Number of distinct source nodes constructed by this fixture. */
  #nodes = 0
  /** Enumeration count distinguishes unique-node validation/copying from repeated path traversal. */
  #enumerations = 0

  /** Builds a bounded shared DAG without materializing its exponentially many paths. */
  constructor(depth: number) {
    /** Each new parent references the same previous node through both child keys. */
    let current = this.#observe({ value: 1 })
    for (let index = 0; index < depth; index += 1)
      current = this.#observe({ left: current, right: current })
    this.#root = current
  }

  /** Wraps one ordinary source record while counting only its own-key enumerations. */
  #observe(value: ISharedConfigNode): ISharedConfigNode {
    this.#nodes += 1
    return new Proxy(value, { ownKeys: (target) => this.#readKeys(target) })
  }

  /** Records the original source traversal without changing its keys, descriptors or values. */
  #readKeys(target: ISharedConfigNode): (string | symbol)[] {
    this.#enumerations += 1
    return Reflect.ownKeys(target)
  }

  /** Number of unique nodes expected in the immutable output. */
  get nodes(): number {
    return this.#nodes
  }

  /** Validation and ownership must each enumerate every source node exactly once. */
  get enumerations(): number {
    return this.#enumerations
  }

  /** Supplies two root aliases without nesting another callback inside the test body. */
  readonly patch = (): IPluginConfig => this.#createPatch()

  /** Creates a fresh patch record while preserving its two exact source-root references. */
  #createPatch(): IPluginConfig {
    return { first: this.#root, second: this.#root }
  }
}

/** Checks every unique output node, its frozen state and both aliases without timing or a bench. */
function expectSharedConfigGraph(root: ISharedConfigNode, expectedNodes: number): void {
  /** Identity set ensures the single-branch walk does not revisit any output node. */
  const visited = new WeakSet<object>()
  /** Current unique node advances through the graph's shared child rather than all paths. */
  let current = root
  /** Unique output count must equal the source fixture's linear node count. */
  let nodes = 0
  while (true) {
    expect(visited.has(current)).toBe(false)
    visited.add(current)
    nodes += 1
    expect(Object.isFrozen(current)).toBe(true)
    if (current.left === undefined) {
      expect(current.value).toBe(1)
      break
    }
    expect(current.left).toBe(current.right)
    current = current.left
  }
  expect(nodes).toBe(expectedNodes)
}

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
  it('validates and clones each shared DAG node once for install and patch', async () => {
    /** Twelve shared layers expose repeated traversal without a timing-dependent performance oracle. */
    const initial = new SharedConfigGraph(12)
    /** Existing public Host and config recipe entries exercise both ownership operations. */
    const host = new ConfigHost(options)
    await host.use(install(initial.patch()))
    /** Installation exposes one frozen copy per original node through both public root paths. */
    const installed = host.config.get('config.first') as ISharedConfigNode
    expect(installed).toBe(host.config.get('config.second'))
    expect(initial.enumerations).toBe(initial.nodes * 2)
    expectSharedConfigGraph(installed, initial.nodes)

    /** A separate patch graph proves operation-local caching across multiple changed root keys. */
    const patch = new SharedConfigGraph(12)
    await host.config.update('config', patch.patch)
    /** Patched roots share their new copy while the earlier immutable generation remains separate. */
    const updated = host.config.get('config.first') as ISharedConfigNode
    expect(updated).toBe(host.config.get('config.second'))
    expect(updated).not.toBe(installed)
    expect(patch.enumerations).toBe(patch.nodes * 2)
    expectSharedConfigGraph(updated, patch.nodes)
    await host.dispose()
  })

  it('update rollback recipe throws', async () => {
    const host = new ConfigHost(options)
    const original = new Error('recipe')
    await host.use(
      definePlugin({ name: 'config', config: { value: 1 }, install: () => ({ extension: true }) })
    )
    const before = host.config.get('config')
    const revision = host.revision
    const view = openComposition(host).getCurrentSnapshot()
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
    const view = openComposition(host).getCurrentSnapshot()
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
    const view = openComposition(host).getCurrentSnapshot()
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
    const view = openComposition(host).getCurrentSnapshot()
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
