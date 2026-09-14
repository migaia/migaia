import type { IApiGuide, IApiGuideExample, IApiOptionGuide, IGuideLocale } from './api-guides.js'

type IWebRpcGuideInput = {
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

/** Builds one maintained bilingual WebRPC guide without cross-locale fallback. */
function guide(input: IWebRpcGuideInput): Readonly<Record<IGuideLocale, IApiGuide>> {
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
    purposeEn: `Creates an endpoint that can ${input.surfaceEn}. Setup is all-or-nothing: if one installation step fails, WebRPC removes the listeners and resources installed by earlier steps.`,
    purposeZh: `创建可${input.surfaceZh}的端点。初始化会整体成功或整体失败；如果中途出错，WebRPC 会清理此前已经安装的监听器和资源。`,
    quickStart: `import { ${input.name} } from '${input.importPath}'\nimport { connect } from '@migaia/web-rpc'\nimport { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'\n\nconst [transport] = createMemoryTransportPair()\nconst endpoint = await ${input.name}({\n  id: 'client',\n  transport,\n  middlewares: [connect({ transport })]\n})\ntry {\n  console.log(endpoint.config)\n} finally {\n  await endpoint.dispose()\n}`,
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
      code: `import { ${imports} } from '@migaia/web-rpc'
import { createWindowMessageTransport } from '@migaia/web-rpc/adapters/window'

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
      code: `import { ${imports} } from '@migaia/web-rpc'
import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'

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
      code: `import { ${imports} } from '@migaia/web-rpc'
import { createBroadcastChannelTransport } from '@migaia/web-rpc/adapters/broadcast-channel'

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
      code: `import { ${imports} } from '@migaia/web-rpc'
import { createServiceWorkerTransport } from '@migaia/web-rpc/adapters/service-worker'

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
      code: `import type { IWebRpcEndpoint } from '@migaia/web-rpc'

type IPreviewDocument = { pages: number }

function renderPreviewLocally(document: IPreviewDocument) {
  console.log('local preview', document.pages)
}

export async function renderPreview(client: IWebRpcEndpoint, document: IPreviewDocument) {
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
      code: `import type { IWebRpcEndpoint } from '@migaia/web-rpc'

export async function checkWorkerBeforePageExit(client: IWebRpcEndpoint) {
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
      code: `import type { IWebRpcEndpoint } from '@migaia/web-rpc'

type IConnectionState = 'online' | 'reconnecting'

export function startConnectionMonitor(
  client: IWebRpcEndpoint,
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
    quickStart: `import { ${imports} } from '@migaia/web-rpc'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'

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
    purposeEn: `Wraps ${input.boundaryEn} as the send/receive connection expected by a WebRPC endpoint. The adapter also records how the two sides are connected, how messages are encoded, and which side must close the host resource.`,
    purposeZh: `把${input.boundaryZh}包装成 WebRPC endpoint 所需的消息收发连接。适配器还会记录两端如何连接、消息如何编码，以及由哪一端负责关闭宿主资源。`,
    quickStart: `import { ${input.name} } from '${input.importPath}'\nimport { connect, createEndpoint } from '@migaia/web-rpc'\n\nconst transport = ${input.expression}\nconst endpoint = await createEndpoint({\n  id: 'local',\n  transport,\n  middlewares: [connect({ transport })]\n})\nendpoint.provide('health', ({ success }) => success({ ok: true }))\ntry {\n  console.log(endpoint.config, 'health provider ready')\n} finally {\n  await endpoint.dispose()\n}`,
    useEn: [
      `The two endpoints communicate through ${input.boundaryEn}.`,
      'Use the adapter when WebRPC should register the message listener and remove it when the endpoint is disposed.'
    ],
    useZh: [
      `两个 endpoint 需要通过${input.boundaryZh}通信。`,
      '需要由 WebRPC 安装消息监听器，并在 endpoint 销毁时自动移除监听器。'
    ],
    avoidEn: [
      input.cautionEn,
      'Do not manually forward internal message objects; doing so skips connection validation and cleanup.'
    ],
    avoidZh: [input.cautionZh, '不要手动转发 WebRPC 内部消息对象，否则会跳过连接校验和自动清理。']
  })
}

/** Creates a reading guide for one public failure class. */
function errorGuide(input: {
  readonly name: string
  readonly conditionEn: string
  readonly conditionZh: string
  readonly distinctionEn: string
  readonly distinctionZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `${input.name} represents ${input.conditionEn}. Its stable source and code let callers handle the failure without parsing message text, while cause and cleanup fields retain the original error.`,
    purposeZh: `${input.name} 表示${input.conditionZh}。调用方可以读取稳定的 source 与 code 处理失败，无需解析 message；原始错误仍保留在 cause 或清理结果字段中。`,
    quickStart: `import type { IWebRpcEndpoint } from '@migaia/web-rpc'\nimport { ${input.name} } from '@migaia/web-rpc'\n\n// endpoint 已由应用按 transport、connect 和服务端 handler 完成组装。\nexport async function callWorker(endpoint: IWebRpcEndpoint) {\n  try {\n    await endpoint.send('worker', 'load', [])\n  } catch (error) {\n    if (error instanceof ${input.name}) {\n      console.error(error.code, error.cause)\n    }\n    throw error\n  }\n}\n\n// 服务端返回失败时，错误会沿 endpoint 边界传回这里；上层可在页面或重试层调用 callWorker(endpoint)。`,
    useEn: [
      input.distinctionEn,
      'Catch it only where the caller can recover, translate, report, or apply a bounded retry policy.'
    ],
    useZh: [input.distinctionZh, '只在调用方能够恢复、转换、报告或执行有上限重试的边界捕获。'],
    avoidEn: [
      'Branching on message text instead of source, code, name, or native error identity.',
      'Constructing it to represent a normal endpoint state.'
    ],
    avoidZh: [
      '不要根据 message 文本分支；应读取 source、code、name 或原生错误类型。',
      '不要用它表示正常 endpoint 状态。'
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
    quickStart: `import { ${input.name} } from '@migaia/web-rpc'\n\nconst value = ${input.name}.${input.member}\nif (value === ${input.name}.${input.member}) {\n  console.log(value) // ${input.value}\n}\n// Business code reads the same canonical member instead of copying the wire-visible string.`,
    useEn: [
      'Code must produce, compare, log, or test the corresponding stable discriminant.',
      'A custom adapter or diagnostic consumer interoperates with WebRPC metadata.'
    ],
    useZh: [
      '代码需要生成、比较、记录或测试对应的 stable discriminant。',
      'custom adapter 或 diagnostic consumer 需要与 WebRPC metadata 互操作。'
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
  preset: `import { chunk, connect, createEndpoint } from '@migaia/web-rpc'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'

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
import { chunk, connect, createEndpoint } from '@migaia/web-rpc'
import { createWindowMessageTransport } from '@migaia/web-rpc/adapters/window'

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
import { chunk, connect, createEndpoint } from '@migaia/web-rpc'
import { createBroadcastChannelTransport } from '@migaia/web-rpc/adapters/broadcast-channel'

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
import { chunk, connect, createEndpoint } from '@migaia/web-rpc'
import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'

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
import { connect, contract, createEndpoint } from '@migaia/web-rpc'
import { createWindowMessageTransport } from '@migaia/web-rpc/adapters/window'

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
import { connect, contract, createEndpoint, timeout } from '@migaia/web-rpc'
import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'

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
import { connect, contract, createEndpoint, timeout } from '@migaia/web-rpc'
import { createBroadcastChannelTransport } from '@migaia/web-rpc/adapters/broadcast-channel'

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
import { connect, contract, createEndpoint } from '@migaia/web-rpc'
import { createServiceWorkerTransport } from '@migaia/web-rpc/adapters/service-worker'

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

/** Human-maintained WebRPC guides keyed by stable public route identity. */
const webRpcCoreGuideEntries: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> =
  {
    'web-rpc:index:createEndpoint': endpointGuide({
      name: 'createEndpoint',
      importPath: '@migaia/web-rpc',
      surfaceEn:
        'call remote methods, provide local methods, discover peers, send control messages, and transfer chunked payloads',
      surfaceZh: '调用远端方法、提供本地方法、发现对端、发送控制消息，并传输需要分片的大数据',
      useEn: 'Use the root preset only when one endpoint needs all five operations listed above.',
      useZh: '只有同一个 endpoint 确实需要上面五类操作时，才使用根入口的完整预设。'
    }),
    'web-rpc:full:createFullEndpoint': endpointGuide({
      name: 'createFullEndpoint',
      importPath: '@migaia/web-rpc/full',
      surfaceEn: 'the explicit full outbound, provider, discovery, control, and chunk surface',
      surfaceZh: '显式完整的 outbound、provider、discovery、control 与 chunk surface',
      useEn: 'The full preset is intentional and the import should make that choice visible.',
      useZh: '明确选择 full preset，并希望 import 直接表达该意图。'
    }),
    'web-rpc:client:createClientEndpoint': endpointGuide({
      name: 'createClientEndpoint',
      importPath: '@migaia/web-rpc/client',
      surfaceEn: 'kernel and outbound call capabilities only',
      surfaceZh: '仅 kernel 与 outbound call capability',
      useEn: 'This endpoint only calls or dispatches to remote providers.',
      useZh: '该 endpoint 只调用远端 provider 或发送单向 dispatch。'
    }),
    'web-rpc:provider:createProviderEndpoint': endpointGuide({
      name: 'createProviderEndpoint',
      importPath: '@migaia/web-rpc/provider',
      surfaceEn: 'outbound calls plus provider registration',
      surfaceZh: 'outbound call 与 provider registration',
      useEn: 'This endpoint exposes methods and may also call its peer.',
      useZh: '该 endpoint 需要暴露 method，并且也可能回调 peer。'
    }),
    'web-rpc:core:createComposedEndpoint': guide({
      purposeEn:
        'Builds the smallest endpoint from an explicit non-empty Feature tuple. Private Feature dependencies are installed and deduplicated without silently widening the public root surface.',
      purposeZh:
        '从显式、非空的 Feature tuple 构造最小 endpoint。私有 Feature dependency 会被安装并去重，但不会静默扩大 public root surface。',
      quickStart:
        "import { connect } from '@migaia/web-rpc'\nimport { createComposedEndpoint } from '@migaia/web-rpc/core'\nimport { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'\nimport { outbound } from '@migaia/web-rpc/features/outbound'\n\nconst [transport] = createMemoryTransportPair()\nconst endpoint = await createComposedEndpoint(\n  { id: 'client', transport, middlewares: [connect({ transport })] },\n  [outbound()] as const\n)\n\ntry {\n  console.log('outbound capability installed:', typeof endpoint.send)\n} finally {\n  await endpoint.dispose()\n}",
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
        'Passing an empty or duplicate Feature tuple.'
      ],
      avoidZh: ['确实需要 complete preset。', '传入空 tuple 或重复 Feature。']
    }),
    'web-rpc:index:defineFeature': guide({
      purposeEn:
        'Defines a reusable WebRPC Feature that contributes capabilities to an endpoint without installing an uncontrolled parallel host.',
      purposeZh:
        '定义可复用的 WebRPC Feature，为 endpoint 增加明确的 capability surface，同时不建立失控的平行 host。Feature factory 在 endpoint 安装时才执行，返回的对象就是调用方随后能够使用的能力面；数据通常从 transport 进入，由已有 Feature 处理后，再通过这个 surface 暴露给业务代码。Feature 也可以通过 dependencies 声明必须先安装的前置能力。',
      quickStart:
        "import { createComposedEndpoint } from '@migaia/web-rpc/core'\nimport { connect, defineFeature } from '@migaia/web-rpc'\nimport { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'\n\nconst audit = defineFeature(() => {\n  let received = 0\n  return {\n    recordMessage: (message: string) => {\n      received += 1\n      console.log('received:', message)\n    },\n    receivedCount: () => received\n  }\n})\n\nconst [clientTransport, serviceTransport] = createMemoryTransportPair()\nconst service = await createComposedEndpoint(\n  { id: 'service', transport: serviceTransport, middlewares: [connect({ transport: serviceTransport })] },\n  [audit] as const\n)\ntry {\n  const message = 'order-created'\n  service.recordMessage(message) // 输入数据进入业务能力；Feature 内部累计处理次数。\n  console.log(service.receivedCount()) // 1：返回值就是 endpoint 安装 audit 后获得的能力面。\n} finally {\n  await service.dispose()\n}",
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
    'web-rpc:index:defineMiddleware': guide({
      purposeEn:
        'Defines a reusable middleware descriptor whose installation and ordering remain owned by the endpoint composition.',
      purposeZh:
        '定义可复用 middleware descriptor，同时让 installation 与 ordering 继续由 endpoint composition 拥有。',
      quickStart:
        "import { connect, createEndpoint, defineMiddleware } from '@migaia/web-rpc'\nimport { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'\n\nconst listener = (message: unknown) => console.log('audit message:', message)\nconst audit = defineMiddleware({\n  name: 'audit',\n  install: ({ core }) => core.hooks.add(listener)\n})\nconst [transport] = createMemoryTransportPair()\nconst endpoint = await createEndpoint({\n  id: 'audited-client',\n  transport,\n  middlewares: [audit, connect({ transport })]\n})\ntry {\n  console.log('audit middleware installed:', endpoint.id)\n} finally {\n  await endpoint.dispose()\n}",
      useEn: ['A cross-cutting concern must be installed consistently on selected endpoints.'],
      useZh: ['cross-cutting concern 需要在选定 endpoint 上一致安装。'],
      avoidEn: ['Mutating endpoint state outside the declared middleware lifecycle.'],
      avoidZh: ['在声明的 middleware lifecycle 之外修改 endpoint state。']
    }),
    'web-rpc:index:framer': guide({
      purposeEn:
        'Defines the frame boundary used to encode and decode transport messages, keeping chunking and message ownership explicit.',
      purposeZh:
        '定义 transport message 使用的 frame boundary，让分片与 message ownership 保持显式。',
      quickStart: `import { chunk as configureChunk, connect, createEndpoint } from '@migaia/web-rpc'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { framer } from '@migaia/web-rpc/middleware'
import { createStringFramer } from '@migaia/rpc-contract/framing'

const [transport] = createMemoryTransportPair()
const framePlugin = framer(createStringFramer({ chunkBytes: 64 }))
const endpoint = await createEndpoint({
  id: 'client',
  transport,
  middlewares: [
    configureChunk({ chunkBytes: 64, maxMessageBytes: 16 * 1024 }),
    framePlugin,
    connect({ transport })
  ]
})

try {
  // chunk middleware 负责选择分片策略，framer 负责实际 frame 边界。
  console.log('chunked framing ready')
} finally {
  await endpoint.dispose()
}`,
      useEn: ['A transport needs an explicit framing policy for bounded messages.'],
      useZh: ['transport 需要为 bounded message 指定显式 framing policy。'],
      avoidEn: ['Treating framing as an unbounded or implicitly shared transport detail.'],
      avoidZh: ['把 framing 当作无界或隐式共享的 transport detail。']
    }),
    'web-rpc:features-control:createControlFeature': guide({
      purposeEn:
        'Adds the control capability to a composed endpoint so cancellation, discovery, and control messages share the endpoint lifecycle.',
      purposeZh:
        '为组合 endpoint 增加 control capability，让 cancellation、discovery 与 control message 共享 endpoint lifecycle。',
      quickStart: `import { connect, ping } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { control } from '@migaia/web-rpc/features/control'

const [clientTransport, workerTransport] = createMemoryTransportPair()
const createPeer = (id: string, targetId: string, transport: typeof clientTransport) =>
  createComposedEndpoint(
    { id, targetIds: [targetId], transport, middlewares: [connect({ transport }), ping()] },
    [control()] as const
  )
const client = await createPeer('client', 'worker', clientTransport)
const worker = await createPeer('worker', 'client', workerTransport)

try {
  console.log(await client.ping('worker', undefined, { timeoutMs: 1_000 }))
} finally {
  await Promise.all([client.dispose(), worker.dispose()])
}`,
      useEn: ['An endpoint needs the explicit control surface in its Feature tuple.'],
      useZh: ['endpoint 需要在 Feature tuple 中显式加入 control surface。'],
      avoidEn: ['Adding control capability when a narrower endpoint surface is sufficient.'],
      avoidZh: ['当更窄的 endpoint surface 已足够时仍加入 control capability。']
    }),
    'web-rpc:features-discovery:createDiscoveryFeature': guide({
      purposeEn:
        'Adds peer discovery capability to a composed endpoint while keeping discovery state and cleanup inside the endpoint lifecycle.',
      purposeZh:
        '为组合 endpoint 增加 peer discovery capability，同时让 discovery state 与 cleanup 保持在 endpoint lifecycle 内。',
      quickStart: `import { connect } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { discovery } from '@migaia/web-rpc/features/discovery'

const [transport] = createMemoryTransportPair()
const endpoint = await createComposedEndpoint(
  {
    id: 'dashboard',
    targetIds: ['worker'],
    transport,
    middlewares: [connect({ transport, discoveryMode: 'automatic' })]
  },
  [discovery()] as const
)

try {
  console.log(endpoint.discovery.getServerList())
} finally {
  await endpoint.dispose()
}`,
      useEn: ['An endpoint must discover peers before selecting a remote target.'],
      useZh: ['endpoint 需要在选择 remote target 前发现 peer。'],
      avoidEn: ['Using discovery when target identity is already explicit and stable.'],
      avoidZh: ['target identity 已明确且稳定时仍使用 discovery。']
    }),
    'web-rpc:index:connect': middlewareGuide({
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
    'web-rpc:index:contract': middlewareGuide({
      name: 'contract',
      purposeEn:
        'Negotiates an accepted protocol version and validates method parameters and results through small parse-compatible schemas at the network boundary.',
      purposeZh:
        '协商可接受的 protocol version，并通过 parse-compatible schema 在 network boundary 校验 method parameter 与 result。',
      code: "import { connect, contract, createEndpoint } from '@migaia/web-rpc'\nimport { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'\n\nconst [clientTransport, serverTransport] = createMemoryTransportPair()\nconst productContract = contract({\n  version: '1',\n  schemas: {\n    findProduct: {\n      params: { parse: (value: unknown) => String(value) },\n      result: { parse: (value: unknown) => value }\n    }\n  }\n})\n\nconst client = await createEndpoint({\n  id: 'client',\n  transport: clientTransport,\n  middlewares: [productContract, connect({ transport: clientTransport })]\n})\nconst server = await createEndpoint({\n  id: 'server',\n  transport: serverTransport,\n  middlewares: [productContract, connect({ transport: serverTransport })]\n})\n\n// 两端共享同一个 contract；请求参数和返回值都会在 wire boundary 校验。\nconsole.log('contract ready:', client.id, server.id)\n\ntry {\n  console.log('业务调用应把 client 接到 outbound、server 接到 provider，双方都会经过上面的参数和返回值校验。')\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n}",
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
    'web-rpc:index:protocol': middlewareGuide({
      name: 'protocol',
      purposeEn:
        'Defines the outbound encoder and inbound decoder for wire envelopes and declares the encoded representation expected by the transport.',
      purposeZh:
        '定义 wire envelope 的 outbound encoder 与 inbound decoder，并声明 transport 期望的 encoded representation。',
      code: "import { protocol } from '@migaia/web-rpc'\n\n// protocol only encodes and decodes the wire envelope; endpoint code supplies business data.\nconst jsonProtocol = protocol({ encodedType: 'string', encode: JSON.stringify, decode: JSON.parse })\nconsole.log(jsonProtocol)",
      useEn:
        'The transport cannot carry structured objects directly or a stable wire codec is required.',
      useZh: 'transport 不能直接承载 structured object，或需要稳定 wire codec。',
      avoidEn: 'Encoding business payloads independently outside the envelope codec.',
      avoidZh: '在 envelope codec 外独立编码 business payload。'
    }),
    'web-rpc:index:authentication': middlewareGuide({
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
    'web-rpc:index:chunk': middlewareGuide({
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
    'web-rpc:index:timeout': middlewareGuide({
      name: 'timeout',
      purposeEn:
        'Applies a bounded deadline to outbound request/response work and rejects timed-out calls with a stable WebRpcTimeoutError contract.',
      purposeZh:
        '为 outbound request/response work 设置有界 deadline，并以稳定 WebRpcTimeoutError contract 拒绝超时调用。',
      code: 'timeout({ timeoutMs: 5_000 })',
      useEn: 'A remote call must not remain pending forever.',
      useZh: 'remote call 不得永久 pending。',
      avoidEn: 'Using a large timeout to conceal an overloaded or unreachable provider.',
      avoidZh: '用很大的 timeout 掩盖 overloaded 或 unreachable provider。'
    }),
    'web-rpc:index:ping': middlewareGuide({
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
    'web-rpc:index:abort': middlewareGuide({
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
    'web-rpc:index:hooks': middlewareGuide({
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
    'web-rpc:index:uuid': middlewareGuide({
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
    'web-rpc:index:codec': guide({
      purposeEn:
        'Declares the wire representation used by an endpoint so encoding and decoding remain symmetric across the transport boundary.',
      purposeZh:
        '声明 endpoint 使用的 wire representation，确保 transport boundary 两侧的 encode 与 decode 保持对称。',
      quickStart: `import { codec, connect, createEndpoint } from '@migaia/web-rpc'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'

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
    'web-rpc:features-outbound:outbound': guide({
      purposeEn:
        'Adds send/sendAll for calls that wait for results and dispatch/dispatchAll for notifications that do not. outbound() has no arguments: transport, peer identity, cancellation, and timeout behavior belong to the endpoint Host and its middleware.',
      purposeZh:
        '给组合式 endpoint 增加四个调用端方法：send/sendAll 会等待远端结果，dispatch/dispatchAll 只发送通知、不等待返回。outbound() 本身没有参数；传输方式、目标身份、取消和超时由 endpoint 宿主及 middleware 配置。',
      quickStart: `import { connect } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { outbound } from '@migaia/web-rpc/features/outbound'
import { provider } from '@migaia/web-rpc/features/provider'

const [clientTransport, workerTransport] = createMemoryTransportPair()
const worker = await createComposedEndpoint(
  { id: 'worker', transport: workerTransport, middlewares: [connect({ transport: workerTransport })] },
  [provider()] as const
)
worker.provide('sum', ({ data, success }) => {
  const [left, right] = data as [number, number]
  return success(left + right)
})
const client = await createComposedEndpoint(
  { id: 'client', targetIds: ['worker'], transport: clientTransport, middlewares: [connect({ transport: clientTransport })] },
  [outbound()] as const
)

try {
  console.log(await client.send<number>('worker', 'sum', [20, 22], { timeoutMs: 3_000 }))
} finally {
  await Promise.all([client.dispose(), worker.dispose()])
}`,
      useEn: [
        'A UI, Worker, or service endpoint must call methods owned by another endpoint.',
        'A notification must reach one or many peers without retaining a result Promise.'
      ],
      useZh: [
        '页面、Worker 或服务端 endpoint 需要调用另一个 endpoint 暴露的方法。',
        '需要向一个或多个目标发送通知，但不需要等待处理结果。'
      ],
      avoidEn: [
        'The endpoint only exposes methods and never initiates calls; provider() already includes its private outbound dependency.',
        'All work is local, so a transport boundary adds no value.'
      ],
      avoidZh: [
        '当前 endpoint 只提供方法、从不主动调用远端；provider() 已包含内部所需依赖。',
        '业务只在当前进程调用普通函数；此时增加传输边界没有收益。'
      ],
      options: [
        {
          name: 'id',
          type: 'string',
          description: '当前 endpoint 的稳定身份；同一传输范围内不能重复。',
          whenToUse: '创建宿主时始终填写可读且稳定的服务名。'
        },
        {
          name: 'transport',
          type: 'IWebRpcTransport',
          description: '消息实际经过的通道，例如 MessagePort、Worker 或 WebTransport adapter。',
          whenToUse: '按真实部署边界选择；测试可用 createMemoryTransportPair()。'
        },
        {
          name: 'targetIds',
          type: 'readonly string[]',
          optional: true,
          description: '启动时已知的目标名单。',
          whenToUse: '拓扑固定时填写；目标完全靠 discovery 获取时可省略。'
        },
        {
          name: 'middlewares',
          type: 'readonly IWebRpcPlugin[]',
          description: '宿主按顺序原子安装的连接、协议、鉴权、超时等行为。',
          whenToUse: 'outbound 至少应配置 connect()，再按场景加入其他 middleware。'
        },
        {
          name: 'send options',
          type: '{ timeoutMs?: number | false; signal?: AbortSignal; transfer?: readonly unknown[] }',
          optional: true,
          description: '单次请求的截止时间、主动取消和 transferable 对象。',
          whenToUse: '远端可能延迟、页面可能卸载或需要零拷贝传输时填写。'
        }
      ]
    }),
    'web-rpc:features-provider:provider': guide({
      purposeEn:
        'Turns a composed endpoint into a method host. provide() registers a named handler and gives it request data, cancellation, and success/failed result builders. provider() already includes the private outbound support required to return results.',
      purposeZh:
        '把组合式 endpoint 变成可被远端调用的方法宿主。provide() 用方法名注册处理函数，并提供请求数据、取消 signal、success() 和 failed() 结果构造器。provider() 已包含返回结果所需的内部 outbound 支持，不必重复添加。',
      quickStart: `import { connect } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { provider } from '@migaia/web-rpc/features/provider'

const [, serviceTransport] = createMemoryTransportPair()
const service = await createComposedEndpoint(
  {
    id: 'calculator',
    transport: serviceTransport,
    providerLimits: { maxGlobal: 64, maxPerPeer: 8 },
    middlewares: [connect({ transport: serviceTransport })]
  },
  [provider()] as const
)
service.provide('multiply', ({ data, success, failed, signal }) => {
  if (signal.aborted) return failed('请求已取消', 'REQUEST_ABORTED')
  const [left, right] = data as [number, number]
  return Number.isFinite(left) && Number.isFinite(right)
    ? success(left * right)
    : failed('参数必须是有限数字', 'INVALID_NUMBER')
})

// 应在服务停止、Worker 退出或测试结束时释放宿主。
await service.dispose()`,
      useEn: [
        'A Worker, iframe, service process, or remote peer must expose named methods.',
        'The Host must bound concurrent remote work and propagate cancellation to handlers.'
      ],
      useZh: [
        'Worker、iframe、服务进程或远端节点需要暴露一组明确的方法。',
        '宿主需要限制远程任务并发量，并把调用方取消信号传给耗时处理函数。'
      ],
      avoidEn: [
        'The endpoint only calls remote methods; outbound() is narrower.',
        'The operation is local and synchronous.'
      ],
      avoidZh: [
        'endpoint 只调用远端方法；应选择更窄的 outbound()。',
        '操作完全在本地同步完成，不需要跨传输边界。'
      ],
      options: [
        {
          name: 'provider',
          type: 'Readonly<Record<string, IWebRpcProvider>>',
          optional: true,
          description: '在宿主可接收请求前一次性注册的初始方法表。',
          whenToUse: '启动时已能确定核心方法时使用；动态方法可稍后调用 provide()。'
        },
        {
          name: 'providerLimits.maxGlobal',
          type: 'number',
          optional: true,
          defaultValue: '256',
          description: '整个 endpoint 同时执行的 provider 请求上限。',
          whenToUse: '按服务可承受的总并发量设置，避免无限排队。'
        },
        {
          name: 'providerLimits.maxPerPeer',
          type: 'number',
          optional: true,
          defaultValue: '64',
          description: '单个对端可占用的并发上限。',
          whenToUse: '多个客户端共享宿主时用于防止单个客户端挤占容量。'
        },
        {
          name: 'provide(method, handler)',
          type: 'IProviderSurface',
          description: '运行时注册方法；handler 必须返回 success(...) 或 failed(...)。',
          whenToUse: '方法按插件、租户或运行阶段动态启用时使用。'
        }
      ]
    }),
    'web-rpc:features-discovery:discovery': guide({
      purposeEn:
        'Adds a peer directory to the endpoint. discovery.getServerList() reads known receivers, pinReceiver() chooses one receiver for later calls, and unpinReceiver() returns to automatic selection. In manual mode, connect also exposes query/register/unregister controls. discovery() has no arguments; connect() owns discovery mode and identity policy.',
      purposeZh:
        '给 endpoint 增加对端目录。discovery.getServerList() 读取已知接收端；pinReceiver() 固定后续调用使用哪个接收端；unpinReceiver() 恢复自动选择。手动模式还会在 connect 上提供 query/register/unregister。discovery() 本身没有参数；发现模式和身份校验由 connect() 配置。',
      quickStart: `import { connect } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { discovery } from '@migaia/web-rpc/features/discovery'

const [transport] = createMemoryTransportPair()
const endpoint = await createComposedEndpoint(
  {
    id: 'dashboard',
    targetIds: ['worker'],
    transport,
    middlewares: [connect({ transport, discoveryMode: 'automatic' })]
  },
  [discovery()] as const
)

const receivers = endpoint.discovery.getServerList('worker')
if (receivers[0]) endpoint.discovery.pinReceiver('worker', receivers[0].receiverId)
endpoint.discovery.unpinReceiver('worker')
await endpoint.dispose()`,
      useEn: [
        'Several receivers may serve one logical target and the caller must inspect or pin the chosen receiver.',
        'Peers appear or disappear while the application is running.'
      ],
      useZh: [
        '一个逻辑目标可能有多个接收端，调用方需要查看或固定实际接收端。',
        '对端会在应用运行期间加入、离开或更换实例。'
      ],
      avoidEn: [
        'A single fixed target is fully described by targetIds.',
        'Discovery is being used as authentication; peer identity still needs an explicit verifier.'
      ],
      avoidZh: [
        '只有一个固定目标，targetIds 已能完整描述拓扑。',
        '试图把发现结果当作身份认证；对端身份仍需明确的 verifier。'
      ],
      options: [
        {
          name: 'connect.discoveryMode',
          type: "'automatic' | 'manual'",
          optional: true,
          defaultValue: "'automatic'",
          description: 'automatic 维护已知接收端；manual 额外开放主动查询和登记方法。',
          whenToUse: '普通应用使用 automatic；需要自定义握手 UI 或目录服务时选择 manual。'
        },
        {
          name: 'connect.identifier',
          type: '(context) => boolean | Promise<boolean>',
          optional: true,
          description: '判断收到的对端身份信息是否可信。',
          whenToUse: '传输允许多个来源或不能仅靠基础 id 判断身份时提供。'
        },
        {
          name: 'connect.receiverSelector',
          type: '(serverList, context) => string | undefined',
          optional: true,
          description: '多个健康接收端同时存在时选择 receiverId。',
          whenToUse: '需要地域、负载或粘性会话策略时提供。'
        },
        {
          name: 'targetIds',
          type: 'readonly string[]',
          optional: true,
          description: '启动时已知的逻辑目标，可与运行时发现结果并用。',
          whenToUse: '先知道服务名、但不知道具体实例时填写。'
        }
      ]
    }),
    'web-rpc:features-control:control': guide({
      purposeEn:
        'Owns control-frame routing for liveness and cancellation. control() automatically brings its private outbound and discovery dependencies, but ping()/pingAll() appear only when ping() middleware is installed. A successful ping proves that the peer answered a control frame; it does not prove authentication or business readiness.',
      purposeZh:
        '负责心跳和取消使用的控制帧路由。control() 会自动带上内部所需的 outbound 与 discovery 依赖，但只有同时安装 ping() middleware，类型和运行时才会提供 ping()/pingAll()。ping 成功只表示对端响应了控制帧，不代表身份可信或业务服务已经就绪。',
      quickStart: `import { connect, ping } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { control } from '@migaia/web-rpc/features/control'

const [clientTransport, workerTransport] = createMemoryTransportPair()
const createPeer = (id: string, targetId: string, transport: typeof clientTransport) =>
  createComposedEndpoint(
    { id, targetIds: [targetId], transport, middlewares: [connect({ transport }), ping()] },
    [control()] as const
  )
const client = await createPeer('client', 'worker', clientTransport)
const worker = await createPeer('worker', 'client', workerTransport)

try {
  const alive = await client.ping('worker', undefined, { timeoutMs: 1_000 })
  console.log(alive)
} finally {
  await Promise.all([client.dispose(), worker.dispose()])
}`,
      useEn: [
        'The application needs a bounded liveness probe before routing expensive work.',
        'A composed endpoint must carry cancellation or other control frames.'
      ],
      useZh: [
        '发送昂贵任务前，需要用有截止时间的探测确认对端仍能响应。',
        '组合式 endpoint 需要传递取消或其他控制消息。'
      ],
      avoidEn: [
        'The result is being treated as authentication or application health.',
        'No control middleware is installed.'
      ],
      avoidZh: [
        '把 ping 结果当成身份认证或业务健康检查。',
        '没有安装任何需要控制帧的 middleware。'
      ],
      options: [
        {
          name: 'ping middleware',
          type: 'ping()',
          description: '显式启用 ping 能力；control() 单独使用不会产生 ping 方法。',
          whenToUse: '需要 ping()/pingAll() 时必须与 control() 一起安装。'
        },
        {
          name: 'ping.timeoutMs',
          type: 'number | false',
          optional: true,
          description: '单次探测最长等待时间；false 表示不设截止时间。',
          whenToUse: '生产环境应设置有限时间，避免失联对端永久占用调用。'
        },
        {
          name: 'ping.signal',
          type: 'AbortSignal',
          optional: true,
          description: '由调用方控制的取消信号。',
          whenToUse: '页面卸载、请求结束或上级任务取消时及时停止探测。'
        },
        {
          name: 'targetIds',
          type: 'readonly string[]',
          optional: true,
          description: '允许探测的逻辑目标初始名单。',
          whenToUse: '对端在启动时已知时填写；动态拓扑可配合 discovery。'
        }
      ]
    }),
    'web-rpc:features-chunk:chunk': guide({
      purposeEn:
        'Lets a composed endpoint receive, validate, and reassemble chunk frames. The feature token selects that runtime owner; the root chunk({...}) middleware separately defines how outgoing strings are split and how much incomplete data may be buffered. Real two-way use normally installs both on every peer.',
      purposeZh:
        '让组合式 endpoint 能接收、校验并重组分片消息。Feature token 负责安装分片帧处理器；根入口的 chunk({...}) middleware 负责配置发送端如何拆分字符串，以及接收端最多允许缓存多少未完成数据。真实双向通信通常要求两端都同时选择 Feature 并安装 middleware。',
      quickStart: `import { chunk as configureChunk, connect } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
import { chunk as selectChunkFrames } from '@migaia/web-rpc/features/chunk'
import { outbound } from '@migaia/web-rpc/features/outbound'
import { provider } from '@migaia/web-rpc/features/provider'

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
    'web-rpc:adapters-memory:createMemoryTransportPair': transportGuide({
      name: 'createMemoryTransportPair',
      importPath: '@migaia/web-rpc/adapters/memory',
      expression: 'createMemoryTransportPair()',
      boundaryEn: 'an isolated in-process paired channel',
      boundaryZh: '隔离的 in-process paired channel',
      cautionEn: 'Production peers live in different processes or browsing contexts.',
      cautionZh: '生产 peer 位于不同 process 或 browsing context。'
    }),
    'web-rpc:adapters-broadcast-channel:createBroadcastChannelTransport': transportGuide({
      name: 'createBroadcastChannelTransport',
      importPath: '@migaia/web-rpc/adapters/broadcast-channel',
      expression: "createBroadcastChannelTransport(new BroadcastChannel('migaia'))",
      boundaryEn: 'a BroadcastChannel shared by same-origin contexts',
      boundaryZh: '由 same-origin context 共享的 BroadcastChannel',
      cautionEn:
        'The channel must be treated as an authentication boundary; BroadcastChannel is an honest-node routing channel.',
      cautionZh:
        '需要把 channel 当作 authentication boundary；BroadcastChannel 只提供 honest-node routing。'
    }),
    'web-rpc:adapters-message-port:createBrowserMessagePortTransport': transportGuide({
      name: 'createBrowserMessagePortTransport',
      importPath: '@migaia/web-rpc/adapters/message-port',
      expression: "createBrowserMessagePortTransport(port, { ownership: 'owned' })",
      boundaryEn: 'a browser MessagePort',
      boundaryZh: 'browser MessagePort',
      cautionEn:
        'The port lifecycle is owned elsewhere; use borrowed custody instead of closing it.',
      cautionZh: 'port lifecycle 由外部拥有；应使用 borrowed custody，不能关闭它。'
    }),
    'web-rpc:adapters-message-port:createNodeMessagePortTransport': transportGuide({
      name: 'createNodeMessagePortTransport',
      importPath: '@migaia/web-rpc/adapters/message-port',
      expression: 'createNodeMessagePortTransport(port)',
      boundaryEn: 'a Node-compatible MessagePort',
      boundaryZh: 'Node-compatible MessagePort',
      cautionEn: 'The value does not implement the Node message, postMessage, and close contract.',
      cautionZh: '该值不实现 Node message、postMessage 与 close contract。'
    }),
    'web-rpc:adapters-web-worker:createWebWorkerTransport': transportGuide({
      name: 'createWebWorkerTransport',
      importPath: '@migaia/web-rpc/adapters/web-worker',
      expression: 'createWebWorkerTransport(worker)',
      boundaryEn: 'a dedicated Worker or WorkerGlobalScope-like port',
      boundaryZh: 'dedicated Worker 或 WorkerGlobalScope-like port',
      cautionEn:
        'Multiple logical peers share the same receiver; use a multiplexed adapter instead.',
      cautionZh: '多个 logical peer 共享同一个 receiver；应使用 multiplexed adapter。'
    }),
    'web-rpc:adapters-shared-worker:createSharedWorkerTransport': transportGuide({
      name: 'createSharedWorkerTransport',
      importPath: '@migaia/web-rpc/adapters/shared-worker',
      expression: 'createSharedWorkerTransport(worker.port)',
      boundaryEn: 'a SharedWorker MessagePort with multiplexed peer assumptions',
      boundaryZh: '具有 multiplexed peer assumption 的 SharedWorker MessagePort',
      cautionEn: 'Peer identity cannot be established for the shared topology.',
      cautionZh: '无法为 shared topology 建立 peer identity。'
    }),
    'web-rpc:adapters-service-worker:createServiceWorkerTransport': transportGuide({
      name: 'createServiceWorkerTransport',
      importPath: '@migaia/web-rpc/adapters/service-worker',
      expression:
        'createServiceWorkerTransport({ target: controller, receiver: navigator.serviceWorker })',
      boundaryEn: 'a ServiceWorker target and its separate message receiver',
      boundaryZh: 'ServiceWorker target 及其独立 message receiver',
      cautionEn:
        'The controlling worker is absent or may change without an owner-managed reconnect.',
      cautionZh: 'controlling worker 不存在，或可能改变但没有 owner-managed reconnect。'
    }),
    'web-rpc:adapters-window:createWindowMessageTransport': transportGuide({
      name: 'createWindowMessageTransport',
      importPath: '@migaia/web-rpc/adapters/window',
      expression:
        "createWindowMessageTransport({ target: frame.contentWindow!, receiver: window, targetOrigin: 'https://trusted.example' })",
      boundaryEn: 'window.postMessage between a window and an iframe or opener',
      boundaryZh: 'window 与 iframe/opener 之间的 window.postMessage',
      cautionEn: 'targetOrigin or source proof cannot be pinned to the intended peer.',
      cautionZh: '无法把 targetOrigin 或 source proof 固定到预期 peer。'
    }),
    'web-rpc:adapters-rtc-data-channel:createRtcDataChannelTransport': transportGuide({
      name: 'createRtcDataChannelTransport',
      importPath: '@migaia/web-rpc/adapters/rtc-data-channel',
      expression: 'createRtcDataChannelTransport(dataChannel)',
      boundaryEn: 'an open RTCDataChannel',
      boundaryZh: '已打开的 RTCDataChannel',
      cautionEn:
        'Signaling, reconnect, or channel negotiation still needs to be performed; this adapter does not own it.',
      cautionZh: 'signaling、reconnect 或 channel negotiation 尚未完成；adapter 不拥有这些流程。'
    }),
    'web-rpc:adapters-web-transport:createWebTransportDatagramTransport': transportGuide({
      name: 'createWebTransportDatagramTransport',
      importPath: '@migaia/web-rpc/adapters/web-transport',
      expression: 'createWebTransportDatagramTransport(session.datagrams)',
      boundaryEn: 'WebTransport unreliable datagrams',
      boundaryZh: 'WebTransport unreliable datagram',
      cautionEn: 'The operation requires ordered or reliable delivery guarantees.',
      cautionZh: 'operation 需要 ordered 或 reliable delivery guarantee。'
    })
  }

/** RPC Contract guide entries introduced by rpc-contract exports used by WebRPC runtime setup. */
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
    ...webRpcCoreGuideEntries,
    'web-rpc:index:chunk': webRpcCoreGuideEntries['web-rpc:features-chunk:chunk']
  })

/** Cross-realm error utilities and stable failure contracts. */
const webRpcErrorGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'web-rpc:index:serializeError': guide({
    purposeEn:
      'Serializes an Error and its bounded cause or AggregateError graph into a cross-realm record containing name, message, stack, source, code, data, and nested failures.',
    purposeZh:
      '把 Error 及其有界 cause/AggregateError graph 序列化成跨 realm record，保留 name、message、stack、source、code、data 与 nested failure。',
    quickStart:
      "import { serializeError } from '@migaia/web-rpc'\n\nconst error = new Error('remote failure')\nconst payload = serializeError(error)\nconsole.log(payload)",
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
  'web-rpc:index:deserializeError': guide({
    purposeEn:
      'Reconstructs a received serialized failure into the closest supported Error class while retaining the transmitted stack, source/code identity, data, and cause graph.',
    purposeZh:
      '把收到的 serialized failure 重建为最接近的受支持 Error class，同时保留 transmitted stack、source/code identity、data 与 cause graph。',
    quickStart:
      "import { deserializeError, serializeError } from '@migaia/web-rpc'\n\nconst message = { error: serializeError(new Error('remote failure')) }\nconst remoteError = deserializeError(message.error)\nconsole.error(remoteError)",
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
  'web-rpc:index:reachError': guide({
    purposeEn:
      'Traverses an error, its cause chain, and AggregateError.errors in bounded identity order so reporting and contract checks can find every reachable original failure.',
    purposeZh:
      '按有界 identity order 遍历 error、cause chain 与 AggregateError.errors，让 reporting 与 contract check 能找到每个可达的原始 failure。',
    quickStart:
      "import { reachError } from '@migaia/web-rpc'\n\nconst originalError = new Error('database unavailable')\nconst error = new Error('request failed', { cause: originalError })\nfor (const cause of reachError(error)) {\n  if (cause === originalError) console.log('original reached')\n}",
    useEn: ['Diagnostics or tests must prove that wrapping preserved original error identity.'],
    useZh: ['diagnostics 或 test 必须证明 wrapping 保留了 original error identity。'],
    avoidEn: [
      'Mutating errors during traversal.',
      'Assuming every yielded value is an Error instance.'
    ],
    avoidZh: ['遍历期间修改 error。', '假设每个 yielded value 都是 Error instance。']
  }),
  'web-rpc:index:isWebRpcError': guide({
    purposeEn:
      'Detects the public WebRPC error shape without same-realm instanceof, making it useful after cross-realm reconstruction.',
    purposeZh:
      '不依赖 same-realm instanceof，按 public WebRPC error shape 做窄化，因此适用于 cross-realm reconstruction 之后。',
    quickStart:
      "import { isWebRpcError } from '@migaia/web-rpc'\n\nconst error: unknown = { source: '@migaia/web-rpc', code: 'DEADLINE_EXCEEDED' }\nif (isWebRpcError(error) && error.code === 'DEADLINE_EXCEEDED') {\n  console.log('retrying after remote deadline')\n}",
    useEn: ['A catch boundary needs machine-readable source/code handling across realms.'],
    useZh: ['catch boundary 需要跨 realm 的 machine-readable source/code handling。'],
    avoidEn: [
      'Using it as proof that an untrusted object is safe.',
      'Replacing AbortError or TimeoutError name checks where those semantics matter.'
    ],
    avoidZh: [
      '把它当作 untrusted object 安全可信的证明。',
      '在需要 AbortError/TimeoutError semantics 时替代 name check。'
    ]
  }),
  'web-rpc:index:WEBRPC_SOURCE': guide({
    purposeEn:
      'Exposes the stable source discriminator stamped onto locally produced WebRPC failures so catch boundaries can distinguish ownership without parsing messages.',
    purposeZh:
      '公开写入本地 WebRPC failure 的稳定 source discriminator，让 catch boundary 无需解析 message 即可区分 ownership。',
    quickStart:
      "import { isWebRpcError, WEBRPC_SOURCE } from '@migaia/web-rpc'\n\nconst error: unknown = { source: WEBRPC_SOURCE, code: 'REMOTE_FAILURE' }\nif (isWebRpcError(error) && error.source === WEBRPC_SOURCE) {\n  console.error('RPC failure:', error)\n}",
    useEn: ['A shared error boundary handles failures from several libraries.'],
    useZh: ['shared error boundary 需要处理来自多个 library 的 failure。'],
    avoidEn: [
      'Treating source as a security credential.',
      'Hard-coding the same string in several consumers.'
    ],
    avoidZh: ['把 source 当作 security credential。', '在多个 consumer 中硬编码同一个 string。']
  }),
  'web-rpc:index:WebRpcError': errorGuide({
    name: 'WebRpcError',
    conditionEn: 'a coded local RPC failure without a more specific public subclass',
    conditionZh: '没有更具体 public subclass 的 coded local RPC failure',
    distinctionEn: 'Handle a stable WebRPC code not represented by a narrower class.',
    distinctionZh: '处理没有 narrower class 表达的稳定 WebRPC code。'
  }),
  'web-rpc:index:WebRpcSchemaValidationError': errorGuide({
    name: 'WebRpcSchemaValidationError',
    conditionEn: 'schema rejection of method parameters or results and retains rejected data',
    conditionZh: 'method parameter 或 result 被 schema 拒绝，并保留 rejected data',
    distinctionEn: 'Reject malformed data at the network contract boundary.',
    distinctionZh: '在 network contract boundary 拒绝 malformed data。'
  }),
  'web-rpc:index:WebRpcConfigurationError': errorGuide({
    name: 'WebRpcConfigurationError',
    conditionEn: 'invalid or conflicting endpoint configuration before operation begins',
    conditionZh: 'operation 开始前的 invalid 或 conflicting endpoint configuration',
    distinctionEn: 'Fix setup; retrying unchanged configuration cannot succeed.',
    distinctionZh: '应修正 setup；原样重试不会成功。'
  }),
  'web-rpc:index:WebRpcConstructionError': errorGuide({
    name: 'WebRpcConstructionError',
    conditionEn:
      'atomic endpoint construction failure with cleanup results from rolled-back resources',
    conditionZh: '原子 endpoint 构造失败，并携带 rolled-back resource 的 cleanup result',
    distinctionEn:
      'Treat cause as primary and cleanupErrors or cleanupPromise as secondary rollback evidence.',
    distinctionZh:
      '以 cause 为 primary failure，以 cleanupErrors 或 cleanupPromise 为 secondary rollback evidence。'
  }),
  'web-rpc:index:WebRpcLifecycleError': errorGuide({
    name: 'WebRpcLifecycleError',
    conditionEn: 'use after endpoint disposal or a terminal lifecycle transition',
    conditionZh: 'endpoint dispose 后继续使用，或发生 terminal lifecycle transition',
    distinctionEn: 'Create a new endpoint instead of reviving a terminal one.',
    distinctionZh: '应创建新 endpoint，不能 revive terminal endpoint。'
  }),
  'web-rpc:index:WebRpcSerializationError': errorGuide({
    name: 'WebRpcSerializationError',
    conditionEn: 'payload or error serialization that cannot preserve the wire contract',
    conditionZh: 'payload 或 error serialization 无法保留 wire contract',
    distinctionEn: 'Correct the payload shape or codec before resending.',
    distinctionZh: '重新发送前修正 payload shape 或 codec。'
  }),
  'web-rpc:index:WebRpcProtocolError': errorGuide({
    name: 'WebRpcProtocolError',
    conditionEn: 'a malformed, undecodable, or semantically invalid wire envelope',
    conditionZh: 'malformed、无法 decode 或语义无效的 wire envelope',
    distinctionEn: 'Treat the peer or codec as incompatible until the mismatch is resolved.',
    distinctionZh: '在 mismatch 解决前，把 peer 或 codec 视为 incompatible。'
  }),
  'web-rpc:index:WebRpcContractError': errorGuide({
    name: 'WebRpcContractError',
    conditionEn: 'protocol-version or declared contract incompatibility between peers',
    conditionZh: 'peer 之间的 protocol-version 或 declared contract incompatibility',
    distinctionEn: 'Negotiate a supported version or deploy matching contracts.',
    distinctionZh: '协商 supported version，或部署匹配 contract。'
  }),
  'web-rpc:index:WebRpcTransportError': errorGuide({
    name: 'WebRpcTransportError',
    conditionEn: 'send, subscription, listener, or channel failure owned by the transport boundary',
    conditionZh: '由 transport boundary 拥有的 send、subscription、listener 或 channel failure',
    distinctionEn: 'Reconnect or replace the transport only when owner policy permits it.',
    distinctionZh: '仅在 owner policy 允许时 reconnect 或 replace transport。'
  }),
  'web-rpc:index:WebRpcAuthenticationError': errorGuide({
    name: 'WebRpcAuthenticationError',
    conditionEn: 'failed frame verification, signing, encryption, or decryption',
    conditionZh: 'frame verification、signing、encryption 或 decryption 失败',
    distinctionEn: 'Reject the frame and inspect keys, peer identity, or transform ordering.',
    distinctionZh: '拒绝 frame，并检查 key、peer identity 或 transform order。'
  }),
  'web-rpc:index:WebRpcChunkError': errorGuide({
    name: 'WebRpcChunkError',
    conditionEn: 'invalid chunk structure or an exceeded reassembly capacity bound',
    conditionZh: 'chunk structure 无效，或超过 reassembly capacity bound',
    distinctionEn: 'Reject the assembly instead of retaining unbounded peer-controlled memory.',
    distinctionZh: '拒绝 assembly，不能保留无界 peer-controlled memory。'
  }),
  'web-rpc:index:WebRpcRemoteError': errorGuide({
    name: 'WebRpcRemoteError',
    conditionEn: 'a provider-declared remote business failure reconstructed on the caller',
    conditionZh: 'provider 声明的 remote business failure 在 caller 侧重建',
    distinctionEn: 'Handle provider code and optional data as a remote application contract.',
    distinctionZh: '把 provider code 与 optional data 作为 remote application contract 处理。'
  }),
  'web-rpc:index:WebRpcAbortError': errorGuide({
    name: 'WebRpcAbortError',
    conditionEn: 'caller or owner cancellation with the standard AbortError name',
    conditionZh: 'caller 或 owner cancellation，并公开标准 AbortError name',
    distinctionEn:
      'Stop dependent work and preserve the reason; do not report expected cancellation as a fault.',
    distinctionZh: '停止 dependent work 并保留 reason；不要把预期 cancellation 报告成 fault。'
  }),
  'web-rpc:index:WebRpcTimeoutError': errorGuide({
    name: 'WebRpcTimeoutError',
    conditionEn: 'an exceeded call deadline with the standard TimeoutError name',
    conditionZh: 'call deadline 超限，并公开标准 TimeoutError name',
    distinctionEn:
      'Retry only when the method is repeat-safe and the caller owns a bounded retry policy.',
    distinctionZh: '只有 method 可安全重复且 caller 拥有 bounded retry policy 时才能重试。'
  })
}

/** Stable protocol discriminants used by adapters, diagnostics, and tests. */
const webRpcConstantGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'web-rpc:protocol-constants:WebRpcMessageKind': constantGuide({
    name: 'WebRpcMessageKind',
    roleEn: 'wire-envelope kind set',
    roleZh: 'wire-envelope kind 集合',
    member: 'request',
    value: 'request envelope'
  }),
  'web-rpc:protocol-constants:WebRpcVariation': constantGuide({
    name: 'WebRpcVariation',
    roleEn: 'control variation set',
    roleZh: 'control variation 集合',
    member: 'abort',
    value: 'abort control frame'
  }),
  'web-rpc:protocol-constants:WebRpcPlatform': constantGuide({
    name: 'WebRpcPlatform',
    roleEn: 'transport platform labels',
    roleZh: 'transport platform label',
    member: 'worker',
    value: 'Worker transport'
  }),
  'web-rpc:protocol-constants:WebRpcTransportOwnership': constantGuide({
    name: 'WebRpcTransportOwnership',
    roleEn: 'transport custody modes',
    roleZh: 'transport custody mode',
    member: 'borrowed',
    value: 'remove listeners without closing the host resource'
  }),
  'web-rpc:protocol-constants:WebRpcTransportEncoding': constantGuide({
    name: 'WebRpcTransportEncoding',
    roleEn: 'transport encoding capabilities',
    roleZh: 'transport encoding capability',
    member: 'uint8Array',
    value: 'binary encoded frames'
  }),
  'web-rpc:protocol-constants:WebRpcTransportTopology': constantGuide({
    name: 'WebRpcTransportTopology',
    roleEn: 'peer fan-out and trust topology labels',
    roleZh: 'peer fan-out 与 trust topology label',
    member: 'multiplexed',
    value: 'several logical peers share a channel'
  }),
  'web-rpc:protocol-constants:WebRpcEndpointStatus': constantGuide({
    name: 'WebRpcEndpointStatus',
    roleEn: 'discovery-visible endpoint states',
    roleZh: 'discovery-visible endpoint state',
    member: 'active',
    value: 'endpoint accepts work'
  }),
  'web-rpc:protocol-constants:WebRpcOperation': constantGuide({
    name: 'WebRpcOperation',
    roleEn: 'single-target operation labels',
    roleZh: 'single-target operation label',
    member: 'send',
    value: 'request and response operation'
  }),
  'web-rpc:protocol-constants:WebRpcControlKind': constantGuide({
    name: 'WebRpcControlKind',
    roleEn: 'provider-control admission kinds',
    roleZh: 'provider-control admission kind',
    member: 'request',
    value: 'provider request work'
  }),
  'web-rpc:protocol-constants:WebRpcCandidateStatus': constantGuide({
    name: 'WebRpcCandidateStatus',
    roleEn: 'discovery candidate states',
    roleZh: 'discovery candidate state',
    member: 'stale',
    value: 'candidate is known but not currently active'
  }),
  'web-rpc:protocol-constants:WebRpcContractFailureKind': constantGuide({
    name: 'WebRpcContractFailureKind',
    roleEn: 'structured contract failure kinds',
    roleZh: 'structured contract failure kind',
    member: 'schemaValidation',
    value: 'schema rejected boundary data'
  }),
  'web-rpc:protocol-constants:WebRpcDebugPhase': constantGuide({
    name: 'WebRpcDebugPhase',
    roleEn: 'test-only endpoint lifecycle snapshot phases',
    roleZh: 'test-only endpoint lifecycle snapshot phase',
    member: 'disposed',
    value: 'endpoint reached terminal disposal'
  }),
  'web-rpc:protocol-constants:WebRpcChunkEvent': constantGuide({
    name: 'WebRpcChunkEvent',
    roleEn: 'chunk admission and expiry hook names',
    roleZh: 'chunk admission 与 expiry hook name',
    member: 'rejected',
    value: 'chunk admission was rejected'
  })
}

export const webRpcApiGuides = {
  ...rpcContractGuides,
  ...webRpcCoreGuides,
  ...webRpcErrorGuides,
  ...webRpcConstantGuides
} as const
