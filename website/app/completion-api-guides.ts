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
const definePluginSharedExampleCode = `import { definePlugin, defineHost } from '@migaia/plugin-host'
import type { IPluginHostCore } from '@migaia/plugin-host'

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

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({})
})
// provider 必须排在 consumer 前面；整批成功后才一起对外可见。
const app = await host.use(cacheProvider, productReader)

console.log(app.extensions.loadProduct('sku-42')) // 199
await host.dispose()`

/** Complete guides for public operations added after the original website inventory. */
export const completionApiGuides: Readonly<
  Record<string, Readonly<Partial<Record<IGuideLocale, IApiGuide>>>>
> = {
  'rpc:bridge-jsonrpc:createJsonRpcRemoteChannel': guide({
    purposeEn:
      'Adapts an authenticated JSON-RPC byte stream into the maintained remote channel, mapping hello, describe, invoke, cancel and errors while rejecting optional operations the foreign peer cannot implement.',
    purposeZh:
      '把已认证 JSON-RPC 字节流接入维护中的 remote channel，映射 hello、describe、invoke、cancel 和错误，并拒绝外国 peer 未实现的可选操作。',
    quickStart:
      "import { createJsonRpcRemoteChannel } from '@migaia/rpc/bridge/jsonrpc'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createJsonRpcRemoteChannel>) {\n  return createJsonRpcRemoteChannel(...args)\n}",
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
  'rpc:core:createRpcIdempotencyStore': guide({
    purposeEn:
      'Creates the RPC-owned idempotency/result store used by request keys and outcome lookup. Retention is local to its owner unless the application supplies durable storage and reconciliation.',
    purposeZh:
      '创建 RPC owner 的幂等键与结果存储，用于请求键和 outcome 查询；除非应用提供持久化及对账，结果只在当前 owner 内保留。',
    quickStart:
      "import { createRpcIdempotencyStore } from '@migaia/rpc/core'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRpcIdempotencyStore>) {\n  return createRpcIdempotencyStore(...args)\n}",
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
  'rpc:core-features-one-way:createOneWayFeature': guide({
    purposeEn:
      'Adds sendOneWay to a composed endpoint over the existing outbound Feature. Completion means physical send completed, not that the remote provider executed successfully.',
    purposeZh:
      '在现有 outbound Feature 上为组合 endpoint 增加 sendOneWay；完成只表示物理发送结束，不证明远端 provider 成功执行。',
    quickStart:
      "import { createOneWayFeature } from '@migaia/rpc/core/features/one-way'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createOneWayFeature>) {\n  return createOneWayFeature(...args)\n}",
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
  'rpc:core-plugins-log:createIpcLogFeature': guide({
    purposeEn:
      'Creates the IPC log Feature for one connection/session, reporting lifecycle and backlog facts through the existing Host logger without exposing the peer authentication token.',
    purposeZh:
      '为一个 connection/session 创建 IPC 日志 Feature，通过既有 Host logger 报告生命周期与 backlog 事实，不暴露对端鉴权 token。',
    quickStart:
      "import { createIpcLogFeature } from '@migaia/rpc/core/plugins/log'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createIpcLogFeature>) {\n  return createIpcLogFeature(...args)\n}",
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
  'rpc:core-plugins-send-queue:createIpcSendQueueFeature': guide({
    purposeEn:
      'Creates the connection-owned bounded send gate with separate data and control capacity. Provider replies and stream data retain the data lane instead of being dropped as control traffic.',
    purposeZh:
      '创建连接持有的有界发送 gate，分别保留 data 与 control 容量；provider 回复和 stream 数据继续占用 data lane，不会被当成控制流丢弃。',
    quickStart:
      "import { createIpcSendQueueFeature } from '@migaia/rpc/core/plugins/send-queue'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createIpcSendQueueFeature>) {\n  return createIpcSendQueueFeature(...args)\n}",
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
  'rpc:core-plugins-send-queue:createIpcSendQueueTransport': guide({
    purposeEn:
      'Attaches the existing send gate to one original physical transport, carrying its negotiated agreement and native ownership without building a second queue or receiver.',
    purposeZh:
      '把现有发送 gate 接到一个原物理 transport，携带其协商结果与原生所有权，不创建第二份队列或接收器。',
    quickStart:
      "import { createIpcSendQueueTransport } from '@migaia/rpc/core/plugins/send-queue'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createIpcSendQueueTransport>) {\n  return createIpcSendQueueTransport(...args)\n}",
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
  'rpc:core-stream:createCanonicalChunkFeature': guide({
    purposeEn:
      'Creates the canonical chunk-reassembly dependency used by outbound and stream Features. It is selected during endpoint composition and released with the original endpoint scope.',
    purposeZh:
      '创建 outbound 和 stream Feature 使用的规范分片重组依赖，在 endpoint 组合时选定，并随原 endpoint scope 释放。',
    quickStart:
      "import { createCanonicalChunkFeature } from '@migaia/rpc/core/stream'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createCanonicalChunkFeature>) {\n  return createCanonicalChunkFeature(...args)\n}",
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
  'rpc:core-stream:createStreamFeature': guide({
    purposeEn:
      'Adds the stream owner to existing outbound/provider Features, retaining direction, sequence, credit, cancellation and terminal cleanup in that owner.',
    purposeZh:
      '在现有 outbound/provider Feature 上增加 stream owner，由它保留方向、序号、额度、取消和终态清理职责。',
    quickStart:
      "import { createStreamFeature } from '@migaia/rpc/core/stream'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createStreamFeature>) {\n  return createStreamFeature(...args)\n}",
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
  'rpc:process:createNativeProcessOffer': guide({
    purposeEn:
      'Builds the local native-process version/codec/capability offer; the handshake intersects it with the independent peer and never treats local declarations as remote support.',
    purposeZh:
      '构造本端原生进程版本、codec 与能力 offer；握手与独立对端取交集，不把本端声明当作远端支持。',
    quickStart:
      "import { createNativeProcessOffer } from '@migaia/rpc/process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createNativeProcessOffer>) {\n  return createNativeProcessOffer(...args)\n}",
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
  'rpc:process:createProcessResilience': guide({
    purposeEn:
      'Creates the process-specific resilience policy over the existing supervision and generation owners, retaining native health, drain and bounded replacement behavior.',
    purposeZh:
      '在原 supervision 和 generation owner 上创建进程恢复策略，保留原生健康检查、drain 与有界替换行为。',
    quickStart:
      "import { createProcessResilience } from '@migaia/rpc/process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createProcessResilience>) {\n  return createProcessResilience(...args)\n}",
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
  'rpc:process:createProcessTransport': guide({
    purposeEn:
      'Negotiates one native byte channel or accepts an explicit message-channel agreement, then exposes the original framed transport, capability result and stable close ownership.',
    purposeZh:
      '协商一个原生字节通道，或接纳明确的消息通道协议结果，然后公开原帧 transport、能力交集与稳定的 close 所有权。',
    quickStart:
      "import { createProcessTransport } from '@migaia/rpc/process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createProcessTransport>) {\n  return createProcessTransport(...args)\n}",
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
  'rpc:process:parseProcessPluginDescriptor': guide({
    purposeEn:
      'Validates an external process plugin descriptor before startup, keeping names, source selection and declared options on the maintained closed configuration contract.',
    purposeZh:
      '启动前校验外部进程插件描述符，把名称、来源选择和声明选项限制在维护中的封闭配置契约内。',
    quickStart:
      "import { parseProcessPluginDescriptor } from '@migaia/rpc/process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof parseProcessPluginDescriptor>) {\n  return parseProcessPluginDescriptor(...args)\n}",
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
  'rpc:process-adapters-deno-command:openProcessStdioChannel': guide({
    purposeEn:
      'Opens the actual Deno stdin/stdout byte channel used after trusted bootstrap, retaining stream ownership and native close instead of pretending a message port exists.',
    purposeZh:
      '在可信 bootstrap 后打开实际 Deno stdin/stdout 字节通道，保留原流所有权和原生 close，不伪造 message port。',
    quickStart:
      "import { openProcessStdioChannel } from '@migaia/rpc/process/adapters/deno-command'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof openProcessStdioChannel>) {\n  return openProcessStdioChannel(...args)\n}",
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
  'rpc:process-adapters-node-child-process:openProcessStdioChannel': guide({
    purposeEn:
      'Opens Node-compatible child stdio after the trusted bootstrap frame and keeps the original streams, cancellation and closed-state observation.',
    purposeZh:
      '在可信 bootstrap 帧之后打开 Node 兼容子进程 stdio，并保留原流、取消和关闭状态观察。',
    quickStart:
      "import { openProcessStdioChannel } from '@migaia/rpc/process/adapters/node-child-process'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof openProcessStdioChannel>) {\n  return openProcessStdioChannel(...args)\n}",
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
  'rpc:process-adapters-node-socket:dialProcessByteChannel': guide({
    purposeEn:
      'Dials one local Unix or loopback TCP byte connection for a borrowed process session. The connection can close locally but never owns the target process.',
    purposeZh:
      '连接一个本地 Unix 或 loopback TCP 字节通道，创建借用进程会话；可以关闭本端连接，但不拥有目标进程。',
    quickStart:
      "import { dialProcessByteChannel } from '@migaia/rpc/process/adapters/node-socket'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof dialProcessByteChannel>) {\n  return dialProcessByteChannel(...args)\n}",
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
  'rpc:process-adapters-deno-socket:dialProcessByteChannel': guide({
    purposeEn:
      'Dials a real Deno local socket with the maintained native byte framing; permission errors remain observable and are not converted to fake ready state.',
    purposeZh:
      '使用维护中的原生字节帧连接实际 Deno 本地 socket；权限错误仍可观察，不会被转换成伪造的 ready 状态。',
    quickStart:
      "import { dialProcessByteChannel } from '@migaia/rpc/process/adapters/deno-socket'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof dialProcessByteChannel>) {\n  return dialProcessByteChannel(...args)\n}",
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
  'rpc:remote:createCoroutineHost': guide({
    purposeEn:
      'Hosts an in-process coroutine deployment through the existing remote lifecycle contract. It shares memory rather than claiming native process isolation or Worker transfer ownership.',
    purposeZh:
      '通过既有 remote 生命周期契约托管同进程 coroutine；它共享进程内内存，不宣称原生进程隔离或 Worker transfer 所有权。',
    quickStart:
      "import { createCoroutineHost } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createCoroutineHost>) {\n  return createCoroutineHost(...args)\n}",
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
  'rpc:remote:createCoroutinePlugin': guide({
    purposeEn:
      'Installs a coroutine remote deployment into PluginHost so accepted methods and cleanup remain owned by the original Host registration and remote binding.',
    purposeZh:
      '把 coroutine remote 部署安装到 PluginHost，使已采纳的方法和清理继续由原 Host 注册及 remote binding 持有。',
    quickStart:
      "import { createCoroutinePlugin } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createCoroutinePlugin>) {\n  return createCoroutinePlugin(...args)\n}",
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
  'rpc:remote:createRemoteHost': guide({
    purposeEn:
      'Creates the advanced remote Host facade over a supplied original binding, preserving supervision, generation and Host control instead of launching a new unit itself.',
    purposeZh:
      '在给定原 binding 上创建高级 remote Host 门面，保留 supervision、generation 与 Host control；门面本身不另行启动执行单元。',
    quickStart:
      "import { createRemoteHost } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRemoteHost>) {\n  return createRemoteHost(...args)\n}",
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
  'rpc:remote:createRemotePlugin': guide({
    purposeEn:
      'Builds the advanced remote Plugin definition around one supplied binding and contract. Installation, exposed methods and close remain part of the adopting PluginHost.',
    purposeZh:
      '围绕一个给定 binding 和 contract 创建高级 remote Plugin 定义；安装、公开方法和 close 都属于采纳它的 PluginHost。',
    quickStart:
      "import { createRemotePlugin } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRemotePlugin>) {\n  return createRemotePlugin(...args)\n}",
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
  'rpc:remote:createRemoteRetryPort': guide({
    purposeEn:
      'Creates the bounded retry strategy port used with the original generation, idempotency key, deadline and dispatch owner; unknown outcome never proves a non-idempotent write can be repeated.',
    purposeZh:
      '创建与原 generation、幂等键、deadline 和 dispatch owner 配合的有界重试策略端口；unknown outcome 不证明非幂等写可安全重复。',
    quickStart:
      "import { createRemoteRetryPort } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createRemoteRetryPort>) {\n  return createRemoteRetryPort(...args)\n}",
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
  'rpc:remote:normalizeRemoteContract': guide({
    purposeEn:
      'Normalizes an external advanced remote contract before installing its method projection; it rejects invalid keys/modes instead of granting methods not actually provided.',
    purposeZh:
      '安装方法投影前规范化外部高级 remote contract；拒绝非法键和 mode，不会授予实际未提供的方法。',
    quickStart:
      "import { normalizeRemoteContract } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof normalizeRemoteContract>) {\n  return normalizeRemoteContract(...args)\n}",
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
  'rpc:remote:normalizeRemoteControlShape': guide({
    purposeEn:
      'Validates one Host-control payload against the registered control definition, preserving portable values and exact action shape before remote dispatch.',
    purposeZh:
      '远端分发前按已登记 control 定义校验 Host-control payload，保留可移植值与明确的动作形态。',
    quickStart:
      "import { normalizeRemoteControlShape } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof normalizeRemoteControlShape>) {\n  return normalizeRemoteControlShape(...args)\n}",
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
  'rpc:remote:normalizeRemoteHostCatalog': guide({
    purposeEn:
      'Validates the external Host plugin catalog used by the advanced remote facade, retaining explicit plugin/method names and rejecting structural conflicts before publication.',
    purposeZh:
      '校验高级 remote 门面使用的外部 Host 插件目录，保留明确的插件和方法名，并在发布前拒绝结构冲突。',
    quickStart:
      "import { normalizeRemoteHostCatalog } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof normalizeRemoteHostCatalog>) {\n  return normalizeRemoteHostCatalog(...args)\n}",
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
  'rpc:remote:sameRemoteContract': guide({
    purposeEn:
      'Compares two normalized remote contracts by their maintained method and mode semantics for directory compatibility decisions; equality does not authorize a caller.',
    purposeZh:
      '按维护中的方法与 mode 语义比较两个规范 remote contract，供目录兼容判断使用；相等不代表调用者获得权限。',
    quickStart:
      "import { sameRemoteContract } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof sameRemoteContract>) {\n  return sameRemoteContract(...args)\n}",
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
  'rpc:remote:serveRemoteHost': guide({
    purposeEn:
      'Publishes an explicitly exposed local Host through an accepted remote channel while preserving method whitelists and the local Host registration owner.',
    purposeZh:
      '通过已采纳 remote channel 发布显式 expose 的本地 Host，保留方法白名单及本地 Host 注册 owner。',
    quickStart:
      "import { serveRemoteHost } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof serveRemoteHost>) {\n  return serveRemoteHost(...args)\n}",
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
  'rpc:remote:serveRemotePlugin': guide({
    purposeEn:
      'Publishes the explicitly exposed local Plugin projection through an accepted channel; it transfers calls and results, never executable plugin code.',
    purposeZh:
      '通过已采纳 channel 发布显式 expose 的本地 Plugin 投影；只传输调用和结果，不传输可执行插件代码。',
    quickStart:
      "import { serveRemotePlugin } from '@migaia/rpc/remote'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof serveRemotePlugin>) {\n  return serveRemotePlugin(...args)\n}",
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
  'rpc:testing:createPeerPair': guide({
    purposeEn:
      'Creates two in-memory symmetric Peers with cross-inferred provide types and the real core call/error/order semantics. It is an application test helper, not evidence of native transfer or process isolation.',
    purposeZh:
      '创建两个内存内对称 Peer，交叉推导 provide 类型并执行真实 core 调用、错误和顺序语义；这是应用测试 helper，不证明原生 transfer 或进程隔离。',
    quickStart:
      "import { createPeerPair } from '@migaia/rpc/testing'\n\nconst pair = await createPeerPair({\n  a: { provide: { echo: (value: string) => value } },\n  b: { provide: { double: (value: number) => value * 2 } }\n})\ntry {\n  console.log(await pair.a.request('double', 21))\n  console.log(await pair.b.request('echo', 'ready'))\n} finally {\n  await Promise.all([pair.a.close(), pair.b.close()])\n}",
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
  'rpc:threads:createNodeThreadChannel': guide({
    purposeEn:
      'Binds an existing Node MessagePort to the canonical borrowed thread channel with an explicit peer identity and scheduler; only the original launcher observes Worker exit.',
    purposeZh:
      '把已有 Node MessagePort 绑定到规范借用线程通道，并声明 peer 身份和 scheduler；只有原 launcher 负责观察 Worker 退出。',
    quickStart:
      "import { createNodeThreadChannel } from '@migaia/rpc/threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createNodeThreadChannel>) {\n  return createNodeThreadChannel(...args)\n}",
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
  'rpc:threads:createWebThreadChannel': guide({
    purposeEn:
      'Binds an existing EventTarget-style port after bootstrap has finished, retaining borrowed message ownership without claiming Worker termination authority.',
    purposeZh:
      '在 bootstrap 完成后绑定已有 EventTarget 风格端口，保留借用消息所有权，不宣称拥有 Worker 终止权限。',
    quickStart:
      "import { createWebThreadChannel } from '@migaia/rpc/threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof createWebThreadChannel>) {\n  return createWebThreadChannel(...args)\n}",
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
  'rpc:threads:readThreadBootstrap': guide({
    purposeEn:
      'Validates a received trusted thread bootstrap value before its identity and parent route are used; extra object fields do not create launcher ownership.',
    purposeZh:
      '使用身份和父路由前校验收到的可信线程 bootstrap 值；额外对象字段不能创造 launcher 所有权。',
    quickStart:
      "import { readThreadBootstrap } from '@migaia/rpc/threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof readThreadBootstrap>) {\n  return readThreadBootstrap(...args)\n}",
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
  'rpc:threads:receiveThreadData': guide({
    purposeEn:
      'Receives the maintained thread preparation data and gives it to the existing preparation callback, preserving the channel identity before ordinary message reception starts.',
    purposeZh:
      '接收维护中的线程准备数据并交给既有 preparation 回调，在普通消息接收开始前保留通道身份。',
    quickStart:
      "import { receiveThreadData } from '@migaia/rpc/threads'\n\nexport function invokeConfiguredBoundary(...args: Parameters<typeof receiveThreadData>) {\n  return receiveThreadData(...args)\n}",
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
  'rpc:process-adapters-bun-spawn:createBunProcessLauncher': guide({
    purposeEn:
      'Creates the bun-spawn native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 bun-spawn 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBunProcessLauncher } from '@migaia/rpc/process/adapters/bun-spawn'\n\nexport function configureAdapter(options: Parameters<typeof createBunProcessLauncher>[0]) {\n  return createBunProcessLauncher(options)\n}",
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
  'rpc:process-adapters-deno-command:createDenoProcessLauncher': guide({
    purposeEn:
      'Creates the deno-command native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 deno-command 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createDenoProcessLauncher } from '@migaia/rpc/process/adapters/deno-command'\n\nexport function configureAdapter(options: Parameters<typeof createDenoProcessLauncher>[0]) {\n  return createDenoProcessLauncher(options)\n}",
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
  'rpc:process-adapters-electron-utility-process:createElectronUtilityProcessLauncher': guide({
    purposeEn:
      'Creates the electron-utility-process native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-utility-process 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronUtilityProcessLauncher } from '@migaia/rpc/process/adapters/electron-utility-process'\n\nconst adapter = createElectronUtilityProcessLauncher()\nconsole.log(adapter)",
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
  'rpc:process-adapters-node-child-process:createNodeProcessLauncher': guide({
    purposeEn:
      'Creates the node-child-process native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 node-child-process 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'\n\nexport function configureAdapter(options: Parameters<typeof createNodeProcessLauncher>[0]) {\n  return createNodeProcessLauncher(options)\n}",
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
  'rpc:process-adapters-windows-job:createWindowsJobProcessLauncher': guide({
    purposeEn:
      'Creates the windows-job native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 windows-job 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createWindowsJobProcessLauncher } from '@migaia/rpc/process/adapters/windows-job'\n\nconst adapter = createWindowsJobProcessLauncher()\nconsole.log(adapter)",
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
  'rpc:threads-adapters-browser:createBrowserThreadChannelFactory': guide({
    purposeEn:
      'Creates the browser handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 browser 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBrowserThreadChannelFactory } from '@migaia/rpc/threads/adapters/browser'\n\nexport function configureAdapter(options: Parameters<typeof createBrowserThreadChannelFactory>[0]) {\n  return createBrowserThreadChannelFactory(options)\n}",
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
  'rpc:threads-adapters-browser:createBrowserThreadLauncher': guide({
    purposeEn:
      'Creates the browser native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 browser 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBrowserThreadLauncher } from '@migaia/rpc/threads/adapters/browser'\n\nexport function configureAdapter(options: Parameters<typeof createBrowserThreadLauncher>[0]) {\n  return createBrowserThreadLauncher(options)\n}",
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
  'rpc:threads-adapters-bun:createBunThreadChannelFactory': guide({
    purposeEn:
      'Creates the bun handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 bun 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBunThreadChannelFactory } from '@migaia/rpc/threads/adapters/bun'\n\nexport function configureAdapter(options: Parameters<typeof createBunThreadChannelFactory>[0]) {\n  return createBunThreadChannelFactory(options)\n}",
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
  'rpc:threads-adapters-bun:createBunThreadLauncher': guide({
    purposeEn:
      'Creates the bun native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 bun 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createBunThreadLauncher } from '@migaia/rpc/threads/adapters/bun'\n\nexport function configureAdapter(options: Parameters<typeof createBunThreadLauncher>[0]) {\n  return createBunThreadLauncher(options)\n}",
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
  'rpc:threads-adapters-deno:createDenoThreadChannelFactory': guide({
    purposeEn:
      'Creates the deno handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 deno 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createDenoThreadChannelFactory } from '@migaia/rpc/threads/adapters/deno'\n\nexport function configureAdapter(options: Parameters<typeof createDenoThreadChannelFactory>[0]) {\n  return createDenoThreadChannelFactory(options)\n}",
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
  'rpc:threads-adapters-deno:createDenoThreadLauncher': guide({
    purposeEn:
      'Creates the deno native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 deno 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createDenoThreadLauncher } from '@migaia/rpc/threads/adapters/deno'\n\nexport function configureAdapter(options: Parameters<typeof createDenoThreadLauncher>[0]) {\n  return createDenoThreadLauncher(options)\n}",
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
  'rpc:threads-adapters-electron-main:createElectronMainThreadChannelFactory': guide({
    purposeEn:
      'Creates the electron-main handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-main 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronMainThreadChannelFactory } from '@migaia/rpc/threads/adapters/electron-main'\n\nexport function configureAdapter(options: Parameters<typeof createElectronMainThreadChannelFactory>[0]) {\n  return createElectronMainThreadChannelFactory(options)\n}",
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
  'rpc:threads-adapters-electron-main:createElectronMainThreadLauncher': guide({
    purposeEn:
      'Creates the electron-main native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-main 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronMainThreadLauncher } from '@migaia/rpc/threads/adapters/electron-main'\n\nconst adapter = createElectronMainThreadLauncher()\nconsole.log(adapter)",
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
  'rpc:threads-adapters-electron-renderer:createElectronRendererThreadChannelFactory': guide({
    purposeEn:
      'Creates the electron-renderer handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-renderer 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronRendererThreadChannelFactory } from '@migaia/rpc/threads/adapters/electron-renderer'\n\nexport function configureAdapter(options: Parameters<typeof createElectronRendererThreadChannelFactory>[0]) {\n  return createElectronRendererThreadChannelFactory(options)\n}",
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
  'rpc:threads-adapters-electron-renderer:createElectronRendererThreadLauncher': guide({
    purposeEn:
      'Creates the electron-renderer native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 electron-renderer 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createElectronRendererThreadLauncher } from '@migaia/rpc/threads/adapters/electron-renderer'\n\nexport function configureAdapter(options: Parameters<typeof createElectronRendererThreadLauncher>[0]) {\n  return createElectronRendererThreadLauncher(options)\n}",
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
  'rpc:threads-adapters-node:createNodeThreadChannelFactory': guide({
    purposeEn:
      'Creates the node handle-to-message channel factory used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 node 的handle 到消息通道的连接工厂，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createNodeThreadChannelFactory } from '@migaia/rpc/threads/adapters/node'\n\nexport function configureAdapter(options: Parameters<typeof createNodeThreadChannelFactory>[0]) {\n  return createNodeThreadChannelFactory(options)\n}",
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
  'rpc:threads-adapters-node:createNodeThreadLauncher': guide({
    purposeEn:
      'Creates the node native unit launcher used by the matching process or thread Peer source. It retains runtime-specific validation, readiness, exit observation and ownership instead of pretending every native handle supports the same controls.',
    purposeZh:
      '创建 node 的执行单元启动器，交给匹配的 process/thread Peer 来源使用。保留该运行时自身的配置校验、就绪、退出观察和所有权；不把不同原生 handle 伪装成具有同一组控制能力。',
    quickStart:
      "import { createNodeThreadLauncher } from '@migaia/rpc/threads/adapters/node'\n\nexport function configureAdapter(options: Parameters<typeof createNodeThreadLauncher>[0]) {\n  return createNodeThreadLauncher(options)\n}",
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
  'rpc:core-transport-kit:createListenerFailureState': guide({
    purposeEn:
      'Creates a local bucket for failures thrown by diagnostic reporters, so reporting one listener error cannot recursively lose another error.',
    purposeZh:
      '创建本地诊断上报失败桶，防止报告一个监听器错误时递归丢失另一个错误。桶由适配器 owner 持有，在终态报告与清理后释放。',
    quickStart:
      "import { createListenerFailureState } from '@migaia/rpc/core/transport-kit'\n\nconst state = createListenerFailureState()\nconsole.log(state)",
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
  'rpc:core-transport-kit:collectListenerFailure': guide({
    purposeEn:
      'Retains one original reporter failure in the existing failure state without reconstructing its native type or cause chain.',
    purposeZh: '把一个原始上报失败保留到既有 failure state，不重建它的原生类型或 cause 链。',
    quickStart:
      "import { collectListenerFailure, createListenerFailureState } from '@migaia/rpc/core/transport-kit'\n\nconst state = createListenerFailureState()\ncollectListenerFailure(state, new TypeError('listener failed'))\nconsole.log(state)",
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
  'rpc:core-transport-kit:collectListenerCleanupFailures': guide({
    purposeEn:
      'Runs the supplied listener removals and collects every original cleanup failure, allowing a transport owner to finish all removals before reporting.',
    purposeZh:
      '执行给定的监听器移除操作并收集所有原始清理失败，让 transport owner 完成全部移除后再报告。',
    quickStart:
      "import { collectListenerCleanupFailures } from '@migaia/rpc/core/transport-kit'\n\nconst failures = collectListenerCleanupFailures([() => console.log('listener removed')])\nconsole.log(failures)",
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
  'rpc:core-transport-kit:createListenerFailure': guide({
    purposeEn:
      'Projects collected listener failures to the source-owned boundary error while keeping the original errors reachable through cause or aggregation.',
    purposeZh:
      '把已收集的监听器失败投影为原 owner 的边界错误，原始错误仍可通过 cause 或聚合成员访问。',
    quickStart:
      "import { createListenerFailure } from '@migaia/rpc/core/transport-kit'\n\nconst failure = createListenerFailure([new TypeError('listener failed')])\nconsole.error(failure)",
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
  'rpc:core-transport-kit:createMessageListenerHub': guide({
    purposeEn:
      'Creates the transport-owned listener collection with stable subscribe/dispose behavior; dispatch isolates individual listener failure without copying the RPC state machine.',
    purposeZh:
      '创建 transport 持有的监听器集合，保留稳定的订阅与清理行为；分发隔离单个监听器失败，而不复制 RPC 状态机。',
    quickStart:
      "import { createMessageListenerHub } from '@migaia/rpc/core/transport-kit'\n\nconst hub = createMessageListenerHub<{ value: number }>()\nconsole.log(hub)",
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
  'rpc:core-transport-kit:drainListenerFailures': guide({
    purposeEn:
      'Reports the completed cleanup failure set at the selected boundary after all cleanup work has been attempted.',
    purposeZh:
      '在全部监听器清理操作都已尝试后，向选定边界报告完整失败集合，使原始错误仍可追踪并避免跳过后续清理。',
    quickStart:
      "import { drainListenerFailures } from '@migaia/rpc/core/transport-kit'\n\ndrainListenerFailures([])\nconsole.log('listener failures drained')",
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
  'rpc:core-transport-kit:drainTerminalListenerFailures': guide({
    purposeEn:
      'Drains the terminal listener failure set through the original boundary reporter and preserves its synchronous or asynchronous completion semantics.',
    purposeZh:
      '通过原始边界上报器排空终态监听器失败集合，保留其同步或异步完成语义。调用方须等待完整结束，不能提前宣告所有资源已释放。',
    quickStart:
      "import { drainTerminalListenerFailures } from '@migaia/rpc/core/transport-kit'\n\nawait drainTerminalListenerFailures([])",
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
  'rpc:core-transport-kit:observeListener': guide({
    purposeEn:
      'Invokes one listener and contains synchronous throws and late Promise rejection in the existing report channel, retaining original error identity.',
    purposeZh:
      '调用一个监听器，把同步抛错和迟到的 Promise rejection 交给现有 report 通道，保留原始错误身份。',
    quickStart:
      "import { observeListener, createListenerFailureState } from '@migaia/rpc/core/transport-kit'\n\nconst state = createListenerFailureState()\nobserveListener(() => console.log('message delivered'), console.error, state)",
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
  'rpc:core-transport-kit:registerListeners': guide({
    purposeEn:
      'Registers the listener set through one transactional boundary; a partial registration failure removes the listeners already installed.',
    purposeZh:
      '通过一个事务边界登记监听器集合；中途登记失败会移除已经安装的监听器，并保留原始登记失败与回滚错误，避免留下半安装接收器。',
    quickStart:
      "import { registerListeners } from '@migaia/rpc/core/transport-kit'\n\nconst listener = () => console.log('window resized')\nregisterListeners([{ add: () => window.addEventListener('resize', listener), remove: () => window.removeEventListener('resize', listener) }])",
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
  'rpc:core-transport-kit:releaseListenerRegistration': guide({
    purposeEn:
      'Attempts every original listener removal and commits terminal release once, preserving cleanup failures for the owner boundary.',
    purposeZh: '尝试执行全部原监听器移除，并只提交一次终态释放；清理失败保留给 owner 边界处理。',
    quickStart:
      "import { releaseListenerRegistration } from '@migaia/rpc/core/transport-kit'\n\nreleaseListenerRegistration([() => console.log('listener removed')], () => console.log('registration closed'))",
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
  'rpc:core-transport-kit:reportListenerFailure': guide({
    purposeEn:
      'Delivers one original listener failure to the registered reporter set and retains failures thrown by those reporters in the supplied bucket.',
    purposeZh:
      '把一个原始监听器失败交给已登记的上报器集合，并把上报器自身失败保留到给定桶中。它不会替换原业务错误或静默吞掉诊断失败。',
    quickStart:
      "import { reportListenerFailure, createListenerFailureState } from '@migaia/rpc/core/transport-kit'\n\nconst state = createListenerFailureState()\nreportListenerFailure(new TypeError('listener failed'), [console.error], state)",
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
  'rpc:core-transport-kit:safeRead': guide({
    purposeEn:
      'Reads a possibly hostile property through the source-owned reporting boundary; getter failure is reported instead of escaping unnoticed from message handling.',
    purposeZh:
      '通过原 owner 的上报边界读取可能不可信的属性；getter 失败会被报告，不会在消息处理中悄然逸出。',
    quickStart:
      "import { safeRead } from '@migaia/rpc/core/transport-kit'\n\nconst value: unknown = { id: 'remote' }\nconsole.log(safeRead<string>(value, 'id', ({ error }) => console.error(error)))",
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
  'rpc:core-transport-kit:safeString': guide({
    purposeEn:
      'Converts a value to diagnostic text with an explicit fallback and reporter when conversion fails; it does not replace protocol validation.',
    purposeZh: '把值转换为诊断文本，转换失败时采用明确 fallback 并报告错误；它不替代协议校验。',
    quickStart:
      "import { safeString } from '@migaia/rpc/core/transport-kit'\n\nconsole.log(safeString({ status: 'ready' }, 'unavailable', ({ error }) => console.error(error)))",
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
  'rpc:core-transport-kit:tagRpcError': guide({
    purposeEn:
      'Attaches the source-owned RPC code to an existing native error without replacing its type, original stack or cause identity.',
    purposeZh: '向现有原生错误附加 RPC owner 的错误码，不替换其类型、原始 stack 或 cause 身份。',
    quickStart:
      "import { tagRpcError } from '@migaia/rpc/core/transport-kit'\n\nconst error = tagRpcError(new TypeError('adapter rejected a frame'), 'TRANSPORT')\nconsole.log(error.source, error.code, error instanceof TypeError)",
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
  'rpc:contract:acceptRpcHandshake': guide({
    purposeEn:
      'Validates a remote hello against a local offer and returns the accept text plus an agreement, or a coded rejection before application state is created.',
    purposeZh:
      '校验对端 hello 与本端 offer 的交集，在创建业务状态前返回 accept 文本及协议结果，或返回有错误码的拒绝。',
    quickStart:
      "import { acceptRpcHandshake, createRpcHello } from '@migaia/rpc/contract'\n\nconst local = { versions: [{ major: 1, minor: 1 }], codecs: ['json'], capabilities: ['runtime-api@1', 'batch@1'], peer: { id: 'caller', runtime: 'node' } }\nconst remote = { ...local, peer: { id: 'worker', runtime: 'node' } }\nconst result = acceptRpcHandshake(local, createRpcHello(remote))\nconsole.log(result.ok)",
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
  'rpc:contract:completeRpcHandshake': guide({
    purposeEn:
      'Completes the initiator side from the received accept text; unsupported baseline capabilities are rejected during negotiation rather than business dispatch.',
    purposeZh:
      '根据接收的 accept 文本完成发起端协商；不支持的基线能力在握手阶段拒绝，而不是等到业务调用时才失败。',
    quickStart:
      "import { completeRpcHandshake, createRpcHello, acceptRpcHandshake } from '@migaia/rpc/contract'\n\nconst local = { versions: [{ major: 1, minor: 1 }], codecs: ['json'], capabilities: ['runtime-api@1', 'batch@1'], peer: { id: 'caller', runtime: 'node' } }\nconst remote = { ...local, peer: { id: 'worker', runtime: 'node' } }\nconst accepted = acceptRpcHandshake(local, createRpcHello(remote))\nif (accepted.ok) console.log(completeRpcHandshake(remote, accepted.reply))",
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
  'rpc:contract:createRpcHello': guide({
    purposeEn:
      'Serializes the local version, codec, capability and peer offer into the canonical hello text consumed by independent peers. It is a wire helper, not a connection factory.',
    purposeZh:
      '把本端版本、codec、能力和 peer offer 序列化为独立对端消费的规范 hello 文本；它只构造线材，不负责创建连接。',
    quickStart:
      "import { createRpcHello, acceptRpcHandshake } from '@migaia/rpc/contract'\n\nconst local = { versions: [{ major: 1, minor: 1 }], codecs: ['json'], capabilities: ['runtime-api@1', 'batch@1'], peer: { id: 'caller', runtime: 'node' } }\nconst remote = { ...local, peer: { id: 'worker', runtime: 'node' } }\nconsole.log(createRpcHello(local))",
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
  'rpc:contract:normalizeRpcHandshake': guide({
    purposeEn:
      'Parses and validates one canonical handshake text, including closed fields and protocol discriminants, before a custom connection owner inspects its step.',
    purposeZh:
      '在自定义连接 owner 读取 step 前，解析并校验一条规范握手文本，包括封闭字段与协议判别值。',
    quickStart:
      "import { normalizeRpcHandshake, createRpcHello, acceptRpcHandshake } from '@migaia/rpc/contract'\n\nconst local = { versions: [{ major: 1, minor: 1 }], codecs: ['json'], capabilities: ['runtime-api@1', 'batch@1'], peer: { id: 'caller', runtime: 'node' } }\nconst remote = { ...local, peer: { id: 'worker', runtime: 'node' } }\nconsole.log(normalizeRpcHandshake(createRpcHello(remote)))",
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
  'rpc:contract:normalizePortable': guide({
    purposeEn:
      'Snapshots a wire value under the portable-data contract and rejects functions, cycles and unsupported object shapes before transfer. Binary data requires its explicit profile.',
    purposeZh:
      '按可移植数据契约快照化线材值，在传输前拒绝函数、循环和不支持的对象形态；二进制值仍需显式的二进制 profile。',
    quickStart:
      "import { normalizePortable } from '@migaia/rpc/contract'\n\nconst snapshot = normalizePortable({ total: 42, items: ['ready'] })\nconsole.log(snapshot)",
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
  'rpc:contract:normalizeRpcSerializedError': guide({
    purposeEn:
      'Validates a received serialized error record before restoration, preserving source, code, name, original stack and its bounded cause chain.',
    purposeZh:
      '恢复错误对象前校验收到的序列化错误记录，保留 source、code、name、原始 stack 与有界 cause 链。',
    quickStart:
      "import { normalizeRpcSerializedError, serializeRpcError } from '@migaia/rpc/contract'\n\nconst serialized = serializeRpcError(new RangeError('local range exceeded'), { report: console.error })\nconsole.log(normalizeRpcSerializedError(serialized))",
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
  'rpc:contract:fromJsonRpcError': guide({
    purposeEn:
      'Converts a JSON-RPC error object into the common serialized RPC error shape, retaining the explicit error data and transport-independent cause information.',
    purposeZh:
      '把 JSON-RPC 错误对象转换为共同的 RPC 序列化错误形态，保留明确的错误数据以及独立于载体的 cause 信息。',
    quickStart:
      "import { fromJsonRpcError } from '@migaia/rpc/contract'\n\nconst error = fromJsonRpcError({ code: -32603, message: 'remote failure' })\nconsole.log(error.name, error.message)",
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
  'rpc:contract:toJsonRpcError': guide({
    purposeEn:
      'Projects a serialized RPC failure to the JSON-RPC error object while retaining the structured source/code and original trace in error data.',
    purposeZh:
      '把序列化 RPC 失败投影为 JSON-RPC 错误对象，并在 error data 中保留结构化 source/code 与原始错误轨迹。',
    quickStart:
      "import { toJsonRpcError, serializeRpcError } from '@migaia/rpc/contract'\n\nconst serialized = serializeRpcError(new RangeError('local range exceeded'), { report: console.error })\nconsole.log(toJsonRpcError(serialized, -32603))",
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
  'rpc:contract:createRpcUnknownFieldWarner': guide({
    purposeEn:
      'Creates a bounded, per-connection unknown-field warning owner so repeated extensions do not flood diagnostics; it does not authorize unknown protocol values.',
    purposeZh:
      '创建有界、按连接隔离的未知字段告警 owner，避免扩展字段重复灌满诊断通道；它不会授予未知协议值权限。',
    quickStart:
      "import { createRpcUnknownFieldWarner } from '@migaia/rpc/contract'\n\nconst warnings = createRpcUnknownFieldWarner({ maxKeysPerConnection: 16, maxConnections: 128, warn: (connection, field) => console.warn(connection, field) })\nconsole.log(warnings)",
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
  'rpc:contract:measurePortableStreamValue': guide({
    purposeEn:
      'Measures the encoded byte budget of a portable stream value before stream credit or physical-frame limits are applied by the owning layer.',
    purposeZh: '在 stream owner 应用额度和物理帧限制前，测量一个可移植 stream 值的编码字节预算。',
    quickStart:
      "import { measurePortableStreamValue } from '@migaia/rpc/contract'\n\nconsole.log(measurePortableStreamValue('first chunk'))",
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
  'rpc:contract:normalizeStreamPayload': guide({
    purposeEn:
      'Validates one stream event, sequence number and portable value before the core stream owner changes its credit or terminal state.',
    purposeZh: '在 core stream owner 修改额度或终态前，校验一个 stream event、序号及可移植值。',
    quickStart:
      "import { normalizeStreamPayload } from '@migaia/rpc/contract'\n\nconsole.log(normalizeStreamPayload({ event: 'item', seq: 0, value: 'first' }))",
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
  'rpc:contract:invalidRpcStream': guide({
    purposeEn:
      'Constructs the contract-owned native TypeError for a stream violation, retaining its stable code and payload-relative pointer for diagnostics.',
    purposeZh:
      '构造 stream 违规对应的规范原生 TypeError，保留稳定错误码与 payload 相对 pointer，供边界诊断使用。',
    quickStart:
      "import { invalidRpcStream } from '@migaia/rpc/contract'\n\nconst error = invalidRpcStream('field', '/event')\nconsole.log(error.name, error.message)",
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
  'rpc:contract-framing:createStringFramer': guide({
    purposeEn:
      'Creates a bounded string fragmentation/reassembly policy for transports that can carry the resulting frame objects; it does not create a socket or business endpoint.',
    purposeZh:
      '创建有界的字符串分片与重组策略，载体须能传输生成的帧对象；它不会创建 socket 或业务 endpoint。',
    quickStart:
      "import { createStringFramer } from '@migaia/rpc/contract/framing'\n\nconst framer = createStringFramer({ chunkSize: 32 })\nconsole.log(framer.frame('small encoded message', { source: 'local', messageId: 'one' }))",
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
  'rpc:contract-framing:createBinaryFramer': guide({
    purposeEn:
      'Creates a bounded byte fragmentation/reassembly policy whose physical frame format is independent from application method routing and buffer ownership transfer.',
    purposeZh:
      '创建有界的字节分片与重组策略；物理帧格式与业务方法路由、buffer 所有权 transfer 是独立的职责。',
    quickStart:
      "import { createBinaryFramer } from '@migaia/rpc/contract/framing'\n\nconst framer = createBinaryFramer({ chunkSize: 32 })\nconsole.log(framer.frame(new TextEncoder().encode('payload'), { source: 'local', messageId: 'one' }))",
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
  'rpc:contract-framing:createReassembler': guide({
    purposeEn:
      'Wraps the selected framer in its canonical reassembly owner, retaining partial-message limits, source isolation and cleanup when a channel terminates.',
    purposeZh:
      '把选定 framer 接到规范重组 owner，保留分片消息上限、source 隔离以及通道终止时的清理职责。',
    quickStart:
      "import { createReassembler, createStringFramer } from '@migaia/rpc/contract/framing'\n\nconst framer = createStringFramer({ chunkSize: 32 })\nconst receiver = createReassembler(framer)\nfor (const frame of framer.frame('payload', { source: 'local', messageId: 'one' })) console.log(receiver.accept(frame, { source: 'local', messageId: 'one' }))",
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
  'rpc:contract-framing:bindRpcFrameIngress': guide({
    purposeEn:
      'Binds the original paired accept/frame callables to one ingress selector so physical-fragment provenance is preserved across adapter reception.',
    purposeZh:
      '把原始成对的 accept/frame 函数绑定到同一个入站选择器，保留适配器接收过程中的物理分片来源证明。',
    quickStart:
      "import { bindRpcFrameIngress, createStringFramer } from '@migaia/rpc/contract/framing'\n\nconst framer = createStringFramer({ chunkSize: 32 })\nconst prepare = bindRpcFrameIngress(framer.accept, framer.frame)\nconsole.log(prepare('payload', { source: 'local', messageId: 'one' }))",
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
  'rpc:contract-framing-stream:encodeRpcStreamFrame': guide({
    purposeEn:
      'Prefixes one nonempty native byte payload with its four-byte network-order length and enforces the existing maximum physical payload size.',
    purposeZh: '给一段非空原生字节 payload 加上四字节网络序长度前缀，并执行既有物理 payload 上限。',
    quickStart:
      "import { encodeRpcStreamFrame } from '@migaia/rpc/contract/framing/stream'\n\nconsole.log(encodeRpcStreamFrame(new TextEncoder().encode('message')))",
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
  'rpc:contract-framing-stream:createRpcStreamFrameDecoder': guide({
    purposeEn:
      'Decodes arbitrary native byte chunks into complete length-prefixed payloads; malformed lengths report once and close the decoder instead of leaking partial state.',
    purposeZh:
      '把任意分块的原生字节流解码为完整长度前缀 payload；非法长度只上报一次并关闭解码器，避免泄漏半消息状态。',
    quickStart:
      "import { createRpcStreamFrameDecoder, encodeRpcStreamFrame } from '@migaia/rpc/contract/framing/stream'\n\nconst decoder = createRpcStreamFrameDecoder({ onFrame: (bytes) => console.log(new TextDecoder().decode(bytes)), onError: console.error })\ndecoder.push(encodeRpcStreamFrame(new TextEncoder().encode('message')))\ndecoder.finish()\ndecoder.close()",
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
  'rpc:process:createProcessPeer': guide({
    purposeEn:
      'Creates a symmetric process connection owned by the caller, who closes the Peer. Both sides publish explicit provide/expose methods; the library builds the v2 directory and requires batch reception before business calls are admitted.',
    purposeZh:
      '创建对称进程连接，由调用方持有并负责 close 的独立 Peer。两端通过 provide/expose 显式发布方法，由库生成 v2 目录并要求批量帧接收；类型声明不会代替运行时鉴权。',
    quickStart:
      "import { randomBytes } from 'node:crypto'\nimport { fileURLToPath } from 'node:url'\nimport {\n  createProcessPeer,\n  createProcessTransport,\n  type IProcessByteChannel\n} from '@migaia/rpc/process'\nimport { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\n\ntype IChildApi = { math: { double: (value: number) => number } }\ntype IOptions = Parameters<typeof createProcessPeer<IChildApi>>[0]\ntype ISpawn = Exclude<NonNullable<IOptions['spawn']>, Function>\nconst report = (error: unknown) => console.error(error)\nconst launcher = createNodeProcessLauncher()\nconst token = randomBytes(32).toString('base64url')\nlet handle: Awaited<ReturnType<typeof launcher.launch>>\nconst spawn: ISpawn = {\n  kind: 'spawn',\n  channelKind: 'byte',\n  wire: 'native',\n  token,\n  supervision: {\n    id: 'math-process',\n    isolation: 'best-effort',\n    report,\n    launcher: {\n      ...launcher,\n      launch: async (spec, request) => {\n        handle = await launcher.launch(spec, request)\n        return handle\n      }\n    },\n    budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n    spec: {\n      command: process.execPath,\n      args: [fileURLToPath(new URL('./service.js', import.meta.url))],\n      env: { inherit: ['PATH'], set: {} },\n      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },\n      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }\n    }\n  },\n  rawChannel: async () => handle.channel!,\n  establish: (raw, prepared) =>\n    createProcessTransport(raw as IProcessByteChannel, {\n      role: 'initiator',\n      offer: prepared.offer!,\n      peerId: handle.runtimeApiIdentity!.instanceId,\n      scheduler: prepared.scheduler,\n      ipc: { ...prepared.session, log: () => undefined },\n      report\n    })\n}\nconst typedRemote = await createProcessPeer<IChildApi>({ spawn, report })\ntry {\n  console.log(await typedRemote.request('math.double', 21))\n} finally {\n  await typedRemote.close()\n}",
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
  'rpc:process:createProcessPlugin': guide({
    purposeEn:
      'Creates a symmetric process connection owned by PluginHost and addressed through its process outlet. Both sides publish explicit provide/expose methods; the library builds the v2 directory and requires batch reception before business calls are admitted.',
    purposeZh:
      '创建对称进程连接，由 PluginHost 持有，通过 host.process 出口调用。两端通过 provide/expose 显式发布方法，由库生成 v2 目录并要求批量帧接收；类型声明不会代替运行时鉴权。',
    quickStart:
      "import { randomBytes } from 'node:crypto'\nimport { fileURLToPath } from 'node:url'\nimport {\n  createProcessPeer,\n  createProcessTransport,\n  type IProcessByteChannel\n} from '@migaia/rpc/process'\nimport { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\n\ntype IChildApi = { math: { double: (value: number) => number } }\ntype IOptions = Parameters<typeof createProcessPeer<IChildApi>>[0]\ntype ISpawn = Exclude<NonNullable<IOptions['spawn']>, Function>\nconst report = (error: unknown) => console.error(error)\nconst launcher = createNodeProcessLauncher()\nconst token = randomBytes(32).toString('base64url')\nlet handle: Awaited<ReturnType<typeof launcher.launch>>\nconst spawn: ISpawn = {\n  kind: 'spawn',\n  channelKind: 'byte',\n  wire: 'native',\n  token,\n  supervision: {\n    id: 'math-process',\n    isolation: 'best-effort',\n    report,\n    launcher: {\n      ...launcher,\n      launch: async (spec, request) => {\n        handle = await launcher.launch(spec, request)\n        return handle\n      }\n    },\n    budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n    spec: {\n      command: process.execPath,\n      args: [fileURLToPath(new URL('./service.js', import.meta.url))],\n      env: { inherit: ['PATH'], set: {} },\n      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },\n      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }\n    }\n  },\n  rawChannel: async () => handle.channel!,\n  establish: (raw, prepared) =>\n    createProcessTransport(raw as IProcessByteChannel, {\n      role: 'initiator',\n      offer: prepared.offer!,\n      peerId: handle.runtimeApiIdentity!.instanceId,\n      scheduler: prepared.scheduler,\n      ipc: { ...prepared.session, log: () => undefined },\n      report\n    })\n}\nimport { defineHost } from '@migaia/plugin-host'\nimport { createProcessPlugin } from '@migaia/rpc/process'\n\nconst child = createProcessPlugin<IChildApi, Record<never, never>, 'child'>({\n  name: 'child',\n  spawn,\n  report\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof child]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  await host.use(child)\n  console.log(await host.process!.request('child', 'math.double', 21))\n} finally {\n  await host.dispose()\n}",
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
  'rpc:threads:createThreadPeer': guide({
    purposeEn:
      'Creates a symmetric Worker connection owned by the caller, who closes the Peer. Both sides publish explicit provide/expose methods; the library builds the v2 directory and requires batch reception before business calls are admitted.',
    purposeZh:
      '创建对称Worker连接，由调用方持有并负责 close 的独立 Peer。两端通过 provide/expose 显式发布方法，由库生成 v2 目录并要求批量帧接收；类型声明不会代替运行时鉴权。',
    quickStart:
      "import { fileURLToPath } from 'node:url'\nimport { createThreadPeer } from '@migaia/rpc/threads'\nimport {\n  createNodeThreadLauncher,\n  createNodeThreadChannelFactory\n} from '@migaia/rpc/threads/adapters/node'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\ntype IChildApi = { math: { double: (value: number) => number } }\nconst report = (error: unknown) => console.error(error)\nconst spawn = {\n  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },\n  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  launcher: createNodeThreadLauncher(),\n  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),\n  report\n}\nconst typedRemote = await createThreadPeer<IChildApi>({ spawn, report })\ntry {\n  console.log(await typedRemote.request('math.double', 21))\n} finally {\n  await typedRemote.close()\n}",
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
  'rpc:threads:createThreadPlugin': guide({
    purposeEn:
      'Creates a symmetric Worker connection owned by PluginHost and addressed through its thread outlet. Both sides publish explicit provide/expose methods; the library builds the v2 directory and requires batch reception before business calls are admitted.',
    purposeZh:
      '创建对称Worker连接，由 PluginHost 持有，通过 host.thread 出口调用。两端通过 provide/expose 显式发布方法，由库生成 v2 目录并要求批量帧接收；类型声明不会代替运行时鉴权。',
    quickStart:
      "import { fileURLToPath } from 'node:url'\nimport { createThreadPeer } from '@migaia/rpc/threads'\nimport {\n  createNodeThreadLauncher,\n  createNodeThreadChannelFactory\n} from '@migaia/rpc/threads/adapters/node'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\ntype IChildApi = { math: { double: (value: number) => number } }\nconst report = (error: unknown) => console.error(error)\nconst spawn = {\n  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },\n  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  launcher: createNodeThreadLauncher(),\n  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),\n  report\n}\nimport { defineHost } from '@migaia/plugin-host'\nimport { createThreadPlugin } from '@migaia/rpc/threads'\n\nconst worker = createThreadPlugin<IChildApi, Record<never, never>, 'worker'>({\n  name: 'worker',\n  spawn,\n  report\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof worker]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  await host.use(worker)\n  console.log(await host.thread!.request('worker', 'math.double', 21))\n} finally {\n  await host.dispose()\n}",
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
  'plugin-host:index:getPluginRuntimeIntegration': guide({
    purposeEn:
      'Reads the runtime integration port of a genuine Host-created install core. Adapter authors use its feature inventory and shared slots to connect a runtime outlet without copying Host registration or publication state.',
    purposeZh:
      '读取 Host 为本次安装创建的真实 core 所绑定的运行时集成端口。适配器作者通过其 Feature 清单和共享槽接入运行时出口，复用 Host 注册与发布状态，不能传入复制的结构对象。',
    quickStart:
      "import { definePlugin, getPluginRuntimeIntegration } from '@migaia/plugin-host'\n\nconst integrationPlugin = definePlugin('integration', (core) => {\n  const integration = getPluginRuntimeIntegration(core)\n  return { extension: { inspectService: () => integration.readFeatureOutputs('service') } }\n})",
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
      "import { definePlugin, isDefinedPlugin } from '@migaia/plugin-host'\n\nconst plugin = definePlugin('message', () => ({ extension: { greet: () => 'hello' } }))\nconsole.log(isDefinedPlugin(plugin)) // true\nconsole.log(isDefinedPlugin({ name: 'message' })) // false",
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
      "import { defineHost, definePlugin, isPluginHandleCurrent } from '@migaia/plugin-host'\n\nconst host = defineHost()\ntry {\n  const [handle] = await host.use(definePlugin('service', () => ({ extension: { read: () => 42 } })))\n  console.log(isPluginHandleCurrent(handle)) // true\n  await host.unUse('service')\n  console.log(isPluginHandleCurrent(handle)) // false\n} finally {\n  await host.dispose()\n}",
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
const view = await host.use(counter)
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

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({ reportCacheSize: (size: number) => console.log(size) })
})
const app = await host.use(productCache)

app.extensions.clearProductCache()
await app.config.update('product-cache', () => ({ ttlMs: 60_000 }))
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
    greet(name) {
      const message = \`Hello, \${name}\`
      core.audit(message)
      return message
    }
  })
)

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({ audit: (message: string) => console.log(message) })
})
const app = await host.use(greeting)

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
    greet(name) {
      const message = \`Hello, \${name}\`
      core.audit(message)
      return message
    }
  })
)

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },
  domainCore: () => ({ audit: (message: string) => console.log(message) })
})
const app = await host.use(greeting)

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
  'plugin-host:index:defineHost': guide({
    purposeEn:
      'Creates a frozen functional Host handle over the canonical PluginHost engine. The domainCore callback replaces subclassing, while use() keeps plugin batches atomic and dispose() remains the single terminal cleanup authority.',
    purposeZh:
      '基于规范 PluginHost 引擎创建冻结的函数式 Host handle。domainCore 回调替代继承；use() 仍保证插件批次原子提交，dispose() 仍是唯一终态清理入口。',
    quickStart:
      "import { definePlugin, defineHost } from '@migaia/plugin-host'\n\nconst greeting = definePlugin('greeting', (core: { prefix: string }) => ({\n  install: () => ({\n    greet: (name: string) => `${core.prefix}, ${name}`\n  })\n}))\n\nconst host = defineHost({\n  host: { execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } },\n  domainCore: () => ({ prefix: 'Hello' })\n})\nconst app = await host.use(greeting)\n\nconsole.log(app.extensions.greet('Ada'))\nawait host.dispose()",
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
        quickStart: `import { ${name}, defineHost } from '@migaia/plugin-host'\n\nconst stage = (value: number, next: (value: number) => number) => next(value + 1)\nconst adaptedStage = ${name}(stage${needsViolationHandler ? ', (violation) => console.warn(violation)' : ''})\nconst host = defineHost<Record<string, never>, number>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\nconst installedHost = host.${installMethod}(adaptedStage)\nconsole.log(installedHost === host) // true\nawait host.dispose()`,
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
      "import { invokeCaptured } from '@migaia/plugin-host'\n\nconst counter = { value: 1, add(step: number) { this.value += step; return this.value } }\nconst result = invokeCaptured<number>(counter.add, counter, [2])\nconsole.log(result, counter.value) // 3 3：receiver 和参数都被保留，调用结果可直接用于后续业务判断。",
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
      "import { createRegistrationView, PluginHostError, PluginHostErrorCode } from '@migaia/plugin-host'\n\nexport async function searchRegisteredPlugin(\n  receipt: Parameters<typeof createRegistrationView>[0],\n  refreshRegistration: () => void\n) {\n  try {\n    const view = createRegistrationView(receipt)\n    return await view.extensions.search('migaia')\n  } catch (error) {\n    if (error instanceof PluginHostError && error.code === PluginHostErrorCode.viewRevoked) {\n      refreshRegistration()\n    }\n    throw error\n  }\n}",
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
      "import { createView } from '@migaia/plugin-host/composition'\n\nexport async function searchRegistration(searchRegistration: Parameters<typeof createView>[0]) {\n  const view = createView(searchRegistration)\n  return view.extensions.search('migaia')\n}",
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
      "import { isManagedHost, openComposition } from '@migaia/plugin-host/composition'\n\nexport function currentManagedView(target: unknown) {\n  if (!isManagedHost(target)) return undefined\n  return openComposition(target as object).getCurrentView()\n}",
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
      "import { registerVersion, setVersion, readVersion } from '@migaia/reactive/node-internals'\n\nconst node = {}\nregisterVersion(node, 0)\nsetVersion(node, 1)\nconsole.log(readVersion(node))",
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
      "import { brandOwnedValue, assertNoForeignOwnershipBrand } from '@migaia/reactive/copy-check'\n\nconst managedNode = {}\nbrandOwnedValue(managedNode)\nassertNoForeignOwnershipBrand(managedNode)\nconsole.log('ownership brand admitted')",
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
      "import { assertNoForeignOwnershipBrand, brandOwnedValue } from '@migaia/reactive/copy-check'\n\nconst candidate = {}\nbrandOwnedValue(candidate)\nassertNoForeignOwnershipBrand(candidate)\nconsole.log('local managed value admitted')",
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
      "import { assertSingleRuntimeCopy } from '@migaia/reactive/copy-check'\n\nassertSingleRuntimeCopy() // call once during application startup\nconsole.log('single runtime copy admitted')",
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
      "import { resetRuntimeCopiesForTest, runtimeCopyCount } from '@migaia/reactive/copy-check'\n\n// Repository test teardown only; never reset a live application registry.\nresetRuntimeCopiesForTest()\nconsole.log(runtimeCopyCount()) // 0",
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
      "import { registerInternals, internalsOf } from '@migaia/reactive/internals'\n\n/** Called once by an authorized Runtime constructor with its complete owned internals. */\nexport function registerKernel(...args: Parameters<typeof registerInternals>) {\n  registerInternals(...args)\n  console.log(internalsOf(args[0]) === args[1])\n}",
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
      "import { createRuntime } from '@migaia/reactive'\nimport { internalsOf } from '@migaia/reactive/internals'\n\n// Authorized kernel integrations only; ordinary features use public Runtime methods.\nconst runtime = createRuntime()\nconst internals = internalsOf(runtime)\nconsole.log(internals.now())",
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
      "import { createRuntime } from '@migaia/reactive'\nimport { assertOwnedBy } from '@migaia/reactive/ownership'\n\nconst runtime = createRuntime()\nconst node = runtime.signal(1)\nassertOwnedBy(node, runtime, 'owned signal')\nconsole.log(node.value)\nnode.dispose()",
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
      "import { createRuntime } from '@migaia/reactive'\nimport { assertReactiveOwnedBy } from '@migaia/reactive/ownership'\n\nconst runtime = createRuntime()\nconst node = runtime.signal(1)\nassertReactiveOwnedBy(node, runtime, 'owned signal')\nconsole.log(node.value)\nnode.dispose()",
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
