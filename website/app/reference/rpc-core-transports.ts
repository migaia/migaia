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
      '使用原物理读写，由核心保留协议及生命周期所有权。'
    )
  ],
  example,
  members
})
/** Original physical transfers are caller-supplied references. */
const transfer = p(
  'Optional ordered original transfer references; the actual native carrier validates support and detaches accepted ownership.',
  '可选有序原转移引用，实际原生载体验证支持并转移已接受所有权。',
  t('Absent: no explicit physical transfer.', '默认没有显式物理转移。')
)
/** Canonical physical transport surface, shared by actual wrappers and inherited memory types. */
export const transportMembers: Record<string, IMemberDoc> = {
  send: m(
    'Sends one actual carrier value; completion means the physical boundary completed, not that a remote provider executed.',
    '发送一个实际载体值，完成只表示物理边界完成，不表示远端提供方已经执行。',
    {
      message: t(
        'Original complete message value accepted by this actual carrier domain.',
        '此实际载体值域接受的原完整消息值。'
      ),
      options: t(
        'Optional IRpcSendOptions supplies original physical transfer references.',
        '可选载体发送选项提供原物理转移引用。'
      )
    },
    t(
      'Void or Promise<void> from the physical owner; throws/rejections are original physical failures.',
      '返回物理所有者的空值或承诺，抛错及拒绝为原物理失败。'
    ),
    memoryExample
  ),
  subscribe: m(
    'Subscribes to actual inbound messages; the original native registration is detached when its last logical listener leaves.',
    '订阅实际入站消息，最后一个逻辑监听离开时移除原原生登记。',
    {
      listener: t(
        'Application callback receives a record containing data and optional actual peerId/origin/source; return void. Adapter-owned listener errors use onListenerError.',
        '应用回调接收含数据及可选实际对端、来源域、来源对象的记录，返回空值；适配器拥有的监听错误交监听错误观察。'
      )
    },
    t(
      'Idempotent removal of this registration; native cleanup failure may throw and preserve retry ownership.',
      '返回本登记的幂等移除函数，原生清理失败可抛错并保留重试所有权。'
    ),
    memoryExample
  ),
  close: m(
    'Retires this transport according to actual ownership; owned resources may be closed, borrowed resources retain their caller-owned native lifetime.',
    '按实际所有权退役此载体，拥有资源可能关闭，借用资源保留调用方原生生命周期。',
    {},
    t(
      'Void or Promise<void>; actual native cleanup failures remain observable. Consult the adapter-specific close policy.',
      '返回空值或承诺，实际原生清理失败仍可观察，具体关闭策略见适配器。'
    ),
    memoryExample
  ),
  onTransportError: m(
    'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
    '订阅原物理、读取及终止失败，不将其当作应用提供方结果。',
    {
      listener: t(
        'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
        '应用回调接收原未知错误并返回空值，次级失败由适配器上报边界保留。'
      )
    },
    t('Removal releases this failure observer only.', '移除函数只释放此失败观察者。'),
    memoryExample
  ),
  onListenerError: m(
    'Subscribes to original message-listener or physical-observer callback failures independently of transport failure.',
    '独立于载体失败订阅原消息监听或物理观察回调失败。',
    {
      listener: t(
        'Application callback receives original listener error and returns void; its own failure is collected by the original adapter.',
        '应用回调接收原监听错误并返回空值，自身失败由原适配器收集。'
      )
    },
    t(
      'Removal releases this diagnostic observer and may surface collected reporter failures.',
      '移除函数释放此诊断观察者，可能显露已收集上报失败。'
    ),
    memoryExample
  ),
  observe: m(
    'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
    '安装原物理观察，替换时退役前一观察代次，不取得生命周期所有权。',
    {
      probe: t(
        'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
        '已安装端点发射器提供的实际物理探针端口。'
      )
    },
    t(
      'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
      '移除函数只退役此观察代次，即使相同探针之后被重新安装。'
    ),
    memoryExample
  ),
  peerId: p(
    'Optional original peer identity attributed by the actual adapter; caller labels do not grant verified identity.',
    '实际适配器归属的可选原对端身份，调用方标签不赋予已验证身份。'
  ),
  origin: p(
    'Optional actual origin attributed by the adapter, not a caller assertion of trust.',
    '适配器归属的可选实际来源域，不是调用方信任声明。'
  ),
  platform: {
    ...p(
      'Actual carrier platform label for presentation and diagnostics.',
      '用于展示及诊断的实际载体平台标签。'
    ),
    values: { enum: 'RpcPlatform' }
  },
  topology: {
    ...p('Actual peer topology supplied by the adapter.', '适配器提供的实际对端拓扑。'),
    values: { enum: 'RpcTransportTopology' }
  },
  encodedType: {
    ...p('Actual accepted carrier encoding domain.', '实际接受的载体编码值域。'),
    values: { enum: 'RpcTransportEncoding' }
  },
  ownership: {
    ...p(
      'Actual original physical ownership determining cleanup responsibility.',
      '决定清理责任的实际原物理所有权。'
    ),
    values: { enum: 'RpcTransportOwnership' }
  },
  sourceProof: p(
    'Optional original adapter callback receives native source and optional origin, synchronously returns boolean; labels alone cannot replace this proof.',
    '可选原适配器回调接收原生来源及可选来源域，同步返回布尔值，标签本身不能替代此证明。'
  ),
  closed: p(
    'True only when this adapter can prove no future message delivery; logical detach alone is insufficient.',
    '只有适配器可以证明不再交付消息时为真，仅逻辑移除不充分。'
  )
}
types.IRpcTransport = type(
  'Original adapter-owned carrier interface; its operations, source proof and cleanup stay separate from Core protocol ownership.',
  '原适配器拥有的载体接口，操作、来源证明及清理与核心协议所有权分开。',
  transportMembers
)
types.IRpcSendOptions = type(
  'Physical sender options contain only original transfer references, without application deadlines or RPC replay semantics.',
  '物理发送选项只含原转移引用，不包含应用截止或调用重放语义。',
  { transfer }
)
types.IMemoryTransport = type(
  'One end of the original queued memory pair; it shares the same values without structured cloning and closing either end closes both.',
  '原排队内存对的一端，不结构克隆而共享相同值，关闭任一端会关闭两端。',
  {
    ...transportMembers,
    close: m(
      'Idempotently closes both original memory ends; queued messages not yet delivered are dropped.',
      '幂等关闭原内存对两端，尚未交付的排队消息被丢弃。',
      {},
      t(
        'Both ends reject later sends and clear existing listeners. Later subscribe calls can still register but receive no delivery; cleanup failures may throw or settle asynchronously.',
        '两端拒绝后续发送并清空已有监听，后续订阅仍可登记但不会收到交付，清理失败可能抛出或异步结算。'
      ),
      memoryExample
    )
  }
)
types.IMemoryTransportOptions = type(
  'Optional delivery scheduler for the memory carrier only; endpoint deadline clocks are configured separately.',
  '只作用于内存载体交付的可选调度器，端点截止时钟另行配置。',
  {
    scheduler: p(
      'Application IScheduler passed to deferTask for actual queued memory delivery.',
      '传给延迟任务的应用调度器，用于实际排队内存交付。',
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
    '返回只读借用独占内存载体对，调用方拥有最终关闭，不执行原生转移。'
  ),
  example: memoryExample
}
/** Structural native listener callbacks preserve their original event semantics. */
const nativePortMembers: Record<string, IMemberDoc> = {
  postMessage: m(
    'Calls the actual native postMessage and forwards the exact ordered transfer list.',
    '调用实际原生消息发送并转发精确有序转移列表。',
    {
      message: t('Original native-supported message value.', '原生支持的原始消息值。'),
      transfer: t('Optional original native transferable references.', '可选原原生可转移引用。'),
      transferList: t('Optional original native transferable references.', '可选原原生可转移引用。')
    },
    t(
      'Returns after native postMessage; synchronous clone/transfer failures propagate.',
      '原生消息发送返回后完成，同步克隆或转移失败传播。'
    ),
    browserExample
  ),
  start: m(
    'Starts native MessagePort delivery without replacing existing event listeners.',
    '启动原生消息端口交付，不替换已有事件监听。',
    {},
    t(
      'Native delivery is enabled; no RPC connection is inferred.',
      '原生交付已启用，不推断调用连接。'
    ),
    browserExample
  ),
  close: m(
    'Calls the original native port close operation; its actual physical owner determines idempotency and errors.',
    '调用原原生端口关闭操作，由实际物理所有者决定幂等及错误。',
    {},
    t('Native close completes or throws its original failure.', '原生关闭完成或抛出原失败。'),
    browserExample
  ),
  addEventListener: m(
    'Registers an additional native event callback without taking a mutable onmessage slot.',
    '登记额外原生事件回调，不占用可变消息处理槽。',
    {
      type: t(
        'Actual supported native message/messageerror/error event name for this structural port.',
        '此结构端口实际支持的消息、消息错误或错误事件名。'
      ),
      listener: t(
        'Synchronous callback receives the original native event, returns void; native dispatch owns invocation.',
        '同步回调接收原原生事件并返回空值，原生派发拥有调用。'
      )
    },
    t('Original event callback is registered.', '原事件回调已经登记。'),
    workerExample
  ),
  removeEventListener: m(
    'Removes the exact original event callback without removing other registrations.',
    '移除精确原事件回调，不移除其他登记。',
    {
      type: t('Same native event name passed when registering.', '登记时传入的相同原生事件名。'),
      listener: t(
        'Same original callback reference passed to registration.',
        '登记时传入的相同原回调引用。'
      )
    },
    t('Native removal completes or throws its original failure.', '原生移除完成或抛出原失败。'),
    workerExample
  ),
  on: m(
    'Adds an actual EventEmitter message, messageerror or close listener.',
    '添加实际事件发射器消息、消息错误或关闭监听。',
    {
      event: t(
        'Supported native message/messageerror/close event name.',
        '受支持原生消息、消息错误或关闭事件名。'
      ),
      listener: t(
        'Synchronous callback receives original message or optional original error; returns void.',
        '同步回调接收原消息或可选原错误，返回空值。'
      )
    },
    t(
      'Native emitter registration result is not used by Core.',
      '核心不使用原生发射器登记返回值。'
    ),
    nodeExample
  ),
  off: m(
    'Removes an exact EventEmitter listener registration.',
    '移除精确事件发射器监听登记。',
    {
      event: t(
        'Original supported native event name used when adding.',
        '添加时使用的原受支持原生事件名。'
      ),
      listener: t(
        'Exact original listener reference used when adding.',
        '添加时使用的精确原监听引用。'
      )
    },
    t('Native emitter removal result is not used by Core.', '核心不使用原生发射器移除返回值。'),
    nodeExample
  ),
  onError: transportMembers.onTransportError,
  observe: transportMembers.observe
}
types.IBrowserMessagePortLike = type(
  'Original browser MessagePort structural surface with explicit start/close and optional raw physical observation.',
  '原浏览器消息端口结构表面，含显式启动关闭及可选原物理观察。',
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
  '原节点事件发射器消息端口结构表面，核心借用原生资源而不导入节点类型。',
  Object.fromEntries(['postMessage', 'on', 'off'].map((k) => [k, nativePortMembers[k]])),
  nodeExample
)
types.IWebWorkerLikePort = type(
  'Original Worker/MessagePort event-listener surface; mutable onmessage ownership is never required.',
  '原工作者或消息端口事件监听表面，不要求可变消息处理槽所有权。',
  Object.fromEntries(
    ['postMessage', 'addEventListener', 'removeEventListener'].map((k) => [k, nativePortMembers[k]])
  ),
  workerExample
)
types.IWebWorkerPortEvent = type(
  'Original native event fields read once at the adapter boundary; getter failure is reported as transport failure.',
  '适配器边界读取一次的原生事件字段，读取器失败作为载体失败上报。',
  {
    data: p('Original native event message payload, when present.', '存在时的原生事件消息载荷。'),
    origin: p(
      'Original untrusted event origin before string classification.',
      '字符串分类前的原不可信事件来源域。'
    ),
    source: p('Original native event source reference.', '保留原对象身份的原生事件来源引用。'),
    type: p('Original native event classification when supplied.', '提供时的原生事件分类。')
  },
  workerExample
)
types.IBrowserMessagePortTransportOptions = type(
  'Explicit cleanup ownership of the exact browser port supplied to its adapter.',
  '传给适配器的精确浏览器端口的显式清理所有权。',
  {
    ownership: {
      ...p(
        'Owned closes the native port; borrowed only removes this wrapper registrations.',
        '拥有时关闭原生端口，借用时只移除此包装登记。',
        t('owned: wrapper closes the original native port.', '默认拥有，包装会关闭原原生端口。')
      ),
      values: { enum: 'RpcTransportOwnership' }
    }
  },
  browserExample
)
types.IWebWorkerTransportOptions = type(
  'Static dedicated-channel presentation and explicit capability agreement; both deployment ends must use the same actual capabilities.',
  '静态专用通道展示及显式能力约定，两端部署须使用相同实际能力。',
  {
    capabilities: p(
      'Application static capability list agreed on both actual deployment ends; never inferred from metadata labels.',
      '应用在实际部署两端约定的静态能力列表，不从元数据标签推断。',
      t('Canonical batch@1 capability is enabled.', '默认启用规范批次第一版能力。')
    ),
    peerId: p(
      'Optional actual peer identifier issued by this known dedicated deployment owner.',
      '此已知专用部署所有者签发的可选实际对端标识。',
      t('Absent: no explicit peer label.', '默认没有显式对端标签。')
    ),
    origin: p(
      'Optional actual origin label supplied by the dedicated deployment owner.',
      '专用部署所有者提供的可选实际来源域标签。',
      t('Absent: no configured origin label.', '默认没有配置来源域标签。')
    )
  },
  workerExample
)
for (const [name, en, zh, example, option] of [
  [
    'createBrowserMessagePortTransport',
    'Wraps an original browser MessagePort with lazy native listeners, generation-bound observation and explicit physical cleanup ownership.',
    '以延迟原生监听、代次绑定观察及显式物理清理所有权包装原浏览器消息端口。',
    browserExample,
    'IBrowserMessagePortTransportOptions'
  ],
  [
    'createNodeMessagePortTransport',
    'Wraps an original Node MessagePort as a borrowed exclusive carrier; close only retires observation, so callers still close their native ports.',
    '把原节点消息端口包装为借用独占载体，关闭只退役观察，调用方仍须关闭原生端口。',
    nodeExample,
    undefined
  ],
  [
    'createWebWorkerTransport',
    'Wraps original Worker-like event I/O as a borrowed exclusive carrier; script/clone/read failures use transport errors, and cleanup never terminates the Worker.',
    '把原工作者事件读写包装为借用独占载体，脚本、克隆及读取失败交载体错误，清理不会终止工作者。',
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
        '应用消息通道、工作者启动器或实际运行资源创建的原原生端口。'
      )
    },
    ...(option ? { options: option } : {}),
    returns: t(
      'IRpcTransport retaining the actual carrier and native failures; endpoint composition does not acquire capabilities from copied labels.',
      '返回保留实际载体及原生失败的传输对象，端点组合不从复制标签取得能力。'
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
        '端点使用此原物理读写，由显式所有权决定清理。'
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
    '应用部署启动器签发的物理输入，选择此定义的启动操作。',
    t('Absent: no launch source.', '默认没有启动来源。')
  ),
  connect: p(
    'Application physical input issued by its connection owner; selects this definition open/dial operation.',
    '应用连接所有者签发的物理输入，选择此定义打开或拨号操作。',
    t('Absent: no connect source.', '默认没有连接来源。')
  ),
  listen: p(
    'Application physical input issued by its listener owner; selects this definition listening operation.',
    '应用监听所有者签发的物理输入，选择此定义监听操作。',
    t('Absent: no listener source.', '默认没有监听来源。')
  ),
  peerId: p(
    'Actual remote identifier learned by the deployment owner; message adapters may learn it through their original initial exchange.',
    '部署所有者获知的实际远端标识，消息适配器可通过原初始交换获知。',
    t(
      'Absent: message exchange may learn the address; byte construction requires its actual address.',
      '默认由消息交换获知地址，字节构造要求实际地址。'
    )
  ),
  signal: p(
    'Application cancellation signal retires physical opening and the original directory handshake.',
    '应用取消信号退役物理打开及原目录握手。',
    t('Absent: no caller cancellation.', '默认没有调用方取消。')
  ),
  scheduler: p(
    'Application monotonic IScheduler shared by the original connection owners.',
    '原连接所有者共用的应用单调调度器。',
    t('systemScheduler uses native time and timers.', '默认使用原生时间及计时器。')
  ),
  offer: p(
    'Local rpc-contract IRpcHandshakeOffer proposal; received I/O determines accepted capabilities.',
    '本地握手提议，接收读写决定认可能力。',
    t('Absent: Core compiles its canonical local offer.', '默认核心编译规范本地提议。')
  ),
  auth: p(
    'Actual responder verifier configuration; required mode receives portable credentials and admitted peer, returns principal string or void synchronously/asynchronously. Throws reject authentication.',
    '实际响应方验证配置，必需模式接收可移植凭证及已准入对端，同步或异步返回主体字符串或空值，抛错拒绝认证。',
    t('Absent: no explicit responder verifier.', '默认没有显式响应方验证器。')
  ),
  ipc: p(
    'Actual connection/session diagnostic labels, capacities and local log sink chosen by the physical owner.',
    '物理所有者选择的实际连接会话诊断标签、容量及本地日志接收器。',
    t('Absent: original Core connection defaults apply.', '默认应用原核心连接默认值。')
  ),
  governor: p(
    'Actual original connection policy for call-rate, payload, repeated-timeout, idle and violation limits; it borrows original provider admission.',
    '实际原连接策略，含调用速率、载荷、连续超时、空闲及违规限制，借用原提供方准入。',
    t('Absent: no extra connection governor.', '默认没有额外连接治理。')
  ),
  scope: p(
    'Genuine scope returned by this adapter scope method; borrowed across peers and closed by its caller after peers close.',
    '此适配器作用域方法返回的真实作用域，跨对端借用，由调用方在对端关闭后关闭。',
    t('Absent: no caller-shared provider scope.', '默认没有调用方共享提供方作用域。')
  )
}
types.IAdapterDefinitionPeerOptions = type(
  'Exactly one deployment source selects original raw opening; common runtime peer policy remains owned by the canonical remote layer.',
  '精确一个部署来源选择原始打开，共同运行对端策略仍由规范远端层拥有。',
  adapterPeerOptions,
  adapterExample
)
types.IAdapterDefinitionPluginOptions = type(
  'Original host plugin name/projection policy and raw deployment input share the same canonical runtime peer construction.',
  '原宿主插件名称投影策略及原部署输入共用同一规范运行对端构造。',
  { ...adapterPeerOptions, ...runtimePluginOptionMembers },
  adapterExample
)
types.IMessageAdapterOptions = type(
  'Raw messaging recipe supplies actual operations only; Core owns identity exchange, accepted capabilities and endpoint construction.',
  '原消息配方只提供实际操作，核心拥有身份交换、认可能力及端点构造。',
  {
    open: m(
      'Opens the original raw messaging resource for one deployment input; rejects propagate through canonical construction cleanup.',
      '为一个部署输入打开原始消息资源，拒绝经规范构造清理传播。',
      {
        input: t(
          'Actual physical input supplied by the application connect/listen deployment choice.',
          '应用连接或监听部署选择提供的实际物理输入。'
        )
      },
      t(
        'Original IMessageAdapterPort synchronously or asynchronously; no fabricated transport recipe is accepted.',
        '同步或异步返回原始消息端口，不接受伪造载体配方。'
      ),
      adapterExample
    ),
    launch: {
      ...m(
        'Launches the actual native resource and returns its real exit/termination operations.',
        '启动实际原生资源并返回真实退出及终止操作。',
        {
          input: t(
            'Actual application launch input selected by spawn.',
            '启动来源选择的实际应用启动输入。'
          ),
          context: t(
            'Original runtime source context containing configured self and local capability offer.',
            '包含配置自身身份及本地能力提议的原运行来源上下文。'
          )
        },
        t(
          'Promise of IMessageAdapterLaunch; rejection fails original peer construction.',
          '返回原消息启动句柄承诺，拒绝使原对端构造失败。'
        ),
        adapterExample
      ),
      default: t('Absent: spawn is unavailable for this recipe.', '默认此配方不能启动。')
    }
  },
  adapterExample
)
types.IMessageAdapterLaunch = type(
  'Actual launch resource includes its original messaging port, exit Promise and native termination request.',
  '实际启动资源包含原消息端口、退出承诺及原生终止请求。',
  {
    port: p(
      'Original raw messaging port returned by the actual launcher.',
      '实际启动器返回的原始消息端口。'
    ),
    exited: p(
      'Actual native exit observation; requesting terminate does not settle it by assertion.',
      '实际原生退出观察，发出终止请求不会凭声明结算。'
    ),
    failed: p(
      'Optional original native failure observation before eventual exit.',
      '最终退出前可选原原生失败观察。'
    ),
    initialMessage: p(
      'Original initial launch message supplied by this actual launcher.',
      '此实际启动器提供的原初始启动消息。'
    ),
    terminate: m(
      'Requests actual native termination without claiming observed exit.',
      '请求实际原生终止，不宣称已观察退出。',
      {},
      t(
        'Termination request is issued; await exited for actual completion.',
        '终止请求已发出，实际完成须等待退出观察。'
      ),
      adapterExample
    )
  },
  adapterExample
)
types.IMessageAdapterPort = type(
  'Original EventEmitter or EventTarget raw messaging operations; this structural input alone grants no accepted runtime channel identity.',
  '原事件发射器或事件目标原始消息操作，此结构输入本身不赋予认可运行通道身份。',
  {
    ...nativePortMembers,
    listenerCount: m(
      'Reports actual native message listener count when the raw EventEmitter supports it.',
      '原事件发射器支持时报告实际原生消息监听数量。',
      { event: t('The original message event name.', '原消息事件名称。') },
      t('Actual native listener count.', '返回实际原生监听数量。'),
      adapterExample
    ),
    once: m(
      'Registers an actual one-shot close observation on the native resource.',
      '在原生资源登记实际一次性关闭观察。',
      {
        event: t('The original native close event name.', '原原生关闭事件名称。'),
        listener: t(
          'Application zero-argument synchronous close callback returning void.',
          '应用无参同步关闭回调，返回空值。'
        )
      },
      t('Native registration result is not consumed by Core.', '核心不消费原生登记结果。'),
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
        '应用连接或监听部署选项选择的实际物理输入。'
      )
    },
    t(
      'Original ordered byte I/O with kind byte, async write, data/close subscriptions and actual close; Core owns wire control.',
      '返回含字节类别、异步写入、数据关闭订阅及实际关闭的原有序字节读写，核心拥有线路控制。'
    ),
    byteExample
  )
types.IByteAdapterOptions = type(
  'Raw ordered-byte recipe delegates opening to the application and retains all wire handshake, authentication and protocol control in Core.',
  '原有序字节配方把打开交给应用，全部线路握手、认证及协议控制仍在核心。',
  {
    open: byteOpen(
      'Opens original physical ordered-byte I/O; an async rejection fails construction.',
      '打开原物理有序字节读写，异步拒绝使构造失败。'
    ),
    listen: {
      ...byteOpen(
        'Opens an actual accepted listening byte connection, without supplying a fabricated runtime agreement.',
        '打开实际接受的监听字节连接，不提供伪造运行约定。'
      ),
      default: t(
        'Absent: use open for the original listening input.',
        '默认对原监听输入使用打开操作。'
      )
    },
    dial: {
      ...byteOpen(
        'Opens an actual dialed byte connection while retaining the original byte owner.',
        '打开实际拨号字节连接，保留原字节所有者。'
      ),
      default: t(
        'Absent: use open for the original connecting input.',
        '默认对原连接输入使用打开操作。'
      )
    },
    diagnostics: p(
      'Optional adapter-owned canonical error source/code/message records and text for actual byte failures.',
      '可选适配器拥有的规范错误来源、码、消息及实际字节失败文本。',
      t('Absent: Core canonical byte diagnostics.', '默认使用核心规范字节诊断。')
    ),
    'presentation.platform': p(
      'Actual platform label selected by the byte adapter author; presentation grants no provenance.',
      '字节适配作者选择的实际平台标签，展示不赋予来源身份。'
    ),
    'presentation.expectedStringText': p(
      'Adapter-owned canonical diagnostic text for an unsupported non-string semantic carrier.',
      '适配器拥有的规范诊断文本，用于不受支持的非字符串语义载体。'
    ),
    presentation: p(
      'Optional platform label and expected-string diagnostic text; presentation cannot establish channel provenance.',
      '可选平台标签及预期字符串诊断文本，展示不能建立通道来源身份。',
      t('Absent: Core process presentation defaults.', '默认使用核心进程展示。')
    )
  },
  byteExample
)
types.IAdapterDefinition = type(
  'Genuine raw-I/O recipe handle creates canonical peers, host plugins and provider scopes; copied methods cannot select a different recipe.',
  '真实原始读写配方句柄创建规范对端、宿主插件及提供方作用域，复制方法不能选择不同配方。',
  {
    peer: m(
      'Constructs the canonical runtime peer from exactly one original physical deployment source.',
      '从精确一个原物理部署来源构造规范运行对端。',
      {
        options: t(
          'Application IAdapterDefinitionPeerOptions retaining original raw input and runtime policy.',
          '应用提供保留原始输入及运行策略的适配器对端选项。'
        )
      },
      t(
        'Promise of IRuntimePeer or typed peer; construction rollback retains original primary failure.',
        '返回运行对端或类型对端承诺，构造回滚保留原主要失败。'
      ),
      adapterExample
    ),
    plugin: m(
      'Creates a genuine Host plugin using the same actual raw recipe and runtime method whitelist.',
      '使用同一实际原始配方及运行方法白名单创建真实宿主插件。',
      {
        options: t(
          'Application plugin name, provide/expose and exactly one raw deployment source.',
          '应用插件名称、提供公开配置及精确一个原始部署来源。'
        )
      },
      t(
        'Canonical runtime plugin definition with the actual process/thread slot family.',
        '返回带实际进程或线程槽族的规范运行插件定义。'
      ),
      adapterExample
    ),
    scope: m(
      'Creates a genuine shared provider admission/store scope; callers own its final close after every borrowing peer closes.',
      '创建真实共享提供方准入及存储作用域，调用方在全部借用对端关闭后拥有最终关闭。',
      {
        store: t(
          'Optional actual IRpcIdempotencyStore returned by createRpcIdempotencyStore or application implementation.',
          '可选实际幂等存储，由幂等存储工厂或应用实现提供。'
        )
      },
      t(
        'Scope exposes generated namespace, original admission, session(channel, limits) and idempotent close(); only real constructed channels may create sessions.',
        '返回作用域，含生成命名空间、原准入、会话及幂等关闭，只有真实构造通道可以创建会话。'
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
    '定义一个真实原消息适配配方，对端及插件操作复用原核心组装，不接受预构造可信通道。'
  ],
  [
    'defineByteAdapter',
    'IByteAdapterOptions',
    byteExample,
    'Defines one genuine ordered-byte adapter recipe; the existing Core owner performs handshake, authentication, framing and endpoint assembly.',
    '定义一个真实有序字节适配配方，由现有核心所有者执行握手、认证、分帧及端点组装。'
  ]
] as const) {
  symbols[name] = {
    role: 'enhancer',
    purpose: t(en, zh),
    options: option,
    returns: t(
      'Frozen genuine IAdapterDefinition retaining the exact original physical operations.',
      '返回冻结真实适配器定义，保留精确原物理操作。'
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
        '实际物理读写选择核心构造，元数据不赋予认可能力权限。'
      )
    ],
    scenarios: [
      t(
        'Bind an existing native raw resource to canonical runtime peers.',
        '把现有原生原始资源绑定到规范运行对端。'
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
        'Author raw physical message/byte bindings with defineMessageAdapter or defineByteAdapter; Core retains protocol and runtime peer ownership.',
        '通过消息或字节适配定义编写原物理绑定，核心保留协议及运行对端所有权。'
      ),
      example: adapterExample
    },
    'adapters/memory': {
      summary: t(
        'Start with createMemoryTransportPair for same-process queued carriers sharing value identity; close the original pair explicitly.',
        '从内存载体对开始，在同进程排队交付并共享值身份，显式关闭原载体对。'
      ),
      example: memoryExample
    },
    'adapters/message-port': {
      summary: t(
        'Wrap actual browser or Node MessagePorts with their distinct physical cleanup ownership; start with the matching transport factory.',
        '按不同物理清理所有权包装实际浏览器或节点消息端口，从对应载体工厂开始。'
      ),
      example: browserExample
    },
    'adapters/web-worker': {
      summary: t(
        'Wrap existing Worker-like event ports through createWebWorkerTransport without taking onmessage or terminating borrowed native resources.',
        '通过工作者载体工厂包装现有事件端口，不占用消息处理槽，也不终止借用原生资源。'
      ),
      example: workerExample
    }
  },
  symbols,
  types,
  enums: {},
  enhancers
}
