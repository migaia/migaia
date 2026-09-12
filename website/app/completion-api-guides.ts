import type { IApiGuide, IApiGuideExample, IApiOptionGuide, IGuideLocale } from './api-guides.js'

type IGuideInput = {
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart: string
  readonly quickStartEn?: string
  readonly quickStartZh?: string
  readonly examplesEn?: readonly IApiGuideExample[]
  readonly examplesZh?: readonly IApiGuideExample[]
  readonly scenariosEn: readonly string[]
  readonly scenariosZh: readonly string[]
  readonly optionsEn?: readonly IApiOptionGuide[]
  readonly optionsZh?: readonly IApiOptionGuide[]
}

/** Creates one complete bilingual task guide without borrowing prose across locales. */
function guide(input: IGuideInput): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      avoidWhen: input.avoidEn,
      examples: input.examplesEn,
      options: input.optionsEn ?? [],
      purpose: input.purposeEn,
      quickStart: input.quickStartEn ?? input.quickStart,
      scenarios: input.scenariosEn
    },
    zh: {
      avoidWhen: input.avoidZh,
      examples: input.examplesZh,
      options: input.optionsZh ?? [],
      purpose: input.purposeZh,
      quickStart: input.quickStartZh ?? input.quickStart,
      scenarios: input.scenariosZh
    }
  }
}

/** Creates a guide for the paired registration and mutable-access functions of one graph field. */
function nodeFieldGuide(input: {
  readonly mutableName: string
  readonly nounEn: string
  readonly nounZh: string
  readonly registerName: string
  readonly valueExpression: string
}): Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> {
  const register = guide({
    purposeEn: `Registers the private mutable ${input.nounEn} owned by a custom reactive node and returns its read-only public view. Registration rejects a second backing collection for the same node.`,
    purposeZh: `为自定义 reactive node 登记其私有、可变的${input.nounZh}，并返回只读公开视图。同一 node 再次登记另一份集合会被拒绝。`,
    quickStart: `import { ${input.registerName}, ${input.mutableName} } from '@migaia/reactive/node-internals'\n\nconst node = {}\nconst state = ${input.valueExpression}\nconst readonlyState = ${input.registerName}(node, state)\n${input.mutableName}(node, readonlyState).clear()`,
    scenariosEn: [
      'A library author is implementing a new node type that participates in the Migaia dependency graph.',
      `The node must expose read-only ${input.nounEn} while its implementation retains controlled mutation.`
    ],
    scenariosZh: [
      '库作者正在实现需要加入 Migaia 依赖图的新节点类型。',
      `节点需要公开只读${input.nounZh}，同时仅允许实现层受控修改。`
    ],
    avoidEn: [
      'Application code is reading or updating reactive values; use Signal, Computed, Effect, or Runtime instead.',
      'The object is not a reactive node owned by the extension implementation.'
    ],
    avoidZh: [
      '普通应用正在读取或更新响应式数据；应使用 Signal、Computed、Effect 或 Runtime。',
      '该对象不是扩展实现持有的 reactive node。'
    ]
  })
  const mutable = guide({
    purposeEn: `Returns the exact mutable ${input.nounEn} previously registered for a custom node. The supplied fallback is accepted only for an unregistered node, so callers can initialize and then mutate one canonical collection.`,
    purposeZh: `取得此前为自定义 node 登记的同一份可变${input.nounZh}。仅当 node 尚未登记时才采用 fallback，从而保证实现层只修改一份规范集合。`,
    quickStart: `import { ${input.registerName}, ${input.mutableName} } from '@migaia/reactive/node-internals'\n\nconst node = {}\nconst state = ${input.valueExpression}\nconst readonlyState = ${input.registerName}(node, state)\nconst writableState = ${input.mutableName}(node, readonlyState)\nwritableState.clear()`,
    scenariosEn: [
      'A custom node implementation must update graph bookkeeping after registration.',
      `The public node shape keeps ${input.nounEn} read-only while the implementation needs the original collection.`
    ],
    scenariosZh: [
      '自定义节点在登记后需要更新依赖图记录。',
      `公开节点把${input.nounZh}保持为只读，但实现层需要取得原始集合。`
    ],
    avoidEn: [
      'Do not use it to mutate built-in nodes from application code.',
      'Do not pass a copied fallback and expect it to replace an already registered collection.'
    ],
    avoidZh: [
      '不要在普通应用代码中用它修改内置节点。',
      '不要传入复制的 fallback 并期待替换已登记集合。'
    ]
  })
  return { [input.registerName]: register, [input.mutableName]: mutable }
}

/**
 * One coherent provider-to-consumer scenario kept separate from the descriptor and short-form
 * examples.
 */
const definePluginSharedExampleCode = `import { definePlugin, setupHost } from '@migaia/plugin-host/defined'
import type { IPluginHostCore } from '@migaia/plugin-host/structural'

type ICacheShared = { readProduct(id: string): number | undefined }

const prices = new Map([['sku-42', 199]])
const cacheProvider = definePlugin<
  Record<string, never>,
  Record<string, never>,
  never,
  Record<string, never>,
  ICacheShared
>({
  name: 'cache-provider',
  install: () => ({}),
  shared: () => ({ readProduct: (id: string) => prices.get(id) })
})

const productReader = definePlugin<Record<string, never>, { loadProduct(id: string): number }>(
  'product-reader',
  (core: IPluginHostCore) => {
    const readProduct = core.getShared('readProduct') as ICacheShared['readProduct']
    return { loadProduct: (id) => readProduct(id) ?? 0 }
  }
)

const app = await setupHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  setupTimeoutMs: 10_000,
  core: () => ({}),
  // provider 必须排在 consumer 前面；整批成功后才一起对外可见。
  plugins: [cacheProvider, productReader] as const
})

console.log(app.extensions.loadProduct('sku-42')) // 199
await app.dispose()`

/** Complete guides for public operations added after the original website inventory. */
export const completionApiGuides: Readonly<
  Record<string, Readonly<Partial<Record<IGuideLocale, IApiGuide>>>>
> = {
  'plugin-host:index:defineFeature': guide({
    purposeEn:
      'Defines one synchronous, opaque Feature capability. It does not create a Host, install a Plugin, start resources, or publish methods. A Plugin declares the Feature in its static record; during installation the factory receives only featureExpose and direct dependency outputs. Put asynchronous work and cleanup in the Plugin install hook.',
    purposeZh:
      '定义一项同步且不透明的 Feature 能力；它不会创建 Host、安装 Plugin、启动资源或发布方法。Plugin 在静态 record 中声明 Feature；安装时 factory 只能收到 featureExpose 与直接依赖的输出。异步工作和清理必须放在 Plugin 的 install hook 中。',
    quickStart: `import { defineFeature } from '@migaia/plugin-host'
import type { IFeatureCore } from '@migaia/plugin-host'
import { definePlugin, setupHost } from '@migaia/plugin-host/defined'

const metrics = defineFeature((core: IFeatureCore<{ readCount(): number }>) => ({
  read: () => core.featureExpose.readCount()
}))

const counter = definePlugin('counter', (core) => ({
  featureExpose: () => ({ readCount: () => 1 }),
  install() {
    return { readMetric: () => core.features.metrics.read() }
  }
}), { metrics })

const host = await setupHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  setupTimeoutMs: false,
  core: () => ({}),
  plugins: [counter] as const
})
host.extensions.readMetric()
await host.dispose()`,
    scenariosEn: [
      'Define a reusable synchronous capability with explicitly declared direct dependencies.',
      'Keep Feature output private until its owning Plugin explicitly projects it.'
    ],
    scenariosZh: ['定义带明确直接依赖的可复用同步能力。', '由所属 Plugin 显式投影 Feature 输出。'],
    avoidEn: [
      'You need to allocate resources or run asynchronous setup; use Plugin install instead.',
      'You need undeclared or transitive dependency output; declare the direct dependency first.'
    ],
    avoidZh: [
      '需要分配资源或异步初始化时；应使用 Plugin install。',
      '需要未声明或传递依赖输出时；先声明直接依赖。'
    ]
  }),
  'plugin-host:composition:inspectFeatures': guide({
    purposeEn:
      'Inspects trusted static Feature roots without invoking factories or creating registration state. Use ordered for dependency order and roots for the declared aliases before Plugin installation.',
    purposeZh:
      '检查可信的静态 Feature roots，不调用 factory，也不创建 registration 状态。Plugin 安装前可用 ordered 取得依赖顺序，用 roots 读取声明的别名。',
    quickStart: `import { defineFeature } from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'

let factoryCalls = 0
const metrics = defineFeature(() => {
  factoryCalls += 1
  return { read: () => 1 }
})

const inspection = inspectFeatures({ metrics })
console.log(inspection.roots.metrics === metrics)
console.log(inspection.ordered[0] === metrics)
console.log(factoryCalls) // 0: inspection never invokes factories`,
    scenariosEn: [
      'Check a trusted static Feature dependency order before installation.',
      'Read declared root aliases without allocating Feature output.'
    ],
    scenariosZh: [
      '安装前检查可信静态 Feature 的依赖顺序。',
      '不分配 Feature 输出即可读取声明 root 别名。'
    ],
    avoidEn: [
      'You need Feature output; install its owning Plugin first.',
      'You need to validate untrusted objects; admission rejects forged Features.'
    ],
    avoidZh: [
      '需要 Feature 输出时；先安装所属 Plugin。',
      '需要校验不可信对象时；准入会拒绝伪造 Feature。'
    ]
  }),
  'plugin-host:defined:definePlugin': guide({
    purposeEn:
      'Defines and validates a reusable plugin descriptor; it does not install the plugin. Installation through setupHost() or host.use() gives the plugin a core, publishes shared capabilities for later plugins, and merges the object returned by install() into the Host extensions view. The full descriptor also owns configuration updates and cleanup, so one definition describes the complete install-to-dispose lifecycle.',
    purposeZh:
      '定义并校验一个可复用的插件描述，但不会立刻安装。通过 setupHost() 或 host.use() 安装后，插件获得 core；shared 能力会提供给后续插件；install() 返回的 extension 会合并到宿主的 extensions 视图。完整描述还可声明配置更新与清理，因此一个定义覆盖从安装到卸载的完整生命周期。core = 插件可以使用的宿主能力，shared = 插件之间复用的能力，extension = 业务代码从宿主上调用的能力。',
    quickStart: `import {
  definePlugin,
  setupHost
} from '@migaia/plugin-host/defined'

type IAppCore = {
  reportCacheSize(size: number): void
}
type ICacheConfig = { ttlMs: number }

const cache = new Map<string, { id: string; price: number }>()
let activeTtlMs = 30_000
let refreshTimer: ReturnType<typeof setInterval> | undefined

const productCache = definePlugin<
  IAppCore,
  { clearProductCache(): void },
  never,
  ICacheConfig
>({
  name: 'product-cache',
  config: { ttlMs: activeTtlMs },

  // core = 应用提供的 reportCacheSize + PluginHost 提供的配置与生命周期能力。
  install(core) {
    activeTtlMs = core.config.get().ttlMs
    refreshTimer = setInterval(() => cache.clear(), activeTtlMs)
    core.reportCacheSize(cache.size)
    core.onDispose(() => {
      if (refreshTimer) clearInterval(refreshTimer)
    })

    // extension：安装后由业务代码通过 app.extensions 调用。
    return { clearProductCache: () => cache.clear() }
  },

  // app.config.update() 成功时收到只读的新配置。
  update(next) {
    activeTtlMs = next.ttlMs
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(() => cache.clear(), activeTtlMs)
  },

  // 插件自己的最终清理；core.onDispose() 登记的资源也由同一宿主管理。
  dispose: () => cache.clear()
})

const app = await setupHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  setupTimeoutMs: 10_000,
  core: () => ({ reportCacheSize: (size: number) => console.log(size) }),
  plugins: [productCache] as const
})

app.extensions.clearProductCache()
await app.config.update('product-cache', () => ({ ttlMs: 60_000 }))
await app.dispose()`,
    examplesEn: [
      {
        id: 'short-form',
        title: 'Short form: definePlugin(name, descriptorFactory)',
        description:
          'Use this form when a stable name and per-install descriptor are enough. Its install hook returns the typed Host extension; use core.onDispose() for resources created inside install. Use the retained object form for config, shared, update, metadata, or a top-level disposer.',
        code: `import { definePlugin, setupHost } from '@migaia/plugin-host/defined'

type IAppCore = { audit(message: string): void }

const greeting = definePlugin<IAppCore, { greet(name: string): string }>(
  'greeting',
  (core) => ({
    greet(name) {
      const message = \`Hello, \${name}\`
      core.audit(message)
      return message
    }
  })
)

const app = await setupHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  setupTimeoutMs: 10_000,
  core: () => ({ audit: (message: string) => console.log(message) }),
  plugins: [greeting] as const
})

console.log(app.extensions.greet('Migaia'))
await app.dispose()`
      },
      {
        id: 'shared-collaboration',
        title: 'Shared capability between plugins',
        description:
          'Use shared for one internal capability consumed by a later plugin. The provider must precede the consumer in the same atomic installation batch; only the consumer extension becomes application-facing.',
        code: definePluginSharedExampleCode
      }
    ],
    examplesZh: [
      {
        id: 'short-form',
        title: '短写法：definePlugin(name, descriptorFactory)',
        description:
          '只有稳定名称与逐安装 descriptor 时使用这个形式。其 install hook 返回的对象成为有类型的 Host extension；install 内创建的资源可用 core.onDispose() 登记。需要 config、shared、update、metadata 或顶层 disposer 时使用保留对象形。',
        code: `import { definePlugin, setupHost } from '@migaia/plugin-host/defined'

type IAppCore = { audit(message: string): void }

const greeting = definePlugin<IAppCore, { greet(name: string): string }>(
  'greeting',
  (core) => ({
    greet(name) {
      const message = \`Hello, \${name}\`
      core.audit(message)
      return message
    }
  })
)

const app = await setupHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  setupTimeoutMs: 10_000,
  core: () => ({ audit: (message: string) => console.log(message) }),
  plugins: [greeting] as const
})

console.log(app.extensions.greet('Migaia'))
await app.dispose()`
      },
      {
        id: 'shared-collaboration',
        title: '插件之间共享内部能力',
        description:
          'shared 用于把一个内部能力交给后安装的插件。provider 必须在同一个 atomic installation batch 中排在 consumer 前面；业务代码最终只看到 consumer 发布的 extension。',
        code: definePluginSharedExampleCode
      }
    ],
    scenariosEn: [
      'Core: the installer needs both application-owned services and Host-owned config, cancellation, lifetime, resource, shared-value, or pipeline capabilities.',
      'Shared: one plugin provides a capability to plugins installed after it without exposing that capability as application API.',
      'Extension: application code should gain typed methods or values through view.extensions only after installation succeeds.',
      'The plugin needs owned configuration, update handling, and deterministic cleanup under one Host lifecycle.'
    ],
    scenariosZh: [
      'core：安装逻辑既要使用应用提供的服务，也要使用 Host 提供的配置、取消、存续信号、资源登记、shared 读取或 pipeline 能力。',
      'shared：一个插件要把内部能力提供给排在它后面安装的插件，但不希望把它直接做成业务 API。',
      'extension：业务代码只应在安装成功后，通过 view.extensions 获得有类型的方法或值。',
      '插件需要由同一个 Host 统一管理配置、update 与确定性清理。'
    ],
    avoidEn: [
      'The behavior is a one-off call and owns no install-time state or cleanup; use a normal function.',
      'The capability belongs to the application core and every plugin needs it; provide it from setupHost().core instead.',
      'Do not read a shared capability from a plugin installed later, or publish duplicate shared/extension keys; the batch is rejected and rolled back.'
    ],
    avoidZh: [
      '行为只是一次性调用，不持有安装态资源，也无需清理；应使用普通函数。',
      '能力属于应用 core 且所有插件都需要；应改由 setupHost().core 提供。',
      '不要读取后安装插件的 shared，也不要发布重复的 shared/extension 键；整批安装会被拒绝并回滚。'
    ],
    optionsEn: [
      {
        name: 'definePlugin(name, descriptorFactory)',
        description:
          'Short form for a stable name and a descriptor factory whose install hook returns Host extensions.',
        whenToUse:
          'Use when the plugin has no config, shared capability, update hook, metadata, or explicit disposer.',
        type: 'IDefinedPluginConstraint',
        optional: false
      },
      {
        name: 'core',
        description:
          'Application domain core combined with Host config, operation/lifecycle signals, getShared(), onDispose(), and pipeline registration.',
        whenToUse:
          'Use only during install/shared/update; operation-scoped registration is rejected outside the owning lifecycle phase.',
        type: 'TCore & IPluginHostCore',
        optional: false
      },
      {
        name: 'install(core)',
        description:
          'Creates the plugin and returns the extension object merged into view.extensions after the whole batch commits.',
        whenToUse:
          'Return only the application-facing surface; register owned resources with core.onDispose().',
        type: '(core) => TExtension | PromiseLike<TExtension>',
        optional: false
      },
      {
        name: 'shared(core)',
        description:
          'Publishes cross-plugin values by key after this plugin installs; later plugins read them with core.getShared(key).',
        whenToUse:
          'Use for plugin-to-plugin collaboration that should not become application-facing extension API.',
        type: '(core) => TShared'
      },
      {
        name: 'config / update(next, core)',
        description:
          'Owns an immutable config snapshot and reacts after view.config.update() commits a patch.',
        whenToUse: 'Use when runtime behavior must change without uninstalling the plugin.',
        type: 'TConfig / PromiseLike<void>'
      },
      {
        name: 'dispose / Symbol.dispose / Symbol.asyncDispose',
        description: 'Releases plugin-owned resources during unUse(), rollback, or Host disposal.',
        whenToUse:
          'Use for final plugin cleanup; use core.onDispose() for resources created during install.',
        type: 'IPluginDisposer'
      }
    ],
    optionsZh: [
      {
        name: 'definePlugin(name, descriptorFactory)',
        description: '短写法：声明稳定名称与返回逐安装 descriptor 的工厂。',
        whenToUse: '插件没有 config、shared、update、额外元数据或显式 disposer 时使用。',
        type: 'IDefinedPluginConstraint',
        optional: false
      },
      {
        name: 'core',
        description:
          '应用领域 core 与 Host 能力的组合；Host 能力包括配置、操作/存续信号、getShared()、onDispose() 和 pipeline 登记。',
        whenToUse:
          '仅在 install/shared/update 对应阶段使用；离开所属生命周期阶段后再登记资源会被拒绝。',
        type: 'TCore & IPluginHostCore',
        optional: false
      },
      {
        name: 'install(core)',
        description:
          '创建插件并返回 extension 对象；只有整批安装提交后，它才会合并到 view.extensions。',
        whenToUse: '只返回给业务宿主使用的公开能力；安装期资源通过 core.onDispose() 登记。',
        type: '(core) => TExtension | PromiseLike<TExtension>',
        optional: false
      },
      {
        name: 'shared(core)',
        description: '当前插件安装后按键发布跨插件能力；后续插件通过 core.getShared(key) 读取。',
        whenToUse: '用于插件间协作，但不希望它成为业务侧 extension API。',
        type: '(core) => TShared'
      },
      {
        name: 'config / update(next, core)',
        description: '持有不可变配置快照，并在 view.config.update() 提交补丁后响应新配置。',
        whenToUse: '需要在不卸载插件的情况下调整运行行为时使用。',
        type: 'TConfig / PromiseLike<void>'
      },
      {
        name: 'dispose / Symbol.dispose / Symbol.asyncDispose',
        description: '在 unUse()、安装回滚或 Host dispose 时释放插件自己的资源。',
        whenToUse: '插件级最终清理放这里；install 阶段创建的资源优先交给 core.onDispose()。',
        type: 'IPluginDisposer'
      }
    ]
  }),
  'plugin-host:defined:setupHost': guide({
    purposeEn:
      'Creates the domain core, installs the initial plugin list as one transaction, and returns a ready-to-use immutable view. Cancellation or failure removes resources created by both the core and plugins before rejecting.',
    purposeZh:
      '先创建领域 core，再把首批插件作为一个事务安装，最后返回可直接使用的不可变视图。取消或失败时，会先清理 core 与插件已经创建的资源再 reject。',
    quickStart:
      "import { definePlugin, setupHost } from '@migaia/plugin-host/defined'\n\nconst greeting = definePlugin('greeting', (core: { prefix: string }) => ({\n  install: () => ({\n    greet: (name: string) => `${core.prefix}, ${name}`\n  })\n}))\n\nconst app = await setupHost({\n  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },\n  setupTimeoutMs: 10_000,\n  core: () => ({ prefix: 'Hello' }),\n  plugins: [greeting]\n})\n\nconsole.log(app.extensions.greet('Ada'))\nawait app.dispose()",
    scenariosEn: [
      'Application startup needs a core and plugins to become visible only after all setup succeeds.',
      'Core resources and plugin resources require one disposal authority.'
    ],
    scenariosZh: [
      '应用启动时只有 core 与全部插件都成功后才能对外可见。',
      'core 资源与插件资源需要由同一个 dispose 入口统一清理。'
    ],
    avoidEn: [
      'A long-lived subclass must expose custom protected pipeline methods; extend PluginHost instead.',
      'The caller cannot provide finite setup and mutation budgets or explicitly choose false.'
    ],
    avoidZh: [
      '长期存在的子类需要公开自定义 protected pipeline 方法；此时应继承 PluginHost。',
      '调用方无法提供有限的 setup、mutation 预算，也没有明确选择 false。'
    ]
  }),
  'plugin-host:defined:PluginHostError': guide({
    purposeEn:
      'Represents recoverable Plugin Host state and protocol failures with stable source and code fields. Input-shape failures remain native TypeError values, so callers can distinguish bad input from host lifecycle failures.',
    purposeZh:
      '用稳定的 source 与 code 表示可处理的 Plugin Host 状态或协议失败。原始失败通过 cause 保持可达，不可变结构化诊断放入 detail；输入形状错误仍保持原生 TypeError，因此调用方能区分错误输入与 Host 生命周期失败。',
    quickStart:
      "import { PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host/defined'\n\ntry {\n  await host.use(plugin)\n} catch (error) {\n  if (error instanceof PluginHostError && error.code === PluginHostErrorCode.pluginInstallFailed) {\n    reportInstallFailure(error.cause)\n  }\n}",
    scenariosEn: [
      'A caller can recover, report, or retry based on a stable Plugin Host error code.',
      'Structured detail is needed without parsing the human-readable message.'
    ],
    scenariosZh: [
      '调用方可以根据稳定错误码恢复、报告或重试。',
      '需要读取结构化 detail，而不是解析面向人的 message。'
    ],
    optionsEn: [
      {
        name: 'code',
        description: 'Stable Plugin Host error identity used for branching and recovery.',
        whenToUse: 'Choose the code that describes the failed public contract.',
        type: 'IPluginHostErrorCode',
        optional: false
      },
      {
        name: 'message',
        description: 'Human-readable diagnostic text; callers must not parse it for control flow.',
        whenToUse: 'Explain the concrete failure for logs and operators.',
        type: 'string',
        optional: false
      },
      {
        name: 'options.cause',
        description: 'Original failure instance retained for stack and identity inspection.',
        whenToUse: 'Set it when another error caused this boundary failure.',
        type: 'unknown'
      },
      {
        name: 'options.detail',
        description: 'Immutable structured facts such as owner or elapsed time.',
        whenToUse: 'Use it for machine-readable diagnostics that are not an error cause.',
        type: 'TDetail'
      }
    ],
    optionsZh: [
      {
        name: 'code',
        description: '用于分支处理和恢复的稳定 Plugin Host 错误标识。',
        whenToUse: '选择能准确描述失败公开契约的错误码。',
        type: 'IPluginHostErrorCode',
        optional: false
      },
      {
        name: 'message',
        description: '给人阅读的诊断文本；调用方不能解析它来控制程序流程。',
        whenToUse: '说明本次具体失败，供日志和运维查看。',
        type: 'string',
        optional: false
      },
      {
        name: 'options.cause',
        description: '保留原始失败实例，便于检查原始 stack 与对象身份。',
        whenToUse: '当前边界失败由另一个错误引起时设置。',
        type: 'unknown'
      },
      {
        name: 'options.detail',
        description: '不可变结构化诊断，例如 owner 或已等待时长。',
        whenToUse: '需要机器读取且信息不属于错误原因时设置。',
        type: 'TDetail'
      }
    ],
    avoidEn: [
      'Do not construct it for normal host states.',
      'Do not use it for invalid argument shapes; those are TypeError failures.'
    ],
    avoidZh: ['不要用它表示正常 Host 状态。', '不要用它表示参数形状错误；该类错误属于 TypeError。']
  }),
  'plugin-host:structural:PluginHost': guide({
    purposeEn:
      'Abstract base class for a long-lived domain Host. It owns atomic plugin installation and rollback, immutable revocable views, extensions, shared capabilities, configuration updates, four pipeline models, serialized mutations, bounded logical removal with observable physical cleanup, and terminal disposal. Subclasses supply the domain core and expose business methods that run the protected pipeline; graph/composition owners can additionally use its two-phase admission and removal boundary.',
    purposeZh:
      '面向长期运行领域宿主的抽象基类。它统一拥有：插件整批原子安装与失败回滚、不可变且可撤销的 view、extension、shared、配置更新、四种 pipeline、mutation 串行队列、先逻辑撤销再观察物理清理，以及 Host 最终 dispose。子类负责提供领域 core，并把 protected runPipeline() 包装成业务方法；依赖图或组合器还可使用两阶段 admission/removal 集成边界。',
    quickStart: `import { PluginHost } from '@migaia/plugin-host/structural'
import { definePlugin } from '@migaia/plugin-host/defined'

type IAppCore = { write(message: string): void }
type IGreetingConfig = { prefix: string }
type IGreetingShared = { formatGreeting(name: string): string }

class AppHost extends PluginHost<IAppCore, string> {
  protected createPluginDomainCore(): IAppCore {
    return { write: (message) => console.log(message) }
  }

  // runPipeline() 是 protected；宿主把它包装成自己的业务入口。
  async publish(message: string): Promise<string> {
    let output = message
    await this.runPipeline(message, (next) => {
      output = next
    })
    console.log(output)
    return output
  }
}

let prefix = 'Hello'
const greetingPlugin = definePlugin<
  IAppCore,
  { greet(name: string): string },
  string,
  IGreetingConfig,
  IGreetingShared
>({
  name: 'greeting',
  config: { prefix },
  install(core) {
    core.usePipeline((message, next) => next('[greeting] ' + message))
    core.onDispose(() => console.log('greeting resources released'))
    return {
      greet(name) {
        const message = prefix + ', ' + name
        core.write(message)
        return message
      }
    }
  },
  shared: () => ({ formatGreeting: (name) => prefix + ', ' + name }),
  update(next) {
    prefix = next.prefix
  }
})

const host = new AppHost({
  execution: {
    mutationTimeoutMs: 5_000,
    pipelineDrainTimeoutMs: 5_000
  },
  pipeline: { mode: 'sync' },
  queueAdmissionTimeoutMs: 2_000,
  disposeStepTimeoutMs: 2_000,
  diagnostic: (message, code) => console.warn(code, message)
})

// use() 整批成功后才发布新 view；失败会回滚候选插件和已登记资源。
const view = await host.use(greetingPlugin)
view.extensions.greet('Migaia')
const formatGreeting = view.getShared('formatGreeting')
console.log(formatGreeting?.('Ada'))
await view.config.update('greeting', () => ({ prefix: 'Hi' }))
await host.publish('order-created')

console.log(host.pipelineMode, host.revision)
const current = host.getCurrentView()
console.log(current.extensions.greet('Grace'))

// unUse() 先让能力在新 view 中消失，再报告清理是否已经完全结束。
const removal = await current.unUse('greeting')
if (removal.physicalCompletion) await removal.physicalCompletion
console.log(removal.removed, removal.cleanupErrors, removal.view.extensions)

const terminal = await host.dispose()
if (terminal.physicalCompletion) await terminal.physicalCompletion`,
    scenariosEn: [
      'A framework Host needs domain-specific methods that execute a sync, async, generator, or async-generator plugin pipeline.',
      'Plugins must be installed, configured, and removed at runtime while readers only observe committed immutable views.',
      'Plugin resources, in-flight pipeline work, rollback, and final shutdown need one lifecycle owner with explicit time budgets.',
      'A graph or loader needs two-phase prepare/commit/discard integration without publishing partial candidates.'
    ],
    scenariosZh: [
      '框架 Host 需要用领域方法执行 sync、async、generator 或 async-generator 插件 pipeline。',
      '运行期间需要安装、更新配置和卸载插件，同时读取方只能观察已提交的不可变 view。',
      '插件资源、在途 pipeline、安装回滚与最终停机需要一个生命周期 owner，并且必须有明确时间预算。',
      '依赖图或 loader 需要 prepare/commit/discard 两阶段集成，且不能提前发布候选状态。'
    ],
    avoidEn: [
      'Startup only needs a functional core and one initial plugin list; setupHost() is smaller and does not require subclassing.',
      'Features are static and own no resources, configuration, shared state, or pipeline stages; compose plain objects or functions.',
      'Plugins require dependency ordering or cross-process isolation; PluginHost executes an already ordered in-realm composition and does not solve either concern.',
      'Application code should not call the admission, ordering-slot, or prepared-removal methods; those are framework integration boundaries.'
    ],
    avoidZh: [
      '启动阶段只需要函数式 core 和一组初始插件；setupHost() 更小，也不需要继承。',
      '功能固定且不拥有资源、配置、shared 或 pipeline stage；直接组合普通对象或函数。',
      '插件需要自动依赖排序或跨进程隔离；PluginHost 只执行已经排好序的当前 realm 组合，不解决这两件事。',
      '普通业务代码不要调用 admission、ordering slot 或 prepared removal 方法；它们属于框架集成边界。'
    ],
    optionsEn: [
      {
        name: 'createPluginDomainCore()',
        description:
          'Protected factory that supplies every plugin with application-owned domain services in addition to IPluginHostCore lifecycle capabilities.',
        whenToUse:
          'Override once in the subclass; return stable capabilities rather than mutable global dependencies.',
        type: 'TDomainCore',
        optional: false
      },
      {
        name: 'use(...plugins)',
        description:
          'Serializes one plugin batch, installs in argument order, and atomically publishes a new immutable view. Any failure rolls back the batch.',
        whenToUse: 'Install one or more already ordered plugins at runtime.',
        type: 'Promise<IPluginHostView>',
        optional: false
      },
      {
        name: 'view / getCurrentView()',
        description:
          'A frozen committed snapshot exposing host, extensions, config, getShared(), use(), and unUse(). A view captured through a removed registration is revoked.',
        whenToUse:
          'Pass committed capabilities to readers without exposing candidate mutation state.',
        type: 'IPluginHostView / IPluginHostDynamicView'
      },
      {
        name: 'extensions / getShared(key)',
        description:
          'extensions is application-facing plugin API; shared values are plugin-to-plugin capabilities, also readable from the view or Host.',
        whenToUse:
          'Use extensions for business calls and shared for internal plugin collaboration.',
        type: 'Readonly<Record<PropertyKey, unknown>>'
      },
      {
        name: 'config.get() / config.update()',
        description:
          'Reads owned configuration and serializes an immutable patch through the plugin update hook.',
        whenToUse: 'Change plugin behavior without uninstalling it.',
        type: 'IPluginHostConfigFor<TInstalled>'
      },
      {
        name: 'usePipeline() and typed variants',
        description:
          'Registers sync stages directly or uses async, generator, and async-generator variants. The Host has one pipeline mode and adapters reject incompatible registrations.',
        whenToUse: 'Build ordered interception or transformation around a Host business operation.',
        type: 'this'
      },
      {
        name: 'runPipeline(value, done)',
        description:
          'Protected execution primitive. It snapshots stages and holds owner leases while work is active.',
        whenToUse:
          'Wrap it in a public domain method; application callers should not invoke it directly.',
        type: 'void | Promise<void>'
      },
      {
        name: 'unUse(name)',
        description:
          'Logically revokes one plugin, returns the new view and cleanup diagnostics, and exposes physicalCompletion when bounded pipeline drain continues in the background.',
        whenToUse: 'Remove a runtime capability without making cleanup latency invisible.',
        type: 'Promise<IPluginRemovalResult>'
      },
      {
        name: 'revision / pipelineMode',
        description:
          'revision changes at committed publication boundaries; pipelineMode reports the fixed execution model selected by the constructor.',
        whenToUse:
          'Use revision for integration drift detection and pipelineMode for diagnostics or adapter selection.',
        type: 'number / IPipelineMode'
      },
      {
        name: 'dispose() / Symbol.asyncDispose',
        description:
          'Moves the Host permanently to its logical terminal state, revokes every plugin, and reports cleanup errors or later physical completion.',
        whenToUse:
          'Call exactly once at application shutdown; repeated calls share terminal lifecycle semantics.',
        type: 'Promise<IPluginHostDisposalResult>'
      },
      {
        name: 'two-phase composition API',
        description:
          'createPluginAdmission(), data-order slots, prepare/commit/discard admissions, and prepare/commit removal batches form the atomic graph integration boundary.',
        whenToUse:
          'Only framework owners coordinating PluginHost with an external dependency graph should use it.',
        type: '@migaia/plugin-host/composition'
      },
      {
        name: 'useSync() / translateDisposalError()',
        description:
          'Protected subclass hooks for constructor-time synchronous installation and final disposal-error translation.',
        whenToUse:
          'Use only when a concrete Host must finish synchronous construction or translate its public error boundary.',
        type: 'protected'
      }
    ],
    optionsZh: [
      {
        name: 'createPluginDomainCore()',
        description:
          'protected 工厂：除了 IPluginHostCore 生命周期能力，还向每个插件提供应用自己拥有的领域服务。',
        whenToUse: '在子类中统一重写一次；返回稳定能力，不要让插件依赖可变全局对象。',
        type: 'TDomainCore',
        optional: false
      },
      {
        name: 'use(...plugins)',
        description:
          '把一批插件放入串行 mutation 队列，按参数顺序安装，并原子发布新的不可变 view；任一失败都会回滚整批候选。',
        whenToUse: '运行时安装一个或多个已经排好顺序的插件。',
        type: 'Promise<IPluginHostView>',
        optional: false
      },
      {
        name: 'view / getCurrentView()',
        description:
          '冻结的已提交快照，包含 host、extensions、config、getShared()、use() 与 unUse()；其捕获的 registration 被移除后，旧 view 会撤销。',
        whenToUse: '把已提交能力交给读取方，同时不暴露候选 mutation 状态。',
        type: 'IPluginHostView / IPluginHostDynamicView'
      },
      {
        name: 'extensions / getShared(key)',
        description: 'extensions 是业务侧插件 API；shared 是插件间能力，也能从 view 或 Host 读取。',
        whenToUse: '业务调用使用 extensions；插件内部协作使用 shared。',
        type: 'Readonly<Record<PropertyKey, unknown>>'
      },
      {
        name: 'config.get() / config.update()',
        description: '读取 Host 持有的配置，并把不可变补丁串行交给插件 update hook。',
        whenToUse: '不卸载插件就调整其运行行为。',
        type: 'IPluginHostConfigFor<TInstalled>'
      },
      {
        name: 'usePipeline() 与三种类型化变体',
        description:
          '登记 sync stage，或显式登记 async、generator、async-generator stage。一个 Host 只有一种 pipeline mode，不兼容的登记会被拒绝。',
        whenToUse: '围绕宿主业务操作建立有顺序的拦截或数据变换。',
        type: 'this'
      },
      {
        name: 'runPipeline(value, done)',
        description: 'protected 执行原语；执行前快照 stage，并在任务存续期间持有对应 owner lease。',
        whenToUse: '由子类包装成公开领域方法，普通业务调用方不直接使用。',
        type: 'void | Promise<void>'
      },
      {
        name: 'unUse(name)',
        description:
          '先逻辑撤销一个插件，再返回新 view、清理诊断；有界 pipeline drain 尚未结束时还会返回 physicalCompletion。',
        whenToUse: '移除运行时能力，同时不隐藏物理清理延迟。',
        type: 'Promise<IPluginRemovalResult>'
      },
      {
        name: 'revision / pipelineMode',
        description:
          'revision 只在提交发布边界递增；pipelineMode 表示构造时选定且之后不变的执行模型。',
        whenToUse: 'revision 用于集成层检测漂移；pipelineMode 用于诊断或选择适配器。',
        type: 'number / IPipelineMode'
      },
      {
        name: 'dispose() / Symbol.asyncDispose',
        description:
          '让 Host 永久进入逻辑终态、撤销所有插件，并返回清理错误或稍后完成的 physicalCompletion。',
        whenToUse: '应用停机时调用；重复调用遵守同一个终态生命周期。',
        type: 'Promise<IPluginHostDisposalResult>'
      },
      {
        name: '两阶段 composition API',
        description:
          'createPluginAdmission()、data-order slot、prepare/commit/discard admission 与 prepare/commit removal batch 组成原子图集成边界。',
        whenToUse: '只有负责协调 PluginHost 与外部依赖图的框架 owner 才应使用。',
        type: '@migaia/plugin-host/composition'
      },
      {
        name: 'useSync() / translateDisposalError()',
        description: '用于构造期同步安装和最终 dispose 错误翻译的 protected 子类 hook。',
        whenToUse: '仅当具体 Host 必须同步完成构造，或需要翻译公开错误边界时使用。',
        type: 'protected'
      }
    ]
  }),
  ...Object.fromEntries(
    [
      [
        'adaptSyncStageToAsync',
        '同步 next-style stage',
        '异步 pipeline stage',
        'useAsyncPipeline',
        true
      ],
      [
        'adaptSyncStageToGenerator',
        '同步 next-style stage',
        '同步 generator stage',
        'useGeneratorPipeline',
        true
      ],
      [
        'adaptGeneratorStageToAsyncGenerator',
        '同步 generator stage',
        '异步 generator stage',
        'useAsyncGeneratorPipeline',
        false
      ],
      [
        'adaptSyncStageToAsyncGenerator',
        '同步 next-style stage',
        '异步 generator stage',
        'useAsyncGeneratorPipeline',
        true
      ]
    ].map(([name, sourceZh, targetZh, installMethod, needsViolationHandler]) => [
      `plugin-host:index:${name}`,
      guide({
        purposeEn: `Adapts an existing Plugin Host pipeline stage to the execution shape named by ${name}, while preserving value flow, terminal signals, next-call violations, and thrown error identity.`,
        purposeZh: `把现有${sourceZh}转换为${targetZh}，同时保留 value 流、终止信号、next 调用违规和抛出错误的身份。`,
        quickStart: `import { ${name} } from '@migaia/plugin-host'\n\nconst adaptedStage = ${name}(stage${needsViolationHandler ? ', (violation) => console.warn(violation)' : ''})\nhost.${installMethod}(adaptedStage)`,
        scenariosEn: [
          'A host selected one pipeline execution mode but an existing stage uses another supported shape.',
          'Migration must preserve the canonical middleware violation policy.'
        ],
        scenariosZh: [
          'Host 已选择一种 pipeline 执行模式，但现有 stage 使用另一种受支持形态。',
          '迁移时必须保留规范的 middleware 违规处理策略。'
        ],
        avoidEn: [
          'The stage can be authored directly in the target shape.',
          'Do not use an adapter to hide a Promise returned from a synchronous stage.'
        ],
        avoidZh: [
          'stage 可以直接按目标形态实现。',
          '不要用 adapter 隐藏同步 stage 返回 Promise 的错误。'
        ]
      })
    ])
  ),
  'plugin-host:index:invokeCaptured': guide({
    purposeEn:
      'Invokes a previously admitted callable with its captured receiver and argument list while preserving receiver behavior, argument order, return identity, and the exact thrown error.',
    purposeZh:
      '使用此前捕获的 receiver 与参数列表调用已准入函数，并保持 receiver 行为、参数顺序、返回值身份和原始抛出错误不变。',
    quickStart:
      "import { invokeCaptured } from '@migaia/plugin-host'\n\nconst counter = { value: 1, add(step: number) { this.value += step; return this.value } }\nconst result = invokeCaptured<number>(counter.add, counter, [2])",
    scenariosEn: [
      'A plugin callback was validated and captured before queued execution.',
      'The JavaScript receiver must remain identical without rebinding the public function.'
    ],
    scenariosZh: [
      '插件 callback 已在进入执行队列前完成校验和捕获。',
      '需要保持 JavaScript receiver 身份，同时不能改写公开函数。'
    ],
    avoidEn: [
      'A normal direct function or method call is available.',
      'Do not pass an unvalidated arbitrary callable from untrusted input.'
    ],
    avoidZh: ['可以直接调用普通函数或方法。', '不要传入来自不可信输入且尚未校验的任意 callable。']
  }),
  'plugin-host:index:createRegistrationView': guide({
    purposeEn:
      'Publishes a frozen extension-only view for the exact live registration identified by a receipt. It rejects unknown, revoked, uninstalled, or disposing registrations instead of exposing Host internals or another plugin generation.',
    purposeZh:
      '根据注册回执，只公开对应且仍然存活的插件扩展，并返回冻结视图。回执未知、已撤销、尚未安装或正在释放时会直接拒绝；调用方拿不到 Host 内部状态，也不会误读其他插件代次。',
    quickStart:
      "import { createRegistrationView, PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'\n\ntry {\n  const view = createRegistrationView(receipt)\n  await view.extensions.search('migaia')\n} catch (error) {\n  if (error instanceof PluginHostError && error.code === PluginHostErrorCode.viewRevoked) {\n    refreshRegistration()\n  }\n}",
    scenariosEn: [
      'A composition layer holds a registration receipt and must expose only that plugin generation’s extensions.',
      'A consumer must fail closed after logical removal instead of retaining stale extension access.'
    ],
    scenariosZh: [
      '组合层持有注册回执，只允许使用该插件代次发布的扩展。',
      '插件被逻辑移除后，读取方必须失败关闭，不能继续使用旧扩展。'
    ],
    avoidEn: [
      'Application code has no registration receipt; use the committed Host view intended for consumers.',
      'The caller needs lifecycle state, ownership, or mutation methods; this view intentionally exposes none of them.'
    ],
    avoidZh: [
      '普通应用没有注册回执；应使用 Host 提供给使用方的已提交视图。',
      '调用方需要生命周期状态、所有权信息或变更方法；此视图有意不公开这些内容。'
    ]
  }),
  'plugin-host:composition:createView': guide({
    purposeEn:
      'Converts a typed registration token into the frozen extension-only view for that exact live plugin generation. It is the public typed entry point over createRegistrationView and fails after revocation rather than returning stale extensions.',
    purposeZh:
      '把带类型的注册 token 转成该插件精确代次的冻结扩展视图。它是 createRegistrationView 的公开类型安全入口；注册被撤销后会失败，不会继续返回过期扩展。',
    quickStart:
      "import { createView } from '@migaia/plugin-host/composition'\n\nconst view = createView(searchRegistration)\nconst results = await view.extensions.search('migaia')",
    scenariosEn: [
      'Typed composition code receives a registration token and needs only that plugin’s published extensions.',
      'The view must become unusable as soon as its exact registration is revoked.'
    ],
    scenariosZh: [
      '带类型的组合代码拿到注册 token，只需要该插件公开的扩展。',
      '对应注册一旦撤销，这个视图就必须立即失效。'
    ],
    avoidEn: [
      'Consumer code already has a committed aggregate Host view.',
      'The caller needs to mutate registration state or inspect Host internals.'
    ],
    avoidZh: [
      '使用方已经拿到 Host 的已提交聚合视图。',
      '调用方需要修改注册状态或查看 Host 内部数据。'
    ]
  }),
  'plugin-host:structural:readPluginHostDisposalProvenance': guide({
    purposeEn:
      'Reads disposal provenance attached by this exact Plugin Host module instance. It returns undefined for ordinary values and foreign module copies instead of trusting structural lookalikes.',
    purposeZh:
      '读取由当前 Plugin Host 模块实例附加的 dispose 来源信息。普通值和其他模块副本创建的值返回 undefined，不会信任仅结构相似的对象。',
    quickStart:
      "import { readPluginHostDisposalProvenance } from '@migaia/plugin-host/structural'\n\nconst provenance = readPluginHostDisposalProvenance(resource)\nif (provenance) console.log(provenance.kind)",
    scenariosEn: [
      'Cleanup diagnostics need to identify which Host node owns a resource.',
      'A test verifies physical cleanup without exposing mutable disposal state.'
    ],
    scenariosZh: [
      '清理诊断需要识别资源由哪个 Host node 持有。',
      '测试需要验证物理清理，但不能暴露可变 dispose 状态。'
    ],
    avoidEn: [
      'Do not use provenance as authorization.',
      'Do not treat undefined as proof that a value has no disposer.'
    ],
    avoidZh: ['不要把来源信息当作权限。', 'undefined 不能证明该值没有 disposer。']
  }),
  ...Object.fromEntries(
    Object.entries(
      nodeFieldGuide({
        mutableName: 'mutableDeps',
        nounEn: 'upstream dependency set',
        nounZh: '上游依赖集合',
        registerName: 'registerDeps',
        valueExpression: 'new Set<object>()'
      })
    ).map(([name, value]) => [`reactive:node-internals:${name}`, value])
  ),
  ...Object.fromEntries(
    Object.entries(
      nodeFieldGuide({
        mutableName: 'mutableDepVersions',
        nounEn: 'dependency-version map',
        nounZh: '依赖版本映射',
        registerName: 'registerDepVersions',
        valueExpression: 'new Map<object, number>()'
      })
    ).map(([name, value]) => [`reactive:node-internals:${name}`, value])
  ),
  ...Object.fromEntries(
    Object.entries(
      nodeFieldGuide({
        mutableName: 'mutableSubs',
        nounEn: 'downstream subscriber set',
        nounZh: '下游订阅者集合',
        registerName: 'registerSubs',
        valueExpression: 'new Set()'
      })
    ).map(([name, value]) => [`reactive:node-internals:${name}`, value])
  ),
  'reactive:node-internals:registerVersion': guide({
    purposeEn:
      'Registers the initial version held by a custom reactive node. Version updates must use setVersion so graph readers observe one canonical counter.',
    purposeZh:
      '登记自定义 reactive node 的初始版本。后续更新必须使用 setVersion，确保依赖图读取的是同一个规范计数器。',
    quickStart:
      "import { registerVersion, readVersion, setVersion } from '@migaia/reactive/node-internals'\n\nconst node = {}\nregisterVersion(node, 0)\nsetVersion(node, 1)\nconsole.log(readVersion(node, 0))",
    scenariosEn: [
      'A custom node participates in invalidation and must expose a monotonically changing version.',
      'The implementation keeps version storage private from consumers.'
    ],
    scenariosZh: [
      '自定义节点需要参与失效传播，并公开单调变化的版本。',
      '实现层需要向使用方隐藏可写版本存储。'
    ],
    avoidEn: [
      'Ordinary application code should let Signal and Runtime manage versions.',
      'Do not register the same node twice.'
    ],
    avoidZh: ['普通应用应让 Signal 与 Runtime 管理版本。', '不要对同一 node 重复登记。']
  }),
  'reactive:node-internals:setVersion': guide({
    purposeEn:
      'Updates the registered version of a custom reactive node after its value or topology changes. It refuses unregistered nodes instead of creating hidden state implicitly.',
    purposeZh:
      '在自定义 reactive node 的值或连接关系变化后更新已登记版本。未登记 node 会被拒绝，不会静默创建隐藏状态。',
    quickStart:
      "import { registerVersion, setVersion } from '@migaia/reactive/node-internals'\n\nconst node = {}\nregisterVersion(node, 0)\nsetVersion(node, 1)",
    scenariosEn: [
      'A custom node has committed a real change and must invalidate version-aware readers.',
      'Version ownership was established during node construction.'
    ],
    scenariosZh: [
      '自定义节点已提交真实变化，需要让依赖版本的读取方失效。',
      '节点构造时已经登记版本所有权。'
    ],
    avoidEn: [
      'Do not increment versions for Object.is-equal writes.',
      'Do not use it before registerVersion.'
    ],
    avoidZh: ['Object.is 相等的写入不要推进版本。', '不要在 registerVersion 之前调用。']
  }),
  'reactive:node-internals:readVersion': guide({
    purposeEn:
      'Reads the version registered for a custom node, using the supplied fallback only when the node has no private registration. It never advances the graph clock.',
    purposeZh:
      '读取自定义 node 已登记的版本；仅当没有私有登记时才返回 fallback。该操作不会推进依赖图时钟。',
    quickStart:
      "import { readVersion, registerVersion } from '@migaia/reactive/node-internals'\n\nconst node = {}\nregisterVersion(node, 4)\nconsole.log(readVersion(node, 0)) // 4",
    scenariosEn: [
      'An extension compares captured dependency versions before reusing a result.',
      'A custom node exposes read-only version observation.'
    ],
    scenariosZh: ['扩展在复用结果前需要比较捕获的依赖版本。', '自定义节点需要公开只读版本观察。'],
    avoidEn: [
      'Do not use it as a general counter.',
      'Do not assume the fallback replaces a registered version.'
    ],
    avoidZh: ['不要把它当作普通计数器。', '不要认为 fallback 会覆盖已登记版本。']
  }),
  'reactive:runtime:VersionClock': guide({
    purposeEn:
      'Allocates monotonically increasing safe-integer versions for committed reactive changes. Exhaustion fails before mutation so the graph never contains a changed value with an unchanged version.',
    purposeZh:
      '为已经提交的响应式变化分配单调递增的安全整数版本。耗尽时会在修改前失败，避免出现“值已变化但版本未变化”的依赖图。',
    quickStart:
      "import { VersionClock } from '@migaia/reactive/runtime'\n\nconst clock = new VersionClock()\nconst first = clock.next()\nconsole.log(first, clock.current())",
    scenariosEn: [
      'A custom Runtime implementation needs one authoritative version source.',
      'Tests need a deliberately small maximum version to verify exhaustion.'
    ],
    scenariosZh: [
      '自定义 Runtime 实现需要唯一的权威版本来源。',
      '测试需要较小的最大版本来验证耗尽行为。'
    ],
    avoidEn: [
      'Application code should use createRuntime instead of managing versions.',
      'Do not reset a live graph clock; create a new Runtime after releasing the old graph.'
    ],
    avoidZh: [
      '普通应用应使用 createRuntime，而不是自行管理版本。',
      '不要重置仍在使用的图时钟；释放旧图后创建新 Runtime。'
    ]
  }),
  'reactive:runtime:Scheduler': guide({
    purposeEn:
      'Queues invalidated reactive work, coalesces repeated requests, and flushes items in bounded passes. Runtime owns the normal Scheduler; this constructor exists for custom runtime infrastructure and deterministic tests.',
    purposeZh:
      '排队处理已失效的响应式工作、合并重复请求，并用有上限的轮次完成 flush。普通 Scheduler 由 Runtime 持有；该构造器面向自定义运行时基础设施和确定性测试。',
    quickStart:
      "import { Scheduler } from '@migaia/reactive/runtime'\n\nconst scheduler = new Scheduler(console.error, 100, queueMicrotask)\nscheduler.enqueue({ flush: () => console.log('updated') })\nscheduler.requestFlush()",
    scenariosEn: [
      'A custom runtime adapter injects its own microtask implementation or error reporter.',
      'A test must control flush scheduling deterministically.'
    ],
    scenariosZh: [
      '自定义运行时适配器需要注入 microtask 实现或错误报告函数。',
      '测试需要确定性控制 flush 调度。'
    ],
    avoidEn: [
      'Application code should call Runtime.batch or Runtime.flush.',
      'Do not enqueue arbitrary long-running application jobs.'
    ],
    avoidZh: ['普通应用应调用 Runtime.batch 或 Runtime.flush。', '不要用它排队任意长时间业务任务。']
  }),
  'reactive:runtime:DependencyTracker': guide({
    purposeEn:
      'Captures observable reads during one computation and atomically replaces the observer dependency edges after success. Runtime uses it internally; extension authors use it only when implementing a new node kind.',
    purposeZh:
      '捕获一次计算期间读取的 observable，并在成功后原子替换 observer 的依赖边。Runtime 会在内部使用它；扩展作者只在实现新节点类型时直接使用。',
    quickStart:
      "import { DependencyTracker, createRuntime } from '@migaia/reactive/runtime'\n\nconst runtime = createRuntime()\nconst tracker = new DependencyTracker(runtime)\nconsole.log(tracker.isTracking())",
    scenariosEn: [
      'A custom computed-like node must rebuild dependencies after each evaluation.',
      'Dispose must disconnect every edge owned by one observer.'
    ],
    scenariosZh: [
      '自定义 computed 类节点需要在每次求值后重建依赖。',
      'dispose 需要断开一个 observer 持有的全部依赖边。'
    ],
    avoidEn: [
      'Application code only needs derived values; use Computed.',
      'Do not join nodes from different Runtime instances.'
    ],
    avoidZh: ['普通应用只需要派生值；应使用 Computed。', '不要连接来自不同 Runtime 的节点。']
  }),
  'reactive:runtime:createObserverBinding': guide({
    purposeEn:
      'Bridges render-and-commit hosts to one reactive observer. capture records reads without publishing edges, commit validates the snapshot, and observe owns the live Effect used after host subscription.',
    purposeZh:
      '把具有 render/commit 阶段的宿主接入一个 reactive observer。capture 只记录读取而不发布依赖边，commit 校验快照，observe 持有订阅后的活动 Effect。',
    quickStart:
      "import { createObserverBinding, createRuntime } from '@migaia/reactive/runtime'\n\nconst runtime = createRuntime()\nconst value = runtime.signal(1)\nconst binding = createObserverBinding(runtime)\nconst stop = binding.observe(() => value.value)\nconst capture = binding.capture(() => value.value)\nif (binding.commit(capture) === 'stale') binding.retrack()\nstop()",
    quickStartEn:
      "// Import the binding primitive and the Runtime that owns every dependency.\nimport { createObserverBinding, createRuntime } from '@migaia/reactive/runtime'\n\n// Create one isolated reactive graph for this UI root.\nconst runtime = createRuntime()\n\n// Create the source that the render phase will read.\nconst value = runtime.signal(1)\n\n// Allocate one binding for one host observer; do not share it across components.\nconst binding = createObserverBinding(runtime)\n\n// Render: capture the value and dependency versions without publishing subscriptions.\nconst capture = binding.capture(() => value.value)\n\n// Use capture.result as the render snapshot; an abandoned render leaves no graph edges.\nconsole.log('rendered value:', capture.result)\n\n// Subscription/commit: install the one live Effect that will own committed dependencies.\nconst stop = binding.observe(() => console.log('schedule host update:', value.value))\n\n// Validate and publish the captured dependency set to that observer.\nconst commitResult = binding.commit(capture)\n\n// If a dependency changed after render, discard the token and force a fresh observer pass.\nif (commitResult === 'stale') binding.retrack()\n\n// Host unmount: dispose the observer and remove every dependency edge it owns.\nstop()\n\n// Release the example source after no observer can read it again.\nvalue.dispose()",
    quickStartZh:
      "// 导入三阶段绑定原语，以及拥有全部依赖节点的 Runtime 工厂。\nimport { createObserverBinding, createRuntime } from '@migaia/reactive/runtime'\n\n// 为这一棵 UI root 创建隔离的响应式图。\nconst runtime = createRuntime()\n\n// 创建 render 阶段会读取的事实来源。\nconst value = runtime.signal(1)\n\n// 一个 binding 只服务一个宿主 observer，不要跨组件复用。\nconst binding = createObserverBinding(runtime)\n\n// render：读取值并捕获依赖版本，但此时绝不发布订阅边。\nconst capture = binding.capture(() => value.value)\n\n// capture.result 是本次 render 快照；render 被丢弃也不会污染依赖图。\nconsole.log('rendered value:', capture.result)\n\n// subscription/commit：安装唯一的活动 Effect，之后由它持有正式依赖。\nconst stop = binding.observe(() => console.log('schedule host update:', value.value))\n\n// 校验 capture 仍新鲜，并把它记录的依赖原子安装到 observer。\nconst commitResult = binding.commit(capture)\n\n// render 后若依赖已变化，stale token 已作废，强制 observer 重新追踪当前值。\nif (commitResult === 'stale') binding.retrack()\n\n// 宿主卸载：释放 observer，并删除它拥有的全部依赖边。\nstop()\n\n// 确认没有 observer 会再次读取后，再释放示例 Signal。\nvalue.dispose()",
    scenariosEn: [
      'A UI adapter renders before it is allowed to publish subscriptions.',
      'The host must detect a dependency change between render and commit.'
    ],
    scenariosZh: [
      'UI 适配器先 render，之后才能正式发布订阅。',
      '宿主需要检测 render 与 commit 之间依赖是否变化。'
    ],
    avoidEn: [
      'A normal reactive side effect can use runtime.effect directly.',
      'Do not reuse one capture token after a stale result.'
    ],
    avoidZh: [
      '普通响应式副作用可直接使用 runtime.effect。',
      'commit 返回 stale 后不要复用同一个 capture token。'
    ]
  }),
  'reactive:source:createFieldSource': guide({
    purposeEn:
      'Creates a controlled dependency source for data stored outside JavaScript, such as WASM memory. Readers call track; writers call commit so version allocation, mutation, and notification happen as one ordered operation.',
    purposeZh:
      '为 WASM memory 等存放在 JavaScript 之外的数据创建受控依赖源。读取方调用 track；写入方调用 commit，使版本分配、实际写入和通知按一个有序操作完成。',
    quickStart:
      "import { createFieldSource, createRuntime } from '@migaia/reactive'\n\nconst runtime = createRuntime()\nconst field = createFieldSource(runtime, 'counter')\nlet stored = 0\nconst read = () => { field.track(); return stored }\nconst write = (value: number) => field.commit(() => { stored = value })\nwrite(1)\nconsole.log(read())\nfield.dispose()",
    scenariosEn: [
      'A custom storage adapter must make external mutable data observable.',
      'The extension must not receive direct access to graph nodes or subscriber sets.'
    ],
    scenariosZh: [
      '自定义存储适配器需要让外部可变数据参与响应式更新。',
      '扩展不能直接获得图节点或订阅者集合。'
    ],
    avoidEn: [
      'The value already lives in JavaScript; use Signal.',
      'A write cannot be made atomic with notification.'
    ],
    avoidZh: ['数据已经存放在 JavaScript 中；应使用 Signal。', '实际写入无法与通知组成原子操作。']
  }),
  'reactive:copy-check:brandOwnedValue': guide({
    purposeEn:
      'Adds the immutable Migaia ownership brand to an object created by the current reactive module copy. Another installed copy can then reject that object instead of treating it as an ordinary unowned value.',
    purposeZh:
      '给当前 reactive 模块副本创建的对象附加不可变 Migaia 所有权品牌。另一份已安装副本遇到它时会明确拒绝，而不会把它误当作普通无主值。',
    quickStart:
      "import { brandOwnedValue, assertNoForeignOwnershipBrand } from '@migaia/reactive/copy-check'\n\nconst managedNode = {}\nbrandOwnedValue(managedNode)\nassertNoForeignOwnershipBrand(managedNode)",
    scenariosEn: [
      'A custom reactive node factory creates values that must never cross between duplicate runtime copies.',
      'A graph entry guard needs to distinguish plain objects from managed objects created elsewhere.'
    ],
    scenariosZh: [
      '自定义 reactive 节点工厂创建的值绝不能跨重复 Runtime 副本使用。',
      '依赖图入口需要区分普通对象与其他副本创建的受管对象。'
    ],
    avoidEn: [
      'Do not brand ordinary application data.',
      'Do not use branding as authorization or a security boundary.'
    ],
    avoidZh: ['不要给普通应用数据加该品牌。', '不要把品牌当作权限或安全边界。']
  }),
  'reactive:copy-check:assertNoForeignOwnershipBrand': guide({
    purposeEn:
      'Rejects a managed reactive object branded by another installed module copy. Plain unbranded values and values branded by the current copy pass unchanged.',
    purposeZh:
      '拒绝由另一份已安装 reactive 模块副本创建的受管对象。普通无品牌值和当前副本创建的值会原样通过。',
    quickStart:
      "import { assertNoForeignOwnershipBrand } from '@migaia/reactive/copy-check'\n\nassertNoForeignOwnershipBrand(candidate) // throws on a foreign managed value",
    scenariosEn: [
      'A Registry or graph boundary accepts unknown objects but must fail closed for foreign reactive nodes.',
      'A duplicate dependency could otherwise produce permanently stale reads.'
    ],
    scenariosZh: [
      'Registry 或依赖图入口接收 unknown object，但必须拒绝外来 reactive node。',
      '重复依赖副本可能导致读取永久陈旧，需要在入口直接失败。'
    ],
    avoidEn: [
      'Do not call it for primitives; the API expects an object.',
      'Do not use it as a substitute for assertReactiveOwnedBy inside one Runtime copy.'
    ],
    avoidZh: [
      '不要传入 primitive；该 API 只接受 object。',
      '同一 Runtime 副本内的所有权校验应使用 assertReactiveOwnedBy。'
    ]
  }),
  'reactive:copy-check:noteRuntimeCopy': guide({
    purposeEn:
      'Registers one reactive module-copy identity in the process-wide copy detector. The operation is idempotent for the same identity; the optional argument exists for deterministic duplicate-copy tests.',
    purposeZh:
      '在进程级副本检测器中登记一个 reactive 模块副本身份。同一身份重复登记是幂等的；可选参数仅用于确定性模拟重复副本。',
    quickStart:
      "import { noteRuntimeCopy, runtimeCopyCount } from '@migaia/reactive/copy-check'\n\nnoteRuntimeCopy()\nconsole.log(runtimeCopyCount)",
    scenariosEn: [
      'A custom Runtime construction path must participate in duplicate-copy diagnostics.',
      'A test needs to model two separately loaded copies without changing the installed dependency graph.'
    ],
    scenariosZh: [
      '自定义 Runtime 构造路径需要参与重复副本诊断。',
      '测试需要在不改动依赖安装的情况下模拟两份独立模块。'
    ],
    avoidEn: [
      'Normal applications do not need to call it; createRuntime registers the current copy.',
      'Do not pass invented symbols in production.'
    ],
    avoidZh: [
      '普通应用无需调用；createRuntime 会登记当前副本。',
      '生产代码不要传入自行创建的 symbol。'
    ]
  }),
  'reactive:copy-check:assertSingleRuntimeCopy': guide({
    purposeEn:
      'Fails immediately when more than one reactive runtime module copy has been registered. Applications that prefer startup failure over possible cross-copy stale state can run this after dependency initialization.',
    purposeZh:
      '检测到已登记的 reactive runtime 模块副本超过一份时立即失败。宁可启动失败、也不接受跨副本陈旧状态的应用，可在依赖初始化后调用。',
    quickStart:
      "import { assertSingleRuntimeCopy } from '@migaia/reactive/copy-check'\n\nassertSingleRuntimeCopy() // call once during application startup",
    scenariosEn: [
      'A deployed bundle must guarantee one reactive runtime copy.',
      'Micro-frontends share objects and cannot safely isolate duplicate Runtime copies.'
    ],
    scenariosZh: [
      '部署产物必须保证只有一份 reactive runtime。',
      '多个微前端会共享对象，无法安全隔离重复 Runtime 副本。'
    ],
    avoidEn: [
      'Several copies are intentionally isolated and never exchange managed objects.',
      'Do not call it before all application bundles have loaded if the result is used as a deployment gate.'
    ],
    avoidZh: [
      '多份副本被刻意隔离，且不会交换受管对象。',
      '若把结果作为部署门禁，不要在全部应用 bundle 加载前调用。'
    ]
  }),
  'reactive:copy-check:resetRuntimeCopiesForTest': guide({
    purposeEn:
      'Clears simulated copy identities created by tests so one test cannot affect the next. It is test-only and must never be used to make a live duplicate-copy deployment appear valid.',
    purposeZh:
      '清除测试模拟的副本身份，避免一个用例污染下一个用例。它仅供测试使用，绝不能用来把真实的重复副本部署伪装成有效状态。',
    quickStart:
      "import { resetRuntimeCopiesForTest } from '@migaia/reactive/copy-check'\n\nafterEach(() => resetRuntimeCopiesForTest())",
    scenariosEn: [
      'A copy-conflict unit test registered synthetic module identities.',
      'Parallel test isolation gives each test its own detector lifetime.'
    ],
    scenariosZh: [
      '副本冲突单元测试登记了模拟模块身份。',
      '测试隔离要求每个用例拥有独立检测器生命周期。'
    ],
    avoidEn: [
      'Never call it in application or library runtime code.',
      'Do not use it to recover a live graph after a real copy conflict.'
    ],
    avoidZh: [
      '应用或库运行时代码绝不能调用。',
      '真实副本冲突发生后，不要用它尝试恢复仍在使用的依赖图。'
    ]
  }),
  'reactive:copy-check:runtimeCopyCount': guide({
    purposeEn:
      'Returns how many reactive module copies have entered a Runtime or ownership correctness boundary. Merely importing a copy does not increment the count.',
    purposeZh:
      '返回已经进入 Runtime 或所有权正确性边界的 reactive 模块副本数量。仅仅 import 某份副本不会增加计数。',
    quickStart:
      "import { runtimeCopyCount } from '@migaia/reactive/copy-check'\n\nconsole.log(runtimeCopyCount())",
    scenariosEn: [
      'Startup diagnostics report whether bundling produced duplicate active copies.',
      'Tests verify that an ownership boundary registers its module copy.'
    ],
    scenariosZh: [
      '启动诊断需要报告 bundle 是否产生多份活动副本。',
      '测试需要验证所有权入口会登记当前模块副本。'
    ],
    avoidEn: [
      'Do not use the count as proof that objects can safely cross copies.',
      'Do not poll it as application state.'
    ],
    avoidZh: ['不要把计数当作对象可以安全跨副本传递的证明。', '不要把它作为应用状态持续轮询。']
  }),
  'reactive:copy-check:consumePendingCopyWarning': guide({
    purposeEn:
      'Returns and clears the pending duplicate-copy warning produced before a Runtime could report it. Runtime construction consumes this once and forwards it to the configured diagnostics channel.',
    purposeZh:
      '取出并清除 Runtime 能够报告之前产生的重复副本警告。Runtime 构造时只消费一次，并把它转发到已配置的诊断通道。',
    quickStart:
      "import { consumePendingCopyWarning } from '@migaia/reactive/copy-check'\n\nconst warning = consumePendingCopyWarning()\nif (warning) console.warn(warning)",
    scenariosEn: [
      'A custom Runtime constructor must forward an early copy warning exactly once.',
      'A test verifies warning consumption and clearing.'
    ],
    scenariosZh: [
      '自定义 Runtime 构造器需要把早期副本警告准确转发一次。',
      '测试需要验证警告被读取后已经清除。'
    ],
    avoidEn: [
      'Normal applications should receive the warning through Runtime diagnostics.',
      'Do not repeatedly consume it from several owners.'
    ],
    avoidZh: ['普通应用应通过 Runtime 诊断接收警告。', '不要由多个 owner 重复消费。']
  }),
  'reactive:internals:registerInternals': guide({
    purposeEn:
      'Associates one trusted internal clock, tracker, and scheduler surface with a Runtime during construction. A second registration is rejected because replacing live graph machinery would split ownership.',
    purposeZh:
      '在 Runtime 构造期间，把一组可信的时钟、依赖追踪器与调度器内部能力关联到该 Runtime。重复登记会被拒绝，因为替换活动依赖图组件会破坏所有权。',
    quickStart:
      "import { registerInternals } from '@migaia/reactive/internals'\n\nregisterInternals(runtime, { clock, tracker, scheduler })",
    scenariosEn: [
      'A custom Runtime implementation assembles the canonical internal services before creating nodes.',
      'An infrastructure adapter needs the same internals lookup used by built-in factories.'
    ],
    scenariosZh: [
      '自定义 Runtime 实现在创建节点前组装规范内部服务。',
      '基础设施适配器需要复用内置工厂使用的同一内部能力查找。'
    ],
    avoidEn: [
      'Application code should create a Runtime through createRuntime.',
      'Do not register guessed or partial internals.'
    ],
    avoidZh: [
      '普通应用应通过 createRuntime 创建 Runtime。',
      '不要登记猜测出来或不完整的 internals。'
    ]
  }),
  'reactive:internals:internalsOf': guide({
    purposeEn:
      'Returns the trusted internal services previously registered for a Runtime. It throws for an unregistered structural imitation so failures occur at the boundary rather than later during graph mutation.',
    purposeZh:
      '返回此前为 Runtime 登记的可信内部服务。未登记的结构伪造对象会在入口直接失败，避免直到依赖图修改时才出现难追踪错误。',
    quickStart:
      "import { internalsOf } from '@migaia/reactive/internals'\n\nconst { clock, tracker, scheduler } = internalsOf(runtime)",
    scenariosEn: [
      'A reactive infrastructure extension needs the exact services owned by one Runtime.',
      'A node factory must reject a forged Runtime before allocating graph state.'
    ],
    scenariosZh: [
      'reactive 基础设施扩展需要取得某个 Runtime 实际持有的服务。',
      '节点工厂必须在分配依赖图状态前拒绝伪造 Runtime。'
    ],
    avoidEn: [
      'Application code should use public Runtime methods.',
      'Do not cache internals across different Runtime instances.'
    ],
    avoidZh: [
      '普通应用应使用 Runtime 的公开方法。',
      '不要在不同 Runtime 实例之间缓存并复用 internals。'
    ]
  }),
  'reactive:internals:isRuntime': guide({
    purposeEn:
      'Checks whether a value is a Runtime created and registered by this exact reactive module copy. It does not expose the internal clock, tracker, or scheduler.',
    purposeZh:
      '检查一个值是否为当前 reactive 模块副本创建并登记的 Runtime，同时不会暴露内部 clock、tracker 或 scheduler。',
    quickStart:
      "import { isRuntime } from '@migaia/reactive/internals'\n\nif (!isRuntime(candidate)) throw new TypeError('Expected a Migaia Runtime')",
    scenariosEn: [
      'An infrastructure extension accepts unknown input before calling Runtime internals.',
      'A boundary must reject structural imitations and Runtime values from another copy.'
    ],
    scenariosZh: [
      '基础设施扩展在调用 Runtime internals 前需要检查 unknown input。',
      '入口必须拒绝结构伪造对象和其他副本创建的 Runtime。'
    ],
    avoidEn: [
      'Application code can accept the public IRuntime contract directly.',
      'Do not treat the result as a security decision.'
    ],
    avoidZh: ['普通应用可以直接接受公开 IRuntime contract。', '不要把检测结果当作安全决策。']
  }),
  'reactive:node-factories:internalRuntimeOf': guide({
    purposeEn:
      'Validates that a Runtime was created by this library copy and returns the concrete internal node-factory surface. This keeps unsafe implementation casts in one guarded location.',
    purposeZh:
      '先确认 Runtime 由当前库副本创建，再返回具体的节点工厂内部能力。这样不安全的实现层类型转换只存在于一个受保护入口。',
    quickStart:
      "import { internalRuntimeOf } from '@migaia/reactive/node-factories'\n\nconst internal = internalRuntimeOf(runtime)\nconst signal = internal.signal(0)",
    scenariosEn: [
      'A built-in or third-party node factory must call the concrete Runtime implementation.',
      'The factory must reject structural Runtime lookalikes.'
    ],
    scenariosZh: [
      '内置或第三方节点工厂需要调用具体 Runtime 实现。',
      '工厂必须拒绝仅结构相似的 Runtime 对象。'
    ],
    avoidEn: [
      'Application code should call runtime.signal, runtime.computed, or runtime.effect.',
      'Do not retain the internal surface beyond the factory operation.'
    ],
    avoidZh: [
      '普通应用应调用 runtime.signal、runtime.computed 或 runtime.effect。',
      '不要在工厂操作结束后长期保存内部能力。'
    ]
  }),
  'reactive:node-factories:isRuntimeTracking': guide({
    purposeEn:
      'Reports whether the specified Runtime is currently collecting dependency reads. It is a read-only implementation query and does not start, stop, or alter tracking.',
    purposeZh:
      '报告指定 Runtime 当前是否正在收集依赖读取。它只是只读实现层查询，不会开始、停止或改变 tracking。',
    quickStart:
      "import { isRuntimeTracking } from '@migaia/reactive/node-factories'\n\nif (isRuntimeTracking(runtime)) source.track()",
    scenariosEn: [
      'A custom source avoids bookkeeping when no dependency frame is active.',
      'Diagnostics need to report tracking state for one Runtime.'
    ],
    scenariosZh: [
      '自定义 source 在没有活动依赖帧时跳过记录。',
      '诊断需要报告某一个 Runtime 的 tracking 状态。'
    ],
    avoidEn: [
      'Do not branch application behavior on tracking state.',
      'Use isAnyRuntimeTracking only for process-wide diagnostics.'
    ],
    avoidZh: ['不要让应用业务行为依赖 tracking 状态。', '进程级诊断应使用 isAnyRuntimeTracking。']
  }),
  'reactive:node-factories:isAnyRuntimeTracking': guide({
    purposeEn:
      'Reports whether any Runtime in the current module copy has an active dependency frame. It is intended for implementation diagnostics and never mutates tracking state.',
    purposeZh:
      '报告当前模块副本中的任意 Runtime 是否存在活动依赖帧。它面向实现层诊断，绝不会修改 tracking 状态。',
    quickStart:
      "import { isAnyRuntimeTracking } from '@migaia/reactive/node-factories'\n\nconsole.debug({ tracking: isAnyRuntimeTracking() })",
    scenariosEn: [
      'Development diagnostics need to detect reads performed during dependency collection.',
      'A test verifies tracking frames are always closed after failure.'
    ],
    scenariosZh: [
      '开发诊断需要识别依赖收集期间发生的读取。',
      '测试需要确认失败后 tracking frame 已经关闭。'
    ],
    avoidEn: [
      'Do not use it to infer which Runtime owns a value.',
      'Do not use a process-wide result when one Runtime-specific result is required.'
    ],
    avoidZh: [
      '不要用它推断某个值属于哪个 Runtime。',
      '需要指定 Runtime 的结果时，不要使用进程级结果。'
    ]
  }),
  'reactive:ownership:claimOwnership': guide({
    purposeEn:
      'Records that a managed object belongs to one Runtime. Reclaiming the same object for another Runtime fails because one reactive node cannot safely participate in two independent graphs.',
    purposeZh:
      '登记一个受管对象属于某个 Runtime。若再把同一对象登记给另一个 Runtime 会失败，因为一个 reactive node 无法安全加入两张独立依赖图。',
    quickStart:
      "import { claimOwnership, ownerOf } from '@migaia/reactive/ownership'\n\nconst node = {}\nclaimOwnership(node, runtime)\nconsole.log(ownerOf(node) === runtime)",
    scenariosEn: [
      'A custom node factory has finished constructing a node for one Runtime.',
      'Later graph guards must verify exact owner identity.'
    ],
    scenariosZh: [
      '自定义节点工厂已经为某个 Runtime 构造完成节点。',
      '之后的依赖图入口需要校验精确 owner identity。'
    ],
    avoidEn: [
      'Do not claim ordinary application values that never enter the graph.',
      'Do not transfer ownership between live Runtime instances.'
    ],
    avoidZh: ['永远不会进入依赖图的普通应用值无需登记。', '不要在仍存活的 Runtime 之间转移所有权。']
  }),
  'reactive:ownership:ownerOf': guide({
    purposeEn:
      'Returns the Runtime that owns a managed object, or undefined for unregistered and non-object values. It distinguishes plain Registry values from nodes that must obey graph ownership.',
    purposeZh:
      '返回受管对象所属的 Runtime；未登记值和非对象返回 undefined。它用于区分普通 Registry 值与必须遵守依赖图所有权的节点。',
    quickStart:
      "import { ownerOf } from '@migaia/reactive/ownership'\n\nconst owner = ownerOf(candidate)\nif (owner) console.log('managed by a Runtime')",
    scenariosEn: [
      'An adapter accepts both plain values and managed reactive nodes.',
      'Diagnostics need to report the owner without changing graph state.'
    ],
    scenariosZh: [
      '适配器同时接受普通值和受管 reactive node。',
      '诊断需要在不修改依赖图的情况下报告 owner。'
    ],
    avoidEn: [
      'Do not treat undefined as proof that an object is safe to add to a graph.',
      'Use strict assertions at graph mutation boundaries.'
    ],
    avoidZh: ['undefined 不能证明对象可以安全加入依赖图。', '修改依赖图的入口应使用严格断言。']
  }),
  'reactive:ownership:assertOwnedBy': guide({
    purposeEn:
      'Rejects a registered object when its Runtime differs from the expected owner, while allowing unregistered plain values. Use it at boundaries that legitimately accept both ordinary and managed values.',
    purposeZh:
      '已登记对象所属 Runtime 与预期不同时拒绝，但允许普通未登记值通过。适用于同时接受普通值与受管值的边界。',
    quickStart:
      "import { assertOwnedBy } from '@migaia/reactive/ownership'\n\nassertOwnedBy(value, runtime, 'registry value')",
    scenariosEn: [
      'A Registry accepts plain application values plus Runtime-owned nodes.',
      'A helpful label is required in cross-Runtime diagnostics.'
    ],
    scenariosZh: [
      'Registry 同时接受普通应用值和 Runtime-owned node。',
      '跨 Runtime 诊断需要包含可读的对象标签。'
    ],
    avoidEn: [
      'A real graph node must always be managed; use assertReactiveOwnedBy.',
      'Do not use it as a general object validator.'
    ],
    avoidZh: [
      '真实依赖图节点必须已登记；应使用 assertReactiveOwnedBy。',
      '不要把它当作通用对象校验器。'
    ]
  }),
  'reactive:ownership:assertReactiveOwnedBy': guide({
    purposeEn:
      'Strictly requires a reactive object to be registered to the expected Runtime. Both unowned structural imitations and nodes owned by another Runtime are rejected before graph edges are changed.',
    purposeZh:
      '严格要求 reactive object 已登记给预期 Runtime。未登记的结构伪造对象和属于其他 Runtime 的节点都会在修改依赖边前被拒绝。',
    quickStart:
      "import { assertReactiveOwnedBy } from '@migaia/reactive/ownership'\n\nassertReactiveOwnedBy(node, runtime, 'computed dependency')",
    scenariosEn: [
      'A dependency, subscriber, or source is about to enter the reactive graph.',
      'Structural lookalikes must not gain access to mutable graph state.'
    ],
    scenariosZh: [
      'dependency、subscriber 或 source 即将进入响应式依赖图。',
      '仅结构相似的对象不能获得可变依赖图状态。'
    ],
    avoidEn: [
      'A boundary intentionally accepts ordinary unowned values; use assertOwnedBy.',
      'Do not catch and ignore the ownership failure.'
    ],
    avoidZh: ['边界明确允许普通无主值；应使用 assertOwnedBy。', '不要捕获后忽略所有权失败。']
  }),
  ...Object.fromEntries(
    [
      ['createStoreSsrError', 'Error', '普通服务端 Store 失败'],
      ['createStoreSsrTypeError', 'TypeError', '参数类型或对象形状错误'],
      ['createStoreSsrRangeError', 'RangeError', '数值范围错误'],
      ['createStoreSsrAggregateError', 'AggregateError', '包含多个可达子错误的批量失败']
    ].map(([name, errorType, purposeZh]) => [
      `store-ssr:index:${name}`,
      guide({
        purposeEn: `Creates a native ${errorType} carrying the stable Store SSR source and caller-selected code without replacing its stack or hiding the original cause.`,
        purposeZh: `创建表示${purposeZh}的原生 ${errorType}，附加稳定的 Store SSR source 与调用方选择的 code，同时保留 stack 和原始 cause。`,
        quickStart: `import { ${name}, StoreSsrErrorCode } from '@migaia/store-ssr'\n\nthrow ${name}(StoreSsrErrorCode.invalidOption, ${errorType === 'AggregateError' ? '[firstError, cleanupError],' : ''} 'Invalid request state')`,
        scenariosEn: [
          'Store SSR code must expose a machine-readable library error code.',
          `Callers still need native ${errorType} checks to work.`
        ],
        scenariosZh: [
          'Store SSR 边界需要公开机器可读的包错误码。',
          `调用方仍需要使用原生 ${errorType} 判断。`
        ],
        avoidEn: [
          'Do not use it for normal request states.',
          'Do not replace an existing native error when tagging it would preserve more information.'
        ],
        avoidZh: [
          '不要用它表示正常请求状态。',
          '已有原生错误可以原位标记时，不要重建错误并丢失信息。'
        ]
      })
    ])
  )
}
