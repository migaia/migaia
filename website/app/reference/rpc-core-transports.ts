/** Native transport and raw adapter documentation checked against canonical Core sources. */
import type {
  ILibraryReference,
  IMemberDoc,
  ITypeDoc,
  ISymbolDoc,
  IEnhancerDoc
} from './contract.js'
import { runtimePeerOptionMembers, runtimePluginOptionMembers } from './rpc-runtime-shared.js'
/** Paired translations stay explicit at their source. */
const t = (en: string, zh: string) => ({ en, zh })
/** Fields retain their omission policy where accepted as configuration. */
const p = (en: string, zh: string, fallback?: ReturnType<typeof t>): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Method inputs and completion are documented together. */
const m = (
  en: string,
  zh: string,
  params: NonNullable<IMemberDoc['params']>,
  returns: ReturnType<typeof t>,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Transport declarations are not independent protocol authority. */
const symbols: Record<string, ISymbolDoc> = {}
/** Genuine public transport and raw adapter shapes. */
const types: Record<string, ITypeDoc> = {}
/** Host installation facts for raw adapters and transports. */
const enhancers: Record<string, IEnhancerDoc> = {}
/** Actual memory transport delivery and final pair release. */
const memoryExample = `import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
const [left, right] = createMemoryTransportPair()
const off = right.subscribe((message) => console.log(message.data))
left.send('hello')
await Promise.resolve()
off()
left.close()`
/** Browser ports remain an explicit original native resource. */
const browserExample = `import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'
const channel = new MessageChannel()
const left = createBrowserMessagePortTransport(channel.port1)
const right = createBrowserMessagePortTransport(channel.port2)
let resolveMessage!: () => void
const received = new Promise<void>((resolve) => { resolveMessage = resolve })
const off = right.subscribe((message) => { console.log(message.data); resolveMessage() })
left.send('hello')
await received
off()
await left.close?.()
await right.close?.()`
/** Node ports are borrowed and retain caller-owned physical shutdown. */
const nodeExample = `import { MessageChannel } from 'node:worker_threads'
import { createNodeMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'
const channel = new MessageChannel()
const left = createNodeMessagePortTransport(channel.port1)
const right = createNodeMessagePortTransport(channel.port2)
let resolveMessage!: () => void
const received = new Promise<void>((resolve) => { resolveMessage = resolve })
const off = right.subscribe((message) => { console.log(message.data); resolveMessage() })
left.send('hello')
await received
off()
channel.port1.close()
channel.port2.close()`
/** Worker-like ports accept real native MessagePorts without stealing onmessage. */
const workerExample = `import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'
const channel = new MessageChannel()
channel.port1.start(); channel.port2.start()
const left = createWebWorkerTransport(channel.port1)
const right = createWebWorkerTransport(channel.port2)
let resolveMessage!: () => void
const received = new Promise<void>((resolve) => { resolveMessage = resolve })
const off = right.subscribe((message) => { console.log(message.data); resolveMessage() })
left.send('hello')
await received
off()
await left.close?.(); await right.close?.()
channel.port1.close(); channel.port2.close()`
/** Message adapters assemble two genuine peers from actual raw messaging operations. */
const adapterExample = `import { defineMessageAdapter } from '@migaia/rpc-core/adapter'
const adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })
const { port1, port2 } = new MessageChannel()
const [a, b] = await Promise.all([
  adapter.peer({ self: { name: 'a', instanceId: 'a-1' }, connect: port1 }),
  adapter.peer({ self: { name: 'b', instanceId: 'b-1' }, connect: port2, provide: { echo: (value: string) => value } })
])
try { console.log(await a.request('echo', 'hello')) }
finally { await a.close(); await b.close(); port1.close(); port2.close() }`
/** Byte opening stays supplied by the real application's physical owner. */
const byteExample = `import { defineByteAdapter } from '@migaia/rpc-core/adapter'
async function useByteConnection(options: Parameters<typeof defineByteAdapter<string>>[0], address: string, actualPeerId: string) {
  const adapter = defineByteAdapter(options)
  const peer = await adapter.peer({ connect: address, peerId: actualPeerId })
  try { return peer.describe() }
  finally { await peer.close() }
}`
/** Each type includes an actual construction and release route. */
const type = (
  en: string,
  zh: string,
  members: Record<string, IMemberDoc>,
  example = memoryExample
): ITypeDoc => ({
  summary: t(en, zh),
  scenarios: [
    t(
      'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
      '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
    )
  ],
  example,
  members
})
/** Original physical transfers are caller-supplied references. */
const transfer = p(
  'Optional ordered original transfer references; the actual native carrier validates support and detaches accepted ownership.',
  '可选的转移列表，按调用方给出的顺序传给底层载体；由宿主检查可转移对象并完成所有权转移。',
  t('Absent: no explicit physical transfer.', '默认没有显式物理转移。')
)
/** Canonical physical transport surface, shared by actual wrappers and inherited memory types. */
export const transportMembers: Record<string, IMemberDoc> = {
  send: m(
    'Sends one actual carrier value; completion means the physical boundary completed, not that a remote provider executed.',
    '发送一条底层消息；返回或完成承诺只说明发送操作已完成，不说明对端的业务函数已执行。',
    {
      message: t(
        'Original complete message value accepted by this actual carrier domain.',
        '交给底层载体的完整消息值，必须属于该载体支持的类型。'
      ),
      options: t(
        'Optional IRpcSendOptions supplies original physical transfer references.',
        '可选的 `IRpcSendOptions`，其中 `transfer` 指定本次发送要转移的对象。'
      )
    },
    t(
      'Void or Promise<void> from the physical owner; native message-port and Worker send failures retain native Error/DOMException type and stack. Mutable unclassified errors gain Core TRANSPORT in place; foreign semantic identities stay unchanged, and immutable values remain on cause.',
      '返回物理所有者的空值或承诺，原生消息端口及工作者发送失败保留原生错误类型及堆栈；可修改且未分类的错误原位附加核心 `TRANSPORT`，外部语义身份保持不变，不可修改的值保留在原因链。'
    ),
    memoryExample
  ),
  subscribe: m(
    'Subscribes to actual inbound messages; the original native registration is detached when its last logical listener leaves.',
    '订阅收到的消息；最后一个逻辑订阅被移除时，适配器才移除底层事件监听。',
    {
      listener: t(
        'Application callback receives a record containing data and optional actual peerId/origin/source; return void. Adapter-owned listener errors use onListenerError.',
        '回调收到含 `data` 的记录，并可能带有 `peerId`、`origin`、`source`，返回 `void`；回调失败由 `onListenerError` 观察。'
      )
    },
    t(
      'Idempotent removal of this registration; native cleanup failure may throw and preserve retry ownership.',
      '返回仅取消这次订阅的函数，可重复调用；底层监听移除失败时可能抛错，尚未释放的部分仍可重试。'
    ),
    memoryExample
  ),
  close: m(
    'Retires this transport according to actual ownership; owned resources may be closed, borrowed resources retain their caller-owned native lifetime.',
    '释放这个传输适配器；是否同时关闭底层资源，取决于它接管了资源还是只借用资源。',
    {},
    t(
      'Void or Promise<void>; actual native cleanup failures remain observable. Consult the adapter-specific close policy.',
      '返回 `void` 或 `Promise<void>`，清理失败仍会报告；底层资源的关闭规则见具体适配器。'
    ),
    memoryExample
  ),
  onTransportError: m(
    'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
    '观察底层读写和连接终止的失败；这些错误与对端业务函数的返回值分开处理。',
    {
      listener: t(
        'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
        '回调接收原始错误并返回 `void`；若回调自身也失败，适配器会保留并报告这次次级失败。'
      )
    },
    t('Removal releases this failure observer only.', '返回仅取消这次错误订阅的函数。'),
    memoryExample
  ),
  onListenerError: m(
    'Subscribes to original message-listener or physical-observer callback failures independently of transport failure.',
    '观察消息监听器或载体探针回调抛出的错误，与底层连接错误分开处理。',
    {
      listener: t(
        'Application callback receives original listener error and returns void; its own failure is collected by the original adapter.',
        '回调收到原始监听错误并返回 `void`；回调自身的失败仍由适配器收集。'
      )
    },
    t(
      'Removal releases this diagnostic observer and may surface collected reporter failures.',
      '返回取消这次诊断订阅的函数，取消时可能报告已收集的上报器错误。'
    ),
    memoryExample
  ),
  observe: m(
    'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
    '安装载体探针；替换探针后，旧安装失效，但探针不会接管载体的关闭责任。',
    {
      probe: t(
        'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
        '由端点的观察模块提供的 `IRpcCarrierProbe`，用于接收底层发送与接收观察。'
      )
    },
    t(
      'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
      '返回只移除本次安装的函数；同一个探针后来重新安装时，不会被旧函数误删。'
    ),
    memoryExample
  ),
  peerId: p(
    'Optional original peer identity attributed by the actual adapter; caller labels do not grant verified identity.',
    '适配器记录的可选对端标识；调用方填写这个标签并不等于对端身份已经验证。'
  ),
  origin: p(
    'Optional actual origin attributed by the adapter, not a caller assertion of trust.',
    '适配器记录的可选来源域；它是来源信息，不能单独用作信任凭据。'
  ),
  platform: {
    ...p(
      'Actual carrier platform label for presentation and diagnostics.',
      '载体的平台标签，用于展示和诊断。'
    ),
    values: { enum: 'RpcPlatform' }
  },
  topology: {
    ...p(
      'Actual peer topology supplied by the adapter.',
      '适配器提供的连接拓扑，说明载体怎样连接对端。'
    ),
    values: { enum: 'RpcTransportTopology' }
  },
  encodedType: {
    ...p('Actual accepted carrier encoding domain.', '载体接受的数据表示类型。'),
    values: { enum: 'RpcTransportEncoding' }
  },
  ownership: {
    ...p(
      'Actual original physical ownership determining cleanup responsibility.',
      '底层资源的所有权标记，用来决定谁负责关闭。'
    ),
    values: { enum: 'RpcTransportOwnership' }
  },
  sourceProof: p(
    'Optional original adapter callback receives native source and optional origin, synchronously returns boolean; labels alone cannot replace this proof.',
    '可选的来源检查函数，接收原生 `source` 和可选 `origin`，同步返回布尔值；标识标签不能代替这项检查。'
  ),
  closed: p(
    'True only when this adapter can prove no future message delivery; logical detach alone is insufficient.',
    '只有适配器确认不会再交付消息时才为 `true`；仅移除一层逻辑监听不代表底层已关闭。'
  )
}
types.IRpcTransport = type(
  'Original adapter-owned carrier interface; its operations, source proof and cleanup stay separate from Core protocol ownership.',
  '传输适配器提供的载体接口；底层读写、来源检查和资源清理由适配器负责，RPC 协议由 Core 负责。',
  transportMembers
)
types.IRpcSendOptions = type(
  'Physical sender options contain only original transfer references, without application deadlines or RPC replay semantics.',
  '底层发送选项，仅包含要转移的对象；调用超时和 RPC 重放策略不在这里配置。',
  { transfer }
)
types.IMemoryTransport = type(
  'One end of the original queued memory pair; it shares the same values without structured cloning and closing either end closes both.',
  '内存载体对的一端；消息排队交付且不做结构化克隆，关闭任一端都会关闭两端。',
  {
    ...transportMembers,
    close: m(
      'Idempotently closes both original memory ends; queued messages not yet delivered are dropped.',
      '关闭内存载体对的两端，可重复调用；尚未交付的排队消息会被丢弃。',
      {},
      t(
        'Both ends reject later sends and clear existing listeners. Later subscribe calls can still register but receive no delivery; cleanup failures may throw or settle asynchronously.',
        '两端停止接受发送并清空已有监听；之后仍可登记订阅，但不会再收到消息。清理失败可能同步抛出，也可能通过承诺报告。'
      ),
      memoryExample
    )
  }
)
types.IMemoryTransportOptions = type(
  'Optional delivery scheduler for the memory carrier only; endpoint deadline clocks are configured separately.',
  '可选的内存消息交付调度器，只控制这对载体的排队任务；端点的超时时钟另行配置。',
  {
    scheduler: p(
      'Application IScheduler passed to deferTask for actual queued memory delivery.',
      '调用方提供的 `IScheduler`，供 `deferTask` 安排这对载体的消息交付。',
      t('Absent: delivery uses the host microtask queue.', '默认使用宿主微任务队列交付。')
    )
  }
)
symbols.createMemoryTransportPair = {
  role: 'factory',
  purpose: types.IMemoryTransport.summary,
  options: 'IMemoryTransportOptions',
  returns: t(
    'Readonly pair of borrowed, exclusive Memory transports; caller owns final pair close. No native transfer is performed.',
    '返回只读的内存载体对，拓扑为 `exclusive`、所有权为 `borrowed`；最终由调用方关闭，不执行原生对象转移。'
  ),
  example: memoryExample
}
/** Structural native listener callbacks preserve their original event semantics. */
const nativePortMembers: Record<string, IMemberDoc> = {
  postMessage: m(
    'Calls the actual native postMessage and forwards the exact ordered transfer list.',
    '调用底层 `postMessage`，按原顺序传入转移列表。',
    {
      message: t('Original native-supported message value.', '原生支持的原始消息值。'),
      transfer: t(
        'Optional original native transferable references.',
        '可选的原生可转移对象列表，保留传入的对象引用。'
      ),
      transferList: t(
        'Optional original native transferable references.',
        '可选的原生可转移对象列表，保留传入的对象引用。'
      )
    },
    t(
      'Returns after native postMessage; synchronous clone/transfer failures propagate.',
      '原生消息发送返回后完成，同步克隆或转移失败传播。'
    ),
    browserExample
  ),
  start: m(
    'Starts native MessagePort delivery without replacing existing event listeners.',
    '启动 MessagePort 的消息交付，不替换已有事件监听。',
    {},
    t(
      'Native delivery is enabled; no RPC connection is inferred.',
      '端口开始交付消息；这一步不会自行建立 RPC 连接。'
    ),
    browserExample
  ),
  close: m(
    'Calls the original native port close operation; its actual physical owner determines idempotency and errors.',
    '调用端口自己的 `close`；是否幂等、怎样报告失败，由底层端口决定。',
    {},
    t(
      'Native close completes or throws its original failure.',
      '端口关闭完成，或抛出原始关闭错误。'
    ),
    browserExample
  ),
  addEventListener: m(
    'Registers an additional native event callback without taking a mutable onmessage slot.',
    '通过原生事件接口增加监听，不覆盖 `onmessage`。',
    {
      type: t(
        'Actual supported native message/messageerror/error event name for this structural port.',
        '该端口支持的 `message`、`messageerror` 或 `error` 事件名。'
      ),
      listener: t(
        'Synchronous callback receives the original native event, returns void; native dispatch owns invocation.',
        '回调接收原生事件并返回 `void`，由端口的事件系统同步调用。'
      )
    },
    t('Original event callback is registered.', '事件回调已登记。'),
    workerExample
  ),
  removeEventListener: m(
    'Removes the exact original event callback without removing other registrations.',
    '按回调引用移除对应监听，不影响其他监听。',
    {
      type: t('Same native event name passed when registering.', '登记时传入的相同原生事件名。'),
      listener: t(
        'Same original callback reference passed to registration.',
        '登记时使用的同一个回调引用。'
      )
    },
    t(
      'Native removal completes or throws its original failure.',
      '监听移除完成，或抛出底层移除错误。'
    ),
    workerExample
  ),
  on: m(
    'Adds an actual EventEmitter message, messageerror or close listener.',
    '通过事件订阅接口监听消息、消息解码错误或连接关闭，事件名分别为 `message`、`messageerror`、`close`。',
    {
      event: t(
        'Supported native message/messageerror/close event name.',
        '受支持的原生事件名：`message`、`messageerror` 或 `close`。'
      ),
      listener: t(
        'Synchronous callback receives original message or optional original error; returns void.',
        '回调同步接收原始消息或可选错误，返回 `void`。'
      )
    },
    t('Native emitter registration result is not used by Core.', 'Core 不使用底层 `on` 的返回值。'),
    nodeExample
  ),
  off: m(
    'Removes an exact EventEmitter listener registration.',
    '通过 EventEmitter 接口移除对应监听。',
    {
      event: t(
        'Original supported native event name used when adding.',
        '添加监听时使用的同一个原生事件名。'
      ),
      listener: t(
        'Exact original listener reference used when adding.',
        '添加监听时使用的同一个回调引用。'
      )
    },
    t('Native emitter removal result is not used by Core.', 'Core 不使用底层 `off` 的返回值。'),
    nodeExample
  ),
  onError: transportMembers.onTransportError,
  observe: transportMembers.observe
}
types.IBrowserMessagePortLike = type(
  'Original browser MessagePort structural surface with explicit start/close and optional raw physical observation.',
  '浏览器 MessagePort 需要满足的接口，包括启动、关闭及可选的载体观察能力。',
  Object.fromEntries(
    [
      'postMessage',
      'start',
      'close',
      'addEventListener',
      'removeEventListener',
      'onError',
      'observe'
    ].map((k) => [k, nativePortMembers[k]])
  ),
  browserExample
)
types.INodeMessagePortLike = type(
  'Original Node EventEmitter MessagePort structural surface; Core borrows the native resource without importing Node types.',
  'Node MessagePort 需要满足的 EventEmitter 接口；Core 借用端口，不导入 Node 类型。',
  Object.fromEntries(['postMessage', 'on', 'off'].map((k) => [k, nativePortMembers[k]])),
  nodeExample
)
types.IWebWorkerLikePort = type(
  'Original Worker/MessagePort event-listener surface; mutable onmessage ownership is never required.',
  'Worker 或 MessagePort 需要满足的事件监听接口，不要求接管 `onmessage`。',
  Object.fromEntries(
    ['postMessage', 'addEventListener', 'removeEventListener'].map((k) => [k, nativePortMembers[k]])
  ),
  workerExample
)
types.IWebWorkerPortEvent = type(
  'Original native event fields read once at the adapter boundary; getter failure is reported as transport failure.',
  '适配器读取一次的原生事件字段；属性访问失败会作为传输错误报告。',
  {
    data: p('Original native event message payload, when present.', '存在时的原生事件消息载荷。'),
    origin: p(
      'Original untrusted event origin before string classification.',
      '尚未确认是字符串的原始 `origin`，不能直接当作可信来源。'
    ),
    source: p('Original native event source reference.', '保留原对象身份的原生事件来源引用。'),
    type: p('Original native event classification when supplied.', '宿主提供的原始事件类型。'),
    error: p(
      'Optional original ErrorEvent failure retained as transport cause; it remains reachable with its native type and stack.',
      '可选原生错误事件失败，保留为载体错误原因；其原生类型及堆栈仍可经原因链追踪。'
    )
  },
  workerExample
)
types.IBrowserMessagePortTransportOptions = type(
  'Explicit cleanup ownership of the exact browser port supplied to its adapter.',
  '指定浏览器端口由适配器关闭，还是继续由调用方关闭。',
  {
    ownership: {
      ...p(
        'Owned closes the native port; borrowed only removes this wrapper registrations.',
        '`owned` 会关闭端口；`borrowed` 只移除本适配器的监听。',
        t(
          'owned: wrapper closes the original native port.',
          '默认 `owned`，关闭适配器时也关闭端口。'
        )
      ),
      values: { enum: 'RpcTransportOwnership' }
    }
  },
  browserExample
)
types.IWebWorkerTransportOptions = type(
  'Static dedicated-channel presentation and explicit capability agreement; both deployment ends must use the same actual capabilities.',
  '专用通道的标签和静态能力约定，两端必须配置相同的能力。',
  {
    capabilities: p(
      'Application static capability list agreed on both actual deployment ends; never inferred from metadata labels.',
      '部署时在两端约定的能力列表，不根据标签自动推断。',
      t('Canonical batch@1 capability is enabled.', '默认启用 `batch@1`。')
    ),
    peerId: p(
      'Optional actual peer identifier issued by this known dedicated deployment owner.',
      '`options.peerId` 来自调用方的部署配置，用于标记专用连接的对端；这个标签不代替身份验证。',
      t('Absent: no explicit peer label.', '默认没有显式对端标签。')
    ),
    origin: p(
      'Optional actual origin label supplied by the dedicated deployment owner.',
      '部署方提供的可选来源域标签。',
      t('Absent: no configured origin label.', '默认没有配置来源域标签。')
    )
  },
  workerExample
)
for (const [name, en, zh, example, option] of [
  [
    'createBrowserMessagePortTransport',
    'Wraps an original browser MessagePort with lazy native listeners, generation-bound observation and explicit physical cleanup ownership.',
    '把浏览器 MessagePort 接入 Core，按需登记底层监听，隔离探针的多次安装，并明确端口的关闭责任。',
    browserExample,
    'IBrowserMessagePortTransportOptions'
  ],
  [
    'createNodeMessagePortTransport',
    'Wraps an original Node MessagePort as a borrowed exclusive carrier; close only retires observation, so callers still close their native ports.',
    '把 Node MessagePort 包装为借用的独占载体；关闭适配器只移除观察，端口仍由调用方关闭。',
    nodeExample,
    undefined
  ],
  [
    'createWebWorkerTransport',
    'Wraps original Worker-like event I/O as a borrowed exclusive carrier; script/clone/read failures use transport errors, and cleanup never terminates the Worker.',
    '把 Worker 事件接口包装为借用的独占载体；脚本、克隆和读取失败通过传输错误通道报告，清理不会终止 Worker。',
    workerExample,
    'IWebWorkerTransportOptions'
  ]
] as const) {
  symbols[name] = {
    role: 'enhancer',
    purpose: t(en, zh),
    params: {
      port: t(
        'Original native port created by the application MessageChannel, Worker launcher or actual runtime resource.',
        '调用方用 MessageChannel、Worker 启动器或其他运行资源取得的原生端口。'
      )
    },
    ...(option ? { options: option } : {}),
    returns: t(
      'IRpcTransport retaining the actual carrier and native failures; endpoint composition does not acquire capabilities from copied labels.',
      '返回 `IRpcTransport`，保留底层载体和原生错误；复制它的标签不能获得额外能力。'
    ),
    example
  }
  types[name] = { ...types.IRpcTransport, surface: 'IRpcTransport' }
  enhancers[name] = {
    kind: 'transport',
    target: 'IRpcEndpoint',
    summary: t(en, zh),
    install: example,
    grants: [],
    behaviors: [
      t(
        'Endpoint uses this original physical I/O; its explicit ownership determines cleanup.',
        '端点使用这个载体读写消息，按所有权设置决定谁负责关闭。'
      )
    ],
    scenarios: [
      t('Connect an existing native message resource to Core.', '把已有原生消息资源连接到核心。')
    ],
    example
  }
}
/** Canonical remote peers are reused by raw adapters rather than reimplemented here. */
const adapterPeerOptions: Record<string, IMemberDoc> = {
  ...runtimePeerOptionMembers,
  spawn: p(
    'Application physical input issued by its deployment launcher; selects this definition launch operation.',
    '传给应用启动器的输入；提供 `spawn` 就选择适配器定义的启动操作。',
    t('Absent: no launch source.', '默认不指定 `spawn`。')
  ),
  connect: p(
    'Application physical input issued by its connection owner; selects this definition open/dial operation.',
    '传给连接操作的输入；提供 `connect` 就选择适配器定义的打开或拨号操作。',
    t('Absent: no connect source.', '默认不指定 `connect`。')
  ),
  listen: p(
    'Application physical input issued by its listener owner; selects this definition listening operation.',
    '传给监听操作的输入；提供 `listen` 就选择适配器定义的监听操作。',
    t('Absent: no listener source.', '默认不指定 `listen`。')
  ),
  peerId: p(
    'Actual remote identifier learned by the deployment owner; message adapters may learn it through their original initial exchange.',
    '部署方确定的远端标识；消息适配器也可通过连接建立时的身份交换取得它。',
    t(
      'Absent: message exchange may learn the address; byte construction requires its actual address.',
      '省略时，消息适配器可通过身份交换取得标识；字节适配器要求调用方提供对端标识。'
    )
  ),
  signal: p(
    'Application cancellation signal retires physical opening and the original directory handshake, including byte preparation. An existing preparation signal keeps priority.',
    '用于取消连接打开和身份握手，也覆盖字节连接的准备工作；若准备阶段已有信号，则优先使用已有信号。',
    t('Absent: no caller cancellation.', '默认不提供调用方取消信号。')
  ),
  scheduler: p(
    'Application monotonic IScheduler shared by the original connection owners.',
    '调用方提供的单调时钟与调度器，由连接管理各阶段共用。',
    t('systemScheduler uses native time and timers.', '默认使用原生时间及计时器。')
  ),
  offer: p(
    'Local rpc-contract IRpcHandshakeOffer proposal; received I/O determines accepted capabilities.',
    '本地的 `IRpcHandshakeOffer`；最终采用的能力要经过底层连接的握手确认。',
    t('Absent: Core compiles its canonical local offer.', '默认由 Core 生成本地握手提议。')
  ),
  auth: p(
    'Actual responder verifier configuration; required mode receives portable credentials and admitted peer, returns principal string or void synchronously/asynchronously. Throws reject authentication.',
    '响应方的认证配置；必需模式下，验证函数接收可移植凭证和已接纳的对端，返回主体字符串或 `void`，支持异步；抛错表示认证失败。',
    t('Absent: no explicit responder verifier.', '默认不提供响应方验证函数。')
  ),
  ipc: p(
    'Actual connection/session diagnostic labels, capacities and local log sink chosen by the physical owner.',
    '连接管理方配置的会话诊断标签、容量和本地日志接收函数。',
    t('Absent: original Core connection defaults apply.', '省略时使用 Core 的连接默认配置。')
  ),
  governor: p(
    'Actual original connection policy for call-rate, payload, repeated-timeout, idle and violation limits; it borrows original provider admission.',
    '连接治理策略，包括调用速率、载荷、连续超时、空闲和违规限制；沿用已有的提供方准入机制。',
    t('Absent: no extra connection governor.', '默认不增加连接治理策略。')
  ),
  scope: p(
    'Genuine scope returned by this adapter scope method; borrowed across peers and closed by its caller after peers close.',
    '由此适配器的 `scope()` 创建，供多个对端借用；全部对端关闭后，调用方再关闭它。',
    t('Absent: no caller-shared provider scope.', '默认不提供跨对端共享的提供方作用域。')
  )
}
types.IAdapterDefinitionPeerOptions = type(
  'Exactly one deployment source selects original raw opening; common runtime peer policy remains owned by the canonical remote layer.',
  '从 `spawn`、`connect`、`listen` 中恰选一个来源来打开底层资源；对端的公共运行策略沿用 Remote 层。',
  adapterPeerOptions,
  adapterExample
)
types.IAdapterDefinitionPluginOptions = type(
  'Original host plugin name/projection policy and raw deployment input share the same canonical runtime peer construction.',
  '在对端的连接选项之外，配置宿主插件名称和公开方法；它们仍使用同一套 Runtime Peer 构造流程。',
  {
    // Plugin installation picks only some peer options; it has no per-opening `signal`.
    ...Object.fromEntries(Object.entries(adapterPeerOptions).filter(([name]) => name !== 'signal')),
    ...runtimePluginOptionMembers
  },
  adapterExample
)
types.IMessageAdapterOptions = type(
  'Raw messaging recipe supplies actual operations only; Core owns identity exchange, accepted capabilities and endpoint construction.',
  '调用方提供打开或启动消息资源的操作，Core 负责身份交换、能力协商和端点构造。',
  {
    open: m(
      'Opens the original raw messaging resource for one deployment input; rejects propagate through canonical construction cleanup.',
      '根据一次连接输入打开消息资源；失败时由 Core 的构造流程清理已取得的资源并报告原错误。',
      {
        input: t(
          'Actual physical input supplied by the application connect/listen deployment choice.',
          '调用方通过 `connect` 或 `listen` 提供的底层连接输入。'
        )
      },
      t(
        'Original IMessageAdapterPort synchronously or asynchronously; no fabricated transport recipe is accepted.',
        '同步或异步返回 `IMessageAdapterPort`；这里需要原始消息端口，不接受预先组装的传输配置。'
      ),
      adapterExample
    ),
    launch: {
      ...m(
        'Launches the actual native resource and returns its real exit/termination operations.',
        '启动底层资源，返回它的消息端口、退出结果和终止操作。',
        {
          input: t(
            'Actual application launch input selected by spawn.',
            '调用方通过 `spawn` 提供的启动输入。'
          ),
          context: t(
            'Original runtime source context containing configured self and local capability offer.',
            '包含本端 `self` 和本地能力提议的运行上下文。'
          )
        },
        t(
          'Promise of IMessageAdapterLaunch; rejection fails original peer construction.',
          '返回 `Promise<IMessageAdapterLaunch>`；启动失败会使对端构造失败。'
        ),
        adapterExample
      ),
      default: t(
        'Absent: spawn is unavailable for this recipe.',
        '省略时，该适配器不支持 `spawn`。'
      )
    }
  },
  adapterExample
)
types.IMessageAdapterLaunch = type(
  'Actual launch resource includes its original messaging port, exit Promise and native termination request.',
  '启动操作返回的资源，包括消息端口、退出承诺和终止请求函数。',
  {
    port: p(
      'Original raw messaging port returned by the actual launcher.',
      '启动器取得的原始消息端口。'
    ),
    exited: p(
      'Actual native exit observation; requesting terminate does not settle it by assertion.',
      '资源实际退出时结算的承诺；仅发出终止请求不代表它已经退出。'
    ),
    failed: p(
      'Optional original native failure observation before eventual exit.',
      '可选的失败观察，在资源最终退出前报告底层故障。'
    ),
    initialMessage: p(
      'Original initial launch message supplied by this actual launcher.',
      '启动器提供的初始消息，保留原始消息值。'
    ),
    terminate: m(
      'Requests actual native termination without claiming observed exit.',
      '请求底层资源终止，不把请求发出当作退出完成。',
      {},
      t(
        'Termination request is issued; await exited for actual completion.',
        '发出终止请求；仍须等待 `exited` 才能确认资源实际退出。'
      ),
      adapterExample
    )
  },
  adapterExample
)
types.IMessageAdapterPort = type(
  'Original EventEmitter or EventTarget raw messaging operations; this structural input alone grants no accepted runtime channel identity.',
  'EventEmitter 或 EventTarget 风格的原始消息接口；仅满足这些方法形状，不代表已经完成通道身份验证。',
  {
    // Raw adapter ports borrow lifecycle from the held resource, so they have no `start` / `close`.
    ...Object.fromEntries(
      Object.entries(nativePortMembers).filter(([name]) => name !== 'start' && name !== 'close')
    ),
    listenerCount: m(
      'Reports actual native message listener count when the raw EventEmitter supports it.',
      '底层 EventEmitter 支持时，查询消息监听器的数量。',
      { event: t('The original message event name.', '原生 `message` 事件名。') },
      t('Actual native listener count.', '返回底层监听器数量。'),
      adapterExample
    ),
    once: m(
      'Registers an actual one-shot close observation on the native resource.',
      '在底层资源上登记一次性的关闭监听。',
      {
        event: t('The original native close event name.', '原生 `close` 事件名。'),
        listener: t(
          'Application zero-argument synchronous close callback returning void.',
          '无参的同步关闭回调，返回 `void`。'
        )
      },
      t('Native registration result is not consumed by Core.', 'Core 不使用底层监听登记的返回值。'),
      adapterExample
    )
  },
  adapterExample
)
/** Byte recipe references point to the existing canonical byte contracts in their owning package. */
const byteOpen = (en: string, zh: string) =>
  m(
    en,
    zh,
    {
      input: t(
        'Actual application physical input selected by connect/listen deployment options.',
        '调用方通过 `connect` 或 `listen` 选择的底层连接输入。'
      )
    },
    t(
      'Original ordered byte I/O with kind byte, async write, data/close subscriptions and actual close; Core owns wire control.',
      '返回 `kind` 为 `byte` 的有序字节连接，提供异步写入、数据与关闭订阅以及关闭操作；线上协议仍由 Core 负责。'
    ),
    byteExample
  )
types.IByteAdapterOptions = type(
  'Raw ordered-byte recipe delegates opening to the application and retains all wire handshake, authentication and protocol control in Core.',
  '调用方负责打开有序字节连接，Core 负责连接上的握手、认证和协议控制。',
  {
    open: byteOpen(
      'Opens original physical ordered-byte I/O; an async rejection fails construction.',
      '打开底层有序字节连接；异步打开失败会使对端构造失败。'
    ),
    listen: {
      ...byteOpen(
        'Opens an actual accepted listening byte connection, without supplying a fabricated runtime agreement.',
        '打开监听端已接纳的字节连接；不由调用方预填一份已协商的运行约定。'
      ),
      default: t(
        'Absent: use open for the original listening input.',
        '省略时，把监听输入交给 `open`。'
      )
    },
    dial: {
      ...byteOpen(
        'Opens an actual dialed byte connection while retaining the original byte owner.',
        '通过拨号取得字节连接，保留底层资源已有的所有权。'
      ),
      default: t(
        'Absent: use open for the original connecting input.',
        '省略时，把连接输入交给 `open`。'
      )
    },
    diagnostics: p(
      'Optional adapter-owned canonical error source/code/message records and text for actual byte failures.',
      '可选的适配器诊断配置，提供字节连接失败时使用的错误来源、错误码和消息。',
      t('Absent: Core canonical byte diagnostics.', '默认使用 Core 的字节连接诊断。')
    ),
    'presentation.platform': p(
      'Actual platform label selected by the byte adapter author; presentation grants no provenance.',
      '适配器作者配置的平台标签，只用于展示，不能证明来源身份。'
    ),
    'presentation.expectedStringText': p(
      'Adapter-owned canonical diagnostic text for an unsupported non-string semantic carrier.',
      '适配器提供的错误文本，用于说明不支持的非字符串消息值。'
    ),
    presentation: p(
      'Optional platform label and expected-string diagnostic text; presentation cannot establish channel provenance.',
      '可选的平台标签和预期字符串错误文本，只用于展示与诊断，不能证明通道来源。',
      t('Absent: Core process presentation defaults.', '默认沿用 Core 的进程标签与诊断文本。')
    )
  },
  byteExample
)
types.IAdapterDefinition = type(
  'Genuine raw-I/O recipe handle creates canonical peers, host plugins and provider scopes; copied methods cannot select a different recipe.',
  '由适配器工厂创建的定义，可生成对端、宿主插件和共享提供方作用域；复制方法不会改变它绑定的连接操作。',
  {
    peer: m(
      'Constructs the canonical runtime peer from exactly one original physical deployment source.',
      '从 `spawn`、`connect`、`listen` 中恰选一个来源，构造 Runtime Peer。',
      {
        options: t(
          'Application IAdapterDefinitionPeerOptions retaining original raw input and runtime policy.',
          '调用方的 `IAdapterDefinitionPeerOptions`，包含底层连接输入和对端运行策略。'
        )
      },
      t(
        'Promise of IRuntimePeer or typed peer; byte recipes reject transfer options and expose a no-transfer typed peer, while message recipes retain the ordinary typed API. Construction rollback retains the primary failure.',
        '返回 Runtime Peer 或带方法类型推导的 Peer；字节适配器不支持对象转移选项，消息适配器保留普通类型接口。构造回滚不会替换原始失败。'
      ),
      adapterExample
    ),
    plugin: m(
      'Creates a genuine Host plugin using the same actual raw recipe and runtime method whitelist.',
      '用同一套底层连接操作和方法白名单创建宿主插件。',
      {
        options: t(
          'Application plugin name, provide/expose and exactly one raw deployment source.',
          '插件名称、`provide`、`expose` 配置，以及恰好一个底层连接来源。'
        )
      },
      t(
        'Canonical runtime plugin definition with the actual process/thread slot family.',
        '返回 Runtime 插件定义，沿用对应的 process 或 thread 插件槽位。'
      ),
      adapterExample
    ),
    scope: m(
      'Creates a genuine shared provider admission/store scope; callers own its final close after every borrowing peer closes.',
      '创建跨对端共享的提供方准入和存储作用域；全部借用它的对端关闭后，由调用方最终关闭。',
      {
        store: t(
          'Optional actual IRpcIdempotencyStore returned by createRpcIdempotencyStore or application implementation.',
          '可选的 `IRpcIdempotencyStore`，可由 `createRpcIdempotencyStore` 创建，也可由应用实现。'
        )
      },
      t(
        'Scope exposes generated namespace, original admission, session(channel, limits) and idempotent close(); only real constructed channels may create sessions.',
        '返回含命名空间、准入控制、`session(channel, limits)` 和幂等 `close()` 的作用域；会话只接受实际构造得到的通道。'
      ),
      adapterExample
    )
  },
  adapterExample
)
for (const [name, option, example, en, zh] of [
  [
    'defineMessageAdapter',
    'IMessageAdapterOptions',
    adapterExample,
    'Defines one genuine raw-message adapter recipe; its peer/plugin operations reuse original Core assembly rather than accepting a prebuilt trusted channel.',
    '定义消息适配器，把原始端口接入 Core；对端和插件复用已有构造流程，不接受调用方预先声明为可信的通道。'
  ],
  [
    'defineByteAdapter',
    'IByteAdapterOptions',
    byteExample,
    'Defines one genuine ordered-byte adapter recipe; the existing Core owner performs handshake, authentication, framing and endpoint assembly.',
    '定义有序字节适配器，由 Core 继续负责握手、认证、分帧和端点组装。'
  ]
] as const) {
  symbols[name] = {
    role: 'enhancer',
    purpose: t(en, zh),
    options: option,
    returns: t(
      'Frozen genuine IAdapterDefinition retaining the exact original physical operations.',
      '返回冻结的 `IAdapterDefinition`，保持与这组底层连接操作的绑定。'
    ),
    example
  }
  enhancers[name] = {
    kind: 'adapter',
    target: 'IRuntimePeer',
    summary: t(en, zh),
    install: example,
    grants: Object.entries(types.IAdapterDefinition.members).map(([key, doc]) => ({
      ...doc,
      signature: 'adapter.' + key + '(options)'
    })),
    behaviors: [
      t(
        'Actual physical I/O selects Core construction; metadata does not grant accepted capability authority.',
        'Core 根据实际连接完成构造；填写元数据标签不能额外取得已协商的能力。'
      )
    ],
    scenarios: [
      t(
        'Bind an existing native raw resource to canonical runtime peers.',
        '把已有原生资源接入 Runtime Peer。'
      )
    ],
    example
  }
}
/** Canonical transport documentation is merged without changing registry ownership. */
export const transportReference: ILibraryReference = {
  modules: {
    adapter: {
      summary: t(
        'Use this entry when adding a communication mechanism that the platform packages do not already support. Import `defineMessageAdapter()` for message ports or `defineByteAdapter()` for an ordered byte connection. Each definition accepts your opening operations and exposes factories for a connected peer or a host-managed plugin. Core still handles the RPC protocol and connection cleanup; this is different from wrapping a transport for `createEndpoint()`.',
        '需要接入平台包尚未支持的通信方式时，使用这个入口。消息端口从 `defineMessageAdapter()` 开始，有序字节连接从 `defineByteAdapter()` 开始。把打开底层连接的操作交给它们，就能创建可互相调用的对端，或由宿主管理的插件。远程调用协议和连接清理仍由核心包负责；如果只是给 `createEndpoint()` 包装消息载体，应使用传输适配器入口。'
      ),
      example: adapterExample
    },
    'adapters/memory': {
      summary: t(
        'Connect two endpoints in the same process without opening a worker or a network connection. Import `createMemoryTransportPair()` from this subpath and give one returned transport to each endpoint. Messages are queued rather than delivered during `send()`, but their values remain shared references. This is a transport pair, not a pair of ready-to-call peers; use `testing` for those and close the original pair when finished.',
        '需要在同一进程内连接两个端点，又不想打开线程或网络连接时，使用这个入口。从子路径导入 `createMemoryTransportPair()`，把返回的两个载体分别交给两个端点。消息会排队交付，不会在 `send()` 内立即送达，但其中的值仍共享引用。它只创建传输载体；需要可直接调用的双端连接时使用 `testing`，使用完后应关闭原载体对。'
      ),
      example: memoryExample
    },
    'adapters/message-port': {
      summary: t(
        'Use this subpath when you already have a message port and want to supply it to `createEndpoint()`. `createBrowserMessagePortTransport()` wraps a browser-style port; `createNodeMessagePortTransport()` wraps a port with Node event methods. The browser wrapper owns the supplied port by default, with a borrowed option when the caller must close it. These factories adapt existing ports and do not start workers.',
        '已有消息端口，需要把它交给 `createEndpoint()` 时，从这个子路径选择对应的工厂。`createBrowserMessagePortTransport()` 包装浏览器式端口，`createNodeMessagePortTransport()` 包装使用 Node 事件方法的端口。浏览器工厂默认接管端口，也可选择借用，由调用方负责关闭。两个工厂都只包装现有端口，不负责启动工作线程。'
      ),
      example: browserExample
    },
    'adapters/web-worker': {
      summary: t(
        'Use this entry to pass an existing worker or event-based port to `createEndpoint()`. `createWebWorkerTransport()` forwards messages and reports worker or message-decoding failures through the transport error channel. It uses event listeners without replacing `onmessage`, and closing the transport leaves the borrowed worker running. To launch and manage a worker as part of a callable peer, start from `rpc-threads` instead.',
        '已有工作线程或使用事件监听的端口，需要交给 `createEndpoint()` 时，使用这个入口。`createWebWorkerTransport()` 转发消息，并通过载体错误通道报告工作线程或消息解码失败。它使用事件监听，不覆盖 `onmessage`，关闭载体也不会终止借用的线程。需要创建并管理可调用的工作线程时，应从 `rpc-threads` 开始。'
      ),
      example: workerExample
    }
  },
  symbols,
  types,
  enums: {},
  enhancers
}
