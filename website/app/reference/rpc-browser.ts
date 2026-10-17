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
import type { ICode, IEnhancerDoc, ILibraryReference, IMemberDoc, IText } from './contract.js'
import { runtimePeerOptionMembers } from './rpc-runtime-shared.js'

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
      `Registers a \`${event}\` listener on ${owner.en}; the transport calls it once when created.`,
      `在${owner.zh}上登记 \`${event}\` 监听；transport 创建时调用一次。`
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
      `Removes the listener when the transport or Peer closes.`,
      `transport 或 Peer 关闭时移除之前登记的监听。`
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
  '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier`, `origin`, `transfers` and `rejectedSource` in `detail`.',
  '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，`detail` 中包含 `carrier`、`origin`、`transfers` 与 `rejectedSource`。'
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
        'Low-level Window carrier for a paired Endpoint. Its raw subscriptions preserve message attribution; install `connect({ transport })` so sourceProof rejects another window or origin.',
        '供双端端点使用的窗口载体，原始订阅保留消息归属；须搭配 `connect({ transport })`，由来源证明拒绝其他窗口或来源域。'
      ),
      example: windowEndpointExample
    },
    'adapters/shared-worker': {
      summary: t(
        'Low-level transport over one SharedWorker `MessagePort` for `createEndpoint()`; the port stays owned by the caller.',
        '供 `createEndpoint()` 使用的、基于单个 SharedWorker `MessagePort` 的底层 transport；端口仍由调用方持有。'
      ),
      example: sharedEndpointExample
    },
    'adapters/service-worker': {
      summary: t(
        'Low-level transport between a page and its Service Worker for `createEndpoint()`. No Runtime Peer is offered because the browser may stop a Service Worker at any time.',
        '供 `createEndpoint()` 使用的、页面与其 Service Worker 之间的底层 transport。因为浏览器随时可能停止 Service Worker，所以不提供 Runtime Peer。'
      ),
      example: serviceExample
    },
    'adapters/broadcast-channel': {
      summary: t(
        'Low-level transport over a `BroadcastChannel` for `createEndpoint()`: one-to-many between same-origin tabs, so no Runtime Peer.',
        '供 `createEndpoint()` 使用的、基于 `BroadcastChannel` 的底层 transport：在同源标签页之间一对多广播，因此不提供 Runtime Peer。'
      ),
      example: broadcastExample
    },
    'adapters/rtc-data-channel': {
      summary: t(
        'Raw RTC carrier stringifies non-string sends and preserves received values. The paired application example decodes its own JSON; use createBrowserPeer for the canonical Runtime protocol.',
        '原始数据频道载体把非字符串发送值转换为字符串，并保留接收值；双端应用示例自行解码，规范运行协议请使用运行对端工厂。'
      ),
      example: rtcTransportExample
    },
    'adapters/web-transport': {
      summary: t(
        'Raw Uint8Array WebTransport datagrams, with application-owned server protocol and session. No Runtime Peer source or ready-made Core Endpoint/framer combination is supplied; loss and reordering remain possible.',
        '原始字节数组网页传输数据报，由应用拥有服务器协议及会话；不提供运行对端来源或现成核心端点分帧组合，仍可能丢失乱序。'
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
      example: peerExample,
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
      example: sharedEndpointExample
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
      example: broadcastExample
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
      example: peerExample,
      summary: t(
        'Options of `createBrowserPeer()`: the browser source plus the Core Peer options.',
        '`createBrowserPeer()` 的选项：浏览器载体来源，以及 Core Peer 的通用选项。'
      ),
      members: {
        ...runtimePeerOptionMembers,
        connect: {
          summary: t(
            'Carrier to connect over: `{ window, origin }`, `{ sharedWorker }` or `{ rtcDataChannel }`.',
            '本端主动连接所用的载体：`{ window, origin }`、`{ sharedWorker }` 或 `{ rtcDataChannel }`。'
          ),
          default: t('Not set: then `listen` is required.', '不设置：此时必须提供 `listen`。')
        },
        listen: {
          summary: t(
            'SharedWorker global scope (`self`) that accepts one Peer per `connect` event; binding the same scope twice throws `LISTENER_ALREADY_BOUND`.',
            '为每个 `connect` 事件接纳一个 Peer 的 SharedWorker 全局作用域（`self`）；重复绑定同一作用域抛 `LISTENER_ALREADY_BOUND`。'
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
          default: t('`false`: `*` is rejected.', '`false`：拒绝使用 `*`。')
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
      example: windowEndpointExample,
      summary: t(
        'Options of `createWindowMessageTransport()`.',
        '`createWindowMessageTransport()` 的选项：目标窗口、接收者与源。'
      ),
      members: {
        target: {
          summary: t(
            'Window messages are sent to and accepted from.',
            '消息发往、也只接受来自的窗口。'
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
            'Origin used for sending and checked on receive.',
            '发送时使用、接收时校验的源。'
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
          default: t('`false`.', '`false`：拒绝使用 `*`。')
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
        t('Messages from other clients are ignored.', '来自其它客户端的消息会被忽略。')
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
          'Every tab sees every message; do not send private data.',
          '所有标签页都能看到每条消息；不要发送私密数据。'
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
          'Closing the channel terminates the transport and releases observers.',
          '频道关闭时 transport 终止并释放观察者。'
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
          'Datagrams may be lost or reordered; only use it for loss-tolerant calls.',
          '数据报可能丢失或乱序；只适合可以容忍丢失的调用。'
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
