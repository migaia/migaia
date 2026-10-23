import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Pairs explanations while keeping each public-entry example independently runnable. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Each example shows one application choice, shared by the two public construction forms. */
const hostConfigurationExample = (
  functional: boolean,
  scenario: 'pipeline' | 'queue' | 'diagnostic' | 'cleanup'
): string => {
  /** Expands only the Host policy owned by the selected application situation. */
  const configuration = {
    pipeline: `execution: applicationExecution,
    identity: { name: 'draft-editor' },
    pipeline: { mode: 'async' }`,
    queue: `execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 2000 },
    queueAdmissionTimeoutMs: 1000,
    scheduler: editorScheduler`,
    diagnostic: `execution: applicationExecution,
    queueAdmissionDiagnosticMs: 500,
    scheduler: editorScheduler,
    diagnostic: (message, code, error) => showPluginDiagnostic(message, code, error),
    onDiagnosticFailure: (error) => reportToMonitoring(error)`,
    cleanup: `execution: applicationExecution,
    disposeStepTimeoutMs: 1000,
    scheduler: editorScheduler`
  }[scenario]
  /** Application callbacks keep validation controls outside published snippets. */
  const body = {
    pipeline: `host.useAsyncPipeline(async (text, next) => {
  showSavingIndicator()
  try {
    await next(text.trim())
  } finally {
    hideSavingIndicator()
  }
})
${functional ? 'await host.runPipeline(draftText, saveDocument)' : 'await host.save(draftText)'}
onEditorClosed(() => host.dispose())`,
    queue: `onExportEnabled(async () => {
  try {
    await host.use(exportPlugin)
    showExportReady()
  } catch (error) {
    showExportUnavailable(error)
  }
})
onEditorClosed(() => host.dispose())`,
    diagnostic: `await host.use(exportPlugin)
showExportReady()
onEditorClosed(() => host.dispose())`,
    cleanup: `await host.use(autoSavePlugin)
onEditorClosed(async () => {
  const result = await host.dispose()
  showEditorClosed(result.cleanupComplete)
  await result.physicalCompletion
})`
  }[scenario]
  return `import { ${functional ? 'defineHost' : 'PluginHost'} } from '@migaia/plugin-host'
${
  !functional && scenario === 'pipeline'
    ? `
class DraftHost extends PluginHost<Record<string, never>, string> {
  save(text: string) { return this.runPipeline(text, saveDocument) }
}
`
    : ''
}
const host = ${functional ? 'defineHost<Record<string, never>, string>({ host: {' : `new ${scenario === 'pipeline' ? 'DraftHost' : 'PluginHost<Record<string, never>>'}({`}
    ${configuration}
${functional ? '} })' : '})'}
${body}`
}

/** Field examples share application context rather than embedding validation fixtures. */
export const pluginHostOptionExamples = {
  classPipeline: hostConfigurationExample(false, 'pipeline'),
  classQueue: hostConfigurationExample(false, 'queue'),
  classDiagnostic: hostConfigurationExample(false, 'diagnostic'),
  classCleanup: hostConfigurationExample(false, 'cleanup'),
  functionPipeline: hostConfigurationExample(true, 'pipeline'),
  functionQueue: hostConfigurationExample(true, 'queue'),
  functionDiagnostic: hostConfigurationExample(true, 'diagnostic'),
  functionCleanup: hostConfigurationExample(true, 'cleanup'),
  domain: `import { defineHost } from '@migaia/plugin-host'

const host = defineHost({
  host: applicationHostOptions,
  surface: { apiVersion: '1.0' },
  domainCore: () => ({ baseUrl: '/api' })
})
const [products] = await host.use({
  name: 'products',
  install: (core) => ({ load: () => fetchProducts(core.baseUrl) })
})
showApiVersion(host.apiVersion)
renderProducts(await products.extensions.load())
onEditorClosed(() => host.dispose())`,
  disposal: `import { defineHost } from '@migaia/plugin-host'

const host = defineHost({
  host: applicationHostOptions,
  dispose: async (next) => {
    showClosingScreen()
    const result = await next()
    renderCleanupStatus(result)
    return result
  }
})
await host.use(autoSavePlugin)
onEditorClosed(() => host.dispose())`,
  translation: `import { defineHost } from '@migaia/plugin-host'

const host = defineHost({
  host: applicationHostOptions,
  translateDisposalError: translateDomainDisposalError
})
onEditorClosed(() => host.dispose())`,
  error: `import { PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'

try {
  await startInventoryService()
} catch (cause) {
  const error = new PluginHostError(
    PluginHostErrorCode.pluginInstallFailed,
    'Inventory could not start',
    { cause, detail: { plugin: 'inventory' } }
  )
  showInventoryUnavailable(error.message)
  reportToMonitoring(error)
}`,
  configError: `import { PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'

const rejected = validateCartSettings(submittedSettings)
if (rejected) {
  const error = new PluginHostError(
    PluginHostErrorCode.invalidConfigValue,
    'Cart settings rejected',
    { cause: rejected, detail: { plugin: 'cart', path: 'quantity' } }
  )
  showCartSettingsError(error.message)
  reportToMonitoring(error)
}`
}

/** Prefixes preserve the distinct public contracts without expanding one case beyond its topic. */
const hostConfigurationCases = (functional: boolean): readonly IOptionCaseDoc[] => {
  /** Functional options nest the same Host fields under host. */
  const prefix = functional ? 'host.' : ''
  /** Both construction forms preserve their own runnable public call. */
  const examples = functional
    ? {
        pipeline: pluginHostOptionExamples.functionPipeline,
        queue: pluginHostOptionExamples.functionQueue,
        diagnostic: pluginHostOptionExamples.functionDiagnostic,
        cleanup: pluginHostOptionExamples.functionCleanup
      }
    : {
        pipeline: pluginHostOptionExamples.classPipeline,
        queue: pluginHostOptionExamples.classQueue,
        diagnostic: pluginHostOptionExamples.classDiagnostic,
        cleanup: pluginHostOptionExamples.classCleanup
      }
  /** Maps the shared story to the receiving option type without invented fields. */
  const covers = (fields: readonly string[]) => [
    ...(functional ? ['host'] : []),
    ...fields.map((field) => prefix + field)
  ]
  return [
    {
      title: t('Keep the saving indicator around downstream work', '保存完成后再关闭等待提示'),
      problem: t(
        'The draft editor must keep its saving indicator visible until downstream saving finishes. Async mode lets the outer stage await that work, and the host name ties related diagnostics to this editor.',
        '草稿编辑器需要在下游保存完成前保持等待提示。异步模式让外层步骤等待这项工作，宿主名称将相关诊断归到当前编辑器。'
      ),
      example: examples.pipeline,
      result: t(
        'The trimmed draft is saved before the saving indicator disappears.',
        '去掉首尾空格的草稿保存完成后，等待提示才消失。'
      ),
      covers: covers(['identity', 'identity.name', 'pipeline', 'pipeline.mode'])
    },
    {
      title: t('Bound interactive export-plugin changes', '限制交互式导出插件变更'),
      problem: t(
        'A user enabling export needs an outcome instead of an indefinitely queued or running installation. Set separate admission, active-change and shutdown-drain budgets on the editor clock; these do not preempt JavaScript.',
        '用户启用导出时，需要得到结果，不能无限等待排队或安装。在编辑器时钟上分别限制接纳、活动变更和关闭排空；这些预算不会抢占 JavaScript。'
      ),
      example: examples.queue,
      result: t(
        'The editor either enables export or shows why the change could not complete within its budget.',
        '编辑器启用导出，或显示变更为何未能在预算内完成。'
      ),
      covers: covers([
        'execution',
        'execution.mutationTimeoutMs',
        'execution.pipelineDrainTimeoutMs',
        'queueAdmissionTimeoutMs',
        'scheduler'
      ])
    },
    {
      title: t(
        'Explain slow plugin changes without rejecting them',
        '提示缓慢的插件变更并继续等待'
      ),
      problem: t(
        'The editor is willing to wait for a plugin change, but should explain a queue wait after half a second. Show host diagnostics in the panel and give a failed diagnostic receiver its own monitoring destination.',
        '编辑器愿意继续等待插件变更，但排队半秒后应给出说明。把宿主诊断显示在面板，并为诊断接收器自身的失败提供监控出口。'
      ),
      example: examples.diagnostic,
      result: t(
        'Waiting changes remain eligible to install; diagnostics and receiver failures have visible destinations.',
        '等待中的变更仍可安装，诊断及接收器失败都有可见出口。'
      ),
      covers: covers([
        'diagnostic',
        'onDiagnosticFailure',
        'queueAdmissionDiagnosticMs',
        'scheduler'
      ])
    },
    {
      title: t('Close the editor while cleanup finishes', '编辑器关闭后继续等待清理'),
      problem: t(
        'An autosave resource can take longer than one second to close. Bound each ordinary cleanup step so the editor can show its logical close outcome, then await physicalCompletion for remaining cleanup.',
        '自动保存资源可能超过一秒才关闭。限制每个普通清理步骤，让编辑器先展示逻辑关闭结果，再通过 physicalCompletion 等待剩余清理。'
      ),
      example: examples.cleanup,
      result: t(
        'The editor shows its close outcome without losing the completion of slower cleanup.',
        '编辑器展示关闭结果，同时仍等待较慢清理的最终完成。'
      ),
      covers: covers(['disposeStepTimeoutMs', 'scheduler'])
    }
  ]
}

/** Functional application hooks remain separate from Host timing and reporting policy. */
export const pluginHostOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  host: hostConfigurationCases(false),
  functional: [
    ...hostConfigurationCases(true),
    {
      title: t('Give product plugins the application API', '为商品插件提供应用 API'),
      problem: t(
        'The product view exposes an API revision to consumers, while installed product plugins need a base URL for requests. Put public application data on surface and installation capabilities in domainCore.',
        '商品视图需要向使用者公开 API 版本，已安装商品插件则需要请求地址。公开应用数据放在 surface，安装能力放在 domainCore。'
      ),
      example: pluginHostOptionExamples.domain,
      result: t(
        'The view displays its API revision and loads products through the plugin’s application base URL.',
        '视图显示 API 版本，并通过插件取得的应用地址加载商品。'
      ),
      covers: ['host', 'surface', 'domainCore']
    },
    {
      title: t(
        'Show application shutdown around canonical cleanup',
        '围绕规范清理展示应用关闭状态'
      ),
      problem: t(
        'The editor should switch to a closing screen before plugin cleanup starts, then show the structured cleanup outcome. Wrap disposal and return the result of exactly one next call.',
        '编辑器应在插件清理前切换到关闭界面，再显示结构化清理结果。包装释放，恰好调用一次 next 并返回其结果。'
      ),
      example: pluginHostOptionExamples.disposal,
      result: t(
        'The closing screen appears before cleanup and then receives its result.',
        '清理开始前出现关闭界面，之后界面收到清理结果。'
      ),
      covers: ['host', 'dispose']
    }
  ],
  error: [
    {
      title: t('Explain inventory startup failure', '说明库存服务启动失败'),
      problem: t(
        'The inventory panel needs a readable unavailable message, while support needs the original startup failure and plugin name. Preserve that cause alongside structured detail.',
        '库存面板需要可读的不可用提示，支持人员则需要原始启动失败及插件名称。将 cause 与结构化 detail 一起保留。'
      ),
      example: pluginHostOptionExamples.error,
      result: t(
        'The panel explains the failure and monitoring retains its original cause and inventory context.',
        '面板说明失败，监控保留原始原因与库存插件上下文。'
      ),
      covers: ['detail']
    },
    {
      title: t('Identify rejected cart settings', '指出被拒绝的购物车设置'),
      problem: t(
        'A settings form can reject a structured value rather than throw an Error. Keep that rejection record and the affected plugin path so the form and support can explain the same failure.',
        '设置表单可能拒绝结构化值，而非抛 Error。保留拒绝记录及受影响插件路径，让表单与支持人员解释同一失败。'
      ),
      example: pluginHostOptionExamples.configError,
      result: t(
        'The settings form shows the rejection while monitoring retains the rejected record and quantity path.',
        '设置表单显示拒绝提示，监控保留被拒绝记录与 quantity 路径。'
      ),
      covers: ['detail']
    }
  ]
}

/** Installation, dependency and cleanup scenarios use only the published root entry. */
export const pluginHostCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  dualEntry: [
    {
      title: t(
        'Choose sync or async execution over one stage list',
        '同一阶段列表选择同步或异步执行'
      ),
      problem: t(
        'A host serves synchronous native work and asynchronous operations. Both must receive the same installed intervention stages; an async stage cannot be silently skipped by a synchronous call.',
        '宿主同时处理同步原生操作和异步操作。两条路径必须消费相同的已安装干预阶段，同步调用不能静默跳过异步阶段。'
      ),
      example: t(
        `import { defineHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'

const host = defineHost<Record<string, never>, number>({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 }, pipeline: { mode: 'async' } }
})
host.usePipeline((value, next) => next(value + 1))
console.log(host.runPipelineSync(1, (value) => value))
console.log(await host.runPipelineAsync(1, async (value) => value))
await host.use(definePlugin({
  name: 'timing',
  install: (core: IPluginHostCore<number>) => { core.useAsyncPipeline(async (value, next) => { await next(value) }); return {} }
}))
try { host.runPipelineSync(1, (value) => value) } catch (error) { console.log((error as { code: string }).code) }
await host.unUse('timing')
console.log(host.runPipelineSync(1, (value) => value))
await host.dispose()`,
        `import { defineHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'

const host = defineHost<Record<string, never>, number>({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 }, pipeline: { mode: 'async' } }
})
host.usePipeline((value, next) => next(value + 1))
console.log(host.runPipelineSync(1, (value) => value))
console.log(await host.runPipelineAsync(1, async (value) => value))
await host.use(definePlugin({
  name: 'timing',
  install: (core: IPluginHostCore<number>) => { core.useAsyncPipeline(async (value, next) => { await next(value) }); return {} }
}))
try { host.runPipelineSync(1, (value) => value) } catch (error) { console.log((error as { code: string }).code) }
await host.unUse('timing')
console.log(host.runPipelineSync(1, (value) => value))
await host.dispose()`
      ),
      result: t(
        'Prints 2, 2, ASYNC_STAGE_IN_SYNC_ENTRY, then 2. Removing the async owner restores sync execution. A halted stage returns undefined; with no stages, each entry returns the exact terminal value or Promise.',
        '依次输出 2、2、ASYNC_STAGE_IN_SYNC_ENTRY、2。卸载异步阶段拥有者后恢复同步执行。阶段停止时返回 undefined；零阶段保留终点的原值或 Promise 身份。'
      )
    }
  ],

  defineHost: [
    {
      title: t('Install a plugin and read its extension', '安装插件并读取扩展'),
      problem: t(
        'An application needs to add a named capability and later release its resources. Consumers need a usable extension after installation, rather than a partially initialized plugin object.\n\nAssigning plugin methods directly onto an object does not define when installation commits or who owns cleanup. Returning before an asynchronous installer finishes also exposes methods before their resources exist.\n\ndefineHost creates the lifecycle owner, and await host.use() returns the installed registration. Both execution budgets are required and set to 5000 ms here; they have no implicit defaults. Dispose the host after use.',
        '应用需要添加具名功能并在之后释放资源，消费者需要安装完成后可用的扩展，而不是尚未初始化完成的插件对象。\n\n直接把插件方法挂到对象上，没有定义何时提交安装、谁负责清理；异步安装尚未完成就返回，还会在资源就绪前暴露方法。\n\n`defineHost` 创建生命周期所有者，等待 `host.use()` 后取得已安装登记；两个执行预算均必填，本例各设为 `5000` 毫秒，没有隐式默认值，使用结束后销毁宿主。'
      ),
      example: t(
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst greeting = definePlugin({\n  name: 'greeting',\n  install: () => ({ greet: () => 'hello' })\n})\nconst [registration] = await host.use(greeting)\nconsole.log(registration.extensions.greet())\nawait host.dispose()",
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst greeting = definePlugin({\n  name: 'greeting',\n  install: () => ({ greet: () => '你好' })\n})\nconst [registration] = await host.use(greeting)\nconsole.log(registration.extensions.greet())\nawait host.dispose()"
      ),
      result: t(
        'Prints `hello`. The registration extension is called only after the installation promise has completed, and the final await waits for host cleanup.\n\nThe handle owns host operations; the plugin owns the extension it installs. mutationTimeoutMs bounds active mutations and pipelineDrainTimeoutMs bounds shutdown draining; false explicitly removes either deadline. These limits do not preempt user JavaScript.',
        '输出 `你好`，登记扩展只在安装 `Promise` 完成后调用，最后一次等待用于等待宿主清理。\n\n宿主句柄拥有宿主操作，插件拥有自己安装的扩展；`mutationTimeoutMs` 限制活动变更，`pipelineDrainTimeoutMs` 限制关闭排空，显式 `false` 去掉对应截止时间，这些限制不会抢占用户 JavaScript。'
      )
    },
    {
      title: t(
        'Roll back a failed batch without removing existing plugins',
        '批次失败时回滚新资源并保留原有插件'
      ),
      problem: t(
        'A feature bundle installs several plugins, but one installer rejects its settings. Previously installed capabilities must stay live, and resources created earlier in the failed bundle must be released.\n\nRegistering each extension immediately leaves half a bundle visible after failure. A catch that clears the whole registry also removes plugins that were committed before this batch began.\n\ndefineHost keeps a use() batch private until it commits. Register draft cleanup through core.onDispose during installation, then await use(draft, broken) to observe completed rollback and the original failure cause.',
        '一组功能安装多个插件，其中一个安装器拒绝配置；此前已安装的功能必须继续可用，本次失败批次里已经创建的资源则必须释放。\n\n每装好一个扩展就立即发布，会在失败后留下半套可见功能；捕获失败后清空整个登记表，又会删除本批次之前已经提交的插件。\n\n`defineHost` 在提交前保留 `use()` 批次的私有状态，在安装期间用 `core.onDispose` 登记草稿资源，再等待 `use(draft, broken)`，观察完成的回滚及原始失败原因。'
      ),
      example: t(
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst released: string[] = []\nconst [existing] = await host.use(definePlugin({\n  name: 'existing', install: () => ({ read: () => 'live' })\n}))\nconst original = new TypeError('invalid plugin settings')\nconst draft = definePlugin({\n  name: 'draft',\n  install: (core) => {\n    core.onDispose(() => { released.push('draft') })\n    return {}\n  }\n})\nconst broken = definePlugin({\n  name: 'broken', install: () => { throw original }\n})\ntry {\n  await host.use(draft, broken)\n} catch (error) {\n  console.log((error as { code: string }).code, error instanceof Error && error.cause === original)\n}\nconsole.log(released.join(','))\nconsole.log(existing.extensions.read())\nawait host.dispose()",
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst released: string[] = []\nconst [existing] = await host.use(definePlugin({\n  name: 'existing', install: () => ({ read: () => '运行中' })\n}))\nconst original = new TypeError('invalid plugin settings')\nconst draft = definePlugin({\n  name: 'draft',\n  install: (core) => {\n    core.onDispose(() => { released.push('草稿') })\n    return {}\n  }\n})\nconst broken = definePlugin({\n  name: 'broken', install: () => { throw original }\n})\ntry {\n  await host.use(draft, broken)\n} catch (error) {\n  console.log((error as { code: string }).code, error instanceof Error && error.cause === original)\n}\nconsole.log(released.join(','))\nconsole.log(existing.extensions.read())\nawait host.dispose()"
      ),
      result: t(
        'Prints `PLUGIN_INSTALL_FAILED true`, `draft`, then `live`. The wrapper retains the exact TypeError on cause; the failed batch releases its draft resource while the existing registration still works.\n\nAsynchronous use() releases registered failed-batch resources before rejecting; this example acquires one resource. Previously committed registrations stay live. Arbitrary external side effects are not undone, and rollback errors remain secondary detail.',
        '逐行输出 `PLUGIN_INSTALL_FAILED true`、`草稿`、`运行中`；包装在 `cause` 保留原始 `TypeError`，失败批次释放草稿资源，原有登记仍可调用。\n\n异步 `use()` 释放失败批次已登记的资源后才拒绝，本例取得一项资源，此前已提交登记继续可用；任意外部副作用不会自动撤销，回滚错误保留在次要详情中。'
      )
    }
  ],
  definePlugin: [
    {
      title: t(
        'Keep configuration separate from later source mutations',
        '隔离配置与调用者后续修改'
      ),
      problem: t(
        'A plugin definition captures application settings, then the caller edits the original settings object before installation. The installed configuration should reflect the captured definition, not that later edit.\n\nA shallow copy only separates the outer object. Nested settings remain shared references, so changing a nested limit can silently alter what a future installer reads.\n\ndefinePlugin snapshots and recursively freezes admitted configuration data when the definition is created. Pass ordinary data records or arrays; the host later reads its own configuration through config.get(path).',
        '插件定义捕获应用设置后，调用者在安装前修改了原设置对象；安装后的配置应反映定义时的快照，而不是后来的外部修改。\n\n浅拷贝只分离最外层对象，嵌套设置仍为共享引用，修改内层限制会悄悄改变后续安装器读到的内容。\n\n`definePlugin` 在创建定义时对接纳的配置数据做快照并递归冻结，传入普通数据记录或数组，宿主随后通过 `config.get(path)` 读取自己的配置。'
      ),
      example: t(
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst settings = { limit: 3 }\nconst definition = definePlugin({\n  name: 'meter', config: { settings }, install: () => ({})\n})\nsettings.limit = 99\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nawait host.use(definition)\nconsole.log(host.config.get('meter.settings.limit'))\nconsole.log(Object.isFrozen(definition.config), Object.isFrozen(definition.config?.settings))\nawait host.dispose()",
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst settings = { limit: 3 }\nconst definition = definePlugin({\n  name: 'meter', config: { settings }, install: () => ({})\n})\nsettings.limit = 99\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nawait host.use(definition)\nconsole.log(host.config.get('meter.settings.limit'))\nconsole.log(Object.isFrozen(definition.config), Object.isFrozen(definition.config?.settings))\nawait host.dispose()"
      ),
      result: t(
        'Prints `3` and `true true` on separate lines. Editing settings.limit to 99 does not change the installed value, and both captured configuration levels are frozen.\n\nOmitted config defaults to an empty configuration. This is not JSON serialization: supported function leaves retain identity, while unsupported prototypes, accessors, symbols, thenables and cycles are rejected. Use host.config.update() for a committed configuration change.',
        '逐行输出 `3`、`true true`；把外部 `settings.limit` 改为 `99` 没有改变安装值，捕获配置的两层对象也均已冻结。\n\n省略 `config` 时使用空配置，这不是 JSON 序列化：支持的函数叶值保留身份，不支持的原型、访问器、符号、类 `Promise` 对象（带可调用 `then` 的对象）与环会被拒绝，已提交配置应通过 `host.config.update()` 修改。'
      )
    },
    {
      title: t(
        'Release plugin resources once in reverse acquisition order',
        '按取得逆序释放插件资源且只执行一次'
      ),
      problem: t(
        'A plugin opens resources in order and depends on later resources being released first. Several callers may also ask the same host to close, so cleanup must not run again for every caller.\n\nKeeping separate teardown lists makes it easy to reverse one list incorrectly or invoke a disposer twice. Calling cleanup from every dispose request multiplies releases of the same resource.\n\nDuring definePlugin installation, core.onDispose transfers resources to that registration. defineHost memoizes the disposal promise; await it to observe the plugin hook followed by the resource stack.',
        '插件按顺序取得资源，需要先释放后取得的资源；多个调用方还可能同时请求关闭宿主，清理不能为每个调用方重复执行。\n\n各自保存清理列表，容易把其中一张表的顺序反过来，或把同一个释放器调用两次；每次关闭请求都启动清理，还会重复释放同一资源。\n\n在 `definePlugin` 的安装期间，`core.onDispose` 把资源交给该登记，`defineHost` 复用同一个销毁 `Promise`，等待它即可观察插件钩子及资源栈的释放。'
      ),
      example: t(
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst released: string[] = []\nconst resource = definePlugin({\n  name: 'resource',\n  install: (core) => {\n    core.onDispose(() => { released.push('first') })\n    core.onDispose(() => { released.push('second') })\n    return {}\n  },\n  dispose: () => { released.push('plugin') }\n})\nawait host.use(resource)\nconst closing = host.dispose()\nconsole.log(host.dispose() === closing)\nawait closing\nconsole.log(released.join(','))\nawait host.dispose()\nconsole.log(released.length)",
        "import { defineHost, definePlugin } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst released: string[] = []\nconst resource = definePlugin({\n  name: 'resource',\n  install: (core) => {\n    core.onDispose(() => { released.push('先取得') })\n    core.onDispose(() => { released.push('后取得') })\n    return {}\n  },\n  dispose: () => { released.push('插件') }\n})\nawait host.use(resource)\nconst closing = host.dispose()\nconsole.log(host.dispose() === closing)\nawait closing\nconsole.log(released.join(','))\nawait host.dispose()\nconsole.log(released.length)"
      ),
      result: t(
        'Prints `true`, `plugin,second,first`, then `3`. Concurrent dispose calls share one promise, the plugin hook runs before its resources, and another completed dispose call adds no releases.\n\nonDispose admits resources during installation; it is not a general late-registration API. The host collects cleanup failures, and disposeStepTimeoutMs defaults to 5000 ms per step; inspect cleanupComplete and physicalCompletion when cleanup exceeds its budget.',
        '逐行输出 `true`、`插件,后取得,先取得`、`3`；并发销毁调用复用同一个销毁 `Promise`，插件钩子先于其资源执行，再次销毁没有新增释放。\n\n`onDispose` 在安装期间接纳资源，不是任意时刻登记清理的接口；宿主收集清理失败，`disposeStepTimeoutMs` 默认每步 `5000` 毫秒，超过预算时应检查 `cleanupComplete` 与 `physicalCompletion`。'
      )
    }
  ],
  defineFeature: [
    {
      title: t(
        'Start providers before consumers regardless of argument order',
        '不依赖参数顺序，先启动提供方'
      ),
      problem: t(
        'Two plugins are supplied in UI discovery order, so a consumer can appear before the provider it needs. The consumer still needs the exact provider output, not a separate reconstructed service.\n\nInstalling strictly in array order fails when discovery order changes. Rebuilding the dependency inside each consumer avoids the missing value but creates duplicate service state and separate lifetimes.\n\ndefineFeature declares synchronous factories and dependency aliases. provider.getFeature() creates a required cross-plugin reference; host.use() validates the graph and starts the provider before resolving the consumer.',
        '界面发现插件的顺序可能让消费方排在所需提供方之前，但消费方仍需要提供方的同一份输出，而不是重新构造的另一服务。\n\n严格按数组顺序安装，会随发现顺序变化而失败；每个消费方内部重建依赖虽然避开缺值，却产生重复服务状态与不同生命周期。\n\n`defineFeature` 声明同步工厂与依赖别名，`provider.getFeature()` 创建跨插件的必需引用，`host.use()` 校验依赖图并先启动提供方，再解析消费方。'
      ),
      example: t(
        "import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst order: string[] = []\nconst output = { read: () => 42 }\nlet sameOutput = false\nconst cache = defineFeature(() => {\n  order.push('provider')\n  return output\n})\nconst provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })\nconst summary = defineFeature((_core, dependencies) => {\n  order.push('consumer')\n  sameOutput = dependencies.cache === output\n  return { read: () => dependencies.cache.read() }\n}, { cache: provider.getFeature('cache') })\nconst consumer = definePlugin({ name: 'consumer', features: { summary }, install: () => ({}) })\nconst [consumerHandle, providerHandle] = await host.use(consumer, provider)\nconsole.log(order.join(' -> '))\nconsole.log(sameOutput)\nconsole.log(consumerHandle.name, providerHandle.name)\nawait host.dispose()",
        "import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nconst order: string[] = []\nconst output = { read: () => 42 }\nlet sameOutput = false\nconst cache = defineFeature(() => {\n  order.push('提供方')\n  return output\n})\nconst provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })\nconst summary = defineFeature((_core, dependencies) => {\n  order.push('消费方')\n  sameOutput = dependencies.cache === output\n  return { read: () => dependencies.cache.read() }\n}, { cache: provider.getFeature('cache') })\nconst consumer = definePlugin({ name: 'consumer', features: { summary }, install: () => ({}) })\nconst [consumerHandle, providerHandle] = await host.use(consumer, provider)\nconsole.log(order.join(' -> '))\nconsole.log(sameOutput)\nconsole.log(consumerHandle.name, providerHandle.name)\nawait host.dispose()"
      ),
      result: t(
        'Prints `provider -> consumer`, `true`, then `consumer provider`. Factories follow dependency order and the consumer receives the exact output object; returned registration handles still follow the input order.\n\nFactories must synchronously return objects, though their methods may be asynchronous. Outputs are frozen per registration; omitted dependencies mean an empty map, and required references must have available providers. This graph orders capabilities, not reactive data changes.',
        '逐行输出 `提供方 -> 消费方`、`true`、`consumer provider`；工厂按依赖顺序执行，消费方收到同一输出对象，返回登记句柄仍保持输入顺序。\n\n工厂必须同步返回对象，但其方法可以异步；输出按登记冻结，省略依赖时为空映射，必需引用要求提供方可用，此图安排功能依赖，不追踪响应式数据变化。'
      )
    },
    {
      title: t('Reject a missing provider before installers run', '缺少提供方时在安装器执行前拒绝'),
      problem: t(
        'A deployment enables a consumer plugin but omits its required provider. The host should report the missing prerequisite before the consumer opens any resources.\n\nLooking up services inside the installer discovers the problem only after earlier setup has already performed work. Passing undefined onward shifts the failure into unrelated consumer code.\n\nA reference returned by getFeature() is required by default. defineFeature retains that dependency, and host.use() checks it before installation; count installer calls to make that admission boundary visible.',
        '一次部署启用了消费插件，却漏掉其必需提供方；宿主应在消费方取得资源之前指出缺失的前置依赖。\n\n安装器内部才查找服务，会在先前初始化已经执行之后才发现问题；继续传递 `undefined` 则把失败转移到无关的消费代码里。\n\n`getFeature()` 返回的引用默认必需，`defineFeature` 保留该依赖，`host.use()` 在安装前检查它，通过计数安装器调用来展示这一接纳边界。'
      ),
      example: t(
        "import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nlet installs = 0\nconst cache = defineFeature(() => ({ read: () => 42 }))\nconst provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })\nconst summary = defineFeature((_core, dependencies) => ({\n  read: () => dependencies.cache.read()\n}), { cache: provider.getFeature('cache') })\nconst consumer = definePlugin({\n  name: 'consumer', features: { summary },\n  install: () => { installs++; return {} }\n})\ntry {\n  await host.use(consumer)\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nconsole.log(installs)\nawait host.dispose()",
        "import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }\n})\nlet installs = 0\nconst cache = defineFeature(() => ({ read: () => 42 }))\nconst provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })\nconst summary = defineFeature((_core, dependencies) => ({\n  read: () => dependencies.cache.read()\n}), { cache: provider.getFeature('cache') })\nconst consumer = definePlugin({\n  name: 'consumer', features: { summary },\n  install: () => { installs++; return {} }\n})\ntry {\n  await host.use(consumer)\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nconsole.log(installs)\nawait host.dispose()"
      ),
      result: t(
        'Prints `PREREQUISITE_MISSING` and `0`. The missing provider is rejected directly by preflight, and the consumer installer is never entered.\n\nUse getFeature(name, { optional: true }) only when the consumer deliberately handles an absent output as undefined. Required and optional references both contribute ordering when a provider exists; this example intentionally uses the required default.',
        '逐行输出 `PREREQUISITE_MISSING`、`0`，缺失提供方被预检直接拒绝，消费安装器没有执行。\n\n仅当消费方明确处理缺席输出 `undefined` 时，才用 `getFeature(name, { optional: true })`；提供方存在时必需和可选引用都参与排序，本例有意使用默认的必需引用。'
      )
    }
  ]
}
