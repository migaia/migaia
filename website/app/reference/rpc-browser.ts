/**
 * Reference documentation of `@migaia/rpc-browser`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/rpc-browser/src` (browser/peer*.ts, browser/adapters/*.ts, error-code.ts),
 * `packages/rpc-core/src/remote/runtime-api/peer.ts` (inherited Peer options and the returned
 * `IRuntimePeer`), README and USEGUIDE on 2026-10-17.
 */
import type { ICode, IEnhancerDoc, ILibraryReference, IMemberDoc, IText } from './contract.js'
import { runtimePeerOptionMembers } from './rpc-runtime-shared.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Docs of `addEventListener` / `removeEventListener` pairs on message receivers. */
const listenerPair = (event: string, owner: IText): Readonly<Record<string, IMemberDoc>> => ({
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
    example: `receiver.addEventListener('message', onMessage)`
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
    example: `receiver.removeEventListener('message', onMessage)`
  }
})

/** Canonical RTC carrier methods shared by the low-level transport and Runtime Peer source. */
const rtcChannelMembers: Readonly<Record<string, IMemberDoc>> = {
  send: {
    summary: t('Sends one message as a JSON string.', '把一条消息作为 JSON 字符串发送出去。'),
    params: { data: t('The encoded message.', '编码后的消息文本。') },
    returns: t('Nothing; the message is queued.', '无返回值；消息已进入发送队列。'),
    example: `channel.send(JSON.stringify(message))`
  },
  readyState: {
    summary: t(
      'Must be `open` or `closed` when the transport is created.',
      '创建 transport 时频道状态必须为 `open` 或 `closed`。'
    )
  },
  ...listenerPair('message / closing / close / error', t('the channel', '数据频道'))
}

/** Parent page side of the README iframe example. */
const peerExample: ICode = {
  en: `import { createBrowserPeer } from '@migaia/rpc-browser'

type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): number }
const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
const billing = await createBrowserPeer<IBillingApi>({
  connect: { window: iframe.contentWindow!, origin: 'https://billing.example' },
  defaultTimeoutMs: 5000
})
console.log(await billing.request('calculateTotal', { prices: [12, 30], taxRate: 0.08 })) // 45.36
await billing.close() // the iframe itself stays open`,
  zh: `import { createBrowserPeer } from '@migaia/rpc-browser'

type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): number }
const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
const billing = await createBrowserPeer<IBillingApi>({
  connect: { window: iframe.contentWindow!, origin: 'https://billing.example' },
  defaultTimeoutMs: 5000
})
console.log(await billing.request('calculateTotal', { prices: [12, 30], taxRate: 0.08 })) // 45.36
await billing.close() // iframe 本身保持打开`
}

/** Endpoint assembly used by every transport install snippet. */
const endpointWith = (
  setup: string
): string => `import { connect, contract, createEndpoint, protocol } from '@migaia/rpc-core'
${setup}
const endpoint = await createEndpoint({
  id: 'page',
  transport,
  middlewares: [contract({ version: '1' }), protocol(), connect({ transport })]
})`

/** Enhancer doc for one transport factory. */
const transportEnhancer = (
  summary: IText,
  install: string,
  behaviors: readonly IText[],
  scenarios: readonly IText[]
): IEnhancerDoc => ({
  kind: 'transport',
  target: 'Endpoint',
  summary,
  install: endpointWith(install),
  grants: [],
  behaviors,
  scenarios,
  example: `${endpointWith(install)}
await endpoint.send('remote', 'ping')
await endpoint.dispose()`
})

/** Behaviour shared by every transport: observation through `observe(probe)`. */
const observeBehavior = t(
  '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier`, `origin`, `transfers` and `rejectedSource` in `detail`.',
  '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，`detail` 中包含 `carrier`、`origin`、`transfers` 与 `rejectedSource`。'
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
        'Low-level `postMessage` transport between windows (iframe, popup) for `createEndpoint()`; only messages from the target window and origin are accepted.',
        '供 `createEndpoint()` 使用的窗口间（iframe、弹窗）`postMessage` 底层 transport；只接受来自目标窗口和指定源的消息。'
      ),
      example: `import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const transport = createWindowMessageTransport({ target: iframe.contentWindow!, targetOrigin: 'https://billing.example' })`
    },
    'adapters/shared-worker': {
      summary: t(
        'Low-level transport over one SharedWorker `MessagePort` for `createEndpoint()`; the port stays owned by the caller.',
        '供 `createEndpoint()` 使用的、基于单个 SharedWorker `MessagePort` 的底层 transport；端口仍由调用方持有。'
      ),
      example: `import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const transport = createSharedWorkerTransport(new SharedWorker(workerUrl).port)`
    },
    'adapters/service-worker': {
      summary: t(
        'Low-level transport between a page and its Service Worker for `createEndpoint()`. No Runtime Peer is offered because the browser may stop a Service Worker at any time.',
        '供 `createEndpoint()` 使用的、页面与其 Service Worker 之间的底层 transport。因为浏览器随时可能停止 Service Worker，所以不提供 Runtime Peer。'
      ),
      example: `import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

const transport = createServiceWorkerTransport({ target: registration.active!, receiver: navigator.serviceWorker })`
    },
    'adapters/broadcast-channel': {
      summary: t(
        'Low-level transport over a `BroadcastChannel` for `createEndpoint()`: one-to-many between same-origin tabs, so no Runtime Peer.',
        '供 `createEndpoint()` 使用的、基于 `BroadcastChannel` 的底层 transport：在同源标签页之间一对多广播，因此不提供 Runtime Peer。'
      ),
      example: `import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const transport = createBroadcastChannelTransport(new BroadcastChannel('app'))`
    },
    'adapters/rtc-data-channel': {
      summary: t(
        'Low-level transport over an open `RTCDataChannel` for `createEndpoint()`; messages travel as JSON strings.',
        '供 `createEndpoint()` 使用的、基于已打开 `RTCDataChannel` 的底层 transport；消息以 JSON 字符串传输。'
      ),
      example: `import { createRtcDataChannelTransport } from '@migaia/rpc-browser/adapters/rtc-data-channel'

const transport = createRtcDataChannelTransport(peerConnection.createDataChannel('rpc'))`
    },
    'adapters/web-transport': {
      summary: t(
        'Low-level transport over WebTransport datagrams (`Uint8Array`) for `createEndpoint()`; datagrams may be lost or reordered, so no Runtime Peer.',
        '供 `createEndpoint()` 使用的、基于 WebTransport 数据报（`Uint8Array`）的底层 transport；数据报可能丢失或乱序，因此不提供 Runtime Peer。'
      ),
      example: `import { createWebTransportDatagramTransport } from '@migaia/rpc-browser/adapters/web-transport'

const transport = createWebTransportDatagramTransport(session.datagrams)`
    }
  },
  symbols: {
    createBrowserPeer: {
      role: 'factory',
      purpose: t(
        'Opens a Runtime Peer over a borrowed browser carrier and resolves after the handshake and method directory exchange. Pass exactly one of `connect` (window, SharedWorker port, RTC channel) or `listen` (a SharedWorker scope accepting one Peer per page).',
        '基于借用的浏览器载体打开一个 Runtime Peer，在握手与方法目录交换完成后 resolve。`connect`（窗口、SharedWorker 端口、RTC 频道）与 `listen`（为每个页面接纳一个 Peer 的 SharedWorker 作用域）二者必须且只能提供一个。'
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
          'Service Worker, BroadcastChannel and WebTransport: use the `adapters/*` transports with `createEndpoint()`.',
          'Service Worker、BroadcastChannel 与 WebTransport：请把 `adapters/*` 中的 transport 与 `createEndpoint()` 组合使用。'
        )
      ]
    },
    RPC_BROWSER_ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/rpc/browser`) of Peer configuration and decoding errors of this package; compare it before branching on `code`.',
        '本包 Peer 配置错误与解码错误上的 `source` 值（`@migaia/rpc/browser`）；先比对它确认来源，再按 `code` 分支处理。'
      ),
      example: `if (error.source === RPC_BROWSER_ERROR_SOURCE && error.code === RpcBrowserErrorCode.windowOriginRequired) showSetupHint()`
    },
    RpcBrowserErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `if (error.code === RpcBrowserErrorCode.rtcChannelUnreliable) useReliableChannel()`
    },
    createWindowMessageTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a `postMessage` transport to one window. Sends go to `targetOrigin`; only messages whose `event.source` is `target` (and whose origin matches) are delivered.',
        '创建通往某个窗口的 `postMessage` transport。发送时指定 `targetOrigin`；只有 `event.source` 为 `target`（且源匹配）的消息才会被交付。'
      ),
      returns: t(
        'An `IRpcTransport` for `createEndpoint()`; `*` as origin without `allowUnsafeTargetOrigin` throws `INVALID_CONFIG`.',
        '供 `createEndpoint()` 使用的 `IRpcTransport`；源为 `*` 且未开启 `allowUnsafeTargetOrigin` 时抛 `INVALID_CONFIG`。'
      ),
      options: 'IWindowMessageTransportOptions',
      example: `const transport = createWindowMessageTransport({
  target: iframe.contentWindow!,
  receiver: window,
  targetOrigin: 'https://billing.example'
})`
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
      example: `const transport = createSharedWorkerTransport(worker.port)`
    },
    createServiceWorkerTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a transport between a page and a Service Worker (or a worker and one `Client`); messages are accepted only from `target` or the client whose id equals `peerId`.',
        '创建页面与 Service Worker（或 Worker 与某个 `Client`）之间的 transport；只接受来自 `target` 或 id 等于 `peerId` 的客户端的消息。'
      ),
      returns: t(
        'An `IRpcTransport` for `createEndpoint()`.',
        '供 `createEndpoint()` 使用的 `IRpcTransport`。'
      ),
      options: 'IServiceWorkerTransportOptions',
      example: `const transport = createServiceWorkerTransport({
  target: registration.active!,
  receiver: navigator.serviceWorker
})`
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
      example: `const transport = createBroadcastChannelTransport(new BroadcastChannel('cart'))`
    },
    createRtcDataChannelTransport: {
      role: 'enhancer',
      purpose: t(
        'Creates a transport over an `RTCDataChannel` in state `open` or `closed`, sending messages as JSON strings; malformed JSON is reported with `MESSAGE_DECODE_FAILED`.',
        '创建基于状态为 `open` 或 `closed` 的 `RTCDataChannel` 的 transport，消息以 JSON 字符串发送；格式错误的 JSON 以 `MESSAGE_DECODE_FAILED` 上报。'
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
      example: `const transport = createRtcDataChannelTransport(peerConnection.createDataChannel('rpc'))`
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
      example: `const transport = createWebTransportDatagramTransport(session.datagrams)`
    }
  },
  types: {
    IRuntimeBrowserPeerOptions: {
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
            'Cancels an unfinished handshake and releases its listeners without closing the borrowed carrier.',
            '取消尚未完成的握手并释放其监听，不会关闭借用的载体。'
          ),
          default: t('Not set: the handshake cannot be cancelled.', '不设置：握手无法被取消。')
        }
      }
    },
    IRuntimeBrowserConnect: {
      summary: t(
        'Union of the three connect sources: window, SharedWorker, RTC channel.',
        '三种连接来源的联合类型：窗口、SharedWorker、RTC 频道。'
      ),
      members: {}
    },
    IRuntimeBrowserWindowConnect: {
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
      summary: t(
        'SharedWorker scope accepted by `listen`.',
        '`listen` 选项接受的 SharedWorker 全局作用域。'
      ),
      members: listenerPair('connect', t('the SharedWorker scope', 'SharedWorker 作用域'))
    },
    IRuntimeBrowserConnectEvent: {
      summary: t(
        '`connect` event of a SharedWorker scope.',
        'SharedWorker 作用域上触发的 `connect` 连接事件。'
      ),
      members: {
        ports: {
          summary: t(
            'Ports of the connecting page; the first one is used.',
            '发起连接的页面的端口；使用其中第一个。'
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
          example: `iframe.contentWindow!.postMessage(message, 'https://billing.example')`
        }
      }
    },
    IWindowMessageReceiver: {
      summary: t(
        'Object whose `message` events are read.',
        'transport 从中读取 `message` 事件的接收对象。'
      ),
      members: listenerPair('message', t('the receiving window', '接收消息的窗口'))
    },
    ISharedWorkerPort: {
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
          example: `port.postMessage(message)`
        },
        start: {
          summary: t(
            'Optional; called when listening begins so queued messages are delivered.',
            '可选；开始监听时调用，使排队的消息得以交付。'
          ),
          returns: t('Nothing; the port delivers messages.', '无返回值；端口开始交付消息。'),
          example: `port.start?.()`
        },
        ...listenerPair('message / messageerror', t('the port', '端口'))
      }
    },
    IServiceWorkerTransportOptions: {
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
          example: `registration.active!.postMessage(message)`
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
      summary: t(
        'Owner of Service Worker `message` events.',
        'Service Worker 场景中负责派发 `message` 事件的对象。'
      ),
      members: listenerPair('message', t('the Service Worker container', 'Service Worker 容器'))
    },
    IRTCDataChannel: {
      summary: t(
        'The parts of `RTCDataChannel` the transport uses.',
        'transport 实际使用的那部分 `RTCDataChannel` 能力。'
      ),
      members: rtcChannelMembers
    },
    IWebTransportDatagrams: {
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
      `import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'
const transport = createWindowMessageTransport({ target: iframe.contentWindow!, targetOrigin: 'https://billing.example' })`,
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
      `import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'
const transport = createSharedWorkerTransport(new SharedWorker(workerUrl).port)`,
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
      `import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'
const transport = createServiceWorkerTransport({ target: registration.active!, receiver: navigator.serviceWorker })`,
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
      `import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'
const transport = createBroadcastChannelTransport(new BroadcastChannel('cart'))`,
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
        'After installation the Endpoint talks to a remote browser over an RTC DataChannel using JSON strings.',
        '安装后 Endpoint 通过 RTC DataChannel 以 JSON 字符串的形式与远端浏览器互相调用。'
      ),
      `import { createRtcDataChannelTransport } from '@migaia/rpc-browser/adapters/rtc-data-channel'
const transport = createRtcDataChannelTransport(peerConnection.createDataChannel('rpc'))`,
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
      ]
    ),
    createWebTransportDatagramTransport: transportEnhancer(
      t(
        'After installation the Endpoint sends byte messages as WebTransport datagrams.',
        '安装后 Endpoint 以 WebTransport 数据报的形式与服务器交换字节消息。'
      ),
      `import { createWebTransportDatagramTransport } from '@migaia/rpc-browser/adapters/web-transport'
const transport = createWebTransportDatagramTransport(session.datagrams)`,
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
      ]
    )
  }
}
