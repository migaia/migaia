/**
 * Reference for `@migaia/rpc-devtools`, checked against package source and README on 2026-10-17.
 * Source clarifications: collector options are active despite layer-2 placeholder wording in type
 * comments. Collector redaction runs in collector ingestion (not defineProbe); log redaction runs
 * at the canonical emitter. Hub clock alignment uses local performance.now() and remote
 * describe.now samples; offline records carry no clock sample or descriptor and therefore use
 * offset zero. Probe and Runtime Peer protocol contracts remain owned by rpc-core; wire error
 * graphs by rpc-contract. This reference documents only the devtools-owned surfaces and their
 * integration.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'

/** Creates one localized sentence pair. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Property documentation with an explicit omission policy when applicable. */
const f = (en: string, zh: string, defaultEn?: string, defaultZh?: string): IMemberDoc => ({
  summary: t(en, zh),
  ...(defaultEn !== undefined && defaultZh !== undefined
    ? { default: t(defaultEn, defaultZh) }
    : {})
})

/** Collector example includes its canonical probe installation and resource release. */
const collectorExample = `import { createRpcDevtools } from '@migaia/rpc-devtools'
import { createEndpoint } from '@migaia/rpc-core'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'

const devtools = createRpcDevtools({ maxEvents: 1000 })
const ports = new MessageChannel()
const transport = createBrowserMessagePortTransport(ports.port1)
const endpoint = await createEndpoint({ id: 'observed', transport, middlewares: [probePlugin(devtools)] })
const recording = devtools.record({ maxEvents: 100 })
console.log(devtools.query(), devtools.describe(), devtools.stats())
const record = recording.stop()
console.log(devtools.importRecord(devtools.exportRecord(record)).header)
await endpoint.dispose()
devtools.close()
ports.port1.close()
ports.port2.close()`

/** Record example exercises both codec directions without requiring a live connection. */
const recordExample = `import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-devtools/contract'

const text = encodeRpcDevtoolsRecord({
  header: RpcDevtoolsRecordFormat,
  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]
})
console.log(decodeRpcDevtoolsRecord(text).events[0])`

/** Offline hub example exercises retained timeline and interaction ownership. */
const hubExample = `import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-devtools/contract'

const text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [
  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }
] })
const hub = createRpcDevtoolsHub()
const off = hub.on('status', (name, status) => console.log(name, status))
hub.importRecord('recording', text)
console.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))
console.log(await hub.stats('recording'))
off()
await hub.removeTarget('recording')
await hub.close()`

/** Log probe example shows the logger boundary and canonical endpoint installation. */
const logExample = `import { createRpcLogProbe } from '@migaia/rpc-devtools/log'
import { createEndpoint } from '@migaia/rpc-core'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'

const logger = {
  debug: (message: string, fields: object) => console.debug(message, fields),
  info: (message: string, fields: object) => console.info(message, fields),
  warn: (message: string, fields: object) => console.warn(message, fields),
  error: (message: string, fields: object) => console.error(message, fields)
}
const probe = createRpcLogProbe(logger, { slowMs: 100, onError: (error) => console.error(error) })
const ports = new MessageChannel()
const transport = createBrowserMessagePortTransport(ports.port1)
const endpoint = await createEndpoint({ id: 'logged', transport, middlewares: [probePlugin(probe)] })
await endpoint.dispose()
ports.port1.close()
ports.port2.close()`

/** Query and live watch are intentionally distinct: snapshot first, then subscribe to future work. */
const queryExample = `import { createRpcDevtools } from '@migaia/rpc-devtools'
const devtools = createRpcDevtools()
const page = devtools.query({ afterSeq: 0, limit: 100 })
console.log(page.events, page.nextSeq, page.counters)
devtools.close()`

/** Service methods are callable locally through the same public contract used by remote clients. */
const serviceExample = `import { createRpcDevtools } from '@migaia/rpc-devtools'
import type { IRpcDevtoolsServiceApi } from '@migaia/rpc-devtools/contract'

const devtools = createRpcDevtools()
const service = devtools.service as unknown as IRpcDevtoolsServiceApi
service.record.start({ maxEvents: 100 })
service.pause()
service.resume()
console.log(service.describe(), service.query(), service.stats())
console.log(service.record.stop())
service.clear()
devtools.close()`

/** A local client adapter demonstrates the exact supported service routes without network setup. */
const liveHubExample = `import { createRpcDevtools } from '@migaia/rpc-devtools'
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import type { IRpcDevtoolsQuery, IRpcDevtoolsServiceApi } from '@migaia/rpc-devtools/contract'

const devtools = createRpcDevtools()
const service = devtools.service as unknown as IRpcDevtoolsServiceApi
const client = {
  request: async (method: string, payload?: unknown) => method === 'query'
    ? service.query(payload as IRpcDevtoolsQuery)
    : method === 'stats' ? service.stats() : service.describe(),
  stream: (_method: string, payload?: unknown) => service.watch(payload as Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>)
}
const hub = createRpcDevtoolsHub({ onError: (error) => console.error(error) })
await hub.addTarget('local', client)
console.log(hub.status('local'), await hub.stats('local'))
devtools.close()
await hub.close()`

/** Watch setup owns its generator and observes closure rather than leaving a pending iterator. */
const watchExample = `import { createRpcDevtools } from '@migaia/rpc-devtools'
const devtools = createRpcDevtools()
const stream = devtools.watch({ stages: ['message'] })
const pending = stream.next().catch((error) => console.error(error))
devtools.close()
await pending
await stream.return()`

/** Native errors at these observation boundaries are routed without changing business results. */
const onErrorDoc: IMemberDoc = {
  summary: t(
    'Synchronous observer receiving an original diagnostic error. Return nothing; observer failures are reported through the host failure channel without changing the RPC operation.',
    '接收原始诊断错误的同步观察回调，无需返回值；观察回调失败经宿主失败通道报告，不改变远程调用操作结果。'
  ),
  params: {
    error: t(
      'Original collector, logger, formatter or observation failure supplied by the owning component.',
      '由所属组件提供的采集器、日志、格式化或观察原始失败。'
    )
  },
  returns: t(
    'No result is used and no asynchronous work is awaited by this callback boundary.',
    '不使用返回值，此回调边界不等待异步工作。'
  ),
  default: t(
    'Uses the Core hostRethrowReporter failure channel; hub reporting instead defaults to console.error.',
    '默认使用核心包的宿主重新抛出报告通道，聚合器报告则默认使用宿主错误控制台。'
  ),
  example: logExample
}

/** Probe input policies are shared by collector and log only where semantics are identical. */
const probeOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  methods: f(
    'Exact method path filter supplied by the application; methodless control events remain observable.',
    '应用提供的精确方法路径筛选列表，不含方法名的控制事件仍可观察。',
    'No method filter; all method-bearing events are eligible.',
    '默认不筛选方法，所有带方法名事件均可进入后续选择。'
  ),
  sample: f(
    'Deterministic sampling fraction in the interval greater than zero through one, using sender/message identity rather than random per-stage decisions.',
    '大于零且小于或等于一的确定性采样比例，按发送者与消息身份采样，而非逐阶段随机决定。',
    'One, retaining all eligible identities before retention limits.',
    '默认一，在保留上限生效前接纳所有符合条件的身份。'
  ),
  capture: f(
    'Explicit stages whose content may be read. Select names from RpcProbeStageName in @migaia/rpc-core/probe and keep capture within initially subscribed stages.',
    '显式允许读取内容的阶段，名称来自 `@migaia/rpc-core/probe` 的阶段名表，必须为初始订阅阶段的子集。',
    'No content capture; observation remains metadata-only.',
    '默认不捕获内容，仅观察元数据。'
  ),
  redact: {
    summary: t(
      'Synchronous callback receiving numeric RpcProbeStage and captured content. Return the retained replacement; never retain the reusable event view. Collector executes it during ingestion, log executes it at the canonical emitter.',
      '接收数字阶段与已捕获内容的同步回调，返回需要保留的替代值；不可保留复用事件视图，采集器在摄取时执行，日志探针在规范发射器执行。'
    ),
    params: {
      stage: t(
        'Numeric stage from RpcProbeStage supplied by the observing emitter.',
        '由观察发射器提供、取自阶段常量表的数字阶段。'
      ),
      content: t(
        'Captured caller-owned content reference from an explicitly enabled stage.',
        '来自显式启用阶段的调用者内容引用。'
      )
    },
    returns: t(
      'Replacement content, including undefined to discard it. Synchronous throws discard content and are reported; asynchronous redaction is not awaited.',
      '返回替代内容，可返回未定义丢弃；同步抛错丢弃内容并报告，不等待异步脱敏。'
    ),
    default: t(
      'No redactor; explicitly captured content retains its original reference.',
      '默认无脱敏回调，显式捕获内容保留其原始引用。'
    ),
    example: `import { createRpcDevtools } from '@migaia/rpc-devtools'
const devtools = createRpcDevtools({ stages: ['message'], capture: ['message'], redact: (_stage, content) => typeof content === 'string' ? '[redacted]' : undefined, onError: (error) => console.error(error) })
console.log(devtools.describe())
devtools.close()`
  },
  onError: onErrorDoc
}

/** Collector-owned APIs; service reuses only methods with identical public inputs. */
const collectorMembers: Readonly<Record<string, IMemberDoc>> = {
  emit: {
    summary: t(
      'Consumes a Core-owned reusable IRpcProbeEventView synchronously into retained columns; never keeps the view itself. Installed emitters normally call it through probePlugin.',
      '同步消费核心包拥有的复用事件视图并写入保留列，不保存视图本身；安装后的发射器通常经探针插件调用它。'
    ),
    params: {
      view: t(
        'IRpcProbeEventView issued by an installed Core emitter, valid only during its synchronous emit call; external type semantics remain in @migaia/rpc-core/probe.',
        '已安装核心发射器签发的 `IRpcProbeEventView`，仅同步发射调用期间有效，外包类型语义由 `@migaia/rpc-core/probe` 拥有。'
      )
    },
    returns: t(
      'Metadata is retained or accounted as filtered, paused, closed or reentrant loss. Observation failures are reported instead of reaching the business caller.',
      '元数据已被保留，或被记为筛选、暂停、关闭及重入丢失，观察失败通过报告通道处理，不传给业务调用者。'
    ),
    example: collectorExample
  },
  query: {
    summary: t(
      'Synchronously scans retained events with compiled filters. This is a snapshot rather than a subscription; limits are one through one thousand.',
      '用已编译筛选条件同步扫描保留事件，返回快照而非订阅，数量上限为一至一千。'
    ),
    params: {
      input: t(
        'Optional IRpcDevtoolsQuery; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
        '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
      )
    },
    returns: t(
      'IRpcDevtoolsPage with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
      '返回含事件、下页游标及丢失计数的查询页，非法输入使用 `INVALID_OPTION`，关闭的采集器使用 `CLOSED`。'
    ),
    example: queryExample
  },
  watch: {
    summary: t(
      'Subscribes from first generator advancement to future filtered events. Batches contain at most 256 events and each watcher retains at most 64 queued batches; overflow is counted rather than blocking RPC.',
      '从首次推进生成器开始订阅未来筛选事件，每批至多二百五十六条，每个观察者至多排队六十四批，溢出计数而不阻塞远程调用。'
    ),
    params: {
      input: t(
        'Optional query filters excluding afterSeq and limit; defaults to no filters. Use query separately for retained history.',
        '可选查询筛选，排除历史游标及上限字段，默认不筛选，历史数据另用查询接口读取。'
      )
    },
    returns: t(
      'AsyncGenerator<IRpcDevtoolsWatchBatch>; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
      '返回观察批次异步生成器，结束迭代会唤醒本地待定读取并释放观察者，无需关闭采集器；关闭采集器则使等待读取以 `CLOSED` 失败，远端流取消则正常结束其服务观察者。'
    ),
    example: watchExample
  },
  stats: {
    summary: t(
      'Snapshots endpoint/method settlement aggregates independently from query-ring eviction; clear resets them.',
      '取得不受查询环淘汰影响的端点与方法结算聚合快照，清空操作会重置统计。'
    ),
    returns: t(
      'IRpcDevtoolsStats with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
      '返回含累计计数及直方图分位数的统计，已关闭采集器抛 `CLOSED`。'
    ),
    example: queryExample
  },
  describe: {
    summary: t(
      'Reports the current monotonic clock sample, pause state, known endpoint descriptors, limits and loss counters.',
      '报告当前单调时钟采样、暂停状态、已知端点描述、容量限制及丢失计数。'
    ),
    returns: t(
      'IRpcDevtoolsDescribe snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
      '返回描述快照，端点描述元素保留原引用，已关闭采集器抛 `CLOSED`。'
    ),
    example: collectorExample
  },
  record: {
    summary: t(
      'Starts one independent bounded recording ring. Pair its handle stop() with exportRecord to obtain an offline record; only one recording may be active.',
      '启动独立有界录制环，取得句柄后调用停止方法，再搭配 `exportRecord` 输出离线记录，同一时刻仅允许一个录制。'
    ),
    params: {
      options: t(
        'Optional maxEvents positive safe integer capacity, defaulting to the collector maxEvents. This bound is separate from main query retention.',
        '可选正安全整数容量 `maxEvents`，默认采集器事件容量，此限制独立于主查询环保留。'
      )
    },
    returns: t(
      'A handle with stop(): IRpcDevtoolsRecord, taking no arguments and stopping only its own active ring. Duplicate start throws RECORD_ACTIVE; a stale or repeated stop throws RECORD_NOT_ACTIVE; closure throws CLOSED.',
      '返回含无参数停止方法的句柄，停止仅限其拥有的活动录制并返回离线记录，重复启动抛 `RECORD_ACTIVE`，失效或重复停止抛 `RECORD_NOT_ACTIVE`，关闭后抛 `CLOSED`。'
    ),
    example: collectorExample
  },
  exportRecord: {
    summary: t(
      'Encodes a stopped record through the standalone canonical record codec; this method does not change retained collector state.',
      '通过规范独立记录编解码器输出已停止记录，不改变采集器保留状态。'
    ),
    params: {
      record: t(
        'IRpcDevtoolsRecord returned by a recording handle stop or record decoder.',
        '录制句柄停止操作或记录解码器返回的离线记录。'
      )
    },
    returns: t(
      'Version-one NDJSON string; unsupported record input throws RECORD_FORMAT_INVALID with cause.',
      '返回第一版逐行 `JSON` 文本，不支持的记录输入抛 `RECORD_FORMAT_INVALID` 并保留原因。'
    ),
    example: collectorExample
  },
  importRecord: {
    summary: t(
      'Decodes offline text into an independent record; it does not append events to this collector or change its ring.',
      '将离线文本解码为独立记录，不向当前采集器追加事件或修改保留环。'
    ),
    params: {
      text: t(
        'Version-one text returned by exportRecord or encodeRpcDevtoolsRecord.',
        '记录导出方法或独立编码函数返回的第一版文本。'
      )
    },
    returns: t(
      'IRpcDevtoolsRecord with revived native errors and bytes, or RECORD_FORMAT_INVALID with cause.',
      '返回恢复原生错误和字节的离线记录，失败抛 `RECORD_FORMAT_INVALID` 并保留原因。'
    ),
    example: collectorExample
  },
  pause: {
    summary: t(
      'Snapshots current effective stage subscriptions and replaces them with an empty selection. Repeated pause is harmless; retained data remains queryable.',
      '保存当前生效的阶段订阅并替换为空选择，重复暂停无额外影响，已保留数据仍可查询。'
    ),
    returns: t(
      'Collection is paused without pausing business RPC; closed collectors throw CLOSED.',
      '采集已暂停但业务远程调用继续，已关闭采集器抛 `CLOSED`。'
    ),
    example: `import { createRpcDevtools } from '@migaia/rpc-devtools'
const devtools = createRpcDevtools()
devtools.pause()
console.log(devtools.describe().paused)
devtools.resume()
devtools.close()`
  },
  resume: {
    summary: t(
      'Restores the effective stage selection saved by the first pause. It does not revive a closed collector.',
      '恢复首次暂停时保存的生效阶段选择，不会复活已关闭的采集器。'
    ),
    returns: t(
      'Collection resumes with prior subscriptions; repeated resume is harmless and closed collectors throw CLOSED.',
      '按原订阅恢复采集，重复恢复无额外影响，已关闭采集器抛 `CLOSED`。'
    ),
    example: collectorExample
  },
  clear: {
    summary: t(
      'Clears main query retention, aggregate statistics and loss counters. Independent recording and watch windows keep their ownership.',
      '清空主查询保留、聚合统计及丢失计数，独立录制和观察窗口保留其所属关系。'
    ),
    returns: t(
      'Main retention and statistics are empty; the collector stays open. Closed collectors throw CLOSED.',
      '主保留与统计已清空，采集器仍可接收事件，已关闭采集器抛 `CLOSED`。'
    ),
    example: `import { createRpcDevtools } from '@migaia/rpc-devtools'
const devtools = createRpcDevtools()
devtools.clear()
console.log(devtools.query().events)
devtools.close()`
  },
  close: {
    summary: t(
      'Idempotently removes subscriptions, releases retained storage and wakes pending watchers. It owns no serving Peer and does not close application endpoints.',
      '幂等移除订阅、释放保留存储并唤醒等待观察者，不拥有服务端连接，也不会关闭应用端点。'
    ),
    returns: t(
      'Collector storage and subscriptions are released synchronously; later operational calls reject with CLOSED.',
      '同步释放采集器存储及订阅，后续操作调用以 `CLOSED` 拒绝。'
    ),
    example: collectorExample
  },
  service: {
    summary: t(
      'IRuntimePeerProvide object installed by the caller on a separate serving Peer, commonly under a devtools namespace. Service endpoints are excluded using actual localEndpointId; the caller owns transport and Peer lifetime.',
      '由调用者安装到独立服务连接、通常置于诊断命名空间下的 `IRuntimePeerProvide` 对象，按实际本地端点标识排除服务端点，传输与连接生命周期归调用者。'
    ),
    example: collectorExample
  }
}

/** Wire event fields are reused by offline event records except for their error representation. */
const wireMembers: Readonly<Record<string, IMemberDoc>> = {
  target: f(
    'Optional hub-supplied target name from addTarget or importRecord, separate from Core endpoint identity.',
    '可选聚合目标名，来自添加目标或导入记录时的调用者命名，与核心端点身份分开。',
    'Absent in ordinary collector events without a hub target projection.',
    '普通采集器事件没有聚合目标投影时省略。'
  ),
  seq: f(
    'Collector-domain sequence issued during ingestion; use query nextSeq for pagination rather than physical ring offsets.',
    '摄取时签发的采集器序号，分页使用查询下页游标，而非物理环下标。'
  ),
  carrierSeq: f(
    'Collector-domain sequence pointing to an observed inbound carrier origin in this target; absence means no retained resolved link.',
    '指向当前目标已观察入站载体来源的采集器序号，省略代表没有保留且已解析的链接。',
    'Absent when no originating carrier link can be resolved.',
    '无法解析来源载体链接时省略。'
  ),
  at: f(
    'Timestamp supplied by the observing Core emitter; hub alignment wraps it without modifying this original number.',
    '观察核心发射器提供的时间戳，聚合对齐使用包装字段，不修改原始数值。'
  ),
  endpointId: f(
    'Endpoint identifier issued by the Core endpoint constructor and captured by its emitter.',
    '由核心端点构造函数签发并被所属发射器捕获的端点标识。'
  ),
  stage: f(
    'Canonical stage name from RpcProbeStageName in the Core probe contract.',
    '来自核心探针契约阶段名表的规范阶段名称。'
  ),
  direction: f(
    'Canonical inbound or outbound direction name from the Core probe contract.',
    '来自核心探针契约的规范入站或出站方向名称。'
  ),
  kind: f(
    'Optional logical message kind name from the Core probe taxonomy; physical-only observations may omit it.',
    '核心探针分类中的可选逻辑消息种类，纯物理观察可省略。',
    'Absent when the observing layer cannot identify a logical message kind.',
    '观察层无法识别逻辑消息种类时省略。'
  ),
  outcome: f(
    'Optional canonical event outcome name used by queries and settlement statistics.',
    '供查询及结算统计使用的可选规范事件结果名称。',
    'Absent when the observation has no outcome classification.',
    '观察不具备结果分类时省略。'
  ),
  messageId: f(
    'Message identifier issued by the originating RPC sender; combine with senderId for interaction correlation.',
    '来源远程调用发送者签发的消息标识，与发送者标识一起用于交互关联。',
    'Absent when no logical message identity is observable.',
    '无法观察逻辑消息身份时省略。'
  ),
  method: f(
    'Method path observed on the logical message; names originate from the caller method route.',
    '逻辑消息上观察到的方法路径，名称取自调用者使用的方法路由。',
    'Absent on observations without a logical method route.',
    '观察不含逻辑方法路由时省略。'
  ),
  variation: f(
    'Original variation route observed on message or envelope stages, preserving the Core route vocabulary.',
    '消息或封装阶段观察到的原始变体路由，保留核心路由词汇。',
    'Absent on stages where no variation route is observed.',
    '没有观察到变体路由的阶段省略。'
  ),
  senderId: f(
    'Originating sender identity supplied by the observed RPC message.',
    '被观察远程调用消息提供的来源发送者身份。',
    'Absent when the observed layer has no sender identity.',
    '观察层没有发送者身份时省略。'
  ),
  targetId: f(
    'Destination identity supplied by the observed RPC routing envelope.',
    '被观察远程调用路由封装提供的目的身份。',
    'Absent when no destination identity is available.',
    '目的身份不可用时省略。'
  ),
  receiverId: f(
    'Actual receiver identity supplied by the observed receive path, which may differ from a routing target.',
    '被观察接收路径提供的实际接收者身份，可能与路由目标不同。',
    'Absent when the receive layer cannot expose a receiver.',
    '接收层无法提供接收者时省略。'
  ),
  peerId: f(
    'Peer identity issued by the observed Core peer lifecycle path.',
    '被观察核心连接生命周期路径签发的连接身份。',
    'Absent when the event is unrelated to an identified peer.',
    '事件不关联已识别连接时省略。'
  ),
  trace: f(
    'Explicit application-provided trace carried by the observed message; native Peer calls do not automatically invent it.',
    '被观察消息携带的显式应用追踪标识，原生连接调用不会自动生成它。',
    'Absent unless the application propagates a trace.',
    '应用未传播追踪标识时省略。'
  ),
  sizeBytes: f(
    'Observed byte count when the layer knows it; missing sizes are not substituted with zero.',
    '观察层已知时记录的字节数，不把缺失大小替换为零。',
    'Absent when the source reports its unknown-size sentinel.',
    '来源报告未知大小哨兵时省略。'
  ),
  chunk: f(
    'Observed chunk position: index is the source chunk index and count is its source chunk count; values come from the Core event.',
    '观察到的分块位置，索引与数量均取自核心来源事件。',
    'Absent when the event is not an observed chunk.',
    '事件不是已观察分块时省略。'
  ),
  members: f(
    'Observed batch member count supplied by the source event.',
    '来源事件提供的已观察批次成员数量。',
    'Absent when the event has no batch member count.',
    '事件没有批次成员数量时省略。'
  ),
  durationMs: f(
    'Observed settlement duration in milliseconds; aggregates accept nonnegative durations on message settlement outcomes.',
    '观察到的毫秒结算耗时，聚合统计接纳消息结算结果的非负耗时。',
    'Absent when the source event does not describe settlement.',
    '来源事件不描述结算时省略。'
  ),
  rejection: f(
    'Package-local rejection reason from the observed provider boundary, distinguishing causes that share an error code.',
    '来自被观察提供者边界的包级拒绝原因，用于区分共享错误码的不同失败原因。',
    'Absent when no rejection reason is observed.',
    '没有观察到拒绝原因时省略。'
  ),
  lifecycle: f(
    'Observed Core lifecycle event name, retaining the emitting owner vocabulary.',
    '观察到的核心生命周期事件名，保留发射方拥有的词汇。',
    'Absent outside lifecycle observations.',
    '非生命周期观察时省略。'
  ),
  error: f(
    'Canonical serialized error graph owned by @migaia/rpc-contract/errors, retaining source, code, stack and causes.',
    '由 `@migaia/rpc-contract/errors` 拥有的规范序列化错误图，保留来源、码、堆栈及原因。',
    'Absent when no error is attached to the observation.',
    '观察未附错误时省略。'
  ),
  carrier: f(
    'Observed physical carrier name supplied by the adapter or Core descriptor.',
    '适配器或核心描述提供的已观察物理载体名称。',
    'Absent when the source cannot identify a physical carrier.',
    '来源无法识别物理载体时省略。'
  ),
  detail: f(
    'Adapter-owned scalar detail record; keys describe the observed carrier, and retained values are not deeply copied.',
    '适配器拥有的标量细节记录，键描述观察到的载体，保留值不执行深复制。',
    'Absent when the observing carrier exposes no detail record.',
    '观察载体未暴露细节记录时省略。'
  ),
  content: f(
    'Opted-in captured reference after redaction; mutating or transferring its backing may affect later reads. Service exposure separately requires exposeContent. The record codec reserves any nested single-key {$bytes: base64} object for byte revival; use JSON text for a same-shaped business object.',
    '显式捕获并经脱敏后的引用，修改或转移底层存储可能影响后续读取，服务暴露另需显式开启；记录编解码把任意嵌套单键字节标签对象作为字节保留语法，同形业务对象须自行存为对象文本。',
    'Absent in metadata-only mode or after redaction/budget removal.',
    '仅元数据模式、脱敏丢弃或预算移除后省略。'
  )
}

/** One status vocabulary is shared by values, callbacks and enum-like field docs. */
const statusValues = {
  connecting: t(
    'A live target is registered and clock alignment or catch-up is still in progress.',
    '实时目标已注册，正在进行时钟对齐或历史数据追赶。'
  ),
  connected: t(
    'Alignment and catch-up completed and its live watch was acquired.',
    '时钟对齐与历史追赶已完成，并已取得实时观察流。'
  ),
  disconnected: t(
    'Live setup or watch ended or failed; retained observations remain available until removal.',
    '实时设置或观察结束或失败，保留观察仍可使用直到移除目标。'
  ),
  offline: t(
    'A decoded record was imported without a live client or clock sampling.',
    '导入了已解码记录，没有实时客户端或时钟采样。'
  ),
  removed: t(
    'The name was removed; retained events are detached and its watch is released.',
    '目标名已移除，保留事件被分离，其观察流被释放。'
  )
}

/** Hub operations use names explicitly issued by application registration. */
const targetName = t(
  'Name chosen by the application in addTarget(name, client) or importRecord(name, text).',
  '由应用在添加目标或导入记录时指定的名称，后续操作沿用该注册名称。'
)

/** All devtools errors preserve native identity and original causes rather than parsing messages. */
const errorValues = {
  targetReleaseFailed: t(
    'TARGET_RELEASE_FAILED: the hub failed to release a target watch. A native AggregateError retains the first original on cause/errors[0] and all failures on errors; close continues after reporting.',
    '目标释放失败：聚合器释放目标观察失败；原生汇总错误在原因及首错误中保留首项原错，错误列表保留全部失败，报告后关闭继续完成。'
  ),
  serviceResultInvalid: t(
    'Service result cannot become portable wire data; inspect the original conversion cause.',
    '服务结果无法转换为可移植线数据，需要检查原始转换原因。'
  ),
  invalidOption: t(
    'Collector, hub or log options violate a supported domain; correct the supplied option.',
    '采集器、聚合器或日志选项违反支持的值域，需要修正选项。'
  ),
  closed: t(
    'An operation uses a closed collector or hub; create a live instance rather than reviving it.',
    '操作使用已关闭采集器或聚合器，需要创建存活实例而非复活旧实例。'
  ),
  recordActive: t(
    'A recording is already active on the collector; stop it before starting another.',
    '采集器已有活动录制，必须先停止再开始另一个录制。'
  ),
  recordNotActive: t(
    'Stop has no matching active recording, including repeated stop or a stale handle.',
    '停止时没有匹配活动录制，包括重复停止或使用失效句柄。'
  ),
  recordFormatInvalid: t(
    'Record header, event, bytes or error graph fails the frozen version-one format boundary.',
    '记录头、事件、字节或错误图不符合固定第一版格式边界。'
  ),
  redactFailed: t(
    'Collector redaction throws; content is discarded and the original cause is reported.',
    '采集器脱敏回调抛错，内容被丢弃并报告原始原因。'
  ),
  targetDuplicate: t(
    'A hub target name is already registered; remove the old target before replacement.',
    '聚合目标名已注册，替换前需要先移除旧目标。'
  ),
  targetUnknown: t(
    'A requested hub target has never been registered or is unavailable for that operation.',
    '所请求聚合目标未曾注册，或当前操作无法使用该目标。'
  )
}

/** Root and subpath reference sharing canonical imported protocol ownership. */
export const rpcDevtoolsReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Bounded local RPC collector with query, watch, statistics and recording. Start with createRpcDevtools and install the returned probe through Core probePlugin; the caller owns endpoints and service lifetime.',
        '提供有界本地远程调用采集、查询、观察、统计及录制，从 `createRpcDevtools` 开始，经核心探针插件安装返回对象，端点及服务生命周期归调用者。'
      ),
      example: collectorExample
    },
    contract: {
      summary: t(
        'Wire query/service types and frozen version-one offline NDJSON format. Start with encodeRpcDevtoolsRecord and decodeRpcDevtoolsRecord; canonical error graph semantics remain in rpc-contract.',
        '提供线查询与服务类型及固定第一版离线逐行 `JSON` 格式，从记录编码与解码函数开始，规范错误图语义仍归契约包。'
      ),
      example: recordExample
    },
    hub: {
      summary: t(
        'Aggregates already connected service clients or offline records; creates no transport. Start with createRpcDevtoolsHub, then addTarget or importRecord for aligned timeline and explicit interaction queries.',
        '聚合已有服务客户端或离线记录，不创建传输，从 `createRpcDevtoolsHub` 开始，添加目标或导入记录后查询对齐时间线及显式交互。'
      ),
      example: hubExample
    },
    log: {
      summary: t(
        'Turns qualifying message and peer observations into calls on a structural logger. Start with createRpcLogProbe and install its probe through Core probePlugin; the logger owns buffering and output.',
        '将符合条件的消息及连接观察交给结构化日志接收端，从 `createRpcLogProbe` 开始，经核心探针插件安装，缓冲与输出归日志接收端。'
      ),
      example: logExample
    }
  },
  symbols: {
    createRpcDevtools: {
      role: 'factory',
      purpose: t(
        'Creates a bounded collector that is itself a Core probe. Install it through probePlugin to collect endpoint events; it retains scalar metadata immediately and converts query, watch and record results only at reader boundaries. It creates no Peer or transport.',
        '创建自身即为核心探针的有界采集器，将其传给 `probePlugin` 安装后采集端点事件，立即保留标量元数据，在读取边界转换查询、观察及录制结果，不创建连接或传输。'
      ),
      options: 'IRpcDevtoolsOptions',
      params: {
        options: t(
          'Optional collector policies; omitted options use message/peer stages, metadata-only capture and bounded default capacities.',
          '可选采集策略，省略时使用消息与连接阶段、仅元数据捕获及有界默认容量。'
        )
      },
      returns: t(
        'Caller-owned IRpcDevtools, also IRpcProbe from @migaia/rpc-core/probe. Close explicitly; invalid construction options throw native TypeError with INVALID_OPTION and original cause.',
        '返回调用者拥有的采集器，同时满足核心包探针契约，需显式关闭，构造选项非法抛带 `INVALID_OPTION` 及原始原因的原生类型错误。'
      ),
      example: collectorExample
    },
    encodeRpcDevtoolsRecord: {
      role: 'operation',
      purpose: t(
        'Encodes ordered record events as version-one NDJSON with a header line and trailing newline. Bytes use canonical padded Base64 tags; native errors delegate to the canonical Contract error graph and retain stacks.',
        '把有序记录事件编码为带头行和结尾换行的第一版逐行 `JSON`，字节采用规范填充标签，原生错误复用契约包规范错误图并保留堆栈。'
      ),
      params: {
        record: t(
          'IRpcDevtoolsRecord from a stopped recording or an application-built record using RpcDevtoolsRecordFormat.',
          '来自已停止录制，或应用使用规范记录格式常量构造的离线记录。'
        )
      },
      returns: t(
        'Complete NDJSON string; unsupported header, event, bytes or error conversion throws RECORD_FORMAT_INVALID with original cause. Input errors and stacks are not mutated.',
        '返回完整逐行文本，头、事件、字节或错误转换失败抛 `RECORD_FORMAT_INVALID` 并保留原始原因，不修改输入错误与堆栈。'
      ),
      example: recordExample
    },
    decodeRpcDevtoolsRecord: {
      role: 'operation',
      purpose: t(
        'Parses the frozen version-one NDJSON grammar, validates header and required event fields, and revives native bytes and error graphs without regenerating stacks. Pair with encodeRpcDevtoolsRecord for a complete offline round trip.',
        '解析固定第一版逐行 `JSON` 语法，校验头及必填事件字段，恢复原生字节与错误图且不重建堆栈，搭配 `encodeRpcDevtoolsRecord` 完成离线往返。'
      ),
      params: {
        text: t(
          'Text produced by encodeRpcDevtoolsRecord or collector exportRecord; no connection or live collector is required.',
          '记录编码函数或采集器导出函数产生的文本，不要求连接或存活采集器。'
        )
      },
      returns: t(
        'IRpcDevtoolsRecord with native errors and newly decoded byte arrays; malformed input throws TypeError with RECORD_FORMAT_INVALID and cause.',
        '返回含原生错误及新解码字节数组的离线记录，输入损坏抛带 `RECORD_FORMAT_INVALID` 与原因的类型错误。'
      ),
      example: recordExample
    },
    createRpcDevtoolsHub: {
      role: 'factory',
      purpose: t(
        'Creates a caller-owned multi-target observation hub. Live registration samples describe five times, chooses minimum round-trip alignment, starts the first read of one watch before querying retained pages, then consumes that bounded watch and deduplicates by sequence. Offline import uses no invented clock metadata; existing clients remain caller-owned.',
        '创建调用者拥有的多目标观察聚合器，实时注册五次采样描述并选择最小往返对齐，先开始唯一观察流的首次读取，再查询保留页，随后消费有界观察并按序号去重，离线导入不编造时钟元数据，已有客户端仍归调用者。'
      ),
      options: 'IRpcDevtoolsHubOptions',
      params: {
        options: t(
          'Optional per-target retention, realignment period and error observer. Omitted settings retain fifty thousand events per target without periodic realignment.',
          '可选每目标保留、重对齐周期及错误观察回调，省略时每目标保留五万事件且不周期重对齐。'
        )
      },
      returns: t(
        'IRpcDevtoolsHub; close returns the same promise on repeated calls. Invalid options throw INVALID_OPTION; target and lifecycle errors use the package error table.',
        '返回聚合器，重复关闭返回同一承诺，非法选项抛 `INVALID_OPTION`，目标及生命周期失败使用包错误表。'
      ),
      example: hubExample
    },
    createRpcLogProbe: {
      role: 'enhancer',
      purpose: t(
        'Creates a standalone Core probe that logs qualifying failed, rejected, slow or peer-lifecycle events. Install it through probePlugin. Each qualifying event makes one synchronous logger call; sink promise rejection is observed without awaiting or changing business RPC.',
        '创建记录失败、拒绝、慢调用或连接生命周期的独立核心探针，将其传给探针插件安装，每个符合条件事件同步调用日志一次，并观察日志承诺拒绝而不等待或改变业务调用。'
      ),
      params: {
        logger: t(
          'Caller-owned IRpcLogSink with debug, info, warn and error methods, for example a compatible logger instance; it owns buffering and output.',
          '调用者拥有、含四个日志级别方法的结构化接收端，可使用兼容日志实例，自行拥有缓冲及输出。'
        ),
        options: t(
          'Optional logging policy; default stages are message and peer, content capture and slow-call qualification are disabled.',
          '可选日志策略，默认消息与连接阶段，不捕获内容且不开启慢调用条件。'
        )
      },
      options: 'IRpcLogProbeOptions',
      returns: t(
        'IRpcProbe from @migaia/rpc-core/probe; its protocol surface remains owned there. Invalid sink or options throw TypeError with INVALID_OPTION, while observer failures use onError.',
        '返回 `@migaia/rpc-core/probe` 的探针，协议表面归核心包拥有，接收端或选项非法抛带 `INVALID_OPTION` 的类型错误，观察失败经错误回调处理。'
      ),
      example: logExample
    },
    RPC_DEVTOOLS_SOURCE: {
      role: 'error',
      purpose: t(
        'Identifies failures created by RPC Devtools. When handling a caught error, compare its source with RPC_DEVTOOLS_SOURCE, then compare code with RpcDevtoolsErrorCode to select a response. Configuration failures remain TypeError instances; failures involving a diagnostic session use Error. You do not need to parse the message to classify them.',
        '标识 RPC 调试工具创建的失败。处理捕获的错误时，先检查 source 是否等于 RPC_DEVTOOLS_SOURCE，再用 RpcDevtoolsErrorCode 比较 code，选择处理方式。配置失败仍然是 TypeError，诊断会话失败使用 Error；分类时无需解析消息文本。'
      ),
      example: `import { RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode } from '@migaia/rpc-devtools/contract'
console.log(RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode.closed)`
    },
    RpcDevtoolsErrorCode: {
      role: 'error',
      purpose: t(
        'Stable semantic error vocabulary for options, collector lifecycle, recording, portable service conversion and hub target ownership. Original causes remain reachable through native error chains.',
        '提供选项、采集生命周期、录制、可移植服务转换及聚合目标所有权的稳定语义错误词汇，原始原因通过原生错误链保持可达。'
      ),
      example: `import { RpcDevtoolsErrorCode } from '@migaia/rpc-devtools/contract'
console.log(RpcDevtoolsErrorCode.recordActive)`
    },
    RpcDevtoolsRecordFormat: {
      role: 'constant',
      purpose: t(
        'Frozen version-one record header identity containing format migaia-rpc-devtools and version one. Use the same object when constructing records for the codec; it carries no clock or descriptor metadata.',
        '冻结第一版记录头身份，包含格式标识及版本一，构造编码记录时使用相同常量，不携带时钟或端点描述元数据。'
      ),
      example: recordExample
    },
    RpcDevtoolsTargetStatus: {
      role: 'constant',
      purpose: t(
        'Target lifecycle values emitted by hub status observations and returned by status queries. These values describe connectivity or offline ownership and are never thrown error codes.',
        '聚合状态观察回调及查询使用的目标生命周期值，描述连接状态或离线所有权，不作为抛出错误码。'
      ),
      example: hubExample
    }
  },
  types: {
    IRpcDevtools: {
      summary: t(
        'Collector returned by createRpcDevtools, composed with external IRpcProbe. The Core owns stage masks and setStages; this collector owns retention, queries, recording, service projection and explicit close.',
        '采集器工厂返回、组合外包探针的采集器，核心包拥有阶段掩码及订阅修改，当前包拥有保留、查询、录制、服务投影与显式关闭。'
      ),
      scenarios: [
        t(
          'Observe endpoint traffic locally and serve a separate diagnostics connection without owning business transports.',
          '本地观察端点流量并经独立诊断连接提供服务，不拥有业务传输。'
        )
      ],
      example: collectorExample,
      members: collectorMembers
    },
    IRpcDevtoolsOptions: {
      summary: t(
        'Construction policies for a bounded collector; capacities are captured once, while effective subscriptions can later change through the Core probe setStages API.',
        '有界采集器构造策略，容量一次捕获，生效订阅随后可经核心探针订阅接口修改。'
      ),
      example: collectorExample,
      members: {
        ...probeOptionMembers,
        stages: f(
          'Initial nonempty stage names from Core RpcProbeStageName; physical stages require explicit selection and selection alone never enables capture.',
          '核心规范阶段名中的初始非空订阅，物理阶段需显式选择，选择本身不会开启内容捕获。',
          'message and peer; physical stages are not subscribed.',
          '默认 `message` 与 `peer`，不订阅物理阶段。'
        ),
        maxEvents: f(
          'Main-ring positive safe integer capacity, at most the JavaScript array length limit; newest events evict oldest events.',
          '主环正安全整数容量，不超过语言数组长度上限，新事件淘汰最旧事件。',
          '10000 retained events in the main ring.',
          '默认主环保留一万事件。'
        ),
        maxContentBytes: f(
          'Nonnegative safe integer budget for content retained by the main query ring; independent recording/watch references and opaque-object sizing are outside this byte total. It is not a process-wide memory ceiling; excess content drops while metadata stays.',
          '主查询环保留内容的非负安全整数预算；独立录制、观察引用及不透明对象计量不属于同一字节总量，不是进程总内存上限；超额丢弃内容但保留元数据。',
          '8388608 bytes, or eight mebibytes.',
          '默认 `8388608` 字节，即八兆二进制字节。'
        ),
        maxInterned: f(
          'Positive safe integer reader name-table bound, at most floor(sqrt(MAX_SAFE_INTEGER)) minus one; overflow uses an explicit marker.',
          '读取时名称表的正安全整数上限，不超过最大安全整数平方根向下取整再减一，溢出使用显式标记。',
          '65536 names; ingestion itself retains raw string references.',
          '默认六万五千五百三十六个名称，摄取本身保留原始字符串引用。'
        ),
        exposeContent: f(
          'Allows captured content across the portable service boundary; local query and stopped recordings already use their retained captured content.',
          '允许已捕获内容通过可移植服务边界，本地查询与停止录制已可使用保留的捕获内容。',
          'false; service responses omit captured content.',
          '默认 `false`，服务响应省略捕获内容。'
        )
      }
    },
    IRpcDevtoolsQuery: {
      summary: t(
        'Snapshot filter over one collector sequence domain; stages and outcomes use canonical Core names, while method and endpoint lists use exact membership.',
        '单个采集器序号域内的快照筛选，阶段及结果使用核心规范名称，方法及端点列表精确匹配。'
      ),
      example: queryExample,
      members: {
        afterSeq: f(
          'Exclusive lower cursor from a prior page nextSeq, or zero for the retained beginning.',
          '取自上一页下页游标的排他下界，首次读取可用零。',
          'Zero, scanning from the first retained sequence.',
          '默认零，从首个保留序号开始扫描。'
        ),
        limit: f(
          'Positive safe integer page size between one and one thousand.',
          '一至一千之间的正安全整数页大小。',
          '1000 events per query snapshot.',
          '默认每次查询至多一千事件。'
        ),
        stages: f(
          'Exact canonical stage names from the Core probe stage table; an empty array matches no events.',
          '核心探针阶段表中的精确名称，空数组不匹配任何事件。',
          'All stages present in retained data.',
          '默认匹配保留数据中的所有阶段。'
        ),
        outcomes: f(
          'Canonical outcome names from Core RpcProbeOutcomeName; an empty array matches no events.',
          '核心规范结果名表中的名称，空数组不匹配任何事件。',
          'All outcomes present in retained data.',
          '默认匹配保留数据中的所有结果。'
        ),
        methods: f(
          'Exact method paths read from observed events or supplied by the application method catalog.',
          '取自观察事件或应用方法目录的精确方法路径。',
          'No method filter is applied.',
          '默认不施加方法筛选。'
        ),
        trace: f(
          'Explicit trace copied from an observed event or application propagation context.',
          '从观察事件或应用传播上下文复制的显式追踪标识。',
          'No trace filter is applied.',
          '默认不施加追踪标识筛选。'
        ),
        endpointIds: f(
          'Endpoint identifiers issued by Core endpoint creation and available in descriptors or wire events.',
          '核心端点创建签发、可从端点描述或线事件取得的标识。',
          'No endpoint filter is applied.',
          '默认不施加端点筛选。'
        )
      }
    },
    IRpcDevtoolsCounters: {
      summary: t(
        'Loss and lifecycle decision counters observed with snapshots; these distinguish retention loss from sampling or disabled ingestion.',
        '随快照观察的丢失及生命周期决策计数，用于区分保留丢失、采样和禁用摄取。'
      ),
      example: queryExample,
      members: {
        evicted: f(
          'Number of oldest main-ring events overwritten by bounded retention.',
          '因有界保留而覆盖的最旧主环事件数量。'
        ),
        contentDropped: f(
          'Number of captures discarded because the retained content byte budget would be exceeded.',
          '因保留内容超出字节预算而丢弃的捕获内容数量。'
        ),
        droppedReentrant: f(
          'Events rejected because synchronous ingestion was reentered before the previous event completed.',
          '前一事件尚未完成时同步重入摄取而被拒绝的事件数量。'
        ),
        sampledOut: f(
          'Events discarded by deterministic sender/message sampling at collector ingestion.',
          '在采集器摄取时被确定性发送者与消息采样丢弃的事件数量。'
        ),
        ignoredWhilePaused: f(
          'Direct emit attempts ignored after pause; unsubscribed emitters normally do not call the collector.',
          '暂停后被忽略的直接发射尝试数量，取消订阅的发射器通常不会调用采集器。'
        ),
        ignoredAfterClose: f(
          'Direct emit attempts ignored after terminal collector closure.',
          '采集器终态关闭后被忽略的直接发射尝试数量。'
        ),
        internOverflow: f(
          'Reader-side names exceeding the bounded intern table and mapped to its explicit overflow marker.',
          '读取侧名称超出有界驻留表并映射到显式溢出标记的数量。'
        )
      }
    },
    IRpcDevtoolsPage: {
      summary: t(
        'Query snapshot with ordered retained events, the last scanned sequence cursor and loss counters captured at that read.',
        '查询快照，包含有序保留事件、最后扫描序号游标及该次读取捕获的丢失计数。'
      ),
      example: queryExample,
      members: {
        events: f(
          'Matching IRpcDevtoolsWireEvent rows in collector sequence order; elements may retain cached boundary references.',
          '按采集器序号排序的匹配线事件行，元素可保留缓存边界引用。'
        ),
        nextSeq: f(
          'Collector-issued cursor for the next query afterSeq; scanning excluded rows can advance it even when events is empty.',
          '供下次查询下界使用的采集器游标，即使匹配事件为空，扫描被排除行仍可推进它。'
        ),
        counters: f(
          'IRpcDevtoolsCounters snapshot explaining observed retention and ingestion loss.',
          '说明当前保留及摄取丢失的计数快照。'
        )
      }
    },
    IRpcDevtoolsWatchBatch: {
      summary: t(
        'One future-event watch delivery, with filtered event rows and loss since the previous delivered batch.',
        '一次未来事件观察交付，包含筛选事件行及前一交付批次之后的丢失。'
      ),
      example: watchExample,
      members: {
        events: f(
          'At most 256 matching future wire events retained by this watcher.',
          '当前观察者保留、至多二百五十六个匹配未来线事件。'
        ),
        dropped: f(
          'Events lost to watcher queues plus raw shared-window overwrite before filtering; raw losses cannot be reconstructed as filtered matches.',
          '观察队列丢失与筛选前共享原始窗口覆盖数量之和，原始丢失无法还原为筛选后命中数量。'
        )
      }
    },
    IRpcDevtoolsStats: {
      summary: t(
        'Cumulative endpoint/method settlement aggregates independent of query-ring eviction. Twenty-four exponential histogram boundaries start at 0.0625 milliseconds; quantiles interpolate and clamp to observed maximum.',
        '不受查询环淘汰影响的端点与方法累计结算聚合，二十四个指数直方图边界始于 `0.0625` 毫秒，分位数插值并钳制在已观察最大值内。'
      ),
      example: queryExample,
      members: {
        since: f(
          'Statistics window start timestamp, reset when the collector statistics are cleared.',
          '统计窗口起始时间戳，清空采集统计时重置。'
        ),
        methods: f(
          'Per endpointId/method rows: calls counts qualified settlements; failed/rejected/timedOut/aborted classify outcomes. latencyBucketsMs are boundaries, latencyCounts are counts; optional latencyOverflowFromMs starts the open final bucket and latencyMaxMs bounds interpolation. p50Ms/p95Ms/p99Ms are percentile milliseconds. Endpoint IDs and methods originate from observed Core events.',
          '按观察核心事件的端点标识及方法分组；调用计数记录合格结算，失败、拒绝、超时及取消分别分类；延迟边界数组与计数数组记录直方图，可选溢出下界标识末尾开放桶，可选最大值限制插值，三个分位数字段分别为五十、九十五及九十九百分位毫秒数。'
        )
      }
    },
    IRpcDevtoolsDescribe: {
      summary: t(
        'Collector description snapshot used locally or by live hub clock sampling; includes no transport ownership.',
        '本地或实时聚合时钟采样使用的采集器描述快照，不包含传输所有权。'
      ),
      example: collectorExample,
      members: {
        version: f(
          'Current service observation contract version string, currently one.',
          '当前服务观察契约版本字符串，目前为版本一。'
        ),
        now: f(
          'Fresh systemScheduler monotonic millisecond sample, in the same domain as default Core event at. Custom-clock clients must supply a matching sample; stats.since remains wall-clock time.',
          '描述调用读取的系统调度器单调毫秒采样，与默认核心事件时间同域；自定义时钟客户端须提供同域采样，统计起点仍为墙上时钟。'
        ),
        paused: f(
          'Whether collector subscriptions are currently paused.',
          '当前采集器订阅是否处于暂停状态。'
        ),
        descriptors: f(
          'Known IRpcProbeDescriptor references supplied by installed Core emitters; Core owns their stage and capability semantics.',
          '已安装核心发射器提供的已知描述引用，阶段与能力语义归核心包拥有。'
        ),
        limits: f(
          'Captured maxEvents main-ring capacity and maxContentBytes content budget from collector construction.',
          '采集器构造时捕获的主环事件容量与内容字节预算。'
        ),
        counters: f(
          'Current IRpcDevtoolsCounters snapshot explaining data loss and lifecycle decisions.',
          '说明数据丢失及生命周期决策的当前计数快照。'
        )
      }
    },
    IRpcDevtoolsWireEvent: {
      summary: t(
        'Reader/service event representation; top-level metadata is copied from synchronous reusable views, while detail, error and captured content may retain their nested references.',
        '读取及服务事件表示，顶层元数据从同步复用视图复制，细节、错误及捕获内容可保留其嵌套引用。'
      ),
      example: recordExample,
      members: wireMembers
    },
    IRpcWireError: {
      summary: t(
        'The error data stored in a Devtools event when an error must cross a connection. It is another name for [IRpcSerializedError](/en/docs/rpc-contract/api/errors/IRpcSerializedError), defined by RPC Contract. That format carries source and code for classification, stack for the original call trace, and references to causes or grouped errors. Devtools uses this shared format so error details can be read without inventing a second representation.',
        '错误需要通过连接传递时，调试事件用这个类型保存错误数据。它是 RPC Contract 定义的 [IRpcSerializedError](/zh/docs/rpc-contract/api/errors/IRpcSerializedError) 的另一个名称。其中 source 和 code 用于区分错误来源及类别，stack 保存原始调用堆栈，其他引用记录原因或一组相关错误。调试工具直接使用这份共同格式，读取事件时无需再转换成另一套错误表示。'
      ),
      example: recordExample,
      members: {}
    },
    IRpcDevtoolsRecord: {
      summary: t(
        'Offline ordered recording with a frozen format header and event array. Native errors and bytes are restored around the record codec. At any event depth, a single-key {$bytes: base64} object is reserved v1 byte syntax and decodes as Uint8Array. Unknown content is not lossless for arbitrary objects; store same-shaped business data as JSON text, with no automatic escaping.',
        '离线有序录制，包含固定格式头及事件数组，编解码恢复原生错误和字节；事件任意深度的单键字节标签对象是第一版保留语法，解码为字节数组；未知内容不保证任意对象无损，同形业务对象应自行存为对象文本，不自动转义。'
      ),
      scenarios: [
        t(
          'Save a stopped observation window and import it into an offline hub without live connections.',
          '保存已停止观察窗口，并在无实时连接时导入离线聚合器。'
        )
      ],
      example: recordExample,
      members: {
        header: f(
          'IRpcDevtoolsRecordHeader with exact RpcDevtoolsRecordFormat format and version identity.',
          '包含规范记录格式及版本精确身份的记录头。'
        ),
        events: f(
          'IRpcDevtoolsRecordEvent array preserving recorded order, with native or canonical wire errors accepted at input.',
          '保留录制顺序的记录事件数组，输入接受原生或规范线错误。'
        )
      }
    },
    IRpcDevtoolsRecordHeader: {
      summary: t(
        'Readonly exact header shape of RpcDevtoolsRecordFormat: format is migaia-rpc-devtools and numeric version is one; no clock or descriptor data is implied.',
        '规范记录格式常量的精确只读头形状，格式标识固定且数字版本为一，不暗含时钟或端点描述数据。'
      ),
      example: recordExample,
      members: {
        format: f(
          'Exact format marker migaia-rpc-devtools, selecting this NDJSON grammar.',
          '精确格式标记 `migaia-rpc-devtools`，用于选择当前逐行语法。'
        ),
        version: f(
          'Exact numeric version one; other versions are rejected instead of silently migrated.',
          '精确数字版本一，其他版本会被拒绝而非静默迁移。'
        )
      }
    },
    IRpcDevtoolsRecordEvent: {
      summary: t(
        'Wire event fields with an error override accepting a native Error or the external canonical wire error graph. Decoding restores native errors without rebuilding their stacks.',
        '线事件字段附带错误表示覆盖，接受原生错误或外包规范线错误图，解码恢复原生错误且不重建堆栈。'
      ),
      example: recordExample,
      members: {
        ...wireMembers,
        error: f(
          'Optional native Error or IRpcWireError supplied by a stopped recording or application; codec preserves the canonical cause graph and stacks.',
          '已停止录制或应用提供的可选原生错误或规范线错误，编解码器保留规范原因图及堆栈。',
          'Absent when no error belongs to the event.',
          '事件没有所属错误时省略。'
        )
      }
    },
    IRpcDevtoolsServiceApi: {
      summary: t(
        'Remote-facing nested service contract installed from collector.service on a caller-owned separate Peer. Results cross a portable conversion boundary; by default content is omitted and actual serving endpoints are excluded.',
        '由采集器服务对象安装到调用者独立连接的远端嵌套服务契约，结果经过可移植转换边界，默认省略内容并排除实际服务端点。'
      ),
      scenarios: [
        t(
          'Expose diagnostics over an existing dedicated Runtime Peer using its provide option and namespace-aware client adapter.',
          '经已有专用运行时连接的提供选项及命名空间客户端适配暴露诊断。'
        )
      ],
      example: serviceExample,
      members: {
        describe: collectorMembers.describe!,
        query: collectorMembers.query!,
        watch: collectorMembers.watch!,
        stats: collectorMembers.stats!,
        clear: collectorMembers.clear!,
        pause: collectorMembers.pause!,
        resume: collectorMembers.resume!,
        record: f(
          'Nested recording API: start(input?) takes optional positive maxEvents defaulting to collector capacity and returns nothing; stop() takes no arguments and returns encoded NDJSON. Pair start with stop; duplicate start uses RECORD_ACTIVE and absent recording uses RECORD_NOT_ACTIVE.',
          '嵌套录制接口：`record.start(input?)` 接收可选正容量，默认采集器容量且无返回值，`record.stop()` 无参数并返回编码文本；重复启动使用活动录制错误，缺少录制使用未活动错误。'
        ),
        'record.start': {
          summary: t(
            'Starts the collector independent recording through the service boundary.',
            '经服务边界启动采集器独立录制。'
          ),
          params: {
            input: t(
              'Optional maxEvents capacity; defaults to the collector capacity.',
              '可选事件容量，默认采集器容量。'
            )
          },
          returns: t(
            'No result; RECORD_ACTIVE if another recording owns the collector.',
            '无返回值，已有录制拥有采集器时抛活动录制错误。'
          ),
          example: serviceExample
        },
        'record.stop': {
          summary: t(
            'Stops the current recording and returns the encoded text through the service.',
            '停止当前录制并经服务返回编码文本。'
          ),
          returns: t(
            'NDJSON string, or RECORD_NOT_ACTIVE when no recording remains active.',
            '返回逐行文本，没有活动录制时抛未活动录制错误。'
          ),
          example: serviceExample
        }
      }
    },
    IRpcDevtoolsHub: {
      summary: t(
        'Caller-owned hub returned by createRpcDevtoolsHub, retaining per-target references and one live watch per client. It owns watch release and alignment timers, but never owns client connections.',
        '聚合器工厂返回的调用者实例，保留每目标引用且每个实时客户端拥有一个观察流，负责流释放及对齐计时器，不拥有客户端连接。'
      ),
      scenarios: [
        t(
          'Combine worker, browser and process observation clients or compare offline recordings without fabricating missing call sides.',
          '合并工作线程、浏览器及进程观察客户端，或比较离线录制，不编造缺失调用侧。'
        )
      ],
      example: hubExample,
      members: {
        addTarget: {
          summary: t(
            'Registers a unique live target, aligns its clock, starts its one watch read before querying history, then consumes the buffered watch with sequence deduplication. The client must expose bare describe/query/watch/stats method names.',
            '注册唯一实时目标，对齐时钟后先启动唯一观察流读取再查询历史，之后消费缓冲观察并按序号去重，客户端需暴露不含命名空间前缀的描述、查询、观察及统计方法。'
          ),
          params: {
            name: t(
              'Nonempty application-chosen name, unique among current live and offline target registrations.',
              '应用指定的非空名称，在当前实时及离线目标注册中唯一。'
            ),
            client: t(
              'Already connected IRpcDevtoolsTargetClient supplied by the caller. Adapt a namespaced remote Peer so bare service names reach collector.service.',
              '调用者提供的已连接目标客户端，需将带命名空间远端连接适配为裸服务名可到达采集器服务。'
            )
          },
          returns: t(
            'Promise<void> after setup, retaining the caller client connection. Duplicate names use TARGET_DUPLICATE; invalid input uses INVALID_OPTION; setup failure marks disconnected and rejects with the original error after acquired watch rollback; independent cleanup failure is reported separately without replacing the primary.',
            '设置后兑现空承诺，保留调用者客户端连接，重名使用 `TARGET_DUPLICATE`，非法输入使用 `INVALID_OPTION`，设置失败标记断开，回滚已取得观察后以原错误拒绝，独立清理失败另行报告，不替换主错。'
          ),
          example: liveHubExample
        },
        removeTarget: {
          summary: t(
            'Detaches target events and correlation synchronously, then awaits its original iterator return; repeated removal of the same known name is harmless.',
            '同步分离目标事件及关联，再等待其原始迭代器结束，重复移除同一已知名称无额外影响。'
          ),
          params: { name: targetName },
          returns: t(
            'Promise<void> after watch release; original return failures are reported and reject. Never-registered names use TARGET_UNKNOWN.',
            '观察流释放后兑现空承诺，原始结束失败会报告并拒绝，未注册名称使用 `TARGET_UNKNOWN`。'
          ),
          example: hubExample
        },
        importRecord: {
          summary: t(
            'Decodes and validates a complete record before publishing a read-only offline target; uses zero offset and no clock uncertainty sample.',
            '发布只读离线目标前解码并校验完整记录，使用零偏移且不提供时钟不确定性采样。'
          ),
          params: {
            name: t(
              'Nonempty unique name selected by the importing application for this offline target.',
              '导入应用为当前离线目标选择的非空唯一名称。'
            ),
            text: t(
              'Version-one NDJSON from encodeRpcDevtoolsRecord or collector exportRecord.',
              '来自记录编码函数或采集器导出函数的第一版逐行文本。'
            )
          },
          returns: t(
            'No result; the offline target is registered. Invalid text uses RECORD_FORMAT_INVALID and duplicate names use TARGET_DUPLICATE.',
            '无返回值，离线目标已注册，非法文本使用 `RECORD_FORMAT_INVALID`，重名使用 `TARGET_DUPLICATE`。'
          ),
          example: hubExample
        },
        status: {
          summary: t(
            'Reads one target status or snapshots all target statuses, including names remembered as removed.',
            '读取单个目标状态或取得所有目标状态快照，包含记为已移除的名称。'
          ),
          params: {
            name: t(
              'Optional name from addTarget or importRecord; omitted by default to request a readonly map of all names.',
              '可选已添加或已导入名称，默认省略并请求所有名称的只读映射。'
            )
          },
          returns: t(
            'RpcDevtoolsTargetStatus or a new ReadonlyMap. Unknown individual names throw TARGET_UNKNOWN; closed hub throws CLOSED.',
            '返回目标状态或新只读映射，未知单名抛 `TARGET_UNKNOWN`，关闭聚合器抛 `CLOSED`。'
          ),
          example: hubExample
        },
        timeline: {
          summary: t(
            'Sorts retained events globally by aligned timestamp, then target name and sequence. Ordered targets use a checked merge; legal nonmonotonic records use full sorting before limit. Returned elements are stored references and may be realigned later.',
            '按对齐时间、目标名及序号全局排序；有序目标先检查后合并，合法非单调记录完整排序后再应用上限，返回元素为已存引用，随后重对齐可能修改包装值。'
          ),
          params: {
            query: t(
              'Optional IRpcDevtoolsTimelineQuery; omitted means all retained targets and times without a result limit.',
              '可选时间线筛选，默认全部保留目标及时间且不限制结果数量。'
            )
          },
          returns: t(
            'Readonly array of IRpcDevtoolsTimelineEvent. Zero limit returns empty; invalid limit uses INVALID_OPTION and closed hub uses CLOSED.',
            '返回只读时间线事件数组，零上限返回空，非法上限使用 `INVALID_OPTION`，关闭使用 `CLOSED`。'
          ),
          example: hubExample
        },
        interactions: {
          summary: t(
            'Queries incrementally maintained interaction membership using observed sender/message identity and explicit traces. It does not infer missing caller or provider events.',
            '按已观察发送者与消息身份及显式追踪查询增量交互成员，不推断缺失调用者或提供者事件。'
          ),
          params: {
            trace: t(
              'Optional explicit trace read from events or application propagation; omitted by default to return all retained interactions.',
              '可选来自事件或应用传播的显式追踪标识，默认省略并返回所有保留交互。'
            )
          },
          returns: t(
            'Readonly array of retained IRpcDevtoolsInteraction references; oneSided remains true until both logical sides are actually observed.',
            '返回保留交互引用的只读数组，只有实际观察到两侧后才取消单侧标记。'
          ),
          example: hubExample
        },
        stats: {
          summary: t(
            'Forwards one live target statistics result or aggregates histogram buckets across live targets. Offline version-one records carry no statistics payload.',
            '转发单个实时目标统计或跨实时目标聚合直方图桶，第一版离线记录不携带统计载荷。'
          ),
          params: {
            name: t(
              'Optional registered target name; omission aggregates live target results, while a named offline target returns empty statistics.',
              '可选已注册目标名，省略则聚合实时目标结果，指定离线目标返回空统计。'
            )
          },
          returns: t(
            'Promise<IRpcDevtoolsStats>; request failures are reported and reject without inventing counts.',
            '返回统计承诺，请求失败会报告并拒绝，不编造计数。'
          ),
          example: hubExample
        },
        on: {
          summary: t(
            'Adds a synchronous status or event observer. Status callbacks receive registered name and status; event callbacks receive the retained timeline wrapper. Listener throws are reported while other listeners continue.',
            '添加同步状态或事件观察者，状态回调接收注册名与状态，事件回调接收保留时间线包装，回调抛错被报告且继续其他观察者。'
          ),
          params: {
            event: t(
              'Choose status for target lifecycle changes or event for accepted timeline items.',
              '选择状态事件观察目标生命周期变化，或事件项观察已接纳时间线条目。'
            ),
            listener: t(
              'Synchronous callback: (name, status) for status or (event) for event. Values come from hub registration and ingestion; no return is used, async callbacks are not awaited.',
              '同步回调，状态形态接收名称与状态，事件形态接收时间线条目，值来自聚合注册及摄取，不使用返回值且不等待异步回调。'
            )
          },
          returns: t(
            'Idempotent unsubscribe function taking no arguments; close also releases all listener slots.',
            '返回无参数幂等取消订阅函数，关闭也会释放全部观察者槽。'
          ),
          values: {
            status: t(
              'Observe every target lifecycle transition, including connection, disconnection, offline import and removal.',
              '观察每次目标生命周期变化，包含连接、断开、离线导入与移除。'
            ),
            event: t(
              'Observe each accepted retained timeline wrapper, without a replay of historical events.',
              '观察每个已接纳保留时间线包装，不重放历史事件。'
            )
          },
          example: hubExample
        },
        close: {
          summary: t(
            'Synchronously rejects new operations and detaches target state, then releases all watches concurrently. Each target release failure is reported in registration order as a native AggregateError with TARGET_RELEASE_FAILED, first cause and all original errors. Application client failures otherwise retain their original identity.',
            '同步拒绝新操作并分离目标状态，然后并发释放全部观察流，目标释放失败按注册顺序以原生汇总错误及 `TARGET_RELEASE_FAILED` 报告，原因保留首错、错误列表保留全错；应用客户端失败仍保持原身份。'
          ),
          returns: t(
            'Same Promise<void> on repeated calls, resolved after releases and listener cleanup. Release errors are reported instead of rejecting this close promise; client connections stay caller-owned.',
            '重复调用返回同一空承诺，流释放及观察者清理后兑现，释放错误通过报告处理而不拒绝关闭承诺，客户端连接仍归调用者。'
          ),
          example: hubExample
        }
      }
    },
    IRpcDevtoolsHubOptions: {
      summary: t(
        'Construction-time per-target capacity, optional periodic clock realignment and failure reporting; no transport or client is created from these settings.',
        '构造期每目标容量、可选周期时钟重对齐及失败报告设置，不据此创建传输或客户端。'
      ),
      example: hubExample,
      members: {
        maxEvents: f(
          'Positive safe per-target retention capacity, at most 4294967295 events.',
          '每目标保留容量的正安全整数，最多 `4294967295` 个事件。',
          '50000 events independently for each target.',
          '默认每个目标独立保留五万事件。'
        ),
        realignMs: f(
          'Finite positive period in milliseconds for five-sample live target realignment; at most one realignment runs per target.',
          '实时目标五次采样重对齐的有限正毫秒周期，每目标至多运行一个重对齐任务。',
          'Omitted; only initial registration performs alignment.',
          '默认省略，仅初始注册执行对齐。'
        ),
        onError: {
          ...onErrorDoc,
          default: t(
            'Reports failures with host console.error; a supplied callback that throws is reported with the original error in an aggregate.',
            '默认由宿主错误控制台报告，提供的回调抛错时与原始错误一起聚合报告。'
          ),
          example: hubExample
        }
      }
    },
    IRpcDevtoolsTargetClient: {
      summary: t(
        'Caller-owned already connected service client adapter. Bare method names match IRpcDevtoolsServiceApi; adapt a namespaced Runtime Peer without moving connection ownership into the hub.',
        '调用者拥有的已连接服务客户端适配器，裸方法名匹配诊断服务契约，适配带命名空间运行时连接时不把连接所有权转交聚合器。'
      ),
      example: liveHubExample,
      members: {
        request: {
          summary: t(
            'Callback invoked by the hub for describe, query and stats service methods; forwarding rejects propagate to the corresponding hub operation.',
            '聚合器为描述、查询及统计服务调用的方法，转发拒绝传播给对应聚合操作。'
          ),
          params: {
            method: t(
              'Bare service method name supplied by the hub, such as describe, query or stats.',
              '由聚合器提供的裸服务方法名，例如描述、查询或统计。'
            ),
            payload: t(
              'Optional service input supplied by hub catch-up, including afterSeq and limit for queries; default is absent.',
              '聚合历史追赶提供的可选服务输入，查询含游标及上限，默认省略。'
            )
          },
          returns: t(
            'Promise of the remote service result; the client owns timeout and transport behavior.',
            '返回远端服务结果的承诺，超时及传输行为归客户端拥有。'
          ),
          example: liveHubExample
        },
        stream: {
          summary: t(
            'Callback invoked by the hub to acquire the watch service stream; the hub owns only its returned iterator lifetime.',
            '聚合器用来取得观察服务流的方法，聚合器仅拥有返回迭代器的生命周期。'
          ),
          params: {
            method: t(
              'Bare watch method name supplied by hub live registration.',
              '由聚合实时注册提供的裸观察服务方法名。'
            ),
            payload: t(
              'Optional watch filter from the hub; current live registration omits it by default.',
              '聚合器提供的可选观察筛选，当前实时注册默认省略。'
            )
          },
          returns: t(
            'AsyncIterable of remote watch batches; iterator failure is reported and marks the target disconnected.',
            '返回远端观察批次异步迭代源，迭代失败会报告并标记目标断开。'
          ),
          example: liveHubExample
        }
      }
    },
    IRpcDevtoolsTimelineQuery: {
      summary: t(
        'Filters retained aligned events; time bounds are inclusive and absent limits permit the entire retained result.',
        '筛选保留对齐事件，时间上下界均包含边界，省略上限时允许全部保留结果。'
      ),
      example: hubExample,
      members: {
        targets: f(
          'Registered names chosen by addTarget or importRecord.',
          '添加目标或导入记录时选择的注册名称。',
          'All current targets are eligible.',
          '默认可选择所有当前目标。'
        ),
        stages: f(
          'Canonical Core stage names copied from observed wire events.',
          '从观察线事件复制的核心规范阶段名称。',
          'All retained stages are eligible.',
          '默认可选择全部保留阶段。'
        ),
        trace: f(
          'Explicit trace from application propagation or an observed event.',
          '来自应用传播或观察事件的显式追踪标识。',
          'No trace filter is applied.',
          '默认不施加追踪筛选。'
        ),
        method: f(
          'Exact method path from observed events or the application method catalog.',
          '观察事件或应用方法目录中的精确方法路径。',
          'No method filter is applied.',
          '默认不施加方法筛选。'
        ),
        from: f(
          'Inclusive lower aligned timestamp read from timeline event alignedAt.',
          '从时间线对齐时间字段取得的包含式下界。',
          'No lower time bound is imposed.',
          '默认不施加时间下界。'
        ),
        to: f(
          'Inclusive upper aligned timestamp in the same clock domain as alignedAt.',
          '与对齐时间处于相同时钟域的包含式上界。',
          'No upper time bound is imposed.',
          '默认不施加时间上界。'
        ),
        limit: f(
          'Nonnegative safe integer result limit; zero intentionally returns no events.',
          '非负安全整数结果上限，零明确返回空事件。',
          'Unlimited within retained target data.',
          '默认在目标保留数据内不限制结果数量。'
        )
      }
    },
    IRpcDevtoolsTimelineEvent: {
      summary: t(
        'Hub-owned wrapper around an unchanged wire event; live realignment can mutate the wrapper alignedAt and uncertainty while preserving original event identity.',
        '聚合器拥有、包裹不变线事件的包装，实时重对齐可修改对齐时间及不确定性，同时保留原始事件身份。'
      ),
      example: hubExample,
      members: {
        target: f(
          'Application name registered through addTarget or importRecord.',
          '应用经添加目标或导入记录注册的名称。'
        ),
        alignedAt: f(
          'Original event timestamp minus target offset; offline records use offset zero.',
          '原事件时间戳减目标偏移，离线记录使用零偏移。'
        ),
        uncertaintyMs: f(
          'Half the minimum round-trip duration among five alignment samples; undefined for offline records without clock metadata.',
          '五次对齐采样最小往返时长的一半，不含时钟元数据的离线记录使用未定义。'
        ),
        interaction: f(
          'Hub-issued correlation key derived from observed sender/message identity or a resolved carrier link.',
          '聚合器依据已观察发送者与消息身份或已解析载体链接签发的关联键。',
          'Absent when no explicit logical identity can be associated.',
          '无法关联显式逻辑身份时省略。'
        ),
        trace: f(
          'Explicit trace copied from the original event or its observed logical correlation.',
          '从原始事件或已观察逻辑关联复制的显式追踪标识。',
          'Absent when the observation carries no trace.',
          '观察未携带追踪标识时省略。'
        ),
        event: f(
          'Original IRpcDevtoolsWireEvent reference retained without changing its source timestamp.',
          '保留且不修改来源时间戳的原始线事件引用。'
        )
      }
    },
    IRpcDevtoolsInteraction: {
      summary: t(
        'Retained observed logical hop with explicit identity and actual side witnesses; no missing sender, receiver or event is synthesized.',
        '具有显式身份及实际侧别证据的保留逻辑交互，不合成缺失发送者、接收者或事件。'
      ),
      example: hubExample,
      members: {
        key: f(
          'Stable hub-issued interaction key derived from explicit source sender/message identity.',
          '聚合器从显式来源发送者及消息身份生成的稳定交互键。'
        ),
        trace: f(
          'Observed explicit trace associated with this interaction, not an invented end-to-end identity.',
          '当前交互关联的已观察显式追踪标识，不是编造的端到端身份。',
          'Absent when no retained member carries a trace.',
          '保留成员均未携带追踪标识时省略。'
        ),
        method: f(
          'Observed method path from an interaction member.',
          '取自当前交互某个成员的已观察方法路径。',
          'Absent when no member exposes a method.',
          '没有成员暴露方法时省略。'
        ),
        oneSided: f(
          'True until retained request/reply kind and direction evidence shows both caller and provider sides.',
          '在保留的请求回复种类与方向证据证明调用者及提供者两侧之前为真。'
        ),
        targets: f(
          'Registered application target names with retained membership in this interaction.',
          '在当前交互中仍有保留成员的应用注册目标名称。'
        ),
        events: f(
          'Retained IRpcDevtoolsTimelineEvent references; eviction and target removal update membership.',
          '保留的时间线事件引用，淘汰与目标移除会更新成员。'
        )
      }
    },
    IRpcLogProbeOptions: {
      summary: t(
        'Construction-time qualification, capture and logger dispatch policy; only message and peer stages are supported by this first-party log probe.',
        '构造期条件选择、捕获及日志分派策略，此内置日志探针仅支持消息与连接阶段。'
      ),
      example: logExample,
      members: {
        ...probeOptionMembers,
        slowMs: f(
          'Finite nonnegative settlement duration threshold for successful slow-call logging.',
          '为成功慢调用记录日志的有限非负毫秒结算阈值。',
          'Absent; successful calls do not qualify as slow.',
          '默认省略，成功调用不会按慢调用条件进入日志。'
        ),
        stages: {
          ...f(
            'Subscribed log stages; only message settlements and peer lifecycle belong to this helper.',
            '订阅日志阶段，此辅助函数仅处理消息结算及连接生命周期。',
            'message and peer stages.',
            '默认消息与连接阶段。'
          ),
          values: {
            message: t(
              'Observe message settlement failures, rejections and configured slow calls.',
              '观察消息结算失败、拒绝及已配置的慢调用。'
            ),
            peer: t(
              'Observe peer lifecycle events using the lifecycle log category.',
              '使用生命周期日志分类观察连接生命周期事件。'
            )
          }
        },
        content: f(
          'Enables capture for subscribed stages when capture is omitted; explicit capture also permits captured fields to reach the logger.',
          '未指定捕获列表时为订阅阶段开启捕获，显式捕获列表同样允许捕获字段进入日志。',
          'false, with capture disabled unless explicitly requested.',
          '默认假，除非显式要求，否则不捕获内容。'
        ),
        levels: {
          ...f(
            'Category overrides: failed, rejected, timeout, aborted, slow and lifecycle map to a named sink level or off.',
            '分类覆盖：失败、拒绝、超时、取消、慢调用及生命周期各自映射到命名接收级别或关闭。',
            'failed uses error, lifecycle uses info, and rejected/timeout/aborted/slow use warn.',
            '默认失败用错误级，生命周期用信息级，拒绝、超时、取消及慢调用用警告级。'
          ),
          values: {
            debug: t(
              'Invoke logger.debug once for a qualifying event of the selected category.',
              '为所选分类的合格事件调用一次调试日志方法。'
            ),
            info: t(
              'Invoke logger.info once; default for peer lifecycle observations.',
              '调用一次信息日志方法，连接生命周期默认使用此级别。'
            ),
            warn: t(
              'Invoke logger.warn once; default for rejection, timeout, abort and slow events.',
              '调用一次警告日志方法，拒绝、超时、取消及慢调用默认使用此级别。'
            ),
            error: t(
              'Invoke logger.error once; default for ordinary call failures.',
              '调用一次错误日志方法，普通调用失败默认使用此级别。'
            ),
            off: t(
              'Skip message construction and logger invocation for this category.',
              '跳过当前分类的消息构造及日志接收端调用。'
            )
          }
        },
        message: {
          summary: t(
            'Synchronous formatter called only for qualifying enabled events. Receives a reusable Core event view valid during the callback; return a string and never retain the view. Throws are reported through onError.',
            '仅对合格且启用的事件执行同步格式化，接收仅回调期间有效的复用核心事件视图，返回字符串且不可保存视图，抛错经错误观察回调报告。'
          ),
          params: {
            view: t(
              'Emitter-owned IRpcProbeEventView supplied for one synchronous formatting call.',
              '发射器拥有、供单次同步格式化调用使用的复用视图。'
            )
          },
          returns: t(
            'String passed as logger message; async formatters are unsupported.',
            '作为日志消息传给接收端的字符串，不支持异步格式化。'
          ),
          default: t(
            'Stable built-in message for the classified failure, rejection, timeout, abort, slow or lifecycle category.',
            '默认使用失败、拒绝、超时、取消、慢调用或生命周期分类的稳定内置消息。'
          ),
          example: logExample
        }
      }
    },
    IRpcLogSink: {
      summary: t(
        "The application logger supplied to the log probe, with required debug, info, warn and error methods. The probe forwards matching RPC events to these methods. Each method runs with the original logger as its receiver, so it can use that logger's instance state. Each method should accept or queue its record promptly; the logger owns buffering and writing to its destination. The probe does not wait for a returned Promise to finish, but observes its rejection. A thrown error or rejection is passed to onError.",
        '应用提供给日志探针的日志对象，必须包含 debug、info、warn 和 error 四个方法。探针把符合条件的 RPC 事件转交这些方法。调用时仍以原日志对象作为方法的接收者，因此方法可以使用该日志对象的实例状态。方法应尽快接收记录或将其入队，缓冲和实际写入由日志对象负责。探针不会等待返回的 Promise 完成，但会接收它的失败；同步抛错或 Promise 失败均交给 onError。'
      ),
      example: logExample,
      members: Object.fromEntries(
        ['debug', 'info', 'warn', 'error'].map((level) => [
          level,
          {
            summary: t(
              `Receives an RPC event that passes the log filter and is assigned to the ${level} level.`,
              `接收通过日志筛选、被分配到 \`${level}\` 级别的 RPC 事件。`
            ),
            params: {
              message: t(
                'String from the built-in category text or synchronous message formatter.',
                '来自内置分类文本或同步格式化回调的字符串。'
              ),
              fields: t(
                'Probe-created fields containing method/message/sender/target/trace, duration, outcome, kind, rejection, lifecycle, peer and original error; optional captured content retains its reference.',
                '探针创建的字段，包含方法、消息、发送者、目标、追踪、耗时、结果、种类、拒绝、生命周期、连接及原始错误，可选捕获内容保留引用。'
              )
            },
            returns: t(
              'Any caller result; thenable rejections are observed, other values are ignored and no sink is awaited.',
              '可返回任意值，承诺拒绝会被观察，其他值忽略，不等待接收端。'
            ),
            example: logExample
          }
        ])
      )
    },
    IRpcDevtoolsErrorCode: {
      summary: t(
        'Value union of the devtools semantic code table; classify with RPC_DEVTOOLS_SOURCE and preserve original cause chains.',
        '诊断语义错误表的值联合，与规范错误来源一起分类并保留原始原因链。'
      ),
      example: recordExample,
      members: {}
    }
  },
  enums: {
    RpcDevtoolsErrorCode: {
      summary: t(
        'Stable devtools package error categories, covering local collectors, records, logging and hub ownership.',
        '覆盖本地采集器、记录、日志及聚合所有权的稳定诊断包错误分类。'
      ),
      values: errorValues
    },
    RpcDevtoolsRecordFormat: {
      summary: t(
        'Exact record header identity; both values are required by the version-one NDJSON codec.',
        '精确记录头身份，第一版逐行编解码器要求同时提供两个值。'
      ),
      values: {
        format: t(
          'migaia-rpc-devtools selects this package offline record grammar.',
          '固定格式标识选择当前包的离线记录语法。'
        ),
        version: t(
          'One selects the frozen first record grammar; unsupported versions reject.',
          '版本一选择固定首版记录语法，不支持的版本会被拒绝。'
        )
      }
    },
    RpcDevtoolsTargetStatus: {
      summary: t(
        'Observed hub target states used by status queries and status callbacks.',
        '状态查询及状态观察回调使用的聚合目标观察状态。'
      ),
      values: statusValues
    }
  },
  enhancers: {
    createRpcLogProbe: {
      kind: 'plugin',
      target: 'IRpcEndpoint',
      summary: t(
        'Install the returned IRpcProbe through Core probePlugin. Existing endpoint observation gains qualified logger dispatch; no request methods or transport ownership are added.',
        '将返回探针经核心探针插件安装，使已有端点观察获得条件化日志分派，不新增请求方法或传输所有权。'
      ),
      install: logExample,
      grants: [],
      behaviors: [
        t(
          'Failures and qualifying slow or lifecycle observations dispatch one configured sink call; logger or formatter failure never changes business RPC results.',
          '失败及合格慢调用或生命周期观察分派一次配置接收调用，日志或格式化失败不改变业务调用结果。'
        )
      ],
      scenarios: [
        t(
          'Use an existing logger to observe operational failures without retaining a collector event ring.',
          '使用已有日志接收端观察运行失败，无需保留采集事件环。'
        )
      ],
      example: logExample
    }
  }
}
