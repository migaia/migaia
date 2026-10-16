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

/** One operation is intentionally re-exported by the existing root and scheduler entries. */
const schedulerDeferGuide = guide({
  purposeEn:
    'Registers deferred work through one scheduler while keeping native microtask ordering for the default host. Manual and older two-method clocks control the same work without a new queue or cancellation owner.',
  purposeZh:
    '通过同一个 scheduler 登记延后工作，默认宿主保留原生微任务顺序；手动时钟与旧的双方法时钟也能控制它，无需另一套队列或取消所有者。',
  quickStart: `import { createManualScheduler, deferTask } from '@migaia/utils/scheduler'

// Deterministic test/simulation clock; production hosts supply their own scheduler.
const clock = createManualScheduler()
let observed = 0
deferTask(clock, () => { observed = 1 })
console.log(observed) // 0
clock.advance(0)
console.log(observed) // 1`,
  scenariosEn: [
    'A runtime owner must inject the ordering of deferred control work.',
    'A deterministic test must advance deferred callbacks without a host microtask queue.',
    'A legacy two-method scheduler should keep using its existing zero-delay task registration.'
  ],
  scenariosZh: [
    '运行时所有者需要注入延后控制工作的执行顺序。',
    '确定性测试需要在没有宿主微任务队列时推进回调。',
    '旧的双方法 scheduler 需要继续复用既有零延迟任务登记。'
  ],
  avoidEn: [
    'Use schedule when the job needs a cancel handle or a real deadline.',
    'Await ordinary Promise work directly when completion is required.',
    'Do not expect returned callback Promises to be observed by native deferred registration.'
  ],
  avoidZh: [
    '需要取消句柄或真实截止时间时使用 schedule。',
    '需要完成值时直接 await 普通 Promise 工作。',
    '不要依赖原生延后登记替你观察回调返回的 Promise。'
  ],
  optionsEn: [
    {
      name: 'scheduler',
      type: 'IScheduler',
      optional: false,
      description: 'Owns the deferred method or legacy zero-time fallback.',
      defaultValue: 'required',
      whenToUse: 'Pass the scheduler already admitted by this runtime owner.',
      example: 'deferTask(clock, callback)'
    },
    {
      name: 'callback',
      type: '() => void',
      optional: false,
      description: 'Runs asynchronously; callback completion and errors remain with its caller.',
      defaultValue: 'required',
      whenToUse: 'Enqueue bounded control work without changing timer semantics.',
      example: 'deferTask(clock, () => { observed = 1 })'
    }
  ],
  optionsZh: [
    {
      name: 'scheduler',
      type: 'IScheduler',
      optional: false,
      description: '拥有 deferred 方法或旧的零时刻回退路径。',
      defaultValue: '必填',
      whenToUse: '传入当前运行时所有者已准入的 scheduler。',
      example: 'deferTask(clock, callback)'
    },
    {
      name: 'callback',
      type: '() => void',
      optional: false,
      description: '异步执行，完成与错误仍由调用方负责。',
      defaultValue: '必填',
      whenToUse: '登记有限控制工作并保持计时器语义。',
      example: 'deferTask(clock, () => { observed = 1 })'
    }
  ]
})

/**
 * One coherent provider-to-consumer scenario kept separate from the descriptor and short-form
 * examples.
 */
const definePluginSharedExampleCode = `import { defineFeature, definePlugin, defineHost } from '@migaia/plugin-host'

const prices = new Map([['sku-42', 199]])
const catalog = defineFeature((core: { featureExpose: { readProduct(id: string): number | undefined } }) => ({
  readProduct: core.featureExpose.readProduct
}))
const cacheProvider = definePlugin({
  name: 'cache-provider',
  features: { catalog },
  install: () => ({}),
  featureExpose: () => ({ readProduct: (id: string) => prices.get(id) })
})

// 消费者通过 provider 的 getFeature() 引用声明依赖，不再按字符串键读取 shared。
const readerCatalog = defineFeature(
  (_core, dependencies) => ({ readProduct: dependencies.cache.readProduct }),
  { cache: cacheProvider.getFeature('catalog') }
)
const productReader = definePlugin<
  Record<string, never>,
  { loadProduct(id: string): number },
  never,
  'product-reader',
  { catalog: typeof readerCatalog }
>(
  'product-reader',
  (core) => ({
    install: () => ({ loadProduct: (id: string) => core.features.catalog.readProduct(id) ?? 0 })
  }),
  { catalog: readerCatalog }
)

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({})
})
// provider 必须排在 consumer 前面；整批成功后才一起对外可见。
const [, reader] = await host.use(cacheProvider, productReader)

console.log(reader.extensions.loadProduct('sku-42')) // 199
await host.dispose()`

/** Complete guides for public operations added after the original website inventory. */
export const completionApiGuides: Readonly<
  Record<string, Readonly<Partial<Record<IGuideLocale, IApiGuide>>>>
> = {
  'utils:scheduler:deferTask': schedulerDeferGuide,
  'rpc-core:index:createRpcIdempotencyStore': guide({
    purposeEn:
      'Creates the RPC-owned idempotency/result store used by request keys and outcome lookup. Retention is local to its owner unless the application supplies durable storage and reconciliation.',
    purposeZh:
      '创建 RPC owner 的幂等键与结果存储，用于请求键和 outcome 查询；除非应用提供持久化及对账，结果只在当前 owner 内保留。',
    quickStart:
      "import { createRpcIdempotencyStore } from '@migaia/rpc-core'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRpcIdempotencyStore>) {\n  return createRpcIdempotencyStore(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:features-one-way:createOneWayFeature': guide({
    purposeEn:
      'Adds sendOneWay to a composed endpoint over the existing outbound Feature. Completion means physical send completed, not that the remote provider executed successfully.',
    purposeZh:
      '在现有 outbound Feature 上为组合 endpoint 增加 sendOneWay；完成只表示物理发送结束，不证明远端 provider 成功执行。',
    quickStart:
      "import { createOneWayFeature } from '@migaia/rpc-core/features/one-way'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createOneWayFeature>) {\n  return createOneWayFeature(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:plugins-log:createIpcLogFeature': guide({
    purposeEn:
      'Creates the IPC log Feature for one connection/session, reporting lifecycle and backlog facts through the existing Host logger without exposing the peer authentication token.',
    purposeZh:
      '为一个 connection/session 创建 IPC 日志 Feature，通过既有 Host logger 报告生命周期与 backlog 事实，不暴露对端鉴权 token。',
    quickStart:
      "import { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createIpcLogFeature>) {\n  return createIpcLogFeature(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:plugins-send-queue:createIpcSendQueueFeature': guide({
    purposeEn:
      'Creates the connection-owned bounded send gate with separate data and control capacity. Provider replies and stream data retain the data lane instead of being dropped as control traffic.',
    purposeZh:
      '创建连接持有的有界发送 gate，分别保留 data 与 control 容量；provider 回复和 stream 数据继续占用 data lane，不会被当成控制流丢弃。',
    quickStart:
      "import { createIpcSendQueueFeature } from '@migaia/rpc-core/plugins/send-queue'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createIpcSendQueueFeature>) {\n  return createIpcSendQueueFeature(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:plugins-send-queue:createIpcSendQueueTransport': guide({
    purposeEn:
      'Attaches the existing send gate to one original physical transport, carrying its negotiated agreement and native ownership without building a second queue or receiver.',
    purposeZh:
      '把现有发送 gate 接到一个原物理 transport，携带其协商结果与原生所有权，不创建第二份队列或接收器。',
    quickStart:
      "import { createIpcSendQueueTransport } from '@migaia/rpc-core/plugins/send-queue'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createIpcSendQueueTransport>) {\n  return createIpcSendQueueTransport(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:stream:createCanonicalChunkFeature': guide({
    purposeEn:
      'Creates the canonical chunk-reassembly dependency used by outbound and stream Features. It is selected during endpoint composition and released with the original endpoint scope.',
    purposeZh:
      '创建 outbound 和 stream Feature 使用的规范分片重组依赖，在 endpoint 组合时选定，并随原 endpoint scope 释放。',
    quickStart:
      "import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createCanonicalChunkFeature>) {\n  return createCanonicalChunkFeature(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:stream:createStreamFeature': guide({
    purposeEn:
      'Adds the stream owner to existing outbound/provider Features, retaining direction, sequence, credit, cancellation and terminal cleanup in that owner.',
    purposeZh:
      '在现有 outbound/provider Feature 上增加 stream owner，由它保留方向、序号、额度、取消和终态清理职责。',
    quickStart:
      "import { createStreamFeature } from '@migaia/rpc-core/stream'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createStreamFeature>) {\n  return createStreamFeature(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:index:createNativeProcessOffer': guide({
    purposeEn:
      'Builds the local native-process version/codec/capability offer; the handshake intersects it with the independent peer and never treats local declarations as remote support.',
    purposeZh:
      '构造本端原生进程版本、codec 与能力 offer；握手与独立对端取交集，不把本端声明当作远端支持。',
    quickStart:
      "import { createNativeProcessOffer } from '@migaia/rpc-process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createNativeProcessOffer>) {\n  return createNativeProcessOffer(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:index:createProcessResilience': guide({
    purposeEn:
      'Creates the process-specific resilience policy over the existing supervision and generation owners, retaining native health, drain and bounded replacement behavior.',
    purposeZh:
      '在原 supervision 和 generation owner 上创建进程恢复策略，保留原生健康检查、drain 与有界替换行为。',
    quickStart:
      "import { createProcessResilience } from '@migaia/rpc-process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createProcessResilience>) {\n  return createProcessResilience(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:index:createProcessTransport': guide({
    purposeEn:
      'Negotiates one native byte channel or accepts an explicit message-channel agreement, then exposes the original framed transport, capability result and stable close ownership.',
    purposeZh:
      '协商一个原生字节通道，或接纳明确的消息通道协议结果，然后公开原帧 transport、能力交集与稳定的 close 所有权。',
    quickStart:
      "import { createProcessTransport } from '@migaia/rpc-process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createProcessTransport>) {\n  return createProcessTransport(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:index:parseProcessPluginDescriptor': guide({
    purposeEn:
      'Validates an external process plugin descriptor before startup, keeping names, source selection and declared options on the maintained closed configuration contract.',
    purposeZh:
      '启动前校验外部进程插件描述符，把名称、来源选择和声明选项限制在维护中的封闭配置契约内。',
    quickStart:
      "import { parseProcessPluginDescriptor } from '@migaia/rpc-process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof parseProcessPluginDescriptor>) {\n  return parseProcessPluginDescriptor(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:adapters-deno-command:openProcessStdioChannel': guide({
    purposeEn:
      'Opens the actual Deno stdin/stdout byte channel used after trusted bootstrap, retaining stream ownership and native close instead of pretending a message port exists.',
    purposeZh:
      '在可信 bootstrap 后打开实际 Deno stdin/stdout 字节通道，保留原流所有权和原生 close，不伪造 message port。',
    quickStart:
      "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/deno-command'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof openProcessStdioChannel>) {\n  return openProcessStdioChannel(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:adapters-node-child-process:openProcessStdioChannel': guide({
    purposeEn:
      'Opens Node-compatible child stdio after the trusted bootstrap frame and keeps the original streams, cancellation and closed-state observation.',
    purposeZh:
      '在可信 bootstrap 帧之后打开 Node 兼容子进程 stdio，并保留原流、取消和关闭状态观察。',
    quickStart:
      "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof openProcessStdioChannel>) {\n  return openProcessStdioChannel(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:adapters-node-socket:dialProcessByteChannel': guide({
    purposeEn:
      'Dials one local Unix or loopback TCP byte connection for a borrowed process session. The connection can close locally but never owns the target process.',
    purposeZh:
      '连接一个本地 Unix 或 loopback TCP 字节通道，创建借用进程会话；可以关闭本端连接，但不拥有目标进程。',
    quickStart:
      "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof dialProcessByteChannel>) {\n  return dialProcessByteChannel(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:adapters-deno-socket:dialProcessByteChannel': guide({
    purposeEn:
      'Dials a real Deno local socket with the maintained native byte framing; permission errors remain observable and are not converted to fake ready state.',
    purposeZh:
      '使用维护中的原生字节帧连接实际 Deno 本地 socket；权限错误仍可观察，不会被转换成伪造的 ready 状态。',
    quickStart:
      "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/deno-socket'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof dialProcessByteChannel>) {\n  return dialProcessByteChannel(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:createCoroutinePlugin': guide({
    purposeEn:
      'Run a supervised task in the same process and verify its returned result. A task is work that stays available until it finishes or receives a stop signal. Run this complete main.ts example in Node.js. The consumer Host supplies task. The handler Host uses the connect value received by that task. Both sides use host.coroutine.',
    purposeZh:
      '你将运行同进程受监督的 task，并验证返回值。task 是持续工作到完成或收到停止 signal（信号）的任务。在 Node.js 中运行这个完整的 main.ts 示例。调用端 Host 传入 task。处理端 Host 使用该 task 收到的 connect。两端通过 host.coroutine 调用。',
    quickStart: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createCoroutinePlugin } from '@migaia/rpc-core/remote'

const service = createCoroutinePlugin<{ double(value: number): number }>({
  name: 'math', task: async ({ connect, signal }) => {
    const parent = createCoroutinePlugin({ name: 'parent', connect, provide: { double: (value: number) => value * 2 } })
    const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
    try { await child.use(parent); await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) }) }
    finally { await child.dispose() }
  }
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try { await host.use(service); assert.equal(await host.coroutine!.request('math', 'double', 21), 42) }
finally { await host.dispose() }`,
    examplesEn: [
      {
        id: 'complete-coroutine-calls',
        title: 'main.ts: handler and consumer in one process',
        description:
          'Run this file in Node.js. The task installs the handler Host. The outer Host consumes request, notify and stream. readNote waits for the saved notification payload. Assertions check the numeric result, notification and streamed items. finally closes both Hosts.',
        code: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createCoroutinePlugin } from '@migaia/rpc-core/remote'

/** The task publishes this API to the parent Host. */
type IServiceApi = {
  double(value: number): number
  note(value: string): void
  readNote(): Promise<string>
  count(limit: number): AsyncIterableIterator<number>
}
/** Both Hosts run in this Node.js main.ts process. */
const service = createCoroutinePlugin<IServiceApi>({
  name: 'math',
  task: async ({ connect, signal }) => {
    /** Store the first notification so readNote confirms that the handler ran. */
    let receiveNote: (value: string) => void = () => undefined
    const receivedNote = new Promise<string>((resolve) => { receiveNote = resolve })
    /** Child mode joins the connection supplied to this task. */
    const parent = createCoroutinePlugin({
      name: 'parent', connect,
      provide: {
        double: (value: number) => value * 2,
        note: (value: string) => receiveNote(value),
        readNote: () => receivedNote,
        count: async function* (limit: number) {
          for (let value = 1; value <= limit; value++) yield value
        }
      }
    })
    /** The handler Host stays available until the parent stops its task. */
    const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
    try {
      await child.use(parent)
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    } finally { await child.dispose() }
  }
})
/** The consumer Host owns the installed task. */
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.coroutine!.request('math', 'double', 21), 42)
  await host.coroutine!.notify('math', 'note', 'hello')
  assert.equal(await host.coroutine!.request('math', 'readNote'), 'hello')
  /** Collect every item before checking the complete stream. */
  const values: number[] = []
  for await (const value of host.coroutine!.stream('math', 'count', 3)) values.push(value)
  assert.deepEqual(values, [1, 2, 3])
} finally { await host.dispose() }`
      }
    ],
    examplesZh: [
      {
        id: 'complete-coroutine-calls',
        title: 'main.ts：同进程的处理端与调用端',
        description:
          '在 Node.js 中运行这个文件。task 安装处理端 Host。外层 Host 调用 request、notify 与 stream（逐项结果）。readNote 等待已保存的通知 payload（输入值）。Assertions 验证数字结果、通知与所有流结果。finally 释放两个 Hosts。',
        code: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createCoroutinePlugin } from '@migaia/rpc-core/remote'

/** The task publishes this API to the parent Host. */
type IServiceApi = {
  double(value: number): number
  note(value: string): void
  readNote(): Promise<string>
  count(limit: number): AsyncIterableIterator<number>
}
/** Both Hosts run in this Node.js main.ts process. */
const service = createCoroutinePlugin<IServiceApi>({
  name: 'math',
  task: async ({ connect, signal }) => {
    /** Store the first notification so readNote confirms that the handler ran. */
    let receiveNote: (value: string) => void = () => undefined
    const receivedNote = new Promise<string>((resolve) => { receiveNote = resolve })
    /** Child mode joins the connection supplied to this task. */
    const parent = createCoroutinePlugin({
      name: 'parent', connect,
      provide: {
        double: (value: number) => value * 2,
        note: (value: string) => receiveNote(value),
        readNote: () => receivedNote,
        count: async function* (limit: number) {
          for (let value = 1; value <= limit; value++) yield value
        }
      }
    })
    /** The handler Host stays available until the parent stops its task. */
    const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
    try {
      await child.use(parent)
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    } finally { await child.dispose() }
  }
})
/** The consumer Host owns the installed task. */
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.coroutine!.request('math', 'double', 21), 42)
  await host.coroutine!.notify('math', 'note', 'hello')
  assert.equal(await host.coroutine!.request('math', 'readNote'), 'hello')
  /** Collect every item before checking the complete stream. */
  const values: number[] = []
  for await (const value of host.coroutine!.stream('math', 'count', 3)) values.push(value)
  assert.deepEqual(values, [1, 2, 3])
} finally { await host.dispose() }`
      }
    ],
    scenariosEn: [
      'The application needs supervised work without a Worker or child process.',
      'The parent needs cooperative stop, restart or replace(name, { task }).'
    ],
    scenariosZh: [
      '应用需要受监督的工作，无需 Worker 或子进程。',
      '父端需要协作停止、restart 或 replace(name, { task })。'
    ],
    avoidEn: [
      'Pass exactly one of task or connect. A child uses only the connect value received by its task.',
      'CPU-bound work that blocks the event loop cannot be stopped until it yields.',
      'A resolved task exits normally. A rejected task crashes. Release its handler Host in finally.',
      'Next task: cancel an unfinished request in Calls and cancellation (calls-and-cancellation).'
    ],
    avoidZh: [
      'task 与 connect 必须二选一。子端只使用自己的 task 收到的 connect。',
      'CPU 密集工作阻塞事件循环期间无法停止。',
      'task resolve 表示正常退出。task reject 表示异常退出。在 finally 中释放处理端 Host。',
      '下一任务：按“调用与取消”（calls-and-cancellation）取消未完成的 request。'
    ]
  }),
  'rpc-core:remote:createRemoteHost': guide({
    purposeEn:
      'Creates the advanced remote Host facade over a supplied original binding, preserving supervision, generation and Host control instead of launching a new unit itself.',
    purposeZh:
      '在给定原 binding 上创建高级 remote Host 门面，保留 supervision、generation 与 Host control；门面本身不另行启动执行单元。',
    quickStart:
      "import { createRemoteHost } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRemoteHost>) {\n  return createRemoteHost(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:createRemotePlugin': guide({
    purposeEn:
      'Builds the advanced remote Plugin definition around one supplied binding and contract. Installation, exposed methods and close remain part of the adopting PluginHost.',
    purposeZh:
      '围绕一个给定 binding 和 contract 创建高级 remote Plugin 定义；安装、公开方法和 close 都属于采纳它的 PluginHost。',
    quickStart:
      "import { createRemotePlugin } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRemotePlugin>) {\n  return createRemotePlugin(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:createRemoteRetryPort': guide({
    purposeEn:
      'Creates the bounded retry strategy port used with the original generation, idempotency key, deadline and dispatch owner; unknown outcome never proves a non-idempotent write can be repeated.',
    purposeZh:
      '创建与原 generation、幂等键、deadline 和 dispatch owner 配合的有界重试策略端口；unknown outcome 不证明非幂等写可安全重复。',
    quickStart:
      "import { createRemoteRetryPort } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRemoteRetryPort>) {\n  return createRemoteRetryPort(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:normalizeRemoteContract': guide({
    purposeEn:
      'Normalizes an external advanced remote contract before installing its method projection; it rejects invalid keys/modes instead of granting methods not actually provided.',
    purposeZh:
      '安装方法投影前规范化外部高级 remote contract；拒绝非法键和 mode，不会授予实际未提供的方法。',
    quickStart:
      "import { normalizeRemoteContract } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof normalizeRemoteContract>) {\n  return normalizeRemoteContract(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:normalizeRemoteControlShape': guide({
    purposeEn:
      'Validates one Host-control payload against the registered control definition, preserving portable values and exact action shape before remote dispatch.',
    purposeZh:
      '远端分发前按已登记 control 定义校验 Host-control payload，保留可移植值与明确的动作形态。',
    quickStart:
      "import { normalizeRemoteControlShape } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof normalizeRemoteControlShape>) {\n  return normalizeRemoteControlShape(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:normalizeRemoteHostCatalog': guide({
    purposeEn:
      'Validates the external Host plugin catalog used by the advanced remote facade, retaining explicit plugin/method names and rejecting structural conflicts before publication.',
    purposeZh:
      '校验高级 remote 门面使用的外部 Host 插件目录，保留明确的插件和方法名，并在发布前拒绝结构冲突。',
    quickStart:
      "import { normalizeRemoteHostCatalog } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof normalizeRemoteHostCatalog>) {\n  return normalizeRemoteHostCatalog(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:sameRemoteContract': guide({
    purposeEn:
      'Compares two normalized remote contracts by their maintained method and mode semantics for directory compatibility decisions; equality does not authorize a caller.',
    purposeZh:
      '按维护中的方法与 mode 语义比较两个规范 remote contract，供目录兼容判断使用；相等不代表调用者获得权限。',
    quickStart:
      "import { sameRemoteContract } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof sameRemoteContract>) {\n  return sameRemoteContract(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:serveRemoteHost': guide({
    purposeEn:
      'Publishes an explicitly exposed local Host through an accepted remote channel while preserving method whitelists and the local Host registration owner.',
    purposeZh:
      '通过已采纳 remote channel 发布显式 expose 的本地 Host，保留方法白名单及本地 Host 注册 owner。',
    quickStart:
      "import { serveRemoteHost } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof serveRemoteHost>) {\n  return serveRemoteHost(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:remote:serveRemotePlugin': guide({
    purposeEn:
      'Publishes the explicitly exposed local Plugin projection through an accepted channel; it transfers calls and results, never executable plugin code.',
    purposeZh:
      '通过已采纳 channel 发布显式 expose 的本地 Plugin 投影；只传输调用和结果，不传输可执行插件代码。',
    quickStart:
      "import { serveRemotePlugin } from '@migaia/rpc-core/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof serveRemotePlugin>) {\n  return serveRemotePlugin(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-core:testing:createPeerPair': guide({
    purposeEn:
      'Creates two in-memory symmetric Peers with cross-inferred provide types and the real core call/error/order semantics. It is an application test helper, not evidence of native transfer or process isolation.',
    purposeZh:
      '创建两个内存内对称 Peer，交叉推导 provide 类型并执行真实 core 调用、错误和顺序语义；这是应用测试 helper，不证明原生 transfer 或进程隔离。',
    quickStart:
      "import { createPeerPair } from '@migaia/rpc-core/testing'\n\nconst pair = await createPeerPair({\n  a: { provide: { echo: (value: string) => value } },\n  b: { provide: { double: (value: number) => value * 2 } }\n})\ntry {\n  console.log(await pair.a.request('double', 21))\n  console.log(await pair.b.request('echo', 'ready'))\n} finally {\n  await Promise.all([pair.a.close(), pair.b.close()])\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-threads:index:createNodeThreadChannel': guide({
    purposeEn:
      'Binds an existing Node MessagePort to the canonical borrowed thread channel with an explicit peer identity and scheduler; only the original launcher observes Worker exit.',
    purposeZh:
      '把已有 Node MessagePort 绑定到规范借用线程通道，并声明 peer 身份和 scheduler；只有原 launcher 负责观察 Worker 退出。',
    quickStart:
      "import { createNodeThreadChannel } from '@migaia/rpc-threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createNodeThreadChannel>) {\n  return createNodeThreadChannel(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-threads:index:createWebThreadChannel': guide({
    purposeEn:
      'Binds an existing EventTarget-style port after bootstrap has finished, retaining borrowed message ownership without claiming Worker termination authority.',
    purposeZh:
      '在 bootstrap 完成后绑定已有 EventTarget 风格端口，保留借用消息所有权，不宣称拥有 Worker 终止权限。',
    quickStart:
      "import { createWebThreadChannel } from '@migaia/rpc-threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createWebThreadChannel>) {\n  return createWebThreadChannel(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-threads:index:readThreadBootstrap': guide({
    purposeEn:
      'Validates a received trusted thread bootstrap value before its identity and parent route are used; extra object fields do not create launcher ownership.',
    purposeZh:
      '使用身份和父路由前校验收到的可信线程 bootstrap 值；额外对象字段不能创造 launcher 所有权。',
    quickStart:
      "import { readThreadBootstrap } from '@migaia/rpc-threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof readThreadBootstrap>) {\n  return readThreadBootstrap(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-threads:index:receiveThreadData': guide({
    purposeEn:
      'Receives the maintained thread preparation data and gives it to the existing preparation callback, preserving the channel identity before ordinary message reception starts.',
    purposeZh:
      '接收维护中的线程准备数据并交给既有 preparation 回调，在普通消息接收开始前保留通道身份。',
    quickStart:
      "import { receiveThreadData } from '@migaia/rpc-threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof receiveThreadData>) {\n  return receiveThreadData(...args)\n}",
    scenariosEn: [
      'A library adapter must assemble the explicit source, contract or runtime policy named above.',
      'The application needs to retain the original channel/Host lifecycle while validating inputs at its own integration boundary.'
    ],
    scenariosZh: [
      '库适配器需要装配上述明确的来源、契约或运行时策略。',
      '应用需要保留原 channel/Host 生命周期，并在自己的集成边界校验输入。'
    ],
    avoidEn: [
      'Prefer the four process/thread Peer or Plugin factories for ordinary application RPC.',
      'Do not treat this low-level operation as permission to bypass expose, source authentication or cleanup ownership.'
    ],
    avoidZh: [
      '普通业务 RPC 优先使用四个 process/thread Peer 或 Plugin 工厂。',
      '不要把底层操作当作绕过 expose、source 鉴权或资源清理归属的权限。'
    ]
  }),
  'rpc-process:adapters-bun-spawn:createBunProcessLauncher': guide({
    purposeEn:
      'Creates the bun-spawn native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 bun-spawn 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBunProcessLauncher } from '@migaia/rpc-process/adapters/bun-spawn'\n\nexport function configureAdapter(options: Parameters<typeof createBunProcessLauncher>[0]) {\n  return createBunProcessLauncher(options)\n}",
    scenariosEn: [
      'A bun-spawn application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'bun-spawn 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-process:adapters-deno-command:createDenoProcessLauncher': guide({
    purposeEn:
      'Creates the deno-command native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 deno-command 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createDenoProcessLauncher } from '@migaia/rpc-process/adapters/deno-command'\n\nexport function configureAdapter(options: Parameters<typeof createDenoProcessLauncher>[0]) {\n  return createDenoProcessLauncher(options)\n}",
    scenariosEn: [
      'A deno-command application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'deno-command 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-process:adapters-electron-utility-process:createElectronUtilityProcessLauncher': guide({
    purposeEn:
      'Creates the electron-utility-process native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-utility-process 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronUtilityProcessLauncher } from '@migaia/rpc-process/adapters/electron-utility-process'\n\nconst adapter = createElectronUtilityProcessLauncher()\nconsole.log(adapter)",
    scenariosEn: [
      'A electron-utility-process application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'electron-utility-process 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-process:adapters-node-child-process:createNodeProcessLauncher': guide({
    purposeEn:
      'Creates the node-child-process native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 node-child-process 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\n\nexport function configureAdapter(options: Parameters<typeof createNodeProcessLauncher>[0]) {\n  return createNodeProcessLauncher(options)\n}",
    scenariosEn: [
      'A node-child-process application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'node-child-process 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-process:adapters-windows-job:createWindowsJobProcessLauncher': guide({
    purposeEn:
      'Creates the windows-job native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 windows-job 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createWindowsJobProcessLauncher } from '@migaia/rpc-process/adapters/windows-job'\n\nconst adapter = createWindowsJobProcessLauncher()\nconsole.log(adapter)",
    scenariosEn: [
      'A windows-job application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'windows-job 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-browser:createBrowserThreadChannelFactory': guide({
    purposeEn:
      'Creates the browser handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 browser 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBrowserThreadChannelFactory } from '@migaia/rpc-threads/adapters/browser'\n\nexport function configureAdapter(options: Parameters<typeof createBrowserThreadChannelFactory>[0]) {\n  return createBrowserThreadChannelFactory(options)\n}",
    scenariosEn: [
      'A browser application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'browser 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-browser:createBrowserThreadLauncher': guide({
    purposeEn:
      'Creates the browser native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 browser 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBrowserThreadLauncher } from '@migaia/rpc-threads/adapters/browser'\n\nexport function configureAdapter(options: Parameters<typeof createBrowserThreadLauncher>[0]) {\n  return createBrowserThreadLauncher(options)\n}",
    scenariosEn: [
      'A browser application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'browser 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-bun:createBunThreadChannelFactory': guide({
    purposeEn:
      'Creates the bun handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 bun 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBunThreadChannelFactory } from '@migaia/rpc-threads/adapters/bun'\n\nexport function configureAdapter(options: Parameters<typeof createBunThreadChannelFactory>[0]) {\n  return createBunThreadChannelFactory(options)\n}",
    scenariosEn: [
      'A bun application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'bun 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-bun:createBunThreadLauncher': guide({
    purposeEn:
      'Creates the bun native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 bun 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBunThreadLauncher } from '@migaia/rpc-threads/adapters/bun'\n\nexport function configureAdapter(options: Parameters<typeof createBunThreadLauncher>[0]) {\n  return createBunThreadLauncher(options)\n}",
    scenariosEn: [
      'A bun application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'bun 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-deno:createDenoThreadChannelFactory': guide({
    purposeEn:
      'Creates the deno handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 deno 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createDenoThreadChannelFactory } from '@migaia/rpc-threads/adapters/deno'\n\nexport function configureAdapter(options: Parameters<typeof createDenoThreadChannelFactory>[0]) {\n  return createDenoThreadChannelFactory(options)\n}",
    scenariosEn: [
      'A deno application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'deno 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-deno:createDenoThreadLauncher': guide({
    purposeEn:
      'Creates the deno native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 deno 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createDenoThreadLauncher } from '@migaia/rpc-threads/adapters/deno'\n\nexport function configureAdapter(options: Parameters<typeof createDenoThreadLauncher>[0]) {\n  return createDenoThreadLauncher(options)\n}",
    scenariosEn: [
      'A deno application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'deno 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-electron-main:createElectronMainThreadChannelFactory': guide({
    purposeEn:
      'Creates the electron-main handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-main 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronMainThreadChannelFactory } from '@migaia/rpc-threads/adapters/electron-main'\n\nexport function configureAdapter(options: Parameters<typeof createElectronMainThreadChannelFactory>[0]) {\n  return createElectronMainThreadChannelFactory(options)\n}",
    scenariosEn: [
      'A electron-main application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'electron-main 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-electron-main:createElectronMainThreadLauncher': guide({
    purposeEn:
      'Creates the electron-main native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-main 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronMainThreadLauncher } from '@migaia/rpc-threads/adapters/electron-main'\n\nconst adapter = createElectronMainThreadLauncher()\nconsole.log(adapter)",
    scenariosEn: [
      'A electron-main application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'electron-main 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-electron-renderer:createElectronRendererThreadChannelFactory': guide({
    purposeEn:
      'Creates the electron-renderer handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-renderer 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronRendererThreadChannelFactory } from '@migaia/rpc-threads/adapters/electron-renderer'\n\nexport function configureAdapter(options: Parameters<typeof createElectronRendererThreadChannelFactory>[0]) {\n  return createElectronRendererThreadChannelFactory(options)\n}",
    scenariosEn: [
      'A electron-renderer application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'electron-renderer 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-electron-renderer:createElectronRendererThreadLauncher': guide({
    purposeEn:
      'Creates the electron-renderer native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-renderer 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronRendererThreadLauncher } from '@migaia/rpc-threads/adapters/electron-renderer'\n\nexport function configureAdapter(options: Parameters<typeof createElectronRendererThreadLauncher>[0]) {\n  return createElectronRendererThreadLauncher(options)\n}",
    scenariosEn: [
      'A electron-renderer application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'electron-renderer 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-node:createNodeThreadChannelFactory': guide({
    purposeEn:
      'Creates the node handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 node 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createNodeThreadChannelFactory } from '@migaia/rpc-threads/adapters/node'\n\nexport function configureAdapter(options: Parameters<typeof createNodeThreadChannelFactory>[0]) {\n  return createNodeThreadChannelFactory(options)\n}",
    scenariosEn: [
      'A node application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'node 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-threads:adapters-node:createNodeThreadLauncher': guide({
    purposeEn:
      'Creates the node native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 node 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createNodeThreadLauncher } from '@migaia/rpc-threads/adapters/node'\n\nexport function configureAdapter(options: Parameters<typeof createNodeThreadLauncher>[0]) {\n  return createNodeThreadLauncher(options)\n}",
    scenariosEn: [
      'A node application needs a real adapter for a spawn-owned unit rather than a borrowed message target.',
      'A custom native source assembles the original launcher, budget, scheduler and channel factory with explicit lifecycle ownership.'
    ],
    scenariosZh: [
      'node 应用需要为 spawn 拥有的单元配置真实适配器，而不是借用外部消息目标。',
      '自定义原生来源需要组合原 launcher、budget、scheduler 和 channel factory，并明确资源生命周期归属。'
    ],
    avoidEn: [
      'Use the default runtime Peer or Plugin factory when no custom source assembly is required.',
      'Do not infer hard termination, complete resource sampling or memory sharing from a platform name; inspect the adapter capability profile.'
    ],
    avoidZh: [
      '不需要自定义来源装配时，应使用默认运行时 Peer 或 Plugin 工厂。',
      '不要从平台名推断强制终止、完整资源采样或共享内存支持；应读取适配器 capability profile。'
    ]
  }),
  'rpc-core:transport-kit:createListenerFailureState': guide({
    purposeEn:
      'Creates a local bucket for failures thrown by diagnostic reporters, so reporting one listener error cannot recursively lose another error.',
    purposeZh:
      '创建本地诊断上报失败桶，防止报告一个监听器错误时递归丢失另一个错误。桶由适配器 owner 持有，在终态报告与清理后释放。',
    quickStart:
      "import { createListenerFailureState } from '@migaia/rpc-core/transport-kit'\n\nconst state = createListenerFailureState()\nconsole.log(state)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:collectListenerFailure': guide({
    purposeEn:
      'Retains one original reporter failure in the existing failure state without reconstructing its native type or cause chain.',
    purposeZh: '把一个原始上报失败保留到既有 failure state，不重建它的原生类型或 cause 链。',
    quickStart:
      "import { collectListenerFailure, createListenerFailureState } from '@migaia/rpc-core/transport-kit'\n\nconst state = createListenerFailureState()\ncollectListenerFailure(state, new TypeError('listener failed'))\nconsole.log(state)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:collectListenerCleanupFailures': guide({
    purposeEn:
      'Runs the supplied listener removals and collects every original cleanup failure, allowing a transport owner to finish all removals before reporting.',
    purposeZh:
      '执行给定的监听器移除操作并收集所有原始清理失败，让 transport owner 完成全部移除后再报告。',
    quickStart:
      "import { collectListenerCleanupFailures } from '@migaia/rpc-core/transport-kit'\n\nconst failures = collectListenerCleanupFailures([() => console.log('listener removed')])\nconsole.log(failures)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:createListenerFailure': guide({
    purposeEn:
      'Projects collected listener failures to the source-owned boundary error while keeping the original errors reachable through cause or aggregation.',
    purposeZh:
      '把已收集的监听器失败投影为原 owner 的边界错误，原始错误仍可通过 cause 或聚合成员访问。',
    quickStart:
      "import { createListenerFailure } from '@migaia/rpc-core/transport-kit'\n\nconst failure = createListenerFailure([new TypeError('listener failed')])\nconsole.error(failure)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:createMessageListenerHub': guide({
    purposeEn:
      'Creates the transport-owned listener collection with stable subscribe/dispose behavior; dispatch isolates individual listener failure without copying the RPC state machine.',
    purposeZh:
      '创建 transport 持有的监听器集合，保留稳定的订阅与清理行为；分发隔离单个监听器失败，而不复制 RPC 状态机。',
    quickStart:
      "import { createMessageListenerHub } from '@migaia/rpc-core/transport-kit'\n\nconst hub = createMessageListenerHub<{ value: number }>()\nconsole.log(hub)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:drainListenerFailures': guide({
    purposeEn:
      'Reports the completed cleanup failure set at the selected boundary after all cleanup work has been attempted.',
    purposeZh:
      '在全部监听器清理操作都已尝试后，向选定边界报告完整失败集合，使原始错误仍可追踪并避免跳过后续清理。',
    quickStart:
      "import { drainListenerFailures } from '@migaia/rpc-core/transport-kit'\n\ndrainListenerFailures([])\nconsole.log('listener failures drained')",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:drainTerminalListenerFailures': guide({
    purposeEn:
      'Drains the terminal listener failure set through the original boundary reporter and preserves its synchronous or asynchronous completion semantics.',
    purposeZh:
      '通过原始边界上报器排空终态监听器失败集合，保留其同步或异步完成语义。调用方须等待完整结束，不能提前宣告所有资源已释放。',
    quickStart:
      "import { drainTerminalListenerFailures } from '@migaia/rpc-core/transport-kit'\n\nawait drainTerminalListenerFailures([])",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:observeListener': guide({
    purposeEn:
      'Invokes one listener and contains synchronous throws and late Promise rejection in the existing report channel, retaining original error identity.',
    purposeZh:
      '调用一个监听器，把同步抛错和迟到的 Promise rejection 交给现有 report 通道，保留原始错误身份。',
    quickStart:
      "import { observeListener, createListenerFailureState } from '@migaia/rpc-core/transport-kit'\n\nconst state = createListenerFailureState()\nobserveListener(() => console.log('message delivered'), console.error, state)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:registerListeners': guide({
    purposeEn:
      'Registers the listener set through one transactional boundary; a partial registration failure removes the listeners already installed.',
    purposeZh:
      '通过一个事务边界登记监听器集合；中途登记失败会移除已经安装的监听器，并保留原始登记失败与回滚错误，避免留下半安装接收器。',
    quickStart:
      "import { registerListeners } from '@migaia/rpc-core/transport-kit'\n\nconst listener = () => console.log('window resized')\nregisterListeners([{ add: () => window.addEventListener('resize', listener), remove: () => window.removeEventListener('resize', listener) }])",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:releaseListenerRegistration': guide({
    purposeEn:
      'Attempts every original listener removal and commits terminal release once, preserving cleanup failures for the owner boundary.',
    purposeZh: '尝试执行全部原监听器移除，并只提交一次终态释放；清理失败保留给 owner 边界处理。',
    quickStart:
      "import { releaseListenerRegistration } from '@migaia/rpc-core/transport-kit'\n\nreleaseListenerRegistration([() => console.log('listener removed')], () => console.log('registration closed'))",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:reportListenerFailure': guide({
    purposeEn:
      'Delivers one original listener failure to the registered reporter set and retains failures thrown by those reporters in the supplied bucket.',
    purposeZh:
      '把一个原始监听器失败交给已登记的上报器集合，并把上报器自身失败保留到给定桶中。它不会替换原业务错误或静默吞掉诊断失败。',
    quickStart:
      "import { reportListenerFailure, createListenerFailureState } from '@migaia/rpc-core/transport-kit'\n\nconst state = createListenerFailureState()\nreportListenerFailure(new TypeError('listener failed'), [console.error], state)",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:safeRead': guide({
    purposeEn:
      'Reads a possibly hostile property through the source-owned reporting boundary; getter failure is reported instead of escaping unnoticed from message handling.',
    purposeZh:
      '通过原 owner 的上报边界读取可能不可信的属性；getter 失败会被报告，不会在消息处理中悄然逸出。',
    quickStart:
      "import { safeRead } from '@migaia/rpc-core/transport-kit'\n\nconst value: unknown = { id: 'remote' }\nconsole.log(safeRead<string>(value, 'id', ({ error }) => {\n  console.error(error)\n  return undefined\n}))",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-core:transport-kit:safeString': guide({
    purposeEn:
      'Converts a value to diagnostic text with an explicit fallback and reporter when conversion fails; it does not replace protocol validation.',
    purposeZh: '把值转换为诊断文本，转换失败时采用明确 fallback 并报告错误；它不替代协议校验。',
    quickStart:
      "import { safeString } from '@migaia/rpc-core/transport-kit'\n\nconsole.log(safeString({ status: 'ready' }, 'unavailable', ({ error }) => {\n  console.error(error)\n  return undefined\n}))",
    scenariosEn: [
      'A custom adapter owns native event subscriptions and must isolate listener failure.',
      'Channel shutdown must remove all listeners while retaining original cleanup and reporting errors.'
    ],
    scenariosZh: [
      '自定义适配器持有原生事件订阅，需要隔离监听器失败。',
      '通道关闭时必须移除全部监听器，并保留原始清理与上报错误。'
    ],
    avoidEn: [
      'Ordinary application RPC code should use the maintained transport or Peer factory.',
      'Do not swallow the returned or reported errors, or recreate them as unrelated Error objects.'
    ],
    avoidZh: [
      '普通业务 RPC 代码应使用维护中的 transport 或 Peer 工厂。',
      '不要吞掉返回或上报的错误，也不要把它们重建为无关的 Error 对象。'
    ]
  }),
  'rpc-contract:index:createRpcUnknownFieldWarner': guide({
    purposeEn:
      'Creates a bounded, per-connection unknown-field warning owner so repeated extensions do not flood diagnostics; it does not authorize unknown protocol values.',
    purposeZh:
      '创建有界、按连接隔离的未知字段告警 owner，避免扩展字段重复灌满诊断通道；它不会授予未知协议值权限。',
    quickStart:
      "import { createRpcUnknownFieldWarner } from '@migaia/rpc-contract'\n\nconst warnings = createRpcUnknownFieldWarner({ maxKeysPerConnection: 16, maxConnections: 128, warn: (connection, field) => console.warn(connection, field) })\nconsole.log(warnings)",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-contract:framing:createStringFramer': guide({
    purposeEn:
      'Creates a bounded string fragmentation/reassembly policy for transports that can carry the resulting frame objects; it does not create a socket or business endpoint.',
    purposeZh:
      '创建有界的字符串分片与重组策略，载体须能传输生成的帧对象；它不会创建 socket 或业务 endpoint。',
    quickStart:
      "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 32 })\nconsole.log(framer.frame('small encoded message', { source: 'local', messageId: 'one' }))",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-contract:framing:createBinaryFramer': guide({
    purposeEn:
      'Creates a bounded byte fragmentation/reassembly policy whose physical frame format is independent from application method routing and buffer ownership transfer.',
    purposeZh:
      '创建有界的字节分片与重组策略；物理帧格式与业务方法路由、buffer 所有权 transfer 是独立的职责。',
    quickStart:
      "import { createBinaryFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createBinaryFramer({ chunkBytes: 32 })\nconsole.log(framer.frame(new TextEncoder().encode('payload'), { source: 'local', messageId: 'one' }))",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-contract:framing:createReassembler': guide({
    purposeEn:
      'Wraps the selected framer in its canonical reassembly owner, retaining partial-message limits, source isolation and cleanup when a channel terminates.',
    purposeZh:
      '把选定 framer 接到规范重组 owner，保留分片消息上限、source 隔离以及通道终止时的清理职责。',
    quickStart:
      "import { createReassembler, createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 32 })\nconst receiver = createReassembler(framer)\nfor (const frame of framer.frame('payload', { source: 'local', messageId: 'one' })) console.log(receiver.accept(frame, { source: 'local', messageId: 'one' }))",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-contract:framing:bindRpcFrameIngress': guide({
    purposeEn:
      'Binds the original paired accept/frame callables to one ingress selector so physical-fragment provenance is preserved across adapter reception.',
    purposeZh:
      '把原始成对的 accept/frame 函数绑定到同一个入站选择器，保留适配器接收过程中的物理分片来源证明。',
    quickStart:
      "import { bindRpcFrameIngress, createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 32 })\nconst prepare = bindRpcFrameIngress(framer.accept, framer.frame)\nconsole.log(prepare('payload', { source: 'local', messageId: 'one' }))",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-contract:framing-stream:encodeRpcStreamFrame': guide({
    purposeEn:
      'Prefixes one nonempty native byte payload with its four-byte network-order length and enforces the existing maximum physical payload size.',
    purposeZh: '给一段非空原生字节 payload 加上四字节网络序长度前缀，并执行既有物理 payload 上限。',
    quickStart:
      "import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'\n\nconsole.log(encodeRpcStreamFrame(new TextEncoder().encode('message')))",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-contract:framing-stream:createRpcStreamFrameDecoder': guide({
    purposeEn:
      'Decodes arbitrary native byte chunks into complete length-prefixed payloads; malformed lengths report once and close the decoder instead of leaking partial state.',
    purposeZh:
      '把任意分块的原生字节流解码为完整长度前缀 payload；非法长度只上报一次并关闭解码器，避免泄漏半消息状态。',
    quickStart:
      "import { createRpcStreamFrameDecoder, encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'\n\nconst decoder = createRpcStreamFrameDecoder({ onFrame: (bytes) => console.log(new TextDecoder().decode(bytes)), onError: console.error })\ndecoder.push(encodeRpcStreamFrame(new TextEncoder().encode('message')))\ndecoder.finish()\ndecoder.close()",
    scenariosEn: [
      'A custom transport or independent peer must exchange the exact maintained wire representation.',
      'A protocol boundary needs explicit validation and source-owned errors before business state is changed.'
    ],
    scenariosZh: [
      '自定义 transport 或独立语言 peer 需要交换维护中的同一份线材表示。',
      '协议边界需要在修改业务状态前完成明确校验并保留原 owner 的错误。'
    ],
    avoidEn: [
      'Use the process/thread Peer factories when the library can perform this wire work for the application.',
      'Do not bypass source admission, authentication or frame limits by using the low-level helper alone.'
    ],
    avoidZh: [
      '库能够代应用执行这些线材工作时，应使用 process/thread Peer 工厂。',
      '不要因为使用底层 helper 就绕过 source 准入、鉴权或物理帧上限。'
    ]
  }),
  'rpc-process:index:createProcessPeer': guide({
    purposeEn:
      'Creates a symmetric process connection owned by the caller, who closes the Peer. Both sides publish explicit provide/expose methods; the library builds the v2 directory and requires batch reception before business calls are admitted.',
    purposeZh:
      '创建对称进程连接，由调用方持有并负责 close 的独立 Peer。两端通过 provide/expose 显式发布方法，由库生成 v2 目录并要求批量帧接收；类型声明不会代替运行时鉴权。',
    quickStart:
      "import { randomBytes } from 'node:crypto'\nimport { fileURLToPath } from 'node:url'\nimport {\n  createProcessPeer,\n  createProcessTransport,\n  type IProcessByteChannel\n} from '@migaia/rpc-process'\nimport { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\n\ntype IChildApi = { math: { double: (value: number) => number } }\ntype IOptions = Parameters<typeof createProcessPeer<IChildApi>>[0]\ntype ISpawn = Exclude<NonNullable<IOptions['spawn']>, Function>\nconst report = (error: unknown) => console.error(error)\nconst launcher = createNodeProcessLauncher()\nconst token = randomBytes(32).toString('base64url')\nlet handle: Awaited<ReturnType<typeof launcher.launch>>\nconst spawn: ISpawn = {\n  kind: 'spawn',\n  channelKind: 'byte',\n  wire: 'native',\n  token,\n  supervision: {\n    id: 'math-process',\n    isolation: 'best-effort',\n    report,\n    launcher: {\n      ...launcher,\n      launch: async (spec, request) => {\n        handle = await launcher.launch(spec, request)\n        return handle\n      }\n    },\n    budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n    spec: {\n      command: process.execPath,\n      args: [fileURLToPath(new URL('./service.js', import.meta.url))],\n      env: { inherit: ['PATH'], set: {} },\n      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },\n      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }\n    }\n  },\n  rawChannel: async () => handle.channel!,\n  establish: (raw, prepared) =>\n    createProcessTransport(raw as IProcessByteChannel, {\n      role: 'initiator',\n      offer: prepared.offer!,\n      peerId: handle.runtimeApiIdentity!.instanceId,\n      scheduler: prepared.scheduler,\n      ipc: { ...prepared.session, log: () => undefined },\n      report\n    })\n}\nconst typedRemote = await createProcessPeer<IChildApi>({ spawn, report })\ntry {\n  console.log(await typedRemote.request('math.double', 21))\n} finally {\n  await typedRemote.close()\n}",
    scenariosEn: [
      'An application needs typed request, notify and stream calls across a process boundary.',
      'A spawn-owned unit needs lifecycle control, or a borrowed connect/listen session needs local close without owning the remote unit.'
    ],
    scenariosZh: [
      '应用需要跨进程边界进行有类型的 request、notify 和 stream 调用。',
      'spawn 单元需要原 owner 的生命周期控制，或借用 connect/listen 连接只需要关闭本端会话。'
    ],
    avoidEn: [
      'In-process functions need no remote boundary; call the function directly.',
      'Do not assume a display name, type assertion or transport ownership label grants remote permissions.'
    ],
    avoidZh: [
      '同一进程内的普通函数不需要远端边界，直接调用函数即可。',
      '不要认为显示名称、类型断言或 ownership 标签会授予远端权限。'
    ],
    optionsEn: [
      {
        name: 'provide',
        description:
          'Functions owned by this side; nested objects become method paths in the generated directory.',
        whenToUse: 'The remote side must invoke explicitly published application methods.'
      },
      {
        name: 'defaultTimeoutMs',
        description:
          'Positive default request/stream deadline in milliseconds; defaults to 30000 and remains within the launcher call cap.',
        whenToUse:
          'Set one bounded application deadline; per-call timeoutMs:false explicitly disables this default.'
      }
    ],
    optionsZh: [
      {
        name: 'provide',
        description: '本端拥有并公开的函数；嵌套对象在库生成的目录中形成方法路径。',
        whenToUse: '对端需要调用明确公开的业务方法时使用。'
      },
      {
        name: 'defaultTimeoutMs',
        description: 'request/stream 的正毫秒默认期限，默认30000，仍受launcher总调用预算限制。',
        whenToUse: '设置一个有界业务期限；单调用timeoutMs:false显式关闭此默认值。'
      }
    ]
  }),
  'rpc-process:index:createProcessPlugin': guide({
    purposeEn:
      'Launch a process from a PluginHost and verify its returned result. PluginHost installs plugins and releases their connections together. In Node.js, compile the service.ts handler below to service.js beside main.js. Compile the parent main.ts and run main.js with Node.js. host.process selects the connection by name.',
    purposeZh:
      '你将从 PluginHost 启动进程，并验证返回值。PluginHost 负责安装 plugins，并统一释放连接。在 Node.js 中，先将下方处理端 service.ts 编译成 main.js 旁的 service.js。将父端 main.ts 编译为 main.js，再用 Node.js 运行。host.process 用连接名称选择目标。',
    quickStart: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number } }
const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service', spawn: new URL('./service.js', import.meta.url)
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.process!.request('service', 'math.double', 21), 42)
} finally { await host.dispose() }`,
    examplesEn: [
      {
        id: 'service-handler',
        title: 'Handler: service.ts in the launched process',
        description:
          'Compile this file beside the parent main.ts. The parent launches it through spawn. note stores its first payload. readNote waits for that payload before returning it.',
        code: `import { createProcessPeer } from '@migaia/rpc-process'

/** Store the first notification so readNote can confirm that the handler ran. */
let receiveNote: (value: string) => void = () => undefined
const receivedNote = new Promise<string>((resolve) => { receiveNote = resolve })
/** This entry is launched by main.ts; it automatically connects to the parent. */
await createProcessPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    note: (value: string) => receiveNote(value),
    readNote: () => receivedNote,
    count: async function* (limit: number) {
      for (let value = 1; value <= limit; value++) yield value
    }
  }
})`
      },
      {
        id: 'parent-calls',
        title: 'Consumer: main.ts verifies all three call forms',
        description:
          'Run this parent in Node.js with the compiled service.js beside it. request returns a result. notify waits only for sending. readNote confirms that the notification handler ran. stream returns values one at a time. Assertions check every result.',
        code: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

type IServiceApi = {
  math: { double(value: number): number }
  note(value: string): void
  readNote(): Promise<string>
  count(limit: number): AsyncIterableIterator<number>
}
/** main.ts launches the compiled service.ts handler. */
const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service', spawn: new URL('./service.js', import.meta.url)
})
/** The parent Host owns its plugin and child process. */
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.process!.request('service', 'math.double', 21), 42)
  await host.process!.notify('service', 'note', 'hello')
  assert.equal(await host.process!.request('service', 'readNote'), 'hello')
  /** Collect every streamed value before checking the result. */
  const values: number[] = []
  for await (const value of host.process!.stream('service', 'count', 3)) values.push(value)
  assert.deepEqual(values, [1, 2, 3])
} finally { await host.dispose() }`
      }
    ],
    examplesZh: [
      {
        id: 'service-handler',
        title: '处理端：启动的进程内运行 service.ts',
        description:
          '将这个文件与父端 main.ts 一起编译。父端通过 spawn 启动它。note 保存首次收到的 payload（输入值）。readNote 等待这个值后再返回。',
        code: `import { createProcessPeer } from '@migaia/rpc-process'

/** Store the first notification so readNote can confirm that the handler ran. */
let receiveNote: (value: string) => void = () => undefined
const receivedNote = new Promise<string>((resolve) => { receiveNote = resolve })
/** This entry is launched by main.ts; it automatically connects to the parent. */
await createProcessPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    note: (value: string) => receiveNote(value),
    readNote: () => receivedNote,
    count: async function* (limit: number) {
      for (let value = 1; value <= limit; value++) yield value
    }
  }
})`
      },
      {
        id: 'parent-calls',
        title: '调用端：main.ts 验证三种调用',
        description:
          '在 Node.js 中运行父端，旁边放置已编译的 service.js。request 等待结果。notify 只等待发送。readNote 确认通知处理函数已执行。stream 逐项返回结果。Assertions 验证所有结果。',
        code: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

type IServiceApi = {
  math: { double(value: number): number }
  note(value: string): void
  readNote(): Promise<string>
  count(limit: number): AsyncIterableIterator<number>
}
/** main.ts launches the compiled service.ts handler. */
const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service', spawn: new URL('./service.js', import.meta.url)
})
/** The parent Host owns its plugin and child process. */
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.process!.request('service', 'math.double', 21), 42)
  await host.process!.notify('service', 'note', 'hello')
  assert.equal(await host.process!.request('service', 'readNote'), 'hello')
  /** Collect every streamed value before checking the result. */
  const values: number[] = []
  for await (const value of host.process!.stream('service', 'count', 3)) values.push(value)
  assert.deepEqual(values, [1, 2, 3])
} finally { await host.dispose() }`
      }
    ],
    scenariosEn: [
      'One PluginHost manages several process connections and releases them together.',
      'A launched unit needs stop, restart or replace through host.process.'
    ],
    scenariosZh: [
      '一个 PluginHost 管理多个进程连接，并统一释放。',
      '启动的执行单元需要经 host.process 执行 stop、restart 或 replace。'
    ],
    avoidEn: [
      'Use createProcessPeer when the application needs a connection without PluginHost ownership.',
      'A borrowed connect or listen session cannot stop or restart the remote unit.',
      'Next task: cancel an unfinished request in Calls and cancellation (calls-and-cancellation).'
    ],
    avoidZh: [
      '应用只需要独立连接时，使用 createProcessPeer。',
      '借用的 connect 或 listen 会话不能停止或重启远端单元。',
      '下一任务：按“调用与取消”（calls-and-cancellation）取消未完成的 request。'
    ],
    optionsEn: [
      {
        name: 'spawn',
        description:
          'Use true to rerun the current entry, or pass a string, URL or short spawn object.',
        whenToUse: 'The Host must launch and own the execution unit.'
      },
      {
        name: 'provide / expose',
        description:
          'provide publishes local functions. expose starts empty and publishes only listed Host methods.',
        whenToUse: 'The child must call explicitly published local methods.'
      },
      {
        name: 'defaultTimeoutMs',
        description:
          'Sets the default request and stream waiting limit in milliseconds. The default is 30000.',
        whenToUse: 'Use timeoutMs on one call to override this default.'
      }
    ],
    optionsZh: [
      {
        name: 'spawn',
        description: '用 true 重跑当前入口，或传入 string、URL、简短的启动配置对象。',
        whenToUse: 'Host 需要启动并持有执行单元时使用。'
      },
      {
        name: 'provide / expose',
        description: 'provide 发布本端函数。expose 默认为空，只公开列出的 Host methods（方法）。',
        whenToUse: '子端需要调用明确公开的本端方法时使用。'
      },
      {
        name: 'defaultTimeoutMs',
        description: '设置 request 与 stream 的默认等待上限，单位为毫秒。默认值为 30000。',
        whenToUse: '单次调用通过 timeoutMs 覆盖默认值。'
      }
    ]
  }),
  'rpc-threads:index:createThreadPeer': guide({
    purposeEn:
      'Creates a symmetric Worker connection owned by the caller, who closes the Peer. Both sides publish explicit provide/expose methods; the library builds the v2 directory and requires batch reception before business calls are admitted.',
    purposeZh:
      '创建对称Worker连接，由调用方持有并负责 close 的独立 Peer。两端通过 provide/expose 显式发布方法，由库生成 v2 目录并要求批量帧接收；类型声明不会代替运行时鉴权。',
    quickStart:
      "import { fileURLToPath } from 'node:url'\nimport { createThreadPeer } from '@migaia/rpc-threads'\nimport {\n  createNodeThreadLauncher,\n  createNodeThreadChannelFactory\n} from '@migaia/rpc-threads/adapters/node'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\ntype IChildApi = { math: { double: (value: number) => number } }\nconst report = (error: unknown) => console.error(error)\nconst spawn = {\n  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },\n  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  launcher: createNodeThreadLauncher(),\n  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),\n  report\n}\nconst typedRemote = await createThreadPeer<IChildApi>({ spawn, report })\ntry {\n  console.log(await typedRemote.request('math.double', 21))\n} finally {\n  await typedRemote.close()\n}",
    scenariosEn: [
      'An application needs typed request, notify and stream calls across a Worker boundary.',
      'A spawn-owned unit needs lifecycle control, or a borrowed connect/listen session needs local close without owning the remote unit.'
    ],
    scenariosZh: [
      '应用需要跨Worker边界进行有类型的 request、notify 和 stream 调用。',
      'spawn 单元需要原 owner 的生命周期控制，或借用 connect/listen 连接只需要关闭本端会话。'
    ],
    avoidEn: [
      'In-process functions need no remote boundary; call the function directly.',
      'Do not assume a display name, type assertion or transport ownership label grants remote permissions.'
    ],
    avoidZh: [
      '同一进程内的普通函数不需要远端边界，直接调用函数即可。',
      '不要认为显示名称、类型断言或 ownership 标签会授予远端权限。'
    ],
    optionsEn: [
      {
        name: 'provide',
        description:
          'Functions owned by this side; nested objects become method paths in the generated directory.',
        whenToUse: 'The remote side must invoke explicitly published application methods.'
      },
      {
        name: 'defaultTimeoutMs',
        description:
          'Positive default request/stream deadline in milliseconds; defaults to 30000 and remains within the launcher call cap.',
        whenToUse:
          'Set one bounded application deadline; per-call timeoutMs:false explicitly disables this default.'
      }
    ],
    optionsZh: [
      {
        name: 'provide',
        description: '本端拥有并公开的函数；嵌套对象在库生成的目录中形成方法路径。',
        whenToUse: '对端需要调用明确公开的业务方法时使用。'
      },
      {
        name: 'defaultTimeoutMs',
        description: 'request/stream 的正毫秒默认期限，默认30000，仍受launcher总调用预算限制。',
        whenToUse: '设置一个有界业务期限；单调用timeoutMs:false显式关闭此默认值。'
      }
    ]
  }),
  'rpc-threads:index:createThreadPlugin': guide({
    purposeEn:
      'Launch a Worker from a PluginHost and verify its returned result. PluginHost installs plugins and releases their connections together. In Node.js, compile the worker.ts handler below to worker.js beside main.js. Compile the parent main.ts and run main.js with Node.js. host.thread selects the connection by name.',
    purposeZh:
      '你将从 PluginHost 启动Worker，并验证返回值。PluginHost 负责安装 plugins，并统一释放连接。在 Node.js 中，先将下方处理端 worker.ts 编译成 main.js 旁的 worker.js。将父端 main.ts 编译为 main.js，再用 Node.js 运行。host.thread 用连接名称选择目标。',
    quickStart: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

type IServiceApi = { math: { double(value: number): number } }
const service = createThreadPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service', spawn: new URL('./worker.js', import.meta.url)
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.thread!.request('service', 'math.double', 21), 42)
} finally { await host.dispose() }`,
    examplesEn: [
      {
        id: 'worker-handler',
        title: 'Handler: worker.ts in the launched Worker',
        description:
          'Compile this file beside the parent main.ts. The parent launches it through spawn. note stores its first payload. readNote waits for that payload before returning it.',
        code: `import { createThreadPeer } from '@migaia/rpc-threads'

/** Store the first notification so readNote can confirm that the handler ran. */
let receiveNote: (value: string) => void = () => undefined
const receivedNote = new Promise<string>((resolve) => { receiveNote = resolve })
/** This entry is launched by main.ts; it automatically connects to the parent. */
await createThreadPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    note: (value: string) => receiveNote(value),
    readNote: () => receivedNote,
    count: async function* (limit: number) {
      for (let value = 1; value <= limit; value++) yield value
    }
  }
})`
      },
      {
        id: 'parent-calls',
        title: 'Consumer: main.ts verifies all three call forms',
        description:
          'Run this parent in Node.js with the compiled worker.js beside it. request returns a result. notify waits only for sending. readNote confirms that the notification handler ran. stream returns values one at a time. Assertions check every result.',
        code: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

type IServiceApi = {
  math: { double(value: number): number }
  note(value: string): void
  readNote(): Promise<string>
  count(limit: number): AsyncIterableIterator<number>
}
/** main.ts launches the compiled worker.ts handler. */
const service = createThreadPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service', spawn: new URL('./worker.js', import.meta.url)
})
/** The parent Host owns its plugin and child Worker. */
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.thread!.request('service', 'math.double', 21), 42)
  await host.thread!.notify('service', 'note', 'hello')
  assert.equal(await host.thread!.request('service', 'readNote'), 'hello')
  /** Collect every streamed value before checking the result. */
  const values: number[] = []
  for await (const value of host.thread!.stream('service', 'count', 3)) values.push(value)
  assert.deepEqual(values, [1, 2, 3])
} finally { await host.dispose() }`
      }
    ],
    examplesZh: [
      {
        id: 'worker-handler',
        title: '处理端：启动的Worker内运行 worker.ts',
        description:
          '将这个文件与父端 main.ts 一起编译。父端通过 spawn 启动它。note 保存首次收到的 payload（输入值）。readNote 等待这个值后再返回。',
        code: `import { createThreadPeer } from '@migaia/rpc-threads'

/** Store the first notification so readNote can confirm that the handler ran. */
let receiveNote: (value: string) => void = () => undefined
const receivedNote = new Promise<string>((resolve) => { receiveNote = resolve })
/** This entry is launched by main.ts; it automatically connects to the parent. */
await createThreadPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    note: (value: string) => receiveNote(value),
    readNote: () => receivedNote,
    count: async function* (limit: number) {
      for (let value = 1; value <= limit; value++) yield value
    }
  }
})`
      },
      {
        id: 'parent-calls',
        title: '调用端：main.ts 验证三种调用',
        description:
          '在 Node.js 中运行父端，旁边放置已编译的 worker.js。request 等待结果。notify 只等待发送。readNote 确认通知处理函数已执行。stream 逐项返回结果。Assertions 验证所有结果。',
        code: `import assert from 'node:assert/strict'
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

type IServiceApi = {
  math: { double(value: number): number }
  note(value: string): void
  readNote(): Promise<string>
  count(limit: number): AsyncIterableIterator<number>
}
/** main.ts launches the compiled worker.ts handler. */
const service = createThreadPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service', spawn: new URL('./worker.js', import.meta.url)
})
/** The parent Host owns its plugin and child Worker. */
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } } })
try {
  await host.use(service)
  assert.equal(await host.thread!.request('service', 'math.double', 21), 42)
  await host.thread!.notify('service', 'note', 'hello')
  assert.equal(await host.thread!.request('service', 'readNote'), 'hello')
  /** Collect every streamed value before checking the result. */
  const values: number[] = []
  for await (const value of host.thread!.stream('service', 'count', 3)) values.push(value)
  assert.deepEqual(values, [1, 2, 3])
} finally { await host.dispose() }`
      }
    ],
    scenariosEn: [
      'One PluginHost manages several Worker connections and releases them together.',
      'A launched unit needs stop, restart or replace through host.thread.'
    ],
    scenariosZh: [
      '一个 PluginHost 管理多个Worker连接，并统一释放。',
      '启动的执行单元需要经 host.thread 执行 stop、restart 或 replace。'
    ],
    avoidEn: [
      'Use createThreadPeer when the application needs a connection without PluginHost ownership.',
      'A borrowed connect or listen session cannot stop or restart the remote unit.',
      'Next task: cancel an unfinished request in Calls and cancellation (calls-and-cancellation).'
    ],
    avoidZh: [
      '应用只需要独立连接时，使用 createThreadPeer。',
      '借用的 connect 或 listen 会话不能停止或重启远端单元。',
      '下一任务：按“调用与取消”（calls-and-cancellation）取消未完成的 request。'
    ],
    optionsEn: [
      {
        name: 'spawn',
        description:
          'Use true to rerun a Node, Bun or Deno entry. Pass an explicit URL in browsers.',
        whenToUse: 'The Host must launch and own the execution unit.'
      },
      {
        name: 'provide / expose',
        description:
          'provide publishes local functions. expose starts empty and publishes only listed Host methods.',
        whenToUse: 'The child must call explicitly published local methods.'
      },
      {
        name: 'defaultTimeoutMs',
        description:
          'Sets the default request and stream waiting limit in milliseconds. The default is 30000.',
        whenToUse: 'Use timeoutMs on one call to override this default.'
      }
    ],
    optionsZh: [
      {
        name: 'spawn',
        description: '用 true 重跑 Node、Bun 或 Deno 入口。浏览器必须传入显式 URL。',
        whenToUse: 'Host 需要启动并持有执行单元时使用。'
      },
      {
        name: 'provide / expose',
        description: 'provide 发布本端函数。expose 默认为空，只公开列出的 Host methods（方法）。',
        whenToUse: '子端需要调用明确公开的本端方法时使用。'
      },
      {
        name: 'defaultTimeoutMs',
        description: '设置 request 与 stream 的默认等待上限，单位为毫秒。默认值为 30000。',
        whenToUse: '单次调用通过 timeoutMs 覆盖默认值。'
      }
    ]
  }),
  'plugin-host:index:getPluginRuntimeIntegration': guide({
    purposeEn:
      'Reads the runtime integration port of a genuine Host-created install core. Adapter authors use its feature inventory and shared slots to connect a runtime outlet without copying Host registration or publication state.',
    purposeZh:
      '读取 Host 为本次安装创建的真实 core 所绑定的运行时集成端口。适配器作者通过其 Feature 清单和共享槽接入运行时出口，复用 Host 注册与发布状态，不能传入复制的结构对象。',
    quickStart:
      "import { definePlugin, getPluginRuntimeIntegration } from '@migaia/plugin-host'\n\nconst integrationPlugin = definePlugin('integration', (core) => {\n  const integration = getPluginRuntimeIntegration(core)\n  return { install: () => ({ inspectService: () => integration.readFeatureOutputs('service') }) }\n})",
    scenariosEn: [
      'A process or Worker adapter needs the committed Feature output belonging to one Host plugin.',
      'Several accepted connections must share one Host-owned runtime outlet and its registration lifetime.'
    ],
    scenariosZh: [
      '进程或 Worker 适配器需要读取某个已安装插件实际发布的 Feature 输出。',
      '多个已采纳连接需要共享一个由 Host 持有的运行时出口和注册生命周期。'
    ],
    avoidEn: [
      'Application methods should use the public Host extension or Feature handle instead of this integration port.',
      'Copied cores and objects with matching fields have no Host provenance and are rejected.'
    ],
    avoidZh: [
      '普通业务方法应使用 Host 的公开 extension 或 Feature handle，不需要读取集成端口。',
      '复制的 core 或具有同名字段的对象没有 Host 来源证明，会被拒绝。'
    ]
  }),
  'plugin-host:index:isDefinedPlugin': guide({
    purposeEn:
      'Checks whether a value is an opaque definition minted by definePlugin. It distinguishes definitions from names and structural objects before a dynamic loader asks the Host to install the value.',
    purposeZh:
      '判断值是否由 definePlugin 创建为规范的不透明插件定义。动态加载插件前，可区分定义、名称字符串和外观相同的普通对象；此检查不安装或启用插件。',
    quickStart:
      "import { definePlugin, isDefinedPlugin } from '@migaia/plugin-host'\n\nconst plugin = definePlugin('message', () => ({ install: () => ({ greet: () => 'hello' }) }))\nconsole.log(isDefinedPlugin(plugin)) // true\nconsole.log(isDefinedPlugin({ name: 'message' })) // false",
    scenariosEn: [
      'A dynamic import returns an unknown value that must be checked before host.use.',
      'A loader accepts both plugin names and definitions and must distinguish the two inputs.'
    ],
    scenariosZh: [
      '动态 import 返回 unknown 值，需要在 host.use 前确认它是插件定义。',
      '加载器同时接收插件名和插件定义，需要区分两种输入。'
    ],
    avoidEn: [
      'The type already proves a maintained definition and no runtime loader boundary exists.',
      'Definition identity does not prove that a plugin is installed, enabled or authorized to publish methods.'
    ],
    avoidZh: [
      '输入类型已经证明是维护中的定义，且没有动态加载边界时不必重复检查。',
      '定义身份不证明插件已安装、已启用或有权发布方法。'
    ]
  }),
  'plugin-host:index:isPluginHandleCurrent': guide({
    purposeEn:
      'Checks whether a Host-created handle still identifies the exact registration captured at creation. Disabled and suspended registrations remain current; removal, replacement and disposal make the old handle stale.',
    purposeZh:
      '判断 Host handle 是否仍对应创建它时的同一个注册。disabled 和 suspended 注册仍是 current；移除、替换或销毁后，旧 handle 不再 current，此查询不授予修改权限。',
    quickStart:
      "import { defineHost, definePlugin, isPluginHandleCurrent } from '@migaia/plugin-host'\n\nconst host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\ntry {\n  const [handle] = await host.use(definePlugin('service', () => ({ install: () => ({ read: () => 42 }) })))\n  console.log(isPluginHandleCurrent(handle)) // true\n  await host.unUse('service')\n  console.log(isPluginHandleCurrent(handle)) // false\n} finally {\n  await host.dispose()\n}",
    scenariosEn: [
      'A UI retained a handle while an operator replaced the plugin registration.',
      'An adapter must distinguish a suspended current registration from a removed stale handle.'
    ],
    scenariosZh: [
      '界面持有一个 handle，而运维操作可能替换它所属的插件注册。',
      '适配器需要区分暂停但仍有效的注册与已移除的旧 handle。'
    ],
    avoidEn: [
      'Do not use the probe to bypass Host state checks or revive a removed registration.',
      'A true result does not mean the registration is enabled or every operation can run.'
    ],
    avoidZh: [
      '不要借此绕过 Host 状态校验或复活已移除的注册。',
      '返回 true 不表示注册已启用，也不保证每个操作都可执行。'
    ]
  }),
  'serialize:index:emitOutput': guide({
    purposeEn:
      'Emits a portable value as JSON, YAML or TOML through the serialize-owned text emitters. It supports human-readable runtime snapshots without adding a parser, and rejects shapes the requested format cannot represent.',
    purposeZh:
      '使用 serialize 自己维护的输出器，把可移植值写为 JSON、YAML 或 TOML。适合输出供人阅读的运行时快照；它不提供解析器，指定格式不能表达的数据会明确拒绝。',
    quickStart:
      "import { emitOutput } from '@migaia/serialize'\n\nconst snapshot = { name: 'worker', ready: true, methods: ['math.double'] }\nconsole.log(emitOutput(snapshot, 'json'))\nconsole.log(emitOutput(snapshot, 'yaml'))\nconsole.log(emitOutput(snapshot, 'toml'))",
    scenariosEn: [
      'An operator needs the same safe runtime snapshot in a readable text format.',
      'A CLI exports configuration-shaped data while preserving the emitter failure contract.'
    ],
    scenariosZh: [
      '运维人员需要把同一份安全运行时快照输出为可读文本。',
      '命令行工具输出配置形态的数据，并保留输出器的明确失败语义。'
    ],
    avoidEn: [
      'Use the codec or serializer pipeline when you need round-trip decoding rather than display output.',
      'Do not silently drop null or change a data shape merely to fit TOML.'
    ],
    avoidZh: [
      '需要往返解码时应使用 codec 或 serializer 管线，而不是展示输出器。',
      '不要为适配 TOML 静默删除 null 或改变数据形态。'
    ]
  }),
  'plugin-host:index:defineFeature': guide({
    purposeEn:
      'Defines one synchronous, opaque Feature capability. It does not create a Host, install a Plugin, start resources, or publish methods. A Plugin declares the Feature in its static record; during installation the factory receives only featureExpose and direct dependency outputs. Put asynchronous work and cleanup in the Plugin install hook.',
    purposeZh:
      '定义一项同步且不透明的 Feature 能力；它不会创建 Host、安装 Plugin、启动资源或发布方法。Plugin 在静态 record 中声明 Feature；安装时 factory 只能收到 featureExpose 与直接依赖的输出。异步工作和清理必须放在 Plugin 的 install hook 中。',
    quickStart: `import { defineFeature } from '@migaia/plugin-host'
import type { IFeatureCore } from '@migaia/plugin-host'
import { definePlugin, defineHost } from '@migaia/plugin-host'

const values = [10, 20, 30]
const metrics = defineFeature((core: IFeatureCore<{ readCount(): number }>) => ({
  read: () => core.featureExpose.readCount(),
  sum: () => values.reduce((total, value) => total + value, 0)
}))

const counter = definePlugin('counter', (core) => ({
  featureExpose: () => ({ readCount: () => values.length }),
  install() {
    return {
      readMetric: () => core.features.metrics.read(),
      sumMetric: () => core.features.metrics.sum()
    }
  }
}), { metrics })

const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  domainCore: () => ({})
})
const [view] = await host.use(counter)
console.log(view.extensions.readMetric(), view.extensions.sumMetric())
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
      'Inspects trusted static Feature roots without invoking factories or creating registration state. A Feature root is a top-level named entry in the input Feature graph; roots preserves those aliases, while ordered expands the same graph into dependency order before Plugin installation.',
    purposeZh:
      '检查可信的静态 Feature roots，不调用 factory，也不安装 Plugin、启动资源或创建运行中的实例。Feature root 指传入 Feature 依赖图中的顶层命名入口；roots 保留这些入口别名，ordered 则在 Plugin 安装前把同一张图展开为依赖顺序。',
    quickStart: `import { defineFeature } from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'

let factoryCalls = 0
const metrics = defineFeature(() => {
  factoryCalls += 1
  return { read: () => 1 }
})

const inspection = inspectFeatures({ metrics })
console.log(inspection.roots.metrics === metrics) // true: roots 保留声明的 metrics 别名
console.log(inspection.ordered[0] === metrics) // true: ordered 按依赖顺序返回同一个 Feature
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
  'plugin-host:index:definePlugin': guide({
    purposeEn:
      'Defines and validates a reusable plugin descriptor; it does not install the plugin. Installation through a Host handle or class instance gives the plugin a core, publishes shared capabilities for later plugins, and merges the object returned by install() into the Host extensions view. The full descriptor also owns configuration updates and cleanup, so one definition describes the complete install-to-dispose lifecycle.',
    purposeZh:
      '定义并校验一个可复用的插件描述，但不会立刻安装。通过函数式 Host handle 或 class 实例的 use() 安装后，插件获得 core；shared 能力会提供给后续插件；install() 返回的 extension 会合并到宿主的 extensions 视图。完整描述还可声明配置更新与清理，因此一个定义覆盖从安装到卸载的完整生命周期。core = 插件可以使用的宿主能力，shared = 插件之间复用的能力，extension = 业务代码从宿主上调用的能力。',
    quickStart: `import {
  definePlugin,
  defineHost
} from '@migaia/plugin-host'

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
    activeTtlMs = Number(core.config.get().ttlMs)
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

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({ reportCacheSize: (size: number) => console.log(size) })
})
const [app] = await host.use(productCache)

app.extensions.clearProductCache()
await app.config.update(() => ({ ttlMs: 60_000 }))
await host.dispose()`,
    examplesEn: [
      {
        id: 'short-form',
        title: 'Short form: definePlugin(name, descriptorFactory)',
        description:
          'Use this form when a stable name and per-install descriptor are enough. Its install hook returns the typed Host extension; use core.onDispose() for resources created inside install. Use the retained object form for config, shared, update, metadata, or a top-level disposer.',
        code: `import { definePlugin, defineHost } from '@migaia/plugin-host'

type IAppCore = { audit(message: string): void }

const greeting = definePlugin<IAppCore, { greet(name: string): string }>(
  'greeting',
  (core) => ({
    install: () => ({
      greet(name: string) {
        const message = \`Hello, \${name}\`
        core.audit(message)
        return message
      }
    })
  })
)

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({ audit: (message: string) => console.log(message) })
})
const [app] = await host.use(greeting)

console.log(app.extensions.greet('Migaia'))
await host.dispose()`
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
        code: `import { definePlugin, defineHost } from '@migaia/plugin-host'

type IAppCore = { audit(message: string): void }

const greeting = definePlugin<IAppCore, { greet(name: string): string }>(
  'greeting',
  (core) => ({
    install: () => ({
      greet(name: string) {
        const message = \`Hello, \${name}\`
        core.audit(message)
        return message
      }
    })
  })
)

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({ audit: (message: string) => console.log(message) })
})
const [app] = await host.use(greeting)

console.log(app.extensions.greet('Migaia'))
await host.dispose()`
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
      'Extension: application code should gain typed methods or values through handle.extensions only after installation succeeds.',
      'The plugin needs owned configuration, update handling, and deterministic cleanup under one Host lifecycle.'
    ],
    scenariosZh: [
      'core：安装逻辑既要使用应用提供的服务，也要使用 Host 提供的配置、取消、存续信号、资源登记、shared 读取或 pipeline 能力。',
      'shared：一个插件要把内部能力提供给排在它后面安装的插件，但不希望把它直接做成业务 API。',
      'extension：业务代码只应在安装成功后，通过 handle.extensions 获得有类型的方法或值。',
      '插件需要由同一个 Host 统一管理配置、update 与确定性清理。'
    ],
    avoidEn: [
      'The behavior is a one-off call and owns no install-time state or cleanup; use a normal function.',
      'The capability belongs to the application core and every plugin needs it; provide it from defineHost().domainCore instead.',
      'Do not read a shared capability from a plugin installed later, or publish duplicate shared/extension keys; the batch is rejected and rolled back.'
    ],
    avoidZh: [
      '行为只是一次性调用，不持有安装态资源，也无需清理；应使用普通函数。',
      '能力属于应用 core 且所有插件都需要；应改由 defineHost().domainCore 提供。',
      '不要读取后安装插件的 shared，也不要发布重复的 shared/extension 键；整批安装会被拒绝并回滚。'
    ],
    optionsEn: [
      {
        name: 'definePlugin(name, descriptorFactory)',
        description:
          'Short form for a stable name and a descriptor factory whose install hook returns Host extensions.',
        whenToUse:
          'Use when the plugin has no config, Feature, update hook, metadata, or explicit disposer.',
        type: 'IDefinedPluginConstraint',
        optional: false
      },
      {
        name: 'core',
        description:
          'Application domain core combined with Host config, operation/lifecycle signals, resolved features, onDispose(), and pipeline registration.',
        whenToUse:
          'Use only during install/featureExpose/update; operation-scoped registration is rejected outside the owning lifecycle phase.',
        type: 'TCore & IPluginHostCore',
        optional: false
      },
      {
        name: 'install(core)',
        description:
          'Creates the plugin and returns the extension object exposed as handle.extensions after the whole batch commits.',
        whenToUse:
          'Return only the application-facing surface; register owned resources with core.onDispose().',
        type: '(core) => TExtension | PromiseLike<TExtension>',
        optional: false
      },
      {
        name: 'features / featureExpose(core)',
        description:
          'Declares Feature capabilities; featureExpose supplies their implementation. Consumers depend on them through provider.getFeature(name) and read core.features. The former shared/getShared slots were removed.',
        whenToUse:
          'Use for plugin-to-plugin collaboration that should not become application-facing extension API.',
        type: 'Record<string, IFeature> / (core) => TExpose'
      },
      {
        name: 'config / update(next, core)',
        description:
          'Owns an immutable config snapshot and reacts after handle.config.update() or host.config.update() commits a patch.',
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
          '应用领域 core 与 Host 能力的组合；Host 能力包括配置、操作/存续信号、已解析的 features、onDispose() 和 pipeline 登记。',
        whenToUse:
          '仅在 install/featureExpose/update 对应阶段使用；离开所属生命周期阶段后再登记资源会被拒绝。',
        type: 'TCore & IPluginHostCore',
        optional: false
      },
      {
        name: 'install(core)',
        description:
          '创建插件并返回 extension 对象；只有整批安装提交后，它才会作为 handle.extensions 对外可见。',
        whenToUse: '只返回给业务宿主使用的公开能力；安装期资源通过 core.onDispose() 登记。',
        type: '(core) => TExtension | PromiseLike<TExtension>',
        optional: false
      },
      {
        name: 'features / featureExpose(core)',
        description:
          '声明 Feature 能力，featureExpose 提供实现；消费者通过 provider.getFeature(name) 建立依赖并从 core.features 读取。原 shared/getShared 已删除。',
        whenToUse: '用于插件间协作，但不希望它成为业务侧 extension API。',
        type: 'Record<string, IFeature> / (core) => TExpose'
      },
      {
        name: 'config / update(next, core)',
        description:
          '持有不可变配置快照，并在 handle.config.update() 或 host.config.update() 提交补丁后响应新配置。',
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
  'plugin-host:index:defineHost': guide({
    purposeEn:
      'Creates a frozen functional Host handle over the canonical PluginHost engine. The domainCore callback replaces subclassing, while use() keeps plugin batches atomic and dispose() remains the single terminal cleanup authority.',
    purposeZh:
      '基于规范 PluginHost 引擎创建冻结的函数式 Host handle。domainCore 回调替代继承；use() 仍保证插件批次原子提交，dispose() 仍是唯一终态清理入口。',
    quickStart:
      "import { definePlugin, defineHost } from '@migaia/plugin-host'\n\nconst greeting = definePlugin('greeting', (core: { prefix: string }) => ({\n  install: () => ({\n    greet: (name: string) => `${core.prefix}, ${name}`\n  })\n}))\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },\n  domainCore: () => ({ prefix: 'Hello' })\n})\nconst [app] = await host.use(greeting)\n\nconsole.log(app.extensions.greet('Ada'))\nawait host.dispose()",
    scenariosEn: [
      'A package needs a Host value without exposing an inheritance hierarchy.',
      'Each plugin registration needs domain capabilities derived from its name or batch position.'
    ],
    scenariosZh: [
      '包需要持有 Host 值，但不希望公开继承层次。',
      '每个插件 registration 需要按插件名或批次位置构造领域能力。'
    ],
    avoidEn: [
      'A long-lived subclass must expose custom protected pipeline methods; extend PluginHost instead.',
      'Do not put application startup work in domainCore; install resources through a plugin so rollback and cleanup stay owned.'
    ],
    avoidZh: [
      '长期存在的子类需要公开自定义 protected pipeline 方法；此时应继承 PluginHost。',
      '不要在 domainCore 中执行应用启动工作；资源应由插件安装，以保持回滚与清理所有权。'
    ]
  }),
  'plugin-host:index:PluginHostError': guide({
    purposeEn:
      'Represents recoverable Plugin Host state and protocol failures with stable source and code fields. Input-shape failures remain native TypeError values, so callers can distinguish bad input from host lifecycle failures.',
    purposeZh:
      '用稳定的 source 与 code 表示可处理的 Plugin Host 状态或协议失败。原始失败通过 cause 保持可达，不可变结构化诊断放入 detail；输入形状错误仍保持原生 TypeError，因此调用方能区分错误输入与 Host 生命周期失败。',
    quickStart:
      "import { PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'\n\nconst reportInstallFailure = (cause: unknown) => console.error('plugin install failed', cause)\nconst host = { use: async (_plugin: unknown) => { throw new PluginHostError(PluginHostErrorCode.pluginInstallFailed, 'plugin install failed', { cause: new Error('backend unavailable') }) } }\nconst plugin = { name: 'analytics' }\n\ntry {\n  await host.use(plugin)\n} catch (error) {\n  if (error instanceof PluginHostError && error.code === PluginHostErrorCode.pluginInstallFailed) {\n    reportInstallFailure(error.cause)\n  }\n}",
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
  'plugin-host:index:PluginHost': guide({
    purposeEn:
      'Abstract base class for a long-lived domain Host. It owns atomic plugin installation and rollback, immutable revocable views, extensions, shared capabilities, configuration updates, four pipeline models, serialized mutations, bounded logical removal with observable physical cleanup, and terminal disposal. Subclasses supply the domain core and expose business methods that run the protected pipeline; graph/composition owners can additionally use its two-phase admission and removal boundary.',
    purposeZh:
      '面向长期运行领域宿主的抽象基类。它统一拥有：插件整批原子安装与失败回滚、不可变且可撤销的 view、extension、shared、配置更新、四种 pipeline、mutation 串行队列、先逻辑撤销再观察物理清理，以及 Host 最终 dispose。子类负责提供领域 core，并把 protected runPipeline() 包装成业务方法；依赖图或组合器还可使用两阶段 admission/removal 集成边界。',
    quickStart: `import { PluginHost } from '@migaia/plugin-host'
import { definePlugin } from '@migaia/plugin-host'

type IAppCore = { write(message: string): void }
type IGreetingConfig = { prefix: string }

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
  IGreetingConfig
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
const [handle] = await host.use(greetingPlugin)
handle.extensions.greet('Migaia')
await host.config.update('greeting', () => ({ prefix: 'Hi' }))
await host.publish('order-created')

console.log(host.pipelineMode, host.revision)

// unUse() 按依赖策略卸载，并报告受影响的依赖者。
const removal = await host.unUse('greeting')
console.log(removal.ok, removal.affected)

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
      'The Host only needs callback-based domain-core construction and no protected subclass surface; use defineHost() instead.',
      'Features are static and own no resources, configuration, shared state, or pipeline stages; compose plain objects or functions.',
      'Plugins require dependency ordering or cross-process isolation; PluginHost executes an already ordered in-realm composition and does not solve either concern.',
      'Application code should not call the admission, ordering-slot, or prepared-removal methods; those are framework integration boundaries.'
    ],
    avoidZh: [
      'Host 只需要回调式 domain core 构造，不需要 protected 子类表面；此时使用 defineHost()。',
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
          'Serializes one plugin batch, installs in argument order, and returns one handle per plugin in the same order. Any failure rolls back the batch.',
        whenToUse: 'Install one or more already ordered plugins at runtime.',
        type: 'Promise<IPluginHandleTuple<TPlugins>>',
        optional: false
      },
      {
        name: 'handle.extensions / handle.getFeature(name)',
        description:
          'Each handle returned by use() exposes the plugin extensions for business calls, a getFeature() reference for declaring plugin-to-plugin dependencies, and a per-plugin config facade. The former shared slots were removed; collaboration goes through Features.',
        whenToUse:
          'Call extensions from application code; pass getFeature() references when another plugin depends on this one.',
        type: 'IPluginHandle<TPlugin>'
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
          'Removes one plugin under the dependency policy (reject by default, cascade or suspend) and returns { ok, affected } or { ok: false, errors, affected }. dryRun: true returns only the dependency plan.',
        whenToUse: 'Remove a runtime capability and inspect which dependents were affected.',
        type: 'Promise<IPluginRemoval>'
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
          '把一批插件放入串行 mutation 队列，按参数顺序安装，并按同一顺序返回每个插件的句柄；任一失败都会回滚整批候选。',
        whenToUse: '运行时安装一个或多个已经排好顺序的插件。',
        type: 'Promise<IPluginHandleTuple<TPlugins>>',
        optional: false
      },
      {
        name: 'handle.extensions / handle.getFeature(name)',
        description:
          'use() 返回的每个句柄提供业务侧 extensions、用于声明插件间依赖的 getFeature() 引用，以及该插件的 config facade。原 shared 槽位已删除，插件协作改走 Feature。',
        whenToUse: '业务代码调用 extensions；其他插件依赖本插件时传入 getFeature() 引用。',
        type: 'IPluginHandle<TPlugin>'
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
          '按依赖策略（默认 reject，可选 cascade、suspend）卸载一个插件，返回 { ok, affected } 或 { ok: false, errors, affected }；dryRun: true 只返回依赖计划。',
        whenToUse: '移除运行时能力，并查看受影响的依赖者。',
        type: 'Promise<IPluginRemoval>'
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
  'plugin-host:index:createRegistrationView': guide({
    purposeEn:
      'Publishes a frozen extension-only view for the exact live registration identified by a receipt. It rejects unknown, revoked, uninstalled, or disposing registrations instead of exposing Host internals or another plugin generation.',
    purposeZh:
      '根据注册回执，只公开对应且仍然存活的插件扩展，并返回冻结视图。回执未知、已撤销、尚未安装或正在释放时会直接拒绝；调用方拿不到 Host 内部状态，也不会误读其他插件代次。',
    quickStart:
      "import { createRegistrationView, PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'\n\nexport async function searchRegisteredPlugin(\n  receipt: Parameters<typeof createRegistrationView>[0],\n  refreshRegistration: () => void\n) {\n  try {\n    const view = createRegistrationView(receipt)\n    const search = view.extensions.search as (query: string) => Promise<unknown>\n    return await search('migaia')\n  } catch (error) {\n    if (error instanceof PluginHostError && error.code === PluginHostErrorCode.registrationRevoked) {\n      refreshRegistration()\n    }\n    throw error\n  }\n}",
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
      "import { createView } from '@migaia/plugin-host/composition'\n\nexport async function searchRegistration(searchRegistration: Parameters<typeof createView>[0]) {\n  const view = createView(searchRegistration)\n  const search = view.extensions.search as (query: string) => Promise<unknown>\n  return search('migaia')\n}",
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
  'plugin-host:composition:buildManagedPort': guide({
    purposeEn:
      'Builds the frozen managed-composition port for a PluginHost-owned runtime. Its revision and current-view readers stay live across commits; this is infrastructure wiring, not an application extension API.',
    purposeZh:
      '为 PluginHost 持有的运行时构造冻结的受管组合端口。revision 与当前视图的读取函数在提交后仍读取实时状态；这是宿主基础设施接线，不是应用扩展 API。',
    quickStart:
      "import { buildManagedPort } from '@migaia/plugin-host/composition'\n\nexport function createHostPort(\n  runtime: Parameters<typeof buildManagedPort>[0],\n  readRevision: () => number,\n  readCurrentView: () => unknown\n) {\n  return buildManagedPort(runtime, readRevision, readCurrentView)\n}",
    scenariosEn: [
      'PluginHost infrastructure exposes its existing composition runtime through one protocol port.',
      'A composition consumer must read the current revision and committed view after each change.'
    ],
    scenariosZh: [
      'PluginHost 基础设施需要通过单一协议端口公开已有组合运行时。',
      '组合层使用方需要在每次变更后读取最新代次和已提交视图。'
    ],
    avoidEn: [
      'Application code only installs plugins; use defineHost or PluginHost instead.',
      'Do not build a second runtime or snapshot the revision in an adapter.'
    ],
    avoidZh: [
      '应用代码只需安装插件时；应使用 defineHost 或 PluginHost。',
      '不要在适配层另建运行时，也不要把 revision 固定为快照。'
    ]
  }),
  'plugin-host:composition:registerManagedHost': guide({
    purposeEn:
      'Associates a PluginHost-created host with its managed protocol port after construction. The registration belongs to host infrastructure and lets composition consumers discover the exact port without exposing mutable internals.',
    purposeZh:
      '在构造完成后，将 PluginHost 创建的宿主与其受管协议端口关联。登记由宿主基础设施负责，让组合层找到准确端口，同时不公开可变内部状态。',
    quickStart:
      "import { registerManagedHost } from '@migaia/plugin-host/composition'\n\nexport function finishHostConstruction(\n  host: object,\n  port: Parameters<typeof registerManagedHost>[1]\n) {\n  registerManagedHost(host, port)\n  return host\n}",
    scenariosEn: [
      'A host constructor has finished wiring its own composition runtime and port.',
      'The composition adapter needs a package-owned association for a constructed host.'
    ],
    scenariosZh: [
      '宿主构造器已完成自身组合运行时与端口的接线。',
      '组合适配层需要由包自身维护已构造宿主的端口关联。'
    ],
    avoidEn: [
      'Do not register arbitrary application objects as managed hosts.',
      'Application consumers should install plugins through the host API, not register ports.'
    ],
    avoidZh: [
      '不要把任意应用对象登记为受管宿主。',
      '应用使用方应通过宿主 API 安装插件，而不是登记端口。'
    ]
  }),
  'plugin-host:composition:isManagedHost': guide({
    purposeEn:
      'Checks whether a value is a host registered by this PluginHost package, including function-form hosts. Composition adapters use this predicate instead of an instanceof check before opening the managed port.',
    purposeZh:
      '检查一个值是否为本 PluginHost 包登记的宿主，也支持函数式宿主。组合适配层在打开受管端口前使用此判定，不依赖 instanceof。',
    quickStart:
      "import { isManagedHost, openComposition } from '@migaia/plugin-host/composition'\n\nexport function readManagedPort(value: unknown) {\n  if (!isManagedHost(value)) return undefined\n  return openComposition(value as object)\n}",
    scenariosEn: [
      'A composition adapter receives an unknown target and must recognize managed hosts.',
      'A function-form host cannot be identified reliably with a class-only check.'
    ],
    scenariosZh: [
      '组合适配层收到未知目标，需要识别受管宿主。',
      '函数式宿主无法可靠地通过只针对 class 的判定识别。'
    ],
    avoidEn: [
      'Do not use this predicate as general plugin-descriptor validation.',
      'Application code that already owns a host handle does not need protocol discovery.'
    ],
    avoidZh: [
      '不要把此判定当作通用插件描述校验。',
      '已经持有宿主 handle 的应用代码不需要发现内部协议。'
    ]
  }),
  'plugin-host:composition:openComposition': guide({
    purposeEn:
      'Returns the managed composition port registered for a host, or throws COMPOSITION_TARGET_UNMANAGED for an unregistered target. The port delegates admission and commit work to the host-owned runtime.',
    purposeZh:
      '返回已登记宿主的受管组合端口；目标未登记时抛出 COMPOSITION_TARGET_UNMANAGED。端口把准入与提交工作委托给宿主持有的运行时。',
    quickStart:
      "import { isManagedHost, openComposition } from '@migaia/plugin-host/composition'\n\nexport function currentManagedView(target: unknown) {\n  if (!isManagedHost(target)) return undefined\n  return openComposition(target as object).getCurrentSnapshot()\n}",
    scenariosEn: [
      'A composition adapter needs the live protocol of a recognized PluginHost host.',
      'The adapter needs the committed current view rather than a stale construction snapshot.'
    ],
    scenariosZh: [
      '组合适配层需要访问已识别 PluginHost 宿主的实时协议。',
      '适配层需要已提交的当前视图，而不是构造时留下的旧快照。'
    ],
    avoidEn: [
      'Do not open an arbitrary object without checking host ownership first.',
      'Application code should consume the public host view instead of the composition protocol.'
    ],
    avoidZh: ['不要在确认宿主归属前打开任意对象。', '应用代码应使用公开宿主视图，而不是组合协议。']
  }),
  'plugin-host:index:readPluginHostDisposalProvenance': guide({
    purposeEn:
      'Reads disposal provenance attached by this exact Plugin Host module instance. It returns undefined for ordinary values and foreign module copies instead of trusting structural lookalikes.',
    purposeZh:
      '读取由当前 Plugin Host 模块实例附加的 dispose 来源信息。普通值和其他模块副本创建的值返回 undefined，不会信任仅结构相似的对象。',
    quickStart:
      "import { readPluginHostDisposalProvenance } from '@migaia/plugin-host'\n\nexport function describeResourceOwnership(resource: unknown) {\n  const provenance = readPluginHostDisposalProvenance(resource)\n  if (provenance) console.log(provenance.kind)\n  return provenance\n}",
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
  'reactive:extension:deferRuntimeCleanup': guide({
    purposeEn:
      'Schedules synchronous adapter cleanup on the exact Runtime idle channel. The configured scheduleIdle hook controls timing, the default uses microtasks, and thrown cleanup errors reach that Runtime reportError sink without exposing scheduler or graph services.',
    purposeZh:
      '把同步适配器清理交给准确 Runtime 的 idle 通道。scheduleIdle 决定执行时机，默认使用微任务；清理抛错由该 Runtime 的 reportError 接收，不暴露 scheduler 或图服务。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { deferRuntimeCleanup } from '@migaia/reactive/extension'\n\nconst idle: Array<() => void> = []\nconst runtime = createRuntime({ scheduleIdle: (task) => { idle.push(task) } })\nlet released = false\ndeferRuntimeCleanup(runtime, () => { released = true })\nconsole.log(released) // false\nidle.shift()?.()\nconsole.log(released) // true",
    quickStartEn:
      "// Host-controlled cleanup runs only when its idle queue is drained.\nimport { createRuntime } from '@migaia/reactive'\nimport { deferRuntimeCleanup } from '@migaia/reactive/extension'\n\nconst idle: Array<() => void> = []\nconst runtime = createRuntime({ scheduleIdle: (task) => { idle.push(task) } })\nlet released = false\ndeferRuntimeCleanup(runtime, () => { released = true })\nconsole.log(released) // false\nidle.shift()?.()\nconsole.log(released) // true",
    quickStartZh:
      "// 宿主排空自己的 idle 队列时才执行清理。\nimport { createRuntime } from '@migaia/reactive'\nimport { deferRuntimeCleanup } from '@migaia/reactive/extension'\n\nconst idle: Array<() => void> = []\nconst runtime = createRuntime({ scheduleIdle: (task) => { idle.push(task) } })\nlet released = false\ndeferRuntimeCleanup(runtime, () => { released = true })\nconsole.log(released) // false\nidle.shift()?.()\nconsole.log(released) // true",
    scenariosEn: [
      'A Store adapter releases an abandoned speculative read.',
      'A custom host supplies idle cleanup independently of reactive flush timing.'
    ],
    scenariosZh: [
      'Store 适配器释放被放弃的投机读取。',
      '自定义宿主需要让 idle 清理独立于响应式 flush 时机。'
    ],
    avoidEn: [
      'Use lifecycle scopes to own asynchronous external resources.',
      'Keep cleanup synchronous and release only resources owned by this adapter.'
    ],
    avoidZh: [
      '异步外部资源的所有权应交给 lifecycle scope。',
      '清理回调保持同步，只释放本适配器拥有的资源。'
    ],
    optionsEn: [
      {
        name: 'runtime',
        description: 'Real Runtime whose idle hook and diagnostic sink own this cleanup.',
        defaultValue: 'required',
        optional: false,
        type: 'IRuntime',
        whenToUse: 'Pass the same owner used by the adapter nodes.',
        example: 'deferRuntimeCleanup(runtime, cleanup)'
      },
      {
        name: 'task',
        description:
          'Synchronous cleanup callback; thrown failures are reported through the Runtime.',
        defaultValue: 'required',
        optional: false,
        type: '() => void',
        whenToUse: 'Release an abandoned adapter value on the configured idle channel.',
        example: '() => { cache.delete(key) }'
      }
    ],
    optionsZh: [
      {
        name: 'runtime',
        description: '提供 idle hook 与诊断出口的真实 Runtime。',
        defaultValue: '必填',
        optional: false,
        type: 'IRuntime',
        whenToUse: '传入适配器节点使用的同一个 owner。',
        example: 'deferRuntimeCleanup(runtime, cleanup)'
      },
      {
        name: 'task',
        description: '同步清理回调；抛出的失败由所属 Runtime 报告。',
        defaultValue: '必填',
        optional: false,
        type: '() => void',
        whenToUse: '在已配置的 idle 通道释放被放弃的适配器值。',
        example: '() => { cache.delete(key) }'
      }
    ]
  }),
  'reactive:extension:getDefaultRuntime': guide({
    purposeEn:
      'Returns the one shared convenience Runtime on explicit first use. Adapter modules can import this pure extension function without constructing a graph; later calls and the root defaultRuntime binding reuse the exact same owner.',
    purposeZh:
      '首次显式调用时取得唯一的共享默认Runtime。适配器导入纯extension函数不会创建图；后续调用与root的defaultRuntime绑定复用完全相同的owner。',
    quickStart:
      "import { getDefaultRuntime } from '@migaia/reactive/extension'\n\nconst runtime = getDefaultRuntime()\nconst count = runtime.signal(0)\nconst effect = runtime.effect(() => console.log(count.value))\ncount.value = 1\nruntime.flush()\neffect.dispose()\ncount.dispose()",
    quickStartEn:
      "// Importing the provider leaves the default graph unconstructed.\nimport { getDefaultRuntime } from '@migaia/reactive/extension'\n\n// Explicit first use creates the owner; repeated calls reuse it.\nconst runtime = getDefaultRuntime()\nconst count = runtime.signal(0)\nconst effect = runtime.effect(() => console.log(count.value))\ncount.value = 1\nruntime.flush()\n// Release this adapter's nodes, not the shared owner.\neffect.dispose()\ncount.dispose()",
    quickStartZh:
      "// 导入provider不会创建默认图。\nimport { getDefaultRuntime } from '@migaia/reactive/extension'\n\n// 显式首次使用才创建owner，后续调用复用它。\nconst runtime = getDefaultRuntime()\nconst count = runtime.signal(0)\nconst effect = runtime.effect(() => console.log(count.value))\ncount.value = 1\nruntime.flush()\n// 释放本适配器拥有的节点，保留共享owner。\neffect.dispose()\ncount.dispose()",
    scenariosEn: [
      'A feature adapter must remain cold until its first default-backed value is created.',
      'Several convenience consumers intentionally share one graph.'
    ],
    scenariosZh: [
      '特性适配器需要在首次创建默认owner上的值之前保持冷导入。',
      '多个便利入口有意共用同一张图。'
    ],
    avoidEn: [
      'Use createRuntime when an SSR request or independent root needs isolation.',
      'Retain an explicitly supplied owner instead of replacing it with the default.'
    ],
    avoidZh: [
      'SSR请求或独立root需要隔离时使用createRuntime。',
      '调用方显式传入owner时保留该owner。'
    ]
  }),
  'reactive:extension:ReactiveErrorPhase': guide({
    purposeEn:
      'The canonical diagnostic phase constants are also available from the pure extension boundary. Pass the matching phase to Runtime.reportError so adapter diagnostics use the same vocabulary without importing the eager root convenience value.',
    purposeZh:
      '规范诊断阶段常量也可从纯extension边界取得。向Runtime.reportError传入对应阶段，使适配器诊断共用同一词汇，同时无需导入会取得默认实例的root便利值。',
    quickStart:
      "import { getDefaultRuntime, ReactiveErrorPhase } from '@migaia/reactive/extension'\n\nconst runtime = getDefaultRuntime()\nconst payload = runtime.signal('{\"count\":1}')\nconst effect = runtime.effect(() => {\n  try { console.log(JSON.parse(payload.value)) } catch (error) {\n    runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })\n  }\n})\npayload.value = '{\"count\":2}'\nruntime.flush()\neffect.dispose()\npayload.dispose()",
    quickStartEn:
      "// Keep the original parse failure when a flushed observer reports diagnostics.\nimport { getDefaultRuntime, ReactiveErrorPhase } from '@migaia/reactive/extension'\n\nconst runtime = getDefaultRuntime()\nconst payload = runtime.signal('{\"count\":1}')\nconst effect = runtime.effect(() => {\n  try { console.log(JSON.parse(payload.value)) } catch (error) {\n    runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })\n  }\n})\npayload.value = '{\"count\":2}'\nruntime.flush()\neffect.dispose()\npayload.dispose()",
    quickStartZh:
      "// observer排空时报告诊断，保留原始解析错误。\nimport { getDefaultRuntime, ReactiveErrorPhase } from '@migaia/reactive/extension'\n\nconst runtime = getDefaultRuntime()\nconst payload = runtime.signal('{\"count\":1}')\nconst effect = runtime.effect(() => {\n  try { console.log(JSON.parse(payload.value)) } catch (error) {\n    runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })\n  }\n})\npayload.value = '{\"count\":2}'\nruntime.flush()\neffect.dispose()\npayload.dispose()",
    scenariosEn: [
      'A pure adapter reports asynchronous callback failures.',
      'Consumers correlate diagnostics by the existing phase domain.'
    ],
    scenariosZh: ['纯适配器报告异步回调失败。', '消费者按既有阶段域关联诊断。'],
    avoidEn: [
      'Do not use phase names as thrown error codes.',
      'Choose the actual failure phase rather than relabeling unrelated work.'
    ],
    avoidZh: ['不要把阶段名称当作抛出的错误码。', '选择实际失败阶段，避免给无关操作改标签。']
  }),
  'reactive:extension:createObserverBinding': guide({
    purposeEn:
      'Bridges render-and-commit hosts to one reactive observer. capture records reads without publishing edges, commit validates the snapshot, and observe owns the live Effect used after host subscription.',
    purposeZh:
      '把具有 render/commit 阶段的宿主接入一个 reactive observer。capture 只记录读取而不发布依赖边，commit 校验快照，observe 持有订阅后的活动 Effect。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { createObserverBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst value = runtime.signal(1)\nconst binding = createObserverBinding(runtime)\nconst stop = binding.observe(() => {\n  void value.value\n})\nconst capture = binding.capture(() => value.value)\nif (binding.commit(capture) === 'stale') binding.retrack()\nstop()",
    quickStartEn:
      "// Import the binding primitive and the Runtime that owns every dependency.\nimport { createRuntime } from '@migaia/reactive'\nimport { createObserverBinding } from '@migaia/reactive/extension'\n\n// Create one isolated reactive graph for this UI root.\nconst runtime = createRuntime()\n\n// Create the source that the render phase will read.\nconst value = runtime.signal(1)\n\n// Allocate one binding for one host observer; do not share it across components.\nconst binding = createObserverBinding(runtime)\n\n// Render: capture the value and dependency versions without publishing subscriptions.\nconst capture = binding.capture(() => value.value)\n\n// Use capture.result as the render snapshot; an abandoned render leaves no graph edges.\nconsole.log('rendered value:', capture.result)\n\n// Subscription/commit: install the one live Effect that will own committed dependencies.\nconst stop = binding.observe(() => console.log('schedule host update:', value.value))\n\n// Validate and publish the captured dependency set to that observer.\nconst commitResult = binding.commit(capture)\n\n// If a dependency changed after render, discard the token and force a fresh observer pass.\nif (commitResult === 'stale') binding.retrack()\n\n// Host unmount: dispose the observer and remove every dependency edge it owns.\nstop()\n\n// Release the example source after no observer can read it again.\nvalue.dispose()",
    quickStartZh:
      "// 导入三阶段绑定原语，以及拥有全部依赖节点的 Runtime 工厂。\nimport { createRuntime } from '@migaia/reactive'\nimport { createObserverBinding } from '@migaia/reactive/extension'\n\n// 为这一棵 UI root 创建隔离的响应式图。\nconst runtime = createRuntime()\n\n// 创建 render 阶段会读取的事实来源。\nconst value = runtime.signal(1)\n\n// 一个 binding 只服务一个宿主 observer，不要跨组件复用。\nconst binding = createObserverBinding(runtime)\n\n// render：读取值并捕获依赖版本，但此时绝不发布订阅边。\nconst capture = binding.capture(() => value.value)\n\n// capture.result 是本次 render 快照；render 被丢弃也不会污染依赖图。\nconsole.log('rendered value:', capture.result)\n\n// subscription/commit：安装唯一的活动 Effect，之后由它持有正式依赖。\nconst stop = binding.observe(() => console.log('schedule host update:', value.value))\n\n// 校验 capture 仍新鲜，并把它记录的依赖原子安装到 observer。\nconst commitResult = binding.commit(capture)\n\n// render 后若依赖已变化，stale token 已作废，强制 observer 重新追踪当前值。\nif (commitResult === 'stale') binding.retrack()\n\n// 宿主卸载：释放 observer，并删除它拥有的全部依赖边。\nstop()\n\n// 确认没有 observer 会再次读取后，再释放示例 Signal。\nvalue.dispose()",
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
  'reactive:extension:createSourceBinding': guide({
    purposeEn:
      'Binds a custom observable, such as a SAB-backed node, to one canonical source version and subscriber set while preserving the original graph identity. The returned operations capture that node; runtime services and mutable edge sets stay private.',
    purposeZh:
      '把SAB等自定义observable绑定到唯一的source版本和订阅者集合，保留原节点身份。返回的操作只作用于该节点，不交出runtime服务或可写边集。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { createSourceBinding, type IObservable, type IRuntimeSourceBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nlet binding!: IRuntimeSourceBinding\nconst node: IObservable = {\n  runtime,\n  get version() { return binding.version },\n  get subs() { return binding.subs },\n  onObserved: () => console.log('watch external storage'),\n  onUnobserved: () => console.log('stop external watch')\n}\nbinding = createSourceBinding(node)\nlet stored = 1\nconst effect = runtime.effect(() => {\n  binding.source.track()\n  console.log(stored)\n})\nbinding.source.commit(() => { stored = 2 })\nruntime.flush()\nconsole.log(node.version, node.subs.size)\neffect.dispose()\nbinding.source.dispose()",
    quickStartEn:
      "// Bind the fresh node before exposing it; metadata getters are used only after binding.\nimport { createRuntime } from '@migaia/reactive'\nimport { createSourceBinding, type IObservable, type IRuntimeSourceBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nlet binding!: IRuntimeSourceBinding\nconst node: IObservable = {\n  runtime,\n  get version() { return binding.version },\n  get subs() { return binding.subs },\n  onObserved: () => console.log('watch external storage'),\n  onUnobserved: () => console.log('stop external watch')\n}\nbinding = createSourceBinding(node)\nlet stored = 1\nconst effect = runtime.effect(() => {\n  binding.source.track()\n  console.log(stored)\n})\nbinding.source.commit(() => { stored = 2 })\nruntime.flush()\nconsole.log(node.version, node.subs.size)\neffect.dispose()\nbinding.source.dispose()",
    quickStartZh:
      "// 先绑定新节点再公开；元数据getter在binding赋值后才会被读取。\nimport { createRuntime } from '@migaia/reactive'\nimport { createSourceBinding, type IObservable, type IRuntimeSourceBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nlet binding!: IRuntimeSourceBinding\nconst node: IObservable = {\n  runtime,\n  get version() { return binding.version },\n  get subs() { return binding.subs },\n  onObserved: () => console.log('watch external storage'),\n  onUnobserved: () => console.log('stop external watch')\n}\nbinding = createSourceBinding(node)\nlet stored = 1\nconst effect = runtime.effect(() => {\n  binding.source.track()\n  console.log(stored)\n})\nbinding.source.commit(() => { stored = 2 })\nruntime.flush()\nconsole.log(node.version, node.subs.size)\neffect.dispose()\nbinding.source.dispose()",
    scenariosEn: [
      'An adapter already implements IObservable hooks and must keep its node identity.',
      'External writes must advance the local version and notify the same graph.'
    ],
    scenariosZh: [
      '适配器已实现IObservable钩子，需要保留节点身份。',
      '外部写入需要推进本地版本并通知同一依赖图。'
    ],
    avoidEn: [
      'Use createFieldSource for a field that does not need a custom graph identity.',
      'Do not rebind an existing graph node; GRAPH_NODE_REGISTERED preserves its live edges.'
    ],
    avoidZh: [
      '不需要自定义节点身份的字段应使用createFieldSource。',
      '不要重绑已有图节点；GRAPH_NODE_REGISTERED用于保护仍存活的边。'
    ]
  }),
  'reactive:extension:createTrackedObserver': guide({
    purposeEn:
      'Gives an owner-controlled observer only its own dependency tracking, suspension and revalidation operations. The caller keeps scheduling and lifecycle policy; this factory creates neither another Effect nor an async request owner.',
    purposeZh:
      '只给调用方持有的observer提供自身依赖追踪、挂起和重验证能力。排程与生命周期仍由调用方负责；factory不再创建Effect或异步请求owner。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { createTrackedObserver, type IObserver, type ITrackedObserverBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst value = runtime.signal(1)\nlet dirty = false\nlet disposed = false\nlet binding!: ITrackedObserverBinding\nconst observer: IObserver = {\n  runtime,\n  get disposed() { return disposed },\n  get deps() { return binding.deps },\n  get depVersions() { return binding.depVersions },\n  markDirty: () => { dirty = true },\n  onDependencyDisconnected: () => { dirty = true }\n}\nbinding = createTrackedObserver(observer)\nconst read = () => binding.runTracked(() => value.value)\nconsole.log(read())\nvalue.value = 2\nif (dirty) console.log(read())\nbinding.suspend()\nconsole.log(binding.revalidate())\nbinding.clear()\ndisposed = true\nvalue.dispose()",
    quickStartEn:
      "// The owner supplies notifications; the binding alone maintains the dependency edges.\nimport { createRuntime } from '@migaia/reactive'\nimport { createTrackedObserver, type IObserver, type ITrackedObserverBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst value = runtime.signal(1)\nlet dirty = false\nlet disposed = false\nlet binding!: ITrackedObserverBinding\nconst observer: IObserver = {\n  runtime,\n  get disposed() { return disposed },\n  get deps() { return binding.deps },\n  get depVersions() { return binding.depVersions },\n  markDirty: () => { dirty = true },\n  onDependencyDisconnected: () => { dirty = true }\n}\nbinding = createTrackedObserver(observer)\nconst read = () => binding.runTracked(() => value.value)\nconsole.log(read())\nvalue.value = 2\nif (dirty) console.log(read())\nbinding.suspend()\nconsole.log(binding.revalidate())\nbinding.clear()\ndisposed = true\nvalue.dispose()",
    quickStartZh:
      "// owner提供失效通知；依赖边由binding内部的既有tracker维护。\nimport { createRuntime } from '@migaia/reactive'\nimport { createTrackedObserver, type IObserver, type ITrackedObserverBinding } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst value = runtime.signal(1)\nlet dirty = false\nlet disposed = false\nlet binding!: ITrackedObserverBinding\nconst observer: IObserver = {\n  runtime,\n  get disposed() { return disposed },\n  get deps() { return binding.deps },\n  get depVersions() { return binding.depVersions },\n  markDirty: () => { dirty = true },\n  onDependencyDisconnected: () => { dirty = true }\n}\nbinding = createTrackedObserver(observer)\nconst read = () => binding.runTracked(() => value.value)\nconsole.log(read())\nvalue.value = 2\nif (dirty) console.log(read())\nbinding.suspend()\nconsole.log(binding.revalidate())\nbinding.clear()\ndisposed = true\nvalue.dispose()",
    scenariosEn: [
      'A Resource-like implementation owns its markDirty and refresh policy.',
      'An idle observer must disconnect reverse edges while retaining version snapshots.'
    ],
    scenariosZh: [
      '类似Resource的实现自己控制markDirty和刷新策略。',
      '闲置observer需要断开反向边并保留版本快照。'
    ],
    avoidEn: [
      'Use runtime.effect for an ordinary side effect or createObserverBinding for render/commit hosts.',
      'Do not register the same graph node twice or mutate its dependency views.'
    ],
    avoidZh: [
      '普通副作用用runtime.effect；render/commit宿主用createObserverBinding。',
      '不要重复登记同一个图节点，也不要修改只读依赖视图。'
    ]
  }),
  'reactive:extension:invalidateObservable': guide({
    purposeEn:
      'Disconnects downstream bindings from an owned observable while retaining its upstream graph and cached value. Routing adapters use it when a lookup target changes and consumers must reconnect without disposing the retained node.',
    purposeZh:
      '断开所持observable的下游绑定，同时保留其上游图与缓存。路由适配器切换读取目标时，可要求消费者重新连接，而不销毁仍保留的旧节点。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { internalRuntimeOf, invalidateObservable } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst source = runtime.signal(2)\nconst derived = internalRuntimeOf(runtime).computed(() => source.value * 2)\nconst effect = runtime.effect(() => console.log(derived.value))\ninvalidateObservable(runtime, derived)\nruntime.flush()\nconsole.log(derived.value)\neffect.dispose()\nderived.dispose()\nsource.dispose()",
    quickStartEn:
      "// Invalidate downstream edges, then let the normal Runtime flush reconnect consumers.\nimport { createRuntime } from '@migaia/reactive'\nimport { internalRuntimeOf, invalidateObservable } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst source = runtime.signal(2)\nconst derived = internalRuntimeOf(runtime).computed(() => source.value * 2)\nconst effect = runtime.effect(() => console.log(derived.value))\ninvalidateObservable(runtime, derived)\nruntime.flush()\nconsole.log(derived.value)\neffect.dispose()\nderived.dispose()\nsource.dispose()",
    quickStartZh:
      "// 只摘下游边，再由正常Runtime flush让消费者重新连接。\nimport { createRuntime } from '@migaia/reactive'\nimport { internalRuntimeOf, invalidateObservable } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst source = runtime.signal(2)\nconst derived = internalRuntimeOf(runtime).computed(() => source.value * 2)\nconst effect = runtime.effect(() => console.log(derived.value))\ninvalidateObservable(runtime, derived)\nruntime.flush()\nconsole.log(derived.value)\neffect.dispose()\nderived.dispose()\nsource.dispose()",
    scenariosEn: [
      'An AtomStore override changes the node selected by future reads.',
      'A retained computed must keep its cache while consumers reconnect.'
    ],
    scenariosZh: [
      'AtomStore覆盖操作改变后续读取选择的节点。',
      '保留的computed需要继续持有缓存，但消费者要重建连接。'
    ],
    avoidEn: [
      'Use node.dispose when the node itself is permanently released.',
      'The runtime and node must belong to the same graph.'
    ],
    avoidZh: ['真正永久释放节点时应调用node.dispose。', 'runtime与node必须属于同一依赖图。']
  }),
  'reactive:extension:createFieldSource': guide({
    purposeEn:
      'Creates a controlled dependency source for data stored outside JavaScript, such as WASM memory. Readers call track; writers call commit so version allocation, mutation, and notification happen as one ordered operation.',
    purposeZh:
      '为 WASM memory 等存放在 JavaScript 之外的数据创建受控依赖源。读取方调用 track；写入方调用 commit，使版本分配、实际写入和通知按一个有序操作完成。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { createFieldSource } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst field = createFieldSource(runtime, 'counter')\nlet stored = 0\nconst read = () => { field.track(); return stored }\nconst write = (value: number) => field.commit(() => { stored = value })\nwrite(1)\nconsole.log(read())\nfield.dispose()",
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
  'reactive:index:assertSingleRuntimeCopy': guide({
    purposeEn:
      'Fails immediately when more than one reactive runtime module copy has been registered. Applications that prefer startup failure over possible cross-copy stale state can run this after dependency initialization.',
    purposeZh:
      '检测到已登记的 reactive runtime 模块副本超过一份时立即失败。宁可启动失败、也不接受跨副本陈旧状态的应用，可在依赖初始化后调用。',
    quickStart:
      "import { assertSingleRuntimeCopy } from '@migaia/reactive'\n\nassertSingleRuntimeCopy() // call once during application startup\nconsole.log('single runtime copy admitted')",
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
  'reactive:extension:currentRuntimeVersion': guide({
    purposeEn:
      'Reads the current version of one registered Runtime without exposing its clock object or changing graph state.',
    purposeZh: '读取一个已登记 Runtime 的当前版本，不暴露时钟对象，也不修改依赖图状态。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { currentRuntimeVersion } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst value = runtime.signal(0)\nconst before = currentRuntimeVersion(runtime)\nvalue.value = 1\nconsole.log(currentRuntimeVersion(runtime) > before) // true\nvalue.dispose()",
    scenariosEn: [
      'An implementation cache compares its captured version with the owning Runtime.',
      'An extension needs read-only version observation without mutable graph services.'
    ],
    scenariosZh: [
      '实现层缓存需要把捕获的版本与所属 Runtime 的当前版本比较。',
      '扩展需要只读版本观察，不需要可变依赖图服务。'
    ],
    avoidEn: [
      'Ordinary application derivations should use runtime.computed.',
      'Do not pass a structural imitation; an unregistered Runtime throws NOT_RUNTIME_OWNED.'
    ],
    avoidZh: [
      '普通应用派生值应使用 runtime.computed。',
      '不要传入结构伪造对象；未登记的 Runtime 会抛 NOT_RUNTIME_OWNED。'
    ]
  }),
  'reactive:extension:internalRuntimeOf': guide({
    purposeEn:
      'Validates that a Runtime was created by this library copy and returns the concrete internal node-factory surface. This keeps unsafe implementation casts in one guarded location.',
    purposeZh:
      '先确认 Runtime 由当前库副本创建，再返回具体的节点工厂内部能力。这样不安全的实现层类型转换只存在于一个受保护入口。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { internalRuntimeOf } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst internal = internalRuntimeOf(runtime)\nconst signal = internal.signal(0)",
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
  'reactive:extension:isRuntimeTracking': guide({
    purposeEn:
      'Reports whether the specified Runtime is currently collecting dependency reads. It is a read-only implementation query and does not start, stop, or alter tracking.',
    purposeZh:
      '报告指定 Runtime 当前是否正在收集依赖读取。它只是只读实现层查询，不会开始、停止或改变 tracking。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { isRuntimeTracking } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconsole.log(isRuntimeTracking(runtime)) // false：当前不在 computed/effect 的依赖收集中",
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
  'reactive:extension:isAnyRuntimeTracking': guide({
    purposeEn:
      'Reports whether any Runtime in the current module copy has an active dependency frame. It is intended for implementation diagnostics and never mutates tracking state.',
    purposeZh:
      '报告当前模块副本中的任意 Runtime 是否存在活动依赖帧。它面向实现层诊断，绝不会修改 tracking 状态。',
    quickStart:
      "import { isAnyRuntimeTracking } from '@migaia/reactive/extension'\n\nconsole.debug({ tracking: isAnyRuntimeTracking() })",
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
  'reactive:extension:claimOwnership': guide({
    purposeEn:
      'Records that a managed object belongs to one Runtime. Reclaiming the same object for another Runtime fails because one reactive node cannot safely participate in two independent graphs.',
    purposeZh:
      '登记一个受管对象属于某个 Runtime。若再把同一对象登记给另一个 Runtime 会失败，因为一个 reactive node 无法安全加入两张独立依赖图。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { claimOwnership, ownerOf } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst node = {}\nclaimOwnership(node, runtime)\nconsole.log(ownerOf(node) === runtime)",
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
  'reactive:extension:ownerOf': guide({
    purposeEn:
      'Returns the Runtime that owns a managed object, or undefined for unregistered and non-object values. It distinguishes plain Registry values from nodes that must obey graph ownership.',
    purposeZh:
      '返回受管对象所属的 Runtime；未登记值和非对象返回 undefined。它用于区分普通 Registry 值与必须遵守依赖图所有权的节点。',
    quickStart:
      "import { ownerOf } from '@migaia/reactive/extension'\n\nconst candidate: object = {}\nconst owner = ownerOf(candidate)\nif (owner) console.log('managed by a Runtime')",
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
  'reactive:extension:assertOwnedBy': guide({
    purposeEn:
      'Rejects a registered object when its Runtime differs from the expected owner, while allowing unregistered plain values. Use it at boundaries that legitimately accept both ordinary and managed values.',
    purposeZh:
      '已登记对象所属 Runtime 与预期不同时拒绝，但允许普通未登记值通过。适用于同时接受普通值与受管值的边界。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { assertOwnedBy } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst node = runtime.signal(1)\nassertOwnedBy(node, runtime, 'owned signal')\nconsole.log(node.value)\nnode.dispose()",
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
  'reactive:extension:assertReactiveOwnedBy': guide({
    purposeEn:
      'Strictly requires a reactive object to be registered to the expected Runtime. Both unowned structural imitations and nodes owned by another Runtime are rejected before graph edges are changed.',
    purposeZh:
      '严格要求 reactive object 已登记给预期 Runtime。未登记的结构伪造对象和属于其他 Runtime 的节点都会在修改依赖边前被拒绝。',
    quickStart:
      "import { createRuntime } from '@migaia/reactive'\nimport { assertReactiveOwnedBy } from '@migaia/reactive/extension'\n\nconst runtime = createRuntime()\nconst node = runtime.signal(1)\nassertReactiveOwnedBy(node, runtime, 'owned signal')\nconsole.log(node.value)\nnode.dispose()",
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
