import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Pairs explanations while keeping each public-entry example independently runnable. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Both public host factories run the same option policy with their own construction syntax. */
const hostConfigurationExample = (
  functional: boolean,
  scenario: 'pipeline' | 'queue' | 'diagnostic' | 'cleanup'
): string => {
  const configuration = {
    pipeline: `identity: { name: 'cart' },
    execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 },
    pipeline: { mode: 'async' }`,
    queue: `execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    queueAdmissionTimeoutMs: 20, scheduler`,
    diagnostic: `execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    queueAdmissionDiagnosticMs: 10, scheduler,
    diagnostic: () => { throw new Error('diagnostic unavailable') },
    onDiagnosticFailure: (error) => { failures.push((error as Error).message) }`,
    cleanup: `execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    disposeStepTimeoutMs: 10, scheduler`
  }[scenario]
  const body = {
    pipeline: `const order: string[] = []
host.useAsyncPipeline(async (value, next) => {
  order.push('before'); await next(value + 1); order.push('after')
})
await host.runPipeline(1, (value) => { order.push(String(value)) })
console.log(host.identity.name, order)
await host.dispose()`,
    queue: `await host.use({ name: 'cart', install: () => ({ ready: true }) })
console.log(host.identity.name, host.pipelineMode)
await host.dispose()`,
    diagnostic: `let late = () => {}
host.usePipeline((value, next) => { late = () => { next(value) } })
await host.runPipeline(1, () => {})
late()
console.log(failures)
await host.dispose()`,
    cleanup: `await host.use({ name: 'slow', install: () => ({}), dispose: () => {
  started.resolve(); return release.promise
} })
const closing = host.dispose()
await started.promise
scheduler.advance(11)
const result = await closing
console.log(result.cleanupComplete)
release.resolve()
await result.physicalCompletion`
  }[scenario]
  return `import { PluginHost, defineHost } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/testing'
${
  functional
    ? ''
    : `class AppHost extends PluginHost<Record<string, never>, number> {
  run(value: number, done: (value: number) => void) { return this.runPipeline(value, done) }
}`
}
const scheduler = createManualScheduler()
const failures: string[] = []
const started = Promise.withResolvers<void>()
const release = Promise.withResolvers<void>()
const host = ${functional ? 'defineHost<Record<string, never>, number>({ host: {' : 'new AppHost({'}
    ${configuration}
${functional ? '} })' : '})'}
${functional ? body : body.replaceAll('host.runPipeline(', 'host.run(')}`
}

/** Functional domain and disposal hooks stay on their supported public boundaries. */
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
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } },
  surface: { version: '1.0' },
  domainCore: () => ({ baseUrl: '/api' })
})
const [registration] = await host.use({ name: 'api', install: (core) => ({ url: () => core.baseUrl }) })
console.log(host.version, registration.extensions.url())
await host.dispose()`,
  disposal: `import { defineHost } from '@migaia/plugin-host'
const order: string[] = []
let translated = 0
const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } },
  translateDisposalError: (error) => { translated++; return error },
  dispose: async (next) => {
    order.push('before')
    const result = await next()
    order.push('after')
    return result
  }
})
await host.use({ name: 'broken', install: () => ({}), dispose: () => { throw new Error('cleanup failed') } })
const result = await host.dispose()
console.log(order, translated, result.cleanupErrors.length > 0)`,
  error: `import { PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'
const cause = new TypeError('service unavailable')
const detail = { plugin: 'inventory' }
const error = new PluginHostError(PluginHostErrorCode.pluginInstallFailed, 'inventory cannot start', { cause, detail })
console.log(error.cause === cause, error.detail === detail)`,
  configError: `import { PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'
const cause = { field: 'quantity', value: -1 }
const detail = { plugin: 'cart', path: 'quantity' }
const error = new PluginHostError(PluginHostErrorCode.invalidConfigValue, 'invalid quantity', { cause, detail })
console.log(error.cause === cause, error.detail === detail)`
}

/** Shared descriptions retain separate covers paths for functional and class options. */
const hostConfigurationCases = (functional: boolean): readonly IOptionCaseDoc[] => {
  const prefix = functional ? 'host.' : ''
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
  const covers = (fields: readonly string[]) => [
    ...(functional ? ['host'] : []),
    ...fields.map((field) => prefix + field)
  ]
  return [
    {
      title: t('Name an asynchronous processing host', '为异步处理宿主命名'),
      problem: t(
        'An outer stage must wait for downstream work before recording completion. pipeline async enables await next(); the default sync mode starts downstream only after the stage returns. identity names diagnostics, and both execution budgets are required.',
        '外层步骤需要等下游完成后再记录结束。pipeline async 允许 await next()；默认 sync 在步骤返回后才开始下游。identity 为诊断命名，两个执行预算必填。'
      ),
      example: examples.pipeline,
      result: t(
        "Prints cart and ['before', '2', 'after']; downstream completes before the outer stage ends.",
        "输出 cart 和 ['before', '2', 'after']；下游在外层步骤结束前完成。"
      ),
      covers: covers([
        'identity',
        'identity.name',
        'execution',
        'execution.mutationTimeoutMs',
        'execution.pipelineDrainTimeoutMs',
        'pipeline',
        'pipeline.mode'
      ])
    },
    {
      title: t('Set a queue admission budget', '设置队列接纳预算'),
      problem: t(
        'Interactive changes should not remain queued indefinitely. A numeric queueAdmissionTimeoutMs limits waiting; false disables admission timers, and omission only diagnoses. The local scheduler owns that clock. This run installs one immediately admitted plugin.',
        '交互式变更不应无限排队。数值 queueAdmissionTimeoutMs 限制等待；false 关闭接纳定时器；省略时只诊断。局部 scheduler 持有该时钟。本次运行安装一个立即接纳的插件。'
      ),
      example: examples.queue,
      result: t(
        'Prints DEFAULT sync; installation succeeds without a queue timeout in this run.',
        '输出 DEFAULT sync；本次安装成功，没有发生排队超时。'
      ),
      covers: covers(['queueAdmissionTimeoutMs', 'scheduler'])
    },
    {
      title: t('Observe a diagnostic callback failure', '观察诊断回调失败'),
      problem: t(
        'Late next() and long queue waits share diagnostic. queueAdmissionDiagnosticMs changes the default 1000 ms warning threshold; it applies without an admission timeout. onDiagnosticFailure observes diagnostic itself throwing. Without it, that failure reaches globalThis.reportError when available.',
        '迟到的 next() 和长时间排队共用 diagnostic。queueAdmissionDiagnosticMs 修改默认 1000 毫秒提示阈值，仅在不设接纳超时时生效。onDiagnosticFailure 观察 diagnostic 自身抛错。省略时交给可用的 globalThis.reportError。'
      ),
      example: examples.diagnostic,
      result: t(
        "Prints ['diagnostic unavailable'] after a late next() call.",
        "迟到的 next() 调用后输出 ['diagnostic unavailable']。"
      ),
      covers: covers([
        'diagnostic',
        'onDiagnosticFailure',
        'queueAdmissionDiagnosticMs',
        'scheduler'
      ])
    },
    {
      title: t('Return while one slow disposer settles', '在单个慢速释放函数结算前返回'),
      problem: t(
        'An ordinary disposer should not hold logical shutdown forever. disposeStepTimeoutMs changes the default 5000 ms step budget; false removes it. A timed-out Promise continues under physicalCompletion rather than being forcibly cancelled.',
        '普通释放函数不应永远阻塞逻辑关闭。disposeStepTimeoutMs 修改默认 5000 毫秒步骤预算；false 关闭限制。超时 Promise 在 physicalCompletion 中继续，不会被强制取消。'
      ),
      example: examples.cleanup,
      result: t(
        'Prints false, then finishes physicalCompletion after the gate is released.',
        '输出 false，放行后 physicalCompletion 完成。'
      ),
      covers: covers(['disposeStepTimeoutMs', 'scheduler'])
    }
  ]
}

/** Each option group has a bounded set of independently runnable configuration workflows. */
export const pluginHostOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  host: hostConfigurationCases(false),
  functional: [
    ...hostConfigurationCases(true),
    {
      title: t('Expose a public surface and a plugin domain core', '提供公开表面和插件领域内核'),
      problem: t(
        'Applications can add domain state without subclassing. surface adds application-owned public descriptors; domainCore builds what each plugin receives. Omission adds no public domain members and gives plugins an empty domain core.',
        '应用可以在不继承的情况下加入领域状态。surface 添加应用持有的公开属性；domainCore 构建每个插件收到的领域内核。省略时不增加公开领域成员，插件收到空领域内核。'
      ),
      example: pluginHostOptionExamples.domain,
      result: t(
        'Prints 1.0 /api; the handle and plugin receive their intended domain data.',
        '输出 1.0 /api；句柄和插件各自取得对应领域数据。'
      ),
      covers: ['host', 'surface', 'domainCore']
    },
    {
      title: t(
        'Wrap disposal without pretending to translate collected errors',
        '包装释放并如实处理收集错误'
      ),
      problem: t(
        'dispose wraps canonical cleanup and must call next exactly once. translateDisposalError is retained but the default structured cleanup path does not invoke it. The ordinary structured-cleanup path should omit that retained hook; it does not map cleanupErrors.',
        'dispose 包装规范清理，必须恰好调用一次 next。translateDisposalError 虽然保留，但默认结构化清理路径不会调用它。普通调用方应省略这个保留钩子；它不映射 cleanupErrors。'
      ),
      example: pluginHostOptionExamples.disposal,
      result: t(
        "Prints ['before', 'after'], 0 and true; cleanup errors stay in the result and the translation hook was not invoked.",
        "输出 ['before', 'after']、0 和 true；清理错误保留在结果中，转换钩子没有被调用。"
      ),
      covers: ['host', 'dispose', 'translateDisposalError']
    }
  ],
  error: [
    {
      title: t('Keep failure identity and plugin context', '保留失败身份与插件上下文'),
      problem: t(
        'An installation error needs both its original cause and structured plugin details. cause keeps the earlier failure; detail carries context separately. Omission leaves the corresponding value unattached.',
        '安装错误需要原始原因和结构化插件详情。cause 保留先前失败；detail 单独携带上下文。省略时不附对应值。'
      ),
      example: pluginHostOptionExamples.error,
      result: t(
        'Prints true true; both supplied objects retain identity.',
        '输出 true true；两个传入对象均保留身份。'
      ),
      covers: ['detail']
    },
    {
      title: t('Preserve structured configuration diagnostics', '保留结构化配置诊断'),
      problem: t(
        'A validation failure may be a details record rather than an Error. Keep that record in cause and identify the affected plugin path in detail instead of parsing a message later.',
        '校验失败可能是详情记录，而非 Error。将记录保留在 cause，并通过 detail 标识受影响插件路径，无需之后解析消息。'
      ),
      example: pluginHostOptionExamples.configError,
      result: t(
        'Prints true true; callers can inspect the original record and context.',
        '输出 true true；调用方可检查原始记录及上下文。'
      ),
      covers: ['detail']
    }
  ]
}

/** Installation, dependency and cleanup scenarios use only the published root entry. */
export const pluginHostCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
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
