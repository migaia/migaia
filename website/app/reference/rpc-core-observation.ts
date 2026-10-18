/** Probe, flow-control and listener documentation checked against their canonical Core owners. */
import type {
  ILibraryReference,
  IMemberDoc,
  ITypeDoc,
  ISymbolDoc,
  IEnumDoc,
  IEnhancerDoc
} from './contract.js'
/** Every persisted sentence has an explicit translation. */
const t = (en: string, zh: string) => ({ en, zh })
/** Properties describe observable data and omission semantics. */
const p = (en: string, zh: string, fallback?: ReturnType<typeof t>): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Method documentation closes callback, return and example nodes together. */
const m = (
  en: string,
  zh: string,
  params: NonNullable<IMemberDoc['params']>,
  returns: ReturnType<typeof t>,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Observation owns no endpoint construction or independent transport execution. */
const symbols: Record<string, ISymbolDoc> = {}
/** Public observation and flow-control records. */
const types: Record<string, ITypeDoc> = {}
/** Numeric hot-path domains and local diagnostic domains. */
const enums: Record<string, IEnumDoc> = {}
/** Installation uses existing endpoint feature and middleware slots. */
const enhancers: Record<string, IEnhancerDoc> = {}
/** Captured views are copied during their synchronous validity window. */
const probeExample = `import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { defineProbe, probePlugin, snapshotProbeEvent, readProbeStages, subscribeProbeStages } from '@migaia/rpc-core/probe'
const snapshots: unknown[] = []
const probe = defineProbe({ stages: ['message'], emit(view) { snapshots.push(snapshotProbeEvent(view)) } })
const off = subscribeProbeStages(probe, () => console.log(readProbeStages(probe)))
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })
server.provide('echo', (context) => context.success(context.data))
const client = await createEndpoint({ id: 'client', transport: left, targetIds: ['server'], middlewares: [connect({ transport: left }), probePlugin(probe)] })
try { await client.send('server', 'echo', 'hello'); probe.setStages([]) }
finally { off(); await client.dispose(); await server.dispose(); left.close() }`
/** Flow control requires the same original gate on the feature and physical wrapper. */
const queueExample = `import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { createIpcSendQueueFeature, createIpcSendQueueTransport } from '@migaia/rpc-core/plugins/send-queue'
import { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'
const [left, right] = createMemoryTransportPair()
const queue = createIpcSendQueueFeature({ connectionId: 'app-connection-1' })
const transport = createIpcSendQueueTransport(left, queue.gate)
const log = createIpcLogFeature({ gate: queue.gate, report: (record) => console.log(record), onReportError: (error) => console.error(error) })
const server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })
server.provide('echo', (context) => context.success(context.data))
const client = await createEndpoint({ id: 'client', transport, targetIds: ['server'], features: [queue.feature, log.feature], middlewares: [connect({ transport })] })
try { console.log(await client.send('server', 'echo', 'hello')); await queue.gate.whenIdle() }
finally { await client.dispose(); await server.dispose(); left.close() }`
/** Repeated schemas keep a concrete scenario and complete ownership example. */
const type = (
  en: string,
  zh: string,
  members: Record<string, IMemberDoc>,
  example = probeExample
): ITypeDoc => ({
  summary: t(en, zh),
  members,
  scenarios: [
    t(
      'Observe the existing owner without changing its business settlement or resource lifetime.',
      '观察现有所有者，不改变业务结算或资源生命周期。'
    )
  ],
  example
})
/** Domain values describe meanings independently of numeric representation. */
function domain(
  name: string,
  en: string,
  zh: string,
  entries: readonly (readonly [string, string, string])[]
): void {
  const values = Object.fromEntries(entries.map(([key, a, b]) => [key, t(a, b)]))
  enums[name] = { summary: t(en, zh), values }
  symbols[name] = { role: 'constant', purpose: t(en, zh), example: probeExample }
}
domain(
  'RpcProbeStage',
  'Stable numeric stages follow one operation from logical ownership to actual physical I/O.',
  '稳定数字阶段跟随一次操作，从逻辑所有权到实际物理读写。',
  [
    [
      'peer',
      'Peer lifecycle and local settlement observations.',
      '对端生命周期及本地结算的观察阶段。'
    ],
    [
      'message',
      'Logical application request or response observation.',
      '应用逻辑请求或响应的观察阶段。'
    ],
    [
      'envelope',
      'Normalized protocol envelope observation before encoding.',
      '编码之前规范协议信封的观察阶段。'
    ],
    [
      'encoded',
      'Encoded semantic payload observation before framing.',
      '分帧之前已编码语义载荷的观察阶段。'
    ],
    ['frame', 'Physical frame observation before protection.', '保护之前物理分帧结果的观察阶段。'],
    [
      'protected',
      'Protected carrier observation after signing or encryption.',
      '签名或加密之后受保护载体的观察阶段。'
    ],
    [
      'carrier',
      'Actual adapter send/receive observation at physical I/O.',
      '物理读写中实际适配器发送接收的观察阶段。'
    ]
  ]
)
domain(
  'RpcProbeDirection',
  'Numeric traffic directions distinguish original outbound, inbound and local observations.',
  '数字流量方向区分原出站、入站及端点本地生命周期观察。',
  [
    [
      'outbound',
      'The original endpoint is sending toward its peer.',
      '原端点正在向实际对端发送流量。'
    ],
    [
      'inbound',
      'The original endpoint is receiving from its peer.',
      '原端点正在从实际对端接收流量。'
    ],
    [
      'local',
      'The event concerns local lifecycle or settlement only.',
      '该事件只涉及本地生命周期或结算。'
    ]
  ]
)
domain(
  'RpcProbeKind',
  'Numeric interaction kinds identify which original operation an event concerns.',
  '数字交互种类标识事件涉及的原始请求、流及控制操作。',
  [
    [
      'request',
      'A correlated application request enters the owner.',
      '关联应用请求进入原所有者的处理路径。'
    ],
    [
      'response',
      'A scalar result replies to an original request.',
      '标量结果响应一个原始关联请求。'
    ],
    [
      'notify',
      'A one-way application notification has no result wait.',
      '单向应用通知不建立业务结果等待。'
    ],
    [
      'streamOpen',
      'A streaming interaction opens its original lifetime.',
      '流式交互打开自身原始生命周期。'
    ],
    ['streamChunk', 'One item belongs to the original stream.', '一个条目属于已经打开的原始流。'],
    ['streamClose', 'The original stream ends, fails or closes.', '原始流正常结束、失败或被关闭。'],
    [
      'cancel',
      'A cancellation observation concerns admitted work.',
      '取消观察涉及已经准入的工作。'
    ],
    [
      'control',
      'A protocol control observation carries no new business call.',
      '协议控制观察不产生新的业务调用。'
    ],
    [
      'lifecycle',
      'The event describes local lifecycle transitions.',
      '该事件描述本地生命周期状态变化。'
    ]
  ]
)
domain(
  'RpcProbeOutcome',
  'Numeric outcomes describe progress, admission and settlement at the observed stage.',
  '数字结果描述实际观察阶段中的操作进度、准入及最终结算。',
  [
    [
      'none',
      'No specific progress result applies to this event.',
      '此事件不适用更具体的进度结果。'
    ],
    [
      'created',
      'The original owner created the observed operation.',
      '原所有者已经创建被观察的操作。'
    ],
    ['sent', 'The owning send boundary completed successfully.', '所属发送边界已经成功完成发送。'],
    [
      'received',
      'The observing owner received the original value.',
      '观察所有者已经收到原始输入值。'
    ],
    [
      'admitted',
      'The original operation passed its admission checks.',
      '原始操作已经通过自身准入检查。'
    ],
    [
      'rejected',
      'The original operation failed its admission checks.',
      '原始操作未能通过自身准入检查。'
    ],
    [
      'settled',
      'The original operation completed its settlement.',
      '原始操作已经完成自身结算过程。'
    ],
    [
      'failed',
      'The observed original boundary completed with failure.',
      '被观察的原始边界已经失败结束。'
    ]
  ]
)
for (const base of ['RpcProbeStage', 'RpcProbeDirection', 'RpcProbeKind', 'RpcProbeOutcome'])
  symbols[base + 'Name'] = {
    role: 'constant',
    purpose: t(
      'Frozen ordinal-to-name table aligned with ' +
        base +
        '; use it to format diagnostics, retaining the original numeric dispatch values.',
      '与对应数字域对齐的冻结序号名称表，用于格式化诊断，同时保留原始数字派发值。'
    ),
    example: `console.log(${base}Name[0])`
  }
symbols.IpcReporterContext = {
  role: 'constant',
  purpose: t(
    'Frozen utils reporter classification with operation limiter and phase reporter; use it only for secondary IPC observer failures.',
    '冻结的工具上报分类，操作为限制器、阶段为上报者，只用于次级进程通信观察失败。'
  ),
  example: 'hostRethrowReporter(error, IpcReporterContext)'
}
enums.IpcReporterContext = {
  summary: symbols.IpcReporterContext.purpose,
  values: {
    operation: t(
      'limiter identifies the existing concurrency-limiter diagnostic owner.',
      '限制器值标识现有并发限制诊断所有者。'
    ),
    phase: t(
      'reporter identifies a failure in the observer failure sink itself.',
      '上报阶段值表示观察者失败接收器自身发生失败。'
    )
  }
}
symbols.hostRethrowReporter = {
  role: 'operation',
  purpose: t(
    'Canonical @migaia/utils/promise reporter preserves an unhandled diagnostic failure at the host reporting boundary; it does not convert it into an RPC result.',
    '规范工具包上报函数把未处理诊断失败交给宿主上报边界，不把失败转换为远程调用结果。'
  ),
  params: {
    error: t(
      'The original observed reporter failure, preserving its identity.',
      '保留身份的原始已观察上报失败。'
    ),
    context: t(
      'Actual utils reporter context; IPC observations use IpcReporterContext.',
      '实际工具上报上下文，进程通信观察使用其规范分类对象。'
    )
  },
  returns: t(
    'Reports to the native host; no business result is returned.',
    '交给原生宿主上报，不返回业务结果。'
  ),
  example: 'hostRethrowReporter(error, IpcReporterContext)'
}
/** Probe callbacks are synchronous; retained views require an explicit snapshot. */
const definition: Record<string, IMemberDoc> = {
  stages: p(
    'Application-selected nonempty stage-name array from RpcProbeStageName; duplicates compile to one bit.',
    '应用从规范阶段名称表选择的非空数组，重复名称编译为同一位。'
  ),
  capture: p(
    'Application-selected subset of initial stages whose content may be captured after redaction; later setStages cannot enlarge this immutable permission.',
    '应用选择的初始阶段子集，允许脱敏后捕获内容，后续修改阶段不能扩大此不可变权限。',
    t('Absent: no content capture.', '默认不捕获内容。')
  ),
  methods: p(
    'Application method-name filter for method-bearing logical/envelope observations; methodless controls remain visible.',
    '应用方法名过滤器作用于含方法的逻辑及信封观察，无方法控制仍可见。',
    t('Absent: all methods remain eligible.', '默认所有方法均可被观察。')
  ),
  sample: p(
    'Application probability strictly greater than zero and at most one; deterministic sender/message correlation selects matching events.',
    '应用采样概率须大于零且不大于一，确定性发送及消息关联选择匹配事件。',
    t('1: retain every eligible event.', '默认一，保留所有符合条件的事件。')
  ),
  redact: {
    ...m(
      'Synchronous application transform receives numeric stage and original content; return only the redacted value safe to expose. A throw is sent to onError and contained.',
      '应用同步转换接收数字阶段及原内容，只返回可以公开的脱敏值；抛错交错误观察并被隔离。',
      {
        stage: t(
          'Actual RpcProbeStage ordinal supplied by the emitter.',
          '发射器提供的实际阶段序号。'
        ),
        content: t(
          'Original owner value before exposure; never mutate or retain it without ownership.',
          '公开之前的原所有者值，未拥有时不得修改或保留。'
        )
      },
      t(
        'The synchronous redacted capture value; no Promise is awaited.',
        '返回同步脱敏捕获值，不等待承诺。'
      ),
      probeExample
    ),
    default: t(
      'Absent: selected captures expose the original content reference.',
      '默认选定捕获公开原内容引用。'
    )
  },
  describe: {
    ...m(
      'Receives the cold actual endpoint capability descriptor at installation; synchronous observer throws are contained through onError.',
      '安装时接收实际端点能力冷描述，同步观察者抛错经错误观察隔离。',
      {
        descriptor: t(
          'Actual owner descriptor; unsupported stages cannot be created by subscription.',
          '实际所有者描述，订阅不能创建不受支持阶段。'
        )
      },
      t(
        'Descriptor notification completes synchronously; no return is consumed.',
        '同步完成描述通知，不消费返回值。'
      ),
      probeExample
    ),
    default: t('Absent: no descriptor callback.', '默认没有描述回调。')
  },
  emit: m(
    'Receives a reused mutable view valid only during this synchronous callback; snapshot before retaining. Throws are isolated through onError.',
    '接收只在本次同步回调期间有效的复用可变视图，保留前须快照；抛错经错误观察隔离。',
    {
      view: t(
        'Emitter-owned IRpcProbeEventView with current event fields.',
        '发射器拥有并填入当前事件字段的观察视图。'
      )
    },
    t(
      'Observation completes synchronously; returned thenable rejections are observed, but a retained view still needs a synchronous snapshot.',
      '同步完成观察，返回类承诺的拒绝仍被观察，但保留视图仍须同步快照。'
    ),
    probeExample
  ),
  onError: {
    ...m(
      'Receives a coded PROBE_FAILED wrapper retaining the original callback failure as cause; a secondary throw is forwarded to hostRethrowReporter without changing business settlement.',
      '接收带探针失败码的包装错误并在原因中保留原回调失败，次级抛错交宿主规范上报，不改变业务结算。',
      {
        error: t(
          'Core PROBE_FAILED error whose cause is the original observer failure.',
          '核心探针失败错误，其原因保留原观察者失败。'
        )
      },
      t(
        'Completes diagnostic handling without a business result.',
        '完成诊断处理，不产生业务结果。'
      ),
      probeExample
    ),
    default: t(
      'Absent: canonical host reporting receives observer failures.',
      '默认由规范宿主上报处理观察失败。'
    )
  }
}
types.IRpcProbeDefinition = type(
  'Application definition captured and compiled once; the original callbacks do not become mutable host configuration.',
  '一次捕获及编译的应用定义，原回调不会变成可变宿主配置。',
  definition
)
types.IRpcProbe = type(
  'Frozen genuine compiled handle created by defineProbe; setStages changes private active subscription state without mutating capture permission.',
  '由定义工厂创建的冻结真实编译句柄，阶段更新只改变私有活动订阅状态，不改变捕获权限。',
  {
    stageMask: p(
      'Current compiled subscription mask on standalone handles; attached frozen hosts retain their initial data field. Use readProbeStages for either form.',
      '独立句柄显示当前编译订阅掩码，附加冻结宿主保留初始数据字段，两种形式均可用读取函数取得当前值。'
    ),
    captureMask: p(
      'Immutable content-capture permission compiled at definition time.',
      '定义时编译的不可变内容捕获权限。'
    ),
    methods: p(
      'Captured readonly method filter Set or undefined when unfiltered.',
      '捕获的只读方法过滤集合，未过滤时没有值。'
    ),
    sampleThreshold: p(
      'Unsigned correlation threshold; 0xffffffff selects every eligible event.',
      '无符号关联阈值，最大无符号整数选择全部合格事件。'
    ),
    setStages: m(
      'Atomically replaces active stage bits; an empty array pauses observation. Invalid names throw INVALID_CONFIG and retain the previous mask.',
      '原子替换活动阶段位，空数组暂停观察，非法名称抛配置非法错误并保留原掩码。',
      {
        stages: t(
          'Application array of names from RpcProbeStageName; empty is allowed for updates.',
          '应用提供规范阶段名称数组，更新时允许为空。'
        )
      },
      t(
        'All changed subscriptions are notified synchronously even if one throws, so emitters adopt the committed mask. Callback failures gain CALLBACK_FAILED unless already classified; unchanged masks send no notification.',
        '同步通知全部改变的订阅，某项抛错不阻断其它项采用已提交掩码；未分类回调失败附加 `CALLBACK_FAILED`，掩码不变时不通知。'
      ),
      probeExample
    )
  }
)
types.IRpcProbeDescriptor = type(
  'Cold description of the actual installed endpoint; subscriptions never manufacture unavailable capabilities.',
  '实际已安装端点的冷描述，订阅不会制造不可用能力。',
  {
    endpointId: p(
      'Identifier issued by the endpoint configuration whose emitter created this descriptor.',
      '创建此描述的发射器所属端点配置签发的标识。'
    ),
    platform: p(
      'Actual adapter platform label; presentation alone grants no authority.',
      '实际适配器平台标签，展示信息不赋予权限。'
    ),
    topology: p(
      'Actual transport topology when the adapter supplies it.',
      '适配器提供时的实际载体拓扑。'
    ),
    encodedType: p(
      'Actual encoded carrier domain reported by the owner.',
      '所有者报告的实际编码载体值域。'
    ),
    authentication: {
      ...p(
        'Installed protection profile derived from actual middleware.',
        '从实际中间件派生的已安装保护配置。'
      ),
      values: {
        none: t('No signing or encryption middleware is installed.', '未安装签名或加密中间件。'),
        sign: t('Signing and verification protect actual frames.', '签名及验证保护实际物理帧。'),
        'encrypt-sign': t(
          'Encryption and signing protect actual frames together.',
          '加密及签名共同保护实际物理帧。'
        )
      }
    },
    fastPath: p(
      'Whether the real endpoint selected its compatible direct execution path.',
      '实际端点是否选择了兼容直接执行路径。'
    ),
    carrier: {
      ...p(
        'Actual carrier label or unavailable when physical observation is unsupported.',
        '实际载体标签，不支持物理观察时表示不可用。'
      ),
      values: {
        unavailable: t(
          'The adapter has no physical observation capability.',
          '适配器没有物理观察能力。'
        )
      }
    },
    stageMask: p(
      'Actual emitter-supported stage bits, intersected with subscriptions at dispatch.',
      '实际发射器支持阶段位，派发时与订阅求交。'
    )
  }
)
/** Event fields preserve actual attribution and explicit unavailable sentinels. */
const eventFields: Record<string, IMemberDoc> = {
  seq: p(
    'Emitter-issued increasing sequence within the original endpoint emitter.',
    '原端点发射器内部签发的递增序号。'
  ),
  carrierSeq: p(
    'Original inbound physical sequence; -1 means no physical link.',
    '原入站物理序号，负一表示没有物理关联。'
  ),
  at: p(
    'Monotonic observation timestamp in milliseconds from the endpoint scheduler.',
    '来自端点调度器的单调观察毫秒时间戳。'
  ),
  endpointId: types.IRpcProbeDescriptor.members.endpointId,
  stage: p(
    'RpcProbeStage numeric ordinal for the current actual boundary.',
    '当前实际边界对应的数字阶段序号。'
  ),
  direction: p(
    'RpcProbeDirection numeric ordinal for inbound, outbound or local traffic.',
    '入站、出站或本地流量对应的数字方向序号。'
  ),
  kind: p(
    'RpcProbeKind numeric ordinal for the observed interaction.',
    '被观察交互对应的数字种类序号。'
  ),
  outcome: p(
    'RpcProbeOutcome numeric ordinal for current progress or settlement.',
    '当前进度或结算对应的数字结果序号。'
  ),
  messageId: p(
    'Original message identifier issued by the sender, or undefined without message attribution.',
    '发送方签发的原消息标识，无消息归属时没有值。'
  ),
  method: p(
    'Original application method name when this observation has one.',
    '本次观察存在方法时的原应用方法名称。'
  ),
  variation: p(
    'Original variation-control route only on applicable message/envelope observations.',
    '只在适用逻辑或信封观察中的原变体控制路由。'
  ),
  senderId: p(
    'Original admitted sender identifier from the observed message.',
    '观察消息中原已准入发送方标识。'
  ),
  targetId: p(
    'Original application target identifier from the observed route.',
    '观察路由中原应用指定的目标标识。'
  ),
  receiverId: p(
    'Actual discovery-selected receiving instance identifier when known.',
    '已知时由实际发现选择的接收实例标识。'
  ),
  peerId: p(
    'Actual physical peer identifier attributed by the held transport.',
    '持有载体归属的实际物理对端标识。'
  ),
  trace: p(
    'Original explicitly supplied application trace when present.',
    '存在时由应用显式提供的原追踪值。'
  ),
  sizeBytes: p(
    'Observed byte size; -1 means this layer cannot determine it.',
    '观察到的字节数，负一表示此层无法确定。'
  ),
  chunkIndex: p(
    'Actual fragment index; -1 means this observation is not a fragment.',
    '实际分片索引，负一表示本次观察不是分片。'
  ),
  chunkCount: p(
    'Actual fragment count; -1 means this observation is not a fragment.',
    '实际分片数量，负一表示本次观察不是分片。'
  ),
  members: p(
    'Actual batch member count; -1 means this observation is not a batch.',
    '实际批次成员数，负一表示本次观察不是批次。'
  ),
  durationMs: p(
    'Original settlement duration; -1 means this event does not settle an operation.',
    '原结算耗时毫秒数，负一表示此事件不结算操作。'
  ),
  rejection: p(
    'Actual admission refusal reason, independent of a shared error code.',
    '实际准入拒绝原因，与共享错误码分开。'
  ),
  lifecycle: p(
    'Actual lifecycle observation label when emitted by that owner.',
    '相应所有者发出时的实际生命周期观察标签。'
  ),
  error: p(
    'Original observed failure reference; snapshotting does not clone errors.',
    '原观察失败引用，快照不会克隆错误。'
  ),
  carrier: types.IRpcProbeDescriptor.members.carrier,
  detail: p(
    'Owner-produced diagnostic scalar record; snapshots retain its original reference.',
    '所有者生成的诊断标量记录，快照保留其原引用。'
  ),
  content: p(
    'Only captured stages expose content after redaction; the reference is not deep-cloned.',
    '只有捕获阶段在脱敏后公开内容，其引用不作深克隆。'
  )
}
types.IRpcProbeEventView = type(
  'Emitter-owned reused record valid only during emit; snapshotProbeEvent makes a frozen shallow field copy.',
  '发射器拥有并复用的记录，只在回调期间有效，快照函数生成冻结浅字段副本。',
  eventFields
)
types.IRpcProbeStageName = type(
  'One exact configuration name from RpcProbeStageName; unknown strings are rejected before changing compiled state.',
  '规范阶段名称表中的精确配置名称，未知字符串在改变编译状态前被拒绝。',
  {}
)
types.IRpcCarrierProbe = type(
  'Emitter-supplied physical observation port; adapters call it for actual I/O and retain no endpoint lifecycle authority.',
  '发射器提供的物理观察端口，适配器只为实际读写调用，不拥有端点生命周期权限。',
  {
    capturing: p(
      'True only when this physical observer may include original content.',
      '只有该物理观察者可以包含原内容时为真。'
    ),
    emit: m(
      'Records actual synchronous carrier observation without changing the physical send or receive result.',
      '同步记录实际载体观察，不改变物理发送或接收结果。',
      {
        direction: t(
          'Actual RpcProbeDirection ordinal, supplied by the carrier owner.',
          '载体所有者提供的实际方向序号。'
        ),
        sizeBytes: t(
          'Measured physical byte size or -1 when unknown.',
          '实测物理字节数，未知时为负一。'
        ),
        carrier: t(
          'Physical carrier label chosen by the actual adapter.',
          '实际适配器选择的物理载体标签。'
        ),
        detail: t('Actual scalar diagnostic record, or undefined.', '实际标量诊断记录，或不提供。'),
        content: t(
          'Original physical value only if capturing is true; otherwise undefined.',
          '只在允许捕获时传原物理值，否则不提供。'
        )
      },
      t(
        'Observation is forwarded to the endpoint emitter; no operation result is returned.',
        '观察转交端点发射器，不返回操作结果。'
      ),
      probeExample
    )
  }
)
symbols.defineProbe = {
  role: 'factory',
  purpose: t(
    'Compiles a validated standalone probe, or attaches the five reserved fields to an extensible host and freezes that same host. It emits nothing until installed with probePlugin.',
    '编译已校验独立探针，或向可扩展宿主附加五个保留字段并冻结同一宿主；搭配 `probePlugin` 安装后才产生观察。'
  ),
  params: {
    definition: t(
      'Application IRpcProbeDefinition; callbacks and filters are captured once.',
      '应用提供的探针定义，回调及过滤器只捕获一次。'
    ),
    host: t(
      'Optional original extensible nonfrozen application object with none of the reserved own fields; omit this argument for a standalone handle.',
      '可选原应用对象，须可扩展、未冻结且不占用保留自有字段，独立句柄应省略此实参。'
    )
  },
  options: 'IRpcProbeDefinition',
  returns: t(
    'Genuine frozen IRpcProbe or the same frozen augmented host. Invalid definition or host throws coded TypeError INVALID_CONFIG.',
    '返回真实冻结探针或同一冻结增强宿主，定义或宿主非法时抛带配置非法码的类型错误。'
  ),
  example: probeExample
}
symbols.probePlugin = {
  role: 'enhancer',
  purpose: t(
    'Installs genuine defineProbe handles in one endpoint-owned emitter; subscriptions cannot enable unavailable physical stages, and endpoint disposal releases the emitter.',
    '把真实探针句柄安装到一个端点拥有的发射器，订阅不能启用不可用物理阶段，端点释放时释放发射器。'
  ),
  params: {
    probes: t(
      'Actual handles returned by defineProbe, passed as variadic arguments rather than copied structural objects.',
      '由探针定义工厂返回的实际句柄，以可变实参数量传入，不传复制的结构对象。'
    )
  },
  returns: t(
    'IRpcPlugin definition for the endpoint middleware tuple.',
    '返回用于端点中间件元组的插件定义。'
  ),
  example: probeExample
}
enhancers.probePlugin = {
  kind: 'middleware',
  target: 'IRpcEndpoint',
  summary: symbols.probePlugin.purpose,
  install: probeExample,
  grants: [],
  behaviors: [
    t(
      'Observes only selected actual stages; observer failures do not replace business settlement.',
      '只观察选定实际阶段，观察失败不替换业务结算。'
    )
  ],
  scenarios: [
    t(
      'Capture or export diagnostics from original RPC owners.',
      '从原远程调用所有者捕获或导出诊断。'
    )
  ],
  example: probeExample
}
symbols.snapshotProbeEvent = {
  role: 'operation',
  purpose: t(
    'Makes a frozen field snapshot while a reused event view is valid. Nested content, error and detail retain exact reference ownership and are not cloned.',
    '在复用事件视图有效时创建冻结字段快照，嵌套内容、错误及细节仍保留原引用所有权，不执行克隆。'
  ),
  params: {
    view: t(
      'Current view passed synchronously to the installed emit callback.',
      '已安装发射回调同步传入的当前视图。'
    )
  },
  returns: t(
    'Readonly IRpcProbeEventView whose top-level fields no longer change on the next emit.',
    '返回只读观察视图，下一次发射不会改变其顶层字段。'
  ),
  example: probeExample
}
symbols.readProbeStages = {
  role: 'operation',
  purpose: t(
    'Reads the current private subscription mask for genuine handles and attached frozen hosts; structural values fall back to their stageMask field.',
    '读取真实句柄及附加冻结宿主的当前私有订阅掩码，结构值回退读取其公开阶段掩码。'
  ),
  params: {
    probe: t(
      'Original defineProbe result whose current subscription is needed.',
      '需要读取当前订阅的原探针定义结果。'
    )
  },
  returns: t(
    'Current numeric stage bitmask, including later successful setStages updates.',
    '返回当前数字阶段位掩码，包含后续成功更新。'
  ),
  example: probeExample
}
symbols.subscribeProbeStages = {
  role: 'operation',
  purpose: t(
    'Registers a cold synchronous callback on a genuine probe for changed stage masks. Structural probes do not receive a private subscription.',
    '为真实探针登记阶段掩码改变时的同步冷回调，结构探针不会取得私有订阅。'
  ),
  params: {
    probe: t(
      'Original defineProbe result; only that owner has private subscriptions.',
      '原探针定义结果，只有该所有者拥有私有订阅。'
    ),
    listener: t(
      'Application zero-argument synchronous callback; return void. It runs after state changes; failures remain observable after every subscriber has received the committed mask.',
      '应用无参同步回调，返回空值，在状态改变后运行，全部订阅接收已提交掩码后仍可观察其失败。'
    )
  },
  returns: t('Idempotent release removes this callback only.', '返回幂等移除函数，只移除本回调。'),
  example: probeExample
}
symbols.rpcProbeSampleKey = {
  role: 'operation',
  purpose: t(
    'Returns deterministic unsigned FNV-1a of UTF-8 senderId plus messageId. This sampling key preserves sender/receiver correlation, not authentication or unique identity.',
    '返回发送标识加消息标识的确定性无符号散列采样键，保留发送接收关联，不提供认证或唯一身份。'
  ),
  params: {
    senderId: t(
      'Actual sender identifier from the observed route, issued by endpoint configuration.',
      '观察路由中的实际发送标识，由端点配置签发。'
    ),
    messageId: t(
      'Actual message identifier issued by the original outbound owner.',
      '原出站所有者签发的实际消息标识。'
    )
  },
  returns: t(
    'Unsigned 32-bit deterministic sampling key; malformed UTF-16 is replaced before UTF-8 hashing.',
    '返回无符号三十二位确定性采样键，非法代理码元在散列前替换。'
  ),
  example: 'console.log(rpcProbeSampleKey("client", "message-1"))'
}

domain(
  'IpcLogEventName',
  'Connection-local diagnostic event names distinguish capacity transitions, send failures and explicit process stderr.',
  '连接本地诊断事件名区分容量变化、发送失败及显式进程标准错误。',
  [
    [
      'ipc.backlog.high',
      'Accepted capacity reached or exceeded ceil(capacity * 0.75), after previously being below its high watermark.',
      '已准入容量达到或超过容量乘零点七五的向上取整值，且此前尚未处于高水位。'
    ],
    [
      'ipc.backlog.low',
      'After a high event, accepted capacity drained to or below floor(capacity * 0.5).',
      '高水位事件后，已准入容量降到容量乘零点五的向下取整值或更低。'
    ],
    [
      'ipc.backlog.rejected',
      'The corresponding whole-envelope lane refused capacity.',
      '对应完整信封通道拒绝容量准入。'
    ],
    [
      'ipc.send.failed',
      'The original physical send or diagnostic dispatch failed.',
      '原物理发送或诊断派发发生失败。'
    ],
    [
      'ipc.stderr',
      'An explicit process standard-error record is supplied locally.',
      '本地显式提供进程标准错误记录。'
    ]
  ]
)
domain(
  'IpcSendClass',
  'Whole-envelope admission reserves separate total capacities for business data and control messages.',
  '完整信封准入分别为业务数据及控制消息预留总容量。',
  [
    [
      'data',
      'Business requests, replies and stream data use the data lane.',
      '业务请求、响应及流数据使用数据通道。'
    ],
    [
      'control',
      'Cancellation, liveness and outcome control use reserved control capacity.',
      '取消、存活及结果控制使用预留控制容量。'
    ]
  ]
)
/** Queue metadata is issued by the real application connection owner. */
const queueOptions: Record<string, IMemberDoc> = {
  connectionId: p(
    'Stable local diagnostic identifier issued by the application owner of this actual physical connection.',
    '此实际物理连接的应用所有者签发的稳定本地诊断标识。'
  ),
  sessionId: p(
    'Optional local session identifier issued by that connection owner; it does not prove peer identity.',
    '该连接所有者签发的可选本地会话标识，不证明对端身份。',
    t('Absent: session attribution is omitted.', '默认省略会话归属。')
  ),
  maxPendingData: p(
    'Positive safe-integer data capacity counting running and queued whole envelopes together.',
    '正安全整数数据容量，同时统计运行及排队的完整信封。',
    t('256 total accepted data envelopes.', '默认总计二百五十六个准入数据信封。')
  ),
  maxPendingControl: p(
    'Positive safe-integer control capacity independent of data saturation.',
    '独立于数据饱和状态的正安全整数控制容量。',
    t('8 total accepted control envelopes.', '默认总计八个准入控制信封。')
  )
}
types.IIpcSendQueueOptions = type(
  'Application-owned bounds and local diagnostic labels for one original physical connection.',
  '一个原物理连接的应用容量边界及本地诊断标签。',
  queueOptions,
  queueExample
)
/** Backlog records preserve counters at the actual transition boundary. */
const backlog: Record<string, IMemberDoc> = {
  name: {
    ...p(
      'Actual local event classification from the gate or explicit stderr intake.',
      '来自门控或显式标准错误入口的实际本地事件分类。'
    ),
    values: { enum: 'IpcLogEventName' }
  },
  connectionId: queueOptions.connectionId,
  sessionId: queueOptions.sessionId,
  pendingData: p(
    'Snapshot of accepted queued plus running business envelopes.',
    '已准入排队及运行业务信封的计数快照。'
  ),
  pendingControl: p(
    'Snapshot of accepted queued plus running control envelopes.',
    '已准入排队及运行控制信封的计数快照。'
  ),
  active: {
    ...p(
      'Actual physical sender lane, or null while neither lane is sending.',
      '实际物理发送通道，无通道发送时为空。'
    ),
    values: { enum: 'IpcSendClass' }
  },
  trace: p(
    'Original application trace from the observed route when supplied.',
    '提供时来自被观察路由的原应用追踪。'
  ),
  error: p(
    'Exact original observed failure when this event reports failure.',
    '此事件报告失败时的精确原始失败。'
  )
}
types.IIpcBacklogEvent = type(
  'Frozen local capacity snapshot; no backlog diagnostic is serialized onto the RPC wire.',
  '冻结本地容量快照，容量诊断不会序列化到调用线路。',
  backlog,
  queueExample
)
types.IIpcLogRecord = type(
  'A local backlog snapshot or explicit stderr record; no business payload is inferred from diagnostic labels.',
  '本地容量快照或显式标准错误记录，诊断标签不推断业务载荷。',
  {
    ...backlog,
    processId: p(
      'Optional actual process identity issued by the native launcher.',
      '原生启动器签发的可选实际进程标识。'
    ),
    text: p(
      'Already decoded stderr text explicitly supplied by the process owner.',
      '进程所有者显式提供的已解码标准错误文本。'
    ),
    droppedChunks: p(
      'Optional number of source chunks omitted from an overflow summary.',
      '溢出摘要中被省略的可选来源块数量。'
    )
  },
  queueExample
)
types.IIpcSendAdmission = type(
  'Original outbound admission supplied by Core; it retains live cancellation without fabricating a new execution owner.',
  '核心提供的原出站准入，保留活动取消而不制造新执行所有者。',
  {
    queueSignal: p(
      'Optional canonical queued-wait cancellation signal.',
      '可选规范排队等待取消信号。'
    ),
    signals: p(
      'Original admitted cancellation signals consulted before physical send.',
      '物理发送前检查的原已准入取消信号。'
    ),
    assertCanSend: m(
      'Checks live original cancellation and throws before the queued physical send if it is no longer admissible.',
      '检查原活动取消，排队物理发送不再允许时提前抛错。',
      {},
      t('Returns only while original work may still send.', '只在原工作仍可发送时返回。'),
      queueExample
    )
  },
  queueExample
)
/** The existing Core sender calls this gate with already normalized envelopes. */
const gateMembers: Record<string, IMemberDoc> = {
  run: m(
    'Reserves the actual envelope class and serializes its physical callback; full capacity rejects OVERLOADED. New work after close rejects ENDPOINT_DISPOSED; already queued work receives the original close(reason).',
    '预留实际信封类别并串行运行物理回调，容量满时拒绝过载；关闭后新工作拒绝端点已释放错误，已有排队工作接收原关闭原因。',
    {
      envelope: t(
        'Original normalized rpc-contract envelope supplied by the outbound owner.',
        '原出站所有者提供的规范契约信封。'
      ),
      sendNow: t(
        'Original zero-argument physical send callback returns void or Promise<void>; throws/rejections retain their original failure.',
        '原无参物理发送回调返回空值或承诺，抛错及拒绝保留原失败。'
      ),
      admission: t(
        'Optional original Core outbound admission; omission attaches no extra live cancellation.',
        '可选原核心出站准入，省略时不附加额外活动取消。'
      )
    },
    t(
      'Promise settles with the original send and releases its accepted capacity exactly once.',
      '承诺随原发送结算，并精确释放一次已准入容量。'
    ),
    queueExample
  ),
  onEvent: m(
    'Subscribes to frozen local backlog snapshots; observer failure is host-reported and cannot change send settlement.',
    '订阅冻结本地容量快照，观察失败交宿主上报且不改变发送结算。',
    {
      listener: t(
        'Synchronous application callback receives IIpcBacklogEvent and returns void.',
        '应用同步回调接收容量事件并返回空值。'
      )
    },
    t('Idempotent removal releases this observer only.', '幂等移除函数只释放此观察者。'),
    queueExample
  ),
  whenIdle: m(
    'Waits until all currently accepted logical sends have settled, including work admitted while waiting.',
    '等待所有已准入逻辑发送结算，包含等待期间继续准入的工作。',
    {},
    t(
      'Resolves once accepted work is empty; it does not close the connection.',
      '已准入工作清空时完成，不关闭连接。'
    ),
    queueExample
  ),
  close: m(
    'Idempotently closes admission and rejects queued work with the original reason; active physical I/O keeps its own settlement.',
    '幂等关闭准入并用原原因拒绝排队工作，活动物理读写保留自身结算。',
    {
      reason: t(
        'Optional original shutdown failure issued by the connection owner.',
        '连接所有者提供的可选原关闭失败。'
      )
    },
    t(
      'No later work can be admitted; existing physical send is not falsely declared cancelled.',
      '后续不能准入工作，不会虚称现有物理发送已取消。'
    ),
    queueExample
  )
}
types.IIpcSendGate = type(
  'One connection-owned complete-envelope queue with independent data/control capacity and original cancellation.',
  '一个连接拥有的完整信封队列，保留独立数据控制容量及原取消。',
  gateMembers,
  queueExample
)
types.IIpcSendQueueInstallation = type(
  'Original gate and native feature must be installed with the same createIpcSendQueueTransport wrapper.',
  '原门控及原生功能须搭配 `createIpcSendQueueTransport` 的同一包装安装。',
  {
    feature: p(
      'Native feature token placed in the same endpoint features tuple.',
      '放入同一端点功能元组的原生功能令牌。'
    ),
    gate: p(
      'Original queue gate passed unchanged to the transport wrapper and logger.',
      '不变传给载体包装及日志的原队列门控。'
    )
  },
  queueExample
)
types.IIpcLogInstallation = type(
  'One observer feature lifetime with explicit local stderr intake; it never owns or changes gate admission.',
  '具有显式本地标准错误入口的一次观察功能生命周期，不拥有或改变门控准入。',
  {
    feature: p(
      'Native feature token subscribes while installed and unregisters on endpoint cleanup.',
      '原生功能令牌安装时订阅，端点清理时注销。'
    ),
    recordStderr: m(
      'Publishes one explicit original stderr record through the same observed reporter.',
      '通过同一受观察上报者发布一条显式原标准错误记录。',
      {
        record: t(
          'Actual decoded stderr record with ipc.stderr name and connection/session identifiers issued by its native owner.',
          '实际已解码标准错误记录，含标准错误事件名及原生所有者签发的连接会话标识。'
        )
      },
      t(
        'Reporting starts without waiting for async sinks; failures go to onReportError.',
        '开始上报而不等待异步接收器，失败交上报错误回调。'
      ),
      queueExample
    )
  },
  queueExample
)
symbols.createIpcSendQueueFeature = {
  role: 'enhancer',
  purpose: t(
    'Creates one bounded original connection gate and its native feature. Pair the feature with createIpcSendQueueTransport using that exact gate.',
    '创建一个有界原连接门控及原生功能，须搭配 `createIpcSendQueueTransport` 并使用该精确门控。'
  ),
  options: 'IIpcSendQueueOptions',
  returns: t(
    'IIpcSendQueueInstallation; invalid capacities throw INVALID_CONFIG before acquiring resources.',
    '返回发送队列安装对象，非法容量在取得资源前抛配置非法错误。'
  ),
  example: queueExample
}
symbols.createIpcSendQueueTransport = {
  role: 'enhancer',
  purpose: t(
    'Wraps one original physical transport with its exact gate, preserving native identities and capability references. Rewrapping the same physical connection is rejected.',
    '用精确门控包装一个原物理载体，保留原生身份及能力引用，重复包装同一物理连接会被拒绝。'
  ),
  params: {
    transport: t(
      'Actual unwrapped IRpcTransport returned by the native adapter.',
      '原生适配器返回的实际未包装载体。'
    ),
    gate: t(
      'Exact gate returned by createIpcSendQueueFeature for this connection.',
      '本连接发送队列功能返回的精确门控。'
    )
  },
  returns: t(
    'IIpcGatedTransport requiring installation of the paired native feature in the same endpoint.',
    '返回门控载体，要求同一端点安装对应原生功能。'
  ),
  example: queueExample
}
symbols.createIpcLogFeature = {
  role: 'enhancer',
  purpose: t(
    'Observes the original gate and explicit stderr without changing operation results; asynchronous sink failures are observed through the mandatory secondary sink.',
    '观察原门控及显式标准错误，不改变操作结果，异步接收失败由必需次级接收器观察。'
  ),
  optionDocs: {
    gate: p(
      'Exact original connection gate returned by createIpcSendQueueFeature.',
      '本连接发送队列功能返回的精确原门控。'
    ),
    report: p(
      'Application callback receives IIpcLogRecord, returns void or Promise<void>; throws/rejections go to onReportError.',
      '应用回调接收本地日志记录，返回空值或承诺，抛错及拒绝交上报错误回调。'
    ),
    onReportError: p(
      'Application callback receives original error and the same record, returns void or Promise<void>; secondary failure goes to hostRethrowReporter.',
      '应用回调接收原错误及同一记录，返回空值或承诺，次级失败交规范宿主上报。'
    )
  },
  returns: t(
    'IIpcLogInstallation containing the feature token and explicit stderr intake.',
    '返回包含功能令牌及显式标准错误入口的日志安装对象。'
  ),
  example: queueExample
}
for (const name of [
  'createIpcSendQueueFeature',
  'createIpcSendQueueTransport',
  'createIpcLogFeature'
])
  enhancers[name] = {
    kind: name.endsWith('Transport') ? 'transport' : 'feature',
    target: 'IRpcEndpoint',
    summary: symbols[name].purpose,
    install: queueExample,
    grants: [],
    behaviors: [
      t(
        'Uses the original admission/physical owner; diagnostics never replace business settlement.',
        '使用原准入及物理所有者，诊断不替换业务结算。'
      )
    ],
    scenarios: [
      t(
        'Bound whole-envelope backlog for one physical connection.',
        '限制单个物理连接的完整信封积压。'
      )
    ],
    example: queueExample
  }
/** Root merges this independent canonical subset into its complete library reference. */
export const observationReference: ILibraryReference = {
  modules: {
    probe: {
      summary: t(
        'Use this entry to observe RPC activity without adding diagnostics to business handlers. `defineProbe()` selects the stages to observe and the callback that receives each event; `probePlugin()` installs it on an endpoint. Event views are reused, so copy an event with `snapshotProbeEvent()` before retaining it. This is the observation mechanism; use `rpc-devtools` when you need collection and queries.',
        '需要观察远程调用过程，又不想在业务处理函数中加入诊断代码时，使用这个入口。`defineProbe()` 选择观察阶段和接收事件的回调，`probePlugin()` 将其安装到端点。事件视图会复用，保存前应通过 `snapshotProbeEvent()` 复制。这里负责提供观察机制，需要保存和查询事件时使用 `rpc-devtools`。'
      ),
      example: probeExample
    },
    'plugins/flow-control': {
      summary: t(
        'Import this entry when describing the queue limits or diagnostic events shared by the send-queue and log features. `IIpcSendQueueOptions` defines the limits for one connection; `IIpcSendGate` describes how sends enter that queue and how to wait for it to become idle. These are contracts, not queue factories. Create the queue through `plugins/send-queue` and attach reporting through `plugins/log`.',
        '需要为发送队列及其日志声明共用的选项或事件类型时，导入这个入口。`IIpcSendQueueOptions` 描述单条连接的队列限额，`IIpcSendGate` 描述发送如何进入队列，以及如何等待队列空闲。这里提供契约，不创建队列。实际创建使用 `plugins/send-queue`，接入报告使用 `plugins/log`。'
      ),
      example: queueExample
    },
    'plugins/send-queue': {
      summary: t(
        "Use this entry when a physical connection needs a bounded queue for complete outgoing messages. `createIpcSendQueueFeature()` creates the queue and its endpoint feature. `createIpcSendQueueTransport()` wraps the transport with that same queue's gate; install the feature on the endpoint using the wrapper. Data and control messages have separate limits, while `plugins/log` only reports queue events.",
        '一条实际连接需要限制待发送的完整消息数量时，使用这个入口。`createIpcSendQueueFeature()` 创建队列和可安装到端点的功能。再用 `createIpcSendQueueTransport()` 将同一队列的发送控制对象接到载体上，并在使用该载体的端点安装此功能。数据消息和控制消息分别设限，`plugins/log` 只负责报告队列事件。'
      ),
      example: queueExample
    },
    'plugins/log': {
      summary: t(
        "Use this entry to report backlog events from an existing send queue. `createIpcLogFeature()` takes that queue's gate and reporting callbacks, then returns a feature to install on the endpoint. The returned `recordStderr()` also accepts standard-error records supplied by your application. This feature observes the queue; use `plugins/send-queue` to create it, or `rpc-devtools/log` to log RPC observations.",
        '需要报告现有发送队列的积压情况时，使用这个入口。`createIpcLogFeature()` 接收该队列的发送控制对象和报告回调，返回可安装到端点的功能。返回的 `recordStderr()` 还可接收应用提供的标准错误输出记录。它只观察队列；创建队列使用 `plugins/send-queue`，记录远程调用观察事件使用 `rpc-devtools/log`。'
      ),
      example: queueExample
    }
  },
  symbols,
  types,
  enums,
  enhancers
}
