import type { IApiGuide, IApiGuideExample, IApiOptionGuide, IGuideLocale } from './api-guides.js'

type IRpcGuideInput = {
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart?: string
  readonly examplesEn?: readonly IApiGuideExample[]
  readonly examplesZh?: readonly IApiGuideExample[]
  readonly options?: readonly IApiOptionGuide[]
  readonly useEn: readonly string[]
  readonly useZh: readonly string[]
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
}

/** Builds one maintained bilingual RPC guide without cross-locale fallback. */
function guide(input: IRpcGuideInput): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: input.purposeEn,
      quickStart: input.quickStart,
      examples: input.examplesEn,
      scenarios:
        input.useEn.length >= 2
          ? input.useEn
          : [
              ...input.useEn,
              'The caller needs this behavior to be explicit, testable, and released with the endpoint.'
            ],
      avoidWhen:
        input.avoidEn.length >= 2
          ? input.avoidEn
          : [
              ...input.avoidEn,
              'A narrower public boundary already satisfies the required behavior.'
            ],
      options: input.options ?? []
    },
    zh: {
      purpose: input.purposeZh,
      quickStart: input.quickStart,
      examples: input.examplesZh,
      scenarios:
        input.useZh.length >= 2
          ? input.useZh
          : [...input.useZh, '调用方需要明确测试该行为，并在 endpoint 销毁时一起释放相关资源。'],
      avoidWhen:
        input.avoidZh.length >= 2
          ? input.avoidZh
          : [...input.avoidZh, '更窄的 public boundary 已经满足所需行为。'],
      options: input.options ?? []
    }
  }
}

/** Creates a guide for an endpoint preset with an explicit public capability boundary. */
function endpointGuide(input: {
  readonly name: string
  readonly importPath: string
  readonly surfaceEn: string
  readonly surfaceZh: string
  readonly useEn: string
  readonly useZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `Creates an endpoint that can ${input.surfaceEn}. Setup is all-or-nothing: if one installation step fails, RPC removes the listeners and resources installed by earlier steps.`,
    purposeZh: `创建可${input.surfaceZh}的端点。初始化会整体成功或整体失败；如果中途出错，RPC 会清理此前已经安装的监听器和资源。`,
    quickStart: `import { ${input.name} } from '${input.importPath}'
import { connect, createEndpoint as createServiceEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [transport, serviceTransport] = createMemoryTransportPair()
const service = await createServiceEndpoint({
  id: 'service', transport: serviceTransport,
  middlewares: [connect({ transport: serviceTransport })] as const
})
service.provide('double', (context) => context.success(Number(context.data) * 2))
const endpoint = await ${input.name}({
  id: 'client', transport,
  middlewares: [connect({ transport })] as const
})
try {
  console.log(await endpoint.send<number>('service', 'double', 21)) // 42
} finally {
  await Promise.all([endpoint.dispose(), service.dispose()])
}`,
    useEn: [
      input.useEn,
      'Use it when endpoint setup must clean up partially installed listeners after cancellation or failure.'
    ],
    useZh: [input.useZh, '当初始化被取消或失败时，需要自动清理已经安装的监听器和连接资源。'],
    avoidEn: [
      'You only send one-way notifications and never wait for a returned result; use the host messaging API directly.',
      'The preset includes operations the application does not use; choose a client/provider preset or compose only the needed features.'
    ],
    avoidZh: [
      '只发送单向通知且从不等待返回结果；这时直接使用宿主环境的消息 API 更清楚。',
      '该预设包含应用不会使用的操作；应改用 client/provider 预设，或只组合需要的功能。'
    ]
  })
}

/** Builds real-host examples while preserving the middleware configuration owned by the page. */
function middlewareTransportExamples(
  name: string,
  code: string,
  locale: IGuideLocale
): readonly IApiGuideExample[] {
  /** Connect is the transport authority; every other middleware is installed alongside it. */
  const middlewares =
    name === 'connect' ? 'connect({ transport })' : `connect({ transport }),\n    ${code}`
  /** Connect pages already import their own symbol through the shared transport-authority import. */
  const imports =
    name === 'connect' ? 'connect, createEndpoint' : `${name}, connect, createEndpoint`
  /** Scenario descriptions explain the host boundary rather than repeating adapter syntax. */
  const descriptions =
    locale === 'zh'
      ? {
          iframe: `父页面通过 Window transport 调用 iframe；${name} 会参与这条跨窗口链路上的每次匹配操作。`,
          worker: `页面通过 Dedicated Worker transport 调用后台宿主；${name} 的规则不会因线程边界而改变。`,
          tabs: `两个同源 Tab 通过 BroadcastChannel 通信；${name} 在各自 endpoint 上使用相同配置。`,
          serviceWorker: `受控页面通过 ServiceWorker transport 调用离线宿主；${name} 继续约束跨进程消息。`
        }
      : {
          iframe: `A parent page calls an iframe through Window transport; ${name} participates in every matching cross-window operation.`,
          worker: `A page calls a background host through Dedicated Worker transport; ${name} keeps the same policy across the thread boundary.`,
          tabs: `Two same-origin tabs communicate through BroadcastChannel and install the same ${name} configuration.`,
          serviceWorker: `A controlled page calls its offline host through ServiceWorker transport while ${name} still governs the cross-process messages.`
        }
  return [
    {
      id: 'iframe-transport',
      title: locale === 'zh' ? '父页面调用 iframe' : 'Parent page to iframe',
      description: descriptions.iframe,
      code: `import { ${imports} } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const frame = document.querySelector<HTMLIFrameElement>('#embedded-app')!
const transport = createWindowMessageTransport({
  target: frame.contentWindow!, receiver: window, targetOrigin: new URL(frame.src).origin
})
const endpoint = await createEndpoint({
  id: 'parent-page', targetIds: ['embedded-app'], transport,
  middlewares: [${middlewares}] as const
})`
    },
    {
      id: 'worker-transport',
      title: locale === 'zh' ? '页面调用 Dedicated Worker' : 'Page to Dedicated Worker',
      description: descriptions.worker,
      code: `import { ${imports} } from '@migaia/rpc-core'
import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'

const worker = new Worker(new URL('./task.worker.ts', import.meta.url), { type: 'module' })
const transport = createWebWorkerTransport(worker, { peerId: 'task-worker' })
const endpoint = await createEndpoint({
  id: 'page', targetIds: ['task-worker'], transport,
  middlewares: [${middlewares}] as const
})`
    },
    {
      id: 'broadcast-transport',
      title:
        locale === 'zh'
          ? '同源 Tab 通过 BroadcastChannel 通信'
          : 'Same-origin tabs through BroadcastChannel',
      description: descriptions.tabs,
      code: `import { ${imports} } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const channel = new BroadcastChannel('application-rpc-v1')
const transport = createBroadcastChannelTransport(channel)
const endpoint = await createEndpoint({
  id: crypto.randomUUID(), targetIds: ['service-tab'], transport,
  middlewares: [${middlewares}] as const
})`
    },
    {
      id: 'service-worker-transport',
      title: locale === 'zh' ? '页面调用 Service Worker' : 'Page to Service Worker',
      description: descriptions.serviceWorker,
      code: `import { ${imports} } from '@migaia/rpc-core'
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

await navigator.serviceWorker.ready
const controller = navigator.serviceWorker.controller
if (!controller) throw new DOMException('Service Worker is not controlling this page', 'InvalidStateError')
const transport = createServiceWorkerTransport({
  target: controller, receiver: navigator.serviceWorker, peerId: 'service-worker'
})
const endpoint = await createEndpoint({
  id: crypto.randomUUID(), targetIds: ['service-worker'], transport,
  middlewares: [${middlewares}] as const
})`
    }
  ]
}

/** Adds ping-specific operational patterns after the shared transport examples. */
function pingUsageExamples(locale: IGuideLocale): readonly IApiGuideExample[] {
  /** Localized titles and explanations keep operational decisions explicit for each reader. */
  const copy =
    locale === 'zh'
      ? {
          preflight: [
            '发送昂贵任务前探活',
            '对端无响应时直接走降级路径，避免先发送大任务再等待超时。'
          ],
          fanout: [
            '同时检查多个目标',
            'pingAll() 分别返回成功与失败目标，适合控制台、分片服务池和多 Worker 状态页。'
          ],
          cancel: [
            '页面卸载时取消探测',
            '调用方持有 AbortController；组件或任务结束时取消仍在等待的 ping。'
          ],
          heartbeat: [
            '有边界的周期健康检查',
            '每轮探测都有 deadline，停止监控时同时清理 timer，避免后台泄漏。'
          ]
        }
      : {
          preflight: [
            'Probe before expensive work',
            'Use a fallback immediately when the peer does not answer instead of sending expensive work first.'
          ],
          fanout: [
            'Check several targets together',
            'pingAll() separates fulfilled and rejected targets for dashboards, service pools, and multi-Worker status.'
          ],
          cancel: [
            'Cancel a probe when its owner ends',
            'The caller owns an AbortController and cancels a pending ping when the component or task finishes.'
          ],
          heartbeat: [
            'Run a bounded periodic health check',
            'Every probe has a deadline and stopping the monitor also clears its timer.'
          ]
        }
  /** Cleanup prose belongs to the code sample because timer ownership is part of the example. */
  const cleanupComment =
    locale === 'zh'
      ? '// 组件卸载、页面关闭或 owner dispose 时停止周期任务。'
      : '// Stop the interval when the component, page, or owning scope is disposed.'
  return [
    {
      id: 'preflight-liveness',
      title: copy.preflight[0],
      description: copy.preflight[1],
      code: `import type { IRpcEndpoint } from '@migaia/rpc-core'

type IPreviewDocument = { pages: number }

function renderPreviewLocally(document: IPreviewDocument) {
  console.log('local preview', document.pages)
}

export async function renderPreview(client: IRpcEndpoint, document: IPreviewDocument) {
  const alive = await client.ping('image-worker', undefined, { timeoutMs: 1_000 })
  if (alive) {
    return client.send('image-worker', 'renderLargePreview', document)
  }
  renderPreviewLocally(document)
}`
    },
    {
      id: 'fanout-liveness',
      title: copy.fanout[0],
      description: copy.fanout[1],
      code: `type IHealth = {
  fulfilled: Record<string, boolean>
  rejected: Record<string, unknown>
}
type ILivenessDashboard = { pingAll(): Promise<IHealth> }

export async function refreshPeerStatus(
  dashboard: ILivenessDashboard,
  updatePeerStatus: (targetId: string, status: 'online' | 'offline') => void,
  reportPeerFailure: (targetId: string, error: unknown) => void
) {
  const health = await dashboard.pingAll()
  for (const [targetId, alive] of Object.entries(health.fulfilled)) {
    updatePeerStatus(targetId, alive ? 'online' : 'offline')
  }
  for (const [targetId, error] of Object.entries(health.rejected)) {
    reportPeerFailure(targetId, error)
  }
}`
    },
    {
      id: 'cancel-liveness',
      title: copy.cancel[0],
      description: copy.cancel[1],
      code: `import type { IRpcEndpoint } from '@migaia/rpc-core'

export async function checkWorkerBeforePageExit(client: IRpcEndpoint) {
  const controller = new AbortController()
  const pending = client.ping('service-worker', undefined, {
    timeoutMs: 5_000,
    signal: controller.signal
  })

  // 页面离开时取消还未完成的探活请求，避免回调继续更新已销毁的 UI。
  window.addEventListener('pagehide', () => controller.abort(), { once: true })
  try {
    return await pending
  } catch (error) {
    if (controller.signal.aborted) return false
    throw error
  }
}`
    },
    {
      id: 'periodic-liveness',
      title: copy.heartbeat[0],
      description: copy.heartbeat[1],
      code: `import type { IRpcEndpoint } from '@migaia/rpc-core'

type IConnectionState = 'online' | 'reconnecting'

export function startConnectionMonitor(
  client: IRpcEndpoint,
  setConnectionBadge: (state: IConnectionState) => void
) {
  const timer = window.setInterval(async () => {
    const alive = await client.ping('sync-service', undefined, { timeoutMs: 1_500 })
    setConnectionBadge(alive ? 'online' : 'reconnecting')
  }, 10_000)

  ${cleanupComment}
  return () => window.clearInterval(timer)
}`
    }
  ]
}

/** Creates a guide for a first-party middleware configuration token. */
function middlewareGuide(input: {
  readonly name: string
  readonly purposeEn: string
  readonly purposeZh: string
  readonly code: string
  readonly setup?: string
  readonly useEn: string
  readonly useZh: string
  readonly avoidEn: string
  readonly avoidZh: string
  readonly examplesEn?: readonly IApiGuideExample[]
  readonly examplesZh?: readonly IApiGuideExample[]
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  /** Connect itself supplies the transport authority; every other policy is installed beside it. */
  const clientMiddlewares =
    input.name === 'connect'
      ? 'connect({ transport: clientTransport })'
      : `connect({ transport: clientTransport }),\n      ${input.code}`
  /** Each endpoint receives its own middleware instance and immutable configuration snapshot. */
  const serviceMiddlewares =
    input.name === 'connect'
      ? 'connect({ transport: serviceTransport })'
      : `connect({ transport: serviceTransport }),\n      ${input.code}`
  /** Avoid importing connect twice on the connect middleware page. */
  const imports =
    input.name === 'connect' ? 'connect, createEndpoint' : `${input.name}, connect, createEndpoint`
  return guide({
    purposeEn: `${input.purposeEn} Once installed into the Host, the policy participates in every matching endpoint operation. Endpoint Features expose methods such as send(), provide(), or ping(); the middleware changes how those operations are connected, validated, protected, observed, or bounded rather than adding an unrelated business API.`,
    purposeZh: `${input.purposeZh} 安装到 Host 后，这项策略会参与每一次匹配的 endpoint 操作。send()、provide()、ping() 等可调用能力由 endpoint 的 Feature 提供；middleware 负责改变这些操作的连接、校验、保护、观测或边界规则，并不会凭空增加一套无关的业务 API。`,
    examplesEn: input.examplesEn ?? middlewareTransportExamples(input.name, input.code, 'en'),
    examplesZh: input.examplesZh ?? middlewareTransportExamples(input.name, input.code, 'zh'),
    quickStart: `import { ${imports} } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

${input.setup ? `${input.setup}\n\n` : ''}// 用内存通道模拟真实的客户端与服务宿主；浏览器中可替换成 Worker、MessagePort 等 adapter。
const [clientTransport, serviceTransport] = createMemoryTransportPair()

// 服务宿主安装 transport 与本页策略，再公开一个可被远端调用的方法。
const service = await createEndpoint({
  id: 'catalog-service',
  transport: serviceTransport,
  middlewares: [
    ${serviceMiddlewares}
  ] as const
})
service.provide('findProduct', ({ data, success }) => {
  const productId = String(data)
  success({ id: productId, available: true })
})

// 客户端宿主安装同一类策略；策略随后自动参与 send() 的完整收发链路。
const client = await createEndpoint({
  id: 'storefront',
  targetIds: ['catalog-service'],
  transport: clientTransport,
  middlewares: [
    ${clientMiddlewares}
  ] as const
})

try {
  const product = await client.send<{ id: string; available: boolean }>(
    'catalog-service',
    'findProduct',
    'sku-42'
  )
  console.log(product.available)
} finally {
  // dispose() 同时撤销监听、插件 attachment，并按 custody 规则释放 transport。
  await Promise.all([client.dispose(), service.dispose()])
}`,
    useEn: [
      input.useEn,
      'The policy must be installed atomically with the endpoint and released by endpoint.dispose().'
    ],
    useZh: [input.useZh, '该策略需要随 endpoint 原子安装，并由 endpoint.dispose() 统一释放。'],
    avoidEn: [input.avoidEn, 'Using middleware as a substitute for selecting an endpoint Feature.'],
    avoidZh: [input.avoidZh, '把 middleware 当成选择 endpoint Feature 的替代品。']
  })
}

/** Creates a guide for a host-specific transport adapter. */
function transportGuide(input: {
  readonly name: string
  readonly importPath: string
  readonly expression: string
  readonly boundaryEn: string
  readonly boundaryZh: string
  readonly cautionEn: string
  readonly cautionZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `Wraps ${input.boundaryEn} as the send/receive connection expected by a RPC endpoint. The adapter also records how the two sides are connected, how messages are encoded, and which side must close the host resource.`,
    purposeZh: `把${input.boundaryZh}包装成 RPC endpoint 所需的消息收发连接。适配器还会记录两端如何连接、消息如何编码，以及由哪一端负责关闭宿主资源。`,
    quickStart: `import { ${input.name} } from '${input.importPath}'\nimport { connect, createEndpoint } from '@migaia/rpc-core'\n\nconst transport = ${input.expression}\nconst endpoint = await createEndpoint({\n  id: 'local',\n  transport,\n  middlewares: [connect({ transport })]\n})\nendpoint.provide('health', ({ success }) => success({ ok: true }))\ntry {\n  console.log('health provider ready:', typeof endpoint.provide)\n} finally {\n  await endpoint.dispose()\n}`,
    useEn: [
      `The two endpoints communicate through ${input.boundaryEn}.`,
      'Use the adapter when RPC should register the message listener and remove it when the endpoint is disposed.'
    ],
    useZh: [
      `两个 endpoint 需要通过${input.boundaryZh}通信。`,
      '需要由 RPC 安装消息监听器，并在 endpoint 销毁时自动移除监听器。'
    ],
    avoidEn: [
      input.cautionEn,
      'Do not manually forward internal message objects; doing so skips connection validation and cleanup.'
    ],
    avoidZh: [input.cautionZh, '不要手动转发 RPC 内部消息对象，否则会跳过连接校验和自动清理。']
  })
}

/** Describes a public diagnostic type without exposing its owner-only runtime constructor. */
function errorGuide(input: {
  readonly name: string
  readonly conditionEn: string
  readonly conditionZh: string
  readonly distinctionEn: string
  readonly distinctionZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `${input.name} describes ${input.conditionEn}. Import it as a type to read an actual owner's failure. Source/code and cause are diagnostics; they do not prove execution, authorize retry or change Core operation state.`,
    purposeZh: `${input.name} 描述${input.conditionZh}。只作 type 导入，读取实际 owner 已产生的失败。source/code 与 cause 属于诊断，不能证明执行结果、授予重试或改变 Core 操作状态。`,
    quickStart: `import type { ${input.name} } from '@migaia/rpc-core'\n\n/** Read a failure already raised by its owner; no constructor is imported. */\nexport function reportFailure(error: ${input.name}) {\n  console.error(error.source, error.code, error.cause)\n}\n// For unknown values use the public Core family guards before reading diagnostics.\n// Their result is not proof that Core minted the error or that the call may be repeated.`,
    useEn: [
      input.distinctionEn,
      'Read cause and cleanup evidence at the original error boundary without replacing the error.'
    ],
    useZh: [input.distinctionZh, '在原错误边界读取 cause 与 cleanup 证据，不替换原错误。'],
    avoidEn: [
      'Importing this type as a value for construction or instanceof checks.',
      'Using public diagnostic fields to authorize retry, cancellation, terminal or close decisions.'
    ],
    avoidZh: [
      '把此 type 作为 value 导入进行构造或 instanceof 判断。',
      '用公开诊断字段授予重试、取消、终止或关闭决定。'
    ]
  })
}

/** Creates a guide for a canonical wire or runtime discriminant object. */
function constantGuide(input: {
  readonly name: string
  readonly roleEn: string
  readonly roleZh: string
  readonly member: string
  readonly value: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `Provides the canonical ${input.roleEn}. Use its members instead of repeating wire-visible or cross-module string literals.`,
    purposeZh: `提供规范的${input.roleZh}。应引用其 member，不要重复书写 wire-visible 或 cross-module string literal。`,
    quickStart: `import { ${input.name} } from '@migaia/rpc-core'\n\nconst value = ${input.name}.${input.member}\nif (value === ${input.name}.${input.member}) {\n  console.log(value) // ${input.value}\n}\n// Business code reads the same canonical member instead of copying the wire-visible string.`,
    useEn: [
      'Code must produce, compare, log, or test the corresponding stable discriminant.',
      'A custom adapter or diagnostic consumer interoperates with RPC metadata.'
    ],
    useZh: [
      '代码需要生成、比较、记录或测试对应的 stable discriminant。',
      'custom adapter 或 diagnostic consumer 需要与 RPC metadata 互操作。'
    ],
    avoidEn: [
      'Using the object as mutable configuration.',
      'Inventing a new member that the protocol or runtime does not recognize.'
    ],
    avoidZh: [
      '把该 object 当作 mutable configuration。',
      '自行发明 protocol 或 runtime 不识别的新 member。'
    ]
  })
}

/** Copyable chunk examples for the preset/composed distinction and browser host boundaries. */
const chunkScenarioCode = {
  preset: `import { chunk, connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [clientTransport, serviceTransport] = createMemoryTransportPair()
const policy = { chunkSize: 64 * 1024, maxMessageBytes: 8 * 1024 * 1024 }

// createEndpoint 是完整 preset：自动拥有 send、provide、discovery、ping 与分片帧处理能力。
const service = await createEndpoint({
  id: 'storage',
  transport: serviceTransport,
  middlewares: [connect({ transport: serviceTransport }), chunk(policy)] as const
})
service.provide('save', ({ data, success }) => success(String(data).length))

const client = await createEndpoint({
  id: 'uploader',
  targetIds: ['storage'],
  transport: clientTransport,
  middlewares: [connect({ transport: clientTransport }), chunk(policy)] as const
})

try {
  const storedBytes = await client.send<number>('storage', 'save', 'x'.repeat(256_000))
  console.log(storedBytes)
} finally {
  await Promise.all([client.dispose(), service.dispose()])
}`,
  iframe: `// parent.ts：父页面创建调用端，targetOrigin 必须固定为 iframe 的真实 origin。
import { chunk, connect, createEndpoint } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const frame = document.querySelector<HTMLIFrameElement>('#report-frame')
if (!frame?.contentWindow) throw new Error('report iframe is unavailable')
const parentTransport = createWindowMessageTransport({
  target: frame.contentWindow,
  receiver: window,
  targetOrigin: location.origin
})
const parentEndpoint = await createEndpoint({
  id: 'dashboard',
  targetIds: ['report-frame'],
  transport: parentTransport,
  middlewares: [connect({ transport: parentTransport }), chunk({ chunkSize: 48 * 1024 })] as const
})
const reportModel = JSON.stringify({ sections: ['sales', 'inventory'], rows: 20_000 })
const report = await parentEndpoint.send<string>('report-frame', 'renderReport', reportModel)
console.log(report.length)
window.addEventListener('pagehide', () => void parentEndpoint.dispose(), { once: true })

// iframe.ts：iframe 内创建服务端；source proof 会拒绝其他 Window 冒充父页面。
const iframeTransport = createWindowMessageTransport({
  target: window.parent,
  receiver: window,
  targetOrigin: location.origin
})
const iframeEndpoint = await createEndpoint({
  id: 'report-frame',
  transport: iframeTransport,
  middlewares: [connect({ transport: iframeTransport }), chunk({ chunkSize: 48 * 1024 })] as const
})
const render = (value: unknown) => '<main>' + String(value) + '</main>'
iframeEndpoint.provide('renderReport', ({ data, success }) => success(render(data)))
window.addEventListener('pagehide', () => void iframeEndpoint.dispose(), { once: true })`,
  tabs: `// 两个同源 Tab 运行同一入口；URL 中的 role 决定当前 Tab 是服务端还是调用端。
import { chunk, connect, createEndpoint } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const role = new URL(location.href).searchParams.get('role')
const endpointId = role === 'service' ? 'document-owner' : 'document-viewer'
const channel = new BroadcastChannel('document-sync')
const transport = createBroadcastChannelTransport(channel)
const endpoint = await createEndpoint({
  id: endpointId,
  targetIds: ['document-owner'],
  transport,
  middlewares: [
    connect({ transport }),
    chunk({ chunkSize: 48 * 1024, maxBufferedBytes: 12 * 1024 * 1024 })
  ] as const
})
const loadLargeDocument = () => JSON.stringify({ body: 'x'.repeat(256_000) })
const renderDocument = (snapshot: string) => console.log(snapshot.length)

if (role === 'service') {
  endpoint.provide('readSnapshot', ({ success }) => success(loadLargeDocument()))
} else {
  const snapshot = await endpoint.send<string>('document-owner', 'readSnapshot', undefined)
  renderDocument(snapshot)
}

window.addEventListener('pagehide', () => void endpoint.dispose(), { once: true })`,
  worker: `// main.ts：页面端持有 Worker，并把大任务交给 Worker endpoint。
import { chunk, connect, createEndpoint } from '@migaia/rpc-core'
import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'

const worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' })
const pageTransport = createWebWorkerTransport(worker, { peerId: 'image-worker' })
const pageEndpoint = await createEndpoint({
  id: 'editor',
  targetIds: ['image-worker'],
  transport: pageTransport,
  middlewares: [connect({ transport: pageTransport }), chunk({ chunkSize: 64 * 1024 })] as const
})
const sourceDocument = JSON.stringify({ body: 'x'.repeat(256_000) })
const result = await pageEndpoint.send<string>('image-worker', 'buildPreview', sourceDocument)
console.log(result)
window.addEventListener('pagehide', () => {
  void pageEndpoint.dispose().finally(() => worker.terminate())
}, { once: true })

// image-worker.ts：Worker 全局作用域是另一端的消息宿主。
const workerTransport = createWebWorkerTransport(self, { peerId: 'editor' })
const workerEndpoint = await createEndpoint({
  id: 'image-worker',
  transport: workerTransport,
  middlewares: [connect({ transport: workerTransport }), chunk({ chunkSize: 64 * 1024 })] as const
})
const renderPreview = async (source: string) => 'preview:' + source.length
workerEndpoint.provide('buildPreview', async ({ data, success }) => {
  success(await renderPreview(String(data)))
})`
} as const

/** Contract examples prove that the same middleware policy works across real host boundaries. */
const contractTransportCode = {
  iframe: `// parent.ts：父页面通过 Window transport 调用 iframe。
import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const frame = document.querySelector<HTMLIFrameElement>('#billing')!
const transport = createWindowMessageTransport({
  target: frame.contentWindow!,
  receiver: window,
  targetOrigin: new URL(frame.src).origin
})
const billing = await createEndpoint({
  id: 'checkout',
  targetIds: ['billing-frame'],
  transport,
  middlewares: [
    connect({ transport }),
    contract({ version: '1', schemas: {
      calculateTotal: { params: { parse: (value) => value }, result: { parse: Number } }
    } })
  ] as const
})
const total = await billing.send<number>('billing-frame', 'calculateTotal', { prices: [12, 30] })`,
  worker: `// main.ts：页面通过 Dedicated Worker transport 调用后台计算宿主。
import { connect, contract, createEndpoint, timeout } from '@migaia/rpc-core'
import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'

const worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' })
const transport = createWebWorkerTransport(worker, { peerId: 'image-worker' })
const images = await createEndpoint({
  id: 'editor',
  targetIds: ['image-worker'],
  transport,
  middlewares: [
    connect({ transport }),
    contract({ version: '1', schemas: {
      resize: { params: { parse: (value) => value }, result: { parse: (value) => value } }
    } }),
    timeout({ timeoutMs: 30_000 })
  ] as const
})
const thumbnail = await images.send<Blob>('image-worker', 'resize', { file: new Blob(['demo']), width: 320 })`,
  tabs: `// client-tab.ts：同源 Tab 通过 BroadcastChannel 调用服务 Tab。
import { connect, contract, createEndpoint, timeout } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const channel = new BroadcastChannel('settings-v1')
const transport = createBroadcastChannelTransport(channel)
const settings = await createEndpoint({
  id: crypto.randomUUID(),
  targetIds: ['settings-service'],
  transport,
  middlewares: [
    connect({ transport }),
    contract({ version: '1', schemas: {
      readTheme: { params: { parse: (value) => value }, result: { parse: String } }
    } }),
    timeout({ timeoutMs: 2_000 })
  ] as const
})
const theme = await settings.send<string>('settings-service', 'readTheme', undefined)`,
  serviceWorker: `// page.ts：受控页面通过 ServiceWorker transport 调用离线缓存宿主。
import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

await navigator.serviceWorker.ready
const controller = navigator.serviceWorker.controller
if (!controller) throw new Error('Reload once so the ServiceWorker controls this page')
const transport = createServiceWorkerTransport({
  target: controller,
  receiver: navigator.serviceWorker,
  peerId: 'service-worker'
})
const cache = await createEndpoint({
  id: crypto.randomUUID(),
  targetIds: ['service-worker'],
  transport,
  middlewares: [
    connect({ transport }),
    contract({ version: '1', schemas: {
      hasCache: { params: { parse: String }, result: { parse: Boolean } }
    } })
  ] as const
})
const cached = await cache.send<boolean>('service-worker', 'hasCache', '/catalog.json')`
} as const

/** Human-maintained RPC guides keyed by stable public route identity. */
const rpcCoreGuideEntries: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'rpc-core:features-discovery:createDiscoveryFeature': guide({
    purposeEn:
      'Adds the peer discovery and verified bindings to a composed endpoint through the original Feature dependency graph. It creates no socket by itself: the construction scope owns installation, shared dependencies, provider visibility and reverse cleanup after failure.',
    purposeZh:
      '为组合式 endpoint 增加目标发现与已验证绑定，通过原 Feature 依赖图进行装配。工厂本身不创建 socket，也不越过 transport/source 鉴权；construction scope 持有原依赖、原子安装、provider 可见性和失败时的逆序清理。业务仍通过实际 provide/send 能力调用，不能把 Feature 定义当作已安装的服务实例。',
    quickStart:
      "import { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createDiscoveryFeature } from '@migaia/rpc-core/features/discovery'\n\nfunction selectedFeatures() {\n  const chunks = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunks)\n  const provider = createProviderFeature(outbound)\n  const discovery = createDiscoveryFeature(outbound)\n  return { 'first-party-chunk': chunks, 'first-party-outbound': outbound, 'first-party-provider': provider, 'first-party-discovery': discovery }\n}\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint({ id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] }, selectedFeatures())\nconst client = await createComposedEndpoint({ id: 'client', transport: clientTransport, middlewares: [connect({ transport: clientTransport })] }, selectedFeatures())\nservice.provide('measure', (context) => context.success(String(context.data).length))\ntry {\n  console.log(await client.send<number>('service', 'measure', 'hello'))\n} finally {\n  await Promise.all([client.dispose(), service.dispose()])\n}",
    useEn: [
      'A custom endpoint needs this explicit capability together with its declared outbound/provider dependencies.',
      'The application must retain one shared identity, pending registry and cleanup scope while selecting its precise runtime surface.'
    ],
    useZh: [
      '自定义 endpoint 需要这项明确能力，以及它声明的 outbound/provider 依赖。',
      '应用需要保留同一个 identity、pending registry 与清理 scope，同时选择精确的运行时能力面。'
    ],
    avoidEn: [
      'Use the process/thread Peer or Plugin factories when they already supply the application boundary.',
      'Do not construct another receiver, replay ledger or provider queue beside the selected Feature graph.'
    ],
    avoidZh: [
      'process/thread Peer 或 Plugin 工厂已经满足业务边界时，不需要另行组合底层图。',
      '不要在选定 Feature 图旁另造接收器、重放账本或 provider 队列。'
    ],
    options: [
      {
        name: 'outboundCapability',
        description:
          'Original outbound Feature shared by discovery queries, verified peer bindings and subsequent calls; keep one canonical dependency.',
        whenToUse:
          'Pass the previously created outbound Feature when a composed endpoint needs discovery.'
      }
    ]
  }),
  'rpc-core:stream:createCanonicalChunkFeature': guide({
    purposeEn:
      'Adds the canonical physical reassembly dependency to a composed endpoint through the original Feature dependency graph. It creates no socket by itself: the construction scope owns installation, shared dependencies, provider visibility and reverse cleanup after failure.',
    purposeZh:
      '为组合式 endpoint 增加规范物理分片重组依赖，通过原 Feature 依赖图进行装配。工厂本身不创建 socket，也不越过 transport/source 鉴权；construction scope 持有原依赖、原子安装、provider 可见性和失败时的逆序清理。业务仍通过实际 provide/send 能力调用，不能把 Feature 定义当作已安装的服务实例。',
    quickStart:
      "import { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\n\nfunction selectedFeatures() {\n  const chunks = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunks)\n  const provider = createProviderFeature(outbound)\n  return { 'first-party-chunk': chunks, 'first-party-outbound': outbound, 'first-party-provider': provider }\n}\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint({ id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] }, selectedFeatures())\nconst client = await createComposedEndpoint({ id: 'client', transport: clientTransport, middlewares: [connect({ transport: clientTransport })] }, selectedFeatures())\nservice.provide('measure', (context) => context.success(String(context.data).length))\ntry {\n  console.log(await client.send<number>('service', 'measure', 'hello'))\n} finally {\n  await Promise.all([client.dispose(), service.dispose()])\n}",
    useEn: [
      'A custom endpoint needs this explicit capability together with its declared outbound/provider dependencies.',
      'The application must retain one shared identity, pending registry and cleanup scope while selecting its precise runtime surface.'
    ],
    useZh: [
      '自定义 endpoint 需要这项明确能力，以及它声明的 outbound/provider 依赖。',
      '应用需要保留同一个 identity、pending registry 与清理 scope，同时选择精确的运行时能力面。'
    ],
    avoidEn: [
      'Use the process/thread Peer or Plugin factories when they already supply the application boundary.',
      'Do not construct another receiver, replay ledger or provider queue beside the selected Feature graph.'
    ],
    avoidZh: [
      'process/thread Peer 或 Plugin 工厂已经满足业务边界时，不需要另行组合底层图。',
      '不要在选定 Feature 图旁另造接收器、重放账本或 provider 队列。'
    ]
  }),
  'rpc-core:index:createEndpoint': endpointGuide({
    name: 'createEndpoint',
    importPath: '@migaia/rpc-core',
    surfaceEn:
      'call remote methods, provide local methods, discover peers, send control messages, and transfer chunked payloads',
    surfaceZh: '调用远端方法、提供本地方法、发现对端、发送控制消息，并传输需要分片的大数据',
    useEn: 'Use the root preset only when one endpoint needs all five operations listed above.',
    useZh: '只有同一个 endpoint 确实需要上面五类操作时，才使用根入口的完整预设。'
  }),
  'rpc-core:full:createFullEndpoint': endpointGuide({
    name: 'createFullEndpoint',
    importPath: '@migaia/rpc-core/full',
    surfaceEn: 'the explicit full outbound, provider, discovery, control, and chunk surface',
    surfaceZh: '显式完整的 outbound、provider、discovery、control 与 chunk surface',
    useEn: 'The full preset is intentional and the import should make that choice visible.',
    useZh: '明确选择 full preset，并希望 import 直接表达该意图。'
  }),
  'rpc-core:client:createClientEndpoint': endpointGuide({
    name: 'createClientEndpoint',
    importPath: '@migaia/rpc-core/client',
    surfaceEn: 'kernel and outbound call capabilities only',
    surfaceZh: '仅 kernel 与 outbound call capability',
    useEn: 'This endpoint only calls or dispatches to remote providers.',
    useZh: '该 endpoint 只调用远端 provider 或发送单向 dispatch。'
  }),
  'rpc-core:provider:createProviderEndpoint': endpointGuide({
    name: 'createProviderEndpoint',
    importPath: '@migaia/rpc-core/provider',
    surfaceEn: 'outbound calls plus provider registration',
    surfaceZh: 'outbound call 与 provider registration',
    useEn: 'This endpoint exposes methods and may also call its peer.',
    useZh: '该 endpoint 需要暴露 method，并且也可能回调 peer。'
  }),
  'rpc-core:composed:createComposedEndpoint': guide({
    purposeEn:
      'Builds the smallest endpoint from an explicit Feature root record. Private Feature dependencies are installed and deduplicated without silently widening the public root surface.',
    purposeZh:
      '从显式、原生 Feature root record 构造最小 endpoint。私有 Feature dependency 会被安装并去重，但不会静默扩大 public root surface。',
    quickStart:
      "import { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\n\nconst [transport] = createMemoryTransportPair()\nconst chunks = createCanonicalChunkFeature()\nconst outbound = createOutboundFeature(chunks)\nconst endpoint = await createComposedEndpoint(\n  { id: 'client', transport, middlewares: [connect({ transport })] },\n  { 'first-party-outbound': outbound }\n)\n\ntry {\n  console.log('outbound capability installed:', typeof endpoint.send)\n} finally {\n  await endpoint.dispose()\n}",
    useEn: [
      'Bundle custody or least-authority design requires an exact capability surface.',
      'A custom endpoint combines only selected first-party Features.'
    ],
    useZh: [
      'bundle custody 或 least-authority design 需要精确 capability surface。',
      'custom endpoint 只组合选定的 first-party Feature。'
    ],
    avoidEn: [
      'The complete preset is genuinely required.',
      'Passing an retired iterable roots or duplicated owners.'
    ],
    avoidZh: ['确实需要 complete preset。', '传入旧 iterable roots 或重复 Feature owner。']
  }),
  'rpc-core:index:defineFeature': guide({
    purposeEn:
      'Defines a reusable RPC Feature that contributes capabilities to an endpoint without installing an uncontrolled parallel host.',
    purposeZh:
      '定义可复用的 RPC Feature，为 endpoint 增加明确的 capability surface，同时不建立失控的平行 host。Feature factory 在 endpoint 安装时才执行，返回的对象就是调用方随后能够使用的能力面；数据通常从 transport 进入，由已有 Feature 处理后，再通过这个 surface 暴露给业务代码。Feature 也可以通过 dependencies 声明必须先安装的前置能力。',
    quickStart:
      "import { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { connect, defineFeature } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst audit = defineFeature(() => {\n  let received = 0\n  return {\n    recordMessage: (message: string) => {\n      received += 1\n      console.log('received:', message)\n    },\n    receivedCount: () => received\n  }\n})\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint(\n  { id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] },\n  { audit }\n)\ntry {\n  const message = 'order-created'\n  service.recordMessage(message) // 输入数据进入业务能力；Feature 内部累计处理次数。\n  console.log(service.receivedCount()) // 1：返回值就是 endpoint 安装 audit 后获得的能力面。\n} finally {\n  await service.dispose()\n}",
    useEn: [
      'A feature is reused across several explicitly composed endpoints.',
      'Business data needs a narrow, typed surface after transport or protocol processing.',
      'A feature must add behavior without owning endpoint transport or disposal.'
    ],
    useZh: [
      '同一个 Feature 需要复用于多个显式组合的 endpoint。',
      '业务数据经过 transport 或 protocol 处理后，需要一个窄而明确的类型化能力面。',
      'Feature 只增加业务能力，不接管 endpoint 的 transport 和释放责任。'
    ],
    avoidEn: ['Using a feature to hide endpoint-wide transport or lifecycle ownership.'],
    avoidZh: ['用 feature 隐藏 endpoint-wide transport 或 lifecycle ownership。']
  }),
  'rpc-core:index:defineMiddleware': guide({
    purposeEn:
      'Defines a reusable middleware descriptor whose installation and ordering remain owned by the endpoint composition.',
    purposeZh:
      '定义可复用 middleware descriptor，同时让 installation 与 ordering 继续由 endpoint composition 拥有。',
    quickStart:
      "import { connect, createEndpoint, defineMiddleware } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst audit = defineMiddleware('audit', (core) => ({\n  install: () => {\n    console.log('installing audit for', core.id)\n    return {}\n  }\n}))\nconst [transport] = createMemoryTransportPair()\nconst endpoint = await createEndpoint({\n  id: 'audited-client', transport,\n  middlewares: [audit, connect({ transport })] as const\n})\ntry {\n  console.log('audit middleware installed')\n} finally {\n  await endpoint.dispose()\n}",
    useEn: ['A cross-cutting concern must be installed consistently on selected endpoints.'],
    useZh: ['cross-cutting concern 需要在选定 endpoint 上一致安装。'],
    avoidEn: ['Mutating endpoint state outside the declared middleware lifecycle.'],
    avoidZh: ['在声明的 middleware lifecycle 之外修改 endpoint state。']
  }),
  'rpc-core:index:framer': guide({
    purposeEn:
      'Defines the frame boundary used to encode and decode transport messages, keeping chunking and message ownership explicit.',
    purposeZh:
      '定义 transport message 使用的 frame boundary，让分片与 message ownership 保持显式。',
    quickStart:
      "import { framer, codec, connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createStringFramer } from '@migaia/rpc-contract/framing'\nimport { defineJsonCodec } from '@migaia/serialize/codecs/json'\n\nconst [transport] = createMemoryTransportPair()\nconst framePlugin = framer(createStringFramer({ chunkBytes: 64, maxMessageBytes: 16 * 1024 }))\nconst endpoint = await createEndpoint({\n  id: 'client', transport,\n  middlewares: [codec(defineJsonCodec({ version: 1 })), framePlugin, connect({ transport })] as const\n})\ntry {\n  console.log('bounded string framing ready')\n} finally {\n  await endpoint.dispose()\n}",
    useEn: ['A transport needs an explicit framing policy for bounded messages.'],
    useZh: ['transport 需要为 bounded message 指定显式 framing policy。'],
    avoidEn: ['Treating framing as an unbounded or implicitly shared transport detail.'],
    avoidZh: ['把 framing 当作无界或隐式共享的 transport detail。']
  }),
  'rpc-core:features-control:createControlFeature': guide({
    purposeEn:
      'Adds the bounded ping, cancellation and close control to a composed endpoint through the original Feature dependency graph. It creates no socket by itself: the construction scope owns installation, shared dependencies, provider visibility and reverse cleanup after failure.',
    purposeZh:
      '为组合式 endpoint 增加受限探活、取消和关闭控制，通过原 Feature 依赖图进行装配。工厂本身不创建 socket，也不越过 transport/source 鉴权；construction scope 持有原依赖、原子安装、provider 可见性和失败时的逆序清理。业务仍通过实际 provide/send 能力调用，不能把 Feature 定义当作已安装的服务实例。',
    quickStart:
      "import { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createDiscoveryFeature } from '@migaia/rpc-core/features/discovery'\nimport { createControlFeature } from '@migaia/rpc-core/features/control'\n\nfunction selectedFeatures() {\n  const chunks = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunks)\n  const provider = createProviderFeature(outbound)\n  const discovery = createDiscoveryFeature(outbound)\n  const selected = createControlFeature(outbound, discovery)\n  return { 'first-party-chunk': chunks, 'first-party-outbound': outbound, 'first-party-provider': provider, 'first-party-discovery': discovery, 'first-party-control': selected }\n}\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint({ id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] }, selectedFeatures())\nconst client = await createComposedEndpoint({ id: 'client', transport: clientTransport, middlewares: [connect({ transport: clientTransport })] }, selectedFeatures())\nservice.provide('measure', (context) => context.success(String(context.data).length))\ntry {\n  console.log(await client.send<number>('service', 'measure', 'hello'))\n} finally {\n  await Promise.all([client.dispose(), service.dispose()])\n}",
    useEn: [
      'A custom endpoint needs this explicit capability together with its declared outbound/provider dependencies.',
      'The application must retain one shared identity, pending registry and cleanup scope while selecting its precise runtime surface.'
    ],
    useZh: [
      '自定义 endpoint 需要这项明确能力，以及它声明的 outbound/provider 依赖。',
      '应用需要保留同一个 identity、pending registry 与清理 scope，同时选择精确的运行时能力面。'
    ],
    avoidEn: [
      'Use the process/thread Peer or Plugin factories when they already supply the application boundary.',
      'Do not construct another receiver, replay ledger or provider queue beside the selected Feature graph.'
    ],
    avoidZh: [
      'process/thread Peer 或 Plugin 工厂已经满足业务边界时，不需要另行组合底层图。',
      '不要在选定 Feature 图旁另造接收器、重放账本或 provider 队列。'
    ],
    options: [
      {
        name: 'outboundCapability',
        description:
          'Original outboundCapability Feature dependency shared by this composed endpoint; a copied structural object cannot replace it.',
        whenToUse:
          'Pass the previously created canonical Feature so both nodes share one owner and lifecycle.'
      },
      {
        name: 'discoveryCapability',
        description:
          'Original discoveryCapability Feature dependency shared by this composed endpoint; a copied structural object cannot replace it.',
        whenToUse:
          'Pass the previously created canonical Feature so both nodes share one owner and lifecycle.'
      }
    ]
  }),
  'rpc-core:index:connect': middlewareGuide({
    name: 'connect',
    purposeEn:
      'Installs the single transport authority, subscribes inbound frames, and owns transport cleanup according to declared custody.',
    purposeZh:
      '安装唯一 transport authority、订阅 inbound frame，并按声明的 custody 拥有 transport cleanup。',
    code: 'connect({ transport })',
    useEn: 'Every operational endpoint needs exactly one resolved transport.',
    useZh: '每个可运行 endpoint 都需要且只能解析出一个 transport。',
    avoidEn:
      'Installing more than one connect middleware or providing conflicting transport objects.',
    avoidZh: '安装多个 connect middleware，或提供互相冲突的 transport object。'
  }),
  'rpc-core:index:contract': middlewareGuide({
    name: 'contract',
    purposeEn:
      'Negotiates an accepted protocol version and validates method parameters and results through small parse-compatible schemas at the network boundary.',
    purposeZh:
      '协商可接受的 protocol version，并通过 parse-compatible schema 在 network boundary 校验 method parameter 与 result。',
    code: "import { connect, contract, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [clientTransport, serverTransport] = createMemoryTransportPair()\nconst productContract = contract({\n  version: '1',\n  schemas: {\n    findProduct: {\n      params: { parse: (value: unknown) => String(value) },\n      result: { parse: (value: unknown) => value }\n    }\n  }\n})\n\nconst client = await createEndpoint({\n  id: 'client',\n  transport: clientTransport,\n  middlewares: [productContract, connect({ transport: clientTransport })]\n})\nconst server = await createEndpoint({\n  id: 'server',\n  transport: serverTransport,\n  middlewares: [productContract, connect({ transport: serverTransport })]\n})\n\n// 两端共享同一个 contract；请求参数和返回值都会在 wire boundary 校验。\nconsole.log('contract ready:', client.id, server.id)\n\ntry {\n  console.log('业务调用应把 client 接到 outbound、server 接到 provider，双方都会经过上面的参数和返回值校验。')\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n}",
    examplesEn: [
      {
        id: 'iframe-transport',
        title: 'Parent page to iframe',
        description:
          'Window transport pins the target origin and window source. The contract still validates calculateTotal parameters and results before business code sees them.',
        code: contractTransportCode.iframe
      },
      {
        id: 'worker-transport',
        title: 'Page to Dedicated Worker',
        description:
          'Worker transport moves CPU-heavy work off the UI thread; the same contract version and schemas protect both sides of resize().',
        code: contractTransportCode.worker
      },
      {
        id: 'broadcast-transport',
        title: 'Same-origin tabs through BroadcastChannel',
        description:
          'Each tab keeps its own endpoint identity while the shared contract rejects incompatible versions or malformed readTheme payloads.',
        code: contractTransportCode.tabs
      },
      {
        id: 'service-worker-transport',
        title: 'Page to Service Worker',
        description:
          'ServiceWorker transport targets the active controller; the contract validates cache lookup input and output across the offline boundary.',
        code: contractTransportCode.serviceWorker
      }
    ],
    examplesZh: [
      {
        id: 'iframe-transport',
        title: '父页面调用 iframe',
        description:
          'Window transport 固定目标 origin 与窗口来源；contract 仍会在业务代码收到数据前校验 calculateTotal 的参数和结果。适合嵌入式结算、报表和受控微前端。',
        code: contractTransportCode.iframe
      },
      {
        id: 'worker-transport',
        title: '页面调用 Dedicated Worker',
        description:
          'Worker transport 把耗时计算移出 UI 线程；同一套 contract version 与 schema 同时约束 resize() 的请求和结果。适合图片处理、解析与生成任务。',
        code: contractTransportCode.worker
      },
      {
        id: 'broadcast-transport',
        title: '同源 Tab 通过 BroadcastChannel 通信',
        description:
          '每个 Tab 保留独立 endpoint 身份，共享的 contract 会拒绝版本不兼容或格式错误的 readTheme 数据。适合同源页面间共享设置与任务状态。',
        code: contractTransportCode.tabs
      },
      {
        id: 'service-worker-transport',
        title: '页面调用 Service Worker',
        description:
          'ServiceWorker transport 指向当前 controller；contract 跨离线边界校验缓存查询的输入和输出。适合离线缓存、后台同步和请求代理。',
        code: contractTransportCode.serviceWorker
      }
    ],
    useEn: 'Peers require version compatibility or untrusted payloads must be schema-validated.',
    useZh: 'peer 需要 version compatibility，或 untrusted payload 必须通过 schema validation。',
    avoidEn: 'Treating a version string as peer authentication.',
    avoidZh: '把 version string 当作 peer authentication。'
  }),
  'rpc-core:index:protocol': middlewareGuide({
    name: 'protocol',
    purposeEn:
      'Defines the outbound encoder and inbound decoder for wire envelopes and declares the encoded representation expected by the transport.',
    purposeZh:
      '定义 wire envelope 的 outbound encoder 与 inbound decoder，并声明 transport 期望的 encoded representation。',
    code: "import { protocol } from '@migaia/rpc-core'\n\n// protocol only encodes and decodes the wire envelope; endpoint code supplies business data.\nconst jsonProtocol = protocol({ encodedType: 'string', encode: JSON.stringify, decode: JSON.parse })\nconsole.log(jsonProtocol)",
    useEn:
      'The transport cannot carry structured objects directly or a stable wire codec is required.',
    useZh: 'transport 不能直接承载 structured object，或需要稳定 wire codec。',
    avoidEn: 'Encoding business payloads independently outside the envelope codec.',
    avoidZh: '在 envelope codec 外独立编码 business payload。'
  }),
  'rpc-core:index:authentication': middlewareGuide({
    name: 'authentication',
    purposeEn:
      'Protects every outbound and inbound frame, including control and chunk frames, by applying paired encryption/decryption and signing/verification transforms in the defined order.',
    purposeZh:
      '按规定顺序对每个 outbound/inbound frame 执行成对的 encrypt/decrypt 与 sign/verify；control frame 和 chunk frame 同样受保护。',
    setup: `// 示例双方共享同一把 AES-GCM key；生产环境应由应用自己的密钥协商或密钥服务提供。
const encryptionKey = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
)
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const encrypt = async (value: unknown) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext)
  )
  const frame = new Uint8Array(iv.length + ciphertext.length)
  frame.set(iv)
  frame.set(ciphertext, iv.length)
  return frame
}
const decrypt = async (value: unknown) => {
  const frame = value as Uint8Array
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: frame.slice(0, 12) },
    encryptionKey,
    frame.slice(12)
  )
  return JSON.parse(decoder.decode(plaintext))
}`,
    code: "authentication({ encrypt, decrypt, encodedType: 'uint8array' })",
    useEn: 'The channel itself is not an adequate confidentiality or integrity boundary.',
    useZh: 'channel 本身不足以提供 confidentiality 或 integrity boundary。',
    avoidEn:
      'Configuring only one half of an encryption or signature pair, or requiring transferable zero-copy buffers.',
    avoidZh: '只配置 encryption/signature pair 的一半，或仍要求 transferable zero-copy buffer。'
  }),
  'rpc-core:index:chunk': middlewareGuide({
    name: 'chunk',
    purposeEn:
      'Configures bounded splitting and reassembly for large string envelopes, with limits for message size, peers, buffered bytes, chunk count, and assembly lifetime.',
    purposeZh:
      '配置大型 string envelope 的有界拆分与重组，并限制 message size、peer、buffered bytes、chunk count 与 assembly lifetime。',
    code: 'chunk({ chunkSize: 64 * 1024, maxMessageBytes: 4 * 1024 * 1024 })',
    useEn: 'Encoded string envelopes may exceed the underlying channel message budget.',
    useZh: 'encoded string envelope 可能超过底层 channel message budget。',
    avoidEn: 'Splitting Uint8Array payloads or disabling bounds on an untrusted channel.',
    avoidZh: '拆分 Uint8Array payload，或在 untrusted channel 上关闭边界。'
  }),
  'rpc-core:index:timeout': middlewareGuide({
    name: 'timeout',
    purposeEn:
      'Applies a bounded deadline to outbound request/response work and rejects timed-out calls with a stable RpcTimeoutError contract.',
    purposeZh:
      '为 outbound request/response work 设置有界 deadline，并以稳定 RpcTimeoutError contract 拒绝超时调用。',
    code: 'timeout({ timeoutMs: 5_000 })',
    useEn: 'A remote call must not remain pending forever.',
    useZh: 'remote call 不得永久 pending。',
    avoidEn: 'Using a large timeout to conceal an overloaded or unreachable provider.',
    avoidZh: '用很大的 timeout 掩盖 overloaded 或 unreachable provider。'
  }),
  'rpc-core:index:ping': middlewareGuide({
    name: 'ping',
    purposeEn:
      'Adds control-frame liveness probes and exposes ping or pingAll only when the selected endpoint surface also owns control capability.',
    purposeZh:
      '增加 control-frame liveness probe；只有 endpoint surface 同时拥有 control capability 时才公开 ping 或 pingAll。',
    code: 'ping({ timeoutMs: 2_000 })',
    examplesEn: [
      ...middlewareTransportExamples('ping', 'ping({ timeoutMs: 2_000 })', 'en'),
      ...pingUsageExamples('en')
    ],
    examplesZh: [
      ...middlewareTransportExamples('ping', 'ping({ timeoutMs: 2_000 })', 'zh'),
      ...pingUsageExamples('zh')
    ],
    useEn: 'The application needs an explicit bounded peer-liveness check.',
    useZh: '应用需要显式、有界的 peer liveness check。',
    avoidEn: 'Treating a successful ping as authentication or business-service readiness.',
    avoidZh: '把 ping 成功当作 authentication 或 business-service readiness。'
  }),
  'rpc-core:index:abort': middlewareGuide({
    name: 'abort',
    purposeEn:
      'Enables propagation of caller cancellation to in-flight remote provider work while preserving the original abort reason at the local boundary.',
    purposeZh:
      '把 caller cancellation 传播到正在执行的 remote provider work，同时在本地边界保留原始 abort reason。',
    code: 'abort()',
    useEn: 'Calls can outlive the UI, request, task, or owner that started them.',
    useZh: 'call 可能活得比启动它的 UI、request、task 或 owner 更久。',
    avoidEn: 'Assuming cancellation can undo remote side effects that already committed.',
    avoidZh: '假设 cancellation 能撤销远端已经 commit 的 side effect。'
  }),
  'rpc-core:index:hooks': middlewareGuide({
    name: 'hooks',
    purposeEn:
      'Installs ordered observability listeners for endpoint lifecycle and operation events while containing listener failures away from RPC results.',
    purposeZh:
      '为 endpoint lifecycle 与 operation event 安装有序 observability listener，并隔离 listener failure，避免改变 RPC result。',
    code: "hooks({ listeners: { error: [(event) => console.error('RPC failed', event)] }, onHookError: (error) => console.error('Hook failed', error) })",
    useEn: 'Metrics, tracing, audit, or diagnostics need structured operation events.',
    useZh: 'metrics、tracing、audit 或 diagnostics 需要 structured operation event。',
    avoidEn:
      'Implementing business control flow or mutating RPC results from a diagnostic listener.',
    avoidZh: '在 diagnostic listener 中实现 business control flow 或修改 RPC result。'
  }),
  'rpc-core:index:uuid': middlewareGuide({
    name: 'uuid',
    purposeEn:
      'Supplies the identifier generator used for tasks, messages, and variations while retaining collision and replay checks.',
    purposeZh:
      '提供 task、message 与 variation 使用的 identifier generator，同时保留 collision 与 replay check。',
    code: 'uuid({ generate: () => crypto.randomUUID() })',
    useEn: 'Tests need deterministic identifiers or the host owns a secure identifier service.',
    useZh: '测试需要 deterministic identifier，或宿主拥有 secure identifier service。',
    avoidEn: 'Using sequential or low-entropy identifiers on an untrusted channel.',
    avoidZh: '在 untrusted channel 上使用 sequential 或 low-entropy identifier。'
  }),
  'rpc-core:index:codec': guide({
    purposeEn:
      'Declares the wire representation used by an endpoint so encoding and decoding remain symmetric across the transport boundary.',
    purposeZh:
      '声明 endpoint 使用的 wire representation，确保 transport boundary 两侧的 encode 与 decode 保持对称。',
    quickStart: `import { codec, connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [transport] = createMemoryTransportPair()
const endpointCodec = codec({
  name: 'json',
  output: 'text',
  encode: (value: unknown) => JSON.stringify(value),
  decode: (text: string) => JSON.parse(text) as unknown
})
const endpoint = await createEndpoint({
  id: 'client',
  transport,
  middlewares: [endpointCodec, connect({ transport })]
})

try {
  console.log('json codec installed')
} finally {
  await endpoint.dispose()
}`,
    useEn: ['An endpoint must interoperate with a fixed wire format.'],
    useZh: ['endpoint 必须与固定 wire format 互操作。'],
    avoidEn: ['Changing codec identity after peers adopt the contract.'],
    avoidZh: ['peer 采用 contract 后再改变 codec identity。']
  }),
  'rpc-core:features-outbound:createOutboundFeature': guide({
    purposeEn:
      'Adds the outbound calls and response correlation to a composed endpoint through the original Feature dependency graph. It creates no socket by itself: the construction scope owns installation, shared dependencies, provider visibility and reverse cleanup after failure.',
    purposeZh:
      '为组合式 endpoint 增加出站请求与响应关联，通过原 Feature 依赖图进行装配。工厂本身不创建 socket，也不越过 transport/source 鉴权；construction scope 持有原依赖、原子安装、provider 可见性和失败时的逆序清理。业务仍通过实际 provide/send 能力调用，不能把 Feature 定义当作已安装的服务实例。',
    quickStart:
      "import { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\n\nfunction selectedFeatures() {\n  const chunks = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunks)\n  const provider = createProviderFeature(outbound)\n  return { 'first-party-chunk': chunks, 'first-party-outbound': outbound, 'first-party-provider': provider }\n}\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint({ id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] }, selectedFeatures())\nconst client = await createComposedEndpoint({ id: 'client', transport: clientTransport, middlewares: [connect({ transport: clientTransport })] }, selectedFeatures())\nservice.provide('measure', (context) => context.success(String(context.data).length))\ntry {\n  console.log(await client.send<number>('service', 'measure', 'hello'))\n} finally {\n  await Promise.all([client.dispose(), service.dispose()])\n}",
    useEn: [
      'A custom endpoint needs this explicit capability together with its declared outbound/provider dependencies.',
      'The application must retain one shared identity, pending registry and cleanup scope while selecting its precise runtime surface.'
    ],
    useZh: [
      '自定义 endpoint 需要这项明确能力，以及它声明的 outbound/provider 依赖。',
      '应用需要保留同一个 identity、pending registry 与清理 scope，同时选择精确的运行时能力面。'
    ],
    avoidEn: [
      'Use the process/thread Peer or Plugin factories when they already supply the application boundary.',
      'Do not construct another receiver, replay ledger or provider queue beside the selected Feature graph.'
    ],
    avoidZh: [
      'process/thread Peer 或 Plugin 工厂已经满足业务边界时，不需要另行组合底层图。',
      '不要在选定 Feature 图旁另造接收器、重放账本或 provider 队列。'
    ],
    options: [
      {
        name: 'chunkCapability',
        description:
          'Original chunkCapability Feature dependency shared by this composed endpoint; a copied structural object cannot replace it.',
        whenToUse:
          'Pass the previously created canonical Feature so both nodes share one owner and lifecycle.'
      }
    ]
  }),
  'rpc-core:features-provider:createProviderFeature': guide({
    purposeEn:
      'Adds the explicit method registration and provider admission to a composed endpoint through the original Feature dependency graph. It creates no socket by itself: the construction scope owns installation, shared dependencies, provider visibility and reverse cleanup after failure.',
    purposeZh:
      '为组合式 endpoint 增加显式方法注册与 provider 准入，通过原 Feature 依赖图进行装配。工厂本身不创建 socket，也不越过 transport/source 鉴权；construction scope 持有原依赖、原子安装、provider 可见性和失败时的逆序清理。业务仍通过实际 provide/send 能力调用，不能把 Feature 定义当作已安装的服务实例。',
    quickStart:
      "import { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\n\nfunction selectedFeatures() {\n  const chunks = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunks)\n  const provider = createProviderFeature(outbound)\n  return { 'first-party-chunk': chunks, 'first-party-outbound': outbound, 'first-party-provider': provider }\n}\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint({ id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] }, selectedFeatures())\nconst client = await createComposedEndpoint({ id: 'client', transport: clientTransport, middlewares: [connect({ transport: clientTransport })] }, selectedFeatures())\nservice.provide('measure', (context) => context.success(String(context.data).length))\ntry {\n  console.log(await client.send<number>('service', 'measure', 'hello'))\n} finally {\n  await Promise.all([client.dispose(), service.dispose()])\n}",
    useEn: [
      'A custom endpoint needs this explicit capability together with its declared outbound/provider dependencies.',
      'The application must retain one shared identity, pending registry and cleanup scope while selecting its precise runtime surface.'
    ],
    useZh: [
      '自定义 endpoint 需要这项明确能力，以及它声明的 outbound/provider 依赖。',
      '应用需要保留同一个 identity、pending registry 与清理 scope，同时选择精确的运行时能力面。'
    ],
    avoidEn: [
      'Use the process/thread Peer or Plugin factories when they already supply the application boundary.',
      'Do not construct another receiver, replay ledger or provider queue beside the selected Feature graph.'
    ],
    avoidZh: [
      'process/thread Peer 或 Plugin 工厂已经满足业务边界时，不需要另行组合底层图。',
      '不要在选定 Feature 图旁另造接收器、重放账本或 provider 队列。'
    ],
    options: [
      {
        name: 'outboundCapability',
        description:
          'Original outboundCapability Feature dependency shared by this composed endpoint; a copied structural object cannot replace it.',
        whenToUse:
          'Pass the previously created canonical Feature so both nodes share one owner and lifecycle.'
      }
    ]
  }),
  'rpc:core-features-chunk:chunk': guide({
    purposeEn:
      'Lets a composed endpoint receive, validate, and reassemble chunk frames. The feature token selects that runtime owner; the root chunk({...}) middleware separately defines how outgoing strings are split and how much incomplete data may be buffered. Real two-way use normally installs both on every peer.',
    purposeZh:
      '让组合式 endpoint 能接收、校验并重组分片消息。Feature token 负责安装分片帧处理器；根入口的 chunk({...}) middleware 负责配置发送端如何拆分字符串，以及接收端最多允许缓存多少未完成数据。真实双向通信通常要求两端都同时选择 Feature 并安装 middleware。',
    quickStart: `import { chunk as configureChunk, connect } from '@migaia/rpc-core'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { chunk as selectChunkFrames } from '@migaia/rpc-core/features/chunk'
import { outbound } from '@migaia/rpc-core/features/outbound'
import { provider } from '@migaia/rpc-core/features/provider'

const [clientTransport, serviceTransport] = createMemoryTransportPair()
const chunkPolicy = {
  chunkSize: 64 * 1024,
  maxMessageBytes: 8 * 1024 * 1024,
  maxConcurrentMessagesPerPeer: 4,
  maxBufferedBytes: 16 * 1024 * 1024,
  maxChunksPerMessage: 256,
  assemblyTimeoutMs: 10_000
}
const service = await createComposedEndpoint(
  { id: 'storage', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport }), configureChunk(chunkPolicy)] },
  [provider(), selectChunkFrames()] as const
)
service.provide('measure', ({ data, success }) => success(String(data).length))
const client = await createComposedEndpoint(
  { id: 'uploader', targetIds: ['storage'], transport: clientTransport, middlewares: [connect({ transport: clientTransport }), configureChunk(chunkPolicy)] },
  [outbound(), selectChunkFrames()] as const
)

try {
  const length = await client.send<number>('storage', 'measure', 'x'.repeat(256_000))
  console.log(length)
} finally {
  await Promise.all([client.dispose(), service.dispose()])
}`,
    examplesEn: [
      {
        id: 'preset',
        title: 'Use the complete createEndpoint preset',
        description:
          'createEndpoint selects the complete built-in Feature surface. Use it when one Host genuinely needs outbound calls, providers, discovery, control, and chunk handling; only middleware configuration remains explicit.',
        code: chunkScenarioCode.preset
      },
      {
        id: 'iframe',
        title: 'Cross-iframe with verified origin and source',
        description:
          'The parent and iframe each own an endpoint. The Window adapter fixes targetOrigin and checks event.source before chunk frames reach the Host.',
        code: chunkScenarioCode.iframe
      },
      {
        id: 'tabs',
        title: 'Cross-tab through BroadcastChannel',
        description:
          'Two same-origin tabs share a named channel while retaining distinct endpoint identities and bounded reassembly memory.',
        code: chunkScenarioCode.tabs
      },
      {
        id: 'worker',
        title: 'Page-to-Worker processing',
        description:
          'The page calls a provider hosted in a dedicated Worker. Chunking is useful when encoded documents or generated previews exceed a practical single-message budget.',
        code: chunkScenarioCode.worker
      }
    ],
    examplesZh: [
      {
        id: 'preset',
        title: '直接使用完整 createEndpoint preset',
        description:
          'createEndpoint 会选择内置的完整 Feature 集合，Host 直接获得远程调用、服务注册、发现、控制和分片帧处理能力；适合确实需要整套能力的端点。createComposedEndpoint 则要求显式列出 Feature，只安装当前角色需要的能力，产物和公开方法更窄。',
        code: chunkScenarioCode.preset
      },
      {
        id: 'iframe',
        title: '跨 iframe：校验 origin 与窗口来源',
        description:
          '父页面和 iframe 各自拥有 endpoint。Window adapter 固定 targetOrigin，并在分片进入 Host 前检查 event.source，适合嵌入式报表、编辑器预览和受控微前端。',
        code: chunkScenarioCode.iframe
      },
      {
        id: 'tabs',
        title: '跨 Tab：通过 BroadcastChannel 同步大快照',
        description:
          '两个同源 Tab 共用命名 channel，但保留独立 endpoint 身份和重组容量限制，适合文档快照、缓存预热结果或后台任务状态同步。',
        code: chunkScenarioCode.tabs
      },
      {
        id: 'worker',
        title: '跨 Worker：把大任务交给后台线程',
        description:
          '页面调用 Worker 中注册的 provider。编码后的文档、图片描述或分析结果超过单条消息预算时，chunk middleware 自动完成拆分和重组。',
        code: chunkScenarioCode.worker
      }
    ],
    useEn: [
      'Encoded string envelopes can exceed the message size accepted by the underlying channel.',
      'Untrusted or bursty peers require hard limits for partial-message memory and assembly lifetime.'
    ],
    useZh: [
      '编码后的字符串消息可能超过底层 MessagePort、Worker 或网络通道允许的单条消息大小。',
      '对端不完全可信或流量有突发，需要限制未完成消息占用的内存和存活时间。'
    ],
    avoidEn: [
      'Payloads are already small enough for the transport.',
      'The payload is Uint8Array and the application expects this string splitter to segment it automatically.'
    ],
    avoidZh: [
      '消息始终小于底层传输限制，分片只会增加协议成本。',
      'payload 是 Uint8Array，却期望这个字符串分片器自动拆分二进制数据。'
    ],
    options: [
      {
        name: 'chunkSize',
        type: 'number',
        optional: true,
        description: '每个字符串分片的目标字节数，必须是至少 4 的正安全整数。',
        whenToUse: '按底层通道单条消息限制留出协议头余量后设置。'
      },
      {
        name: 'maxMessageBytes',
        type: 'number',
        optional: true,
        description: '允许拆分或重组的单条完整消息最大字节数。',
        whenToUse: '按业务允许的最大上传或响应大小设置，防止超大消息耗尽内存。'
      },
      {
        name: 'maxConcurrentMessages',
        type: 'number',
        optional: true,
        description: '限制所有对端合计可同时重组的消息数量，超过上限的新消息会被拒绝。',
        whenToUse: '宿主有明确总内存预算时设置。'
      },
      {
        name: 'maxConcurrentMessagesPerPeer',
        type: 'number',
        optional: true,
        description: '限制单个对端可同时占用的重组槽位，防止一个来源耗尽宿主容量。',
        whenToUse: '多个对端共享一个宿主时限制单个来源。'
      },
      {
        name: 'maxBufferedBytes',
        type: 'number',
        optional: true,
        description: '限制全部未完成消息累计占用的缓存字节，超过预算时拒绝继续接收。',
        whenToUse: '始终按宿主可承受的内存峰值设置。'
      },
      {
        name: 'maxChunksPerMessage',
        type: 'number',
        optional: true,
        description: '限制一条完整消息允许包含的分片数量，避免大量微小分片拖垮调度。',
        whenToUse: '防止极小分片制造过多对象和调度开销。'
      },
      {
        name: 'maxChunkBytes',
        type: 'number',
        optional: true,
        description: '限制接收端接受的单个分片最大字节数，违规分片不会进入重组缓存。',
        whenToUse: '需要拒绝不遵守本端容量约束的发送方时设置。'
      },
      {
        name: 'assemblyTimeoutMs',
        type: 'number',
        optional: true,
        description: '限制从首个分片到完整重组允许经过的时间，超时后释放对应缓存。',
        whenToUse: '用于清理丢包、断连或恶意发送造成的半成品消息。'
      },
      {
        name: 'byteLength',
        type: '(value: string) => number',
        optional: true,
        description: '计算编码后字符串字节数的函数；默认按 UTF-8 计算。',
        whenToUse: '自定义编码的字节计算规则不同于 UTF-8 时替换。'
      },
      {
        name: 'split',
        type: '(value: string, maxBytes: number) => readonly string[]',
        optional: true,
        description: '按最大字节数拆分字符串的函数；默认不会切断 UTF-8 码点。',
        whenToUse: '协议使用特殊字符串编码或需要定制边界时替换。'
      }
    ]
  }),
  'rpc-core:adapters-memory:createMemoryTransportPair': transportGuide({
    name: 'createMemoryTransportPair',
    importPath: '@migaia/rpc-core/adapters/memory',
    expression: 'createMemoryTransportPair()',
    boundaryEn: 'an isolated in-process paired channel',
    boundaryZh: '隔离的 in-process paired channel',
    cautionEn: 'Production peers live in different processes or browsing contexts.',
    cautionZh: '生产 peer 位于不同 process 或 browsing context。'
  }),
  'rpc-browser:adapters-broadcast-channel:createBroadcastChannelTransport': transportGuide({
    name: 'createBroadcastChannelTransport',
    importPath: '@migaia/rpc-browser/adapters/broadcast-channel',
    expression: "createBroadcastChannelTransport(new BroadcastChannel('migaia'))",
    boundaryEn: 'a BroadcastChannel shared by same-origin contexts',
    boundaryZh: '由 same-origin context 共享的 BroadcastChannel',
    cautionEn:
      'The channel must be treated as an authentication boundary; BroadcastChannel is an honest-node routing channel.',
    cautionZh:
      '需要把 channel 当作 authentication boundary；BroadcastChannel 只提供 honest-node routing。'
  }),
  'rpc-core:adapters-message-port:createBrowserMessagePortTransport': transportGuide({
    name: 'createBrowserMessagePortTransport',
    importPath: '@migaia/rpc-core/adapters/message-port',
    expression: "createBrowserMessagePortTransport(port, { ownership: 'owned' })",
    boundaryEn: 'a browser MessagePort',
    boundaryZh: 'browser MessagePort',
    cautionEn: 'The port lifecycle is owned elsewhere; use borrowed custody instead of closing it.',
    cautionZh: 'port lifecycle 由外部拥有；应使用 borrowed custody，不能关闭它。'
  }),
  'rpc-core:adapters-message-port:createNodeMessagePortTransport': transportGuide({
    name: 'createNodeMessagePortTransport',
    importPath: '@migaia/rpc-core/adapters/message-port',
    expression: 'createNodeMessagePortTransport(port)',
    boundaryEn: 'a Node-compatible MessagePort',
    boundaryZh: 'Node-compatible MessagePort',
    cautionEn: 'The value does not implement the Node message, postMessage, and close contract.',
    cautionZh: '该值不实现 Node message、postMessage 与 close contract。'
  }),
  'rpc-core:adapters-web-worker:createWebWorkerTransport': transportGuide({
    name: 'createWebWorkerTransport',
    importPath: '@migaia/rpc-core/adapters/web-worker',
    expression: 'createWebWorkerTransport(worker)',
    boundaryEn: 'a dedicated Worker or WorkerGlobalScope-like port',
    boundaryZh: 'dedicated Worker 或 WorkerGlobalScope-like port',
    cautionEn: 'Multiple logical peers share the same receiver; use a multiplexed adapter instead.',
    cautionZh: '多个 logical peer 共享同一个 receiver；应使用 multiplexed adapter。'
  }),
  'rpc-browser:adapters-shared-worker:createSharedWorkerTransport': transportGuide({
    name: 'createSharedWorkerTransport',
    importPath: '@migaia/rpc-browser/adapters/shared-worker',
    expression: 'createSharedWorkerTransport(worker.port)',
    boundaryEn: 'an independent SharedWorker connection port',
    boundaryZh: '每个页面独立持有的 SharedWorker 连接端口',
    cautionEn:
      'Several unrelated logical peers share this one port; use separate connection ports for one-to-one Runtime Peers.',
    cautionZh: '多个无关 logical peer 共用一个端口；一对一 Runtime Peer 应使用各自独立的连接端口。'
  }),
  'rpc-browser:adapters-service-worker:createServiceWorkerTransport': transportGuide({
    name: 'createServiceWorkerTransport',
    importPath: '@migaia/rpc-browser/adapters/service-worker',
    expression:
      'createServiceWorkerTransport({ target: controller, receiver: navigator.serviceWorker })',
    boundaryEn: 'a ServiceWorker target and its separate message receiver',
    boundaryZh: 'ServiceWorker target 及其独立 message receiver',
    cautionEn: 'The controlling worker is absent or may change without an owner-managed reconnect.',
    cautionZh: 'controlling worker 不存在，或可能改变但没有 owner-managed reconnect。'
  }),
  'rpc-browser:adapters-window:createWindowMessageTransport': transportGuide({
    name: 'createWindowMessageTransport',
    importPath: '@migaia/rpc-browser/adapters/window',
    expression:
      "createWindowMessageTransport({ target: frame.contentWindow!, receiver: window, targetOrigin: 'https://trusted.example' })",
    boundaryEn: 'window.postMessage between a window and an iframe or opener',
    boundaryZh: 'window 与 iframe/opener 之间的 window.postMessage',
    cautionEn: 'targetOrigin or source proof cannot be pinned to the intended peer.',
    cautionZh: '无法把 targetOrigin 或 source proof 固定到预期 peer。'
  }),
  'rpc-browser:adapters-rtc-data-channel:createRtcDataChannelTransport': transportGuide({
    name: 'createRtcDataChannelTransport',
    importPath: '@migaia/rpc-browser/adapters/rtc-data-channel',
    expression: 'createRtcDataChannelTransport(dataChannel)',
    boundaryEn: 'an open RTCDataChannel',
    boundaryZh: '已打开的 RTCDataChannel',
    cautionEn:
      'Signaling, reconnect, or channel negotiation still needs to be performed; this adapter does not own it.',
    cautionZh: 'signaling、reconnect 或 channel negotiation 尚未完成；adapter 不拥有这些流程。'
  }),
  'rpc-browser:adapters-web-transport:createWebTransportDatagramTransport': transportGuide({
    name: 'createWebTransportDatagramTransport',
    importPath: '@migaia/rpc-browser/adapters/web-transport',
    expression: 'createWebTransportDatagramTransport(session.datagrams)',
    boundaryEn: 'WebTransport unreliable datagrams',
    boundaryZh: 'WebTransport unreliable datagram',
    cautionEn: 'The operation requires ordered or reliable delivery guarantees.',
    cautionZh: 'operation 需要 ordered 或 reliable delivery guarantee。'
  })
}

/** RPC Contract guide entries introduced by rpc-contract exports used by RPC runtime setup. */
const rpcContractGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'rpc-contract:index:createDescriptor': guide({
    purposeEn:
      'Creates a typed contract descriptor for versioned RPC operations and keeps the resulting identity stable across endpoint creation and test coverage.',
    purposeZh:
      '创建可用于版本化 RPC 的类型化契约 descriptor。它只记录“这个 RPC 契约叫什么、当前是第几版”，不会自动发送请求；业务协议可以把它登记起来，在接收请求前按 ID 和版本找到同一份契约。',
    quickStart:
      "import { createDescriptor } from '@migaia/rpc-contract'\n\nconst readOrders = createDescriptor('read-orders', 1)\n// 注册表让 endpoint 或协议处理器按稳定 ID 找到契约。\nconst contracts = new Map([[readOrders.id, readOrders]])\nconst selected = contracts.get('read-orders')\nconsole.log(selected?.id, selected?.version) // read-orders 1",
    useEn: [
      'A public endpoint method or custom protocol needs a stable descriptor before any request is accepted.'
    ],
    useZh: ['自定义 protocol 方法或端点方法在接收请求前，需要稳定的 descriptor。'],
    avoidEn: [
      'Ad-hoc runtime objects replace shared descriptors across services.',
      'Only runtime string literals are used without a contract-level version.'
    ],
    avoidZh: [
      '服务间 ad-hoc 对象代替共享 descriptor 导致行为不一致。',
      '在跨服务通信时没有版本化的 contract 约束。'
    ],
    options: []
  })
}

/**
 * Public root middleware routes and feature routes share one complete composition guide. The
 * Website flattens feature URLs, so both identities must explain the same Host workflow.
 */
const webRpcCoreGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> =
  Object.freeze({
    ...rpcCoreGuideEntries
  })

/** Cross-realm error utilities and stable failure contracts. */
const webRpcErrorGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'rpc-contract:errors:classifyRpcContractError': guide({
    purposeEn:
      'Queries disclosure code and display message for the exact local Contract error without reading its properties. The immutable summary is presentation policy; message wording is not a public recovery contract.',
    purposeZh:
      '不读取错误属性地查询当前 Contract 实例实际产生错误的披露 code 与展示 message。不可变 summary 是展示策略；message 文本不是公开恢复契约。',
    quickStart: `import { classifyRpcContractError, normalizeRpcEnvelope } from '@migaia/rpc-contract'

try {
  normalizeRpcEnvelope({})
} catch (error) {
  const diagnostic = classifyRpcContractError(error)
  if (!diagnostic) throw error
  console.error(diagnostic.code, diagnostic.message)
}`,
    useEn: [
      'A protocol receiver needs controlled diagnostics for an envelope rejected by the actual normalizer.',
      'A diagnostic UI must display a protocol violation without inspecting the error cause or invoking its getters.'
    ],
    useZh: [
      '协议接收方需要展示实际 normalizer 拒绝 envelope 后产生的受控诊断。',
      '诊断界面需要显示协议违例，同时避免访问错误 cause 或调用其 getter。'
    ],
    avoidEn: [
      'A foreign or copied error needs classification; this operation returns undefined for those values.',
      'Core or Remote errors need their own wire presentation; use the Core error operations instead.'
    ],
    avoidZh: [
      '要分类外部或复制得到的错误；此操作对这些值返回 undefined。',
      '要编码 Core 或 Remote 错误的线上诊断；应使用 Core 自己的错误操作。'
    ]
  }),
  'rpc-core:index:serializeRpcError': guide({
    purposeEn:
      'Encodes a held Core or Remote error as bounded protocol data using its existing presentation and forwarding-route policy. Custom carriers retain the local error and cause while sending the same controlled diagnostic fields as the built-in transport.',
    purposeZh:
      '按原诊断与 forwarding-route 策略，把持有的 Core 或 Remote 错误编码为有界协议数据。自定义载体保留本地错误及 cause，线上使用与内置 transport 相同的受控诊断字段。',
    quickStart:
      "import { attachErrorIdentity } from '@migaia/utils/error'\nimport { serializeRpcError, deserializeRpcError } from '@migaia/rpc-core'\n\n/** This adapter owns its semantic identity and display wording. */\nconst ADAPTER_SOURCE = '@example/custom-ipc'\n/** A native write failure never claims a Core timeout or cancellation. */\nconst AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const\n/** Keep private native details on cause rather than quoting payload bytes. */\nconst AdapterErrorText = { writeFailed: 'adapter write failed' } as const\n\n/** Project an actual native write failure using this adapter's own identity. */\nexport function projectWriteFailure(cause: unknown) {\n  const original = attachErrorIdentity(new Error(AdapterErrorText.writeFailed, { cause }), {\n    source: ADAPTER_SOURCE, code: AdapterErrorCode.writeFailed\n  })\n  const wire = serializeRpcError(original, { report: ({ error }) => console.error(error) })\n  return { original, wire }\n}\n\n/** Reconstruct received error data without minting Core's private operation identity. */\nexport function receiveFailure(received: unknown) {\n  return deserializeRpcError(received)\n}\n// The serializer keeps Core/Remote disclosure and forwarding routes for actual held errors.\n// A wire source/code/name and a restored error never authorize retry, cancellation or close.",
    useEn: [
      'A custom carrier needs to transmit an actual Core or Remote failure with its existing redaction policy.',
      'A relay must preserve admitted forwarding routes when it re-encodes a received failure.'
    ],
    useZh: [
      '自定义载体需要传输实际 Core 或 Remote 错误，并沿用其原脱敏策略。',
      '中继重新编码收到的错误时，需要保留已接纳的 forwarding route。'
    ],
    avoidEn: [
      'Only independent protocol data is handled; use the Contract serializer for that implementation.',
      'The application wants to send arbitrary objects or raw private causes without the error owner policy.'
    ],
    avoidZh: [
      '只处理独立协议实现的数据；该实现应使用 Contract 的错误编码操作。',
      '要发送任意对象或绕过错误 owner 策略暴露原私有 cause。'
    ]
  }),
  'rpc-core:index:deserializeRpcError': guide({
    purposeEn:
      'Validates received error protocol data and restores its native error graph without replacing the transmitted stack. Core retains the admitted route for subsequent forwarding or re-encoding by a custom carrier.',
    purposeZh:
      '校验接收到的错误协议数据并恢复原生错误图，不替换传来的 stack。Core 持有已接纳的 route，供自定义载体随后转发或重新编码同一个错误。',
    quickStart:
      "import { attachErrorIdentity } from '@migaia/utils/error'\nimport { serializeRpcError, deserializeRpcError } from '@migaia/rpc-core'\n\n/** This adapter owns its semantic identity and display wording. */\nconst ADAPTER_SOURCE = '@example/custom-ipc'\n/** A native write failure never claims a Core timeout or cancellation. */\nconst AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const\n/** Keep private native details on cause rather than quoting payload bytes. */\nconst AdapterErrorText = { writeFailed: 'adapter write failed' } as const\n\n/** Project an actual native write failure using this adapter's own identity. */\nexport function projectWriteFailure(cause: unknown) {\n  const original = attachErrorIdentity(new Error(AdapterErrorText.writeFailed, { cause }), {\n    source: ADAPTER_SOURCE, code: AdapterErrorCode.writeFailed\n  })\n  const wire = serializeRpcError(original, { report: ({ error }) => console.error(error) })\n  return { original, wire }\n}\n\n/** Reconstruct received error data without minting Core's private operation identity. */\nexport function receiveFailure(received: unknown) {\n  return deserializeRpcError(received)\n}\n// The serializer keeps Core/Remote disclosure and forwarding routes for actual held errors.\n// A wire source/code/name and a restored error never authorize retry, cancellation or close.",
    useEn: [
      'A custom carrier receives error data that must be validated before it becomes a local throwable value.',
      'A relay needs the same restored error and route when it forwards or serializes a failure again.'
    ],
    useZh: [
      '自定义载体收到错误数据，需要先校验再恢复为可在本地抛出的值。',
      '中继转发或再次编码失败时，需要保留恢复后的同一个错误及 route。'
    ],
    avoidEn: [
      'A local Error already exists; retain that object instead of reconstructing it.',
      'Received stack or data is treated as executable input rather than diagnostic content.'
    ],
    avoidZh: [
      '本地已经持有 Error；应保留原对象，而不是再次恢复。',
      '要把收到的 stack 或 data 当作可执行输入，而不是诊断内容。'
    ]
  }),
  'rpc-contract:index:serializeRpcError': guide({
    purposeEn:
      'Serializes an Error and its bounded cause or AggregateError graph into a cross-realm record containing name, message, stack, source, code, data, and nested failures.',
    purposeZh:
      '把 Error 及其有界 cause/AggregateError graph 序列化成跨 realm record，保留 name、message、stack、source、code、data 与 nested failure。',
    quickStart:
      "import { serializeRpcError } from '@migaia/rpc-contract'\n\nconst error = new Error('remote failure')\nconst payload = serializeRpcError(error, { report: console.error })\nconsole.log(payload)",
    useEn: [
      'An error must cross a Worker, window, or transport boundary without losing diagnostic identity.'
    ],
    useZh: [
      'error 需要跨 Worker、window 或 transport boundary，同时不能丢失 diagnostic identity。'
    ],
    avoidEn: [
      'Serializing arbitrary application data.',
      'Replacing the original stack with a receiver-side stack.'
    ],
    avoidZh: ['序列化任意 application data。', '用 receiver-side stack 替换原始 stack。']
  }),
  'rpc-contract:index:deserializeRpcError': guide({
    purposeEn:
      'Reconstructs a received serialized failure into the closest supported Error class while retaining the transmitted stack, source/code identity, data, and cause graph.',
    purposeZh:
      '把收到的 serialized failure 重建为最接近的受支持 Error class，同时保留 transmitted stack、source/code identity、data 与 cause graph。',
    quickStart:
      "import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract'\n\nconst message = { error: serializeRpcError(new Error('remote failure'), { report: console.error }) }\nconst remoteError = deserializeRpcError(message.error)\nconsole.error(remoteError)",
    useEn: [
      'A serialized remote failure must become a throwable local value with inspectable provenance.'
    ],
    useZh: ['serialized remote failure 需要成为可抛出的 local value，并可检查 provenance。'],
    avoidEn: [
      'Trusting remote stack or data as executable input.',
      'Regenerating a local error that discards transmitted identity.'
    ],
    avoidZh: [
      '把 remote stack 或 data 当作 executable input。',
      '重新生成 local error 并丢弃 transmitted identity。'
    ]
  }),
  'rpc-contract:index:reachRpcError': guide({
    purposeEn:
      'Traverses an error, its cause chain, and AggregateError.errors in bounded identity order so reporting and contract checks can find every reachable original failure.',
    purposeZh:
      '按有界 identity order 遍历 error、cause chain 与 AggregateError.errors，让 reporting 与 contract check 能找到每个可达的原始 failure。',
    quickStart:
      "import { reachRpcError } from '@migaia/rpc-contract'\n\nconst originalError = new Error('database unavailable')\nconst error = new Error('request failed', { cause: originalError })\nfor (const cause of reachRpcError(error, { report: console.error })) {\n  if (cause === originalError) console.log('original reached')\n}",
    useEn: ['Diagnostics or tests must prove that wrapping preserved original error identity.'],
    useZh: ['diagnostics 或 test 必须证明 wrapping 保留了 original error identity。'],
    avoidEn: [
      'Mutating errors during traversal.',
      'Assuming every yielded value is an Error instance.'
    ],
    avoidZh: ['遍历期间修改 error。', '假设每个 yielded value 都是 Error instance。']
  }),
  'rpc-core:index:isRpcError': guide({
    purposeEn:
      'Recognizes only an object with a string code. This loose diagnostic shape check does not establish a Core source, error family, private owner identity or execution outcome.',
    purposeZh:
      '只识别带 string code 的 object。这是宽松诊断 shape 判断，不能确认 Core source、错误族、owner 私有身份或执行结果。',
    quickStart:
      "import { isRpcError, serializeRpcError } from '@migaia/rpc-core'\n\n/** Report the caught value without turning its public code into a control decision. */\nexport function reportCodedFailure(error: unknown) {\n  if (isRpcError(error)) {\n    const wire = serializeRpcError(error, { report: ({ error }) => console.error(error) })\n    console.error(wire)\n  }\n}\n// Use isRpcErrorInstance/isRpcRemoteError/isRpcTimeoutError for Core family diagnostics.\n// Reconcile actual execution/outcome before deciding whether a call may be repeated.",
    useEn: [
      'A reporting boundary identifies a machine-readable code before selecting its diagnostic sink.',
      'A received coded value must be distinguished from an uncoded primitive without instanceof.'
    ],
    useZh: [
      '报告边界先识别 machine-readable code，再选择诊断 sink。',
      '需要不依赖 instanceof 地区分编码值与无 code 的抛出 primitive。'
    ],
    avoidEn: [
      'Using this result or a public code to authorize retry, cancellation, terminal or close.',
      'Treating this as a Core family guard or proof that Core minted an untrusted object.'
    ],
    avoidZh: [
      '凭此结果或公开 code 授予重试、取消、终止或关闭。',
      '把此判断当作 Core 错误族守卫，或证明不可信 object 由 Core 产生。'
    ]
  }),
  'rpc-core:index:RPC_CORE_ERROR_SOURCE': guide({
    purposeEn:
      'Provides the stable @migaia/rpc/core diagnostic source. Compare it with the public code table on validated received error data; it is not a credential or proof of local Core construction.',
    purposeZh:
      '提供稳定的 @migaia/rpc/core 诊断 source。在已校验的接收错误数据上与公开 code 表一起比较；它不是凭据，也不证明本地 Core 构造身份。',
    quickStart:
      "import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-core'\nimport { normalizeRpcSerializedError } from '@migaia/rpc-contract/errors'\n\n/** Classify a received diagnostic tree after the wire grammar accepts it. */\nexport function reportCoreDeadline(received: unknown) {\n  const wire = normalizeRpcSerializedError(received)\n  if (wire.source === RPC_CORE_ERROR_SOURCE && wire.code === RpcCoreErrorCode.deadlineExceeded) {\n    console.error(wire)\n  }\n  return wire\n}\n// The pair reports the failure; actual execution/outcome controls any retry decision.",
    useEn: [
      'A shared report sink distinguishes Core diagnostics from application and adapter sources.',
      'A protocol implementer preserves the historical semantic source across the physical package split.'
    ],
    useZh: [
      '共享报告 sink 需要区分 Core 与应用、适配器的诊断来源。',
      '协议实现者在物理分包后继续保留原语义 source。'
    ],
    avoidEn: [
      'Using source/code as a Core private owner identity or execution receipt.',
      'Automatically retrying a business call from a received deadline code.'
    ],
    avoidZh: [
      '把 source/code 当作 Core 私有 owner 身份或执行回执。',
      '凭收到的 deadline code 自动重试业务调用。'
    ]
  }),
  'rpc-core:index:RpcError': errorGuide({
    name: 'RpcError',
    conditionEn: 'a coded local RPC failure without a more specific public subclass',
    conditionZh: '没有更具体 public subclass 的 coded local RPC failure',
    distinctionEn: 'Handle a stable RPC code not represented by a narrower class.',
    distinctionZh: '处理没有 narrower class 表达的稳定 RPC code。'
  }),
  'rpc-core:index:RpcSchemaValidationError': errorGuide({
    name: 'RpcSchemaValidationError',
    conditionEn: 'schema rejection of method parameters or results and retains rejected data',
    conditionZh: 'method parameter 或 result 被 schema 拒绝，并保留 rejected data',
    distinctionEn: 'Reject malformed data at the network contract boundary.',
    distinctionZh: '在 network contract boundary 拒绝 malformed data。'
  }),
  'rpc-core:index:RpcConfigurationError': errorGuide({
    name: 'RpcConfigurationError',
    conditionEn: 'invalid or conflicting endpoint configuration before operation begins',
    conditionZh: 'operation 开始前的 invalid 或 conflicting endpoint configuration',
    distinctionEn: 'Fix setup; retrying unchanged configuration cannot succeed.',
    distinctionZh: '应修正 setup；原样重试不会成功。'
  }),
  'rpc-core:index:RpcConstructionError': errorGuide({
    name: 'RpcConstructionError',
    conditionEn:
      'atomic endpoint construction failure with cleanup results from rolled-back resources',
    conditionZh: '原子 endpoint 构造失败，并携带 rolled-back resource 的 cleanup result',
    distinctionEn:
      'Treat cause as primary and cleanupErrors or cleanupPromise as secondary rollback evidence.',
    distinctionZh:
      '以 cause 为 primary failure，以 cleanupErrors 或 cleanupPromise 为 secondary rollback evidence。'
  }),
  'rpc-core:index:RpcLifecycleError': guide({
    purposeEn:
      "Represents failure after disposal of the caller's own resource. StoreWorker uses this public constructor after its real disposePromise starts and retains cleanup failures through cause/cleanupErrors. Construction supplies diagnostics, never Core private operation identity.",
    purposeZh:
      '表示调用方自己的资源开始 disposal 后发生的失败。StoreWorker 在真实 disposePromise 开始后使用这个公开构造器，并通过 cause/cleanupErrors 保留清理失败。构造只提供诊断，不产生 Core 操作私有身份。',
    quickStart:
      "import { RpcLifecycleError } from '@migaia/rpc-core'\n\n/** The resource owner supplies its actual disposal promise and owned display text. */\nexport function rejectAfterDisposal(disposePromise: Promise<void> | undefined, message: string) {\n  if (disposePromise !== undefined) throw new RpcLifecycleError(message)\n}\n// StoreWorker's workerParser uses this pattern before request/stream dispatch.\n// Construction cannot retire another Core generation or authorize a close.",
    useEn: [
      'A real resource owner rejects new work after its own disposal begins, as StoreWorker does.',
      'That owner preserves the primary cleanup error and resource-specific cleanup entries.'
    ],
    useZh: [
      '真实资源 owner 像 StoreWorker 一样，在自己的 disposal 开始后拒绝新工作。',
      '该 owner 需要保留原 cleanup 主错误与资源对应的 cleanup entries。'
    ],
    avoidEn: [
      'Constructing an error to claim that Core cancelled, retired or closed an operation.',
      'Using public fields as evidence that Core minted private lifecycle identity.'
    ],
    avoidZh: [
      '构造错误以声称 Core 已取消、retire 或关闭某个操作。',
      '用公开字段证明 Core 已产生操作私有生命周期身份。'
    ]
  }),
  'rpc-core:index:RpcSerializationError': errorGuide({
    name: 'RpcSerializationError',
    conditionEn: 'payload or error serialization that cannot preserve the wire contract',
    conditionZh: 'payload 或 error serialization 无法保留 wire contract',
    distinctionEn: 'Correct the payload shape or codec before resending.',
    distinctionZh: '重新发送前修正 payload shape 或 codec。'
  }),
  'rpc-core:index:RpcProtocolError': errorGuide({
    name: 'RpcProtocolError',
    conditionEn: 'a malformed, undecodable, or semantically invalid wire envelope',
    conditionZh: 'malformed、无法 decode 或语义无效的 wire envelope',
    distinctionEn: 'Treat the peer or codec as incompatible until the mismatch is resolved.',
    distinctionZh: '在 mismatch 解决前，把 peer 或 codec 视为 incompatible。'
  }),
  'rpc-core:index:RpcContractError': errorGuide({
    name: 'RpcContractError',
    conditionEn: 'protocol-version or declared contract incompatibility between peers',
    conditionZh: 'peer 之间的 protocol-version 或 declared contract incompatibility',
    distinctionEn: 'Negotiate a supported version or deploy matching contracts.',
    distinctionZh: '协商 supported version，或部署匹配 contract。'
  }),
  'rpc-core:index:RpcTransportError': errorGuide({
    name: 'RpcTransportError',
    conditionEn: 'send, subscription, listener, or channel failure owned by the transport boundary',
    conditionZh: '由 transport boundary 拥有的 send、subscription、listener 或 channel failure',
    distinctionEn: 'Reconnect or replace the transport only when owner policy permits it.',
    distinctionZh: '仅在 owner policy 允许时 reconnect 或 replace transport。'
  }),
  'rpc-core:index:RpcAuthenticationError': errorGuide({
    name: 'RpcAuthenticationError',
    conditionEn: 'failed frame verification, signing, encryption, or decryption',
    conditionZh: 'frame verification、signing、encryption 或 decryption 失败',
    distinctionEn: 'Reject the frame and inspect keys, peer identity, or transform ordering.',
    distinctionZh: '拒绝 frame，并检查 key、peer identity 或 transform order。'
  }),
  'rpc-core:index:RpcChunkError': errorGuide({
    name: 'RpcChunkError',
    conditionEn: 'invalid chunk structure or an exceeded reassembly capacity bound',
    conditionZh: 'chunk structure 无效，或超过 reassembly capacity bound',
    distinctionEn: 'Reject the assembly instead of retaining unbounded peer-controlled memory.',
    distinctionZh: '拒绝 assembly，不能保留无界 peer-controlled memory。'
  }),
  'rpc-core:index:RpcRemoteError': errorGuide({
    name: 'RpcRemoteError',
    conditionEn: 'a provider-declared remote business failure reconstructed on the caller',
    conditionZh: 'provider 声明的 remote business failure 在 caller 侧重建',
    distinctionEn: 'Handle provider code and optional data as a remote application contract.',
    distinctionZh: '把 provider code 与 optional data 作为 remote application contract 处理。'
  }),
  'rpc-core:index:RpcAbortError': errorGuide({
    name: 'RpcAbortError',
    conditionEn: 'caller or owner cancellation with the standard AbortError name',
    conditionZh: 'caller 或 owner cancellation，并公开标准 AbortError name',
    distinctionEn:
      'Read the cancellation reason retained by the actual owner; a diagnostic label cannot cancel another operation.',
    distinctionZh: '读取实际 owner 保留的取消原因；诊断标签不能取消其它操作。'
  }),
  'rpc-core:index:RpcTimeoutError': errorGuide({
    name: 'RpcTimeoutError',
    conditionEn: 'an exceeded call deadline with the standard TimeoutError name',
    conditionZh: 'call deadline 超限，并公开标准 TimeoutError name',
    distinctionEn:
      'Report the deadline and reconcile actual execution/outcome before any independent retry policy runs.',
    distinctionZh: '报告 deadline，并在独立重试策略运行前核对真实 execution/outcome。'
  })
}

/** Documents actual source/code catalogs for protocol diagnostics without granting operation rights. */
function errorIdentityGuide(input: {
  readonly source: string
  readonly codeTable: string
  readonly importPath: string
  readonly member: string
  readonly purposeEn: string
  readonly purposeZh: string
  readonly useEn: readonly string[]
  readonly useZh: readonly string[]
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: input.purposeEn,
    purposeZh: input.purposeZh,
    quickStart: `import { ${input.source}, ${input.codeTable} } from '${input.importPath}'
import { normalizeRpcSerializedError } from '@migaia/rpc-contract/errors'

/** Report the actual received error tree after accepting the closed wire grammar. */
export function reportReceivedFailure(received: unknown) {
  const wire = normalizeRpcSerializedError(received)
  if (wire.source === ${input.source} && wire.code === ${input.codeTable}.${input.member}) {
    console.error(wire)
  }
  return wire
}
// The pair classifies diagnostics; actual execution/outcome and owned resources decide controls.
// After admission the same fields may preserve wire/terminal report wording; they do not change control.
// Third-party adapters attach their own source/code through @migaia/utils/error.`,
    useEn: input.useEn,
    useZh: input.useZh,
    avoidEn: [
      'Parsing display text instead of the documented semantic source/code pair.',
      'Treating copied source/code fields as a retry, cancellation, terminal or close permission.'
    ],
    avoidZh: [
      '解析展示文本，而不是读取已定义的语义 source/code。',
      '把复制的 source/code 字段当作重试、取消、终止或关闭权限。'
    ]
  })
}

/** Explains one B6 family predicate as cross-realm diagnosis rather than local owner identity. */
function errorFamilyGuide(input: {
  readonly name: string
  readonly purposeEn: string
  readonly purposeZh: string
  readonly useEn: readonly string[]
  readonly useZh: readonly string[]
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: input.purposeEn,
    purposeZh: input.purposeZh,
    quickStart: `import { ${input.name}, serializeRpcError } from '@migaia/rpc-core'

/** The reporting boundary classifies a caught value without changing an operation. */
export function reportFamilyFailure(error: unknown) {
  if (!${input.name}(error)) return false
  const wire = serializeRpcError(error, { report: ({ error }) => console.error(error) })
  console.error(wire)
  return true
}
// This public predicate works across realms and module copies without instanceof.
// Public fields may be copied; a match does not prove Core minted private control identity.
// An admitted reason may retain source/code for wire or terminal presentation without gaining control.
// Reconcile actual execution/outcome before any independent retry decision.`,
    useEn: input.useEn,
    useZh: input.useZh,
    avoidEn: [
      'Using family classification to cancel, terminate, close or retire an owned generation.',
      'Equating a received cached cancellation label with Core private live-operation identity.'
    ],
    avoidZh: [
      '用错误族分类取消、终止、关闭或 retire 持有的 generation。',
      '把收到的缓存取消标签等同于 Core 操作私有身份。'
    ]
  })
}

/** Ordinary public error catalogs have concrete protocol-implementer and adapter-author uses. */
/** Each semantic source/code pair shares one maintained diagnostic use case. */
const rpcErrorCatalogGuides = {
  contract: errorIdentityGuide({
    importPath: '@migaia/rpc-contract/errors',
    source: 'RPC_CONTRACT_SOURCE',
    codeTable: 'RpcContractErrorCode',
    member: 'frameLimitExceeded',
    purposeEn:
      'Identifies Contract protocol violations with the unchanged @migaia/rpc/contract source and public code table. A frame quota diagnostic does not itself alter the carrier or replay state.',
    purposeZh:
      '用不变的 @migaia/rpc/contract source 与公开 code 表识别 Contract 协议违例。frame 配额诊断本身不改变载体或 replay 状态。',
    useEn: [
      'An independent protocol receiver reports an invalid envelope, frame, handshake or error tree.',
      'A foreign runtime preserves the same semantic code while implementing the shipped wire-error schema.'
    ],
    useZh: [
      '独立协议接收端需要报告无效 envelope、frame、handshake 或错误树。',
      '外部 runtime 实现随包交付的 wire-error schema，并保留相同语义 code。'
    ]
  }),
  core: errorIdentityGuide({
    importPath: '@migaia/rpc-core',
    source: 'RPC_CORE_ERROR_SOURCE',
    codeTable: 'RpcCoreErrorCode',
    member: 'deadlineExceeded',
    purposeEn:
      'Lists the semantic Core failures that custom adapters may report. A deadline code describes a failure; only the actual logical call outcome can establish whether execution occurred.',
    purposeZh:
      '列出自定义适配器可报告的 Core 语义失败。deadline code 描述失败；只有实际逻辑调用的 outcome 能确定是否发生执行。',
    useEn: [
      'An adapter author classifies a Core failure for reporting without constructing Core private identity.',
      'A caller retains source/code and cause while independently reconciling a lost result.'
    ],
    useZh: [
      '适配器作者需要分类 Core 失败以报告，不构造 Core 私有身份。',
      '调用方独立核对丢失结果时，保留 source/code 与 cause。'
    ]
  }),
  remote: errorIdentityGuide({
    importPath: '@migaia/rpc-core/remote',
    source: 'RPC_REMOTE_ERROR_SOURCE',
    codeTable: 'RpcRemoteLayerErrorCode',
    member: 'resultUnknown',
    purposeEn:
      'Identifies Remote layer failures with the stable @migaia/rpc/remote source. REMOTE_RESULT_UNKNOWN reports a lost result rather than proof that a non-idempotent method did not execute.',
    purposeZh:
      '用稳定的 @migaia/rpc/remote source 识别 Remote 层失败。REMOTE_RESULT_UNKNOWN 表示结果丢失，不证明非幂等方法没有执行。',
    useEn: [
      'A Runtime caller reports an unavailable generation or an unknown result before reconciliation.',
      'A custom diagnostic sink distinguishes Remote contract failures from Core and native transport failures.'
    ],
    useZh: [
      'Runtime 调用方在对账前报告 generation 不可用或结果未知。',
      '自定义诊断 sink 需要区分 Remote contract、Core 与原生 transport 失败。'
    ]
  }),
  process: errorIdentityGuide({
    importPath: '@migaia/rpc-process',
    source: 'RPC_PROCESS_ERROR_SOURCE',
    codeTable: 'RpcProcessErrorCode',
    member: 'usageSampleFailed',
    purposeEn:
      'Identifies actual Process launch, connection, lifecycle and sampling failures with the stable @migaia/rpc/process source. Native details remain reachable through the original cause.',
    purposeZh:
      '用稳定的 @migaia/rpc/process source 识别实际 Process 启动、连接、生命周期与采样失败。原生详情沿原 cause 保持可达。',
    useEn: [
      'A process adapter reports native launch or socket errors without depending on private display text.',
      'A resource view reports sampling unavailable without fabricating CPU or RSS values.'
    ],
    useZh: [
      '进程适配器不依赖私有展示文本地报告原生启动或 socket 错误。',
      '资源视图报告采样 unavailable，不伪造 CPU 或 RSS 数值。'
    ]
  }),
  threads: errorIdentityGuide({
    importPath: '@migaia/rpc-threads',
    source: 'RPC_THREAD_ERROR_SOURCE',
    codeTable: 'RpcThreadErrorCode',
    member: 'usageSampleFailed',
    purposeEn:
      'Identifies the native Worker sampling failure with the stable @migaia/rpc/threads source and THREAD_USAGE_SAMPLE_FAILED code. This diagnostic grants no Worker stop or replacement authority.',
    purposeZh:
      '用稳定的 @migaia/rpc/threads source 与 THREAD_USAGE_SAMPLE_FAILED code 识别原生 Worker 采样失败。此诊断不授予 Worker stop 或 replacement 权限。',
    useEn: [
      'A thread adapter reports an unsupported or failed real Worker resource sample.',
      'An application retains the original sampling cause while showing the measurement unavailable.'
    ],
    useZh: [
      '线程适配器需要报告不支持或失败的真实 Worker 资源采样。',
      '应用保留原采样 cause，同时显示测量 unavailable。'
    ]
  }),
  jsonrpc: errorIdentityGuide({
    importPath: '@migaia/rpc-bridge-jsonrpc',
    source: 'JSONRPC_BRIDGE_ERROR_SOURCE',
    codeTable: 'JsonRpcBridgeErrorCode',
    member: 'frameInvalid',
    purposeEn:
      'Identifies framing, profile, extension and hello-deadline failures with the stable @migaia/rpc/bridge/jsonrpc source. The JSON-RPC integer code policy remains with the foreign peer profile.',
    purposeZh:
      '用稳定的 @migaia/rpc/bridge/jsonrpc source 识别 framing、profile、扩展与 hello deadline 失败。JSON-RPC 整数 code 策略仍归外部 peer profile。',
    useEn: [
      'A foreign-language carrier reports Content-Length or UTF-8 rejection without parsing messages.',
      'A peer maps its actual wire error tree through toJsonRpcError/fromJsonRpcError while preserving semantic identity.'
    ],
    useZh: [
      '外部语言载体不解析 message 文本地报告 Content-Length 或 UTF-8 拒绝。',
      'peer 用 toJsonRpcError/fromJsonRpcError 映射实际 wire 错误树，保留语义身份。'
    ]
  }),
  processAdapter: errorIdentityGuide({
    importPath: '@migaia/rpc-core/adapter/diagnostics',
    source: 'RPC_PROCESS_ERROR_SOURCE',
    codeTable: 'RpcProcessErrorCode',
    member: 'usageSampleFailed',
    purposeEn:
      'Identifies actual Process launch, connection, lifecycle and sampling failures with the stable @migaia/rpc/process source. Native details remain reachable through the original cause.',
    purposeZh:
      '用稳定的 @migaia/rpc/process source 识别实际 Process 启动、连接、生命周期与采样失败。原生详情沿原 cause 保持可达。',
    useEn: [
      'A process adapter reports native launch or socket errors without depending on private display text.',
      'A resource view reports sampling unavailable without fabricating CPU or RSS values.'
    ],
    useZh: [
      '进程适配器不依赖私有展示文本地报告原生启动或 socket 错误。',
      '资源视图报告采样 unavailable，不伪造 CPU 或 RSS 数值。'
    ]
  }),
  threadsAdapter: errorIdentityGuide({
    importPath: '@migaia/rpc-core/adapter/threads',
    source: 'RPC_THREAD_ERROR_SOURCE',
    codeTable: 'RpcThreadErrorCode',
    member: 'usageSampleFailed',
    purposeEn:
      'Identifies the native Worker sampling failure with the stable @migaia/rpc/threads source and THREAD_USAGE_SAMPLE_FAILED code. This diagnostic grants no Worker stop or replacement authority.',
    purposeZh:
      '用稳定的 @migaia/rpc/threads source 与 THREAD_USAGE_SAMPLE_FAILED code 识别原生 Worker 采样失败。此诊断不授予 Worker stop 或 replacement 权限。',
    useEn: [
      'A thread adapter reports an unsupported or failed real Worker resource sample.',
      'An application retains the original sampling cause while showing the measurement unavailable.'
    ],
    useZh: [
      '线程适配器需要报告不支持或失败的真实 Worker 资源采样。',
      '应用保留原采样 cause，同时显示测量 unavailable。'
    ]
  }),
  jsonrpcAdapter: errorIdentityGuide({
    importPath: '@migaia/rpc-contract/framing/jsonrpc',
    source: 'JSONRPC_BRIDGE_ERROR_SOURCE',
    codeTable: 'JsonRpcBridgeErrorCode',
    member: 'frameInvalid',
    purposeEn:
      'Identifies framing, profile, extension and hello-deadline failures with the stable @migaia/rpc/bridge/jsonrpc source. The JSON-RPC integer code policy remains with the foreign peer profile.',
    purposeZh:
      '用稳定的 @migaia/rpc/bridge/jsonrpc source 识别 framing、profile、扩展与 hello deadline 失败。JSON-RPC 整数 code 策略仍归外部 peer profile。',
    useEn: [
      'A foreign-language carrier reports Content-Length or UTF-8 rejection without parsing messages.',
      'A peer maps its actual wire error tree through toJsonRpcError/fromJsonRpcError while preserving semantic identity.'
    ],
    useZh: [
      '外部语言载体不解析 message 文本地报告 Content-Length 或 UTF-8 拒绝。',
      'peer 用 toJsonRpcError/fromJsonRpcError 映射实际 wire 错误树，保留语义身份。'
    ]
  })
}

/** Concrete source/code and family guides for the ordinary third-party error surface. */
const rpcPublicErrorGuides = {
  'rpc-contract:errors:RPC_CONTRACT_SOURCE': rpcErrorCatalogGuides.contract,
  'rpc-contract:errors:RpcContractErrorCode': rpcErrorCatalogGuides.contract,
  'rpc-core:index:RpcCoreErrorCode': rpcErrorCatalogGuides.core,
  'rpc-core:remote:RPC_REMOTE_ERROR_SOURCE': rpcErrorCatalogGuides.remote,
  'rpc-core:remote:RpcRemoteLayerErrorCode': rpcErrorCatalogGuides.remote,
  'rpc-process:index:RPC_PROCESS_ERROR_SOURCE': rpcErrorCatalogGuides.process,
  'rpc-process:index:RpcProcessErrorCode': rpcErrorCatalogGuides.process,
  'rpc-threads:index:RPC_THREAD_ERROR_SOURCE': rpcErrorCatalogGuides.threads,
  'rpc-threads:index:RpcThreadErrorCode': rpcErrorCatalogGuides.threads,
  'rpc-bridge-jsonrpc:index:JSONRPC_BRIDGE_ERROR_SOURCE': rpcErrorCatalogGuides.jsonrpc,
  'rpc-bridge-jsonrpc:index:JsonRpcBridgeErrorCode': rpcErrorCatalogGuides.jsonrpc,
  'rpc-core:index:isRpcErrorInstance': errorFamilyGuide({
    name: 'isRpcErrorInstance',
    purposeEn:
      'Recognizes a Core diagnostic error family by its stable source, known code and family name across realms or module copies. Unlike isRpcError, it checks the family; it still cannot attest private local construction.',
    purposeZh:
      '跨 realm 或模块副本，用稳定 source、已知 code 与族 name 识别 Core 诊断错误族。比 isRpcError 多检查错误族，但仍不能证明本地私有构造身份。',
    useEn: [
      'An adapter classifies a received or cross-realm Core failure for a diagnostic sink.',
      'A consumer reads the public RpcError type without importing a runtime constructor.'
    ],
    useZh: [
      '适配器需要为诊断 sink 分类接收或跨 realm 的 Core 失败。',
      '消费方需要读取公开 RpcError type，不导入运行时构造器。'
    ]
  }),
  'rpc-core:index:isRpcRemoteError': errorFamilyGuide({
    name: 'isRpcRemoteError',
    purposeEn:
      'Recognizes the RpcRemoteError diagnostic family across realms using Core source, its family name and the remote string code domain. The remote business code is preserved; a match does not prove delivery or execution state.',
    purposeZh:
      '跨 realm 用 Core source、RpcRemoteError 族 name 与远端 string code 域识别诊断族。保留远端业务 code；匹配不证明送达或执行状态。',
    useEn: [
      'A caller reports the provider business code and cause after receiving a remote failure.',
      'A relay distinguishes the remote error family while preserving its unrestricted business code.'
    ],
    useZh: [
      '调用方收到远端失败后需要报告 provider 业务 code 与 cause。',
      'relay 需要区分远端错误族，同时保留其不受限业务 code。'
    ]
  }),
  'rpc-core:index:isRpcTimeoutError': errorFamilyGuide({
    name: 'isRpcTimeoutError',
    purposeEn:
      'Recognizes the coded TimeoutError diagnostic family across realms or copies. A timeout description does not prove that the provider failed to execute, and cannot mint a local timer or cancellation identity.',
    purposeZh:
      '跨 realm 或副本识别编码 TimeoutError 诊断族。超时描述不证明 provider 未执行，也不能产生本地 timer 或取消身份。',
    useEn: [
      'A reporting boundary records a deadline failure without relying on same-realm instanceof.',
      'A caller diagnoses a timeout while separately consulting actual execution/outcome facts.'
    ],
    useZh: [
      '报告边界不依赖同 realm instanceof 地记录 deadline 失败。',
      '调用方诊断超时时，独立查询真实 execution/outcome 事实。'
    ]
  }),
  'rpc-core:adapter-diagnostics:RPC_PROCESS_ERROR_SOURCE': rpcErrorCatalogGuides.processAdapter,
  'rpc-core:adapter-diagnostics:RpcProcessErrorCode': rpcErrorCatalogGuides.processAdapter,
  'rpc-core:adapter-threads:RPC_THREAD_ERROR_SOURCE': rpcErrorCatalogGuides.threadsAdapter,
  'rpc-core:adapter-threads:RpcThreadErrorCode': rpcErrorCatalogGuides.threadsAdapter,
  'rpc-contract:framing-jsonrpc:JSONRPC_BRIDGE_ERROR_SOURCE': rpcErrorCatalogGuides.jsonrpcAdapter,
  'rpc-contract:framing-jsonrpc:JsonRpcBridgeErrorCode': rpcErrorCatalogGuides.jsonrpcAdapter
}

/** Stable protocol discriminants used by adapters, diagnostics, and tests. */
const webRpcConstantGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'rpc:protocol-constants:RpcMessageKind': constantGuide({
    name: 'RpcMessageKind',
    roleEn: 'wire-envelope kind set',
    roleZh: 'wire-envelope kind 集合',
    member: 'request',
    value: 'request envelope'
  }),
  'rpc:protocol-constants:RpcVariation': constantGuide({
    name: 'RpcVariation',
    roleEn: 'control variation set',
    roleZh: 'control variation 集合',
    member: 'abort',
    value: 'abort control frame'
  }),
  'rpc-core:transport-constants:RpcPlatform': constantGuide({
    name: 'RpcPlatform',
    roleEn: 'transport platform labels',
    roleZh: 'transport platform label',
    member: 'worker',
    value: 'Worker transport'
  }),
  'rpc-core:transport-constants:RpcTransportOwnership': constantGuide({
    name: 'RpcTransportOwnership',
    roleEn: 'transport custody modes',
    roleZh: 'transport custody mode',
    member: 'borrowed',
    value: 'remove listeners without closing the host resource'
  }),
  'rpc-core:transport-constants:RpcTransportEncoding': constantGuide({
    name: 'RpcTransportEncoding',
    roleEn: 'transport encoding capabilities',
    roleZh: 'transport encoding capability',
    member: 'uint8Array',
    value: 'binary encoded frames'
  }),
  'rpc-core:transport-constants:RpcTransportTopology': constantGuide({
    name: 'RpcTransportTopology',
    roleEn: 'peer fan-out and trust topology labels',
    roleZh: 'peer fan-out 与 trust topology label',
    member: 'multiplexed',
    value: 'several logical peers share a channel'
  }),
  'rpc-core:transport-constants:RpcEndpointStatus': constantGuide({
    name: 'RpcEndpointStatus',
    roleEn: 'discovery-visible endpoint states',
    roleZh: 'discovery-visible endpoint state',
    member: 'active',
    value: 'endpoint accepts work'
  }),
  'rpc-core:transport-constants:RpcOperation': constantGuide({
    name: 'RpcOperation',
    roleEn: 'single-target operation labels',
    roleZh: 'single-target operation label',
    member: 'send',
    value: 'request and response operation'
  }),
  'rpc:protocol-constants:RpcControlKind': constantGuide({
    name: 'RpcControlKind',
    roleEn: 'provider-control admission kinds',
    roleZh: 'provider-control admission kind',
    member: 'request',
    value: 'provider request work'
  }),
  'rpc-core:transport-constants:RpcCandidateStatus': constantGuide({
    name: 'RpcCandidateStatus',
    roleEn: 'discovery candidate states',
    roleZh: 'discovery candidate state',
    member: 'stale',
    value: 'candidate is known but not currently active'
  }),
  'rpc:protocol-constants:RpcContractFailureKind': constantGuide({
    name: 'RpcContractFailureKind',
    roleEn: 'structured contract failure kinds',
    roleZh: 'structured contract failure kind',
    member: 'schemaValidation',
    value: 'schema rejected boundary data'
  }),
  'rpc:protocol-constants:RpcDebugPhase': constantGuide({
    name: 'RpcDebugPhase',
    roleEn: 'test-only endpoint lifecycle snapshot phases',
    roleZh: 'test-only endpoint lifecycle snapshot phase',
    member: 'disposed',
    value: 'endpoint reached terminal disposal'
  }),
  'rpc:protocol-constants:RpcChunkEvent': constantGuide({
    name: 'RpcChunkEvent',
    roleEn: 'chunk admission and expiry hook names',
    roleZh: 'chunk admission 与 expiry hook name',
    member: 'rejected',
    value: 'chunk admission was rejected'
  })
}

/**
 * Canonical examples and decision boundaries are shared only by the protocol operations they
 * actually invoke.
 */
const rpcProtocolGuideContexts = {
  binary: {
    quickStart:
      "import { captureRpcBinaryData, prepareRpcBinary, RpcBinaryStorage } from '@migaia/rpc-contract/binary'\nimport { prepareRpcBinary as prepareColdRpcBinary, restoreRpcBinary } from '@migaia/rpc-contract/binary/lazy'\nimport type { IRpcRuntimeEnvelope } from '@migaia/rpc-contract/runtime'\n\n/** Capture at the application's chosen point, then finish that same snapshot later. */\nexport async function captureOutgoing(envelope: IRpcRuntimeEnvelope) {\n  const captured = captureRpcBinaryData(envelope, RpcBinaryStorage.inline, 1_048_576)\n  return await captured.prepare()\n}\n\n/** The eager entry prepares this actual outgoing envelope. */\nexport async function prepareOutgoing(envelope: IRpcRuntimeEnvelope) {\n  return await prepareRpcBinary(envelope, RpcBinaryStorage.inline, 1_048_576)\n}\n\n/** A carrier that chooses the light entry uses the same canonical operation name. */\nexport async function prepareColdOutgoing(envelope: IRpcRuntimeEnvelope) {\n  return await prepareColdRpcBinary(envelope, RpcBinaryStorage.inline, 1_048_576)\n}\n/** Restore an actual received inline manifest at the receiver's existing asynchronous stage. */\nexport async function restoreIncoming(manifest: unknown) {\n  return await restoreRpcBinary(manifest, RpcBinaryStorage.inline, [])\n}\n// The carrier sends manifest and sidecars from the returned preparation result.\n// Native storage additionally needs the authentication owner's whole-backing digest.",
    useEn: [
      'An independent carrier needs the canonical manifest and actual binary backing accounting.',
      'The application must preserve the existing capture point before cold loading or asynchronous preparation.'
    ],
    useZh: [
      '独立载体需要规范 manifest 与真实二进制 backing 计量。',
      '应用需要在冷加载或异步准备前保留既有捕获点。'
    ],
    avoidEn: [
      'Use Core/Remote when the requirement is an authenticated endpoint rather than protocol data.',
      'A copied codec or prepared payload cannot qualify a channel or grant transfer ownership.'
    ],
    avoidZh: [
      '需要已鉴权 endpoint 时应使用 Core/Remote，协议数据操作不能替代连接构造。',
      '复制 codec 或 prepared payload 不能授予通道资格或转移所有权。'
    ]
  },
  nativeInspection: {
    quickStart:
      "import {\n  assertRpcNativeBinaryFrameSize, hasRpcBinaryEnvelope,\n  isRpcBinaryIntegrityFailure, measureRpcNativeBinaryFrame, readRpcNativeBinary,\n  rpcBinaryBackingLength, rpcBinaryView\n} from '@migaia/rpc-contract/binary/inspect'\nimport type { IRpcRuntimeEnvelope } from '@migaia/rpc-contract/runtime'\n\n/** Admit the received wrapper's actual backing size before expensive integrity work. */\nexport function inspectReceived(value: unknown, limit: number) {\n  const packet = readRpcNativeBinary(value, limit)\n  if (!packet) return undefined\n  const bytes = measureRpcNativeBinaryFrame(\n    packet.protectedMetadata, packet.sidecars.length, packet.backingBytes\n  )\n  assertRpcNativeBinaryFrameSize(\n    packet.protectedMetadata, packet.sidecars.length, packet.backingBytes, limit\n  )\n  const backings = packet.sidecars.map((backing) => ({\n    byteLength: rpcBinaryBackingLength(backing),\n    view: rpcBinaryView(new Uint8Array(backing))\n  }))\n  return { packet, bytes, backings }\n}\n\n/** Branch on the proof retained by the canonical envelope normalizer. */\nexport function containsBinary(envelope: IRpcRuntimeEnvelope) {\n  return hasRpcBinaryEnvelope(envelope)\n}\n\n/** An actual restoration failure is classified without changing its native cause. */\nexport async function receiveRestored(\n  restore: () => Promise<IRpcRuntimeEnvelope>, report: (error: unknown) => void\n) {\n  try { return await restore() }\n  catch (error) {\n    if (isRpcBinaryIntegrityFailure(error)) report(error)\n    throw error\n  }\n}",
    useEn: [
      'A native carrier must admit its actual received wrapper before digest work.',
      'A protocol implementation needs real backing/view measurements or local integrity diagnostics.'
    ],
    useZh: [
      'native 载体需要在摘要工作前接纳实际收到的 wrapper。',
      '协议实现需要真实 backing/view 计量或本地完整性诊断。'
    ],
    avoidEn: [
      'Do not treat a passed outer-wrapper check as completed authentication or SHA verification.',
      'Only supported non-shared ArrayBuffer and Uint8Array resources belong to this native profile.'
    ],
    avoidZh: [
      '不能把外层 wrapper 检查通过当作已完成鉴权或 SHA 验证。',
      '该 native profile 只接受支持的非共享 ArrayBuffer 与 Uint8Array 资源。'
    ]
  },
  errors: {
    quickStart:
      "import {\n  deserializeRpcError, fromJsonRpcError, normalizeRpcSerializedError,\n  reachRpcError, serializeRpcError, toJsonRpcError,\n  RpcJsonRpcWireError, RpcWireErrorField, RpcWireErrorLimit\n} from '@migaia/rpc-contract/errors'\nimport wireErrorSchema from '@migaia/rpc-contract/schema/wire-error' with { type: 'json' }\n\n/** Foreign protocol implementations reuse the same shipped grammar and error extension. */\nexport const errorProtocol = {\n  schema: wireErrorSchema, fieldOrder: RpcWireErrorField,\n  limits: RpcWireErrorLimit, jsonRpcDataKey: RpcJsonRpcWireError.dataKey\n}\n\n/** Encode the caller's real failure; its reporting policy owns serialization diagnostics. */\nexport function encodeFailure(error: unknown, report: (error: unknown) => void, jsonRpcCode: number) {\n  const options = { report: ({ error: failure }: { error: unknown }) => report(failure) }\n  const reachable = [...reachRpcError(error, options)]\n  const wire = serializeRpcError(error, options)\n  const jsonRpc = toJsonRpcError(wire, jsonRpcCode)\n  return { reachable, wire, jsonRpc }\n}\n\n/** Validate an untrusted response before reconstructing its native error graph. */\nexport function receiveFailure(jsonRpc: unknown) {\n  const wire = normalizeRpcSerializedError(fromJsonRpcError(jsonRpc))\n  return deserializeRpcError(wire)\n}\n// The JSON-RPC adapter owns jsonRpcCode; Contract does not invent an integer code policy.\n// Core/Remote errors use the corresponding Core error operations for their private metadata.",
    useEn: [
      'A custom protocol implementation must carry the actual bounded error chain across a language boundary.',
      'A diagnostic consumer needs the original local failure identities or validated remote reconstruction.'
    ],
    useZh: [
      '自定义协议实现需要把实际有界错误链带过语言边界。',
      '诊断消费方需要原本地失败身份或已验证远端错误恢复。'
    ],
    avoidEn: [
      'Use Core error operations for Core/Remote private redaction and forwarding metadata.',
      'The bridge owns integer JSON-RPC codes; these data conversions do not mint package errors.'
    ],
    avoidZh: [
      'Core/Remote 私有脱敏与 forwarding metadata 应使用 Core 的错误操作。',
      'bridge 拥有 JSON-RPC 整数 code；这些数据转换不会铸造任意包错误。'
    ]
  },
  physicalFrames: {
    quickStart:
      "import {\n  assertRpcPhysicalFrameSize, inspectRpcPhysicalFrame,\n  measureRpcPhysicalFrame, readRpcBatchMembers\n} from '@migaia/rpc-contract/framing'\n\n/** Admit one complete encoded representation, rather than only one semantic batch member. */\nexport function admitPhysicalFrame(frame: unknown, limit: number) {\n  assertRpcPhysicalFrameSize(frame, limit)\n  return readRpcBatchMembers(frame)\n}\n\n/** A custom encoder reuses one inspection while partitioning its actual queued members. */\nexport function partitionFrame<T>(frame: unknown, members: T[], limit: number) {\n  const inspection = inspectRpcPhysicalFrame(frame, limit)\n  return { bytes: inspection.bytes, groups: inspection.splitBatch(members) }\n}\n\n/** Read a physical byte count when no partitioning or admission operation is needed. */\nexport function frameBytes(frame: unknown) { return measureRpcPhysicalFrame(frame) }",
    useEn: [
      'A custom encoder must enforce the existing complete physical-message byte limit.',
      'An actual queued batch needs partitioning from one owned measurement.'
    ],
    useZh: [
      '自定义 encoder 需要执行既有完整物理消息字节上限。',
      '实际排队 batch 需要复用一次持有的计量结果进行划分。'
    ],
    avoidEn: [
      'A batch wrapper does not validate its members or establish negotiated batch agreement.',
      "Use the carrier's own sending and queue lifetime; these functions do not schedule work."
    ],
    avoidZh: [
      'batch wrapper 不会验证每个成员，也不能建立已协商 batch agreement。',
      '发送与队列寿命使用载体自己的 owner；这些函数不负责调度。'
    ]
  },
  jsonRpcFrames: {
    quickStart:
      "import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '@migaia/rpc-contract/framing/jsonrpc'\n\n/** The carrier owns actual byte writes, message handling, and closure. */\nexport function createCarrierProtocol(\n  write: (frame: Uint8Array) => Promise<void>, receive: (message: unknown) => void\n) {\n  const decoder = createJsonRpcFrameDecoder()\n  return {\n    send: (message: unknown) => write(encodeJsonRpcFrame(message)),\n    push: (chunk: Uint8Array) => {\n      for (const message of decoder.push(chunk)) receive(message)\n    },\n    finish: () => decoder.finish(),\n    close: () => decoder.close()\n  }\n}",
    useEn: [
      'A custom ordered-byte carrier implements Content-Length framing for foreign peers.',
      "The same decoder must retain a partial frame across the carrier's actual read chunks."
    ],
    useZh: [
      '自定义有序字节载体为外部 peer 实现 Content-Length framing。',
      '同一 decoder 需要跨载体实际 read chunk 保留未完成帧。'
    ],
    avoidEn: [
      'The framer is not a completed authenticated hello or a correlated RPC endpoint.',
      "A malformed terminal frame must propagate to the carrier's existing error/close owner."
    ],
    avoidZh: [
      'framer 不能代替已鉴权 hello 或具有调用关联的 RPC endpoint。',
      '末尾非法帧应传递给载体既有的错误与关闭 owner。'
    ]
  },
  bootstrapHandoff: {
    quickStart:
      "import { createRpcBootstrapFrameReceiver } from '@migaia/rpc-contract/framing/stream'\n\n/** Hand off an actual bootstrap frame to the carrier's business-frame consumer. */\nexport async function acceptBootstrap(\n  frame: Uint8Array, onFrame: (frame: Uint8Array) => void, onError: (error: Error) => void\n) {\n  const receiver = createRpcBootstrapFrameReceiver()\n  const error = receiver.accept(frame)\n  if (error) receiver.fail(error)\n  const bootstrap = await receiver.bootstrap\n  const detach = receiver.attach(onFrame, onError)\n  receiver.activate()\n  return { bootstrap, receiver, detach }\n}\n// Feed later complete frames through receiver.accept; detach when the carrier closes.\n// Carrier failures call receiver.fail with their original Error.",
    useEn: [
      'A custom framed carrier owns its real bootstrap-to-handshake handoff.',
      'The carrier must retain the first bootstrap and activate its existing business consumer later.'
    ],
    useZh: [
      '自定义完整帧载体拥有实际 bootstrap 到 handshake 交接。',
      '载体需要保留首个 bootstrap，并稍后激活既有业务消费者。'
    ],
    avoidEn: [
      'The receiver does not acquire native I/O or execution lifetime ownership.',
      'Pass the actual original failure to fail; copied permission records cannot replace held resources.'
    ],
    avoidZh: [
      'receiver 不会取得 native I/O 或执行资源的寿命所有权。',
      'fail 使用实际原错误；复制权限记录不能代替持有的资源。'
    ]
  },
  handshakeFrames: {
    quickStart:
      "import { createRpcHandshakeFrameReceiver, RpcHandshakeRole } from '@migaia/rpc-contract/framing/stream'\n\n/** A responder receives one complete handshake frame before activating business traffic. */\nexport async function receiveHello(frame: Uint8Array) {\n  const receiver = createRpcHandshakeFrameReceiver({ role: RpcHandshakeRole.responder })\n  const error = receiver.accept(frame)\n  if (error instanceof Error) { receiver.close(error); throw error }\n  const helloText = await receiver.readHandshakeFrame()\n  return { helloText, receiver }\n}\n// After the real handshake owner accepts the offer, call beginAccept and activate.\n// Close with the carrier's actual failure or cancellation reason.",
    useEn: [
      'A carrier receives complete frames but needs the retained initiator/responder grammar.',
      'Its actual handshake owner decides when retained business frames can be activated.'
    ],
    useZh: [
      '载体接收完整帧但需要保留 initiator/responder 的协议语法。',
      '实际 handshake owner 需要决定何时激活保留的业务帧。'
    ],
    avoidEn: [
      'Use the existing channel constructor when no custom receive handoff is needed.',
      'Role and frame data are protocol inputs, not proof of native resource ownership.'
    ],
    avoidZh: [
      '不需要自定义接收交接时应使用既有完整 channel constructor。',
      'role 与 frame 数据是协议输入，不是 native 资源所有权证明。'
    ]
  },
  streamFrames: {
    quickStart:
      "import { createRpcStreamFrameDecoderWithLimit, encodeRpcStreamTextFrame } from '@migaia/rpc-contract/framing/stream'\n\n/** The carrier changes its own phase limit and supplies complete-payload/error consumers. */\nexport function framedTextCarrier(\n  onFrame: (frame: Uint8Array) => void, onError: (error: Error) => void,\n  currentLimit: () => number, write: (frame: Uint8Array) => Promise<void>\n) {\n  const decoder = createRpcStreamFrameDecoderWithLimit({ onFrame, onError }, currentLimit)\n  const encoder = new TextEncoder()\n  return {\n    send: (text: string) => write(encodeRpcStreamTextFrame(text, encoder)),\n    push: (chunk: Uint8Array) => decoder.push(chunk),\n    finish: () => decoder.finish(),\n    close: () => decoder.close()\n  }\n}",
    useEn: [
      'A custom process-like carrier receives arbitrary native byte chunks.',
      'The actual connection phase supplies its live payload limit before allocation.'
    ],
    useZh: [
      '自定义进程类载体接收任意 native 字节 chunk。',
      '实际连接阶段需要在分配前提供当前 payload 上限。'
    ],
    avoidEn: [
      'Already complete string messages use the Contract string framer instead.',
      "Do not create a second receiver queue or change the carrier's first-error policy."
    ],
    avoidZh: [
      '已保证完整字符串消息的载体应使用 Contract string framer。',
      '不能新增第二条 receiver 队列或改变载体原 first-error 策略。'
    ]
  },
  handshakeData: {
    quickStart:
      "import { RpcCodecId, RpcPeerRuntime, RpcProtocol } from '@migaia/rpc-contract'\nimport { acceptRpcHandshake, completeRpcHandshake, createRpcHello, normalizeRpcHandshake } from '@migaia/rpc-contract/handshake'\n\nconst client = {\n  peer: { id: 'client', runtime: RpcPeerRuntime.node },\n  versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],\n  codecs: [RpcCodecId.json], capabilities: []\n}\nconst service = { ...client, peer: { id: 'service', runtime: RpcPeerRuntime.node } }\nconst hello = createRpcHello(client)\nconst received = normalizeRpcHandshake(hello)\nconst acceptance = acceptRpcHandshake(service, hello)\nif (!acceptance.ok) throw acceptance.error\nconst agreement = completeRpcHandshake(client, acceptance.reply)\nconsole.log(received.step, agreement.codec)\n// These are protocol proposals and negotiated data. The real carrier still owns authentication.",
    useEn: [
      'An independent protocol carrier exchanges the actual hello and accept/reject messages.',
      'An initiator or responder needs the exact common version/codec/capability result.'
    ],
    useZh: [
      '独立协议载体需要交换实际 hello 与 accept/reject 消息。',
      'initiator 或 responder 需要精确的共同版本、codec 与 capability 结果。'
    ],
    avoidEn: [
      'The real channel still owns token verification, resource identity and lifetime.',
      'Do not replace bounded redacted failures with an error that embeds the received token or input.'
    ],
    avoidZh: [
      '真实 channel 仍拥有 token 验证、资源身份与生命周期。',
      '不能把有界脱敏失败替换成嵌入收到的 token 或输入的错误。'
    ]
  },
  portableValues: {
    quickStart:
      "import { normalizePortable } from '@migaia/rpc-contract/portable'\nimport { normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'\nimport { hasRpcBinaryEnvelope } from '@migaia/rpc-contract/binary/inspect'\n\n/** Admit one business value for the legacy portable wire grammar. */\nexport function snapshotBusinessValue(value: unknown) {\n  return normalizePortable(value)\n}\n\n/** A runtime protocol receiver validates its actual envelope before selecting a binary profile. */\nexport function inspectRuntimeEnvelope(decoded: unknown) {\n  const envelope = normalizeRuntimeEnvelope(decoded)\n  return { envelope, hasBinary: hasRpcBinaryEnvelope(envelope) }\n}\n// Retain the canonical snapshot; a copied record cannot substitute for its binary proof.\n// This data operation does not authorize transfer or negotiate channel capabilities.",
    useEn: [
      'An independent protocol implementation admits an actual business value at its supported profile boundary.',
      'The caller needs the canonical snapshot and its already retained binary proof.'
    ],
    useZh: [
      '独立协议实现需要在支持的 profile 边界接纳实际业务值。',
      '调用者需要规范 snapshot 及其已保留的二进制证明。'
    ],
    avoidEn: [
      'Use the negotiated native profile only when that actual connection supports it.',
      'Do not reimplement the portable walker or use normalization as transfer authorization.'
    ],
    avoidZh: [
      '只有实际连接已支持时才能使用协商后的 native profile。',
      '不能重写 portable walker，也不能把归一化当作转移授权。'
    ]
  },
  runtimeData: {
    quickStart:
      "import {\n  normalizeRuntimeEnvelope, normalizeRuntimeGeneration, normalizeRuntimeSteps,\n  readRuntimeCarrier, runtimeOperationCapabilities, wrapRuntimeCarrier,\n  type IRpcRuntimeOptions, RpcRuntimeMode\n} from '@migaia/rpc-contract/runtime'\n\n/** A protocol implementation admits the real decoded data before dispatching it. */\nexport function admitRuntimeData(envelope: unknown, steps: unknown, generation: unknown) {\n  return {\n    envelope: normalizeRuntimeEnvelope(envelope),\n    steps: normalizeRuntimeSteps(steps),\n    generation: normalizeRuntimeGeneration(generation)\n  }\n}\n\n/** Only the authentication owner interprets the selected protected output. */\nexport function selectProtectedOutput(frame: unknown) {\n  return readRuntimeCarrier(wrapRuntimeCarrier(frame))?.frame\n}\n\n/** These are AND dependencies of the selected operation, not an inferred offer closure. */\nexport function requiredCapabilities(mode: RpcRuntimeMode, options?: IRpcRuntimeOptions) {\n  return runtimeOperationCapabilities(mode, options)\n}",
    useEn: [
      'A protocol implementer validates the received closed runtime union before dispatch.',
      'A custom carrier needs the fixed selector or exact dependencies of an opted-in operation.'
    ],
    useZh: [
      '协议实现者需要在 dispatch 前验证收到的封闭 runtime union。',
      '自定义载体需要固定 selector 或显式 operation 的精确依赖。'
    ],
    avoidEn: [
      'These projections cannot mint launch, replay, batch or codec trust for a transport.',
      'Core/Remote still owns provider execution, logical retry and held execution controls.'
    ],
    avoidZh: [
      '这些数据投影不能为 transport 铸造 launch、replay、batch 或 codec 信任。',
      'Core/Remote 仍拥有 provider 执行、逻辑重试与持有的执行控制权。'
    ]
  },
  lazyParsing: {
    quickStart:
      "import { normalizeRuntimeEnvelope, normalizeStreamPayload } from '@migaia/rpc-contract/runtime/lazy'\n\n/** Await only at a receiver's existing asynchronous continuation. */\nexport async function receiveRuntimeEnvelope(decoded: unknown) {\n  return await normalizeRuntimeEnvelope(decoded)\n}\n\n/** An independent stream receiver shares the same canonical cold parser. */\nexport async function receiveStreamPayload(decoded: unknown) {\n  return await normalizeStreamPayload(decoded)\n}\n// Scalar envelope branches retain synchronous results; a cold stream branch may return a Promise.\n// The caller propagates the original parser failure and retains its actual stream state.",
    useEn: [
      'An existing asynchronous receiver wants the canonical parser without loading every stream branch eagerly.',
      'The carrier preserves its original decode continuation and error cause when cold loading is required.'
    ],
    useZh: [
      '既有异步 receiver 需要规范 parser，但无需提前加载所有 stream 分支。',
      '冷加载必要时，载体需要保留原 decode continuation 与错误 cause。'
    ],
    avoidEn: [
      'Do not force ordinary synchronous scalar parsing into a new asynchronous boundary.',
      'Lazy parsing does not own sequence, credit, cancellation or iterator cleanup.'
    ],
    avoidZh: [
      '不能为普通同步 scalar 解析制造新的异步边界。',
      'lazy parser 不拥有序列、credit、取消或 iterator cleanup。'
    ]
  },
  streamFinish: {
    quickStart:
      "import { checkRpcRuntimeStreamFinish, checkRpcRuntimeStreamIntent, checkRpcRuntimeStreamTransition } from '@migaia/rpc-contract/stream'\nimport type { IRpcRuntimeOptions, IRpcRuntimeStream } from '@migaia/rpc-contract/runtime'\n\n/** Validate a real received finish against the options retained by the stream owner. */\nexport function receiveFinish(\n  control: Pick<IRpcRuntimeStream, 'event'>, options: Pick<IRpcRuntimeOptions, 'cancel'>\n) {\n  const error = checkRpcRuntimeStreamTransition(control, options)\n  if (error) throw error\n}\n\n/** An early control is checked at its own existing held-intent boundary. */\nexport function earlyFinish(finish: boolean, options: Pick<IRpcRuntimeOptions, 'cancel'>) {\n  const error = checkRpcRuntimeStreamIntent({ finish }, options)\n  if (error) throw error\n}\n\n/** Use after the protocol owner has already observed an actual finish discriminator. */\nexport function admittedFinish(options: Pick<IRpcRuntimeOptions, 'cancel'>) {\n  const error = checkRpcRuntimeStreamFinish(options)\n  if (error) throw error\n}",
    useEn: [
      'A runtime stream implementation has received an actual finish control or retained early intent.',
      'The owner checks that control against the original admitted cancellation options.'
    ],
    useZh: [
      'runtime stream 实现已经收到实际 finish control 或保留 early intent。',
      'owner 需要按原已接纳取消 options 检查该 control。'
    ],
    avoidEn: [
      'Only the actual owner decides terminal transitions, cancellation and iterator cleanup.',
      'A validation result cannot create a stream exchange or acknowledge a missing call.'
    ],
    avoidZh: [
      '只有实际 owner 决定终态转换、取消与 iterator cleanup。',
      '校验结果不能创建 stream exchange，也不能确认缺失的调用。'
    ]
  },
  streamCredit: {
    quickStart:
      "import {\n  checkRpcStreamInitialSequence, checkRpcStreamSequence, checkRpcStreamProgress,\n  checkRpcStreamConsumerCredit, checkRpcStreamProducerCredit,\n  measurePortableStreamValue, normalizeStreamPayload, RpcStreamEvent,\n  type IRpcStreamSequence, type IRpcStreamConsumerCredit, type IRpcStreamProducerCredit\n} from '@migaia/rpc-contract/stream'\n\n/** Validate a received event before the implementation touches its held stream state. */\nexport function admitStreamPayload(value: unknown, expected: IRpcStreamSequence | undefined) {\n  const payload = normalizeStreamPayload(value)\n  const error = payload.event === RpcStreamEvent.open\n    ? checkRpcStreamInitialSequence(payload)\n    : checkRpcStreamSequence(payload, expected)\n  if (error) throw error\n  return { payload, bytes: payload.value === undefined ? 0 : measurePortableStreamValue(payload.value) }\n}\n\n/** Consumer and producer checks use different actual held resources. */\nexport function consumerCredit(payload: IRpcStreamSequence, state: IRpcStreamConsumerCredit) {\n  const error = checkRpcStreamConsumerCredit(payload, state)\n  if (error) throw error\n}\nexport function producerCredit(payload: IRpcStreamSequence, state: IRpcStreamProducerCredit) {\n  const error = checkRpcStreamProducerCredit(payload, state)\n  if (error) throw error\n}\nexport function terminalProgress(payload: IRpcStreamSequence, state: IRpcStreamSequence) {\n  const error = checkRpcStreamProgress(payload, state)\n  if (error) throw error\n}\n// The implementation still owns credit updates, cancellation and iterator cleanup.",
    useEn: [
      'An independent stream protocol validates actual received payloads and held exchange state.',
      'The existing consumer/producer owner needs exact sequence, credit or item-byte admission.'
    ],
    useZh: [
      '独立 stream 协议需要验证实际收到的 payload 与持有的 exchange 状态。',
      '既有 consumer/producer owner 需要精确序列、credit 或 item 字节准入。'
    ],
    avoidEn: [
      'Direction and resource cleanup remain with the existing stream owner.',
      'Use actual held pending/busy state; received labels cannot prove protocol credit.'
    ],
    avoidZh: [
      '方向与资源 cleanup 仍由既有 stream owner 管理。',
      '使用实际持有的 pending/busy 状态，收到的标签不能证明协议 credit。'
    ]
  }
}

/**
 * The frozen standalone toolkit keys each bind a concrete operation to its maintained bilingual use
 * case.
 */
const rpcProtocolToolkitGuides = {
  'rpc-contract:v1:normalizeRpcEnvelope': guide({
    purposeEn:
      'Validates an actual received protocol-1 envelope and returns its canonical snapshot. The receiver still owns authentication, routing and execution; Contract failures retain their native type, source/code and original cause.',
    purposeZh:
      '验证实际收到的 protocol-1 envelope，返回规范快照。鉴权、路由与执行仍归接收端；Contract 失败保留原生类型、source/code 与原 cause。',
    quickStart:
      "import { normalizeRpcEnvelope } from '@migaia/rpc-contract/v1'\nimport { classifyRpcContractError } from '@migaia/rpc-contract/errors'\n\n/** Admit real decoded protocol input before the receiver dispatches it. */\nexport function admitEnvelope(decoded: unknown) {\n  try {\n    return normalizeRpcEnvelope(decoded)\n  } catch (error) {\n    const summary = classifyRpcContractError(error)\n    if (summary) console.error(summary.code, summary.message)\n    throw error\n  }\n}\n// Diagnostic projection preserves the original failure and grants no channel or execution rights.",
    useEn: [
      'An independent protocol-1 receiver validates the closed envelope grammar before dispatch.',
      'A custom carrier needs the canonical snapshot and the original coded validation failure.'
    ],
    useZh: [
      '独立 protocol-1 接收方需要在 dispatch 前验证封闭 envelope grammar。',
      '自定义载体需要规范快照与原编码校验失败。'
    ],
    avoidEn: [
      'Using normalization to claim authentication, replay admission or provider execution.',
      'Passing an unsupported runtime-envelope union through the protocol-1 validator.'
    ],
    avoidZh: [
      '用归一化声称已鉴权、接纳 replay 或执行 provider。',
      '把不受支持的 runtime-envelope union 交给 protocol-1 validator。'
    ]
  }),
  'rpc-contract:binary:captureRpcBinaryData': guide({
    ...rpcProtocolGuideContexts.binary,
    purposeEn:
      'Captures one actual runtime envelope synchronously and returns an opaque resource whose prepare() finishes that same snapshot later. Inline bytes are copied at capture; native backings retain their original identities.',
    purposeZh:
      '同步捕获一个实际 runtime envelope，返回只能通过 prepare() 完成同一快照的不透明资源。inline 字节在捕获时复制，native backing 保留原身份；不开放可变 scratch 或传输授信。'
  }),
  'rpc-contract:binary:prepareRpcBinary': guide({
    ...rpcProtocolGuideContexts.binary,
    purposeEn:
      'Prepares a runtime envelope with the selected storage profile and actual codec, returning its canonical manifest, ordered native sidecars and complete backing-byte count. The caller supplies a whole-backing digest for native storage.',
    purposeZh:
      '按实际 storage profile 与持有的 codec 准备 runtime envelope，返回规范 manifest、按序 native sidecar 和完整 backing 字节数。native storage 的完整 backing 摘要由原鉴权 owner 提供。'
  }),
  'rpc-contract:binary:restoreRpcBinary': guide({
    ...rpcProtocolGuideContexts.binary,
    purposeEn:
      'Restores a received canonical binary manifest using the already loaded codec. Native storage verifies the actual whole-backing digest and preserves backing identities; this protocol data operation does not authenticate or authorize a transport.',
    purposeZh:
      '用已加载的规范 codec 恢复收到的 binary manifest。native storage 校验实际完整 backing 摘要并保留 backing 身份；此协议数据操作不负责鉴权或授予 transport 权限。',
    quickStart:
      "import { restoreRpcBinary, RpcBinaryStorage, type IRpcBinaryDigest } from '@migaia/rpc-contract/binary'\n\n/** Restore the actual inline metadata after its carrier admits and authenticates the frame. */\nexport async function restoreInline(manifest: unknown) {\n  return await restoreRpcBinary(manifest, RpcBinaryStorage.inline, [])\n}\n\n/** The carrier supplies the real native sidecars and its actual whole-backing SHA-256 digest. */\nexport async function restoreNative(\n  manifest: unknown, sidecars: readonly ArrayBuffer[], digest: IRpcBinaryDigest\n) {\n  return await restoreRpcBinary(manifest, RpcBinaryStorage.native, sidecars, undefined, digest)\n}\n// Retain the actual backing references; restoration does not create transfer or execution rights."
  }),
  'rpc-contract:binary:restoreRpcBinaryDecoded': guide({
    purposeEn:
      'Restores binary metadata only from canonical codec output, preserving the existing digest and Promise boundary. Reading own enumerable metadata properties executes getters. This entry does not accept or validate caller-constructed objects; use restoreRpcBinary from the same subpath for strict object validation.',
    purposeZh:
      '仅恢复 canonical codec 输出中的 binary metadata，保留既有摘要与 Promise 边界。读取自有可枚举 metadata 属性会执行 getter。此入口不接受、不校验调用方构造的对象；严格对象校验使用同一子路径的 restoreRpcBinary。',
    quickStart: `import { restoreRpcBinaryDecoded, restoreRpcBinary, RpcBinaryStorage } from '@migaia/rpc-contract/binary'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

/** Retain the canonical JSON decoder at the actual receive boundary. */
const codec = defineJsonCodec({ version: 1 })

/** Decode actual received inline metadata before selecting decoded admission. */
export async function restoreReceivedText(text: string) {
  return await restoreRpcBinaryDecoded(codec.decode(text), RpcBinaryStorage.inline, [])
}

/** Caller-constructed manifests require strict object admission. */
export async function restoreCallerManifest(manifest: unknown) {
  return await restoreRpcBinary(manifest, RpcBinaryStorage.inline, [])
}
// Native storage also requires the actual sidecars and the owner's whole-backing digest.
// Codec provenance does not authenticate a carrier or authorize transfer.`,
    useEn: [
      'The actual receive owner holds output produced by its canonical JSON or native structured-clone decoder.',
      'The receiver retains its existing binary budget, sidecars and native whole-backing integrity stage.'
    ],
    useZh: [
      '实际接收 owner 持有 canonical JSON 或原生结构化克隆 decoder 产生的输出。',
      '接收端需要保留既有 binary 预算、sidecar 与 native 完整 backing 校验阶段。'
    ],
    avoidEn: [
      'Caller-constructed objects or custom codec output require restoreRpcBinary from @migaia/rpc-contract/binary.',
      'Do not treat metadata admission as authentication, replay admission or transfer permission.'
    ],
    avoidZh: [
      '调用方构造的对象或自定义 codec 输出应使用 @migaia/rpc-contract/binary 的 restoreRpcBinary。',
      '不能把 metadata 准入当作鉴权、replay 准入或 transfer 权限。'
    ]
  }),
  'rpc-contract:binary-inspect:assertRpcNativeBinaryFrameSize': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      "Enforces the complete native frame limit from protected metadata, actual sidecar count and full backing bytes. It returns nothing on admission and preserves the Contract owner's native coded failure when the physical representation exceeds the limit.",
    purposeZh:
      '用 protected metadata、实际 sidecar 数量与完整 backing 字节数检查 native 物理帧上限。通过时无返回值；超限保留 Contract owner 的原生编码错误，不只按可见 view 长度计量。'
  }),
  'rpc-contract:binary-inspect:hasRpcBinaryEnvelope': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      'Reads the binary-bearing proof retained by the canonical envelope normalization. It returns a boolean without recursively inspecting business payloads again; it does not negotiate storage or qualify a channel.',
    purposeZh:
      '读取规范 envelope 归一化时保留的二进制证明，返回布尔值而不再次递归扫描业务 payload。它不负责协商 storage，也不授予通道资格；调用者应保留原快照。'
  }),
  'rpc-contract:binary-inspect:isRpcBinaryIntegrityFailure': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      'Classifies a real binary restoration failure caused by complete-backing length or SHA mismatch. It distinguishes local integrity evidence from structural grammar failures without replacing the error or its cause.',
    purposeZh:
      '分类完整 backing 长度或 SHA 不一致导致的真实二进制恢复失败，区分本地完整性事实与结构语法错误。接收实际错误，返回布尔结果，不替换错误对象或 cause。'
  }),
  'rpc-contract:binary-inspect:measureRpcNativeBinaryFrame': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      'Counts the exact native selector, protected-metadata representation and complete backing bytes using actual sidecar count. It returns the physical byte charge without serializing caller-owned sidecars.',
    purposeZh:
      '按实际 sidecar 数量计算 native selector、protected metadata 表示与完整 backing 的物理字节费用，返回数字；不会序列化调用者持有的 sidecar，也不只计可见片段。'
  }),
  'rpc-contract:binary-inspect:readRpcNativeBinary': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      'Admits a received native wrapper against the outer grammar and backing-count/size limit before expensive hashing. It returns the actual protected metadata, ordered sidecars and backing-byte total, or undefined for a non-native representation.',
    purposeZh:
      '在昂贵摘要前按外层语法、backing 数量与大小上限接纳收到的 native wrapper。返回真实 protected metadata、按序 sidecar 与 backing 总字节数；不是该表示时返回 undefined。'
  }),
  'rpc-contract:binary-inspect:rpcBinaryBackingLength': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      'Reads the complete byte length from a genuine ArrayBuffer internal slot. It returns the whole backing length, including bytes outside a view, for a carrier that must account for actual transferred memory.',
    purposeZh:
      '从真正 ArrayBuffer 的内部 slot 读取完整字节长度，包含 view 外的 backing 字节。返回数字，供载体计量实际转移内存；不是读取调用者可覆盖的同名属性。'
  }),
  'rpc-contract:binary-inspect:rpcBinaryView': guide({
    ...rpcProtocolGuideContexts.nativeInspection,
    purposeEn:
      'Reads a supported Uint8Array backed by a non-shared ArrayBuffer and returns its genuine backing, offset and visible length. This is a data-inspection operation and grants no ownership-transfer permission.',
    purposeZh:
      '读取受支持的、由非共享 ArrayBuffer 支持的 Uint8Array，返回真实 backing、offset 与可见长度。这是数据检查操作，不授予内存所有权转移权限，也不支持其它 view 域。'
  }),
  'rpc-contract:binary-lazy:prepareRpcBinary': guide({
    ...rpcProtocolGuideContexts.binary,
    purposeEn:
      'Prepares the same canonical binary representation while allowing cold codec loading. It retains the synchronous capture point and the first native digest boundary before asynchronous completion.',
    purposeZh:
      '在允许冷加载 codec 的同时准备同一规范二进制表示；异步完成前保留原同步捕获点与第一次 native digest 边界。返回真实 manifest、sidecar 与 backing 计量，不重走业务图。'
  }),
  'rpc-contract:binary-lazy:restoreRpcBinary': guide({
    ...rpcProtocolGuideContexts.binary,
    purposeEn:
      'Restores an actual received binary manifest through the canonical decoder after cold loading. It preserves the original asynchronous integrity stage and transferred backing identities; the carrier still owns authentication, admission and closure.',
    purposeZh:
      '冷加载后通过规范 decoder 恢复实际收到的 binary manifest，保留原异步完整性阶段与传来的 backing 身份。载体继续拥有鉴权、准入和关闭；数据恢复不授予运行时权限。'
  }),
  'rpc-contract:binary-lazy:restoreRpcBinaryDecoded': guide({
    purposeEn:
      'Restores binary metadata only from canonical codec output while allowing cold codec loading. Reading own enumerable metadata properties executes getters. This entry does not accept or validate caller-constructed objects; use restoreRpcBinary from the same lazy subpath for strict object validation.',
    purposeZh:
      '仅恢复 canonical codec 输出中的 binary metadata，并允许冷加载 codec。读取自有可枚举 metadata 属性会执行 getter。此入口不接受、不校验调用方构造的对象；严格对象校验使用同一 lazy 子路径的 restoreRpcBinary。',
    quickStart: `import { restoreRpcBinaryDecoded, restoreRpcBinary, RpcBinaryStorage } from '@migaia/rpc-contract/binary/lazy'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

/** Keep the canonical JSON decoder owned by this receive boundary. */
const codec = defineJsonCodec({ version: 1 })

/** Continue at the receiver's existing asynchronous binary restoration stage. */
export async function restoreReceivedText(text: string) {
  return await restoreRpcBinaryDecoded(codec.decode(text), RpcBinaryStorage.inline, [])
}

/** Caller-constructed manifests still use the strict lazy entry. */
export async function restoreCallerManifest(manifest: unknown) {
  return await restoreRpcBinary(manifest, RpcBinaryStorage.inline, [])
}
// Native storage also requires the actual sidecars and the owner's whole-backing digest.
// Loading the codec does not create authentication or transfer permission.`,
    useEn: [
      'The receive owner has actual canonical decoder output and needs the existing cold binary codec path.',
      'The receiver retains the original asynchronous restoration and full-backing digest stage.'
    ],
    useZh: [
      '接收 owner 持有真实 canonical decoder 输出，并需要既有冷加载 binary codec 路径。',
      '接收端需要保留原异步恢复与完整 backing 摘要阶段。'
    ],
    avoidEn: [
      'Caller-constructed objects or custom codec output require restoreRpcBinary from @migaia/rpc-contract/binary/lazy.',
      'Cold loading and successful data restoration do not authorize authentication, replay or transfer.'
    ],
    avoidZh: [
      '调用方构造的对象或自定义 codec 输出应使用 @migaia/rpc-contract/binary/lazy 的 restoreRpcBinary。',
      '冷加载与数据恢复成功不能授予鉴权、replay 或 transfer 权限。'
    ]
  }),
  'rpc-contract:errors:deserializeRpcError': guide({
    ...rpcProtocolGuideContexts.errors,
    purposeEn:
      "Validates the entire untrusted serialized error tree before reconstructing its native Error graph. It retains the accepted stack/cause/errors chain and can write validated forwarding routes to the caller's actual route map.",
    purposeZh:
      '在重建原生 Error 图前验证完整不可信序列化错误树，保留已接纳的 stack、cause 与 errors 链。可把验证后的 forwarding route 写入调用者实际持有的 route map，不提供注册器。'
  }),
  'rpc-contract:errors:fromJsonRpcError': guide({
    ...rpcProtocolGuideContexts.errors,
    purposeEn:
      "Recovers the canonical RPC error extension from a JSON-RPC response, or synthesizes one bounded wire node for a foreign peer. It returns protocol error data rather than selecting the adapter's integer error code policy.",
    purposeZh:
      '从 JSON-RPC response 恢复规范 RPC error extension；外部 peer 没有 extension 时合成一个有界 wire node。返回协议错误数据，不替适配器选择整数错误码策略。'
  }),
  'rpc-contract:errors:normalizeRpcSerializedError': guide({
    ...rpcProtocolGuideContexts.errors,
    purposeEn:
      'Validates and freezes a fresh wire error tree before a receiver consumes its fields. Malformed depth, shape, text or budget keeps the original Contract failure boundary; successful output is a canonical serialized error.',
    purposeZh:
      '在接收端使用字段前验证并冻结一份新的 wire error tree，检查深度、形状、文本与预算。成功返回规范序列化错误；非法输入保留原 Contract 失败边界与原因。'
  }),
  'rpc-contract:errors:reachRpcError': guide({
    ...rpcProtocolGuideContexts.errors,
    purposeEn:
      "Walks the same cause and AggregateError edges used by error projection without the wire-depth limit, deduplicating object identities. The returned generator is useful for the caller's own diagnostic classification of an actual local failure.",
    purposeZh:
      '沿错误投影相同的 cause 与 AggregateError 边遍历真实本地失败，按对象身份去重，但不施加 wire 深度上限。返回 generator，供调用者自己的诊断分类；它不生成线上错误树。'
  }),
  'rpc-contract:errors:serializeRpcError': guide({
    ...rpcProtocolGuideContexts.errors,
    purposeEn:
      'Projects an actual thrown value into a bounded, frozen, language-neutral error tree. The caller supplies its reporting policy and optional maps for exact held error references; transport trust and arbitrary error minting are outside this operation.',
    purposeZh:
      '把实际抛出值投影为有界、冻结、语言无关的错误树。调用者提供报告策略与可选的真实错误引用 maps；该操作不授予 transport trust，也不提供任意包错误铸造能力。'
  }),
  'rpc-contract:errors:toJsonRpcError': guide({
    ...rpcProtocolGuideContexts.errors,
    purposeEn:
      'Maps a validated serialized RPC error into JSON-RPC using the integer code supplied by the bridge owner. It preserves the canonical extension instead of inventing a second error-chain or integer-code registry.',
    purposeZh:
      '使用 bridge owner 提供的整数 code，把已验证序列化 RPC 错误映射到 JSON-RPC，并保留规范 extension。不会建立第二份错误链或整数错误码注册表。'
  }),
  'rpc-contract:framing:assertRpcPhysicalFrameSize': guide({
    ...rpcProtocolGuideContexts.physicalFrames,
    purposeEn:
      'Checks the whole physical encoded frame against its byte limit. It returns nothing for an admitted frame and preserves the native Contract error when one semantic envelope or batch representation exceeds the limit.',
    purposeZh:
      '按字节上限检查完整物理编码帧。通过时无返回值；单 envelope 或 batch 表示超限时保留 Contract 原生错误。语义成员大小不能代替完整帧计量。'
  }),
  'rpc-contract:framing:inspectRpcPhysicalFrame': guide({
    ...rpcProtocolGuideContexts.physicalFrames,
    purposeEn:
      "Measures one complete encoded frame and returns its byte charge plus splitBatch for the caller's actual queued members. Recursive partitioning reuses that inspection; an oversize singleton retains the original native RangeError.",
    purposeZh:
      '计量一个完整编码帧，返回字节费用与对调用者实际排队成员使用的 splitBatch。递归划分复用同一次检查；无法继续划分的超大 singleton 保留原生 RangeError。'
  }),
  'rpc-contract:framing:measureRpcPhysicalFrame': guide({
    ...rpcProtocolGuideContexts.physicalFrames,
    purposeEn:
      'Returns the bytes of a complete physical representation. Encoded byte carriers reuse actual bytes, while object frames measure their complete encoded form; the caller retains its original codec and queue ownership.',
    purposeZh:
      '返回完整物理表示的字节数。已编码字节载体复用实际 bytes，object frame 按完整编码形式计量；调用者继续持有原 codec 与队列，函数不执行发送或分片。'
  }),
  'rpc-contract:framing:readRpcBatchMembers': guide({
    ...rpcProtocolGuideContexts.physicalFrames,
    purposeEn:
      'Reads a codec-decoded physical batch wrapper and returns its actual semantic members, or undefined when the value is not a batch. Each returned member remains independently untrusted until its own envelope normalization.',
    purposeZh:
      '读取 codec 解出的物理 batch wrapper，返回实际语义成员；不是 batch 时返回 undefined。每个成员仍需独立 envelope 归一化，读取 wrapper 本身不会赋予语义信任。'
  }),
  'rpc-contract:framing-jsonrpc:createJsonRpcFrameDecoder': guide({
    ...rpcProtocolGuideContexts.jsonRpcFrames,
    purposeEn:
      'Creates a bounded incremental Content-Length decoder for an actual byte carrier. push returns complete decoded messages, finish checks a truncated terminal frame, and close releases the retained framing state.',
    purposeZh:
      '为实际字节载体创建有界增量 Content-Length decoder。push 返回完整解码消息，finish 检查末尾截断帧，close 释放保留的 framing 状态；载体仍拥有 I/O 与关闭动作。'
  }),
  'rpc-contract:framing-jsonrpc:encodeJsonRpcFrame': guide({
    ...rpcProtocolGuideContexts.jsonRpcFrames,
    purposeEn:
      'Encodes one JSON-RPC value into a normalized ASCII Content-Length header and UTF-8 body in one physical write chunk. The returned Uint8Array can be written by the actual carrier without splitting the protocol representation.',
    purposeZh:
      '把一个 JSON-RPC 值编码为规范 ASCII Content-Length header 与 UTF-8 body，返回可由实际载体一次写出的 Uint8Array。它不拥有 socket，也不建立 hello 或调用关联状态。'
  }),
  'rpc-contract:framing-stream:createRpcBootstrapFrameReceiver': guide({
    ...rpcProtocolGuideContexts.bootstrapHandoff,
    purposeEn:
      'Creates the bootstrap-to-handshake receive handoff for a custom complete-frame carrier. It retains the bootstrap Promise and at most one following handshake frame; attach/activate hand off to the real consumer, while fail preserves the original carrier error.',
    purposeZh:
      '为自定义完整帧载体创建 bootstrap 到 handshake 的接收交接，保留 bootstrap Promise 与至多一个后续 handshake frame。attach/activate 交给实际消费者；fail 使用原载体错误。'
  }),
  'rpc-contract:framing-stream:createRpcHandshakeFrameReceiver': guide({
    ...rpcProtocolGuideContexts.handshakeFrames,
    purposeEn:
      'Creates a protocol receiver with the actual retained role options. It reads the handshake text, retains pre-activation traffic and hands it off only after the carrier activates; close retains the actual cancellation or failure reason.',
    purposeZh:
      '使用实际保留的 role options 创建协议 receiver，读取 handshake 文本并保留激活前流量；仅在载体 activate 后交接。close 使用实际取消或失败原因，不拥有 native 执行资源。'
  }),
  'rpc-contract:framing-stream:createRpcStreamFrameDecoderWithLimit': guide({
    ...rpcProtocolGuideContexts.streamFrames,
    purposeEn:
      "Creates a length-prefixed incremental decoder whose live phase limit is read before payload allocation. Complete frames and the first malformed-frame error go to the carrier's existing callbacks; finish and close preserve its framing lifecycle.",
    purposeZh:
      '创建长度前缀增量 decoder，在分配 payload 前读取载体当前阶段上限。完整 frame 与第一个非法帧错误交原回调；finish 与 close 保留 framing 生命周期，不引入新的接收策略。'
  }),
  'rpc-contract:framing-stream:encodeRpcStreamTextFrame': guide({
    ...rpcProtocolGuideContexts.streamFrames,
    purposeEn:
      "Uses the caller's actual text encoder to emit the final length-prefixed process frame, optionally reusing provided storage. The returned bytes retain the connection's existing backing ownership and physical-message boundary.",
    purposeZh:
      '使用调用者实际 text encoder 生成最终长度前缀进程帧，可复用提供的 storage。返回字节保持连接原 backing 所有权与物理消息边界；函数本身不发送或关闭连接。'
  }),
  'rpc-contract:handshake:acceptRpcHandshake': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      "Negotiates common protocol version, codec and capabilities from the responder's actual offer and received hello. It returns an acceptance reply/agreement or a rejection reply/original error without retaining the received input in diagnostics.",
    purposeZh:
      '按 responder 的实际 offer 与收到的 hello 协商共同协议版本、codec 和 capabilities，返回 acceptance reply/agreement 或 rejection reply/原错误。诊断不保留收到的输入；仍需实际载体鉴权。'
  }),
  'rpc-contract:handshake:completeRpcHandshake': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      "Verifies a responder's actual reply against the initiator's retained local offer and returns the negotiated agreement. Unsupported choices reject at the canonical Contract boundary without creating channel or execution authority.",
    purposeZh:
      '按 initiator 保留的本地 offer 验证 responder 实际 reply，返回协商 agreement。无法接受的选择在规范 Contract 边界拒绝，不因此创建通道或执行权限。'
  }),
  'rpc-contract:handshake:createRpcHello': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      "Encodes the initiator's local protocol offer into the first-channel UTF-8 JSON hello text. Invalid offers preserve the bounded redacted failure policy instead of retaining the caller's original token or data subtree.",
    purposeZh:
      '把 initiator 本地协议 offer 编码为首通道 UTF-8 JSON hello 文本。非法 offer 保留有界脱敏失败策略，不保留调用者原 token 或数据子树；返回文本供实际载体发送。'
  }),
  'rpc-contract:handshake:normalizeRpcHandshake': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      'Validates received first-channel handshake text or bytes into the closed hello/accept/reject union. Invalid syntax or fields retain only the bounded diagnostic summary; normalization itself grants no authenticated peer identity.',
    purposeZh:
      '把收到的首通道 handshake 文本或 bytes 验证为封闭 hello/accept/reject union。非法语法或字段只保留有界诊断摘要；归一化本身不赋予已鉴权 peer 身份。'
  }),

  'rpc-contract:portable:normalizePortable': guide({
    ...rpcProtocolGuideContexts.portableValues,
    purposeEn:
      'Validates and snapshots a portable value using the existing wire profile, recursion bound and ordinary-field read points. It returns canonical wire-compatible data and keeps the original native failure for unsupported values or cycles.',
    purposeZh:
      '按既有 wire profile、递归上限与普通字段读取点验证并快照 portable value，返回规范 wire-compatible 数据。不可支持的值或循环保持原生失败；不是为载体增加新 codec。'
  }),

  'rpc-contract:runtime:normalizeRuntimeEnvelope': guide({
    ...rpcProtocolGuideContexts.runtimeData,
    purposeEn:
      'Synchronously validates the complete runtime-envelope union and snapshots its business slots at the original parser boundary. It returns a canonical runtime envelope or the original native coded error before dispatch touches application state.',
    purposeZh:
      '在原 parser 边界同步验证完整 runtime envelope union，并快照业务 slot。返回规范 runtime envelope 或原生编码错误；在 dispatch 接触应用状态前完成，不替调用方改变控制权。'
  }),
  'rpc-contract:runtime:normalizeRuntimeEnvelopeDecoded': guide({
    purposeEn:
      'Synchronously normalizes the runtime union only from canonical codec output. Reading own enumerable metadata properties executes getters. This entry does not accept or validate caller-constructed objects; use normalizeRuntimeEnvelope from the same subpath for strict object validation.',
    purposeZh:
      '仅从 canonical codec 输出同步归一化 runtime union。读取自有可枚举 metadata 属性会执行 getter。此入口不接受、不校验调用方构造的对象；严格对象校验使用同一子路径的 normalizeRuntimeEnvelope。',
    quickStart: `import { normalizeRuntimeEnvelopeDecoded, normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

/** The receive owner retains the actual canonical JSON decoder. */
const codec = defineJsonCodec({ version: 1 })

/** Select decoded admission only for the decoder's actual output. */
export function receiveRuntimeText(text: string) {
  return normalizeRuntimeEnvelopeDecoded(codec.decode(text))
}

/** Validate caller-constructed objects through the strict entry. */
export function admitCallerObject(value: unknown) {
  return normalizeRuntimeEnvelope(value)
}
// Canonical decoding proves data provenance, not authentication or execution permission.`,
    useEn: [
      'The actual receive owner has output from its canonical JSON or native structured-clone decoder.',
      'The receiver needs the shared runtime union and native error boundary without a new asynchronous stage.'
    ],
    useZh: [
      '实际接收 owner 持有 canonical JSON 或原生结构化克隆 decoder 的输出。',
      '接收端需要共享 runtime union 与原生错误边界，且不增加异步阶段。'
    ],
    avoidEn: [
      'Caller-constructed objects or custom codec output require normalizeRuntimeEnvelope from @migaia/rpc-contract/runtime.',
      'Do not use normalization to claim authenticated identity, replay admission or provider execution.'
    ],
    avoidZh: [
      '调用方构造的对象或自定义 codec 输出应使用 @migaia/rpc-contract/runtime 的 normalizeRuntimeEnvelope。',
      '不能用归一化声称已鉴权身份、replay 准入或 provider 执行权限。'
    ]
  }),
  'rpc-contract:runtime:normalizeRuntimeGeneration': guide({
    ...rpcProtocolGuideContexts.runtimeData,
    purposeEn:
      'Snapshots the closed generation fields as nonnegative safe integers issued by their real owners. The returned protocol data can be compared by an implementation, but copying it never grants launch, replay or replacement authority.',
    purposeZh:
      '把封闭 generation 字段快照为真实 owner 发出的非负安全整数，返回供协议实现比较的数据。复制 generation 不会取得 launch、replay 或 replacement 权限。'
  }),
  'rpc-contract:runtime:normalizeRuntimeSteps': guide({
    ...rpcProtocolGuideContexts.runtimeData,
    purposeEn:
      'Validates the actual closed request-only group steps and snapshots each portable business input once. It returns the canonical ordered step list without running providers, retrying a call or rolling back previously executed effects.',
    purposeZh:
      '验证实际封闭 request-only group steps，并把每个 portable 业务输入快照一次，返回规范有序步骤列表。不会运行 provider、重试调用，也不会回滚已发生的副作用。'
  }),
  'rpc-contract:runtime:readRuntimeCarrier': guide({
    ...rpcProtocolGuideContexts.runtimeData,
    purposeEn:
      'Reads only the fixed runtime selector from a received carrier representation. A selected object has two own data fields, and the returned frame remains opaque protection output until the canonical authentication owner consumes it.',
    purposeZh:
      '只读取收到的 carrier 表示中的固定 runtime selector。选中对象具有两个自有 data fields，返回 frame 在规范鉴权 owner 消费前仍是 opaque protection output，不携带权限授信。'
  }),
  'rpc-contract:runtime:runtimeOperationCapabilities': guide({
    ...rpcProtocolGuideContexts.runtimeData,
    purposeEn:
      'Returns the exact AND capability dependencies of the explicitly selected runtime operation and options. It does not infer an offer closure, mutate negotiation or authorize an operation merely because a label is present.',
    purposeZh:
      '返回显式选择 runtime operation 与 options 的精确 AND capability 依赖列表。不会推导 offer closure、修改协商，也不会因标签存在就授予操作权；实际 channel 仍负责验证。'
  }),
  'rpc-contract:runtime:wrapRuntimeCarrier': guide({
    ...rpcProtocolGuideContexts.runtimeData,
    purposeEn:
      "Adds the fixed parser selector while preserving the original protection output's value category. It returns carrier data for the existing receiver and creates no batch, replay, codec or execution trust facts.",
    purposeZh:
      '在保留原 protection output 值类别的同时附加固定 parser selector，返回供既有接收端使用的 carrier 数据。不会创建 batch、replay、codec 或执行授信事实。'
  }),
  'rpc-contract:runtime-metadata:createRuntimeCallEnvelope': guide({
    purposeEn:
      "Constructs one outgoing call from the actual owner's typed route, task, id and options. It reuses canonical field validation in the existing order, admits the payload last and freezes new snapshots without freezing caller inputs. It does not grant transport, generation or execution authority.",
    purposeZh:
      '用实际 owner 提供的 typed route、task、id 与 options 构造一个出站 call。按既有顺序复用规范字段校验，最后接纳 payload，并冻结新快照而不冻结调用方输入。此操作不授予 transport、generation 或执行权限。',
    quickStart: `import { createRuntimeCallEnvelope, type IRpcRuntimeCallHeader } from '@migaia/rpc-contract/runtime/metadata'
import { normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'
import type { IRpcPortableValue } from '@migaia/rpc-contract'

/** The route and generation owners supply their real held header fields. */
export function createOutgoingCall(header: IRpcRuntimeCallHeader, payload?: IRpcPortableValue) {
  return createRuntimeCallEnvelope(header, payload)
}

/** Received or arbitrary object input requires the complete strict union parser. */
export function admitReceivedEnvelope(value: unknown) {
  return normalizeRuntimeEnvelope(value)
}
// Construction does not allocate a provider, authenticate a peer or authorize a send.`,
    useEn: [
      'An outgoing protocol owner already holds the typed call header and its actual route and generation facts.',
      'The owner needs canonical call field validation and one payload snapshot before its existing send stage.'
    ],
    useZh: [
      '出站协议 owner 已持有 typed call header 及真实 route 与 generation 事实。',
      'owner 需要在既有发送阶段前进行规范 call 字段校验，并只快照一次 payload。'
    ],
    avoidEn: [
      'Received or arbitrary objects require normalizeRuntimeEnvelope from @migaia/rpc-contract/runtime.',
      'Do not construct group, control or outcome variants with this call-only operation.'
    ],
    avoidZh: [
      '收到的或任意对象应使用 @migaia/rpc-contract/runtime 的 normalizeRuntimeEnvelope。',
      '此操作仅构造 call，不能用于构造 group、control 或 outcome variant。'
    ]
  }),
  'rpc-contract:runtime-lazy:normalizeRuntimeEnvelope': guide({
    ...rpcProtocolGuideContexts.lazyParsing,
    purposeEn:
      'Normalizes the same complete runtime-envelope union while letting only its actual stream branch cold-load the canonical parser. It returns the existing synchronous value or a Promise at that cold boundary; rejection retains the original cause.',
    purposeZh:
      '归一化同一完整 runtime envelope union，仅让实际 stream 分支冷加载规范 parser。返回既有同步值，或在该冷边界返回 Promise；拒绝保留原 cause，不为普通 scalar 分支制造异步加载。'
  }),
  'rpc-contract:runtime-lazy:normalizeRuntimeEnvelopeDecoded': guide({
    purposeEn:
      'Normalizes the runtime union only from canonical codec output; an actual cold stream branch may return a Promise. Reading own enumerable metadata properties executes getters. This entry does not accept or validate caller-constructed objects; use normalizeRuntimeEnvelope from the same lazy subpath for strict object validation.',
    purposeZh:
      '仅从 canonical codec 输出归一化 runtime union；实际冷 stream 分支可能返回 Promise。读取自有可枚举 metadata 属性会执行 getter。此入口不接受、不校验调用方构造的对象；严格对象校验使用同一 lazy 子路径的 normalizeRuntimeEnvelope。',
    quickStart: `import { normalizeRuntimeEnvelopeDecoded, normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime/lazy'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

/** The canonical decoder remains owned by the actual receive boundary. */
const codec = defineJsonCodec({ version: 1 })

/** Await at the receiver's existing continuation when a cold stream parser is needed. */
export async function receiveRuntimeText(text: string) {
  return await normalizeRuntimeEnvelopeDecoded(codec.decode(text))
}

/** Caller-constructed objects use the strict lazy parser. */
export async function admitCallerObject(value: unknown) {
  return await normalizeRuntimeEnvelope(value)
}
// Scalar branches stay synchronous inside the parser; only a cold stream branch may yield.
// Successful normalization does not grant authentication or stream lifecycle authority.`,
    useEn: [
      'The receive owner holds actual canonical decoder output at an existing asynchronous continuation.',
      'An actual stream branch needs cold parser loading while scalar normalization keeps its synchronous result.'
    ],
    useZh: [
      '接收 owner 在既有异步 continuation 持有真实 canonical decoder 输出。',
      '实际 stream 分支需要冷加载 parser，同时 scalar 归一化保留同步结果。'
    ],
    avoidEn: [
      'Caller-constructed objects or custom codec output require normalizeRuntimeEnvelope from @migaia/rpc-contract/runtime/lazy.',
      'Do not use lazy normalization as sequence, credit, cancellation or iterator cleanup authority.'
    ],
    avoidZh: [
      '调用方构造的对象或自定义 codec 输出应使用 @migaia/rpc-contract/runtime/lazy 的 normalizeRuntimeEnvelope。',
      '不能把 lazy 归一化当作序列、credit、取消或 iterator cleanup 的控制权。'
    ]
  }),
  'rpc-contract:runtime-lazy:normalizeStreamPayload': guide({
    ...rpcProtocolGuideContexts.lazyParsing,
    purposeEn:
      "Shares the canonical stream payload parser through the receiver's existing asynchronous continuation. It returns the canonical payload or a cold-load Promise and keeps the original parsing error and actual stream-owner state separate.",
    purposeZh:
      '通过 receiver 既有异步 continuation 复用规范 stream payload parser，返回规范 payload 或冷加载 Promise。保留原解析错误；解析数据与实际 stream owner 状态仍分开。'
  }),
  'rpc-contract:stream:checkRpcRuntimeStreamFinish': guide({
    ...rpcProtocolGuideContexts.streamFinish,
    purposeEn:
      'Checks the actual admitted call options after the protocol owner has observed a finish control. It returns the original coded protocol Error or undefined, leaving cancellation, terminal state and cleanup to that owner.',
    purposeZh:
      '在协议 owner 已观察到 finish control 后检查实际已接纳调用 options，返回原编码协议 Error 或 undefined。取消、终态和 cleanup 继续由该 owner 管理，不以数据检查代替状态转换。'
  }),
  'rpc-contract:stream:checkRpcRuntimeStreamIntent': guide({
    ...rpcProtocolGuideContexts.streamFinish,
    purposeEn:
      'Checks an actual retained early-control finish intent against its call options. It returns the existing protocol Error or undefined while retaining the original discriminator and short-circuit behavior.',
    purposeZh:
      '按实际调用 options 检查保留的 early-control finish intent，返回既有协议 Error 或 undefined，并保留原 discriminator 与短路读取行为；不会替 owner 创建早期控制状态。'
  }),
  'rpc-contract:stream:checkRpcRuntimeStreamTransition': guide({
    ...rpcProtocolGuideContexts.streamFinish,
    purposeEn:
      "Checks a real runtime stream finish event against its start options; other controls do not consume this rule. It returns the original protocol Error or undefined without moving the owner's stream state or releasing its resources.",
    purposeZh:
      '按 start options 检查真实 runtime stream finish event，其它 control 不使用该规则。返回原协议 Error 或 undefined，不移动 owner 的 stream 状态，也不释放资源。'
  }),
  'rpc-contract:stream:checkRpcStreamConsumerCredit': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      "Checks one received consumer response against the stream owner's actual pending credit and sequence. It returns the original protocol Error or undefined and reads pending credit only after the sequence matches.",
    purposeZh:
      '按 stream owner 实际 pending credit 与序列检查一次收到的 consumer response。返回原协议 Error 或 undefined；仅在序列匹配后读取 credit，状态更新与 iterator cleanup 仍由原 owner 执行。'
  }),
  'rpc-contract:stream:checkRpcStreamInitialSequence': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      "Checks an actual received open frame against the protocol's initial sequence. It returns the original coded stream Error or undefined before the implementation installs or advances its stream exchange.",
    purposeZh:
      '按协议初始序列检查实际收到的 open frame，在实现安装或推进 stream exchange 前返回原编码 stream Error 或 undefined；不会替调用者登记 exchange。'
  }),
  'rpc-contract:stream:checkRpcStreamProducerCredit': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      "Checks one producer pull against the owner's actual sequence and in-flight busy state. It returns the original protocol Error or undefined, preserving sequence-before-busy reads without starting another producer operation.",
    purposeZh:
      '按 owner 的实际序列与 in-flight busy 状态检查一次 producer pull，返回原协议 Error 或 undefined，保留先序列后 busy 的读取顺序，不启动另一个 producer operation。'
  }),
  'rpc-contract:stream:checkRpcStreamProgress': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      "Checks terminal stream progress against the owner's actual sequence. A runtime terminal notification can advance past discarded items but cannot go backwards; the result is the original Error or undefined, not a state mutation.",
    purposeZh:
      '按 owner 实际序列检查 stream terminal progress。runtime terminal notification 可推进到被丢弃 item 之后但不能倒退；返回原 Error 或 undefined，不改变状态。'
  }),
  'rpc-contract:stream:checkRpcStreamSequence': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      'Checks one actual frame against a held stream exchange sequence. An absent exchange cannot acknowledge cancellation; the function returns the original coded Error or undefined while leaving exchange lifetime to the implementation.',
    purposeZh:
      '按持有的 stream exchange 序列检查一次实际 frame。缺失 exchange 不能确认取消；返回原编码 Error 或 undefined，exchange 的寿命仍由原协议实现维护。'
  }),
  'rpc-contract:stream:measurePortableStreamValue': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      'Returns the JSON-compatible byte charge of a normalized portable stream item. It is independent of the selected codec, route header and key order, so the stream owner can apply its existing per-item budget consistently.',
    purposeZh:
      '返回已归一化 portable stream item 的 JSON-compatible 字节费用，与所选 codec、route header 和 key 顺序无关。stream owner 据此应用原逐项预算，不用完整帧大小替代 item 计量。'
  }),
  'rpc-contract:stream:normalizeStreamPayload': guide({
    ...rpcProtocolGuideContexts.streamCredit,
    purposeEn:
      "Validates a received stream event shape and portable-value budget before the stream owner touches held sequence or credit. It returns a canonical payload; direction, cancellation and lifecycle remain the existing stream owner's responsibility.",
    purposeZh:
      '在 stream owner 接触持有的序列或 credit 前验证收到的 event 形状与 portable value 预算，返回规范 payload。方向、取消和生命周期仍由既有 stream owner 负责。'
  })
}

/** Maintained examples use actual held resources and local proposals rather than trust DTOs. */
const rpcAdapterGuideContexts = {
  emitter: {
    quickStart: `import { createEventEmitterMessageResource, prepareAdapterPeer, type IAdapterEventEmitterMessagePort } from '@migaia/rpc-core/adapter'
import type { IRuntimePeerOptions, IRuntimePeerSource } from '@migaia/rpc-core/remote'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'

/** The adapter holds this actual port and preserves the original options identity. */
export function openEmitterPeer(port: IAdapterEventEmitterMessagePort, parentId: string, options: Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'>) {
  const preparation = prepareAdapterPeer(options, 'custom-runtime')
  const resource = createEventEmitterMessageResource(port)
  const connect: IRuntimePeerSource = (context) => resource.open({
    peerId: parentId, scheduler: systemScheduler,
    offer: context.capabilities, control: rpcMessageCapabilityControl
  })
  return preparation.peer({ ...options, self: preparation.context.self, connect })
}
// Retain the returned Peer and await its close() when this connection ends.`,
    useEn: [
      'An adapter holds a real emitter message port and needs a callable Runtime Peer.',
      'The original Host preparation must survive option copies during native acquisition.'
    ],
    useZh: [
      'adapter 持有真实 emitter 消息端口，需要构造可调用 Runtime Peer。',
      '原 Host preparation 需要在原生资源获取和 options 复制后继续保留。'
    ],
    avoidEn: [
      'An existing Thread factory already owns this runtime and its supervision.',
      'A copied transport or accepted-capability record cannot supply Core resource facts.'
    ],
    avoidZh: [
      '已有 Thread 工厂已拥有该 runtime 及其 supervision 时直接使用原工厂。',
      '复制的 transport 或已协商 capability 记录不能提供 Core 资源事实。'
    ]
  },
  target: {
    quickStart: `import { createEventTargetMessageResource, prepareAdapterPeer, type IAdapterEventTargetMessagePort } from '@migaia/rpc-core/adapter'
import type { IRuntimePeerOptions, IRuntimePeerSource } from '@migaia/rpc-core/remote'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'

/** The actual EventTarget port remains owned by the adapter's native runtime. */
export function openEventTargetPeer(port: IAdapterEventTargetMessagePort, parentId: string, options: Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'>) {
  const preparation = prepareAdapterPeer(options, 'custom-runtime')
  const resource = createEventTargetMessageResource(port)
  const connect: IRuntimePeerSource = (context) => resource.open({
    peerId: parentId, scheduler: systemScheduler,
    offer: context.capabilities, control: rpcMessageCapabilityControl
  })
  return preparation.peer({ ...options, self: preparation.context.self, connect })
}
// Core observes raw ACKs; native termination stays with the actual launch owner.`,
    useEn: [
      'An adapter already holds the actual EventTarget messaging resource.',
      'Message control must use the same physical receiver as the eventual endpoint.'
    ],
    useZh: [
      'adapter 已持有实际 EventTarget 消息资源，需要接入规范 channel。',
      '消息控制需要与最终 endpoint 使用同一真实接收端。'
    ],
    avoidEn: [
      'Use the existing browser or Thread adapter when it already owns the native resource.',
      'Do not pass decoded agreement, generation or native ownership claims into this constructor.'
    ],
    avoidZh: [
      '已有 browser 或 Thread adapter 拥有原生资源时应直接复用。',
      '不能向构造器传入解码后的 agreement、generation 或 native 所有权声明。'
    ]
  },
  object: {
    quickStart: `import { holdAdapterObjectChannel, type IRuntimeObjectIO, type IRuntimeConnectionOptions } from '@migaia/rpc-core/adapter'
import type { IRpcHandshakeOffer } from '@migaia/rpc-contract'

/** Raw exchange resolves the actual correlated peer reply on this held connection. */
export async function openObjectCarrier(io: IRuntimeObjectIO, offer: IRpcHandshakeOffer, options: IRuntimeConnectionOptions) {
  const connection = holdAdapterObjectChannel(io)
  connection.prepare(offer)
  try {
    await connection.negotiate()
    return connection.open(options)
  } catch (primary) {
    try { await connection.close(primary) } catch (cleanup) { options.report(cleanup) }
    throw primary
  }
}
// The returned channel owns its exact object/text views and close operation.`,
    useEn: [
      'A carrier holds actual correlated object/text I/O and needs canonical negotiation.',
      'The same cold resource must preserve prepare, exchange, final construction and close order.'
    ],
    useZh: [
      '载体持有真实的 correlated object/text I/O，需要规范协议协商。',
      '同一冷资源需要保留 prepare、exchange、最终构造及 close 顺序。'
    ],
    avoidEn: [
      'Use the JSON-RPC bridge when it already supplies the required envelope mapping.',
      'Do not return a fabricated completed agreement or register an existing transport target.'
    ],
    avoidZh: [
      'JSON-RPC bridge 已提供所需 envelope 映射时直接复用 bridge。',
      '不能返回伪造的已完成 agreement，也不能登记既有 transport target。'
    ]
  },
  byte: {
    quickStart: `import { createRuntimeByteConnection, readRuntimeByteBootstrap, type IRuntimeByteIO, type IRuntimeByteOptions, type IRuntimeByteDiagnostics } from '@migaia/rpc-core/adapter'

/** Establish ordinary held byte I/O from the actual local offer and verifier. */
export function establishByteCarrier(io: IRuntimeByteIO, options: IRuntimeByteOptions, diagnostics: IRuntimeByteDiagnostics) {
  return createRuntimeByteConnection(io, options, diagnostics)
}

/** A child with framed launch input continues on the same actual reader. */
export async function establishBootstrappedCarrier(io: IRuntimeByteIO, options: IRuntimeByteOptions, diagnostics: IRuntimeByteDiagnostics) {
  const received = await readRuntimeByteBootstrap(io, diagnostics, { timeoutMs: 5_000 })
  return createRuntimeByteConnection(received.channel, options, diagnostics)
}
// The connection owner retains and later closes the exact returned channel.`,
    useEn: [
      'An adapter owns actual ordered byte I/O and a local handshake/authentication policy.',
      'Framed launch input must hand its original decoder and queued bytes to the handshake.'
    ],
    useZh: [
      'adapter 拥有真实有序 byte I/O 和本地 handshake/认证策略。',
      'framed launch input 需要把原 decoder 与排队字节移交同一 handshake。'
    ],
    avoidEn: [
      'A Process adapter already owns the native acquisition and diagnostic policy.',
      'Decoded bootstrap bytes or public peer metadata cannot replace actual Core observation.'
    ],
    avoidZh: [
      'Process adapter 已拥有原生获取与诊断策略时复用已有入口。',
      '解码 bootstrap 或公开 peer metadata 不能代替 Core 的真实读取。'
    ]
  },
  eventByte: {
    quickStart: `import { Buffer } from 'node:buffer'
import type { Readable, Writable } from 'node:stream'
import { createRuntimeEventByteIO } from '@migaia/rpc-core/adapter'

/** Reader, writer and physical close belong to this actual native connection. */
export function holdNativeBytes(reader: Readable, writer: Writable, close: () => void, diagnostic: Parameters<typeof createRuntimeEventByteIO>[3]) {
  return createRuntimeEventByteIO(reader, writer, { close }, diagnostic, Buffer)
}
// The optional resource is the actual Buffer constructor, not an encoder registrar.
// Core constructs its own codec with one native encoding of each visible byte view.`,
    useEn: [
      'The adapter holds actual event-style readable/writable resources and physical close.',
      'The host supplies a real byte-view constructor to preserve its native inline encoder.'
    ],
    useZh: [
      'adapter 持有真实事件式 readable/writable 和物理关闭资源。',
      '宿主提供实际字节视图构造对象，以保留原生 inline 编码器。'
    ],
    avoidEn: [
      'Web streams should use the owning Process Web byte adapter instead of emitter assumptions.',
      'Do not pass native flags, reader-count predicates or an existing codec target.'
    ],
    avoidZh: [
      'Web streams 应使用原 Process Web byte adapter，不应假定 emitter 事件。',
      '不能传入 native flags、reader-count 判断回调或既有 codec target。'
    ]
  },
  message: {
    quickStart: `import { createRuntimeMessageConnection, type IRuntimeMessageIO, type IRuntimeMessageConnectionOptions, type IRuntimeMessageDiagnostics } from '@migaia/rpc-core/adapter'

/** The adapter supplies actual whole-message I/O and only its local proposal. */
export function establishMessageCarrier(io: IRuntimeMessageIO, options: IRuntimeMessageConnectionOptions, diagnostics: IRuntimeMessageDiagnostics) {
  return createRuntimeMessageConnection(io, options, diagnostics)
}
// Fixed V1 capabilities need no hello; expansions require an actual raw capability ACK.
// An absent ACK keeps only the local fixed subset and grants no clone/native ownership.`,
    useEn: [
      'The actual carrier already preserves complete message boundaries.',
      'A local extension proposal must be enabled only after a bounded peer ACK exchange.'
    ],
    useZh: [
      '实际载体已保留完整 message 边界，无需额外字节 framing。',
      '本地扩展提案只能在有界 peer ACK 交换后启用。'
    ],
    avoidEn: [
      'Ordered byte streams require createRuntimeByteConnection and its framed handshake.',
      'Matching descriptive proposals cannot enable runtime/binary expansions on their own.'
    ],
    avoidZh: [
      '有序字节流应使用 createRuntimeByteConnection 的 framed handshake。',
      '仅有一致的描述性提案不能自行启用 runtime/binary 扩展。'
    ]
  },
  provider: {
    quickStart: `import { createAdapterBindingDrain, createRuntimeProviderGovernor, createRuntimeProviderScope, type IRuntimeProviderPolicy } from '@migaia/rpc-core/adapter'
import type { IRpcIdempotencyStore, IRpcProviderLimits } from '@migaia/rpc-core'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'

/** Only the exact Core-created connection supplies its private session identity. */
export function holdProviderResources(channel: IRemoteChannel, policy: IRuntimeProviderPolicy, limits: IRpcProviderLimits, closeSession: () => Promise<void>, report: (error: unknown) => void, store?: IRpcIdempotencyStore) {
  const scope = createRuntimeProviderScope(store)
  const governor = createRuntimeProviderGovernor(channel, policy, closeSession, report)
  const drain = createAdapterBindingDrain(channel.scheduler, report)
  return {
    scope, governor, drain,
    session: scope.session(channel, governor.limits(limits)),
    close: () => { governor.close(); scope.close() }
  }
}
// The existing session owner still closes the channel and its attached endpoint.`,
    useEn: [
      'An existing session owner holds the actual Core-created connection and local numeric limits.',
      'Provider admission, draining and stable scope must reuse canonical resource owners.'
    ],
    useZh: [
      '既有 session owner 持有实际 Core 连接，并选择本地数值限制。',
      'provider admission、draining 和稳定 scope 需要复用规范资源 owner。'
    ],
    avoidEn: [
      'Do not copy a channel or pass principal, reservation or preflight DTOs.',
      'Use the existing Process resilience owner when its admission and session policy already suffice.'
    ],
    avoidZh: [
      '不能复制 channel，或传入 principal、reservation、preflight DTO。',
      '已有 Process resilience owner 满足准入与会话策略时直接复用。'
    ]
  },
  binding: {
    quickStart: `import { createAdapterPlugin, holdAdapterRegistration } from '@migaia/rpc-core/adapter'

/** Options hold the actual binding; the application's Host owns installation and release. */
export function createHostedAdapter(options: Parameters<typeof createAdapterPlugin>[0]) {
  return createAdapterPlugin(options)
}

/** Preserve the same registration across prevalidation and later Plugin installation. */
export async function prepareHostedAdapter(options: Parameters<typeof holdAdapterRegistration>[0], signal: AbortSignal) {
  const registration = holdAdapterRegistration(options)
  await registration.prepare(signal)
  return { plugin: registration.plugin(), release: () => registration.release() }
}
// Pass the actual Plugin to the existing Host, and release its registration at owner shutdown.`,
    useEn: [
      'A real adapter binding must reuse Remote Plugin installation and teardown.',
      'Prevalidation and installation need the same genuine registration and generation holder.'
    ],
    useZh: [
      '真实 adapter binding 需要复用 Remote Plugin 安装与释放流程。',
      '预验证与安装必须保留同一真实 registration 和 generation holder。'
    ],
    avoidEn: [
      'Do not hand a prepared holder or copied Host context back to Core.',
      'A direct Peer factory is clearer when no Plugin/Host registration is required.'
    ],
    avoidZh: [
      '不能把 prepared holder 或复制的 Host context 回传 Core。',
      '不需要 Plugin/Host registration 时应使用更直接的 Peer 工厂。'
    ]
  },
  data: {
    quickStart: `import { adapterContractRequiresStream, createAdapterId, materializeAdapterJson, normalizeAdapterDescription, readAdapterAbortReason, validateAdapterPeerMethods, validateAdapterPeerTimeout } from '@migaia/rpc-core/adapter'
import type { IRuntimePeerOptions } from '@migaia/rpc-core/remote'

/** Admit actual local declarations before acquiring native resources. */
export function admitLocalConfiguration(options: IRuntimePeerOptions) {
  validateAdapterPeerTimeout(options)
  validateAdapterPeerMethods(options.provide, options.contract)
  return createAdapterId()
}
/** These outputs remain ordinary data or the original cancellation reason. */
export function readCancellation(signal: AbortSignal) { return readAdapterAbortReason(signal) }
export function inspectDirectory(value: unknown) { return normalizeAdapterDescription(value) }
export function needsStream(contract: Parameters<typeof adapterContractRequiresStream>[0]) { return adapterContractRequiresStream(contract) }
export function materializeProtocolData(value: unknown) { return materializeAdapterJson(value) }
// None of these operations registers a transport, snapshot, principal or agreement.`,
    useEn: [
      'An adapter needs the existing local admission or received-directory grammar.',
      'Ordinary addresses, abort reasons or JSON data must retain their canonical owner.'
    ],
    useZh: [
      'adapter 需要复用既有本地准入或收到目录的 grammar。',
      '普通地址、abort reason 或 JSON 数据需要保留规范归属。'
    ],
    avoidEn: [
      'Do not interpret returned data or labels as accepted channel capabilities.',
      'Do not create a parallel validator or owned-snapshot registrar in the adapter.'
    ],
    avoidZh: [
      '不能把返回数据或标签理解为已接受的 channel 能力。',
      '不要在 adapter 中另建 validator 或 owned-snapshot registrar。'
    ]
  },
  errors: {
    quickStart: `import { createAdapterConfigurationError, createAdapterConfigurationTypeError, createAdapterSourceConfigurationError, createAdapterTransportError } from '@migaia/rpc-core/adapter'

/** Diagnostic wording belongs to this adapter; native failures remain on cause. */
export function configurationDiagnostic(message: string) { return createAdapterConfigurationError(message) }
export function nativeConfigurationDiagnostic(message: string, cause: unknown) { return createAdapterConfigurationTypeError(message, cause) }
export function conflictingSourceDiagnostic() { return createAdapterSourceConfigurationError() }
export function carrierFailureDiagnostic(message: string, cause: unknown) { return createAdapterTransportError(message, cause) }
// Public source/code/message/cause presentation never grants Core live-control identity.`,
    useEn: [
      'A real adapter failure needs the established native error family and diagnostic code.',
      'The original native cause must remain reachable without copying private Core text catalogs.'
    ],
    useZh: [
      '实际 adapter 失败需要保留既定原生 error family 与诊断 code。',
      '原生 cause 必须保持可追溯，同时不复制 Core 私有文本目录。'
    ],
    avoidEn: [
      'Do not derive cancellation, retry or close authority from public diagnostic fields.',
      'Use the adapter-owned semantic error when the failure is outside the Core construction boundary.'
    ],
    avoidZh: [
      '不能根据公开诊断字段推导取消、重试或关闭权限。',
      '失败属于 adapter 自身语义时应使用该 adapter 的规范错误。'
    ]
  },
  launch: {
    quickStart: `import { holdAdapterLaunch } from '@migaia/rpc-core/adapter'

/** The actual launcher receives this same request from Core preparation/supervision. */
export function readLocalLaunchProposal(request: Parameters<typeof holdAdapterLaunch>[0]) {
  return holdAdapterLaunch(request).proposal
}
// A copied request has no private preparation; the output is local launch metadata, not an ACK.`,
    useEn: [
      'A native launcher receives the actual request used by Core launch preparation.',
      'Launch encoding needs the compiled local proposal without exposing the private Host context.'
    ],
    useZh: [
      '原生 launcher 收到 Core launch preparation 使用的实际 request。',
      '启动编码需要已编译本地提案，同时保持 Host context 私有。'
    ],
    avoidEn: [
      'Do not pass the output back as an accepted agreement or generation claim.',
      'Ordinary unmanaged launches with no Core proposal should keep their existing native bootstrap.'
    ],
    avoidZh: [
      '不能把输出回传为已接受 agreement 或 generation 声明。',
      '没有 Core 提案的普通 unmanaged launch 应保留原 native bootstrap。'
    ]
  }
}

/** Each new generic operation has an explicit bilingual purpose and maintained resource example. */
const rpcAdapterGuides = {
  'rpc-core:adapter:createEventEmitterMessageResource': guide({
    ...rpcAdapterGuideContexts.emitter,
    purposeEn:
      'Holds an actual emitter message port so Core can observe raw capability ACKs and construct its own exact channel. Fixed stream/batch construction stays synchronous; expanded opening waits for actual peer acceptance.',
    purposeZh:
      '持有实际 emitter 消息端口，让 Core 观察原始 capability ACK 并构造自己的精确 channel。固定 stream/batch 构造保持同步；扩展 opening 等待真实 peer 接受。'
  }),
  'rpc-core:adapter:createEventTargetMessageResource': guide({
    ...rpcAdapterGuideContexts.target,
    purposeEn:
      'Holds an actual EventTarget message port with the same bounded control receiver. Core owns channel construction and ACK intersection while the native runtime retains Worker termination and supervision.',
    purposeZh:
      '用同一有界控制接收端持有实际 EventTarget 消息端口。Core 负责 channel 构造和 ACK 交集；原 runtime 继续拥有 Worker termination 与 supervision。'
  }),
  'rpc-core:adapter:prepareAdapterPeer': guide({
    ...rpcAdapterGuideContexts.emitter,
    purposeEn:
      'Preserves the original options identity and genuine Host preparation across native acquisition. Its local context, launch, listener and Peer operations reuse Core owners without publishing a context or generation setter.',
    purposeZh:
      '在原生资源获取期间保留原 options 身份与真实 Host preparation。本地 context、launch、listener 和 Peer 操作复用 Core owner，不公开 context 或 generation setter。'
  }),
  'rpc-core:adapter:holdAdapterObjectChannel': guide({
    ...rpcAdapterGuideContexts.object,
    purposeEn:
      'Keeps actual object/text I/O cold across local preparation and the real correlated handshake reply. It constructs its own final channel and object-port facts, then closes the same held physical resource.',
    purposeZh:
      '在本地准备与真实 correlated handshake reply 期间保留同一冷 object/text I/O。它构造自己的最终 channel 与 object-port 事实，并关闭同一物理资源。'
  }),
  'rpc-core:adapter:createRuntimeByteConnection': guide({
    ...rpcAdapterGuideContexts.byte,
    purposeEn:
      'Exchanges framed hello/accept on actual ordered byte I/O, invokes the real authentication verifier and constructs the final gated channel. Accepted capabilities and principal identity stay private to that exact connection.',
    purposeZh:
      '在真实有序 byte I/O 上交换 framed hello/accept，调用实际认证 verifier 并构造最终 gated channel。已接受能力与 principal 身份保留在同一连接的私有记录。'
  }),
  'rpc-core:adapter:readRuntimeByteBootstrap': guide({
    ...rpcAdapterGuideContexts.byte,
    purposeEn:
      'Reads the actual first framed launch message under the supplied deadline and keeps its private byte snapshot. The same decoder and queued following frame continue into handshake without a second physical reader.',
    purposeZh:
      '在给定截止时间内读取真实的首个 framed launch message，并保留其私有字节快照。同一 decoder 与后续排队 frame 移交 handshake，不另装第二个物理 reader。'
  }),
  'rpc-core:adapter:createRuntimeEventByteIO': guide({
    ...rpcAdapterGuideContexts.eventByte,
    purposeEn:
      'Constructs raw byte I/O from held event reader, writer and physical-close operations. It observes their real lifetime and subscriber count and may hold an actual byte-view factory for Core-owned native encoding.',
    purposeZh:
      '从实际 event reader、writer 与物理关闭操作构造 raw byte I/O。观察其真实寿命和 subscriber count，并可持有实际 byte-view 工厂供 Core 自己构造原生编码器。'
  }),
  'rpc-core:adapter:createRuntimeMessageConnection': guide({
    ...rpcAdapterGuideContexts.message,
    purposeEn:
      'Constructs the fixed V1 whole-message profile without hello and enables proposed extensions only from a bounded actual ACK. Missing ACK retains the local fixed subset; malformed control rejects using the existing diagnostics.',
    purposeZh:
      '零 hello 构造固定 V1 完整消息 profile，仅从有界真实 ACK 启用本地扩展提案。缺 ACK 时保留本地固定子集；格式错误控制使用原诊断拒绝。'
  }),
  'rpc-core:adapter:createRuntimeProviderGovernor': guide({
    ...rpcAdapterGuideContexts.provider,
    purposeEn:
      'Owns the original per-connection rate, payload, idle and violation counters over a real Core channel. Its limits and endpoint operations produce canonical scalar/stream wrappers without exporting reservation or invocation registrars.',
    purposeZh:
      '在真实 Core channel 上拥有原每连接 rate、payload、idle 与 violation 计数。limits 和 endpoint 操作生成规范 scalar/stream wrapper，不公开 reservation 或 invocation registrar。'
  }),
  'rpc-core:adapter:createRuntimeProviderScope': guide({
    ...rpcAdapterGuideContexts.provider,
    purposeEn:
      'Owns the shared provider admission resource and selected idempotency store. Session scope derives its identity only from exact Core-created channel membership, preserving the existing connection namespace without a signer input.',
    purposeZh:
      '拥有共享 provider admission 资源和所选 idempotency store。session scope 只从精确 Core channel 身份导出 identity，保留既有连接 namespace，不接受 signer 输入。'
  }),
  'rpc-core:adapter:createAdapterBindingDrain': guide({
    ...rpcAdapterGuideContexts.provider,
    purposeEn:
      'Creates the existing Remote endpoint drain on the held scheduler and reporter. Its wrapping and draining operations preserve the original provider lifetime and close order rather than adding another lifecycle or supervisor.',
    purposeZh:
      '使用原 scheduler 与 reporter 创建既有 Remote endpoint drain。包装和排空操作保留原 provider 寿命与关闭顺序，不增加另一套 lifecycle 或 supervisor。'
  }),
  'rpc-core:adapter:createAdapterPlugin': guide({
    ...rpcAdapterGuideContexts.binding,
    purposeEn:
      'Assembles a user-level Plugin over its actual adapter binding using the existing Remote installation owner. Optional lifecycle resources receive the real install/release events; their return values do not provide prepared-holder authority.',
    purposeZh:
      '用既有 Remote 安装 owner 在实际 adapter binding 上组装用户级 Plugin。可选 lifecycle 资源接收真实安装和释放事件；返回值不提供 prepared-holder 权限。'
  }),
  'rpc-core:adapter:holdAdapterRegistration': guide({
    ...rpcAdapterGuideContexts.binding,
    purposeEn:
      'Retains one genuine binding registration and generation holder across prepare, Plugin construction and release. Repeated operations preserve the original owner and cleanup promises without accepting a caller-prepared holder.',
    purposeZh:
      '在 prepare、Plugin 构造和 release 之间保留同一真实 binding registration 与 generation holder。重复操作保留原 owner 和 cleanup Promise，不接受调用方 prepared holder。'
  }),
  'rpc-core:adapter:holdAdapterLaunch': guide({
    ...rpcAdapterGuideContexts.launch,
    purposeEn:
      'Reads Core-attached local launch metadata only from the exact held launch request. It helps the native launcher encode its original bootstrap and exposes no public writer for Host, generation or accepted capability facts.',
    purposeZh:
      '仅从实际持有的原 launch request 读取 Core 附加的本地启动 metadata。用于原生 launcher 编码原 bootstrap，不公开 Host、generation 或已接受能力事实的 writer。'
  }),
  'rpc-core:adapter:createAdapterId': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      "Allocates an ordinary local resource address through Core's existing ID owner. The value is configuration and presentation data; it does not authenticate a peer or prove execution, carrier or provider ownership.",
    purposeZh:
      '通过 Core 既有 ID owner 分配普通本地资源地址。其值是配置和展示数据，不认证 peer，也不证明 execution、carrier 或 provider 所有权。'
  }),
  'rpc-core:adapter:readAdapterAbortReason': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      "Reads the actual signal's guarded abort reason without replacing its identity or creating a new cancellation. Adapters use the original reason when an owned preparation attempt observes cancellation.",
    purposeZh:
      '读取真实 signal 的受保护 abort reason，不替换其身份或制造新取消。adapter 在所属准备尝试观察取消时继续使用同一原 reason。'
  }),
  'rpc-core:adapter:validateAdapterPeerTimeout': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      'Validates the original local Peer default timeout before native discovery or I/O acquisition. It reuses the existing timeout owner and failure semantics rather than supplying an alternate deadline policy.',
    purposeZh:
      '在原生发现或 I/O 获取前校验本地 Peer 原默认 timeout。复用既有 timeout owner 与失败语义，不提供另一套 deadline policy。'
  }),
  'rpc-core:adapter:validateAdapterPeerMethods': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      'Compiles actual local provider declarations through the existing method and contract admission before bootstrap readers are installed. This is local validation, not remote directory acceptance or a capability registrar.',
    purposeZh:
      '在 bootstrap reader 安装前，通过既有 method 和 contract 准入编译实际本地 provider 声明。这是本地校验，不是远端目录接受或 capability registrar。'
  }),
  'rpc-core:adapter:normalizeAdapterDescription': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      'Normalizes a received Runtime directory as ordinary data using the canonical Remote grammar. The output describes methods and identity but cannot replace a negotiated channel or register Host and provider authority.',
    purposeZh:
      '使用规范 Remote grammar 将收到的 Runtime 目录归一化为普通数据。输出描述 methods 与 identity，但不能代替协商 channel，也不能登记 Host 或 provider 权限。'
  }),
  'rpc-core:adapter:adapterContractRequiresStream': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      'Inspects the admitted local contract for required stream operations before a carrier is selected. It preserves the existing stream-exclusion decision without enabling stream capability or creating a second contract compiler.',
    purposeZh:
      '在选择载体前检查已接纳本地 contract 是否需要 stream 操作。保留原 stream-exclusion 判断，不启用 stream 能力，也不创建第二套 contract compiler。'
  }),
  'rpc-core:adapter:materializeAdapterJson': guide({
    ...rpcAdapterGuideContexts.data,
    purposeEn:
      "Produces the ordinary JSON view used by object carriers through Core's canonical materializer. The returned data does not carry a sender-owned snapshot, fast codec identity or transport qualification.",
    purposeZh:
      '通过 Core 规范 materializer 生成 object carrier 使用的普通 JSON 视图。返回数据不携带 sender-owned snapshot、fast codec 身份或 transport 资格。'
  }),
  'rpc-core:adapter:createAdapterConfigurationError': guide({
    ...rpcAdapterGuideContexts.errors,
    purposeEn:
      "Constructs the established INVALID_CONFIG diagnostic with the adapter's maintained display text. It accepts no arbitrary Core code or target error and does not grant live cancellation, retry or close identity.",
    purposeZh:
      '使用 adapter 维护的展示文本构造既有 INVALID_CONFIG 诊断。不接受任意 Core code 或目标 error，也不授予实际取消、重试或关闭身份。'
  }),
  'rpc-core:adapter:createAdapterConfigurationTypeError': guide({
    ...rpcAdapterGuideContexts.errors,
    purposeEn:
      "Constructs the established native TypeError configuration diagnostic inside Core while preserving an actual supplied cause. It keeps public diagnostic presentation separate from Core's private live-control error identity.",
    purposeZh:
      '在 Core 内构造既有原生 TypeError 配置诊断，并保留真实传入 cause。公开诊断展示与 Core 私有 live-control error 身份保持分离。'
  }),
  'rpc-core:adapter:createAdapterSourceConfigurationError': guide({
    ...rpcAdapterGuideContexts.errors,
    purposeEn:
      "Constructs only the fixed original source-conflict configuration failure. Its no-argument operation preserves Core's canonical private text without exposing a diagnostic text catalog or accepting a code selector.",
    purposeZh:
      '仅构造固定的原 source-conflict 配置失败。无参数操作保留 Core 规范私有文本，不公开诊断文本目录，也不接受 code selector。'
  }),
  'rpc-core:adapter:createAdapterTransportError': guide({
    ...rpcAdapterGuideContexts.errors,
    purposeEn:
      "Presents an actual carrier failure with the established transport error family and reachable original cause. Construction is diagnostic only; the connection owner's observed state continues to decide physical retirement.",
    purposeZh:
      '用既有 transport error family 展示真实载体失败，并保持原 cause 可追溯。构造仅提供诊断；物理退出仍由连接 owner 观察到的实际状态决定。'
  }),
  'rpc-process:index:createProcessChannelClosedError': guide({
    ...rpcAdapterGuideContexts.errors,
    quickStart: `import { createProcessChannelClosedError } from '@migaia/rpc-process'

/** Keep the actual native failure on cause while using Process's fixed closed diagnostic. */
export function projectNativeClosure(cause?: unknown) {
  return createProcessChannelClosedError(cause)
}
// Reporting this value does not close or authenticate another connection.`,
    purposeEn:
      'Constructs the original Process CHANNEL_CLOSED native error with fixed package source, code and message, retaining the actual cause. Bridges reuse Process diagnostic ownership without copying text or minting Core control identity.',
    purposeZh:
      '使用固定包 source、code 和 message 构造原 Process CHANNEL_CLOSED 原生错误，并保留实际 cause。bridge 据此复用 Process 诊断归属，不复制文本或生成 Core 控制身份。'
  }),
  'rpc-process:index:openProcessObjectChannel': guide({
    ...rpcAdapterGuideContexts.object,
    quickStart: `import { openProcessObjectChannel, type IProcessCommonOptions } from '@migaia/rpc-process'
import type { IRuntimeObjectConnection } from '@migaia/rpc-core/adapter'

/** The same held Core connection has completed its actual object handshake. */
export function adoptProcessObjectConnection(connection: IRuntimeObjectConnection, options: IProcessCommonOptions) {
  return openProcessObjectChannel(connection, options)
}
// The returned channel retains Process stderr/log cleanup and its original Core close owner.`,
    purposeEn:
      'Opens the actual Core-held object connection with Process platform and canonical diagnostics, then attaches its real stderr/log cleanup. It preserves the existing lifecycle owner without registering a channel or accepting an agreement DTO.',
    purposeZh:
      '以 Process platform 与规范诊断打开实际 Core-held object connection，再附加真实 stderr/log cleanup。保留既有 lifecycle owner，不登记 channel，也不接受 agreement DTO。'
  }),
  'rpc-contract:runtime:rpcMessageCapabilityControl': guide({
    ...rpcAdapterGuideContexts.message,
    quickStart: `import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'

/** Inspect actual received control as ordinary protocol data. */
export function inspectCapabilityAcknowledgement(received: unknown, localOffer: readonly string[]) {
  const parsed = rpcMessageCapabilityControl.readAcknowledgement(received)
  return parsed.valid ? rpcMessageCapabilityControl.intersect(localOffer, parsed.value) : parsed
}
// Core's held resource independently observes control before enabling channel capabilities.`,
    purposeEn:
      "Owns the existing closed initial-message and capability-ACK grammar, bounded offer admission and intersection algorithm. Parser results are protocol data; only Core's held-resource operations turn actual reception into enabled channel facts.",
    purposeZh:
      '拥有既有封闭 initial-message 与 capability-ACK grammar、有界 offer 准入和交集算法。parser 结果只是协议数据；只有 Core-held resource 操作才能从真实接收生成启用 channel 事实。'
  }),
  'rpc-contract:runtime:rpcByteRuntimeBootstrap': guide({
    ...rpcAdapterGuideContexts.byte,
    quickStart: `import { rpcByteRuntimeBootstrap } from '@migaia/rpc-contract/runtime'

/** Admit a physically received first-frame snapshot as ordinary launch metadata. */
export function inspectByteLaunchFrame(frame: Uint8Array) {
  return rpcByteRuntimeBootstrap.read(frame)
}
// Automatic Core Peer preparation reads its own private snapshot and authenticates the parent.`,
    purposeEn:
      'Defines the original bounded, closed byte-launch grammar for self, parent, token and generation fields. Its read result is decoded launch data, not authentication, an accepted principal or a replaceable Core bootstrap receipt.',
    purposeZh:
      '定义 self、parent、token 和 generation 字段的原有界封闭 byte-launch grammar。read 结果是解码启动数据，不是认证、已接受 principal 或可替换的 Core bootstrap receipt。'
  })
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

/**
 * Guides for the short-source helpers, the adapter SDK and the pool package added by the DX
 * roadmap.
 */
const rpcDxRoadmapGuides = {
  'rpc-core:adapter:defineMessageAdapter': guide({
    quickStart: `import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { defineMessageAdapter } from '@migaia/rpc-core/adapter'

const adapter = defineMessageAdapter({ open: (port: MessagePort) => port })
const { port1, port2 } = new MessageChannel()
const [left, right] = await Promise.all([
  adapter.peer<{ echo(value: number): number }>({ self: { name: 'left', instanceId: 'left' }, connect: port1, peerId: 'right' }),
  adapter.peer({ self: { name: 'right', instanceId: 'right' }, connect: port2, peerId: 'left', provide: { echo: (value: number) => value } })
])
console.log(await left.request('echo', 42))
await Promise.all([left.close(), right.close()])
port1.close()
port2.close()`,
    purposeEn:
      'Defines a third-party runtime adapter over a message port the adapter already holds. The definition supplies only how to open that port; Core still runs the handshake, capability acknowledgement, method directory and lifecycle, and the result creates standalone Peers or Host plugins.',
    purposeZh:
      '为适配器已经持有的消息端口定义第三方运行时适配器。定义只负责打开端口；握手、能力确认、方法目录与生命周期仍由 Core 完成，结果可以创建独立 Peer 或 Host 插件。',
    useEn: [
      'A new runtime or carrier exposes MessagePort-like ports and should behave like the built-in thread adapters.',
      'An application wants a Peer over its own pair of ports without writing handshake code.'
    ],
    useZh: [
      '新的运行时或载体提供类似 MessagePort 的端口，并希望与内置线程适配器行为一致。',
      '应用希望在自己的一对端口上建立 Peer，而不编写握手代码。'
    ],
    avoidEn: [
      'Node, Bun, Deno or browser Workers are already covered by createThreadPeer and its short spawn options.',
      'The carrier is an ordered byte stream rather than a message port; use defineByteAdapter.'
    ],
    avoidZh: [
      'Node、Bun、Deno 或浏览器 Worker 已由 createThreadPeer 及其 spawn 简写覆盖。',
      '载体是有序字节流而不是消息端口时改用 defineByteAdapter。'
    ]
  }),
  'rpc-core:adapter:defineByteAdapter': guide({
    quickStart: `import { defineByteAdapter } from '@migaia/rpc-core/adapter'
import type { IProcessByteChannel } from '@migaia/rpc-process'

/** The adapter only opens the ordered byte channel it already holds. */
export const adapter = defineByteAdapter({ open: (channel: IProcessByteChannel) => channel })
// adapter.peer(options) creates a standalone Peer; adapter.plugin(options) installs a Host plugin.`,
    purposeEn:
      'Defines a third-party runtime adapter over an ordered byte stream such as a pipe or socket. Optional dial and listen operations obtain connections; Core performs the authenticated handshake, framing, capability agreement and lifecycle on the bytes it receives.',
    purposeZh:
      '为管道、socket 等有序字节流定义第三方运行时适配器。可选的 dial 与 listen 负责取得连接；认证握手、分帧、能力协商与生命周期由 Core 在实际收到的字节上完成。',
    useEn: [
      'A custom IPC mechanism delivers ordered bytes and should reuse the native process protocol.',
      'The in-repo process adapter is the reference shape for a new byte carrier.'
    ],
    useZh: [
      '自定义 IPC 机制传递有序字节，并希望复用原生进程协议。',
      '以仓库内的进程适配器为参照，为新的字节载体实现适配器。'
    ],
    avoidEn: [
      'Local child processes and named endpoints are already covered by createProcessPeer short options.',
      'The carrier delivers whole messages; use defineMessageAdapter instead of reframing them as bytes.'
    ],
    avoidZh: [
      '本机子进程和名字端点已由 createProcessPeer 简写覆盖。',
      '载体按完整消息投递时使用 defineMessageAdapter，不要再把消息重新包装成字节流。'
    ]
  }),
  'rpc-process:index:isProcessChild': guide({
    quickStart: `import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

if (isProcessChild()) {
  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const child = await createProcessPeer<{ double(value: number): number }>({ spawn: true })
  console.log(await child.request('double', 21))
  await child.close()
}`,
    purposeEn:
      'Reports synchronously whether the current process was started by the library launcher, by reading the existing bootstrap marker. It guards the two branches of a module that spawns a copy of itself with spawn: true.',
    purposeZh:
      '通过读取现有 bootstrap 标记，同步判断当前进程是否由库的启动器派生。用于区分以 spawn: true 派生自身的模块中父端与子端两个分支。',
    useEn: [
      'One entry file is both the parent and the child of a self spawn.',
      'Top-level work such as starting a server must run only in the parent.'
    ],
    useZh: ['同一个入口文件既是自我派生的父端，也是子端。', '启动服务器等顶层工作只能在父端执行。'],
    avoidEn: [
      'The child runs a different program; that program simply calls createProcessPeer without a guard.',
      'The marker is not authentication and must not be used to grant privileges.'
    ],
    avoidZh: [
      '子进程运行的是另一个程序时，该程序直接调用 createProcessPeer，不需要判断。',
      '该标记不是认证信息，不能用来授予权限。'
    ]
  }),
  'rpc-threads:index:isThreadChild': guide({
    quickStart: `import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const worker = await createThreadPeer<{ double(value: number): number }>({ spawn: true })
  console.log(await worker.request('double', 21))
  await worker.close()
}`,
    purposeEn:
      'Resolves whether the current module runs inside a Worker started by the library launcher, by reading the existing bootstrap marker. It guards the two branches of a module started as its own Worker with spawn: true.',
    purposeZh:
      '通过读取现有 bootstrap 标记，异步判断当前模块是否运行在由库的启动器创建的 Worker 中。用于区分以 spawn: true 将自身作为 Worker 启动的模块中的两个分支。',
    useEn: [
      'One module is both the main-thread code and the Worker body.',
      'Main-thread work must not run again inside the Worker.'
    ],
    useZh: [
      '同一个模块既是主线程代码，也是 Worker 的主体。',
      '主线程的工作不能在 Worker 中再执行一遍。'
    ],
    avoidEn: [
      'Browser bundlers need new Worker(new URL(...)); use an explicit Worker entry there.',
      'The marker is not authentication and must not be used to grant privileges.'
    ],
    avoidZh: [
      '浏览器打包器需要 new Worker(new URL(...)) 写法，浏览器中请使用独立的 Worker 入口。',
      '该标记不是认证信息，不能用来授予权限。'
    ]
  }),
  'rpc-pool:index:createThreadPool': guide({
    quickStart: `import { createThreadPool } from '@migaia/rpc-pool'

const pool = await createThreadPool<{ double(value: number): number }>({
  spawn: new URL('./worker.js', import.meta.url),
  size: 2
})
try {
  console.log(await Promise.all([pool.request('double', 21), pool.request('double', 10)]))
} finally {
  await pool.close()
}`,
    purposeEn:
      'Creates a bounded pool of Worker Peers using the same spawn options as createThreadPeer. Calls go to the member with the fewest in-flight operations; when every member is busy they wait in a bounded FIFO, and close drains accepted work.',
    purposeZh:
      '使用与 createThreadPeer 相同的 spawn 选项创建有界的 Worker Peer 池。调用派给在途操作最少的成员；全部繁忙时进入有界 FIFO 等待，close 会排空已接纳的工作。',
    useEn: [
      'CPU-bound calls should spread across several Workers.',
      'The number of concurrent Workers and queued calls must be bounded.'
    ],
    useZh: [
      'CPU 密集的调用需要分散到多个 Worker。',
      '需要限制同时存在的 Worker 数量和排队调用数量。'
    ],
    avoidEn: [
      'A single Worker is enough; use createThreadPeer directly.',
      'Work must move between machines; the pool is local only and does not steal work.'
    ],
    avoidZh: [
      '一个 Worker 就够用时直接使用 createThreadPeer。',
      '需要跨机器分发工作时不适用，池只在本机工作且不做工作窃取。'
    ]
  }),
  'rpc-pool:index:createProcessPool': guide({
    quickStart: `import { createProcessPool } from '@migaia/rpc-pool'

const pool = await createProcessPool<{ add(value: { a: number; b: number }): number }>({
  spawn: new URL('./service.js', import.meta.url),
  size: 2,
  maxQueue: 16
})
try {
  console.log(await pool.request('add', { a: 20, b: 22 }))
} finally {
  await pool.close()
}`,
    purposeEn:
      'Creates a bounded pool of child-process Peers using the same spawn options as createProcessPeer. Dispatch, queueing, resizing and draining match the thread pool, while each member keeps its own process isolation and supervision.',
    purposeZh:
      '使用与 createProcessPeer 相同的 spawn 选项创建有界的子进程 Peer 池。派发、排队、扩缩容与排空规则与线程池一致，每个成员保留各自的进程隔离与监督。',
    useEn: [
      'Work needs process isolation and should run on several children at once.',
      'Crashing members should be restarted by the existing supervisor without the caller rebuilding the pool.'
    ],
    useZh: [
      '工作需要进程隔离，并希望在多个子进程上同时执行。',
      '成员崩溃后由现有监督者重启，调用方不必重建整个池。'
    ],
    avoidEn: [
      'Threads are sufficient and cheaper to start; use createThreadPool.',
      'Calls are non-idempotent and must never be retried; the pool does not replay failed calls, so design recovery explicitly.'
    ],
    avoidZh: [
      '线程已经足够且启动更便宜时使用 createThreadPool。',
      '调用不幂等且绝不能重试时需要自行设计恢复，池不会重放失败的调用。'
    ]
  }),
  'rpc-pool:index:RPC_POOL_ERROR_SOURCE': guide({
    quickStart: `import { RPC_POOL_ERROR_SOURCE, RpcPoolErrorCode } from '@migaia/rpc-pool'

export function isQueueFull(error: unknown) {
  const { source, code } = error as { source?: string; code?: string }
  return source === RPC_POOL_ERROR_SOURCE && code === RpcPoolErrorCode.queueFull
}`,
    purposeEn:
      'The stable source string of errors raised by the pool itself, such as a full queue or a closed pool. Errors from members keep their original RPC or native source, so branching on this source separates pool decisions from call failures.',
    purposeZh:
      '池自身抛出的错误（例如队列已满、池已关闭）所带的稳定 source。成员产生的错误保留原有的 RPC 或原生 source，因此可以按这个 source 区分池的决定与调用本身的失败。',
    useEn: [
      'Callers branch on (source, code) to retry only pool-level rejections.',
      'Logs need to tell pool admission apart from member failures.'
    ],
    useZh: [
      '调用方按 (source, code) 分支，只对池层面的拒绝做重试。',
      '日志需要区分池的准入拒绝与成员失败。'
    ],
    avoidEn: [
      'Matching message text instead of the source string.',
      'Treating a member error as a pool error.'
    ],
    avoidZh: ['用 message 文本代替 source 判断。', '把成员错误当成池错误处理。']
  }),
  'rpc-pool:index:RpcPoolErrorCode': guide({
    quickStart: `import { RpcPoolErrorCode } from '@migaia/rpc-pool'

// INVALID_OPTIONS, POOL_CLOSED, QUEUE_FULL, CALL_ABORTED, CLOSE_FAILED
console.log(Object.values(RpcPoolErrorCode))`,
    purposeEn:
      'Enumerates the five pool error codes: invalid options, a closed pool, a full queue, cancellation while queued and failures collected during close. A QUEUE_FULL or CALL_ABORTED call never reached a member, so it is safe to retry.',
    purposeZh:
      '列出池的五个错误码：选项无效、池已关闭、队列已满、排队期间被取消，以及关闭时汇总的失败。QUEUE_FULL 和 CALL_ABORTED 的调用从未到达成员，可以安全重试。',
    useEn: [
      'Retry policies need to know which rejections never executed.',
      'Shutdown handling needs to inspect CLOSE_FAILED aggregates.'
    ],
    useZh: ['重试策略需要知道哪些拒绝确定没有执行。', '关闭流程需要检查 CLOSE_FAILED 汇总的错误。'],
    avoidEn: [
      'Assuming any pool error means the call was not executed; check the code.',
      'Hard-coding the code strings instead of using the constants.'
    ],
    avoidZh: [
      '以为任何池错误都意味着调用未执行，必须看具体 code。',
      '硬编码错误码字符串而不使用常量。'
    ]
  }),
  'rpc-pool:index:RpcPoolState': guide({
    quickStart: `import { createThreadPool, RpcPoolState } from '@migaia/rpc-pool'

const pool = await createThreadPool({ spawn: new URL('./worker.js', import.meta.url), size: 1 })
console.log(pool.stats().state === RpcPoolState.open)
await pool.close()`,
    purposeEn:
      'Names the lifecycle states reported by pool.stats(): open while accepting work, then closing and closed after close() is called. It is a reporting value for dashboards and shutdown logic, not an error.',
    purposeZh:
      '为 pool.stats() 报告的生命周期状态命名：接纳工作时为 open，调用 close() 后依次为 closing 与 closed。它是用于监控与关闭逻辑的报告值，不是错误。',
    useEn: [
      'Health pages show whether a pool still accepts work.',
      'Shutdown code waits until the pool reports closed.'
    ],
    useZh: ['健康页面展示池是否仍在接纳工作。', '关闭流程等待池报告 closed。'],
    avoidEn: [
      'Polling stats in a hot loop instead of awaiting close().',
      'Inferring member health from the pool state alone.'
    ],
    avoidZh: ['在热循环里轮询 stats，而不是 await close()。', '只凭池状态推断成员的健康情况。']
  })
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

/** SharedWorker examples use one listener and one independently accepted connection per page. */
const browserSharedWorkerPeerCode = `import { createBrowserPeer } from '@migaia/rpc-browser'

// shared.worker.ts, running inside the actual SharedWorker:
const server = await createBrowserPeer({
  listen: self,
  provide: { ping: () => 'pong' },
  report: (error) => console.error(error)
})
server.on('ready', (event) => console.log(event.instanceId))

// page.ts, in each page using that worker:
const worker = new SharedWorker(new URL('./shared.worker.js', import.meta.url), { type: 'module' })
const shared = await createBrowserPeer<{ ping(): string }>({ connect: { sharedWorker: worker } })
console.log(await shared.request('ping'))
await shared.close()
worker.port.close()`

/** RTC examples require the caller's actual already-open, ordered and reliable DataChannel. */
const browserRtcPeerCode = `import { createBrowserPeer } from '@migaia/rpc-browser'

/** Signaling and the channel's native lifetime remain owned by the application. */
export async function callRtc(channel: RTCDataChannel) {
  const peer = await createBrowserPeer<{ echo(value: string): string }>({
    connect: { rtcDataChannel: channel }
  })
  try {
    console.log(await peer.request('echo', 'hello'))
  } finally {
    await peer.close()
  }
}`

/** Both browser error exports share the same diagnostic boundary and retain original causes. */
const browserPeerErrorGuide = guide({
  quickStart: `import { RPC_BROWSER_ERROR_SOURCE, RpcBrowserErrorCode } from '@migaia/rpc-browser'
import { normalizeRpcSerializedError } from '@migaia/rpc-contract/errors'

/** Classify an admitted received diagnostic without granting connection authority. */
export function reportBrowserFailure(received: unknown) {
  const wire = normalizeRpcSerializedError(received)
  if (wire.source === RPC_BROWSER_ERROR_SOURCE) {
    console.error(wire.code, RpcBrowserErrorCode, wire)
  }
  return wire
}`,
  purposeEn:
    'Identifies browser-owned Peer source, explicit-origin, reliable-channel, duplicate-listener and message-decoding failures with the stable @migaia/rpc/browser source and public code table. Native error types and causes survive; Core and Remote keep their call and handshake error identities.',
  purposeZh:
    '以稳定的 @migaia/rpc/browser source 和公开 code 表识别浏览器 Peer 的来源配置、显式 origin、可靠频道、重复监听器和消息解码失败。保留原生错误类型与 cause；调用和握手错误仍归 Core / Remote，不因浏览器载体重建错误身份。',
  useEn: [
    'A browser application distinguishes invalid carrier selection from a Core request deadline.',
    'Diagnostics report WINDOW_ORIGIN_REQUIRED, RTC_CHANNEL_UNRELIABLE, LISTENER_ALREADY_BOUND, INVALID_PEER_SOURCE or MESSAGE_DECODE_FAILED without parsing display text.'
  ],
  useZh: [
    '浏览器应用需要区分非法载体选择与 Core 调用 deadline。',
    '诊断直接报告 WINDOW_ORIGIN_REQUIRED、RTC_CHANNEL_UNRELIABLE、LISTENER_ALREADY_BOUND、INVALID_PEER_SOURCE 或 MESSAGE_DECODE_FAILED，不解析展示文本。'
  ],
  avoidEn: [
    'Treating received source/code fields as evidence that a window, port or channel is trusted.',
    'Replacing the original error or its cause to rewrite a Core or Remote call failure as a browser error.'
  ],
  avoidZh: [
    '把收到的 source/code 字段当成窗口、端口或频道可信的证据。',
    '重建错误或替换 cause，把 Core / Remote 调用失败改写为浏览器错误。'
  ]
})

/** Browser root exports reuse the same Runtime Peer calls as process and thread packages. */
const rpcBrowserPeerGuides = {
  'rpc-browser:index:createBrowserPeer': guide({
    quickStart: `import { createBrowserPeer } from '@migaia/rpc-browser'

/** The iframe provides calculateTotal through createBrowserPeer({ connect, provide }). */
type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): number }
const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
const billing = await createBrowserPeer<IBillingApi>({
  connect: { window: iframe.contentWindow!, origin: 'https://billing.example' }
})
try {
  console.log(await billing.request('calculateTotal', { prices: [12, 30], taxRate: 0.08 }))
} finally {
  await billing.close()
}`,
    purposeEn:
      'Creates a typed Runtime Peer over a borrowed window with explicit origin, a SharedWorker connection port, or an open reliable ordered RTCDataChannel. Core owns handshake, method directory, request/notify/stream, group/outcome and logical cleanup; carrier modules load only when selected.',
    purposeZh:
      '在显式 origin 的借用窗口、SharedWorker 独立连接端口或已打开的可靠有序 RTCDataChannel 上创建带类型的 Runtime Peer。Core 统一拥有握手、方法目录、request/notify/stream、group/outcome 与逻辑清理；所选载体模块才会延迟加载。',
    examplesEn: [
      {
        id: 'shared-worker-peer',
        title: 'One SharedWorker serves several pages',
        description:
          'Run the worker and page portions in their respective hosts. Each connect event gets a separate Core Peer; ready reports accepted identity, and describe().connections shows listener connections. Closing the listener releases logical Peers while leaving borrowed ports open.',
        code: browserSharedWorkerPeerCode
      },
      {
        id: 'rtc-peer',
        title: 'Borrow an ordered reliable RTCDataChannel',
        description:
          'Complete signaling and wait for open first. ordered must be true and maxRetransmits/maxPacketLifeTime must both be null. peer.close() detaches the logical connection; the application retains native channel ownership.',
        code: browserRtcPeerCode
      }
    ],
    examplesZh: [
      {
        id: 'shared-worker-peer',
        title: '一个 SharedWorker 服务多个页面',
        description:
          'Worker 与页面片段分别在对应宿主运行。每个 connect 事件获得独立 Core Peer；ready 报告已接纳身份，describe().connections 查询监听器连接。关闭监听器释放逻辑 Peer，借用端口仍保持打开。',
        code: browserSharedWorkerPeerCode
      },
      {
        id: 'rtc-peer',
        title: '借用可靠有序的 RTCDataChannel',
        description:
          '先完成信令并等待 open。ordered 必须为 true，maxRetransmits/maxPacketLifeTime 都必须为 null。peer.close() 清理逻辑连接；原生频道仍由应用持有和关闭。',
        code: browserRtcPeerCode
      }
    ],
    useEn: [
      'A parent page calls an iframe through a fixed window and explicit origin using the same request API as Worker and process Peers.',
      'A SharedWorker accepts several page ports, or two browsers already hold an open ordered reliable RTCDataChannel.'
    ],
    useZh: [
      '父页面通过固定窗口与显式 origin 调用 iframe，并使用与 Worker、进程 Peer 相同的 request API。',
      'SharedWorker 接纳多个页面端口，或两个浏览器已持有打开的可靠有序 RTCDataChannel。'
    ],
    avoidEn: [
      'The carrier is BroadcastChannel, an idle-terminable Service Worker, or unreliable WebTransport datagrams; use the existing Endpoint transports.',
      'The application needs automatic spawning, signaling, restart supervision or immediate detection of window unload or silent port closure; this factory borrows resources and pending calls use Core deadlines.'
    ],
    avoidZh: [
      '载体是 BroadcastChannel、可空闲终止的 Service Worker 或不可靠的 WebTransport datagram；继续使用现有 Endpoint transport。',
      '需要自动创建载体、信令、重启监督或立即检测窗口卸载/静默端口关闭；工厂借用资源，在途调用按 Core deadline 结束。'
    ]
  }),
  'rpc-browser:index:RPC_BROWSER_ERROR_SOURCE': browserPeerErrorGuide,
  'rpc-browser:index:RpcBrowserErrorCode': browserPeerErrorGuide
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

/** Documents one fixed Probe value or name table at its owning public entry. */
function probeValueGuide(input: {
  readonly name: string
  readonly expression: string
  readonly purposeEn: string
  readonly purposeZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: input.purposeEn,
    purposeZh: input.purposeZh,
    quickStart: `import { ${input.name} } from '@migaia/rpc-core/probe'\n\nconsole.log(${input.expression})`,
    useEn: [
      'A synchronous Probe consumer reads the numeric event view without allocating a named event.',
      'A diagnostic boundary converts the fixed numeric domain into its maintained public name.'
    ],
    useZh: [
      '同步 Probe 消费者直接读取数值事件 view，避免为每个事件再分配对象。',
      '诊断出口把固定数值域转换为统一维护的公开名称。'
    ],
    avoidEn: [
      'Changing numeric members or table order would change the frozen version 1 Probe contract.',
      'Reading a reusable event view after emit returns; retain an explicit snapshot instead.'
    ],
    avoidZh: [
      '修改数值 member 或名称表顺序会改变已经冻结的版本 1 Probe 契约。',
      '在 emit 返回后继续读取复用的事件 view；需要保留时显式创建快照。'
    ]
  })
}

/** Layer 1 exposes Probe definitions while observation runtime remains a later installation. */
const rpcProbeGuides = {
  'rpc-core:probe:RpcProbeStage': probeValueGuide({
    name: 'RpcProbeStage',
    expression: 'RpcProbeStage.message',
    purposeEn:
      'Defines the seven fixed numeric observation stages from peer through carrier. Use the values for mask bits; content capture is separately opt-in, including the protected stage.',
    purposeZh:
      '定义从 peer 到 carrier 的七个固定数值观察阶段，用于计算阶段掩码；内容捕获独立按阶段显式启用，protected 阶段也遵守该规则。'
  }),
  'rpc-core:probe:RpcProbeStageName': probeValueGuide({
    name: 'RpcProbeStageName',
    expression: 'RpcProbeStageName[1]',
    purposeEn:
      'Maps the fixed numeric stage index to its public name in the same order as RpcProbeStage. This table belongs at diagnostics and service boundaries rather than in Core event dispatch.',
    purposeZh:
      '按与 RpcProbeStage 相同的顺序，把固定数值阶段转换为公开名称；名称表用于诊断与 service 出口，Core 事件分发继续读取数值。'
  }),
  'rpc-core:probe:RpcProbeDirection': probeValueGuide({
    name: 'RpcProbeDirection',
    expression: 'RpcProbeDirection.outbound',
    purposeEn:
      'Defines the fixed outbound, inbound and local numeric directions of a Probe event. Direction records the observed side and does not infer an unseen remote event.',
    purposeZh:
      '定义 Probe 事件的 outbound、inbound 与 local 固定数值方向；方向描述实际观察到的一侧，不推断尚未观察到的远端事件。'
  }),
  'rpc-core:probe:RpcProbeDirectionName': probeValueGuide({
    name: 'RpcProbeDirectionName',
    expression: 'RpcProbeDirectionName[0]',
    purposeEn:
      'Converts a Probe direction index to its maintained outbound, inbound or local name. Preserve this order when producing a string event at a diagnostic or service boundary.',
    purposeZh:
      '把 Probe 方向索引转换为统一维护的 outbound、inbound 或 local 名称；诊断与 service 出口生成字符串事件时保持该固定顺序。'
  }),
  'rpc-core:probe:RpcProbeKind': probeValueGuide({
    name: 'RpcProbeKind',
    expression: 'RpcProbeKind.request',
    purposeEn:
      'Defines fixed numeric kinds for requests, responses, notifications, stream events, cancellation, control and lifecycle. A kind describes an observation and does not issue a business operation.',
    purposeZh:
      '定义请求、响应、通知、流事件、取消、控制与生命周期的固定数值种类；kind 只描述实际观察事件，读取它不会发起业务操作。'
  }),
  'rpc-core:probe:RpcProbeKindName': probeValueGuide({
    name: 'RpcProbeKindName',
    expression: 'RpcProbeKindName[0]',
    purposeEn:
      'Maps each Probe kind index to the stable request, response, stream or lifecycle name. Convert only at the consumer boundary so event dispatch can retain small integers.',
    purposeZh:
      '把每个 Probe kind 索引映射为固定的请求、响应、流或生命周期名称；只在消费者出口转换，事件分发继续使用小整数。'
  }),
  'rpc-core:probe:RpcProbeOutcome': probeValueGuide({
    name: 'RpcProbeOutcome',
    expression: 'RpcProbeOutcome.settled',
    purposeEn:
      'Defines the fixed numeric progress and terminal outcomes attached to observed events. An outcome is event metadata and never replaces the original RPC result or failure.',
    purposeZh:
      '定义观察事件携带的固定数值进展与终态结果；outcome 是事件元数据，不会替换原 RPC 返回值、错误身份或失败处理语义。'
  }),
  'rpc-core:probe:RpcProbeOutcomeName': probeValueGuide({
    name: 'RpcProbeOutcomeName',
    expression: 'RpcProbeOutcomeName[6]',
    purposeEn:
      'Converts an observed Probe outcome index into its stable public name. Keep the table aligned with RpcProbeOutcome when formatting service events and recordings.',
    purposeZh:
      '把实际观察到的 Probe outcome 索引转换为固定公开名称；生成 service 事件与录制数据时，名称表与 RpcProbeOutcome 始终保持对应。'
  }),
  'rpc-core:probe:defineProbe': guide({
    purposeEn:
      'Validates and compiles Probe options. The optional host receives Probe fields and private registration, is frozen and returns unchanged by identity; no host copy is made. Pass the handle to a Peer probe option or install it with probePlugin on an Endpoint.',
    purposeZh:
      '验证并编译 Probe 配置；可选 host 直接接收 Probe 字段与私有注册，随后冻结并返回同一引用，不复制 host。把 handle 交给 Peer 的 probe 选项，或通过 probePlugin 在 Endpoint 上安装。',
    quickStart: `import { defineProbe, RpcProbeStageName } from '@migaia/rpc-core/probe'

/** Existing extra members stay on this same object, which definition freezes. */
const host = { name: 'metrics' }
/** Select metadata stages before passing the handle to a Peer. */
const probe = defineProbe({
  stages: ['message', 'frame'], methods: ['math.double'], sample: 0.25,
  emit(view) { console.log(RpcProbeStageName[view.stage], view.method) }
}, host)
console.log(probe === host, Object.isFrozen(host), probe.name)
probe.setStages([]) // Private active mask changes; host.stageMask keeps its initial value.
probe.setStages(['message', 'frame'])`,
    useEn: [
      'Attach the Probe to an existing extensible, non-frozen object while preserving its members and identity.',
      'Use explicit capture and redaction; detail, error and untransferred content retain references under SC9.'
    ],
    useZh: [
      '把 Probe 附到可扩展且未冻结的已有对象，保留原有成员与对象身份。',
      '显式配置 capture/redact；detail、error 与未转移的 content 按 SC9 保留引用。'
    ],
    avoidEn: [
      'Retaining a reusable view after emit returns without an explicit snapshotProbeEvent request.',
      'Applying methods to frame-level events: it filters only message and envelope; other stages use sampling.'
    ],
    avoidZh: [
      '在 emit 返回后直接保留复用 view，而没有显式调用 snapshotProbeEvent。',
      '把 methods 过滤应用到帧层：它只过滤 message/envelope，其它阶段只受采样控制。'
    ]
  }),
  'rpc-core:probe:snapshotProbeEvent': guide({
    purposeEn:
      'Explicitly copies reusable Probe metadata under SC9c so top-level fields survive emit. Detail, error and content keep their original references; later caller mutation remains visible until a real codec boundary converts them.',
    purposeZh:
      '按 SC9c 显式复制复用 Probe 的顶层元数据，使字段在 emit 返回后有效；detail、error、content 保留原引用，调用方后续修改仍可见，直到真实 codec 边界转换表示。',
    quickStart: `import { defineProbe, snapshotProbeEvent, type IRpcProbeEventView } from '@migaia/rpc-core/probe'

/** Retained snapshots belong to this diagnostic consumer. */
const saved: Readonly<IRpcProbeEventView>[] = []
/** Allocate snapshots only at the consumer boundary. */
const probe = defineProbe({
  stages: ['message'],
  emit(view) {
    // SC9(c): explicitly retain top-level metadata, preserving nested references.
    saved.push(snapshotProbeEvent(view))
  }
})
console.log(probe.stageMask)`,
    useEn: [
      'Retain selected events after emit returns for a later diagnostic read.',
      'Take an explicit object copy at a consumer boundary that allows allocation.'
    ],
    useZh: [
      '需要在 emit 返回后保留选定事件，供稍后的诊断读取。',
      '消费者出口允许分配对象，需要明确复制当前事件字段。'
    ],
    avoidEn: [
      'Using snapshots for every collector ingest event defeats its allocation-free storage contract.',
      'Assuming nested content or the referenced error becomes an independent deep copy.'
    ],
    avoidZh: [
      '每次 collector 摄取事件都创建快照，会违反其不分配事件对象的存储契约。',
      '认为嵌套 content 或引用的 error 已经变为完全独立的深复制。'
    ]
  }),
  'rpc-core:probe:rpcProbeSampleKey': guide({
    purposeEn:
      'Returns the FNV-1a 32-bit key over UTF-8 senderId plus messageId. Both observed sides use the same identifiers to reach a deterministic sampling decision without shared state.',
    purposeZh:
      '对 UTF-8 的 senderId 与 messageId 拼接计算 FNV-1a 32 位键；两侧使用相同标识，在没有共享状态时也能得到一致的确定性采样决定。',
    quickStart: `import { rpcProbeSampleKey } from '@migaia/rpc-core/probe'

console.log(rpcProbeSampleKey('caller', 'request-1'))`,
    useEn: [
      'A Probe emitter needs the same sampling key at several observed stages of one message.',
      'Independent caller and receiver consumers sample the same interaction identifiers.'
    ],
    useZh: [
      'Probe emitter 需要在同一消息的多个观察阶段复用相同采样键。',
      '独立的调用方与接收方需要按同一交互标识做一致采样。'
    ],
    avoidEn: [
      'Treating a 32-bit non-cryptographic hash as authentication or a collision-free unique identifier.',
      'Hashing method names or timestamps instead of the interaction identifiers used by both sides.'
    ],
    avoidZh: [
      '把非密码学的 32 位 hash 当作认证依据或绝不碰撞的唯一标识。',
      '改用方法名或时间戳取代两侧共同使用的交互标识计算采样键。'
    ]
  }),
  'rpc-core:probe:probePlugin': guide({
    purposeEn:
      'Installs selected synchronous probes on the existing Endpoint before activation. Stage subscriptions compile once; metadata emission reuses one view and runtime callback failures report PROBE_FAILED without changing request flow.',
    purposeZh:
      '在既有 Endpoint 激活前安装同步 Probe；订阅阶段在构造时编译，元数据事件复用同一个 view。运行时回调失败报告 PROBE_FAILED，不改变业务请求流程。',
    quickStart: `import assert from 'node:assert/strict'
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { defineProbe, probePlugin } from '@migaia/rpc-core/probe'

/** 在同步回调中读标量，不保留复用 view。 */
let events = 0
const probe = defineProbe({ stages: ['message'], emit() { events += 1 } })
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })
server.provide('echo', (context) => context.success(context.data))
const client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [probePlugin(probe), connect({ transport: left })] })
try {
  assert.equal(await client.send('server', 'echo', 'ready'), 'ready')
  assert.ok(events > 0)
} finally {
  await client.dispose()
  await server.dispose()
}`,
    useEn: [
      'Observe metadata on an existing Endpoint using the same emitter as the Peer probe option.',
      'Install probes before activation so describe and optional transport.observe share the original resource scope.'
    ],
    useZh: [
      '通过与 Peer probe 选项相同的 emitter 观察既有 Endpoint 的元数据。',
      '在激活前安装 Probe，让 describe 与可选 transport.observe 共享原有 resource scope。'
    ],
    avoidEn: [
      'Installing an arbitrary object that was not registered by defineProbe; configuration rejects INVALID_CONFIG.',
      'Using the plugin as transport creation, trace propagation or business middleware.'
    ],
    avoidZh: [
      '安装未经 defineProbe 注册的任意对象；配置会以 INVALID_CONFIG 拒绝。',
      '把该插件用于创建 transport、自动传播 trace 或改变业务中间件。'
    ]
  })
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

/** Both devtools entries publish the same canonical error identity. */
const rpcDevtoolsErrorGuide = guide({
  purposeEn:
    'Provides the canonical rpc-devtools source and eight semantic error codes shared by codec, collector and hub. Layer 1 implements codec errors and placeholder CLOSED failures while runtime errors remain declared contracts.',
  purposeZh:
    '提供 codec、collector 与 hub 共用的 rpc-devtools source 和八个语义错误码；layer 1 实现 codec 错误及占位 CLOSED，其它运行时错误仍只属于声明契约。',
  quickStart: `import { RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode } from '@migaia/rpc-devtools/contract'

console.log(RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode)`,
  useEn: [
    'Branch on source and code when decoding a record or encountering a placeholder factory.',
    'Keep the original parse, validation or runtime failure reachable through cause.'
  ],
  useZh: [
    '解码录制数据或调用占位工厂失败时，按 source 与 code 进行分支。',
    '保留 cause，使原始解析、验证或运行时失败仍能追溯。'
  ],
  avoidEn: [
    'Matching message text instead of the registered source and semantic code.',
    'Treating a target lifecycle status as a thrown error code or replacing the original failure.'
  ],
  avoidZh: [
    '匹配 message 文字，而不是已经注册的 source 与语义 code。',
    '把 target 生命周期状态当作抛出的错误码，或替换原始失败。'
  ]
})

/** Every runtime symbol is documented at each of the three devtools public entries. */
const rpcDevtoolsGuides = {
  'rpc-devtools:index:createRpcDevtools': guide({
    purposeEn:
      'Reserves the typed collector factory and its Probe, query, watch, stats, recording and service surface. Layer 1 synchronously throws CLOSED; collection begins only after the collector implementation lands.',
    purposeZh:
      '保留带类型的 collector 工厂及 Probe、query、watch、stats、录制与 service 出口；layer 1 同步抛出 CLOSED，只有 collector 实现合入后才开始采集。',
    quickStart: `import { createRpcDevtools } from '@migaia/rpc-devtools'

/** Compile the contract now; layer 1 rejects until collector runtime lands. */
export function prepareCollector() {
  return createRpcDevtools({ stages: ['message'], sample: 0.25 }) // Layer 1 throws CLOSED.
}`,
    useEn: [
      'Compile future collector integration against the frozen options and service types.',
      'After the runtime implementation lands, attach one metadata-only collector to a host through probe.'
    ],
    useZh: [
      '按冻结的选项与 service 类型，编译后续 collector 接入代码。',
      '运行时实现合入后，通过 probe 为每个宿主接入只读元数据的 collector。'
    ],
    avoidEn: [
      'Expecting the layer 1 placeholder to collect events or provide an operational remote service.',
      'Capturing payloads without explicit capture and redaction, or exposing them without exposeContent.'
    ],
    avoidZh: [
      '期待 layer 1 占位工厂已能采集事件或提供可用远程 service。',
      '未显式设置 capture/redact 就捕获 payload，或未设置 exposeContent 就暴露内容。'
    ]
  }),
  'rpc-devtools:hub:createRpcDevtoolsHub': guide({
    purposeEn:
      'Reserves the typed cross-host hub factory for supplied target clients, timelines and offline records. Layer 1 synchronously throws CLOSED; no transport or target connection is created by this placeholder.',
    purposeZh:
      '保留跨宿主 hub 工厂类型，用于调用方交入的 target client、timeline 与离线录制；layer 1 同步抛出 CLOSED，该占位实现不创建 transport 或 target 连接。',
    quickStart: `import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'

/** Compile the contract now; layer 1 rejects until hub runtime lands. */
export function prepareHub() {
  return createRpcDevtoolsHub({ maxEvents: 50_000, realignMs: 30_000 }) // Layer 1 throws CLOSED.
}`,
    useEn: [
      'Compile future aggregation against the target client and timeline contract.',
      'After hub runtime lands, supply already-created request/stream clients or import offline recordings.'
    ],
    useZh: [
      '按 target client 与 timeline 契约编译后续跨宿主聚合代码。',
      'hub 运行时合入后，交入已经创建的 request/stream client 或导入离线录制。'
    ],
    avoidEn: [
      'Expecting this placeholder to connect targets, align clocks or aggregate statistics.',
      'Asking the hub to create transports, invent a missing observation side or propagate trace automatically.'
    ],
    avoidZh: [
      '期待当前占位工厂已经能连接 target、校准时钟或聚合统计。',
      '要求 hub 创建 transport、补造缺失侧的观察事件或自动传播 trace。'
    ]
  }),
  'rpc-devtools:hub:RpcDevtoolsTargetStatus': guide({
    purposeEn:
      'Defines the connecting, connected, disconnected, offline and removed target states shared by hub consumers. These values describe lifecycle events and never stand in for thrown error codes.',
    purposeZh:
      '定义 hub 消费者共用的 connecting、connected、disconnected、offline 与 removed 状态；这些值描述生命周期事件，不作为抛出的错误码。',
    quickStart: `import { RpcDevtoolsTargetStatus } from '@migaia/rpc-devtools/hub'

console.log(RpcDevtoolsTargetStatus.offline)`,
    useEn: [
      'Render or branch on a target state reported by the later hub implementation.',
      'Distinguish imported offline records from live connected targets.'
    ],
    useZh: [
      '显示后续 hub 实现报告的 target 状态，或据此进行分支。',
      '区分导入的离线录制与实时连接中的 target。'
    ],
    avoidEn: [
      'Throwing lifecycle status values as semantic error codes.',
      'Inferring unseen events or successful reconnection from a disconnected state.'
    ],
    avoidZh: [
      '把生命周期状态值作为语义错误码抛出。',
      '根据 disconnected 状态推断未观察到的事件或已经重连成功。'
    ]
  }),
  'rpc-devtools:contract:RpcDevtoolsRecordFormat': guide({
    purposeEn:
      'Owns the exact NDJSON header format migaia-rpc-devtools and version 1. Collector export and hub offline import reuse this object rather than maintaining separate recording format identifiers.',
    purposeZh:
      '统一维护 NDJSON header 的准确格式名 migaia-rpc-devtools 与版本 1；collector 导出及 hub 离线导入复用该对象，避免各自维护格式标识。',
    quickStart: `import { RpcDevtoolsRecordFormat } from '@migaia/rpc-devtools/contract'

console.log(RpcDevtoolsRecordFormat.format, RpcDevtoolsRecordFormat.version)`,
    useEn: [
      'Construct a version 1 recording header from its canonical package-owned value.',
      'Identify the supported codec format before passing recording data to another consumer.'
    ],
    useZh: [
      '使用包内唯一维护的规范值构造版本 1 的录制 header。',
      '在向其它消费者交入录制数据之前，明确所支持的 codec 格式。'
    ],
    avoidEn: [
      'Changing version or format to make incompatible input appear supported.',
      'Adding private metadata requirements that the frozen minimal header does not define.'
    ],
    avoidZh: [
      '修改版本或格式名，使不兼容的输入表面上看起来受到支持。',
      '为冻结的最小 header 增加没有定义的私有元数据要求。'
    ]
  }),
  'rpc-devtools:contract:encodeRpcDevtoolsRecord': guide({
    purposeEn:
      'Purely encodes a version 1 offline record as UTF-8 NDJSON text, one header followed by event lines. Native and already-serialized errors reuse the RPC codec; bytes use base64 markers without a collector or transport.',
    purposeZh:
      '把版本 1 离线 record 纯函数编码为 UTF-8 NDJSON 文本，第一行为 header，后续每行一个事件；原生与已序列化错误复用 RPC codec，字节使用 base64 标记，不创建 collector 或 transport。',
    quickStart: `import { encodeRpcDevtoolsRecord, RpcDevtoolsRecordFormat } from '@migaia/rpc-devtools/contract'

/** The caller owns storage of this pure codec result. */
const text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [] })
console.log(text)`,
    useEn: [
      'Export already-collected events for the same offline sequence on another machine.',
      'Keep source, code, name, message, stack and the cause chain when recording errors.'
    ],
    useZh: [
      '导出已经采集的事件，在另一台机器还原同一离线序列。',
      '录制错误时保留 source、code、name、message、stack 与 cause 链。'
    ],
    avoidEn: [
      'Expecting the codec to collect events, write files or open a remote service.',
      'Assuming a recording export redacts payloads that were already captured without redaction.'
    ],
    avoidZh: [
      '期待 codec 采集事件、写入文件或打开远程 service。',
      '认为录制导出会自动脱敏此前未经 redact 就已捕获的 payload。'
    ]
  }),
  'rpc-devtools:contract:decodeRpcDevtoolsRecord': guide({
    purposeEn:
      'Purely decodes version 1 NDJSON into offline record events with restored bytes and native errors. It rejects invalid format, version, header or JSON with RECORD_FORMAT_INVALID and keeps the original failure on cause.',
    purposeZh:
      '把版本 1 NDJSON 纯函数解码为离线 record 事件，还原字节与原生错误；非法格式、版本、header 或 JSON 以 RECORD_FORMAT_INVALID 拒绝，原始失败保留在 cause。',
    quickStart: `import { decodeRpcDevtoolsRecord, encodeRpcDevtoolsRecord, RpcDevtoolsRecordFormat } from '@migaia/rpc-devtools/contract'

/** Offline event errors are restored without a live collector. */
const record = decodeRpcDevtoolsRecord(encodeRpcDevtoolsRecord({
  header: RpcDevtoolsRecordFormat, events: []
}))
console.log(record.header.version)`,
    useEn: [
      'Import a recording for offline inspection while retaining its original event sequence.',
      'Restore recorded errors without regenerating their original stack or cause-chain diagnostics.'
    ],
    useZh: [
      '导入录制数据进行离线检查，并保持其原始事件序列。',
      '还原录制错误时不重新生成原始 stack 或 cause 链诊断。'
    ],
    avoidEn: [
      'Accepting a different format or version by silently rewriting its header.',
      'Treating an offline native Error as a service wire error without explicit RPC serialization.'
    ],
    avoidZh: [
      '通过静默改写 header，接纳其它格式或版本的数据。',
      '没有显式 RPC 序列化，就把离线原生 Error 当作 service wire error。'
    ]
  }),
  'rpc-devtools:index:RpcDevtoolsErrorCode': rpcDevtoolsErrorGuide,
  'rpc-devtools:index:RPC_DEVTOOLS_SOURCE': rpcDevtoolsErrorGuide,
  'rpc-devtools:contract:RpcDevtoolsErrorCode': rpcDevtoolsErrorGuide,
  'rpc-devtools:contract:RPC_DEVTOOLS_SOURCE': rpcDevtoolsErrorGuide
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

export const rpcApiGuides = {
  ...rpcProbeGuides,
  ...rpcDevtoolsGuides,
  ...rpcBrowserPeerGuides,
  ...rpcAdapterGuides,
  ...rpcDxRoadmapGuides,
  ...rpcProtocolToolkitGuides,
  ...rpcContractGuides,
  ...webRpcCoreGuides,
  ...webRpcErrorGuides,
  ...rpcPublicErrorGuides,
  ...webRpcConstantGuides
} as const
