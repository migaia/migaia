/**
 * Reference documentation of `@migaia/rpc-browser`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/rpc-browser/src` (browser/peer*.ts, browser/adapters/*.ts, error-code.ts),
 * `packages/rpc-core/src/remote/runtime-api/peer.ts` (inherited Peer options and the returned
 * `IRuntimePeer`), README and USEGUIDE on 2026-10-17. Interop examples rechecked on 2026-10-17:
 * Window/ServiceWorker transports dispatch raw inbound records and expose sourceProof; Peer
 * projection or Endpoint connect owns actual admission. RTC transport stringifies sends but does
 * not decode receives (peer-port owns JSON decoding). SharedWorker listeners accept every event
 * port, not only ports[0]. WebTransport has no shipped direct Core Endpoint recipe: its
 * Uint8Array-only carrier rejects the default unknown-output framer and the native binary framer's
 * carrier-or-fragment output. Its example stays raw I/O.
 */
import type {
  ICode,
  IEnhancerDoc,
  ILibraryReference,
  IMemberDoc,
  IOptionCaseDoc,
  IText
} from './contract.js'
import { runtimePeerOptionMembers } from './rpc-runtime-shared.js'
import { rpcBrowserCases } from './rpc-browser-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Docs of `addEventListener` / `removeEventListener` pairs on message receivers. */
const listenerPair = (
  event: string,
  owner: IText,
  example: ICode
): Readonly<Record<string, IMemberDoc>> => ({
  addEventListener: {
    summary: t(
      `Registers a \`${event}\` listener on ${owner.en}; listening installs it; raw transports wait for the first subscription or error observer.`,
      `在${owner.zh}上登记 \`${event}\` 监听；原始载体在首次订阅或错误观察开始时安装，监听工厂在开始接纳时安装。`
    ),
    params: {
      type: t(`Event name: ${event}.`, `事件名称：${event}。`),
      listener: t('Listener the transport installs.', '由 transport 安装的监听函数。')
    },
    returns: t('Nothing; the listener is registered.', '无返回值；监听已登记。'),
    example
  },
  removeEventListener: {
    summary: t(
      `Removes the native listener after its final corresponding subscription is released; closing its owning Peer or listener also releases those subscriptions.`,
      `最后一个对应订阅释放后移除原生监听；所属运行对端或接纳监听者关闭时也释放这些订阅。`
    ),
    params: {
      type: t(`Event name: ${event}.`, `事件名称：${event}。`),
      listener: t('The same listener installed before.', '之前安装的同一个监听函数。')
    },
    returns: t('Nothing; the listener is removed.', '无返回值；监听已移除。'),
    example
  }
})

/** Places both real files in one code node with explicitly translated file and ownership notes. */
const paired = (
  first: IText,
  firstCode: string,
  second: IText,
  secondCode: string,
  notes: readonly IText[] = []
): IText => {
  /** Only comments differ by locale; executable contracts and values stay identical. */
  const render = (locale: keyof IText): string =>
    [
      ...notes.map((note) => '// ' + note[locale]),
      '// ' + first[locale],
      firstCode,
      '',
      '// ' + second[locale],
      secondCode
    ].join('\n')
  return { en: render('en'), zh: render('zh') }
}

/** Both iframe peers expose one typed contract and keep the borrowed Window lifecycle explicit. */
const iframePeerExample = paired(
  t(
    'parent.ts at https://shop.example: origins come from fixed deployment URLs.',
    '父页面 parent.ts：部署在固定商城源，来源域取自应用部署地址。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): Promise<number> }
type IPageApi = { pageTitle(): string }
const childUrl = new URL('https://billing.example/child.html')
const iframe = document.createElement('iframe')
document.body.append(iframe)
const started = new Promise<void>((resolve) => {
  const ready = (event: MessageEvent) => {
    if (event.source === iframe.contentWindow && event.origin === childUrl.origin && event.data === 'billing-ready') {
      window.removeEventListener('message', ready)
      resolve()
    }
  }
  window.addEventListener('message', ready)
})
iframe.src = childUrl.href
await started
const billing = await createBrowserPeer<IBillingApi>({
  connect: { window: iframe.contentWindow!, origin: childUrl.origin },
  provide: { pageTitle: () => document.title } satisfies IPageApi,
  defaultTimeoutMs: 5000
})
try { console.log(await billing.request('calculateTotal', { prices: [12, 30], taxRate: 0.08 })) }
finally { await billing.close(); iframe.remove() }`,
  t(
    'child.ts at https://billing.example: the parent origin is fixed by deployment, never inferred from incoming data.',
    '子页面 child.ts：部署在固定账单源，父来源域由部署指定，不从接收数据推断。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): Promise<number> }
type IPageApi = { pageTitle(): string }
const parentOrigin = 'https://shop.example'
const opening: Promise<IRuntimeTypedPeer<IPageApi>> = createBrowserPeer<IPageApi>({
  connect: { window: window.parent, origin: parentOrigin },
  provide: {
    async calculateTotal({ prices, taxRate }) {
      const parent = await opening
      console.log(await parent.request('pageTitle'))
      return prices.reduce((a, b) => a + b, 0) * (1 + taxRate)
    }
  } satisfies IBillingApi
})
window.parent.postMessage('billing-ready', parentOrigin)
const parent = await opening
window.addEventListener('pagehide', () => { void parent.close() }, { once: true })`,
  [
    t(
      'Both factories run concurrently. The parent owns the iframe; pagehide cleanup is best-effort during navigation.',
      '两端工厂并发启动；父页面拥有内嵌窗口，导航期间的页面隐藏清理为尽力执行。'
    )
  ]
)

/** Popup ownership requires a retained opener and an explicit origin in each direction. */
const popupPeerExample = paired(
  t(
    'opener.ts at https://shop.example: run from a user gesture; the opener owns popup.close().',
    '打开方 opener.ts：部署在商城源，从用户操作运行，由打开方负责关闭弹窗。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
type IPopupApi = { double(value: number): Promise<number> }
type IOpenerApi = { pageTitle(): string }
export async function openCalculator() {
  const childUrl = new URL('https://billing.example/popup.html')
  const popup = window.open('about:blank', 'calculator')
  if (!popup) throw new Error('Popup blocked')
  const started = new Promise<void>((resolve) => {
    const ready = (event: MessageEvent) => {
      if (event.source === popup && event.origin === childUrl.origin && event.data === 'popup-ready') {
        window.removeEventListener('message', ready)
        resolve()
      }
    }
    window.addEventListener('message', ready)
  })
  popup.location.href = childUrl.href
  await started
  const peer = await createBrowserPeer<IPopupApi>({
    connect: { window: popup, origin: childUrl.origin },
    provide: { pageTitle: () => document.title } satisfies IOpenerApi
  })
  try { console.log(await peer.request('double', 21)) }
  finally { await peer.close(); popup.close() }
}`,
  t(
    'popup.ts at https://billing.example: deployment must retain window.opener; no noopener or isolating policy.',
    '弹窗 popup.ts：部署须保留原生打开方引用，不能使用断开打开方的设置或隔离策略。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
type IPopupApi = { double(value: number): Promise<number> }
type IOpenerApi = { pageTitle(): string }
const openerOrigin = 'https://shop.example'
const opener = window.opener as Window | null
if (!opener) throw new Error('Opener unavailable')
const opening: Promise<IRuntimeTypedPeer<IOpenerApi>> = createBrowserPeer<IOpenerApi>({
  connect: { window: opener, origin: openerOrigin },
  provide: {
    async double(value) {
      const parent = await opening
      console.log(await parent.request('pageTitle'))
      return value * 2
    }
  } satisfies IPopupApi
})
opener.postMessage('popup-ready', openerOrigin)
const parent = await opening
window.addEventListener('pagehide', () => { void parent.close() }, { once: true })`
)

/**
 * One SharedWorker listener accepts many page-owned ports without pretending there is one remote
 * page.
 */
const sharedPeerExample = paired(
  t(
    'page.ts: open this same page in two tabs; each has an independent Peer and native port.',
    '页面 page.ts：在两个标签页打开同一页面，各自拥有独立对端和原生端口。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
type ISharedApi = { double(value: number): number; count(limit: number): AsyncIterableIterator<number> }
type IPageApi = { pageTitle(): string }
const worker = new SharedWorker(new URL('./shared.worker.js', import.meta.url), { type: 'module', name: 'shared-rpc' })
const shared = await createBrowserPeer<ISharedApi>({
  connect: { sharedWorker: worker },
  provide: { pageTitle: () => document.title } satisfies IPageApi
})
try {
  console.log(await shared.request('double', 21))
  for await (const value of shared.stream('count', 3)) console.log(value)
} finally { await shared.close(); worker.port.close() }`,
  t(
    'shared.worker.ts: compile with the WebWorker library; the application service owner calls stopService when all pages are done.',
    '共享工作者 shared.worker.ts：以工作者类型库编译，所有页面结束后由应用服务所有者调用停止函数。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
declare const self: SharedWorkerGlobalScope
type ISharedApi = { double(value: number): number; count(limit: number): AsyncIterableIterator<number> }
type IPageApi = { pageTitle(): string }
const server = await createBrowserPeer<IPageApi>({
  listen: self,
  provide: {
    double: (value) => value * 2,
    async *count(limit) { for (let value = 1; value <= limit; value++) yield value }
  } satisfies ISharedApi,
  report: (error) => console.error(error)
})
server.on('ready', (event) => console.log(event.instanceId))
export async function stopService() { await server.close(); self.close() }`,
  [
    t(
      'The listener serves all accepted pages. An unqualified reverse request is ambiguous with several pages; do not invent a target selector.',
      '监听者服务全部已接纳页面；多个页面存在时未指定目标的反向请求有歧义，不能虚构目标选择参数。'
    )
  ]
)

/** Signaling is an explicit application prerequisite, separate from the actual connected Peer pair. */
const rtcPeerExample = paired(
  t(
    'rtc-a.ts: application supplies the open caller-created channel and its owning RTCPeerConnection.',
    '对等端甲 rtc-a.ts：应用提供已打开的主动创建频道及其所属原生连接。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
type IRemoteApi = { double(value: number): number }
type ILocalApi = { label(): string }
export async function attachA(channel: RTCDataChannel, connection: RTCPeerConnection) {
  const peer = await createBrowserPeer<IRemoteApi>({
    connect: { rtcDataChannel: channel },
    provide: { label: () => 'browser-a' } satisfies ILocalApi
  })
  console.log(await peer.request('double', 21))
  return async () => { await peer.close(); channel.close(); connection.close() }
}`,
  t(
    'rtc-b.ts: application supplies the matching open channel received through the native datachannel event.',
    '对等端乙 rtc-b.ts：应用提供从原生数据频道事件取得的匹配已打开频道。'
  ),
  `import { createBrowserPeer } from '@migaia/rpc-browser'
type IRemoteApi = { double(value: number): number }
type ILocalApi = { label(): string }
export async function attachB(channel: RTCDataChannel, connection: RTCPeerConnection) {
  const peer = await createBrowserPeer<ILocalApi>({
    connect: { rtcDataChannel: channel },
    provide: { double: (value) => value * 2 } satisfies IRemoteApi
  })
  console.log(await peer.request('label'))
  return async () => { await peer.close(); channel.close(); connection.close() }
}`,
  [
    t(
      'Application supplies SDP/ICE signaling and waits for open on both ends; use ordered:true and unlimited retransmission. After both attachments, application calls both returned cleanup functions.',
      '应用自备会话描述及候选地址信令，等待两端频道打开；使用有序及无限重传配置，两端挂接后由应用调用返回的清理函数。'
    )
  ]
)

/** Direct Endpoint example binds source proof and typed provider data at both actual Window owners. */
const windowEndpointExample = paired(
  t(
    'parent-endpoint.ts at https://shop.example: attach readiness before navigating the owned iframe.',
    '父端点 parent-endpoint.ts：部署在商城源，导航自有内嵌窗口之前登记就绪监听。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'
type IChildApi = { double(value: number): number }
type IParentApi = { title(): string }
const childUrl = new URL('https://billing.example/endpoint.html')
const iframe = document.createElement('iframe')
document.body.append(iframe)
const started = new Promise<void>((resolve) => {
  const ready = (event: MessageEvent) => {
    if (event.source === iframe.contentWindow && event.origin === childUrl.origin && event.data === 'endpoint-ready') {
      window.removeEventListener('message', ready); resolve()
    }
  }
  window.addEventListener('message', ready)
})
iframe.src = childUrl.href
await started
const transport = createWindowMessageTransport({ target: iframe.contentWindow!, targetOrigin: childUrl.origin })
const endpoint = await createEndpoint({ id: 'parent', targetIds: ['child'], transport, middlewares: [connect({ transport }), contract({ version: '1.0.0' })] })
endpoint.provide('title', (context) => context.success(document.title satisfies ReturnType<IParentApi['title']>))
try { console.log(await endpoint.send<ReturnType<IChildApi['double']>>('child', 'double', 21 satisfies Parameters<IChildApi['double']>[0])) }
finally { await endpoint.dispose(); iframe.remove() }`,
  t(
    'child-endpoint.ts at https://billing.example: parent origin is a fixed deployment value.',
    '子端点 child-endpoint.ts：部署在账单源，父来源域为固定部署值。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'
type IChildApi = { double(value: number): number }
type IParentApi = { title(): string }
const parentOrigin = 'https://shop.example'
const transport = createWindowMessageTransport({ target: window.parent, targetOrigin: parentOrigin })
const endpoint = await createEndpoint({ id: 'child', targetIds: ['parent'], transport, middlewares: [connect({ transport }), contract({ version: '1.0.0' })] })
endpoint.provide('double', async (context) => {
  console.log(await endpoint.send<ReturnType<IParentApi['title']>>('parent', 'title', null))
  return context.success((context.data as Parameters<IChildApi['double']>[0]) * 2)
})
window.addEventListener('pagehide', () => { void endpoint.dispose() }, { once: true })
window.parent.postMessage('endpoint-ready', parentOrigin)`
)

/** Direct shared-worker endpoints retain separate native ports and per-page provider registries. */
const sharedEndpointExample = paired(
  t(
    'page-endpoint.ts: each page owns and finally closes its own SharedWorker port.',
    '页面端点 page-endpoint.ts：每个页面拥有并最终关闭自身共享工作者端口。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'
type ISharedApi = { double(value: number): number }
type IPageApi = { title(): string }
const worker = new SharedWorker(new URL('./shared-endpoint.worker.js', import.meta.url), { type: 'module' })
const transport = createSharedWorkerTransport(worker.port)
const endpoint = await createEndpoint({ id: 'page', targetIds: ['shared'], transport, middlewares: [connect({ transport }), contract({ version: '1.0.0' })] })
endpoint.provide('title', (context) => context.success(document.title satisfies ReturnType<IPageApi['title']>))
try { console.log(await endpoint.send<ReturnType<ISharedApi['double']>>('shared', 'double', 21 satisfies Parameters<ISharedApi['double']>[0])) }
finally { await endpoint.dispose(); worker.port.close() }`,
  t(
    'shared-endpoint.worker.ts: one Endpoint per actual connect port; service owner calls stopService at shutdown.',
    '工作者端点 shared-endpoint.worker.ts：每个实际连接端口建立一个端点，关闭服务时由服务所有者调用停止函数。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'
declare const self: SharedWorkerGlobalScope
type ISharedApi = { double(value: number): number }
type IPageApi = { title(): string }
const cleanups = new Set<() => Promise<void>>()
self.addEventListener('connect', (event) => {
  for (const port of event.ports) {
    const transport = createSharedWorkerTransport(port)
    const opening = createEndpoint({ id: 'shared', targetIds: ['page'], transport, middlewares: [connect({ transport }), contract({ version: '1.0.0' })] }).then((endpoint) => {
      endpoint.provide('double', async (context) => {
        console.log(await endpoint.send<ReturnType<IPageApi['title']>>('page', 'title', null))
        return context.success((context.data as Parameters<ISharedApi['double']>[0]) * 2)
      })
      cleanups.add(async () => { await endpoint.dispose(); port.close() })
    })
    void opening.catch((error) => console.error(error))
  }
})
export async function stopService() {
  for (const close of cleanups) await close()
  cleanups.clear(); self.close()
}`
)

/**
 * Same-origin BroadcastChannel remains broadcast while explicit endpoint IDs select logical
 * methods.
 */
const broadcastExample = paired(
  t(
    'tab-a.ts: open tab B first; both tabs must share origin, storage partition and channel name.',
    '标签页甲 tab-a.ts：先打开乙页，两页须同源、同存储分区且使用相同频道名。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'
type ICartApi = { count(input: { add: number }): number }
type IPageApi = { title(): string }
const channel = new BroadcastChannel('cart-rpc')
const transport = createBroadcastChannelTransport(channel)
const endpoint = await createEndpoint({ id: 'tab-a', targetIds: ['tab-b'], transport, middlewares: [connect({ transport }), contract({ version: '1.0.0' })] })
endpoint.provide('title', (context) => context.success(document.title satisfies ReturnType<IPageApi['title']>))
try { console.log(await endpoint.send<ReturnType<ICartApi['count']>>('tab-b', 'count', { add: 2 } satisfies Parameters<ICartApi['count']>[0])) }
finally { await endpoint.dispose(); channel.close() }`,
  t(
    'tab-b.ts: provider tab owns its channel; application calls closeTab before removing this service.',
    '标签页乙 tab-b.ts：提供方页面拥有频道，应用移除此服务前调用关闭函数。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'
type ICartApi = { count(input: { add: number }): number }
type IPageApi = { title(): string }
const channel = new BroadcastChannel('cart-rpc')
const transport = createBroadcastChannelTransport(channel)
const endpoint = await createEndpoint({ id: 'tab-b', targetIds: ['tab-a'], transport, middlewares: [connect({ transport }), contract({ version: '1.0.0' })] })
endpoint.provide('count', async (context) => {
  console.log(await endpoint.send<ReturnType<IPageApi['title']>>('tab-a', 'title', null))
  return context.success(3 + (context.data as Parameters<ICartApi['count']>[0]).add)
})
export async function closeTab() { await endpoint.dispose(); channel.close() }
window.addEventListener('pagehide', () => { void closeTab() }, { once: true })`
)

/** Service Worker bootstrap obtains a real Client before creating its source-bound Endpoint. */
const serviceExample = paired(
  t(
    'service-page.ts: application owns the registration; cleanup closes the logical endpoint without unregistering the service.',
    '服务页面 service-page.ts：应用拥有注册，清理关闭逻辑端点而不注销服务。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'
type IServiceApi = { double(value: number): number }
type IPageApi = { title(): string }
await navigator.serviceWorker.register(new URL('./service-worker.js', import.meta.url), { type: 'module' })
const registration = await navigator.serviceWorker.ready
const target = registration.active!
const opened = new Promise<string>((resolve) => {
  const ready = (event: MessageEvent) => {
    if (event.source === target && event.data?.kind === 'endpoint-ready') {
      navigator.serviceWorker.removeEventListener('message', ready)
      resolve(event.data.clientId)
    }
  }
  navigator.serviceWorker.addEventListener('message', ready)
})
target.postMessage({ kind: 'open-endpoint' })
const clientId = await opened
const transport = createServiceWorkerTransport({ target, receiver: navigator.serviceWorker })
const endpoint = await createEndpoint({ id: 'page-' + clientId, targetIds: ['service-' + clientId], transport, middlewares: [connect({ transport, useBaseIdVerifyOnly: false, identifier: ({ senderId }) => senderId === 'service-' + clientId }), contract({ version: '1.0.0' })] })
endpoint.provide('title', (context) => context.success(document.title satisfies ReturnType<IPageApi['title']>))
try { console.log(await endpoint.send<ReturnType<IServiceApi['double']>>('service-' + clientId, 'double', 21 satisfies Parameters<IServiceApi['double']>[0])) }
finally { await endpoint.dispose(); target.postMessage({ kind: 'close-endpoint' }) }`,
  t(
    'service-worker.ts: compile with WebWorker types; clients.get supplies the actual browser-issued Client identity.',
    '服务工作者 service-worker.ts：以工作者类型库编译，通过原生客户端查询取得浏览器签发的真实客户端身份。'
  ),
  `import { connect, contract, createEndpoint } from '@migaia/rpc-core'
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'
declare const self: ServiceWorkerGlobalScope
type IServiceApi = { double(value: number): number }
type IPageApi = { title(): string }
const endpoints = new Map<string, Promise<() => Promise<void>>>()
self.addEventListener('message', (event) => {
  if (!event.source || !('id' in event.source)) return
  const clientId = event.source.id
  if (event.data?.kind === 'close-endpoint') {
    const opening = endpoints.get(clientId)
    endpoints.delete(clientId)
    if (opening) event.waitUntil(opening.then((close) => close()))
    return
  }
  if (event.data?.kind !== 'open-endpoint') return
  event.waitUntil((async () => {
    const client = await self.clients.get(clientId)
    if (!client) return
    if (!endpoints.has(clientId)) {
      const transport = createServiceWorkerTransport({ target: client, receiver: self, peerId: client.id })
      const opening = createEndpoint({ id: 'service-' + client.id, targetIds: ['page-' + client.id], transport, middlewares: [connect({ transport, useBaseIdVerifyOnly: false, identifier: ({ senderId }) => senderId === 'page-' + client.id }), contract({ version: '1.0.0' })] }).then((endpoint) => {
        endpoint.provide('double', async (context) => {
          console.log(await endpoint.send<ReturnType<IPageApi['title']>>('page-' + client.id, 'title', null))
          return context.success((context.data as Parameters<IServiceApi['double']>[0]) * 2)
        })
        return () => endpoint.dispose()
      })
      endpoints.set(clientId, opening)
    }
    await endpoints.get(clientId)
    client.postMessage({ kind: 'endpoint-ready', clientId })
  })())
})`,
  [
    t(
      'Both identifiers bind the expected logical sender after transport sourceProof binds the real ServiceWorker or Client. Native Client.id and logical Endpoint ids are different identities.',
      '两端身份校验在载体来源证明绑定真实服务工作者或客户端后，再核对预期逻辑发送方；原生客户端标识与逻辑端点标识属于不同身份。'
    ),
    t(
      'No Runtime Peer is supported here. Worker idle termination discards this in-memory service; calls can time out and application must reopen it. Bootstrap waitUntil does not keep later RPC work alive indefinitely.',
      '此场景不支持运行对端；工作者空闲终止会丢弃内存服务，调用可能超时，应用须重新打开；初始事件延长生命周期并不能永久保活后续调用。'
    )
  ]
)

/**
 * RTC adapter example deliberately shows raw string protocol instead of inventing a default
 * Endpoint pipeline.
 */
const rtcTransportExample = paired(
  t(
    'rtc-client.ts: application supplies an already-open reliable channel after its own signaling.',
    '数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。'
  ),
  `import { createRtcDataChannelTransport } from '@migaia/rpc-browser/adapters/rtc-data-channel'
type IEchoApi = { echo(input: { text: string }): { text: string } }
type IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }
type IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }
export async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {
  const transport = createRtcDataChannelTransport(channel)
  let resolveReply!: (response: IResponse) => void
  let rejectReply!: (error: unknown) => void
  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })
  const remove = transport.subscribe(({ data }) => {
    try {
      const response = JSON.parse(data as string) as IResponse
      if (response.id === 'echo-1') resolveReply(response)
    } catch (error) { rejectReply(error) }
  })
  const removeError = transport.onTransportError?.(rejectReply)
  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)
  try {
    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)
    console.log((await reply).payload)
  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }
}`,
  t(
    'rtc-service.ts: run before runClient on the matching remote channel; owner later invokes the returned cleanup.',
    '数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。'
  ),
  `import { createRtcDataChannelTransport } from '@migaia/rpc-browser/adapters/rtc-data-channel'
type IEchoApi = { echo(input: { text: string }): { text: string } }
type IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }
type IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }
export function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {
  const service: IEchoApi = { echo: (input) => input }
  const transport = createRtcDataChannelTransport(channel)
  const remove = transport.subscribe(({ data }) => {
    const request = JSON.parse(data as string) as IRequest
    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)
  })
  return () => { remove(); channel.close(); connection.close() }
}`,
  [
    t(
      'This is an application JSON protocol over raw transport, not Runtime Peer traffic. Application owns signaling, channel and RTCPeerConnection shutdown. For RPC use the paired createBrowserPeer example; default Endpoint framing is not this string protocol.',
      '此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。'
    )
  ]
)

/**
 * WebTransport has no server SDK here; only concrete raw datagrams and an explicit matching
 * application protocol are shown.
 */
const webTransportExample = paired(
  t(
    'web-client.ts: the application owns its native WebTransport session and request identifier.',
    '网页客户端 web-client.ts：应用拥有原生网页传输会话并签发请求标识。'
  ),
  `import { createWebTransportDatagramTransport } from '@migaia/rpc-browser/adapters/web-transport'
type IEchoApi = { echo(input: { text: string }): { text: string } }
type IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }
type IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }
const session = new WebTransport('https://rpc.example:4433/echo')
await session.ready
const transport = createWebTransportDatagramTransport(session.datagrams)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
let resolveReply!: (response: IResponse) => void
let rejectReply!: (error: unknown) => void
const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })
const remove = transport.subscribe(({ data }) => {
  try {
    const response = JSON.parse(decoder.decode(data)) as IResponse
    if (response.id === 'echo-1') resolveReply(response)
  } catch (error) { rejectReply(error) }
})
const removeError = transport.onTransportError?.(rejectReply)
const timer = setTimeout(() => rejectReply(new Error('Datagram deadline elapsed')), 3000)
try {
  const request: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }
  await transport.send(encoder.encode(JSON.stringify(request)))
  console.log((await reply).payload)
} finally {
  clearTimeout(timer); remove(); removeError?.()
  try { await transport.close?.() } finally { session.close() }
}`,
  t(
    'External server protocol: no server library is provided; implement these exact datagram constraints in the actual server.',
    '外部服务端协议：本库不提供服务端库，须在实际服务端实现下列精确数据报约束。'
  ),
  `type IEchoApi = { echo(input: { text: string }): { text: string } }
type IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }
type IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }
const received: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }
const reply: IResponse = { id: received.id, payload: { text: received.payload.text } }`,
  [
    t(
      'Server must accept WebTransport at the configured HTTPS URL and exchange one complete UTF-8 JSON object per datagram. Echo the request id and echo payload; both messages must fit the path MTU. Datagram loss/reordering is possible, and this client does not retry business operations.',
      '服务端须在配置的安全网址接纳网页传输，每个数据报承载一个完整通用文本编码对象；原样返回请求标识及回显载荷，两类消息均须适合路径最大传输单元；可能丢失乱序，此客户端不重试业务操作。'
    ),
    t(
      'No createBrowserPeer source or ready-made Core Endpoint combination is provided for datagrams. A byte codec alone is insufficient: default framing reports unknown output and native binary framing can emit fragment objects, which this carrier rejects. These objects are the application protocol, not Core envelopes or Runtime handshake frames.',
      '数据报不提供运行对端来源或现成核心端点组合；仅字节编解码不足，默认分帧报告未知输出，原生二进制分帧可能输出此载体拒绝的分片对象；这里的对象是应用协议，不是核心信封或运行握手帧。'
    )
  ]
)

/**
 * Root and factory introduction includes all three supported Peer source families and popup
 * ownership.
 */
const peerExample: ICode = {
  en: [iframePeerExample, popupPeerExample, sharedPeerExample, rtcPeerExample]
    .map((example) => example.en)
    .join('\n\n'),
  zh: [iframePeerExample, popupPeerExample, sharedPeerExample, rtcPeerExample]
    .map((example) => example.zh)
    .join('\n\n')
}

/** Enhancer doc for one transport factory. */
const transportEnhancer = (
  summary: IText,
  install: ICode,
  behaviors: readonly IText[],
  scenarios: readonly IText[],
  target = 'Endpoint'
): IEnhancerDoc => ({
  kind: 'transport',
  target,
  summary,
  install,
  grants: [],
  behaviors,
  scenarios,
  example: install
})

/** Behaviour shared by every transport: observation through `observe(probe)`. */
const observeBehavior = t(
  '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
  '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
)

/** Canonical RTC carrier methods shared by the low-level transport and Runtime Peer source. */
const rtcChannelMembers: Readonly<Record<string, IMemberDoc>> = {
  send: {
    summary: t('Sends one message as a JSON string.', '把一条消息作为 JSON 字符串发送出去。'),
    params: { data: t('The encoded message.', '编码后的消息文本。') },
    returns: t('Nothing; the message is queued.', '无返回值；消息已进入发送队列。'),
    example: rtcTransportExample
  },
  readyState: {
    summary: t(
      'Must be `open` or `closed` when the transport is created.',
      '创建 transport 时频道状态必须为 `open` 或 `closed`。'
    )
  },
  ...listenerPair(
    'message / closing / close / error',
    t('the channel', '数据频道'),
    rtcTransportExample
  )
}

/** The application supplies the endpoint assembly while Browser retains channel ownership. */
const endpointFactoryOptionExample = `import { createBrowserPeer } from '@migaia/rpc-browser'

const prices = await createBrowserPeer({
  connect: { sharedWorker: priceWorker },
  self: { name: 'price-page', instanceId: 'instrumented-prices' },
  endpointFactory: (channel, signal) => openInstrumentedEndpoint(channel, signal)
})
renderPrices(await prices.request('prices'))`

/** Notification failures go to the application's monitoring service. */
const reportOptionExample = `import { createBrowserPeer } from '@migaia/rpc-browser'

const service = await createBrowserPeer({
  listen: workerScope,
  provide: { refreshPrices: () => refreshPrices() },
  report: (error) => reportToMonitoring(error)
})`

/** Inherited proxy options stay visible without suggesting retries for direct Peer calls. */
const proxyHooksExample = `import { createBrowserPeer } from '@migaia/rpc-browser'

const billing = await createBrowserPeer({
  connect: { sharedWorker: billingWorker },
  keyFactory: () => crypto.randomUUID(),
  retryPort: proxyRetryPort
})
const receipt = await billing.request('billing.checkout.submit', cart, {
  idempotencyKey: checkoutId
})
renderReceipt(receipt)`

/** Options of the Peer factory; callbacks retain their own behavior examples. */
const browserPeerOptions: Readonly<Record<string, IMemberDoc>> = {
  ...runtimePeerOptionMembers,
  endpointFactory: {
    ...runtimePeerOptionMembers.endpointFactory!,
    whenToUse: t(
      'Use this advanced hook only when the application assembles an endpoint for the acquired channel. Omitting it keeps Core assembly. A thrown error or rejected Promise stops opening and releases the acquired setup.',
      '仅当应用需要为已取得的通道组装端点时，使用这个高级回调。省略时由 Core 组装。同步抛错或 Promise 拒绝会停止打开并释放准备阶段取得的资源。'
    ),
    example: endpointFactoryOptionExample
  },
  report: {
    ...runtimePeerOptionMembers.report!,
    whenToUse: t(
      'Set a reporter when notifications or listener work can fail without a waiting caller. It receives those failures without changing ordinary request results. Omitting it uses the default console reporter.',
      '通知或监听工作可能失败、却没有等待结果的调用方时，设置报告回调。它接收这些失败，不改变普通请求的结果。省略时使用默认控制台报告函数。'
    ),
    example: reportOptionExample
  },
  keyFactory: {
    ...runtimePeerOptionMembers.keyFactory!,
    whenToUse: t(
      'This inherited hook belongs to advanced remote-proxy retry paths. Direct Browser Peer requests do not call it or generate an idempotency key from it. Omission leaves those direct calls unchanged; use explicit call options when a direct request needs a key.',
      '这个继承选项用于高级远程代理的重试路径。直接 Browser Peer 请求不会调用它，也不会用它生成幂等键。省略不影响直接请求；直接请求需要键时，应显式传入调用选项。'
    ),
    example: proxyHooksExample
  },
  retryPort: {
    ...runtimePeerOptionMembers.retryPort!,
    example: proxyHooksExample
  },
  self: {
    ...runtimePeerOptionMembers.self!,
    default: t(
      '`{ name: "browser", instanceId: generated }` when omitted.',
      '省略时使用 `{ name: "browser", instanceId: 自动生成的标识 }`。'
    )
  },
  provide: {
    ...runtimePeerOptionMembers.provide!,
    summary: t(
      'Local method record. The request example provides double(value: number), returning its doubled number; the stream example provides async *values(start: number), yielding start and start + 1. Remote typing selects request for scalar methods and stream for generators; no context.success wrapper is needed.',
      '本端方法对象：请求示例的 `double(value: number)` 返回两倍数值，流示例的 `async *values(start: number)` 依次产生 `start` 与 `start + 1`。远端类型决定普通结果使用 `request`、生成器使用 `stream`，不需要 `context.success` 包装。'
    )
  },
  defaultTimeoutMs: {
    ...runtimePeerOptionMembers.defaultTimeoutMs!,
    default: t('`30000` ms for request and stream.', '默认 `30000` 毫秒，用于请求与流调用。')
  },
  connect: {
    summary: t(
      'Supply exactly one source: { window, origin, receiver?, allowUnsafeTargetOrigin? }, { sharedWorker }, or { rtcDataChannel }. Select connect or listen, never both.',
      '只选择一种来源：`{ window, origin, receiver?, allowUnsafeTargetOrigin? }`、`{ sharedWorker }` 或 `{ rtcDataChannel }`；`connect` 与 `listen` 必须二选一。'
    ),
    default: t(
      '`undefined`; listen must then be supplied.',
      '默认 `undefined`，此时必须提供 `listen`。'
    )
  },
  'connect.window': {
    summary: t(
      'The actual destination Window with postMessage.',
      '实际目标 Window，须提供原生 `postMessage`。'
    )
  },
  'connect.origin': {
    summary: t(
      'Required nonempty destination origin for a Window source; no same-origin default.',
      'Window 来源必填的非空目标源，没有同源默认值。'
    )
  },
  'connect.receiver': {
    summary: t(
      'The actual owner of inbound message events for the Window source.',
      'Window 来源中实际接收 `message` 事件的对象。'
    ),
    default: t('The global event receiver when available.', '默认使用可接收事件的全局对象。')
  },
  'connect.allowUnsafeTargetOrigin': {
    summary: t(
      'Explicit wildcard escape; source Window identity is still checked.',
      '显式允许通配目标源，接收时仍核对来源窗口身份。'
    ),
    default: t(
      '`undefined`; omission rejects a wildcard origin.',
      '默认 `undefined`，省略时拒绝通配目标源。'
    ),
    values: {
      true: t(
        'Allow origin "*" while retaining the source identity check.',
        '允许 `origin: "*"`，仍检查来源身份。'
      ),
      false: t('Require a concrete destination origin.', '要求具体的目标源。')
    }
  },
  'connect.sharedWorker': {
    summary: t(
      'A caller-owned SharedWorker or the public { port } configuration.',
      '调用方拥有的 SharedWorker，或公开的 `{ port }` 配置对象。'
    )
  },
  'connect.sharedWorker.port': {
    summary: t(
      'The actual ISharedWorkerPort: postMessage, addEventListener and removeEventListener are required; start is optional. Native Node MessagePort supplies these operations in the runnable examples.',
      '真实的 `ISharedWorkerPort`：必须有 `postMessage`、`addEventListener`、`removeEventListener`，`start` 可选；运行示例直接使用提供这些完整操作的 Node 原生 MessagePort。'
    )
  },
  'connect.rtcDataChannel': {
    summary: t(
      'An application-established native RTC channel with ordered: true, maxRetransmits: null and maxPacketLifeTime: null; finish signaling and wait for open before connecting.',
      '应用完成信令并等到打开的原生 RTC 频道，须为 `ordered: true`、`maxRetransmits: null`、`maxPacketLifeTime: null`。'
    )
  },
  listen: {
    summary: t(
      'A real SharedWorker connect-event scope, accepting every actual event port independently; it is not exercised by the Node port examples.',
      '真实 SharedWorker 的 `connect` 事件作用域，分别接纳每个事件中的实际端口；Node 端口示例不验证此宿主。'
    ),
    default: t(
      '`undefined`; connect must then be supplied.',
      '默认 `undefined`，此时必须提供 `connect`。'
    )
  },
  signal: {
    summary: t(
      'Caller AbortSignal for unfinished connection setup; in listen mode cancellation also closes accepted logical peers without closing borrowed carriers.',
      '调用方用于取消未完成连接的 AbortSignal；监听模式下还会关闭已接纳逻辑连接，借用载体不关闭。'
    ),
    default: t(
      '`undefined`; no caller cancellation signal.',
      '默认 `undefined`，没有调用方取消信号。'
    )
  }
}

/** Reader scenarios use application-owned browser objects rather than transport fixtures. */
const browserPeerOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t('Let the editor worker ask for the current document', '让编辑器工作线程读取当前文档'),
    problem: t(
      'A shared editor worker needs the active document from each page. Without a local method it cannot ask the page for that document. Publish the method and give each tab a distinct diagnostic identity so support can locate the tab involved.',
      '共享编辑器工作线程需要向各页面读取当前文档。不提供本端方法时，它无法向页面查询。发布读取方法，并给每个标签页不同的诊断身份，方便排查问题时定位相关页面。'
    ),
    example: `import { createBrowserPeer } from '@migaia/rpc-browser'

const editor = await createBrowserPeer({
  connect: { sharedWorker: editorWorker },
  self: { name: 'document-editor', instanceId: tabId },
  provide: { currentDocument: () => readCurrentDocument() }
})
renderPreview(await editor.request('preview'))`,
    result: t(
      'The worker can read the active document and return its preview; diagnostics identify the originating editor tab.',
      '工作线程可以读取当前文档并返回预览，诊断信息能指出发起调用的编辑器标签页。'
    ),
    covers: ['connect', 'self', 'provide']
  },
  {
    title: t('Keep image exports within the worker budget', '让图片导出受工作线程预算约束'),
    problem: t(
      'An image worker cannot run many memory-heavy exports at once. The default quotas allow more work than this application can afford. A lower provider limit rejects excess work, while the page uses a shorter request deadline to keep its export control responsive.',
      '图片工作线程无法同时执行很多占用内存的导出任务，默认配额高于应用可承受的数量。降低提供方上限可拒绝多余任务，页面则设置较短的请求期限，避免导出按钮一直等待。'
    ),
    example: `import { createBrowserPeer } from '@migaia/rpc-browser'

const service = await createBrowserPeer({
  listen: workerScope,
  providerLimits: { maxGlobal: 2, maxPerPeer: 1 },
  provide: { exportImage: (input: IExportInput) => exportImage(input) }
})
const exporter = await createBrowserPeer({
  connect: { sharedWorker: imageWorker },
  defaultTimeoutMs: 5000
})
try {
  showDownload(await exporter.request('exportImage', selection))
} catch (error) {
  showExportError(error)
}`,
    result: t(
      'Each page has at most one accepted export, with two exports across the worker. A slow request returns control to the page after its deadline.',
      '每个页面最多接纳一个导出，整个工作线程最多同时接纳两个。请求过慢时，页面在期限结束后恢复操作。'
    ),
    covers: ['providerLimits', 'defaultTimeoutMs']
  },
  {
    title: t('Declare a checkout method that accepts a replay key', '声明支持重放键的结账方法'),
    problem: t(
      'A checkout page may send the same operation again after a lost reply. Its worker needs an explicit method contract before it can use the key to recognize the repeated operation. Without the declaration, a supplied key does not establish that replay policy.',
      '结账页面在回复丢失后可能再次发送同一次操作。工作线程需要显式方法契约，才能用键识别重复操作；只在调用时提供键，不能代替该重放策略声明。'
    ),
    example: `import { createBrowserPeer } from '@migaia/rpc-browser'

const service = await createBrowserPeer({
  listen: workerScope,
  contract: {
    schemaVersion: 1,
    plugin: 'billing',
    features: {
      checkout: { methods: { submit: { mode: 'request', idempotent: true } } }
    }
  },
  provide: { billing: { checkout: { submit: (cart: ICart) => submitOrder(cart) } } }
})`,
    result: t(
      'The worker publishes checkout.submit with a declared request mode and keyed replay policy for callers retrying the same checkout.',
      '工作线程以请求模式发布结账方法，并为重试同一次结账的调用方声明按键重放策略。'
    ),
    covers: ['contract']
  },
  {
    title: t('Show RPC activity in a support panel', '在支持面板显示 RPC 活动'),
    problem: t(
      'Support staff need to see which preview call is taking time without collecting document contents. With no probe the panel receives no events. A message-stage probe sends method metadata to the panel while the preview still renders normally.',
      '支持人员需要知道哪个预览调用耗时，却不应收集文档内容。不设置探针时面板收不到事件；消息阶段探针把方法元数据交给面板，预览仍按正常路径显示。'
    ),
    example: `import { createBrowserPeer } from '@migaia/rpc-browser'
import { defineProbe } from '@migaia/rpc-core/probe'

const editor = await createBrowserPeer({
  connect: { sharedWorker: editorWorker },
  probe: defineProbe({
    stages: ['message'],
    emit: (view) => showRpcActivity(view.method)
  })
})
renderPreview(await editor.request('preview'))`,
    result: t(
      'The preview appears in the editor and its method activity appears in the support panel without reading the document payload.',
      '编辑器显示预览，支持面板显示方法活动，无需读取文档载荷。'
    ),
    covers: ['probe']
  },
  {
    title: t('Stop a shared service when its owner shuts down', '所属服务关闭时停止接纳页面'),
    problem: t(
      'An application starts a SharedWorker listener as part of a larger service. Closing that service must also stop new page connections. Pass its abort signal so the listener and its accepted logical peers end together; native page ports remain caller-owned.',
      '应用把 SharedWorker 监听作为较大服务的一部分启动。服务关闭后不应继续接纳页面；传入所属服务的中止信号，监听与已接纳的逻辑连接便会一起结束，原生页面端口仍由调用方拥有。'
    ),
    example: `import { createBrowserPeer } from '@migaia/rpc-browser'

const service = await createBrowserPeer({
  listen: workerScope,
  signal: serviceLifetime.signal,
  provide: { prices: () => readPrices() }
})
onServiceShutdown(async () => {
  serviceLifetime.abort()
  await service.close()
})`,
    result: t(
      'Service shutdown stops accepting pages and releases existing logical sessions, so the retired service handles no further price calls.',
      '所属服务关闭时停止接纳页面并释放现有逻辑会话，退役服务不再处理价格查询。'
    ),
    covers: ['listen', 'signal']
  },
  {
    title: t('Protect frames on a shared billing channel', '保护共享账单通道中的消息'),
    problem: t(
      'A billing deployment already has matching signing and verification functions on both ends. Without authentication, the Peer adds no frame protection. Supply both functions on each side so unsigned or altered frames cannot enter the application endpoint.',
      '账单服务部署已为两端准备匹配的签名与校验函数。不设置认证时，对端不会增加消息保护；两端都提供这两个函数后，未签名或被修改的消息便不能进入应用端点。'
    ),
    example: `import { createBrowserPeer } from '@migaia/rpc-browser'

const billing = await createBrowserPeer({
  connect: { sharedWorker: billingWorker },
  authentication: { sign: signBillingFrame, verify: verifyBillingFrame }
})
renderReceipt(await billing.request('receipt', orderId))`,
    result: t(
      'The receipt is shown through the authenticated channel; both ends use the deployment’s matching frame protection functions.',
      '收据通过认证通道显示，两端使用部署时配好的匹配消息保护函数。'
    ),
    covers: ['authentication']
  }
]

/** Native Node ports exercise the structural carrier boundary without claiming browser realms. */
const nativePortIntro = t(
  'Install @migaia/rpc-browser and its @migaia/rpc-core peer directly. Node 24 supplies the real MessageChannel; its constructor takes no arguments and returns paired port1/port2. These complete native ports satisfy the public port contract. The examples prove port delivery only, not SharedWorker lifecycle, Window origins, RTC signaling, or browser authentication.',
  '直接安装 `@migaia/rpc-browser` 及其 peer 依赖 `@migaia/rpc-core`。Node 24 提供真实 MessageChannel，无参数构造后取得配对的 `port1`、`port2`，它们完整实现公开端口契约。示例只证明端口交付，不证明 SharedWorker 生命周期、窗口来源、RTC 信令或浏览器认证。'
)

/** Reference of `@migaia/rpc-browser`. */
export const rpcBrowserReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Browser Runtime Peers. Start from `createBrowserPeer({ connect | listen, provide })` to call functions between a page and an iframe or popup (`window`), a SharedWorker, or a reliable WebRTC DataChannel. Calls, handshake and errors are the same as in `@migaia/rpc-threads` and `@migaia/rpc-process`.',
        '浏览器端的 Runtime Peer。从 `createBrowserPeer({ connect | listen, provide })` 开始，在页面与 iframe 或弹窗（`window`）、SharedWorker、可靠的 WebRTC DataChannel 之间互相调用函数。调用方式、握手与错误语义与 `@migaia/rpc-threads`、`@migaia/rpc-process` 相同。'
      ),
      example: peerExample
    },
    'adapters/window': {
      summary: t(
        'Use this subpath when wiring an existing page, iframe or popup directly to a Core endpoint. `createWindowMessageTransport()` wraps the target window and a message receiver; pass the result to `createEndpoint()` and its `connect()` middleware so the expected window and origin are checked. Raw subscriptions retain source information without doing that admission check themselves. Choose the root `createBrowserPeer()` when you want the ready-made callable peer instead.',
        '需要把现有页面、内嵌框架或弹窗直接接到核心端点时，使用这个子路径。`createWindowMessageTransport()` 包装目标窗口和消息接收端；将结果同时交给 `createEndpoint()` 及其 `connect()` 中间件，才能核对预期窗口和来源域。直接订阅载体会保留来源信息，但不会自行执行该接纳检查。需要现成的可调用对端时，选择根入口的 `createBrowserPeer()`。'
      ),
      example: windowEndpointExample
    },
    'adapters/shared-worker': {
      summary: t(
        'Use this subpath when an existing SharedWorker port needs to connect to a Core endpoint. `createSharedWorkerTransport()` wraps one port for message sending and subscriptions; pass it to `createEndpoint()` with the matching `connect()` middleware. The port remains borrowed, so its creator must close it after endpoint disposal. The root `createBrowserPeer()` handles the higher-level callable connection when you do not need to assemble an endpoint.',
        '已有共享工作线程端口，需要接到核心端点时，使用这个子路径。`createSharedWorkerTransport()` 将一个端口包装成可发送和订阅消息的载体，交给 `createEndpoint()` 及匹配的 `connect()` 中间件即可接入。端口属于借用资源，端点释放后仍由创建者关闭。不需要自行组装端点时，可用根入口的 `createBrowserPeer()` 创建更高层的可调用连接。'
      ),
      example: sharedEndpointExample
    },
    'adapters/service-worker': {
      summary: t(
        'Use this entry for direct endpoint messaging between a page and its service worker. `createServiceWorkerTransport()` takes the outgoing target and the separate event receiver, and supplies a transport for `createEndpoint()`. Pair it with `connect()` so messages are checked against the expected worker or client identity. The root offers no peer factory for this carrier: the browser can stop the worker, so the application must handle timeouts and reopening.',
        '页面与服务工作线程需要通过端点互发消息时，使用这个入口。`createServiceWorkerTransport()` 分别接收发送目标和事件接收端，生成供 `createEndpoint()` 使用的载体。搭配 `connect()`，才能按预期工作线程或客户端身份核对消息。根入口不为这种载体提供对端工厂，因为浏览器可能停止线程，应用需处理超时并重新打开连接。'
      ),
      example: serviceExample
    },
    'adapters/broadcast-channel': {
      summary: t(
        'Use this entry when same-origin tabs communicate through a named broadcast channel. `createBroadcastChannelTransport()` wraps your channel for `createEndpoint()`, where endpoint IDs select the logical recipient. The channel still broadcasts to its other participants; IDs do not make it a private point-to-point connection. The root has no peer factory for this carrier, and the caller remains responsible for closing the channel.',
        '同源标签页需要通过同名广播频道通信时，使用这个入口。`createBroadcastChannelTransport()` 包装已有频道，交给 `createEndpoint()` 后由端点标识选择逻辑接收方。频道仍向其他参与者广播，端点标识不会把它变成私有的一对一连接。根入口不为这种载体提供对端工厂，频道也仍由调用方关闭。'
      ),
      example: broadcastExample
    },
    'adapters/rtc-data-channel': {
      summary: t(
        'Use this subpath when an application already owns a data channel and needs direct access to its messages. `createRtcDataChannelTransport()` sends strings as-is, converts other outgoing values to text with JSON, and delivers received values without decoding them. The example therefore defines and decodes its own application messages. For typed RPC calls, choose the root `createBrowserPeer()` with a reliable ordered channel; that factory supplies the RPC protocol.',
        '应用已有数据频道，并需要直接收发其中的消息时，使用这个子路径。`createRtcDataChannelTransport()` 原样发送字符串，把其他发送值转换为文本，收到的值则不经解码直接交给订阅者。因此示例自行定义并解码应用消息。需要带类型的远程调用时，应把可靠有序的频道交给根入口的 `createBrowserPeer()`，由该工厂提供调用协议。'
      ),
      example: rtcTransportExample
    },
    'adapters/web-transport': {
      summary: t(
        "Use this entry when an application owns a WebTransport session and exchanges small byte messages with its server. `createWebTransportDatagramTransport()` wraps the session's datagrams and accepts `Uint8Array` values; the application supplies message encoding and the server protocol. Datagrams can be lost or reordered, so the root provides no callable peer for them. Closing the transport closes its acquired writer, while closing the session remains the caller's responsibility.",
        '应用已有网页传输会话，需要与服务器交换小段字节消息时，使用这个入口。`createWebTransportDatagramTransport()` 包装会话的数据报，只接受 `Uint8Array`，消息编码和服务器协议由应用提供。数据报可能丢失或乱序，因此根入口不提供基于它的可调用对端。关闭载体会关闭它取得的写入端，会话本身仍由调用方关闭。'
      ),
      example: webTransportExample
    }
  },
  symbols: {
    createBrowserPeer: {
      role: 'factory',
      purpose: t(
        'Creates a browser Runtime Peer. Connect resolves after the real handshake/directory exchange; listen returns an accept facade, and each incoming SharedWorker port has its own handshake. Supply exactly one supported source and pair both sides with `createBrowserPeer`.',
        '创建浏览器运行对端；主动连接在真实握手及目录交换后完成，监听模式返回接纳表面，每个入站共享工作者端口独立握手；两端分别调用工厂，本端请求须搭配对端 `provide`。'
      ),
      params: {
        options: t(
          'See `IRuntimeBrowserPeerOptions`. Besides `connect` / `listen` / `signal` it accepts the Core Peer options: `provide` (methods this side offers), `defaultTimeoutMs`, `report`, `probe`, `providerLimits`, `authentication`, `contract`, `self`.',
          '见 `IRuntimeBrowserPeerOptions`。除 `connect` / `listen` / `signal` 外，还接受 Core Peer 的选项：`provide`（本端提供的方法）、`defaultTimeoutMs`、`report`、`probe`、`providerLimits`、`authentication`、`contract`、`self`。'
        )
      },
      returns: t(
        'An `IRuntimePeer` from `@migaia/rpc-core`: `request` / `notify` / `stream` / `group` / `outcome` call the other side, `on("ready")` observes reconnection, `describe()` reads the directory, `close()` (or `await using`) ends the logical connection without closing the carrier. Typed by `TRemote` when given.',
        '来自 `@migaia/rpc-core` 的 `IRuntimePeer`：`request` / `notify` / `stream` / `group` / `outcome` 调用对端，`on("ready")` 观察重新就绪，`describe()` 读取方法目录，`close()`（或 `await using`）结束逻辑连接但不关闭载体。提供 `TRemote` 时带有类型。'
      ),
      options: 'IRuntimeBrowserPeerOptions',
      optionDocs: browserPeerOptions,
      exampleIntro: t(
        nativePortIntro.en +
          ' Both connect factories start concurrently. request(method, payload, options?) and stream(method, payload, options?) use the accepted method name and its declared input; omitted call options inherit the 30000 ms request/stream deadline. close() takes no arguments and repeated calls share its Promise. After logical cleanup, Node port.once("message", listener) receives the data once to prove the borrowed port remains open.',
        nativePortIntro.zh +
          '两端连接工厂并发启动。`request(method, payload, options?)` 与 `stream(method, payload, options?)` 使用已接纳的方法名及声明输入；省略调用选项时，请求与流继承 `30000` 毫秒默认期限。`close()` 无参数，重复调用复用其 Promise；逻辑清理后才用 Node 的 `port.once("message", listener)` 接收一次数据，证明借用端口仍打开。'
      ),
      example: rpcBrowserCases.createBrowserPeer![0]!.example,
      cases: rpcBrowserCases.createBrowserPeer,
      scenarios: [
        t(
          'A shop page calls functions inside a payment iframe from another origin.',
          '商城页面调用来自另一个源的支付 iframe 中的函数。'
        ),
        t(
          'One SharedWorker serves the same cache or socket to every open tab.',
          '一个 SharedWorker 为所有打开的标签页提供同一个缓存或 socket。'
        ),
        t(
          'Two browsers call each other over a WebRTC DataChannel.',
          '两个浏览器通过 WebRTC DataChannel 互相调用。'
        )
      ],
      avoid: [
        t(
          'Dedicated Workers created by the library: use `@migaia/rpc-threads`.',
          '需要由库来创建 Dedicated Worker 时：请使用 `@migaia/rpc-threads`。'
        ),
        t(
          'Service Worker and BroadcastChannel use paired Endpoint transports. WebTransport uses raw byte transport with an external application protocol; this package ships no ready-made compatible Endpoint/framer recipe.',
          '服务工作者与广播频道使用双端端点载体；网页传输使用原始字节载体及外部应用协议，本包不提供现成兼容端点分帧配方。'
        )
      ]
    },
    RPC_BROWSER_ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/rpc/browser`) of Peer configuration and decoding errors of this package; compare it before branching on `code`.',
        '本包 Peer 配置错误与解码错误上的 `source` 值（`@migaia/rpc/browser`）；先比对它确认来源，再按 `code` 分支处理。'
      ),
      example: iframePeerExample
    },
    RpcBrowserErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: rtcPeerExample
    },
    createWindowMessageTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a Window postMessage carrier with exact target/origin sourceProof. Raw subscribe preserves all event records; pair it with `connect` for Endpoint admission or use the Browser Peer projection.',
        '创建带精确目标及来源域证明的窗口载体；原始订阅保留全部事件记录，端点须搭配 `connect` 执行准入，或使用浏览器对端投影。'
      ),
      returns: t(
        'An `IRpcTransport` for `createEndpoint()`; `*` as origin without `allowUnsafeTargetOrigin` throws `INVALID_CONFIG`.',
        '供 `createEndpoint()` 使用的 `IRpcTransport`；源为 `*` 且未开启 `allowUnsafeTargetOrigin` 时抛 `INVALID_CONFIG`。'
      ),
      options: 'IWindowMessageTransportOptions',
      example: windowEndpointExample
    },
    createSharedWorkerTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a transport over one SharedWorker `MessagePort` and starts the port when listening begins.',
        '创建基于单个 SharedWorker `MessagePort` 的 transport，并在开始监听消息时启动该端口。'
      ),
      params: {
        port: t(
          'Page side: `sharedWorker.port`; worker side: a port from the `connect` event.',
          '页面端为 `sharedWorker.port`；Worker 端为 `connect` 事件中的端口。'
        )
      },
      returns: t(
        'An `IRpcTransport`; the port is borrowed and must be closed by its owner.',
        '一个 `IRpcTransport`；端口是借用的，需由其持有者关闭。'
      ),
      exampleIntro: t(
        nativePortIntro.en +
          ' createSharedWorkerTransport(port) has no options argument. subscribe(listener) supplies {data, origin?, source?} and returns an idempotent disposer; it uses no business result but observes synchronous and thenable failures. send(message, {transfer}) defaults transfer to undefined; an explicit array transfers those native objects. onListenerError(error => void) reports listener failures, distinct from physical onTransportError. Promise.withResolvers creates a local delivery Promise and does not implement RPC.',
        nativePortIntro.zh +
          '`createSharedWorkerTransport(port)` 没有选项参数。`subscribe(listener)` 提供 `{ data, origin?, source? }` 并返回幂等退订函数；不使用业务返回值，但会观察同步抛错及类 Promise 对象的拒绝。`send(message, { transfer })` 的 `transfer` 默认 `undefined`，显式数组会转移其中原生对象。`onListenerError(error => void)` 接收监听器失败，与物理故障的 `onTransportError` 不同；`Promise.withResolvers` 只创建本地交付 Promise，不实现 RPC。'
      ),
      example: rpcBrowserCases.createSharedWorkerTransport![0]!.example,
      cases: rpcBrowserCases.createSharedWorkerTransport
    },
    createServiceWorkerTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a page/ServiceWorker carrier whose sourceProof accepts its exact target or actual matching Client id. Raw subscribe retains records; pair `connect` with this transport for Endpoint admission.',
        '创建页面服务工作者载体，其来源证明认可精确目标或实际匹配客户端标识；原始订阅保留记录，端点须搭配 `connect` 执行准入。'
      ),
      returns: t(
        'An `IRpcTransport` for `createEndpoint()`.',
        '供 `createEndpoint()` 使用的 `IRpcTransport`。'
      ),
      options: 'IServiceWorkerTransportOptions',
      example: serviceExample
    },
    createBroadcastChannelTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a transport over a `BroadcastChannel`; every same-origin context on the channel receives the messages.',
        '创建基于 `BroadcastChannel` 的 transport；频道上所有同源上下文都会收到消息。'
      ),
      params: {
        channel: t(
          'An open `BroadcastChannel` owned by the caller.',
          '由调用方持有、已打开的 `BroadcastChannel`。'
        )
      },
      returns: t(
        'An `IRpcTransport`; the caller still closes the channel.',
        '一个 `IRpcTransport`；频道仍需调用方自行关闭。'
      ),
      exampleIntro: t(
        'Install @migaia/rpc-browser and @migaia/rpc-core directly. Node 24 supplies native BroadcastChannel(name); name is required, and the examples reuse one randomUUID string across distinct channels to isolate the run. createBroadcastChannelTransport(channel) has no options argument. subscribe receives {data, origin?, source?} and returns a disposer. send(message) uses native structured cloning with no transfer-list support. Channel close() is a separate no-argument operation owned by the caller; once:true removes the final raw native listener after one delivery.',
        '直接安装 `@migaia/rpc-browser` 与 `@migaia/rpc-core`。Node 24 的原生 `BroadcastChannel(name)` 名称必填，示例让不同频道实例复用同一个随机 UUID，隔离本次运行。`createBroadcastChannelTransport(channel)` 没有选项参数；`subscribe` 接收 `{ data, origin?, source? }` 并返回退订函数，`send(message)` 使用原生结构化克隆，不支持转移列表。频道的无参数 `close()` 由调用方负责；`once: true` 让最后的原生监听在收到一条消息后自动移除。'
      ),
      example: rpcBrowserCases.createBroadcastChannelTransport![0]!.example,
      cases: rpcBrowserCases.createBroadcastChannelTransport
    },
    createRtcDataChannelTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a raw RTC carrier in open or already-terminal closed state; non-string sends are JSON-stringified, while received data is not parsed. MESSAGE_DECODE_FAILED belongs to the Browser Peer projection, not this raw transport.',
        '在已打开或已经终止关闭状态创建原始数据频道载体；非字符串发送值被转换为字符串，接收数据不解析；消息解码失败属于浏览器对端投影，不属于此原始载体。'
      ),
      params: {
        channel: t(
          'An `RTCDataChannel` created by the caller, usually from `peerConnection.createDataChannel()`.',
          '由调用方创建的 `RTCDataChannel`，通常来自 `peerConnection.createDataChannel()`。'
        )
      },
      returns: t(
        'An `IRpcTransport`; other channel states throw `INVALID_CONFIG`.',
        '一个 `IRpcTransport`；频道处于其它状态时抛 `INVALID_CONFIG`。'
      ),
      example: rtcTransportExample
    },
    createWebTransportDatagramTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a byte transport over WebTransport datagrams; it takes the datagram writer and reader and closes the writer when the transport closes.',
        '创建基于 WebTransport 数据报的字节 transport；它取得数据报的写入端与读取端，并在 transport 关闭时关闭写入端。'
      ),
      params: {
        datagrams: t(
          '`session.datagrams` of a `WebTransport` session created by the caller.',
          '调用方创建的 `WebTransport` 会话的 `session.datagrams`。'
        )
      },
      returns: t(
        'An `IRpcTransport<Uint8Array>`; the session itself is closed by the caller.',
        '一个 `IRpcTransport<Uint8Array>`；会话本身仍由调用方关闭。'
      ),
      example: webTransportExample
    }
  },
  types: {
    IRuntimeBrowserPeerOptions: {
      optionCases: browserPeerOptionCases,
      example: peerExample,
      summary: t(
        'Options of `createBrowserPeer()`: the browser source plus the Core Peer options.',
        '`createBrowserPeer()` 的选项：浏览器载体来源，以及 Core Peer 的通用选项。'
      ),
      members: {
        ...runtimePeerOptionMembers,
        endpointFactory: browserPeerOptions.endpointFactory!,
        report: browserPeerOptions.report!,
        keyFactory: browserPeerOptions.keyFactory!,
        retryPort: browserPeerOptions.retryPort!,
        self: browserPeerOptions.self!,
        provide: browserPeerOptions.provide!,
        defaultTimeoutMs: browserPeerOptions.defaultTimeoutMs!,
        connect: {
          summary: t(
            'Carrier to connect over: `{ window, origin }`, `{ sharedWorker }` or `{ rtcDataChannel }`.',
            '本端主动连接所用的载体：`{ window, origin }`、`{ sharedWorker }` 或 `{ rtcDataChannel }`。'
          ),
          default: t('Not set: then `listen` is required.', '不设置：此时必须提供 `listen`。')
        },
        listen: {
          summary: t(
            'SharedWorker global scope (`self`) that accepts one Peer per actual port in each `connect` event; binding the same scope twice throws `LISTENER_ALREADY_BOUND`.',
            '为每个 `connect` 事件中的实际端口分别接纳一个 Peer 的 SharedWorker 全局作用域（`self`）；重复绑定同一作用域抛 `LISTENER_ALREADY_BOUND`。'
          ),
          default: t('Not set: then `connect` is required.', '不设置：此时必须提供 `connect`。')
        },
        signal: {
          summary: t(
            'Cancels unfinished connection work; in listen mode it also closes the listener and its accepted logical peers. Borrowed native carriers stay application-owned.',
            '取消未完成连接工作；监听模式还会关闭监听者及其已接纳逻辑对端，借用原生载体仍由应用拥有。'
          ),
          default: t(
            'Absent: no caller cancellation signal; existing Core deadlines still apply.',
            '默认没有调用方取消信号，既有核心截止仍适用。'
          )
        }
      }
    },
    IRuntimeBrowserConnect: {
      example: peerExample,
      summary: t(
        'Union of the three connect sources: window, SharedWorker, RTC channel.',
        '三种连接来源的联合类型：窗口、SharedWorker、RTC 频道。'
      ),
      members: {}
    },
    IRuntimeBrowserWindowConnect: {
      example: iframePeerExample,
      summary: t(
        '`connect` source for an iframe or popup window.',
        '用于 iframe 或弹窗窗口的 `connect` 来源。'
      ),
      members: {
        window: {
          summary: t(
            'The other window, such as `iframe.contentWindow` or `window.parent`.',
            '要通信的对端窗口，例如 `iframe.contentWindow` 或 `window.parent`。'
          )
        },
        origin: {
          summary: t(
            'Exact origin of the other window, required (no same-origin default); missing throws `WINDOW_ORIGIN_REQUIRED`.',
            '对端窗口的准确源，必填（没有同源默认值）；缺失时抛 `WINDOW_ORIGIN_REQUIRED`。'
          )
        },
        receiver: {
          summary: t(
            'Object that receives `message` events.',
            '负责接收对端 `message` 事件的对象。'
          ),
          default: t('The current global `window`.', '当前的全局 `window` 对象。')
        },
        allowUnsafeTargetOrigin: {
          summary: t(
            'Allows `origin: "*"`; the source window is still checked on receive.',
            '允许 `origin: "*"`；接收时仍会校验来源窗口。'
          ),
          default: t('`undefined`: omitted disables `*`.', '默认 `undefined`，省略时拒绝使用 `*`。')
        }
      }
    },
    IRuntimeBrowserSharedWorkerConnect: {
      example: sharedPeerExample,
      summary: t(
        '`connect` source for a SharedWorker created by the page.',
        '用于页面所创建 SharedWorker 的 `connect` 来源。'
      ),
      members: {
        sharedWorker: {
          summary: t(
            'The `SharedWorker` (any object with `port`); the page keeps owning it.',
            '`SharedWorker` 对象（任何带 `port` 的对象）；仍由页面持有。'
          )
        }
      }
    },
    IRuntimeBrowserRtcConnect: {
      example: rtcPeerExample,
      summary: t(
        '`connect` source for an open WebRTC DataChannel.',
        '用于已打开 WebRTC DataChannel 的 `connect` 连接来源。'
      ),
      members: {
        rtcDataChannel: {
          summary: t(
            'The channel; it must be ordered and reliable (no `maxRetransmits` / `maxPacketLifeTime`), otherwise `RTC_CHANNEL_UNRELIABLE`.',
            '数据频道；必须有序且可靠（不设置 `maxRetransmits` / `maxPacketLifeTime`），否则抛 `RTC_CHANNEL_UNRELIABLE`。'
          )
        }
      }
    },
    IRuntimeBrowserRtcDataChannel: {
      example: rtcPeerExample,
      summary: t(
        'The RTC channel settings a Peer checks before connecting.',
        'Peer 在连接前检查的 RTC 频道设置。'
      ),
      members: {
        ...rtcChannelMembers,
        ordered: {
          summary: t(
            'Must be `true`: messages arrive in order.',
            '必须为 `true`，即消息按发送顺序到达。'
          )
        },
        maxRetransmits: {
          summary: t('Must be `null` (unlimited retransmits).', '必须为 `null`（不限制重传次数）。')
        },
        maxPacketLifeTime: {
          summary: t('Must be `null` (no lifetime limit).', '必须为 `null`（不限制消息存活时间）。')
        }
      }
    },
    IRuntimeBrowserListen: {
      example: sharedPeerExample,
      summary: t(
        'SharedWorker scope accepted by `listen`.',
        '`listen` 选项接受的 SharedWorker 全局作用域。'
      ),
      members: listenerPair(
        'connect',
        t('the SharedWorker scope', 'SharedWorker 作用域'),
        sharedPeerExample
      )
    },
    IRuntimeBrowserConnectEvent: {
      example: sharedPeerExample,
      summary: t(
        '`connect` event of a SharedWorker scope.',
        'SharedWorker 作用域上触发的 `connect` 连接事件。'
      ),
      members: {
        ports: {
          summary: t(
            'Actual native ports from this connect event; the listener accepts each port independently.',
            '本次原生连接事件提供的实际端口，监听者分别接纳每个端口。'
          )
        }
      }
    },
    IRpcBrowserErrorCode: {
      summary: t(
        'Union of `RpcBrowserErrorCode` values.',
        '`RpcBrowserErrorCode` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IWindowMessageTransportOptions: {
      optionCases: [
        {
          title: t('Address a known popup origin', '向已知来源域的弹窗发送消息'),
          problem: t(
            'The application already owns a popup and its inbound `window` receiver. Supplying the target and origin makes outgoing delivery explicit; outside a Window-like global, the receiver cannot be inferred. Raw subscriptions preserve source metadata, while endpoint admission uses `sourceProof`.',
            '应用已持有弹窗及接收消息的 `window`。显式指定目标与来源域，就能确定消息发往何处；不在类 Window 全局环境中时，接收者也必须提供。原始订阅保留来源元数据，端点接纳则使用 `sourceProof`。'
          ),
          example: `import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const transport = createWindowMessageTransport({
  target: popupWindow,
  receiver: window,
  targetOrigin: 'https://reports.example'
})
const stop = transport.subscribe((message) => {
  if (transport.sourceProof?.(message.source, message.origin)) renderReport(message.data)
})
refreshButton.onclick = () => transport.send({ operation: 'refresh' })
onReportClosed(stop)`,
          result: t(
            'Clicking refresh sends the report request only to the configured origin; incoming report data updates the report view.',
            '点击刷新时，报告请求只发往指定来源域；收到的报告数据用于更新视图。'
          ),
          covers: ['target', 'receiver', 'targetOrigin']
        },
        {
          title: t(
            'Explicitly allow an unknown destination origin',
            '显式允许尚未确定的目标来源域'
          ),
          problem: t(
            'A caller-owned window can change origin while retaining its native identity. A wildcard is rejected by default. `allowUnsafeTargetOrigin: true` permits that wildcard and relaxes only the origin check; another window still fails the source check.',
            '调用方拥有的窗口可能改变来源域，但保持原生窗口身份。默认会拒绝通配来源域。`allowUnsafeTargetOrigin: true` 允许通配符，只放宽来源域检查；其他窗口仍无法通过来源身份检查。'
          ),
          example: `import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const transport = createWindowMessageTransport({
  target: popupWindow,
  receiver: window,
  targetOrigin: '*',
  allowUnsafeTargetOrigin: true
})
refreshButton.onclick = () => transport.send({ operation: 'refresh' })
`,
          result: t(
            'The refresh request follows the retained popup across origin changes. Source proof still identifies that popup; raw subscriptions require their own admission check.',
            '刷新请求可跟随保留的弹窗跨越来源域变化。来源证明仍识别该弹窗；原始订阅仍须自行检查准入。'
          ),
          covers: ['target', 'receiver', 'targetOrigin', 'allowUnsafeTargetOrigin']
        }
      ],
      example: windowEndpointExample,
      summary: t(
        'Options of `createWindowMessageTransport()`.',
        '`createWindowMessageTransport()` 的选项：目标窗口、接收者与源。'
      ),
      members: {
        target: {
          summary: t(
            'Outbound window and the expected source used by `sourceProof`; raw subscriptions still receive every record.',
            '消息发往的窗口，也是来源证明所期望的来源；原始订阅仍接收全部消息记录。'
          )
        },
        receiver: {
          summary: t(
            'Object that receives `message` events.',
            '负责接收对端 `message` 事件的对象。'
          ),
          default: t(
            'The global scope when it has `addEventListener`.',
            '全局作用域（具有 `addEventListener` 时）。'
          )
        },
        targetOrigin: {
          summary: t(
            'Outbound origin and receive proof checked by Endpoint `connect` or the Peer projection.',
            '发送时使用的源；接收准入由端点 `connect` 或运行对端投影按它检查。'
          ),
          default: t(
            '`window.location.origin` when available (same origin).',
            '可用时为 `window.location.origin`（同源）。'
          )
        },
        allowUnsafeTargetOrigin: {
          summary: t(
            'Allows `targetOrigin: "*"`; the source window is still checked.',
            '允许 `targetOrigin: "*"`；仍会校验来源窗口。'
          ),
          default: t('`undefined`: omitted disables `*`.', '默认 `undefined`，省略时拒绝使用 `*`。')
        }
      }
    },
    IWindowMessageTarget: {
      example: windowEndpointExample,
      summary: t('Window-like object messages are posted to.', '接收发送消息的类窗口对象。'),
      members: {
        postMessage: {
          summary: t('Posts a message with a target origin.', '以指定目标源发送一条消息。'),
          params: {
            message: t('The encoded RPC message.', '编码后的 RPC 消息。'),
            targetOrigin: t(
              '`targetOrigin` / `origin` from the options.',
              '选项中的 `targetOrigin` / `origin`。'
            ),
            transfer: t(
              'Transferable objects of this message.',
              '本条消息要转移所有权的可转移对象。'
            )
          },
          returns: t('Nothing; the message is posted.', '无返回值；消息已发出。'),
          example: windowEndpointExample
        }
      }
    },
    IWindowMessageReceiver: {
      example: windowEndpointExample,
      summary: t(
        'Object whose `message` events are read.',
        'transport 从中读取 `message` 事件的接收对象。'
      ),
      members: listenerPair(
        'message',
        t('the receiving window', '接收消息的窗口'),
        windowEndpointExample
      )
    },
    ISharedWorkerPort: {
      example: sharedEndpointExample,
      summary: t(
        'The `MessagePort` of a SharedWorker connection.',
        'SharedWorker 连接所使用的消息端口 `MessagePort`。'
      ),
      members: {
        postMessage: {
          summary: t('Posts a message to the other side.', '通过端口向对端发送一条消息。'),
          params: {
            message: t('The encoded RPC message.', '编码后的 RPC 消息。'),
            transfer: t('Transferable objects.', '要转移所有权的可转移对象。')
          },
          returns: t('Nothing; the message is posted.', '无返回值；消息已发出。'),
          example: sharedEndpointExample
        },
        start: {
          summary: t(
            'Optional; called when listening begins so queued messages are delivered.',
            '可选；开始监听时调用，使排队的消息得以交付。'
          ),
          returns: t('Nothing; the port delivers messages.', '无返回值；端口开始交付消息。'),
          example: sharedEndpointExample
        },
        ...listenerPair('message / messageerror', t('the port', '端口'), sharedEndpointExample)
      }
    },
    IServiceWorkerTransportOptions: {
      optionCases: [
        {
          title: t('Send to the controlling worker', '向当前控制页面的工作线程发送消息'),
          problem: t(
            'The application already has a ServiceWorker target and its `navigator.serviceWorker` receiver. Neither is created by this adapter. Pass both to separate outgoing delivery from incoming events; omitting either does not discover or register a worker.',
            '应用已有 ServiceWorker 目标及 `navigator.serviceWorker` 接收端。适配器不会创建它们。分别传入发送目标与事件接收端；省略字段不会自动查找或注册工作线程。'
          ),
          example: `import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

const transport = createServiceWorkerTransport({
  target: serviceWorker,
  receiver: navigator.serviceWorker
})
const stop = transport.subscribe((message) => {
  if (transport.sourceProof?.(message.source)) showCacheStatus(message.data)
})
refreshButton.onclick = () => transport.send({ operation: 'refresh-cache' })
onPageClosed(stop)`,
          result: t(
            'Clicking refresh asks the controlling worker to update its cache; incoming status messages update the page’s cache indicator.',
            '点击刷新会请求控制页面的工作线程更新缓存，收到的状态消息用于更新页面缓存提示。'
          ),
          covers: ['target', 'receiver']
        },
        {
          title: t(
            'Recognize the same client through another wrapper',
            '通过不同包装识别同一个客户端'
          ),
          problem: t(
            'A worker receives a wrapper for an already known Client. `peerId` identifies that client when object identity differs. Omission uses `target.id` when available; an explicit id selects the expected Client id rather than accepting every source.',
            '工作线程可能收到已知 Client 的另一个包装对象。对象身份不同时，`peerId` 用于识别这个客户端。省略时可使用 `target.id`；显式标识只接纳指定 Client，不会放行所有来源。'
          ),
          example: `import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

const transport = createServiceWorkerTransport({
  target: client,
  receiver: workerScope,
  peerId: client.id
})
const stop = transport.subscribe((message) => {
  if (transport.sourceProof?.(message.source)) handleEditorMessage(message.data)
})
transport.send({ operation: 'cache-updated' })
onClientDisconnected(stop)`,
          result: t(
            'The worker accepts messages for the selected Client id and sends cache updates to that client, even when inbound events use another wrapper.',
            '即使接收事件使用另一个包装对象，工作线程仍按所选 Client id 接纳消息，并向该客户端发送缓存更新。'
          ),
          covers: ['target', 'receiver', 'peerId']
        }
      ],
      example: serviceExample,
      summary: t(
        'Options of `createServiceWorkerTransport()`.',
        '`createServiceWorkerTransport()` 的选项：目标、接收者与对端 id。'
      ),
      members: {
        target: {
          summary: t(
            'ServiceWorker or Client that receives outgoing messages.',
            '接收本端发出消息的 ServiceWorker 或 Client 对象。'
          )
        },
        receiver: {
          summary: t(
            'Owner of `message` events: `navigator.serviceWorker` in a page, `self` in the worker.',
            '`message` 事件的所有者：页面中为 `navigator.serviceWorker`，Worker 中为 `self`。'
          )
        },
        peerId: {
          summary: t(
            'Id of the expected remote Client, taken from `client.id` in the worker.',
            '预期的远端 Client 的 id，在 Worker 中取自 `client.id`。'
          ),
          default: t('`target.id` when available.', '可用时为 `target.id`。')
        }
      }
    },
    IServiceWorkerMessageTarget: {
      example: serviceExample,
      summary: t(
        'ServiceWorker or Client messages are posted to.',
        '接收本端发送消息的 ServiceWorker 或 Client 对象。'
      ),
      members: {
        postMessage: {
          summary: t(
            'Posts one message to the ServiceWorker or Client.',
            '向目标 ServiceWorker 或 Client 发送一条编码后的 RPC 消息。'
          ),
          params: {
            message: t('The encoded RPC message.', '编码后的 RPC 消息。'),
            transfer: t('Transferable objects.', '要转移所有权的可转移对象。')
          },
          returns: t('Nothing; the message is posted.', '无返回值；消息已发出。'),
          example: serviceExample
        },
        id: {
          summary: t(
            'Client id, generated by the browser; used to accept replies.',
            '由浏览器生成的 Client id；用于接受回复。'
          )
        }
      }
    },
    IServiceWorkerMessageReceiver: {
      example: serviceExample,
      summary: t(
        'Owner of Service Worker `message` events.',
        'Service Worker 场景中负责派发 `message` 事件的对象。'
      ),
      members: listenerPair(
        'message',
        t('the Service Worker container', 'Service Worker 容器'),
        serviceExample
      )
    },
    IRTCDataChannel: {
      example: rtcTransportExample,
      summary: t(
        'The parts of `RTCDataChannel` the transport uses.',
        'transport 实际使用的那部分 `RTCDataChannel` 能力。'
      ),
      members: rtcChannelMembers
    },
    IWebTransportDatagrams: {
      example: webTransportExample,
      summary: t(
        '`session.datagrams` of a WebTransport session.',
        'WebTransport 会话上的 `session.datagrams` 数据报读写流对象。'
      ),
      members: {
        writable: {
          summary: t(
            'Datagram writer; the transport locks and later closes it.',
            '数据报写入流；transport 会锁定它并在关闭时关闭。'
          )
        },
        readable: {
          summary: t(
            'Datagram reader; the transport reads it until closed.',
            '数据报读取流；transport 会一直读取到关闭。'
          )
        }
      }
    }
  },
  enums: {
    RpcBrowserErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/rpc-browser`.',
        '`@migaia/rpc-browser` 的稳定错误码及其触发场景。'
      ),
      values: {
        windowOriginRequired: t(
          '`WINDOW_ORIGIN_REQUIRED`: a window Peer needs a non-empty `origin`.',
          '`WINDOW_ORIGIN_REQUIRED`：创建窗口 Peer 时必须提供非空的 `origin`。'
        ),
        rtcChannelUnreliable: t(
          '`RTC_CHANNEL_UNRELIABLE`: the RTC channel is unordered or has retransmit limits.',
          '`RTC_CHANNEL_UNRELIABLE`：RTC 频道无序或设置了重传限制。'
        ),
        listenerAlreadyBound: t(
          '`LISTENER_ALREADY_BOUND`: the SharedWorker scope already has a listener; close it first.',
          '`LISTENER_ALREADY_BOUND`：该 SharedWorker 作用域已有监听器；需先关闭它。'
        ),
        invalidPeerSource: t(
          '`INVALID_PEER_SOURCE`: give exactly one supported `connect` or `listen`.',
          '`INVALID_PEER_SOURCE`：必须且只能提供一个受支持的 `connect` 或 `listen`。'
        ),
        messageDecodeFailed: t(
          '`MESSAGE_DECODE_FAILED`: an RTC message is not valid JSON; see `cause`.',
          '`MESSAGE_DECODE_FAILED`：收到的 RTC 消息不是合法的 JSON；原因见 `cause`。'
        )
      }
    }
  },
  enhancers: {
    createWindowMessageTransport: transportEnhancer(
      t(
        'After installation the Endpoint exchanges messages with one window over `postMessage`, accepting only that window and origin.',
        '安装后 Endpoint 通过 `postMessage` 与某个窗口交换消息，只接受该窗口与该源的消息。'
      ),
      windowEndpointExample,
      [
        observeBehavior,
        t(
          '`endpoint.dispose()` removes the `message` listener; the window is not closed.',
          '`endpoint.dispose()` 会移除 `message` 监听；窗口不会被关闭。'
        )
      ],
      [
        t(
          'An Endpoint with custom middlewares between a page and an iframe.',
          '在页面与 iframe 之间使用带自定义中间件的 Endpoint。'
        )
      ]
    ),
    createSharedWorkerTransport: transportEnhancer(
      t(
        'After installation the Endpoint talks over one SharedWorker port.',
        '安装后 Endpoint 通过一个 SharedWorker 端口与对面的 Worker 或页面互相发送调用。'
      ),
      sharedEndpointExample,
      [
        observeBehavior,
        t(
          'The port is started when listening begins and is never closed by the transport.',
          '开始监听时启动端口，transport 不会关闭端口。'
        )
      ],
      [
        t(
          'A custom Endpoint per tab connected to one SharedWorker.',
          '每个标签页使用自定义 Endpoint 连接同一个 SharedWorker。'
        )
      ]
    ),
    createServiceWorkerTransport: transportEnhancer(
      t(
        'After installation the Endpoint talks between a page and its Service Worker.',
        '安装后 Endpoint 可以在页面与其注册的 Service Worker 之间互相发送调用。'
      ),
      serviceExample,
      [
        observeBehavior,
        t(
          'Endpoint `connect` checks `sourceProof` to ignore other clients; raw subscriptions retain their records.',
          '端点 `connect` 按来源证明忽略其它客户端，原始订阅仍保留其消息记录。'
        )
      ],
      [
        t(
          'Ask the Service Worker to prefetch or clear caches.',
          '请求 Service Worker 预取或清理缓存。'
        )
      ]
    ),
    createBroadcastChannelTransport: transportEnhancer(
      t(
        'After installation the Endpoint broadcasts to every same-origin context on the channel.',
        '安装后 Endpoint 会向该频道上所有同源上下文广播每一条消息。'
      ),
      broadcastExample,
      [
        observeBehavior,
        t(
          'Every tab sees every message; do not send private data. A native send failure keeps its type, stack and object identity when mutable; Core attaches `TRANSPORT` unless a full external semantic identity already exists. Unattachable values remain on `cause`.',
          '所有标签页都能看到每条消息；不要发送私密数据。原生发送失败在可修改时保留类型、堆栈及对象身份；已有完整外部语义身份时保持原身份，否则核心附加 `TRANSPORT`；不可附加身份的值保留在 `cause`。'
        )
      ],
      [t('Keep a shopping cart in sync across tabs.', '在多个标签页之间同步购物车。')]
    ),
    createRtcDataChannelTransport: transportEnhancer(
      t(
        'The application exchanges raw JSON strings through the same real RTC carrier; decoding remains explicit in the paired application protocol.',
        '应用通过同一真实数据频道载体交换原始字符串，解码仍由双端应用协议显式执行。'
      ),
      rtcTransportExample,
      [
        observeBehavior,
        t(
          'Closing the channel terminates the transport and releases observers. An RTC error event retains its original `error` as `cause` under Core `TRANSPORT`.',
          '频道关闭时载体终止并释放观察者；数据频道错误事件的原 `error` 保留在核心 `TRANSPORT` 错误的 `cause` 中。'
        )
      ],
      [
        t(
          'Peer-to-peer calls between two browsers without a server relay.',
          '两个浏览器之间不经服务器中转的点对点调用。'
        )
      ],
      'RTCDataChannel'
    ),
    createWebTransportDatagramTransport: transportEnhancer(
      t(
        'The application exchanges actual Uint8Array datagrams with its external server protocol; no Runtime Peer or ready-made compatible Endpoint framing is installed.',
        '应用使用外部服务端协议交换实际字节数组数据报，不安装运行对端或现成兼容端点分帧。'
      ),
      webTransportExample,
      [
        observeBehavior,
        t(
          'Datagrams may be lost or reordered. Read and write failures use the Core transport boundary: mutable native errors retain type, stack and identity; immutable failures remain on `cause`. The send Promise handles writer rejection and need not equal the native write Promise.',
          '数据报可能丢失或乱序。读写失败经过核心载体边界：可修改原生错误保留类型、堆栈及身份，不可修改的失败保留在 `cause`；发送返回处理写入拒绝的承诺，不保证与原生写入承诺引用相同。'
        )
      ],
      [
        t(
          'Low-latency game or telemetry updates where a lost update is acceptable.',
          '允许丢失更新的低延迟游戏或遥测数据。'
        )
      ],
      'WebTransport.datagrams'
    )
  }
}
