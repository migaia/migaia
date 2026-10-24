/**
 * Bilingual contract reference checked against packages/rpc-contract/src/contract on 2026-10-17.
 * Canonical subpaths own symbols also re-exported by the root. This package owns wire data and
 * validation, never connections, execution admission, replay commits or native resources.
 */
import type {
  ILibraryReference,
  IMemberDoc,
  ISymbolDoc,
  IText,
  ITypeDoc,
  IEnumDoc,
  IOptionCaseDoc
} from './contract.js'
import { rpcContractCases } from './rpc-contract-cases.ts'

/** Every reader-facing text has explicit locales. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents one data property with optional omission policy. */
const p = (en: string, zh: string, fallback?: IText): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Documents method input, completion and a concrete usage. */
const m = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Runtime symbols are accumulated by their canonical exported name. */
const symbols: Record<string, ISymbolDoc> = {}
/** Literal domains document each public choice separately. */
const enums: Record<string, IEnumDoc> = {}
/** Registers a constant and its complete literal domain without repeating prose. */
function domain(name: string, en: string, zh: string, values: Record<string, IText>): void {
  enums[name] = { summary: t(en, zh), values }
  symbols[name] = {
    role: name.endsWith('ErrorCode') ? 'error' : 'constant',
    purpose: t(
      `${en} Each stable key below identifies one wire choice or diagnostic bound.`,
      `${zh}以下每个稳定键分别标识一种线上选择或诊断约束，必须遵守相应字段的使用边界。`
    ),
    example: `console.log(${name})`
  }
}
/** Registers a non-enum constant with its observable meaning. */
function scalar(name: string, en: string, zh: string, example = `console.log(${name})`): void {
  symbols[name] = { role: 'constant', purpose: t(en, zh), example }
}
/** Shared examples retain actual paired protocols and explicit completion. */
const handshakeExample = `import { createRpcHello, acceptRpcHandshake, completeRpcHandshake } from '@migaia/rpc-contract/handshake'
const first = { versions: [{ major: 1, minor: 1 }], codecs: ['json'], capabilities: [], peer: { id: 'a', runtime: 'node' } }
const second = { ...first, peer: { id: 'b', runtime: 'node' } }
const accepted = acceptRpcHandshake(second, createRpcHello(first))
if (accepted.ok) console.log(completeRpcHandshake(first, accepted.reply))`
/** Error conversion preserves the full native cause tree. */
const errorExample = `import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'
const wire = serializeRpcError(new RangeError('invalid count', { cause: new Error('root') }), { report: console.error })
const restored = deserializeRpcError(wire)
console.log(restored instanceof RangeError, restored.cause)`
/** A single complete frame can arrive at arbitrary physical chunk boundaries. */
const jsonExample = `import { encodeJsonRpcFrame, createJsonRpcFrameDecoder } from '@migaia/rpc-contract/framing/jsonrpc'
const frame = encodeJsonRpcFrame({ jsonrpc: '2.0', id: 1, method: 'ping' })
const decoder = createJsonRpcFrameDecoder()
const messages = [...decoder.push(frame.subarray(0, 7)), ...decoder.push(frame.subarray(7))]
decoder.finish()
decoder.close()
console.log(messages)`
/** Native length-prefix framing has its own callback-based decoder. */
const streamExample = `import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-contract/framing/stream'
const decoder = createRpcStreamFrameDecoder({ onFrame: (frame) => console.log(frame), onError: console.error })
const frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))
decoder.push(frame.subarray(0, 2))
decoder.push(frame.subarray(2))
decoder.finish()
decoder.close()`
/** String fragments remain owned by one framer and source/message pair. */
const framerExample = `import { createStringFramer } from '@migaia/rpc-contract/framing'
const framer = createStringFramer({ chunkBytes: 4 })
const context = { source: 'channel-a', messageId: 'message-1' }
for (const frame of framer.frame('hello world', context)) console.log(framer.accept(frame, context))
framer.close()`
/** External portable validator callback has a synchronous boundary. */
const portableCallback = t(
  'Optional synchronous application normalizer receives one untrusted payload and returns `IRpcPortableValue`; throws reject normalization. Omission uses the canonical portable walker.',
  '可选应用同步规范化回调，接收一个未可信载荷并返回 `IRpcPortableValue`；抛错会拒绝规范化，省略时使用规范遍历器。'
)
/** Common bounded data properties; context-specific variants override literal choices. */
const fields: Record<string, IMemberDoc> = {
  id: p(
    'Application or protocol-owner correlation identifier; preserve it on replies and controls for the same task.',
    '应用或协议所有者提供的关联标识；同一任务的响应及控制消息保持原值。'
  ),
  version: p(
    'Positive component format version chosen by the component owner, independent of package versions.',
    '组件所有者指定的正数格式版本，与包版本无关。'
  ),
  kind: p(
    'Wire discriminator selected by the producing protocol owner, not by transport or application payload shape.',
    '生产协议所有者选择的线上判别字段，不由载体或应用载荷形状推断。'
  ),
  profile: p(
    'Fixed protocol-owned profile marker that separates this grammar from application records.',
    '协议拥有的固定形态标记，用于区分此语法与普通应用记录。'
  ),
  type: p(
    'Protocol-specific form that selects the legal fields in this data record.',
    '选择此数据记录允许字段的协议专用形式。'
  ),
  payload: p(
    'Optional application data admitted through portable normalization, never routing or connection authority.',
    '经可移植规范化接纳的可选应用数据，不提供路由或连接权限。'
  ),
  data: p(
    'Portable data carried by the owning wire node; never replaces its semantic discriminator.',
    '所属线上节点携带的可移植数据，不替代其语义判别字段。'
  ),
  route: p(
    'Contract-owned routing data kept separate from the application payload.',
    '契约拥有的路由数据，与应用载荷分开保存。'
  ),
  source: p(
    'Stable semantic package source copied from the original error or supplied by the transport context.',
    '从原始错误复制或由载体上下文提供的稳定语义来源。'
  ),
  code: p(
    'Stable semantic error code retained across serialization; classify it together with source.',
    '序列化跨域保留的稳定语义错误码，应同时检查来源。'
  ),
  name: p(
    'Original native error class name or application-assigned diagnostic identity.',
    '原生错误类名称，或应用指定的诊断身份名称。'
  ),
  message: p(
    'Diagnostic message preserved with the owning failure; never use it as an authorization decision.',
    '随所属失败保留的诊断消息，不能据此作权限决定。'
  ),
  stack: p(
    'Original serialized stack text; restoration preserves it rather than regenerating a local stack.',
    '原始序列化堆栈文本；恢复时保留该值而非重新生成本地堆栈。'
  ),
  error: p(
    'Original or serialized failure carried by this failed result, preserving its causal diagnostics.',
    '当前失败结果携带的原始或序列化失败，保留其原因诊断。'
  ),
  cause: p(
    'Optional serialized primary cause node preserving the original causal chain.',
    '保留原始原因链的可选序列化主原因节点。'
  ),
  errors: p(
    'Optional ordered serialized aggregate children preserving original failure order.',
    '可选有序聚合错误子节点，保留原始失败顺序。'
  ),
  truncated: {
    ...p(
      'True marks a deliberately bounded error projection; absence means this node was not marked truncated.',
      '真值标识有意限界的错误投影；省略表示该节点未被标记截断。'
    ),
    values: {
      true: t(
        'The serializer omitted information to stay within bounds.',
        '序列化器为满足边界已经省略部分信息。'
      )
    }
  },
  pointer: p(
    'JSON-pointer location assigned by the validator to identify the failing or unknown field.',
    '校验器分配的对象指针位置，用来识别失败或未知字段。'
  ),
  field: p(
    'Field name read or reported at the associated pointer location.',
    '关联指针位置上被读取或报告的字段名称。'
  ),
  major: p(
    'Positive protocol major version; peers must share a major version to negotiate.',
    '正数协议主版本；双方必须共享主版本才能协商。'
  ),
  minor: p(
    'Nonnegative highest compatible minor version; agreement selects the lower shared value.',
    '最高兼容次版本非负数；协议结果选择双方较低的值。'
  ),
  codec: p(
    'Negotiated lowercase codec identity selected from both peers’ actual offers.',
    '从双方实际提议中选出的协商小写编解码身份。'
  ),
  codecs: p(
    'Ordered unique codec identities offered by the application; json is the mandatory baseline.',
    '应用提供的有序且不重复编解码身份，文本对象编码为必需基线。'
  ),
  capabilities: p(
    'Independent versioned capability declarations; only actual shared offers enable a feature.',
    '相互独立且带版本的能力声明；只有双方实际共有的提议才能启用能力。'
  ),
  peer: p(
    'Remote diagnostic peer identity retained from the received handshake, without runtime rights.',
    '从接收握手保留的远端诊断身份，不赋予运行时权限。'
  ),
  auth: p(
    'Optional application portable authentication data; keep tokens out of diagnostic output.',
    '可选应用可移植认证数据；不能把令牌写入诊断输出。'
  ),
  versions: p(
    'Unique supported major versions and each highest compatible minor version, supplied by the application.',
    '应用提供的互不重复支持主版本，以及每个主版本的最高兼容次版本。'
  ),
  runtime: p(
    'Lowercase diagnostic runtime label supplied by the application, such as node or python.',
    '应用提供的小写诊断运行时标签，例如 `node` 或 `python`。'
  ),
  runtimeVersion: p(
    'Optional application-supplied version of the remote runtime for diagnostics only.',
    '应用提供的可选远端运行时版本，仅用于诊断。'
  ),
  implementation: p(
    'Optional application implementation name/version record used only for diagnostics.',
    '可选应用实现名称和版本记录，只用于诊断。'
  ),
  applicationVersion: p(
    'Application protocol version chosen by the endpoint owner, separate from wire protocol version.',
    '端点所有者选择的应用协议版本，与线上协议版本分开。'
  ),
  senderId: p(
    'Source endpoint identifier issued by its endpoint factory and copied into outgoing routing metadata.',
    '源端点工厂签发并复制到出站路由元数据的端点标识。'
  ),
  targetId: p(
    'Target endpoint identifier received through discovery or explicitly assigned by the application.',
    '经发现结果取得或由应用明确指定的目标端点标识。'
  ),
  sentAt: p(
    'Sender-owned timestamp for this request, preserved during forwarding.',
    '发送方为本次请求提供的时间戳，转发时保持原值。'
  ),
  receiverId: p(
    'Final receiver identifier obtained from the selected remote binding or discovery result.',
    '从选定远端绑定或发现结果取得的最终接收端标识。'
  ),
  dispatchOnly: p(
    'Optional true routes one-way work without awaiting a business response.',
    '可选真值表示单向投递工作，不等待业务响应。'
  ),
  method: p(
    'Application method name chosen from the provider or remote contract being invoked.',
    '从待调用的提供方或远端契约中选择的应用方法名称。'
  ),
  manual: p(
    'Optional connection-owner flag marking explicit rather than automatic control.',
    '可选连接所有者标志，表示显式控制而非自动控制。'
  ),
  resolvedTargetId: p(
    'Final target identifier returned by discovery resolution, rather than an unresolved selector.',
    '由发现解析返回的最终目标标识，不是未解析选择条件。'
  ),
  platform: p(
    'Optional diagnostic platform label supplied by the endpoint owner.',
    '端点所有者提供的可选诊断平台标签。'
  ),
  accepted: p(
    'Optional response flag indicating whether the corresponding control was accepted.',
    '可选响应标志，表示相应控制是否被接受。'
  ),
  operation: {
    ...p(
      'Control operation selected by the owning protocol grammar.',
      '所属协议语法选择的控制操作标识。'
    ),
    values: {
      unregister: t('Remove the selected discovery registration.', '移除所选择的发现登记记录。')
    }
  },
  variation: p(
    'Application variation/control subtype chosen by the original endpoint owner.',
    '原始端点所有者选择的应用变化或控制子类型。'
  ),
  timeoutMs: p(
    'Optional relative operation deadline in integer milliseconds from `0` through `2147483647`; zero is allowed.',
    '可选相对操作截止毫秒数，须为 `0` 至 `2147483647` 的整数，允许零。',
    t(
      'Absent: no deadline is declared by this data record.',
      '默认不设置，此数据记录不声明截止时间。'
    )
  ),
  idempotencyKey: p(
    'Application-issued stable operation key reused only when requesting the same business effect.',
    '应用签发的稳定操作键，只在请求相同业务效果时复用。',
    t(
      'Absent: no idempotency lookup or reservation is requested.',
      '默认不设置，不请求幂等查询或预留。'
    )
  ),
  trace: p(
    'Optional caller-issued bounded diagnostic trace string preserved across hops.',
    '调用方签发的可选有界诊断追踪字符串，跨跳保留。'
  ),
  forwardRoute: p(
    'Optional ordered origin/forwarder node IDs supplied by the actual forwarding owner.',
    '实际转发所有者提供的可选有序来源和转发节点标识。'
  ),
  messageId: p(
    'Identifier assigned by the sender before fragmentation and reused by the transport for every matching fragment.',
    '发送方分片前分配，并由载体为每个对应分片复用的消息标识。'
  ),
  index: p(
    'Zero-based ordered fragment position; receiving another order is rejected.',
    '从零开始的有序分片位置；接收顺序不同会被拒绝。'
  ),
  count: p(
    'Total positive fragment count declared consistently on every fragment.',
    '每个分片一致声明的正数总分片数量。'
  ),
  length: p(
    'Declared complete encoded length; reassembly checks actual concatenated length before completion.',
    '声明的完整编码长度；重组完成前检查实际拼接长度。'
  ),
  bytes: p(
    'Actual encoded physical byte count measured by the canonical contract operation.',
    '规范契约操作测量的实际编码物理字节数量。'
  ),
  byteLength: p(
    'Full original binary backing size in bytes, including bytes outside any particular view.',
    '完整原始二进制背板的字节大小，包括特定视图之外的字节。'
  ),
  sha256: p(
    'Digest callback-produced SHA-256 text over the complete original backing, verified before restoration returns.',
    '摘要回调为完整原始背板生成的校验文本，恢复返回前必须验证。'
  ),
  backings: p(
    'Ordered unique complete-backing metadata matching the native sidecar array exactly.',
    '有序且不重复的完整背板元数据，与原生附带背板数组精确对应。'
  ),
  sidecars: p(
    'Exact ordered original ArrayBuffer backings; explicit native transfer never substitutes inline data.',
    '精确有序的原始 `ArrayBuffer` 背板；显式原生转移不会替换为内联数据。'
  ),
  backingBytes: p(
    'Total full original backing bytes counted during capture, retained even if later detached.',
    '捕获时计算的原始完整背板总字节数，后续分离后仍保留。'
  ),
  envelope: p(
    'Validated runtime envelope encoded or restored by the binary manifest owner.',
    '二进制清单所有者编码或恢复的已校验运行信封。'
  ),
  task: p(
    'Original runtime task tuple containing mode, caller and exact target generation.',
    '包含模式、调用方和精确目标世代的原始运行任务元组。'
  ),
  options: p(
    'Explicit runtime operation options; absence of a field never infers permission or capability.',
    '显式运行操作选项，字段省略不会推断权限或能力。'
  ),
  steps: p(
    'Ordered group methods reserved before execution; failure stops later steps without rollback.',
    '执行前预留的有序分组方法；失败停止后续步骤，不作回滚。'
  ),
  completion: p(
    'Actual original operation success/result or serialized failure, never an execution guess.',
    '原始操作的实际成功结果或序列化失败，不是对执行情况的猜测。'
  ),
  result: p(
    'Portable business result present only when the associated completion or step succeeds.',
    '仅关联完成或步骤成功时存在的可移植业务结果。'
  ),
  ok: {
    ...p(
      'Boolean discriminator separating successful completion from serialized failure.',
      '区分成功完成和序列化失败的布尔判别字段。'
    ),
    values: {
      true: t('Completion succeeded; result may be present.', '完成成功，可以存在业务结果。'),
      false: t('Completion failed and carries its serialized error.', '完成失败，携带序列化错误。')
    }
  },
  generation: p(
    'Provider-issued exact restart/session generation, obtained from its accepted runtime binding.',
    '从已接受运行绑定取得的提供方精确重启或会话世代。'
  ),
  value: p(
    'Generation owner-issued nonnegative safe integer, not a supervisor attempt ordinal.',
    '世代所有者签发的非负安全整数，不是监督器尝试序号。'
  ),
  providerId: p(
    'Identifier issued by the generation owner and obtained from the accepted provider binding.',
    '世代所有者签发并从已接受提供方绑定取得的标识。'
  ),
  callerId: p(
    'Caller instance identifier obtained from the actual runtime peer identity.',
    '从实际运行对端身份取得的调用方实例标识。'
  ),
  callerGeneration: p(
    'Caller-owned generation obtained from its actual accepted runtime identity.',
    '从实际已接受运行身份取得的调用方所属世代。'
  ),
  targetGeneration: p(
    'Exact target generation obtained from the accepted provider binding and preserved across controls.',
    '从已接受提供方绑定取得的精确目标世代，跨控制消息保持。'
  ),
  orderKey: p(
    'Application-issued ordering lane key; the final provider owns arrival ordering for equal keys.',
    '应用签发的排序通道键；相同键的到达顺序由最终提供方管理。',
    t('Absent: no explicit ordering lane is requested.', '默认不设置，不请求显式排序通道。')
  ),
  reason: p(
    'Optional serialized cancellation or terminal reason preserving the original failure diagnostics.',
    '可选序列化取消或终止原因，保留原始失败诊断。'
  ),
  seq: p(
    'Nonnegative stream sequence owned by the stream protocol; initial open uses zero.',
    '流协议拥有的非负序号，初始打开事件使用零。'
  ),
  pending: p(
    'Consumer-owned currently outstanding credit token; truthiness indicates a held pull.',
    '消费方持有的当前未完成额度令牌，真值表示存在待定拉取。'
  ),
  busy: p(
    'Producer-owned in-flight pull marker; true rejects an overlapping credit request.',
    '生产方持有的进行中拉取标志；真值拒绝重叠额度请求。'
  ),
  epoch: p(
    'Original idempotency-store incarnation identifier issued by the store owner.',
    '原始幂等存储所有者签发的当前存储实例标识。'
  ),
  store: p(
    'Actual final provider store identity and continuity facts, not inferred from a missing key.',
    '实际最终提供方存储身份及连续性事实，不从键缺失推断。'
  ),
  outcome: p(
    'Retained original business completion and target generation from the provider idempotency store.',
    '从提供方幂等存储保留的原始业务完成结果及目标世代。'
  ),
  self: p(
    'Launch-owner supplied child name and instanceId; it is descriptive data, not channel authority.',
    '启动所有者提供的子名称和实例标识；只描述数据，不赋予通道权限。'
  ),
  parentInstanceId: p(
    'Parent instance identifier supplied by the actual launcher during bootstrap.',
    '实际启动器在引导期间提供的父实例标识。'
  ),
  token: p(
    'Private bootstrap token issued by the launch owner; never print it in diagnostics.',
    '启动所有者签发的私有引导令牌，绝不能写入诊断。'
  ),
  stream: p(
    'Original stream event record carrying its sequence and permitted item or error fields.',
    '原始流事件记录，携带序号及允许的条目或错误字段。'
  ),
  state: p(
    'Actual result classification selected by the operation or store owner.',
    '操作或存储所有者选择的实际结果分类。'
  ),
  mode: p(
    'Original logical operation mode retained across controls and results.',
    '控制及结果之间保持的原始逻辑操作模式。'
  ),
  cancel: p(
    'Explicit before-start cancellation policy selected by the original caller.',
    '原始调用方选择的显式启动前取消策略。'
  ),
  continuity: p(
    'Original store owner-issued continuity fact, never inferred from a missing key.',
    '原存储所有者签发的连续性事实，不从键缺失推断。'
  ),
  storage: p(
    'Binary representation selected before capture and required to match restoration.',
    '捕获前选择且必须与恢复相匹配的二进制表示。'
  ),
  protectedMetadata: p(
    'Opaque codec-protected manifest value carried beside exact original native backings.',
    '精确原始原生背板旁携带的不透明编解码保护清单值。'
  )
}
/** Picks canonical property docs while retaining context-specific overrides. */
function members(
  names: string[],
  overrides: Record<string, IMemberDoc> = {}
): Record<string, IMemberDoc> {
  return { ...Object.fromEntries(names.map((name) => [name, fields[name]])), ...overrides }
}
/** One enum-valued field closes to its documented literal domain. */
const choice = (field: string, name: string): IMemberDoc => ({
  ...fields[field],
  values: { enum: name }
})
/** Creates a data type with an optional full usage example. */
const typeDoc = (
  en: string,
  zh: string,
  own: Record<string, IMemberDoc>,
  example = handshakeExample
): ITypeDoc => ({
  summary: t(en, zh),
  members: own,
  scenarios: [
    t(
      'Implement an independent compatible peer using the original protocol-owned data shape.',
      '使用原协议拥有的数据形态实现独立兼容对端。'
    )
  ],
  example
})

/** Wire choices have independent semantics, including optional capability negotiation. */
domain(
  'RpcProtocol',
  'Language-neutral protocol identity independent of package versions.',
  '与包版本分开的跨语言协议身份。',
  {
    id: t(
      '`migaia.rpc` identifies the expected protocol during handshake.',
      '`migaia.rpc` 在握手期间标识预期的协议身份。'
    ),
    major: t(
      'Major `1` selects the compatible semantic grammar.',
      '主版本 `1` 选择兼容的语义语法。'
    ),
    minor: t(
      'Minor `1` includes runtime API and stream capabilities.',
      '次版本 `1` 包含运行接口及流能力语法。'
    )
  }
)
domain(
  'RpcEnvelopeKind',
  'Legacy semantic envelope variants, separate from physical batching.',
  '传统语义信封形式，与物理攒批分开。',
  {
    request: t(
      'Invoke one application method and correlate its response.',
      '调用一个应用方法并关联其响应。'
    ),
    response: t(
      'Return business success or failure for a request.',
      '为请求返回业务成功或失败结果。'
    ),
    discovery: t(
      'Exchange compatible endpoint version and identity information.',
      '交换兼容端点版本和身份信息。'
    ),
    variation: t(
      'Carry control subtypes such as ping, abort and close.',
      '携带心跳、中止和关闭等控制子类型。'
    ),
    stream: t(
      'Carry one event in an already correlated stream exchange.',
      '携带已关联流交换中的单个事件。'
    )
  }
)
domain(
  'RpcReservedKind',
  'First-channel control stays outside ordinary envelope kinds.',
  '首通道控制保持在普通信封种类之外。',
  {
    handshake: t(
      'Treat this record as first-channel negotiation, never business traffic.',
      '把该记录视为首通道协商，而非业务流量。'
    )
  }
)
domain(
  'RpcControl',
  'Control subtype names shared by contract and endpoint execution.',
  '契约与端点执行共用的控制子类型名称。',
  {
    abort: t('Request cancellation of the correlated operation.', '请求取消已经关联的当前操作。'),
    ping: t('Ask the peer to confirm connection liveness.', '请求对端确认当前连接仍存活。'),
    pong: t('Acknowledge the corresponding liveness ping.', '确认对应的连接存活检查请求。'),
    close: t('Request orderly shutdown of the current connection.', '请求有序关闭当前的连接。')
  }
)
domain(
  'RpcCapability',
  'Independent negotiated capabilities; a declaration never implies its dependencies.',
  '独立协商的能力，声明不会自动包含依赖。',
  {
    abort: t(
      '`abort@1` permits ordinary correlated cancellation messages.',
      '`abort@1` 允许普通关联取消消息。'
    ),
    ping: t(
      '`ping@1` permits liveness ping and pong controls.',
      '`ping@1` 允许存活检查及相应确认控制。'
    ),
    close: t('`close@1` permits orderly peer close control.', '`close@1` 允许有序关闭对端的控制。'),
    deadline: t(
      '`deadline@1` permits relative operation deadlines.',
      '`deadline@1` 允许相对操作截止时间。'
    ),
    idempotency: t(
      '`idempotency@1` permits legacy request replay keys.',
      '`idempotency@1` 允许传统请求使用稳定重放键。'
    ),
    trace: t(
      '`trace@1` permits bounded diagnostic trace metadata.',
      '`trace@1` 允许有界诊断追踪元数据。'
    ),
    stream: t(
      '`stream@1` permits pull-credit stream exchanges.',
      '`stream@1` 允许基于拉取额度的流交换。'
    ),
    runtimeApi: t(
      '`runtime-api@1` enables the symmetric runtime application directory when both actual offers include it.',
      '`runtime-api@1` 仅双方实际提议均包含时启用对称运行应用目录。'
    ),
    forwardRoute: t(
      '`forward-route@1` permits signed Host routes and synchronous loop checks.',
      '`forward-route@1` 允许签名宿主路由及同步环路检查。'
    ),
    generation: t(
      '`generation@1` fences actual accepted execution/session generations.',
      '`generation@1` 限定实际已接受执行或会话世代。'
    ),
    order: t(
      '`order@1` requires the complete provider admission port for arrival ordering.',
      '`order@1` 要求完整提供方准入端口来维护到达顺序。'
    ),
    group: t(
      '`group@1` reserves every request step before any provider starts.',
      '`group@1` 在任何提供方开始之前预留所有请求步骤。'
    ),
    cancelBeforeStart: t(
      '`cancel-before-start@1` lets the final provider arbitrate cancellation before actual execution.',
      '`cancel-before-start@1` 由最终提供方在实际执行前裁定取消。'
    ),
    outcome: t(
      '`outcome@1` allows read-only pending/done/unknown lookup in the original store.',
      '`outcome@1` 允许只读查询原始存储的待定、完成或未知状态。'
    ),
    portableBinary: t(
      '`portable-binary@1` restores native bytes through the closed binary manifest grammar.',
      '`portable-binary@1` 通过封闭二进制清单恢复原生字节。'
    ),
    nativeBinary: t(
      'Native authenticated manifests verify full backing integrity before authentication replay commit.',
      '原生认证清单在认证重放提交前验证完整背板完整性。'
    ),
    transfer: t(
      '`transfer@1` transfers only explicitly supplied original backings on real transfer carriers.',
      '`transfer@1` 只在真实转移载体上传递显式提供的原始背板。'
    ),
    batch: t(
      '`batch@1` groups physical envelopes without adding a semantic envelope kind.',
      '`batch@1` 组合物理信封，但不增加语义信封种类。'
    )
  }
)
domain(
  'RpcBatchPhysical',
  'Optional physical wrapper independent of semantic task grouping.',
  '独立于语义任务分组的可选物理包装。',
  {
    kind: t(
      'The physical wrapper kind is `batch`, outside semantic envelope kinds.',
      '物理包装种类为 `batch`，不属于语义信封种类。'
    ),
    members: t(
      'The `envelopes` field contains a nonempty ordered member array.',
      '`envelopes` 字段包含非空有序成员数组。'
    ),
    maxBytes: t(
      'The complete physical representation cannot exceed 16777216 bytes.',
      '完整物理表示不能超过 `16777216` 字节。'
    )
  }
)
domain(
  'RpcCodecId',
  'Mandatory baseline codec identity shared by all peers.',
  '所有对端共享的必需基线编解码身份。',
  {
    json: t(
      '`json` is the mandatory JSON text representation during negotiation.',
      '`json` 是协商期间必需的文本对象表示。'
    )
  }
)
domain(
  'RpcPeerRuntime',
  'Common diagnostic labels; other valid lowercase runtime names are accepted.',
  '常见诊断标签，也接受其他有效小写运行时名称。',
  Object.fromEntries(
    ['node', 'bun', 'deno', 'electron', 'python', 'rust', 'go', 'java'].map((name) => [
      name,
      t(
        'Choose `' +
          name +
          '` when the peer reports that actual runtime; the label grants no capability.',
        '对端实际报告 `' + name + '` 运行时才选择此标签；标签本身不赋予任何能力。'
      )
    ])
  )
)
domain(
  'RpcRouteType',
  'Route variants select legal optional fields during semantic validation.',
  '路由形式选择语义校验期间允许的可选字段。',
  {
    request: enums.RpcEnvelopeKind.values.request,
    response: enums.RpcEnvelopeKind.values.response,
    discoveryQuery: t(
      'A discovery query asks for compatible endpoint identities.',
      '发现查询用于请求兼容端点身份信息。'
    ),
    discoveryResponse: t(
      'A discovery reply returns an actual candidate identity.',
      '发现响应返回一个实际候选端点身份。'
    ),
    variation: enums.RpcEnvelopeKind.values.variation,
    stream: enums.RpcEnvelopeKind.values.stream
  }
)
domain(
  'RpcWireLimit',
  'Admission bounds for untrusted identifiers, offers and durations.',
  '未可信标识、提议和时长的准入边界。',
  {
    maxIdentifierChars: t(
      'At most 128 characters in an admitted identifier.',
      '接纳的单个标识最多为 `128` 个字符。'
    ),
    maxTraceChars: t(
      'At most 256 characters in optional trace metadata.',
      '可选追踪元数据最多为 `256` 个字符。'
    ),
    maxIdempotencyKeyChars: t(
      'At most 128 characters in one idempotency key.',
      '单个幂等操作键最多为 `128` 个字符。'
    ),
    maxDurationMs: t(
      'Relative millisecond durations cannot exceed 2147483647.',
      '相对毫秒时长不能超过 `2147483647`。'
    ),
    maxHandshakeBytes: t(
      'Reject first-channel negotiation exceeding 65536 bytes.',
      '拒绝超过 `65536` 字节的首通道协商。'
    ),
    maxVersions: t(
      'A handshake offer contains at most eight version proposals.',
      '握手提议最多包含八个版本提案。'
    ),
    maxCodecs: t(
      'A handshake offer contains at most sixteen codec identities.',
      '握手提议最多包含十六个编解码身份。'
    ),
    maxCapabilities: t(
      'A handshake offer contains at most sixty-four capability identities.',
      '握手提议最多包含六十四个能力身份。'
    )
  }
)
/** Stable diagnostic categories describe the first failing contract boundary. */
const violations: Record<string, IText> = {
  read: t(
    'Reading a property failed; retain the original getter cause.',
    '读取属性失败，保留原始读取器原因。'
  ),
  type: t(
    'The received value has an unsupported native or scalar type.',
    '接收值具有不支持的原生或标量类型。'
  ),
  required: t(
    'A required protocol-owned field is absent or invalid.',
    '协议拥有的必需字段缺失或无效。'
  ),
  unknownKind: t(
    'The envelope discriminator is not a supported semantic kind.',
    '信封判别字段不是受支持的语义种类。'
  ),
  unknownField: t(
    'An extra field is forbidden by the selected closed grammar.',
    '额外字段被所选封闭语法禁止。'
  ),
  route: t('Routing metadata violates its protocol-owned shape.', '路由元数据违反协议拥有的形态。'),
  payload: t(
    'Application payload cannot be normalized as portable data.',
    '应用载荷无法规范化为可移植数据。'
  ),
  error: t(
    'Serialized failure data violates the bounded error grammar.',
    '序列化失败数据违反有界错误语法。'
  ),
  encoding: t(
    'Received text bytes are not valid UTF-8 encoding.',
    '接收的文本字节不是有效统一编码。'
  ),
  bytes: t('Encoded handshake exceeds its admitted byte ceiling.', '编码握手超过允许的字节上限。'),
  step: t(
    'The exchange received a control step in the wrong phase.',
    '交换在错误阶段收到了控制步骤。'
  ),
  baseline: t(
    'A mandatory protocol, version or codec baseline is missing.',
    '缺少必需协议、版本或编解码基线。'
  ),
  duplicate: t(
    'An offer repeats a version or capability identity.',
    '提议重复了版本或能力身份标识。'
  ),
  mismatch: t(
    'The selected agreement was not included in the local offer.',
    '选定协议结果不在本地提议之中。'
  ),
  event: t(
    'The stream event is unknown or invalid for its mode.',
    '流事件未知或不适用于当前模式。'
  ),
  direction: t(
    'The event arrived from the wrong producer/consumer direction.',
    '事件来自错误的生产或消费方向。'
  ),
  field: t('The event carries a field forbidden in its variant.', '事件携带当前形式禁止的字段。'),
  seq: t('The sequence or held pull credit does not match.', '序号或持有的拉取额度不匹配。'),
  budget: t(
    'The stream value exceeds its portable item byte ceiling.',
    '流值超过可移植条目的字节上限。'
  )
}
domain(
  'RpcEnvelopeViolation',
  'First-envelope failure categories used in coded diagnostics.',
  '编码诊断使用的首个信封失败类别。',
  Object.fromEntries(
    ['read', 'type', 'unknownKind', 'required', 'unknownField', 'route', 'payload', 'error'].map(
      (key) => [key, violations[key]]
    )
  )
)
domain(
  'RpcHandshakeReason',
  'Negotiation incompatibility causes returned with a rejection reply.',
  '随拒绝响应返回的协商不兼容原因。',
  {
    protocol: t(
      'Protocol identity, codec or required runtime baseline does not overlap.',
      '协议身份、编解码或必需运行基线不相容。'
    ),
    version: t(
      'No shared major or adequate runtime minor version exists.',
      '不存在共享主版本或足够的运行次版本。'
    )
  }
)
domain(
  'RpcHandshakeStep',
  'Disjoint first-channel control forms preceding business messages.',
  '业务消息之前互相独立的首通道控制形式。',
  {
    hello: t(
      'Initiator advertises actual supported versions, codecs and capabilities.',
      '发起方声明实际支持的版本、编解码和能力。'
    ),
    accept: t(
      'Responder chooses values from the actual intersection.',
      '响应方从实际交集中选择协议值。'
    ),
    reject: t(
      'Responder returns a serialized incompatibility error.',
      '响应方返回序列化的不兼容错误。'
    )
  }
)
domain(
  'RpcHandshakeViolation',
  'First malformed handshake boundary without exposing authentication material.',
  '不暴露认证材料的首个异常握手边界。',
  Object.fromEntries(
    [
      'read',
      'encoding',
      'bytes',
      'type',
      'required',
      'step',
      'baseline',
      'duplicate',
      'mismatch'
    ].map((key) => [key, violations[key]])
  )
)
scalar(
  'RpcRouteKey',
  'Stable key `route` stores contract routing metadata separately from application payload data.',
  '稳定键 `route` 用于单独存放契约路由元数据，与应用载荷数据保持分离。'
)
scalar(
  'RpcRouteProfile',
  'Stable marker `migaia.rpc.route` identifies contract-owned routing metadata inside data records.',
  '稳定标记 `migaia.rpc.route` 用于识别数据记录中由契约拥有的路由元数据。'
)
domain(
  'RpcRouteField',
  'Canonical property names for routing metadata validation.',
  '路由元数据校验所用的规范属性名称。',
  Object.fromEntries(
    [
      'profile',
      'type',
      'applicationVersion',
      'senderId',
      'targetId',
      'sentAt',
      'receiverId',
      'dispatchOnly',
      'method',
      'manual',
      'resolvedTargetId',
      'platform',
      'accepted',
      'message',
      'operation',
      'variation',
      'timeoutMs',
      'idempotencyKey',
      'trace',
      'forwardRoute'
    ].map((key) => [key, fields[key].summary])
  )
)

/** Contract error tables remain distinct from native thrown error types. */
domain(
  'RpcContractErrorCode',
  'Stable semantic codes owned by the runtime-neutral contract package.',
  '运行时中立契约包拥有的稳定语义错误码。',
  {
    callbackFailed: t(
      '`CALLBACK_FAILED`: a warning, scheduler or cleanup callback failed without prior semantic identity. Native mutable errors retain identity, type and stack; other values stay on cause. Safe wire summaries do not expose callback text.',
      '`CALLBACK_FAILED`：警告、计时或清理回调失败且没有既有语义身份；可修改原生错误保留身份、类型及堆栈，其它值保留在原因链；安全线上摘要不泄漏回调文本。'
    ),
    invalidDescriptor: t(
      '`INVALID_DESCRIPTOR`: invalid stable component identity/version; correct local configuration.',
      '`INVALID_DESCRIPTOR`：稳定组件身份或版本非法，修正本地配置。'
    ),
    invalidEnvelope: t(
      '`INVALID_ENVELOPE`: reject the invalid semantic message without executing it.',
      '`INVALID_ENVELOPE`：拒绝无效语义消息，不执行其中业务。'
    ),
    invalidStream: t(
      '`INVALID_STREAM`: reject the invalid event, sequence or value budget and terminate only its stream.',
      '`INVALID_STREAM`：拒绝无效事件、序号或值预算，只终止所属流。'
    ),
    invalidFrame: t(
      '`INVALID_FRAME`: discard malformed physical or empty batch framing.',
      '`INVALID_FRAME`：丢弃异常物理分帧或空攒批包装。'
    ),
    frameLimitExceeded: t(
      '`FRAME_LIMIT_EXCEEDED`: complete physical or retained reassembly bytes exceeded a bound.',
      '`FRAME_LIMIT_EXCEEDED`：完整物理表示或保留重组字节超过边界。'
    ),
    frameAssemblyExpired: t(
      '`FRAME_ASSEMBLY_EXPIRED`: not all ordered fragments arrived before the assembly timer.',
      '`FRAME_ASSEMBLY_EXPIRED`：重组计时到期前未收到全部有序分片。'
    ),
    invalidWireError: t(
      '`INVALID_WIRE_ERROR`: reject the malformed bounded serialized error tree.',
      '`INVALID_WIRE_ERROR`：拒绝格式异常的有界序列化错误树。'
    ),
    handshakeInvalid: t(
      '`HANDSHAKE_INVALID`: malformed encoding, JSON or first-channel negotiation fields.',
      '`HANDSHAKE_INVALID`：编码、对象文本或首通道协商字段异常。'
    ),
    handshakeIncompatible: t(
      '`HANDSHAKE_INCOMPATIBLE`: peer protocol, version or mandatory runtime baseline is incompatible.',
      '`HANDSHAKE_INCOMPATIBLE`：对端协议、版本或必需运行基线不兼容。'
    ),
    handshakeRejected: t(
      '`HANDSHAKE_REJECTED`: the remote rejected negotiation; inspect the retained remote cause.',
      '`HANDSHAKE_REJECTED`：远端拒绝协商，检查保留的远端原因。'
    )
  }
)
scalar(
  'RPC_CONTRACT_SOURCE',
  'Stable semantic source `@migaia/rpc/contract` on locally minted validation errors; classify source and code together.',
  '本地创建校验错误使用的稳定语义来源 `@migaia/rpc/contract`；分类时同时检查来源和错误码。'
)
domain(
  'RpcWireErrorUnknownFieldMode',
  'Received error-node policy for fields added by another peer version.',
  '接收错误节点时处理其他版本新增字段的策略。',
  {
    reject: t(
      'Reject extra error-node fields with INVALID_WIRE_ERROR.',
      '遇到额外错误节点字段时以编码错误拒绝。'
    ),
    ignore: t(
      'Ignore unknown fields while optionally invoking the warning callback.',
      '忽略未知字段，同时可调用警告回调。'
    )
  }
)
domain(
  'RpcWireErrorLimit',
  'Shared serializer and validator limits for bounded cross-realm error graphs.',
  '跨域有界错误图的共享序列化及校验限制。',
  {
    maxNesting: t(
      'At most 48 total structural nesting levels are admitted.',
      '允许的总结构嵌套层数最多为四十八。'
    ),
    maxEmbeddingDepth: t(
      'At most 16 error embedding levels are admitted.',
      '允许的错误嵌入层数最多为十六。'
    ),
    maxNodes: t(
      'At most 1024 error nodes cross one wire boundary.',
      '一次线上边界最多传递一千零二十四个错误节点。'
    ),
    maxStringBytes: t(
      'Each sanitized string has at most 65536 UTF-8 bytes.',
      '每个清理后的字符串最多为六万五千五百三十六字节。'
    ),
    maxBytes: t(
      'The complete error payload is limited to 1048576 bytes.',
      '完整错误载荷最多为一百零四万八千五百七十六字节。'
    )
  }
)
domain(
  'RpcErrorReachLimit',
  'Bound on visiting original JavaScript error graph objects, separate from wire node limits.',
  '原始脚本错误图访问边界，与线上节点限制分开。',
  {
    maxObjects: t(
      'Visit at most 4096 original object identities while traversing causes and aggregate entries.',
      '遍历原因和聚合条目时最多访问四千零九十六个原始对象身份。'
    )
  }
)
domain(
  'RpcWireErrorFallback',
  'Stable projection for thrown values without complete semantic error identity.',
  '没有完整语义错误身份的抛出值所用稳定投影。',
  {
    source: t(
      'Use unknown when the thrown value supplies no semantic package source.',
      '抛出值没有语义包来源时使用未知来源。'
    ),
    code: t(
      'Use UNKNOWN when the thrown value supplies no semantic code.',
      '抛出值没有语义错误码时使用未知错误码。'
    ),
    name: t(
      'Use Error when a thrown value has no usable native class name.',
      '抛出值没有可用原生类名时使用通用错误名称。'
    ),
    nonErrorMessage: t(
      'Use non-error value thrown when an unstructured throw has no readable message.',
      '非结构化抛出值没有可读消息时使用固定诊断文本。'
    )
  }
)
domain(
  'RpcWireErrorViolation',
  'Stable first-failure classifications for serialized error validation.',
  '序列化错误校验所用的稳定首失败分类。',
  {
    ...Object.fromEntries(
      ['read', 'type', 'required', 'unknownField'].map((key) => [key, violations[key]])
    ),
    emptyErrors: t(
      'An aggregate child list is present but empty.',
      '聚合子错误列表存在但没有任何条目。'
    ),
    truncatedValue: t(
      'The truncation marker is not the literal true value.',
      '截断标记不是规定的真值字面量。'
    ),
    dataPortable: t(
      'Error data cannot be admitted as legacy portable wire data.',
      '错误数据无法作为传统可移植线上数据接纳。'
    ),
    depth: t(
      'Error nesting or embedding exceeded its fixed depth ceiling.',
      '错误嵌套或嵌入超过固定深度上限。'
    ),
    nodes: t('The error graph exceeded its admitted node count.', '错误图超过允许接纳的节点数量。'),
    surrogate: t(
      'A wire string contains an unpaired UTF-16 surrogate.',
      '线上字符串含有未配对的代理字符。'
    ),
    stringBytes: t(
      'One string exceeds its fixed UTF-8 byte ceiling.',
      '单个字符串超过固定编码字节上限。'
    ),
    dataBytes: t(
      'Portable error data exceeds its admitted byte budget.',
      '可移植错误数据超过允许字节预算。'
    ),
    totalBytes: t(
      'The complete serialized error exceeds its total byte budget.',
      '完整序列化错误超过总字节预算。'
    ),
    jsonRpcShape: t(
      'The foreign JSON-RPC error object has invalid shape.',
      '外部调用协议错误对象的形态非法。'
    ),
    jsonRpcCode: t(
      'The foreign JSON-RPC numeric code is not valid.',
      '外部调用协议数字错误码无效。'
    )
  }
)
domain(
  'RpcJsonRpcWireError',
  'Bridge extension and foreign source used when mapping canonical error trees.',
  '映射规范错误树时所用桥扩展字段及外部来源。',
  {
    dataKey: t(
      'Store the canonical wire error under data.migaiaWireError.',
      '把规范线上错误存放在数据中的专用错误字段。'
    ),
    foreignSource: t(
      'Use jsonrpc-2.0 when a foreign error has no canonical embedded tree.',
      '外部错误没有嵌入规范树时使用固定外部来源。'
    )
  }
)
scalar(
  'RpcWireErrorField',
  'Ordered validation fields: source, code, name, message, stack, cause, errors, data, route and truncated. This order determines first-violation reporting.',
  '按顺序校验来源、错误码、名称、消息、堆栈、原因、聚合、数据、路由和截断字段；此顺序决定首先报告哪个违规。'
)

/** Physical framing bridge has its own package error identity. */
domain(
  'JsonRpcBridgeErrorCode',
  'Stable codes for Content-Length framing and JSON-RPC bridge admission.',
  '长度头分帧及桥接准入所用稳定错误码。',
  {
    frameInvalid: t(
      'JSONRPC_FRAME_INVALID rejects invalid ASCII headers, UTF-8 bodies, JSON or incomplete termination.',
      '无效帧错误拒绝异常文本头、编码主体、对象文本或半帧终止。'
    ),
    extensionMissing: t(
      'JSONRPC_EXTENSION_MISSING rejects a missing required bridge extension.',
      '缺失扩展错误拒绝没有必需桥扩展的消息。'
    ),
    profileInvalid: t(
      'JSONRPC_PROFILE_INVALID rejects invalid bridge profile metadata.',
      '形态非法错误拒绝无效桥形态元数据。'
    ),
    unsupportedMode: t(
      'JSONRPC_UNSUPPORTED_MODE rejects a mode absent from this bridge profile.',
      '模式不支持错误拒绝此桥形态未提供的调用模式。'
    ),
    handshakeTimeout: t(
      'JSONRPC_HANDSHAKE_TIMEOUT rejects a bridge handshake that missed its deadline.',
      '握手超时错误拒绝超过截止时间的桥协商。'
    )
  }
)
domain(
  'JsonRpcLimit',
  'Content-Length byte framing and bridge handshake limits.',
  '长度头字节分帧与桥握手所用限制。',
  {
    headerBytes: t(
      'Retain at most 1024 ASCII bytes for one header block.',
      '单个文本头块最多保留一千零二十四字节。'
    ),
    bodyBytes: t(
      'One UTF-8 body cannot exceed 16777216 bytes.',
      '单个编码主体不能超过一千六百七十七万七千二百一十六字节。'
    ),
    handshakeMs: t(
      'Bridge negotiation has a 10000 millisecond deadline.',
      '桥协商的截止时长为一万毫秒。'
    )
  }
)
scalar(
  'JSONRPC_BRIDGE_ERROR_SOURCE',
  'Stable bridge source `@migaia/rpc/bridge/jsonrpc` identifies Content-Length and JSON-RPC profile failures.',
  '稳定桥来源 `@migaia/rpc/bridge/jsonrpc` 用于识别长度头及调用协议形态失败。'
)
scalar(
  'RPC_STREAM_MAX_FRAME_BYTES',
  'Maximum native four-byte-prefix frame payload is 16777216 bytes; the prefix itself occupies four more bytes.',
  '原生四字节前缀帧的载荷上限为 `16777216` 字节，前缀本身另占四字节。'
)
domain(
  'RpcHandshakeRole',
  'Selects the custom byte receiver’s first-channel receive grammar.',
  '选择自定义字节接收器首通道的接收语法。',
  {
    initiator: t(
      'Expect the peer accept and permit early post-accept business frames.',
      '预期对端接受，并允许接受后的提前业务帧。'
    ),
    responder: t(
      'Expect hello and explicitly mark beginAccept before the accept write.',
      '预期问候，在写出接受前显式标记接受开始。'
    )
  }
)

/** Runtime semantics remain independent from physical carrier wrappers. */
domain(
  'RpcRuntimeKind',
  'Closed runtime semantic variants independent of legacy envelopes and physical batches.',
  '独立于传统信封及物理攒批的封闭运行语义形式。',
  {
    call: t(
      'One runtime request, notification or stream initiation.',
      '发起一次运行请求、通知或流调用。'
    ),
    group: t(
      'Ordered fail-stop group whose steps are reserved together.',
      '步骤共同预留并遇失败停止的有序分组。'
    ),
    control: t(
      'Correlated cancellation, stream or terminal control.',
      '已关联的取消、流或终止控制。'
    ),
    outcome: t(
      'Read-only original idempotency-store lookup and result.',
      '原始幂等存储的只读查询及结果。'
    )
  }
)
domain(
  'RpcRuntimeMode',
  'Original logical operation mode retained by controls and outcomes.',
  '控制与结果保留的原始逻辑操作模式。',
  {
    request: t(
      'A scalar operation expects one business completion.',
      '标量操作预期一个业务完成结果。'
    ),
    notify: t(
      'One-way operation does not deliver a business result.',
      '单向操作不投递业务返回结果。'
    ),
    stream: t(
      'Pull-credit exchange produces an ordered sequence of items.',
      '拉取额度交换产生有序条目序列。'
    ),
    group: t(
      'Ordered methods stop after the first failed step.',
      '有序方法在第一个失败步骤后停止。'
    ),
    outcome: t(
      'Query actual retained pending, done or unknown state.',
      '查询实际保留的待定、完成或未知状态。'
    )
  }
)
domain(
  'RpcRuntimeGenerationKind',
  'Restart and session counters belong to distinct original owners.',
  '重启和会话计数器属于不同原始所有者。',
  {
    restart: t(
      'Execution restart owner issued this accepted generation.',
      '执行重启所有者签发此已接受世代。'
    ),
    session: t(
      'Connection-session owner issued this accepted generation.',
      '连接会话所有者签发此已接受世代。'
    )
  }
)
domain(
  'RpcRuntimeOperation',
  'Control operations reuse the original task tuple instead of making a new business identifier.',
  '控制操作复用原任务元组，不创建新的业务标识。',
  {
    cancel: t('Cancel the original correlated runtime operation.', '取消原始已关联的运行操作。'),
    stream: t('Transmit a producer or consumer stream event.', '传输生产方或消费方的流事件。'),
    terminal: t('Transmit actual scalar or group completion.', '传输实际标量或分组完成结果。'),
    lookup: t(
      'Read the original provider store without dispatching business work.',
      '只读原提供方存储，不派发业务工作。'
    ),
    result: t(
      'Return actual store continuity and retained outcome facts.',
      '返回实际存储连续性及保留结果事实。'
    )
  }
)
domain(
  'RpcRuntimeStepState',
  'Group results record actual effects, never transaction rollback promises.',
  '分组结果记录实际效果，不承诺事务回滚。',
  {
    success: t(
      'This step executed and its portable result may be present.',
      '此步骤已执行，可以包含可移植结果。'
    ),
    failure: t('This step failed and retains a serialized error.', '此步骤失败并保留序列化错误。'),
    notExecuted: t(
      'An earlier failure prevented this step from starting.',
      '较早失败导致此步骤尚未开始。'
    )
  }
)
domain(
  'RpcRuntimeOutcomeState',
  'Read-only lookup facts never guess whether business execution occurred.',
  '只读查询事实不猜测业务是否实际执行。',
  {
    pending: t(
      'The original provider store holds a still-pending reservation.',
      '原始提供方存储仍持有待定预留。'
    ),
    done: t(
      'The original store holds the actual final business outcome.',
      '原始存储持有实际最终业务结果。'
    ),
    unknown: t(
      'The store has no retained outcome; this does not prove nonexecution.',
      '存储没有保留结果，不能证明从未执行。'
    )
  }
)
domain(
  'RpcRuntimeStoreKind',
  'Original final-provider store owner and its availability.',
  '原始最终提供方存储所有者及可用性。',
  {
    memory: t('The provider owns an in-memory idempotency store.', '提供方拥有内存中的幂等存储。'),
    external: t('The provider owns an external idempotency store.', '提供方拥有外部持久幂等存储。'),
    unavailable: t(
      'No original outcome store is available for this lookup.',
      '本次查询没有可用的原始结果存储。'
    )
  }
)
domain(
  'RpcRuntimeStoreContinuity',
  'Continuity is issued by the real store owner, never inferred from key expiry.',
  '连续性由实际存储所有者签发，不由键过期推断。',
  {
    retained: t(
      'The original store incarnation is still retained.',
      '仍保留原来的存储实例及连续性。'
    ),
    lost: t(
      'A real store replacement lost continuity since restart.',
      '真实存储替换导致重启后连续性丢失。'
    ),
    unavailable: t(
      'Store continuity cannot be observed because the store is unavailable.',
      '存储不可用，因此无法观察其连续性。'
    )
  }
)
domain(
  'RpcRuntimeCarrier',
  'Parser selectors wrap protected output without granting runtime authority.',
  '解析选择器包装受保护输出，不赋予运行权限。',
  {
    kind: t(
      'Object carrier kind rpc.runtime-api.v1 selects the runtime parser.',
      '对象载体固定种类选择运行信封解析器。'
    ),
    prefix: t(
      'Text and bytes use the fixed record-separator runtime prefix.',
      '文本和字节使用固定记录分隔符运行前缀。'
    ),
    frame: t(
      'The frame field holds the original opaque protected output.',
      '帧字段持有原始不透明受保护输出。'
    )
  }
)
scalar(
  'RpcRuntimeProfile',
  'Fixed profile marker `migaia.rpc.runtime-api/1` distinguishes runtime task grammar from legacy RPC envelopes.',
  '固定形态标记 `migaia.rpc.runtime-api/1` 用于区分运行任务语法与传统远程调用信封。'
)
scalar(
  'RpcRuntimeStreamPrefix',
  'Fixed method prefix `migaia.remote.runtime.stream.` separates stream handlers from scalar methods within the same provider registry.',
  '固定方法前缀 `migaia.remote.runtime.stream.` 在同一提供方注册表中区分流处理器和标量方法。'
)
scalar(
  'RpcRuntimeCancel',
  'Literal `before-start` requests final-provider cancellation arbitration before actual execution; ordinary cancellation retains its existing owner.',
  '字面量 `before-start` 请求最终提供方在实际执行前裁定取消；普通取消仍保留原有所有者。'
)
scalar(
  'RpcRuntimeFinish',
  'Literal `finish-without-items` asks a before-start-cancellable stream to drain its original producer to actual terminal without yielding items.',
  '字面量 `finish-without-items` 请求允许启动前取消的流排空原生产方直到实际终止，不再产出条目。'
)
domain(
  'RpcRuntimeField',
  'Canonical property names for the independent runtime grammar.',
  '独立运行语法使用的规范属性名称。',
  Object.fromEntries(
    [
      'profile',
      'kind',
      'id',
      'route',
      'task',
      'payload',
      'options',
      'steps',
      'operation',
      'reason',
      'stream',
      'completion',
      'idempotencyKey',
      'state',
      'store',
      'outcome',
      'mode',
      'callerId',
      'callerGeneration',
      'targetGeneration',
      'method',
      'value',
      'providerId',
      'orderKey',
      'cancel',
      'timeoutMs',
      'ok',
      'result',
      'error',
      'event',
      'seq',
      'epoch',
      'continuity'
    ].map((key) => [
      key,
      (
        fields[key] ??
        p(
          'Protocol-owned discriminator for the selected runtime semantic variant.',
          '所选运行语义形式使用的协议判别字段。'
        )
      ).summary
    ])
  )
)

/** Portable binary choices keep complete backing integrity and explicit ownership. */
domain(
  'RpcBinaryStorage',
  'Binary representation selected before sending; native transfer never falls back to inline.',
  '发送前选择的二进制表示，原生转移不降级为内联。',
  {
    inline: t(
      'Encode bytes in the protected manifest without native sidecars.',
      '在受保护清单中编码字节，不提供原生附带背板。'
    ),
    native: t(
      'Keep exact original ArrayBuffer sidecars and verify full-backing digests.',
      '保持精确原始背板并校验完整背板摘要。'
    )
  }
)
scalar(
  'RpcBinaryProfile',
  'Fixed manifest profile `migaia.rpc.portable-binary/1` is protected once by the original codec/authentication owner.',
  '固定清单形态 `migaia.rpc.portable-binary/1` 由原始编解码及认证所有者保护一次。'
)
scalar(
  'RpcNativeBinaryKind',
  'Fixed native wrapper kind `rpc.native-binary.v1` carries protected metadata and its exact ordered original backing list.',
  '固定原生包装种类 `rpc.native-binary.v1` 携带受保护元数据及其精确有序原始背板列表。'
)
domain(
  'RpcBinaryTag',
  'Every business node has a tag so ordinary tag-shaped records cannot become binary references.',
  '每个业务节点都有标签，普通类似标签记录不会变成二进制引用。',
  {
    null: t(
      'Represent the JSON null scalar without a data payload.',
      '表示空值标量，不携带数据载荷。'
    ),
    boolean: t(
      'Represent one admitted boolean scalar with its value.',
      '表示一个已接纳布尔标量及其值。'
    ),
    number: t(
      'Represent one finite numeric scalar in the portable model.',
      '表示可移植模型中的有限数字标量。'
    ),
    string: t(
      'Represent one text scalar without changing its content.',
      '表示一个文本标量，保留其内容。'
    ),
    array: t(
      'Represent ordered tagged child values in a dense array.',
      '用稠密数组表示有序带标签子值。'
    ),
    object: t(
      'Represent sorted unique key/value entries as tagged children.',
      '把排序且不重复键值条目表示为带标签子值。'
    ),
    buffer: t(
      'Represent a whole backing by inline bytes or a native sidecar index.',
      '以内联字节或原生背板序号表示完整缓冲。'
    ),
    uint8array: t(
      'Represent a view with its exact original byte offset and visible length.',
      '用精确原始字节偏移和可见长度表示视图。'
    )
  }
)
domain(
  'RpcBinaryViolation',
  'Integrity failures remain distinguishable from structural grammar rejection.',
  '完整性失败与结构语法拒绝保持可区分。',
  {
    integrity: t(
      'binary-integrity marks a complete-backing length or digest mismatch.',
      '二进制完整性标记表示完整背板长度或摘要不匹配。'
    )
  }
)
domain(
  'RpcBinaryField',
  'Closed manifest and native carrier property names.',
  '封闭清单及原生载体的属性名称。',
  Object.fromEntries(
    [
      'profile',
      'storage',
      'envelope',
      'backings',
      'byteLength',
      'sha256',
      'kind',
      'protectedMetadata',
      'sidecars'
    ].map((key) => [
      key,
      (
        fields[key] ??
        p(
          'The selected binary representation or opaque codec-protected manifest bytes.',
          '所选二进制表示或不透明编解码保护清单字节。'
        )
      ).summary
    ])
  )
)
scalar(
  'RPC_PORTABLE_MAX_DEPTH',
  'Portable graph nesting is limited to 64 levels; cyclic, unsupported or nonfinite data is rejected rather than silently converted.',
  '可移植图嵌套最多为六十四层；循环、不支持或非有限数据会被拒绝，不会被静默转换。'
)
domain(
  'RpcStreamEvent',
  'Seven protocol stream events; the stream owner checks direction and held sequence.',
  '七种协议流事件，由流所有者检查方向和已有序号。',
  {
    open: t(
      'Producer opens an admitted stream at sequence zero.',
      '生产方以零序号打开已准入的流。'
    ),
    pull: t(
      'Consumer grants credit for exactly one next item.',
      '消费方恰好授予下一个条目的额度。'
    ),
    item: t(
      'Producer sends the one item authorized by held credit.',
      '生产方发送已有额度授权的单个条目。'
    ),
    end: t('Producer reports normal completion of the stream.', '生产方报告流已经正常完成。'),
    fail: t('Producer reports a serialized terminal failure.', '生产方报告序列化的终止失败。'),
    cancel: t(
      'Consumer requests cancellation with optional failure reason.',
      '消费方携带可选失败原因请求取消。'
    ),
    cancelled: t('Producer acknowledges actual stream cancellation.', '生产方确认流已经实际取消。')
  }
)
domain(
  'RpcStreamViolation',
  'Stable first-failure categories for stream payload and credit checks.',
  '流载荷及额度检查使用的稳定首失败类别。',
  Object.fromEntries(
    ['event', 'direction', 'field', 'seq', 'budget'].map((key) => [key, violations[key]])
  )
)
domain(
  'RpcStreamLimit',
  'Portable item and per-peer stream admission ceilings.',
  '可移植条目及每对端流准入的上限。',
  {
    maxItemValueBytes: t(
      'One portable item value is limited to 16384 counted bytes.',
      '单个可移植条目值最多计量一万六千三百八十四字节。'
    ),
    maxOpenStreamsPerPeer: t(
      'One peer may retain at most 256 open streams.',
      '单个对端最多保留二百五十六条打开的流。'
    )
  }
)
domain(
  'RpcStreamPointer',
  'Stable pointer locations distinguish legacy and runtime stream sequence errors.',
  '稳定指针位置区分传统和运行流序号错误。',
  {
    seq: t(
      'Use /seq for a legacy stream payload sequence failure.',
      '传统流载荷序号失败使用根序号指针位置。'
    ),
    runtimeSeq: t(
      'Use /stream/seq for runtime-envelope stream sequence errors.',
      '运行信封流序号错误使用嵌套序号指针位置。'
    ),
    runtimeEvent: t(
      'Use /stream/event for invalid runtime finish controls.',
      '无效运行结束控制使用嵌套事件指针位置。'
    )
  }
)

/** Top-level pure operations with explicit input provenance and failure semantics. */
Object.assign(symbols, {
  createDescriptor: {
    role: 'operation',
    purpose: t(
      'Validates and freezes a language-neutral component identity. The id must match a lowercase initial letter followed by lowercase letters, digits, dots or hyphens; version is a positive safe integer.',
      '校验并冻结跨语言组件身份；标识须以小写字母开头，后接小写字母、数字、点或连字符，版本须为正安全整数。'
    ),
    params: {
      id: t(
        'Application component identifier such as message, json or a custom lower-case token.',
        '应用组件标识，例如 `message`、`json` 或自定义小写令牌。'
      ),
      version: t(
        'Application-owned positive safe-integer component format version.',
        '应用拥有的正安全整数组件格式版本。'
      )
    },
    returns: t(
      'Frozen IRpcDescriptor; invalid identity/version throws INVALID_DESCRIPTOR.',
      '返回冻结 `IRpcDescriptor`；身份或版本非法抛出编码描述错误。'
    ),
    example: "const descriptor = createDescriptor('custom.codec', 1)"
  },
  createRpcUnknownFieldWarner: {
    role: 'factory',
    purpose: t(
      'Creates a connection-local bounded warning deduplicator. Numeric pointer indexes share a wildcard identity; overflow emits one wildcard warning instead of retaining more keys.',
      '创建按连接隔离的有界警告去重器；指针数字索引共享通配身份，溢出时只发一次通配警告，不再保留更多键。'
    ),
    params: {
      options: t(
        'Application warn(connection, fieldKey) synchronous callback returning void; thrown errors propagate. Optional maxKeysPerConnection defaults 256 and maxConnections defaults 1024.',
        '应用提供同步 `warn(connection, fieldKey)` 回调并返回空值，抛错直接传播；`maxKeysPerConnection` 默认 `256`，`maxConnections` 默认 `1024`。'
      )
    },
    returns: t(
      'IRpcUnknownFieldWarner owns only bounded diagnostic memory; clear drops all remembered connections.',
      '返回 `IRpcUnknownFieldWarner`，只拥有有界诊断内存；清除会丢弃全部连接记录。'
    ),
    example:
      'const warnings = createRpcUnknownFieldWarner({ warn: (connection, fieldKey) => console.warn(connection, fieldKey) }); warnings.note("a", "request", "/items/0", "extra"); warnings.clear()'
  },
  createRpcHello: {
    role: 'operation',
    purpose: t(
      'Serializes and validates one local handshake proposal before sending. Pair with acceptRpcHandshake and completeRpcHandshake to prove a complete negotiated exchange.',
      '发送前序列化并校验本地握手提议。搭配 `acceptRpcHandshake`、`completeRpcHandshake` 完成并验证完整协商交换。'
    ),
    params: {
      offer: t(
        'Application-created IRpcHandshakeOffer with actual versions, codecs, capabilities and diagnostic peer identity.',
        '应用创建的 `IRpcHandshakeOffer`，含实际版本、编解码、能力及诊断身份。'
      )
    },
    returns: t(
      'UTF-8-compatible JSON hello text; invalid offers throw HANDSHAKE_INVALID with redacted diagnostics.',
      '返回编码兼容的问候对象文本；提议非法抛握手非法错误并提供脱敏诊断。'
    ),
    example: handshakeExample
  },
  acceptRpcHandshake: {
    role: 'operation',
    purpose: t(
      'Responder selects the highest shared major, lower shared minor, first remote codec also offered locally and exact capability intersection. Pair with createRpcHello and completeRpcHandshake.',
      '响应方选择最高共享主版本、较低共享次版本、远端顺序中首个本地也提供的编解码及精确能力交集。搭配 `createRpcHello`、`completeRpcHandshake`。'
    ),
    params: {
      local: t(
        'Responder application actual IRpcHandshakeOffer.',
        '响应方应用实际提供的握手提议。'
      ),
      hello: t(
        'First-channel text or bytes returned by the initiator createRpcHello.',
        '来自发起方 `createRpcHello` 的首通道文本或字节。'
      ),
      options: t(
        'Optional IRpcEnvelopeOptions controlling unknown-field observation.',
        '可选 `IRpcEnvelopeOptions`，控制未知字段观察。'
      )
    },
    returns: t(
      'ok true carries reply and agreement; incompatibility returns ok false with rejection reply/error. Malformed input throws HANDSHAKE_INVALID.',
      '成功结果含响应及协议；不兼容返回失败结果及拒绝文本和错误，异常输入抛握手非法错误。'
    ),
    example: handshakeExample
  },
  completeRpcHandshake: {
    role: 'operation',
    purpose: t(
      'Initiator validates the responder selection against its actual original offer. Pair with createRpcHello and acceptRpcHandshake; runtime proposals require wire 1.1 plus runtime-api and batch.',
      '发起方依据原始实际提议校验响应方选择。搭配 `createRpcHello`、`acceptRpcHandshake`；运行提议要求线上一点一次版本、运行接口和攒批能力。'
    ),
    params: {
      local: t(
        'Initiator original application offer supplied to createRpcHello.',
        '发起方原先传给 `createRpcHello` 的应用提议。'
      ),
      reply: t(
        'Responder reply text returned by acceptRpcHandshake and received from the same connection.',
        '来自同一连接上响应方 `acceptRpcHandshake` 返回的响应文本。'
      ),
      options: t(
        'Optional unknown-field warning policy from the application.',
        '应用可选的未知字段警告策略。'
      )
    },
    returns: t(
      'Frozen IRpcHandshakeAgreement; remote rejection throws HANDSHAKE_REJECTED with preserved remote cause, mismatched choices fail validation.',
      '返回冻结 `IRpcHandshakeAgreement`；远端拒绝抛握手拒绝错误并保留远端原因，不匹配选择会校验失败。'
    ),
    example: handshakeExample
  },
  normalizeRpcHandshake: {
    role: 'operation',
    purpose: t(
      'Strictly decodes bounded UTF-8 JSON handshake text into a fresh validated message. It checks grammar and baseline fields without granting connection or execution authority.',
      '严格把有界编码对象握手文本解析为新校验消息；只检查语法和基线字段，不赋予连接或执行权限。'
    ),
    params: {
      text: t(
        'Untrusted complete first-channel text or Uint8Array received from the carrier.',
        '从载体收到的未可信完整首通道文本或字节数组。'
      ),
      options: t(
        'Optional IRpcEnvelopeOptions with synchronous unknown-field observer.',
        '可选 `IRpcEnvelopeOptions`，含同步未知字段观察者。'
      )
    },
    returns: t(
      'IRpcHandshakeMessage; malformed input throws HANDSHAKE_INVALID with bounded redacted evidence.',
      '返回 `IRpcHandshakeMessage`；异常输入抛握手非法错误，诊断证据有界脱敏。'
    ),
    example: 'const parsed = normalizeRpcHandshake(createRpcHello(offer)); console.log(parsed.step)'
  },
  serializeRpcError: {
    role: 'operation',
    purpose: t(
      'Projects any original thrown value into a bounded wire error tree while preserving semantic source/code, native name, remote stack and cause/aggregate descendants. Omitted unreadable data is reported.',
      '把任意原始抛出值投影为有界线上错误树，保留语义来源、错误码、原生名称、远端堆栈及原因聚合后代；省略不可读数据时会上报。'
    ),
    params: {
      value: t(
        'Original caught or rejected value from application execution.',
        '应用执行中捕获或拒绝的原始值。'
      ),
      options: t(
        'Required application IRpcSerializeErrorOptions; report receives pointer, field and original read/normalization error synchronously.',
        '应用必需的 `IRpcSerializeErrorOptions`；上报同步接收指针、字段及原始读取或规范化错误。'
      ),
      metadata: t(
        'Optional caller-held metadata, default undefined. summaries.get(error) chooses exact-reference presentation; routes.get(error) supplies bounded node routes. Each field defaults to absent, never creates runtime authority, and is separate from ordinary serialized properties.',
        '可选调用方元数据，默认 `undefined`；`summaries.get(error)` 按精确引用选择展示，`routes.get(error)` 提供有界节点路由，两字段均默认省略，与普通序列化属性分开，也不创建运行权限。'
      )
    },
    returns: t(
      'IRpcSerializedError with bounded truncation markers; no shared last-result state.',
      '返回带有界截断标记的 `IRpcSerializedError`，不存在共享上次结果状态。'
    ),
    example: errorExample
  },
  deserializeRpcError: {
    role: 'operation',
    purpose: t(
      'Validates a complete received error tree before restoring native Error subclasses and original serialized stacks. It does not convert wire properties into local authority.',
      '恢复原生错误子类及原始序列化堆栈之前，先校验完整接收错误树；线上属性不会变成本地权限。'
    ),
    params: {
      value: t(
        'Untrusted serialized tree received from the peer or produced by serializeRpcError.',
        '从对端收到或由 `serializeRpcError` 产生的未可信序列化树。'
      ),
      options: t(
        'Optional IRpcWireErrorOptions; defaults reject unknown fields.',
        '可选 `IRpcWireErrorOptions`，默认拒绝未知字段。'
      ),
      routes: t(
        'Optional caller-owned WeakMap set port retaining admitted node-only diagnostic routes on restored Error references.',
        '调用方可选拥有的弱映射写入端，按恢复错误引用保留已接纳节点诊断路由。'
      )
    },
    returns: t(
      'Restored native Error tree; malformed input throws INVALID_WIRE_ERROR before restoration.',
      '返回恢复的原生错误树；异常输入在恢复前抛出线上错误非法错误。'
    ),
    example: errorExample
  },
  normalizeRpcSerializedError: {
    role: 'operation',
    purpose: t(
      'Validates and freezes a fresh wire error tree with deterministic first-violation order and fixed graph/string/byte limits.',
      '按确定的首违规顺序及固定图、字符串、字节限制，校验并冻结新的线上错误树。'
    ),
    params: {
      value: t('Received untrusted serialized error record.', '接收的未可信序列化错误记录。'),
      options: t(
        'Optional IRpcWireErrorOptions controlling unknown fields and warning callback.',
        '可选 `IRpcWireErrorOptions`，控制未知字段及警告回调。'
      )
    },
    returns: t(
      'Fresh IRpcSerializedError; violations throw INVALID_WIRE_ERROR carrying pointer and violation.',
      '返回新的 `IRpcSerializedError`；违规抛线上错误非法错误并携带指针及违规类别。'
    ),
    example: 'const validated = normalizeRpcSerializedError(wire)'
  },
  classifyRpcContractError: {
    role: 'operation',
    purpose: t(
      'Reads a diagnostic presentation only for an exact package-minted local Error reference. Copied errors and wire source/code properties cannot supply this local policy.',
      '只为精确由本包创建的本地错误引用读取诊断展示；复制错误及线上来源错误码属性不能提供该本地策略。'
    ),
    params: {
      error: t(
        'Original caught Error reference, not a structural copy or deserialized peer claim.',
        '捕获的原始错误引用，而非结构复制或反序列化对端声明。'
      )
    },
    returns: t(
      'IRpcErrorWireSummary for a package-owned reference, otherwise undefined.',
      '包拥有引用返回 `IRpcErrorWireSummary`，其他返回未定义。'
    ),
    example: 'const summary = classifyRpcContractError(error)'
  },
  reachRpcError: {
    role: 'operation',
    purpose: t(
      'Lazily walks original causes, aggregate entries and cleanup failures by identity under the object visit limit; it observes originals rather than restored copies.',
      '在对象访问上限内按身份惰性遍历原始原因、聚合条目及清理失败，观察原对象而非恢复副本。'
    ),
    params: {
      value: t(
        'Original failure value whose reachable error graph should be inspected.',
        '需要检查可达错误图的原始失败值。'
      ),
      options: t(
        'Application report callback for property reads that fail during traversal.',
        '应用提供的上报回调，接收遍历期间属性读取失败。'
      )
    },
    returns: t(
      'Native Generator yielding original reachable values up to RpcErrorReachLimit.',
      '返回原生生成器，按访问上限产出可达原始值。'
    ),
    example:
      'for (const failure of reachRpcError(error, { report: console.error })) console.log(failure)'
  },
  toJsonRpcError: {
    role: 'operation',
    purpose: t(
      'Embeds the canonical serialized error tree in a JSON-RPC error object under data.migaiaWireError. Pair with fromJsonRpcError for a lossless canonical error-tree bridge.',
      '把规范序列化错误树嵌入外部调用协议错误对象的数据专用字段。搭配 `fromJsonRpcError` 保留规范错误树跨桥传递。'
    ),
    params: {
      error: t(
        'Canonical IRpcSerializedError from serializeRpcError.',
        '来自 `serializeRpcError` 的规范 `IRpcSerializedError`。'
      ),
      code: t(
        'Application-selected integer foreign JSON-RPC error code, for example -32000.',
        '应用选择的外部调用协议整数错误码，例如 `-32000`。'
      )
    },
    returns: t(
      'IRpcJsonRpcErrorObject retaining the canonical tree in data.',
      '返回在数据中保留规范树的 `IRpcJsonRpcErrorObject`。'
    ),
    example:
      'const foreign = toJsonRpcError(wire, -32000); const restoredWire = fromJsonRpcError(foreign)'
  },
  fromJsonRpcError: {
    role: 'operation',
    purpose: t(
      'Restores the canonical embedded error tree when present, or projects a foreign JSON-RPC failure under its foreign source. Pair with toJsonRpcError for canonical round trips.',
      '存在规范嵌入树时还原，否则按外部来源投影外部调用失败。搭配 `toJsonRpcError` 进行规范往返。'
    ),
    params: {
      value: t(
        'Untrusted foreign error object received from a JSON-RPC peer.',
        '从外部调用对端接收的未可信错误对象。'
      )
    },
    returns: t(
      'IRpcSerializedError; invalid foreign shape/code or embedded tree throws INVALID_WIRE_ERROR.',
      '返回 `IRpcSerializedError`；外部形态、错误码或嵌入树非法时抛线上错误非法错误。'
    ),
    example:
      'const foreign = toJsonRpcError(wire, -32000); const restoredWire = fromJsonRpcError(foreign)'
  },
  normalizePortable: {
    role: 'operation',
    purpose: t(
      'Snapshots supported portable values without sending or executing a request. The default wire domain is null, boolean, finite number, string, array, plain record or a canonical bytes tag; Uint8Array becomes {$rpc: "bytes", base64url}. Records become frozen null-prototype snapshots.\n\nRejects cycles, nonfinite numbers and unsupported objects with INVALID_ENVELOPE. Ordinary record getters are read once and can execute user code. Native binary belongs to an independently negotiated profile, not the default wire result.',
      '快照支持的可移植值，不发送或执行请求；默认线上值域为 `null`、布尔、有限数、字符串、数组、普通记录或规范字节标签，`Uint8Array` 转为 `{ $rpc: "bytes", base64url }`，记录成为冻结的空原型快照。\n\n循环、非有限数与不支持的对象以 `INVALID_ENVELOPE` 拒绝；普通记录访问器读取一次，可能执行用户代码；原生二进制属于独立协商形态，不是默认线上结果。'
    ),
    params: {
      value: t(
        'Application or peer value requiring a portable data-only snapshot.',
        '需要纯可移植数据快照的应用或对端值。'
      ),
      depth: t(
        'Optional existing traversal depth, default 0 at the root; RPC_PORTABLE_MAX_DEPTH is 64. Ordinary application calls omit this traversal-integration parameter.',
        '可选已有遍历深度，根默认为 `0`，`RPC_PORTABLE_MAX_DEPTH` 为 `64`，普通应用调用省略此遍历集成参数。'
      ),
      active: t(
        'Optional caller-provided ancestor Set for the same traversal, default undefined with traversal-local cycle tracking. It tracks active ancestors rather than deduplicating all repeated references.',
        '可选同一遍历的祖先 `Set`，默认 `undefined`，使用遍历本地循环追踪；它记录活动祖先，不对所有重复引用去重。'
      ),
      nativeBinary: t(
        'Optional native-binary branch flag, default false; true admits native bytes, or a synchronous rejection callback supplies the failure boundary.',
        '可选原生二进制分支标志，默认假；真值接纳原生字节，也可传同步拒绝回调提供失败边界。'
      )
    },
    returns: t(
      'IRpcWirePortableValue by default, or negotiated IRpcPortableValue with native binary enabled; invalid data throws INVALID_ENVELOPE.',
      '默认返回 `IRpcWirePortableValue`，启用协商原生字节后返回 `IRpcPortableValue`；非法数据抛信封非法错误。'
    ),
    example: 'const data = normalizePortable({ names: ["a", "b"], active: true })'
  }
})

/** Type nodes are filled below, keeping common members canonical and overrides explicit. */
const types: Record<string, ITypeDoc> = {}

/** Registers a pure operation with one concrete example. */
function operation(
  name: string,
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): void {
  symbols[name] = { role: 'operation', purpose: t(en, zh), params, returns, example }
}
/** Shared exact physical-size inputs are already encoded by the caller. */
const physicalParams = {
  value: t(
    'Complete encoded string, Uint8Array or codec-produced object, supplied by the physical sender.',
    '物理发送方提供的完整编码字符串、字节数组或编解码器对象。'
  ),
  limit: t(
    'Application/carrier chosen whole-frame byte ceiling; native batch ceiling is 16777216 bytes.',
    '应用或载体选择的整帧字节上限；原生攒批上限为 `16777216` 字节。'
  )
}
operation(
  'measureRpcPhysicalFrame',
  'Measures the complete physical representation once: UTF-8 strings, actual byte-array length, or JSON-encoded objects. It does not count only business payload bytes.',
  '一次测量完整物理表示：文本编码长度、实际字节数组长度或对象编码文本；并非只计量业务载荷。',
  { value: physicalParams.value },
  t(
    'Actual physical bytes; encoding errors propagate to the caller.',
    '返回实际物理字节数；编码错误向调用方传播。'
  ),
  'const bytes = measureRpcPhysicalFrame(encodedFrame)'
)
operation(
  'assertRpcPhysicalFrameSize',
  'Checks the complete physical representation against a caller-selected byte ceiling. It does not split semantic members or mutate a send queue.',
  '按调用方选择的字节上限检查完整物理表示，不拆分语义成员，也不修改发送队列。',
  physicalParams,
  t(
    'Returns void within budget; oversize throws native coded FRAME_LIMIT_EXCEEDED.',
    '预算内返回空值；超限抛原生编码帧超限错误。'
  ),
  'assertRpcPhysicalFrameSize(encodedFrame, 16 * 1024 * 1024)'
)
operation(
  'inspectRpcPhysicalFrame',
  'Retains one exact physical measurement for later bound decisions and member-count bisection, without remeasuring the same frame.',
  '保留一次精确物理测量供后续上限判断和按成员数量二分，不重复测量同一帧。',
  physicalParams,
  t(
    'IRpcPhysicalFrameInspection with measured bytes and splitBatch; an oversize singleton cannot be split.',
    '返回含字节数及分批方法的 `IRpcPhysicalFrameInspection`，超限单成员不能拆分。'
  ),
  'const inspection = inspectRpcPhysicalFrame(encodedFrame, limit); const batches = inspection.splitBatch(envelopes)'
)
operation(
  'readRpcBatchMembers',
  'Recognizes a codec-decoded physical batch wrapper and snapshots its nonempty ordered members. Returned semantic members remain independently untrusted.',
  '识别编解码后的物理攒批包装，并快照非空有序成员；返回的语义成员仍须独立校验。',
  {
    value: t(
      'Actual codec-decoded physical value from the carrier.',
      '来自载体的实际编解码后物理值。'
    )
  },
  t(
    'Frozen member array, undefined for non-batch values; malformed selected wrapper throws INVALID_FRAME.',
    '返回冻结成员数组，非攒批值返回未定义；已选异常包装抛帧非法错误。'
  ),
  'const batch = readRpcBatchMembers(decoded); if (batch) for (const envelope of batch) normalizeRpcEnvelope(envelope)'
)
/** Framer factories share one canonical bounded resource implementation. */
for (const [name, kind] of [
  ['createStringFramer', 'string'],
  ['createBinaryFramer', 'Uint8Array']
] as const) {
  symbols[name] = {
    role: 'factory',
    purpose: t(
      'Creates an ordered bounded fragment framer and receiver. Call its own accept method; retention is separated by transport source and message identifier.',
      '创建有序有界的分片发送及接收器。调用自身 `accept` 接收方法；保留状态按载体来源及消息标识隔离。'
    ),
    params: {
      options: t(
        'Optional application IRpcFramerOptions, default {} with the field defaults below. Numeric limits must be positive safe integers; chunkBytes cannot exceed maxMessageBytes, which cannot exceed maxBufferedBytes.',
        '应用可选 `IRpcFramerOptions`，默认 `{}` 并采用下表字段默认值，数值限制须为正安全整数，`chunkBytes` 不得超过 `maxMessageBytes`，后者不得超过 `maxBufferedBytes`。'
      )
    },
    returns: t(
      `An IRpcFramer for ${kind} carrier values; ordered fragments share original state and close releases retained buffers/timers. Invalid limits throw INVALID_FRAME or FRAME_LIMIT_EXCEEDED.`,
      '返回' +
        (kind === 'string' ? '字符串' : '字节数组') +
        '载体的 `IRpcFramer`；有序分片共用原状态，关闭释放保留缓冲和计时器，限制非法抛帧非法或超限错误。'
    ),
    example:
      kind === 'string'
        ? framerExample
        : 'const framer = createBinaryFramer({ chunkBytes: 4 }); const context = { source: "a", messageId: "1" }; for (const frame of framer.frame(new Uint8Array([1,2,3,4,5]), context)) console.log(framer.accept(frame, context)); framer.close()'
  }
}
operation(
  'bindRpcFrameIngress',
  'Binds ingress preparation to the exact native accept callable and optional paired frame callable. Pair with createStringFramer; wrapping either method loses its original native facts.',
  '把入口准备绑定到精确原生接收函数及可选配对发送函数。搭配 `createStringFramer`，包装任一方法会失去原始原生事实。',
  {
    accept: t(
      'Exact framer.accept from a real framer; receives frame/context and returns IRpcFrameAcceptResult synchronously.',
      '来自实际分片器的精确接收函数，同步接收帧和上下文并返回接收结果。'
    ),
    frame: t(
      'Optional exact matching framer.frame; receives encoded value/context and returns physical frame array synchronously.',
      '可选精确匹配发送函数，同步接收编码值和上下文并返回物理帧数组。'
    )
  },
  t(
    'Callable IRpcBoundFrameIngress returning prepared frame/messageId; opaque custom methods keep their input and use whole-frame identity.',
    '返回可调用 `IRpcBoundFrameIngress`，产出准备帧及消息标识；不透明自定义方法保持输入并使用整帧身份。'
  ),
  'const framer = createStringFramer(); const ingress = bindRpcFrameIngress(framer.accept, framer.frame); const prepared = ingress("value", { source: "a", messageId: "1" }); framer.close()'
)
for (const [name, en, zh] of [
  [
    'messageFramerV1',
    'Canonical whole-frame identity framer accepts arbitrary complete messages without fragment state or native resource ownership.',
    '规范整帧恒等分片器接受任意完整消息，不创建分片状态或拥有原生资源。'
  ],
  [
    'messageFramer',
    'Versioned alias of messageFramerV1 retains the exact whole-frame callable identity and introduces no compatibility wrapper.',
    '版本入口别名保留规范整帧函数的精确身份，不引入兼容包装。'
  ],
  [
    'remoteProcessStringFramer',
    'Whole-message string boundary rejects unknown non-string values with native TypeError/INVALID_FRAME before forwarding; it never fragments text.',
    '整消息字符串边界在转交前以原生 `TypeError` 及 `INVALID_FRAME` 拒绝未知非字符串值，不拆分文本。'
  ]
] as const)
  scalar(
    name,
    en,
    zh,
    'const context = { source: "a", messageId: "1" }; console.log(' +
      name +
      '.accept(' +
      name +
      '.frame("hello", context)[0], context)); ' +
      name +
      '.close()'
  )
symbols.createJsonRpcFrameDecoder = {
  role: 'factory',
  purpose: t(
    'Creates an incremental Content-Length decoder retaining one bounded header/body. Pair with encodeJsonRpcFrame; arbitrary operating-system read splits preserve message order.',
    '创建只保留一个有界头部及主体的增量长度头解码器。搭配 `encodeJsonRpcFrame`，任意系统读取切分都保持消息顺序。'
  ),
  returns: t(
    'IJsonRpcFrameDecoder; malformed headers, UTF-8, JSON or incomplete finish throw JSONRPC_FRAME_INVALID.',
    '返回 `IJsonRpcFrameDecoder`；头部、编码、对象文本异常或半帧终止抛桥帧非法错误。'
  ),
  example: jsonExample
}
operation(
  'encodeJsonRpcFrame',
  'JSON-encodes one value into a contiguous ASCII Content-Length header and UTF-8 body. Pair with createJsonRpcFrameDecoder; this framing is distinct from the native four-byte prefix.',
  '把一个值编码为连续文本长度头和统一编码主体。搭配 `createJsonRpcFrameDecoder`；该分帧与原生四字节前缀不同。',
  {
    value: t(
      'Application JSON-serializable value chosen for one complete foreign protocol message.',
      '应用选择的可序列化为对象文本的单个完整外部协议值。'
    )
  },
  t(
    'Uint8Array of header plus body; empty/oversize encoded bodies throw JSONRPC_FRAME_INVALID, JSON encoding errors propagate.',
    '返回头加主体字节数组；编码主体为空或超限抛桥帧非法错误，文本编码错误直接传播。'
  ),
  jsonExample
)
symbols.createRpcStreamFrameDecoder = {
  role: 'factory',
  purpose: t(
    'Creates a bounded native network-order length-prefix decoder. Pair with encodeRpcStreamFrame; callbacks receive complete owned byte payloads or the first framing failure.',
    '创建有界网络字节序长度前缀解码器。搭配 `encodeRpcStreamFrame`，回调接收完整所属字节载荷或首次分帧失败。'
  ),
  options: 'IRpcStreamFrameDecoderOptions',
  returns: t(
    'IRpcStreamFrameDecoder; no timer or physical connection is acquired.',
    '返回 `IRpcStreamFrameDecoder`，不获取计时器或物理连接。'
  ),
  example: streamExample
}
symbols.createRpcStreamFrameDecoderWithLimit = {
  ...symbols.createRpcStreamFrameDecoder,
  purpose: t(
    'Creates the same native length-prefix decoder with a caller-owned phase-specific payload ceiling. Pair with encodeRpcStreamFrame; the ceiling is read before payload allocation.',
    '创建相同原生长度前缀解码器，并使用调用方所属的阶段载荷上限。搭配 `encodeRpcStreamFrame`，分配载荷前读取上限。'
  ),
  params: {
    maxFrameBytes: t(
      'Synchronous callback returns the current permitted payload byte ceiling; it takes no arguments and throws propagate.',
      '同步回调无参数，返回当前允许的载荷字节上限；抛错直接传播。'
    )
  },
  example:
    'const decoder = createRpcStreamFrameDecoderWithLimit({ onFrame: console.log, onError: console.error }, () => 65536); decoder.push(encodeRpcStreamFrame(new Uint8Array([1]))); decoder.finish(); decoder.close()'
}
operation(
  'encodeRpcStreamFrame',
  'Prefixes one nonempty byte payload with a four-byte unsigned big-endian length. Pair with createRpcStreamFrameDecoder; complete payloads must stay within RPC_STREAM_MAX_FRAME_BYTES.',
  '为非空字节载荷添加四字节无符号大端长度。搭配 `createRpcStreamFrameDecoder`；完整载荷必须在原生帧上限以内。',
  {
    payload: t(
      'Application or codec-produced nonempty Uint8Array of one whole message.',
      '应用或编解码器产生的单个整消息非空字节数组。'
    )
  },
  t(
    'Fresh contiguous prefix/payload Uint8Array; empty input throws INVALID_FRAME and oversize throws FRAME_LIMIT_EXCEEDED.',
    '返回新连续前缀载荷字节数组；空输入抛帧非法错误，超限抛帧超限错误。'
  ),
  streamExample
)
operation(
  'encodeRpcStreamTextFrame',
  'Writes text into a final four-byte length-prefixed byte frame, optionally borrowing a drained caller backing. Pair with createRpcStreamFrameDecoder; reuse storage only after the previous physical write finishes.',
  '把文本写入最终四字节长度前缀帧，可借用调用方已排空背板。搭配 `createRpcStreamFrameDecoder`，上次物理写入结束后才可复用存储。',
  {
    text: t('Application complete message text to UTF-8 encode.', '应用提供的待编码完整消息文本。'),
    encoder: t(
      'Application TextEncoder-like object: encode(input) returns bytes; encodeInto(input,destination) writes synchronously and returns written count. Throws propagate.',
      '应用提供的原生文本编码器同形对象；编码返回字节，定点编码同步写入目标并返回写入数，抛错直接传播。'
    ),
    storage: t(
      'Optional caller-owned Uint8Array whose preceding physical write has drained; undersized storage is replaced.',
      '可选调用方字节数组，其前次物理写入已排空；存储不足会重新分配。'
    )
  },
  t(
    'Complete framed view, possibly over the caller storage; empty text or excess bytes fail like encodeRpcStreamFrame.',
    '返回完整分帧视图，可能复用调用方存储；空文本及字节超限按原生字节编码规则失败。'
  ),
  'const decoder = createRpcStreamFrameDecoder({ onFrame: console.log, onError: console.error }); decoder.push(encodeRpcStreamTextFrame("hello", new TextEncoder())); decoder.finish(); decoder.close()'
)
symbols.createRpcHandshakeFrameReceiver = {
  role: 'factory',
  purpose: t(
    'Creates a protocol-only receiver for complete byte frames during one initial handshake and later business traffic. Pair with createRpcStreamFrameDecoder to supply complete payloads; it opens no connection.',
    '为初次握手及后续业务完整字节帧创建纯协议接收器。搭配 `createRpcStreamFrameDecoder` 提供完整载荷；不会打开连接。'
  ),
  options: 'IRpcHandshakeFrameReceiverOptions',
  returns: t(
    'IRpcHandshakeFrameReceiver owns one handshake reader and cached text; caller owns physical I/O and close reason.',
    '返回 `IRpcHandshakeFrameReceiver`，拥有一个握手读取者及缓存文本；物理输入输出和关闭原因归调用方。'
  ),
  example:
    'const receiver = createRpcHandshakeFrameReceiver({ role: "initiator" }); const decoder = createRpcStreamFrameDecoder({ onFrame: (frame) => receiver.accept(frame), onError: (error) => receiver.close(error) }); const waiting = receiver.readHandshakeFrame(); decoder.push(encodedReply); console.log(await waiting); receiver.activate(); receiver.close("done"); decoder.close()'
}
symbols.createRpcBootstrapFrameReceiver = {
  role: 'factory',
  purpose: t(
    'Creates one bootstrap-to-handshake handoff: first payload resolves bootstrap, one later payload may wait for its consumer. Pair with createRpcStreamFrameDecoder; no native resource is acquired.',
    '创建一次引导到握手交接：首载荷兑现引导，之后最多一个载荷等待消费方。搭配 `createRpcStreamFrameDecoder`，不获取原生资源。'
  ),
  returns: t(
    'IRpcBootstrapFrameReceiver; excess preattachment frames return HANDSHAKE_INVALID without replacing original payload identity.',
    '返回 `IRpcBootstrapFrameReceiver`；附加前过多帧返回握手非法错误，不替换原载荷身份。'
  ),
  example:
    'const receiver = createRpcBootstrapFrameReceiver(); const decoder = createRpcStreamFrameDecoder({ onFrame: (frame) => receiver.accept(frame), onError: (error) => receiver.fail(error) }); const off = receiver.attach(console.log, console.error); decoder.push(encodedBootstrap); console.log(await receiver.bootstrap); receiver.activate(); off(); decoder.close()'
}

/**
 * Binary preparation requires canonical runtime data, an explicit representation and genuine
 * digest.
 */
const binaryParams = {
  message: t(
    'Normalized IRpcRuntimeEnvelope from the canonical runtime constructor or strict normalizer, containing actual business binary roots.',
    '来自规范运行构造器或严格规范化器的运行信封，包含实际业务二进制根。'
  ),
  storage: t(
    'Application-selected inline or native RpcBinaryStorage matching the negotiated carrier capability.',
    '应用选择的内联或原生 `RpcBinaryStorage`，须匹配已协商载体能力。'
  ),
  limit: t(
    'Optional binary allocation budget, default `16777216` bytes: native storage charges the full backing; inline storage charges offset plus visible bytes. Codec/prehash and the outer carrier own any complete physical-frame limit.',
    '可选二进制分配预算，默认 `16777216` 字节：原生表示计完整背板，内联表示计偏移加可见字节；编解码器、预散列及外层载体另负责完整物理帧上限。'
  ),
  digest: t(
    'Optional IRpcBinaryDigest; native mode requires it. The asynchronous callback receives each complete original ArrayBuffer and resolves SHA-256 text; rejection fails preparation.',
    '可选摘要函数，原生模式必须提供；异步回调接收完整原始背板并兑现摘要文本，拒绝会使准备失败。'
  ),
  codec: t(
    'Optional application-held IRpcBinaryDataCodec owns representation encoding and optional inline capture; its throws fail the original preparation; the native prehash path checks encoded physical size, while other representations retain their codec or outer-carrier limit responsibility.',
    '应用可选持有的 `IRpcBinaryDataCodec` 负责表示编码及可选内联捕获；抛错使原准备失败；原生预散列路径检查编码物理大小，其它表示仍由编解码器或外层载体负责该上限。'
  )
}
/** Captured binary ownership remains separate from any physical transfer decision. */
const binaryExample =
  'const captured = captureRpcBinaryData(message, "inline"); const prepared = await captured.prepare(); const restored = await restoreRpcBinary(prepared.manifest, "inline", prepared.sidecars); console.log(restored.kind)'
symbols.captureRpcBinaryData = {
  role: 'factory',
  purpose: t(
    'Synchronously captures the original protocol graph and backing references at the caller-selected snapshot point. Pair with restoreRpcBinary for a complete inline round trip; preparation can finish later.',
    '在调用方选择的快照时点同步捕获原始协议图和背板引用。搭配 `restoreRpcBinary` 完成内联往返，准备可以稍后完成。'
  ),
  params: binaryParams,
  returns: t(
    'IRpcCapturedBinaryData; malformed graph, backing or budget throws INVALID_ENVELOPE synchronously.',
    '返回 `IRpcCapturedBinaryData`；图、背板或预算异常时同步抛信封非法错误。'
  ),
  example: binaryExample
}
operation(
  'prepareRpcBinary',
  'Captures one canonical runtime envelope before yielding, then finishes manifest encoding and complete-backing digests. Pair with restoreRpcBinary; no endpoint, replay or execution state is changed.',
  '让出执行前捕获一个规范运行信封，再完成清单编码及完整背板摘要。搭配 `restoreRpcBinary`；不改变端点、重放或执行状态。',
  binaryParams,
  t(
    'Promise of IRpcPreparedBinary; failures reject with native coded INVALID_ENVELOPE and retained cause.',
    '返回 `IRpcPreparedBinary` 承诺；失败以原生编码信封非法错误拒绝并保留原因。'
  ),
  'const prepared = await prepareRpcBinary(message, "inline"); const restored = await restoreRpcBinary(prepared.manifest, "inline", prepared.sidecars)'
)
/** Strict and decoder-proven restoration share original digest checks and promise scheduling. */
for (const [name, decoded] of [
  ['restoreRpcBinary', false],
  ['restoreRpcBinaryDecoded', true]
] as const)
  operation(
    name,
    decoded
      ? 'Restores binary only from canonical codec output selected by its actual receive owner. Own-property getters may execute; use restoreRpcBinary for caller-constructed input. Integrity is checked before returning.'
      : 'Validates a closed binary manifest and all original sidecars, restores portable slots, then verifies complete-backing lengths and digests before returning. Pair with prepareRpcBinary for original prepared data.',
    decoded
      ? '只恢复实际接收所有者选择的规范编解码输出；可能执行自有属性读取器，调用方构造输入应使用严格恢复；返回前检查完整性。'
      : '校验封闭二进制清单及全部原背板，恢复可移植位置，再于返回前校验完整背板长度与摘要。搭配 `prepareRpcBinary` 使用原准备数据。',
    {
      value: t(
        decoded
          ? 'Canonical codec-produced manifest chosen by the actual decoding owner; never arbitrary caller input.'
          : 'Untrusted received manifest with exact profile/storage/envelope/backings fields.',
        decoded
          ? '实际解码所有者选择的规范编解码清单，不接受任意调用方输入。'
          : '接收的未可信清单，须精确包含形态、存储、信封和背板字段。'
      ),
      storage: binaryParams.storage,
      sidecarInput: t(
        'Optional original ordered ArrayBuffer sidecars, default empty array; inline mode requires none.',
        '可选原始有序背板数组，默认空数组；内联模式不允许附带背板。'
      ),
      limit: binaryParams.limit,
      digest: binaryParams.digest
    },
    t(
      'Promise of IRpcRuntimeEnvelope; malformed structure rejects INVALID_ENVELOPE, complete-backing mismatch adds binary-integrity violation.',
      '返回运行信封承诺；异常结构以信封非法错误拒绝，完整背板不匹配附加二进制完整性违规。'
    ),
    'const prepared = await prepareRpcBinary(message, "inline"); const restored = await ' +
      name +
      '(prepared.manifest, "inline", prepared.sidecars)'
  )
for (const name of ['prepareRpcBinary', 'restoreRpcBinary', 'restoreRpcBinaryDecoded'])
  symbols['binary/lazy:' + name] = {
    ...symbols[name],
    params: {
      ...symbols[name].params,
      ...(name === 'prepareRpcBinary' ? {} : { sidecars: symbols[name].params!.sidecarInput })
    },
    purpose: t(
      symbols[name].purpose.en +
        ' This entry loads the canonical parser lazily without changing synchronous capture or digest ownership.',
      symbols[name].purpose.zh + '此入口按需加载规范解析器，不改变同步捕获及摘要所有权。'
    )
  }
/** Native wrapper accounting inputs never serialize original backing bytes. */
const nativeParams = {
  protectedMetadata: t(
    'Opaque encoded/authenticated metadata produced by the actual held codec.',
    '实际持有编解码器产生的不透明编码或认证元数据。'
  ),
  sidecarCount: t(
    'Count of the exact original native sidecar array.',
    '精确原始原生附带背板数组的数量。'
  ),
  backingBytes: t(
    'Complete original backing-byte total returned by capture or native wrapper inspection.',
    '捕获或原生包装检查返回的完整原始背板总字节数。'
  )
}
operation(
  'measureRpcNativeBinaryFrame',
  'Counts the exact runtime selector and protected metadata representation plus complete original backing bytes without serializing caller-owned buffers.',
  '计量精确运行选择器、受保护元数据表示及完整原始背板字节，不序列化调用方缓冲。',
  nativeParams,
  t(
    'Whole native physical frame byte charge, including outer wrapper overhead.',
    '返回整个原生物理帧字节计费，包含外层包装开销。'
  ),
  'const bytes = measureRpcNativeBinaryFrame(metadata, prepared.sidecars.length, prepared.backingBytes)'
)
operation(
  'assertRpcNativeBinaryFrameSize',
  'Enforces complete native physical size using actual captured backing totals and protected metadata, preserving the original contract size boundary.',
  '依据实际捕获背板总量及受保护元数据执行完整原生物理大小限制，保持原契约大小边界。',
  { ...nativeParams, limit: physicalParams.limit },
  t(
    'Returns void within the ceiling; excess throws coded FRAME_LIMIT_EXCEEDED.',
    '上限内返回空值；超限抛编码帧超限错误。'
  ),
  'assertRpcNativeBinaryFrameSize(metadata, prepared.sidecars.length, prepared.backingBytes, limit)'
)
operation(
  'readRpcNativeBinary',
  'Inspects only the closed native wrapper and unique genuine sidecar lengths before authentication. It performs no hashing and grants no trust to protected inner data.',
  '认证前只检查封闭原生包装及不重复真实背板长度，不作摘要，也不信任受保护内部数据。',
  {
    value: t(
      'Untrusted physical value selected after removing the runtime carrier selector.',
      '移除运行载体选择器后选中的未可信物理值。'
    ),
    limit: physicalParams.limit
  },
  t(
    'Protected metadata, original sidecars and total backing bytes; undefined for non-native wrappers; invalid selected wrappers throw INVALID_ENVELOPE.',
    '返回受保护元数据、原背板及总字节；非原生包装返回未定义，已选非法包装抛信封非法错误。'
  ),
  'const selected = readRpcNativeBinary(frame, limit); if (selected) console.log(selected.backingBytes)'
)
operation(
  'rpcBinaryBackingLength',
  'Reads genuine non-shared ArrayBuffer byte length from intrinsic slots rather than a shadowed application property.',
  '通过内建槽返回真实非共享背板的完整字节数，包含视图以外的背板范围，不读取应用遮蔽的同名属性。',
  {
    backing: t(
      'Original non-shared ArrayBuffer from application data or native sidecars.',
      '来自应用数据或原生附带背板的原始非共享缓冲。'
    )
  },
  t(
    'Actual backing bytes; a non-ArrayBuffer fails INVALID_ENVELOPE.',
    '返回实际背板字节数，非背板值以信封非法错误失败。'
  ),
  'const bytes = rpcBinaryBackingLength(new ArrayBuffer(8))'
)
operation(
  'rpcBinaryView',
  'Reads the genuine original backing, byte offset and visible length of a Uint8Array without invoking shadowed buffer properties; shared backings are unsupported.',
  '不调用遮蔽缓冲属性，读取字节视图的真实原背板、偏移及可见长度；不支持共享背板。',
  {
    value: t(
      'Application genuine Uint8Array view on a non-shared ArrayBuffer.',
      '应用真实字节数组视图，其背板须为非共享缓冲。'
    )
  },
  t(
    'Read-only backing/offset/length facts; invalid backing throws INVALID_ENVELOPE.',
    '返回只读背板、偏移及长度事实；背板非法抛信封非法错误。'
  ),
  'const view = rpcBinaryView(new Uint8Array(new ArrayBuffer(8), 2, 3))'
)
operation(
  'hasRpcBinaryEnvelope',
  'Reads original portable snapshot evidence in actual business slots to select binary handling, avoiding another recursive scan. It is not an untrusted-input validator.',
  '读取实际业务位置中的原始可移植快照证据来选择二进制处理，避免再次递归扫描；不是未可信输入校验器。',
  {
    envelope: t(
      'Normalized runtime envelope or actual held payload slot from its original owner.',
      '原所有者提供的已规范运行信封或实际持有载荷位置。'
    )
  },
  t(
    'True when a business slot carries original binary snapshot evidence; false otherwise.',
    '业务位置带原始二进制快照证据时返回真，否则返回假。'
  ),
  'const selected = hasRpcBinaryEnvelope(message)'
)
operation(
  'isRpcBinaryIntegrityFailure',
  'Recognizes local complete-backing length or SHA mismatch through bounded original causes, separate from structural binary validation failures.',
  '经有界原始原因识别本地完整背板长度或摘要不匹配，与二进制结构校验失败分开。',
  {
    error: t(
      'Original caught contract or wrapper failure, not a peer-supplied proof object.',
      '捕获的原契约或包装失败，不是对端提供的证明对象。'
    )
  },
  t(
    'Boolean classification; no metadata or native backing is modified.',
    '返回布尔分类，不修改元数据或原生背板。'
  ),
  'if (isRpcBinaryIntegrityFailure(error)) console.error(error)'
)

/** Strict public normalization and provenance-selected decoded normalization stay visibly distinct. */
operation(
  'normalizeRuntimeEnvelope',
  'Strictly snapshots and validates the closed runtime union without executing a task, granting a channel or committing replay state. Caller-constructed records use this entry.',
  '严格快照并校验封闭运行联合，不执行任务、不赋予通道或提交重放状态；调用方构造记录使用此入口。',
  {
    value: t(
      'Untrusted caller or received runtime-envelope candidate.',
      '未可信调用方或接收运行信封候选值。'
    ),
    portable: portableCallback
  },
  t(
    'Fresh frozen IRpcRuntimeEnvelope; grammar or portable payload failures throw INVALID_ENVELOPE.',
    '返回新冻结运行信封；语法或可移植载荷失败抛信封非法错误。'
  ),
  'const message = normalizeRuntimeEnvelope(candidate)'
)
symbols.normalizeRuntimeEnvelopeDecoded = {
  ...symbols.normalizeRuntimeEnvelope,
  purpose: t(
    'Validates canonical codec output selected by the actual decoding owner; own enumerable getters may run. It is not an admission path for caller-constructed objects; use normalizeRuntimeEnvelope there.',
    '校验实际解码所有者选择的规范编解码输出，可能执行自有可枚举读取器；调用方构造对象应使用严格规范化入口。'
  ),
  example: 'const message = normalizeRuntimeEnvelopeDecoded(codecOutput)'
}
operation(
  'normalizeRuntimeGeneration',
  'Validates one strict restart/session counter record with a nonnegative safe value and bounded original provider identity; it never derives a generation from an attempt number.',
  '校验严格重启或会话计数记录，要求非负安全数及有界原提供方身份；不从尝试序号推导世代。',
  {
    value: t(
      'Generation data obtained from the actual runtime provider or received task tuple.',
      '来自实际运行提供方或接收任务元组的世代数据。'
    )
  },
  t(
    'Frozen IRpcRuntimeGeneration; malformed records throw INVALID_ENVELOPE.',
    '返回冻结 `IRpcRuntimeGeneration`；异常记录抛信封非法错误。'
  ),
  'const generation = normalizeRuntimeGeneration({ kind: "session", value: 0, providerId: "provider" })'
)
operation(
  'normalizeRuntimeSteps',
  'Validates and freezes a nonempty dense ordered list of request-only group steps, normalizing each payload at the original portable boundary.',
  '校验并冻结非空稠密有序请求分组步骤，在原可移植边界规范化每个载荷。',
  {
    value: t(
      'Application or received group step array of method/payload records.',
      '应用或接收的由方法及载荷记录组成的分组步骤数组。'
    ),
    portable: portableCallback
  },
  t(
    'Read-only IRpcRuntimeStep array; holes, unknown fields or invalid methods fail INVALID_ENVELOPE.',
    '返回只读运行步骤数组；空洞、未知字段或非法方法以信封非法错误失败。'
  ),
  'const steps = normalizeRuntimeSteps([{ method: "ping", payload: null }])'
)
operation(
  'createRuntimeCallEnvelope',
  'Constructs a typed runtime call from original owner-held header fields and normalizes payload last. It copies the route and nested generations without freezing caller input objects.',
  '使用原所有者持有的头字段构造类型化运行调用，最后规范载荷；复制路由及嵌套世代，不冻结调用方输入对象。',
  {
    header: t(
      'IRpcRuntimeCallHeader created by the actual caller with accepted caller/target identities and explicit options.',
      '实际调用方使用已接受双方身份及显式选项创建的运行调用头。'
    ),
    payload: t(
      'Optional application portable business input; omitted input creates no payload field.',
      '可选应用可移植业务输入；省略时不创建载荷字段。'
    ),
    portable: portableCallback
  },
  t(
    'Frozen runtime-call variant; invalid route/task/id/options/payload throws INVALID_ENVELOPE.',
    '返回冻结运行调用形式；路由、任务、标识、选项或载荷非法抛信封非法错误。'
  ),
  'const message = createRuntimeCallEnvelope(header, { count: 1 })'
)
operation(
  'wrapRuntimeCarrier',
  'Adds only the runtime parser selector while retaining protected output category: text prefix, copied byte prefix or a frozen two-field object. Pair with readRuntimeCarrier.',
  '只添加运行解析选择器并保持受保护输出类别：文本前缀、复制字节前缀或冻结双字段对象。搭配 `readRuntimeCarrier`。',
  {
    frame: t(
      'Opaque already encoded/protected output from the actual codec owner.',
      '实际编解码所有者提供的已编码或受保护不透明输出。'
    )
  },
  t(
    'Selected physical carrier value; this wrapper grants no authentication or routing authority.',
    '返回选定物理载体值；包装不赋予认证或路由权限。'
  ),
  'const carrier = wrapRuntimeCarrier("protected"); console.log(readRuntimeCarrier(carrier)?.frame)'
)
operation(
  'readRuntimeCarrier',
  'Reads only the fixed parser selector and keeps protected inner output opaque. Pair with wrapRuntimeCarrier; selected objects must have exactly two enumerable own data fields.',
  '只读取固定解析选择器，保持受保护内部输出不透明。搭配 `wrapRuntimeCarrier`；已选对象须恰好有两个可枚举自有数据字段。',
  {
    value: t(
      'Untrusted physical text, bytes or object from the receiving carrier.',
      '接收载体提供的未可信物理文本、字节或对象。'
    )
  },
  t(
    'Frame selection record or undefined for ordinary traffic; malformed selected objects throw INVALID_ENVELOPE.',
    '返回帧选择记录，普通流量返回未定义；已选异常对象抛信封非法错误。'
  ),
  'const carrier = wrapRuntimeCarrier("protected"); const selected = readRuntimeCarrier(carrier)'
)
operation(
  'runtimeOperationCapabilities',
  'Returns the exact AND requirements for an opted-in operation. It never closes an offer transitively or enables capabilities merely because they appear in the result.',
  '返回显式操作精确同时满足的能力要求，不传递闭合提议，也不因结果中列出能力就启用能力。',
  {
    mode: t(
      'Application-selected RpcRuntimeMode for the actual operation.',
      '应用为实际操作选择的运行模式。'
    ),
    options: t(
      'Actual IRpcRuntimeOptions, default empty; only explicitly requested fields add requirements.',
      '实际运行选项，默认空对象；只有显式请求字段增加要求。'
    ),
    hasSignal: t(
      'Whether the actual local call has a cancellation signal, default false.',
      '实际本地调用是否具有取消信号，默认假。'
    )
  },
  t(
    'Frozen ordered capability-name array; runtime-api and generation are always required.',
    '返回冻结有序能力名称数组，始终要求运行接口和世代能力。'
  ),
  'const required = runtimeOperationCapabilities("request", { timeoutMs: 1000 }, true)'
)
operation(
  'normalizeRpcEnvelope',
  'Snapshots the legacy request/response/discovery/variation/stream union in stable failure order. Unknown additive fields may be observed, while route and portable payloads retain their own validators.',
  '按稳定失败顺序快照传统请求、响应、发现、控制及流联合；新增未知字段可观察，路由和可移植载荷保留各自校验。',
  {
    value: t(
      'Received unknown semantic envelope after codec decoding.',
      '编解码后收到的未知语义信封。'
    ),
    options: t(
      'Optional IRpcEnvelopeOptions observing unknown fields synchronously; omission adds no observer.',
      '可选同步观察未知字段的信封选项，省略不安装观察者。'
    )
  },
  t(
    'Frozen IRpcEnvelope; invalid shape/route/payload/error throws INVALID_ENVELOPE with first-violation evidence.',
    '返回冻结传统信封；形态、路由、载荷或错误非法抛带首违规证据的信封非法错误。'
  ),
  'const envelope = normalizeRpcEnvelope(decoded)'
)
for (const name of ['rpcProtocol', 'rpcProtocolV1'])
  scalar(
    name,
    'Frozen canonical protocol descriptor combines stable message/version identity with normalizeRpcEnvelope; it owns validation but no connection or execution.',
    '冻结规范协议描述对象把稳定消息版本身份与信封规范化函数组合；只拥有校验，不拥有连接或执行。',
    'const envelope = ' + name + '.normalize(decoded)'
  )
/** Stream checks return errors as data and leave the state-machine owner unchanged. */
const sequenceParams = {
  payload: t(
    'Actual admitted event sequence from the incoming stream payload.',
    '入站流载荷中实际已接纳的事件序号。'
  ),
  pointer: t(
    'Optional validator diagnostic pointer, default /seq; use /stream/seq for runtime controls.',
    '可选校验诊断指针，默认根序号位置；运行控制使用嵌套流序号位置。'
  )
}
for (const [name, en, zh, extra] of [
  [
    'checkRpcStreamInitialSequence',
    'Checks that the original stream open uses sequence zero without starting or advancing stream state.',
    '检查实际流打开帧是否使用零序号并返回协议错误或未定义，不创建交换记录，也不推进原所有者的流状态。',
    {}
  ],
  [
    'checkRpcStreamSequence',
    'Checks equality with the owner-held expected sequence; an absent exchange cannot acknowledge cancellation.',
    '将实际帧序号与原所有者持有的预期序号比较并返回错误或未定义，不存在的交换不能据此确认取消。',
    {
      expected: t(
        'Original owner-held IRpcStreamSequence, or undefined when no exchange exists.',
        '原所有者持有的流序号；没有交换时为未定义。'
      )
    }
  ],
  [
    'checkRpcStreamProgress',
    'Allows a terminal runtime notification to advance beyond discarded items, while rejecting backward sequence movement.',
    '检查终止通知的序号进度并返回错误或未定义，允许越过已丢弃条目前进，拒绝后退且不更新流状态。',
    { state: t('Actual owner-held latest IRpcStreamSequence.', '实际所有者持有的最近流序号。') }
  ],
  [
    'checkRpcStreamConsumerCredit',
    'Checks matching consumer sequence and an actual outstanding pull credit before accepting a response.',
    '接受响应前核对消费方序号与尚未消耗的拉取额度，返回协议错误或未定义，状态更新仍由原流所有者执行。',
    {
      state: t(
        'Actual consumer-owned sequence and pending credit token.',
        '实际消费方拥有的序号及待定额度令牌。'
      )
    }
  ],
  [
    'checkRpcStreamProducerCredit',
    'Checks matching producer sequence and absence of an in-flight pull before granting the next item.',
    '授予下一条目前核对生产方序号及进行中的拉取状态，返回协议错误或未定义，不启动额外生产操作。',
    {
      state: t(
        'Actual producer-owned sequence and busy marker.',
        '实际生产方拥有的序号及忙碌标记。'
      )
    }
  ]
] as const)
  operation(
    name,
    en,
    zh,
    { ...sequenceParams, ...extra },
    t(
      'Undefined on acceptance, otherwise an original coded INVALID_STREAM Error; state is not mutated.',
      '接受时返回未定义，否则返回编码流非法错误对象；不修改状态。'
    ),
    'const failure = ' +
      name +
      '({ seq: 0 }' +
      (name === 'checkRpcStreamInitialSequence'
        ? ''
        : name === 'checkRpcStreamConsumerCredit'
          ? ', { seq: 0, pending: true }'
          : name === 'checkRpcStreamProducerCredit'
            ? ', { seq: 0, busy: false }'
            : ', { seq: 0 }') +
      '); if (failure) console.error(failure)'
  )
for (const [name, en, zh, extra] of [
  [
    'checkRpcRuntimeStreamFinish',
    'Validates finish-without-items against actual call options; only before-start cancellation permits this finish control.',
    '依据实际调用选项校验不产条目结束控制；只有启动前取消模式允许该控制。',
    {}
  ],
  [
    'checkRpcRuntimeStreamIntent',
    'Validates an owner-held early finish intent against original call cancellation semantics without manufacturing control authority.',
    '根据原始调用取消语义校验所有者已有提前结束意图，不创建控制权限。',
    {
      intent: t(
        'Actual retained intent with optional finish flag; false/absent adds no finish request.',
        '实际保留的意图及可选结束标志；假值或省略不增加结束请求。'
      )
    }
  ],
  [
    'checkRpcRuntimeStreamTransition',
    'Checks an actual finish event against original before-start cancellation options; other events are unaffected.',
    '依据原始启动前取消选项检查实际结束事件；其他事件不受此规则影响。',
    {
      control: t(
        'Actual admitted runtime stream event carrying its original event discriminator.',
        '实际已接纳运行流事件，携带原事件判别字段。'
      )
    }
  ]
] as const)
  operation(
    name,
    en,
    zh,
    {
      ...extra,
      options: t(
        'Actual original call cancel option, not a reconstructed capability claim.',
        '实际原调用的取消选项，不是重建的能力声明。'
      )
    },
    t(
      'Undefined when allowed; invalid finish returns a coded INVALID_STREAM Error without mutating ownership.',
      '允许时返回未定义；非法结束返回编码流非法错误，不改变所有权。'
    ),
    name === 'checkRpcRuntimeStreamFinish'
      ? 'const failure = checkRpcRuntimeStreamFinish({ cancel: "before-start" })'
      : 'const failure = ' +
          name +
          '(' +
          (name.endsWith('Intent') ? '{ finish: true }' : '{ event: "finish-without-items" }') +
          ', { cancel: "before-start" })'
  )
operation(
  'measurePortableStreamValue',
  'Counts codec-independent portable item bytes, including full native backing/view sizes; unpaired surrogates count as infinite so the item cannot pass a finite budget.',
  '计量独立于编解码的可移植条目字节，包括原生背板或视图大小；未配对代理字符计为无穷，无法通过有限预算。',
  { value: t('Already normalized portable stream item value.', '已经规范化的可移植流条目值。') },
  t(
    'Conservative numeric byte charge; no encoding or state transition occurs.',
    '返回保守数字字节计费，不编码也不迁移状态。'
  ),
  'const bytes = measurePortableStreamValue({ text: "hello" })'
)
operation(
  'normalizeStreamPayload',
  'Validates one of seven stream event forms, sequence and item budget while normalizing portable item/error fields; stateful direction and credit checks remain with the stream owner.',
  '校验七种流事件形式、序号及条目预算，并规范可移植条目和错误字段；有状态方向及额度检查仍归流所有者。',
  {
    value: t('Untrusted decoded stream payload from the peer.', '来自对端的未可信解码流载荷。'),
    portableValue: portableCallback
  },
  t(
    'Frozen IRpcStreamPayload; invalid fields, sequence or value budget throw INVALID_STREAM.',
    '返回冻结流载荷；字段、序号或值预算非法抛流非法错误。'
  ),
  'const payload = normalizeStreamPayload({ event: "open", seq: 0 })'
)
for (const name of [
  'normalizeRuntimeEnvelope',
  'normalizeRuntimeEnvelopeDecoded',
  'normalizeStreamPayload'
])
  symbols['runtime/lazy:' + name] = {
    ...symbols[name],
    params: { ...symbols[name].params, portable: portableCallback },
    returns: t(
      'Canonical normalized value, or a Promise while the cold parser loads; validation failure keeps the canonical native contract error.',
      '返回规范化值，冷解析器加载期间返回承诺；校验失败保留规范原生契约错误。'
    ),
    purpose: t(
      symbols[name].purpose.en +
        ' This subpath lazily loads the parser without changing the selected data contract.',
      symbols[name].purpose.zh + '此子入口按需加载解析器，不改变所选数据契约。'
    )
  }
/** Unknown-field warning options are real anonymous constructor fields. */
symbols.createRpcUnknownFieldWarner = {
  ...symbols.createRpcUnknownFieldWarner,
  optionDocs: {
    maxKeysPerConnection: p(
      'Maximum retained warning identities for one original connection before one wildcard overflow warning.',
      '单个原连接保留警告身份的最大数量，超过后只发一次通配溢出警告。',
      t('`256` keys per connection.', '默认每连接 `256` 个键。')
    ),
    maxConnections: p(
      'Maximum remembered connections; least recently observed connections are evicted first.',
      '记住的最大连接数量，最久未观察到的连接先移除。',
      t('`1024` remembered connections.', '默认记住 `1024` 个连接。')
    ),
    warn: p(
      'Application synchronous callback receives connection identity and normalized fieldKey; it returns void and exceptions propagate.',
      '应用同步回调接收连接身份及规范字段键，返回空值，异常直接传播。'
    )
  }
}

/** Unknown-field callbacks observe additive fields but do not choose normalization policy. */
const envelopeOptions: Record<string, IMemberDoc> = {
  onUnknownField: p(
    'Optional synchronous application callback receives JSON pointer and unknown field name; returns void. A throw propagates from normalization.',
    '可选应用同步回调接收对象指针及未知字段名称，返回空值；抛错从规范化调用传播。',
    t(
      'Absent: additive unknown fields are ignored without warning.',
      '默认不设置，忽略新增未知字段且不发警告。'
    )
  )
}
/** Optional fields on strict received error nodes default to rejection. */
const wireErrorOptions: Record<string, IMemberDoc> = {
  unknownFields: {
    ...p(
      'Chooses rejection or ignored admission of unknown received error-node fields.',
      '选择拒绝或忽略接纳收到的未知错误节点字段。',
      t('`reject`; unknown fields fail validation.', '默认拒绝，未知字段会使校验失败。')
    ),
    values: { enum: 'RpcWireErrorUnknownFieldMode' }
  },
  onUnknownField: {
    ...envelopeOptions.onUnknownField,
    default: t(
      'Omitted; no observer is called. The default unknownFields policy still rejects unknown error-node fields.',
      '默认省略，不调用观察者；默认 `unknownFields` 策略仍拒绝未知错误节点字段。'
    )
  }
}
/** Canonical framer numeric defaults are captured once by the constructor. */
const framerOptions: Record<string, IMemberDoc> = {
  chunkBytes: p(
    'Positive safe-integer fragment size: bytes for binary, UTF-16 code units for strings; cannot exceed maxMessageBytes.',
    '正安全整数分片大小，二进制按字节、字符串按 UTF-16 码元计量，不得超过 `maxMessageBytes`。',
    t('`16384` units per fragment.', '默认每片 `16384` 个计量单位。')
  ),
  maxMessageBytes: p(
    'Positive safe-integer size ceiling for complete inbound/outbound values and reassembly; string counts UTF-16 code units, binary counts bytes. Cannot exceed maxBufferedBytes.',
    '完整接收、发送值及重组大小的正安全整数上限；字符串按文本编码单元计，二进制按字节计，不得超过总保留容量。',
    t('`16777216` encoded units per message.', '默认每条消息最多 `16777216` 个编码单位。')
  ),
  maxChunks: p(
    'Positive safe-integer maximum declared fragments for one message.',
    '单条消息允许声明的最大分片数量，须为正安全整数。',
    t('`4096` fragments per message.', '默认每条消息最多 `4096` 片。')
  ),
  maxBufferedBytes: p(
    'Positive safe-integer total retained incomplete data across all source/message pairs.',
    '所有来源消息组合保留的未完成数据总量，须为正安全整数。',
    t('`67108864` retained encoded units.', '默认最多保留 `67108864` 个编码单位。')
  ),
  maxConcurrentMessages: p(
    'Positive safe-integer maximum simultaneous incomplete source/message assemblies.',
    '同时进行的不完整来源消息重组最大数量，须为正安全整数。',
    t('`256` concurrent incomplete messages.', '默认同时最多 `256` 条不完整消息。')
  ),
  assemblyTimeoutMs: p(
    'Positive safe-integer timer deadline after the first fragment before marking its assembly expired.',
    '首片之后把重组标记为到期的正安全整数毫秒时限。',
    t('`30000` milliseconds from first fragment.', '默认首片后最多等待 `30000` 毫秒。')
  ),
  now: p(
    'Optional synchronous application clock callback returning a numeric time; current implementation snapshots but never invokes it.',
    '可选应用同步时钟回调，返回数字时间；当前实现只保存该回调，从不调用。',
    t('Omitted; no application clock callback is invoked.', '默认省略，不调用应用时钟回调。')
  ),
  schedule: p(
    'Optional synchronous timer adapter receives a no-argument expiry callback and delayMs; returns the opaque handle passed to cancel. A failed scheduler keeps prior semantic identity or gains `CALLBACK_FAILED`; unattachable failures remain on `cause`.',
    '可选同步计时适配器接收无参数到期回调及延迟毫秒数，返回取消所用句柄；失败保留已有语义身份，否则附加 `CALLBACK_FAILED`，不可附加身份的失败保留在 `cause`。',
    t(
      'Host setTimeout when available; no timer when the host lacks it.',
      '默认使用可用宿主计时器；宿主没有计时器则不安排。'
    )
  ),
  cancel: p(
    'Optional synchronous timer cancellation receives the original handle returned by schedule; cleanup failure is observed through host `reportError` or terminal host reporting. A reporter failure stays secondary; the frame result is preserved.',
    '可选同步计时取消函数接收安排函数返回的原句柄；清理失败经宿主 `reportError` 或终端宿主报告路径观察；报告器失败保留为次级原因，不替换原帧结果。',
    t('Host clearTimeout when available.', '默认使用可用的宿主计时取消函数。')
  )
}
/** Each callback gets a complete frame or original coded error synchronously. */
const frameDecoderOptions: Record<string, IMemberDoc> = {
  onFrame: m(
    'Synchronously consumes each complete decoder-owned byte payload after internal assembly state is released.',
    '内部重组状态释放后，同步消费每个完整且归解码器所有的字节载荷。',
    {
      frame: t(
        'Complete Uint8Array payload freshly assembled by the decoder; no four-byte prefix is included.',
        '解码器新重组的完整字节载荷，不含四字节前缀。'
      )
    },
    t(
      'Return void; a throw propagates through push without being converted to an onError callback.',
      '返回空值；抛错从推送调用传播，不转换为错误回调。'
    ),
    'const decoder = createRpcStreamFrameDecoder({ onFrame: console.log, onError: console.error }); decoder.push(encodeRpcStreamFrame(new Uint8Array([1]))); decoder.close()'
  ),
  onError: m(
    'Synchronously receives the first malformed-frame error after the decoder becomes terminal and releases retained state.',
    '解码器进入终态并释放保留状态后，同步接收首次异常帧错误。',
    {
      error: t(
        'Original coded INVALID_FRAME or FRAME_LIMIT_EXCEEDED error created by the decoder.',
        '解码器创建的原始编码帧非法或帧超限错误。'
      )
    },
    t(
      'Return void; callback throws propagate to the decoder caller.',
      '返回空值；回调抛错向解码器调用方传播。'
    ),
    'const decoder = createRpcStreamFrameDecoder({ onFrame: console.log, onError: console.error }); decoder.finish()'
  )
}
/** Same accepted forms on every declared encoded-domain field. */
const encodedValues = {
  unknown: t(
    'Arbitrary message-object carrier; no string or byte encoding is imposed.',
    '任意消息对象载体，不强制文本或字节编码。'
  ),
  string: t(
    'Text carrier values require a string-compatible codec boundary.',
    '文本载体值要求兼容字符串的编解码边界。'
  ),
  uint8array: t(
    'Byte carrier values require an actual Uint8Array encoding.',
    '字节载体值要求真实的字节数组编码。'
  )
}
/** Descriptor members are retained alongside callable framer behavior. */
const descriptorMembers = members(['id', 'version'])
/** Framer methods own a single bounded state, not an independent reassembler copy. */
const framerMembers: Record<string, IMemberDoc> = {
  ...descriptorMembers,
  inputEncodedType: {
    ...p(
      'Encoded carrier domain accepted by frame; installation validates codec compatibility.',
      '发送方法接受的编码载体域，安装时校验编解码兼容性。'
    ),
    values: encodedValues
  },
  outputEncodedType: {
    ...p(
      'Carrier domain yielded after reassembly, independent from physical fragment objects.',
      '重组后产出的载体域，与物理分片对象分开。'
    ),
    values: encodedValues
  },
  frame: m(
    'Synchronously partitions one encoded value or returns a whole-frame value when no fragmentation is needed.',
    '同步拆分单个编码值，无需分片时返回一个整帧值。',
    {
      value: t('Encoded message from the matching codec.', '匹配编解码器产生的已编码消息。'),
      context: t(
        'Transport-owned IRpcFrameContext with actual source and sender-assigned messageId.',
        '载体拥有的分帧上下文，含实际来源和发送方分配的消息标识。'
      )
    },
    t(
      'Ordered physical frame array; size or fragment-count excess throws FRAME_LIMIT_EXCEEDED.',
      '返回有序物理帧数组；大小或分片数量超限抛帧超限错误。'
    ),
    framerExample
  ),
  accept: m(
    'Synchronously admits an ordered fragment or whole carrier into the original source/message assembly.',
    '同步把有序分片或整载体接纳到原来源消息重组中。',
    {
      frame: t(
        'Received physical whole value or fragment from the matching sender framer.',
        '来自匹配发送分片器的接收物理整值或分片。'
      ),
      context: t(
        'Receiver carrier context with actual source and matching messageId.',
        '含实际来源及匹配消息标识的接收载体上下文。'
      )
    },
    t(
      'IRpcFrameAcceptResult: pending, complete value, or rejected original coded Error.',
      '返回接收结果：待定、完整值或被拒绝的原编码错误。'
    ),
    framerExample
  ),
  close: m(
    'Idempotently closes reassembly, revoking each timer before cancellation so synchronous reentry cancels it once, and drops incomplete messages.',
    '幂等关闭重组；取消前撤销计时器所有权，同步重入仍只取消一次，并丢弃不完整消息。',
    {
      reason: t(
        'Optional caller close reason; built-in framers do not encode or transmit it.',
        '调用方可选关闭原因；内置分片器不编码或传输该原因。'
      )
    },
    t(
      'Retained state is released; future receives are rejected where the framer owns terminal state.',
      '保留状态已释放；拥有终态的分片器会拒绝后续接收。'
    ),
    'framer.close()'
  )
}
/** Type nodes for component ownership and framing. */
Object.assign(types, {
  IRpcDescriptor: typeDoc(
    'Frozen stable component identity, separate from package version and runtime instance identity.',
    '冻结的稳定组件身份，与包版本和运行实例身份分开。',
    descriptorMembers,
    'const descriptor = createDescriptor("message", 1)'
  ),
  IRpcEncodedType: typeDoc(
    'Carrier-domain union unknown, string or uint8array used to admit matching codec/framer combinations.',
    '用于准入匹配编解码和分片组合的任意值、字符串或字节数组载体域联合。',
    {},
    framerExample
  ),
  IRpcEnvelopeOptions: typeDoc(
    'Application observation policy for additive fields in received semantic data.',
    '应用对接收语义数据新增字段提供的观察策略。',
    envelopeOptions,
    'normalizeRpcEnvelope(decoded, { onUnknownField: (pointer, field) => console.warn(pointer, field) })'
  ),
  IRpcFramerOptions: typeDoc(
    'Snapshot of bounded fragment-retention policy captured by each fragment framer constructor.',
    '每个分片器构造时捕获的有界分片保留策略快照。',
    framerOptions,
    framerExample
  ),
  IRpcFrameContext: typeDoc(
    'Transport-owned source/message correlation preventing fragments from unrelated channels sharing state.',
    '载体拥有的来源消息关联，防止无关通道的分片共用状态。',
    members(['messageId'], {
      source: p(
        'Actual inbound source assigned by the transport owner, separating otherwise identical message identifiers.',
        '载体所有者分配的实际入站来源，隔离相同消息标识。'
      )
    }),
    framerExample
  ),
  IRpcFramer: typeDoc(
    'Application-held component descriptor and original frame/accept/close ownership surface.',
    '应用持有的组件描述及原始发送、接收和关闭所有权表面。',
    framerMembers,
    framerExample
  ),
  IRpcFrameAcceptResult: typeDoc(
    'Nonthrowing receive result distinguishing incomplete data, one complete value and original rejection.',
    '区分未完成数据、一个完整值及原始拒绝的非抛出接收结果。',
    {
      status: {
        ...p(
          'Receive discriminator selected by the original framer after checking its current assembly.',
          '原分片器检查当前重组之后选择的接收判别字段。'
        ),
        values: {
          pending: t(
            'More ordered fragments are required before completion.',
            '完成之前仍需接收更多有序分片。'
          ),
          complete: t(
            'The entire encoded value is available for decoding.',
            '完整编码值已经可以交给解码器。'
          ),
          rejected: t(
            'An original coded Error explains why the frame was refused.',
            '原编码错误说明该帧为何被拒绝。'
          )
        }
      },
      value: p(
        'Complete encoded value present only when status is complete.',
        '仅完成状态存在的完整编码值。'
      ),
      error: fields.error
    },
    framerExample
  ),
  IRpcBoundFrameIngress: typeDoc(
    'Callable preparation of a received frame and its native metadata facts; no new authentication identity is created.',
    '接收帧及原生元数据事实的可调用准备端，不创建新的认证身份。',
    {
      nativeOutputDomain: p(
        'Optional IRpcNativeFrameOutputDomain from the exact original paired native frame callable.',
        '来自精确原生配对发送函数的可选原生输出域。'
      ),
      singleFrameLimits: p(
        'Optional original paired limits: maximum retained candidates and complete single-message encoded bytes.',
        '可选原配对限制，包含最多保留候选和完整单消息编码字节。'
      )
    },
    'const framer = createStringFramer(); const ingress = bindRpcFrameIngress(framer.accept, framer.frame); const prepared = ingress("hello", { source: "a", messageId: "1" }); framer.close()'
  ),
  IRpcNativeFrameOutputDomain: typeDoc(
    'Original native constructor facts distinguish legal whole carriers from physical fragment records.',
    '原生构造器事实区分合法整载体和物理分片记录。',
    {
      kind: {
        ...fields.kind,
        values: {
          'carrier-or-fragment': t(
            'Output may be a legal whole carrier or a native fragment object.',
            '输出可以是合法整载体或原生分片对象。'
          )
        }
      },
      carrierEncodedType: {
        ...p(
          'Encoded type of an unfragmented native output carrier.',
          '未分片原生输出载体所使用的编码类型。'
        ),
        values: { string: encodedValues.string, uint8array: encodedValues.uint8array }
      }
    },
    framerExample
  ),
  IRpcPhysicalFrameInspection: typeDoc(
    'Caller-held exact frame byte measurement and semantic-member split policy.',
    '调用方持有的精确帧字节测量及语义成员拆分策略。',
    {
      bytes: fields.bytes,
      splitBatch: m(
        'Returns the unchanged member array within budget, otherwise bisects by member count; it does not remeasure children.',
        '预算内返回原成员数组，否则按成员数量二分，不重复测量子组。',
        {
          members: t(
            'Original ordered semantic envelope array encoded in the measured physical frame.',
            '已经编码为所测物理帧的原始有序语义信封数组。'
          )
        },
        t(
          'One or two arrays; an oversize singleton throws FRAME_LIMIT_EXCEEDED.',
          '返回一组或两组数组；超限单成员抛帧超限错误。'
        ),
        'const inspection = inspectRpcPhysicalFrame(frame, limit); const parts = inspection.splitBatch(envelopes)'
      )
    },
    'const inspection = inspectRpcPhysicalFrame(frame, limit); console.log(inspection.bytes, inspection.splitBatch(envelopes))'
  ),
  IRpcStringFrame: typeDoc(
    'String fragment record sharing the sender-assigned ID, ordered index/count and actual declared total.',
    '字符串分片记录，共享发送标识、有序位置数量及声明总量。',
    {
      ...members(['messageId', 'index', 'count', 'length']),
      kind: {
        ...fields.kind,
        values: {
          'rpc.frame.v1': t(
            'Fixed message fragment marker distinct from semantic envelope kinds.',
            '固定消息分片标记，与语义信封种类不同。'
          )
        }
      },
      data: p(
        'One string slice; its encoded length uses UTF-16 code units in the string framer.',
        '单个字符串切片；字符串分片器按文本编码单元计量长度。'
      )
    },
    framerExample
  ),
  IRpcBinaryFrame: typeDoc(
    'Byte fragment record preserving message identity and exact ordered binary slices.',
    '保持消息身份及精确有序二进制切片的字节分片记录。',
    {
      ...members(['messageId', 'index', 'count', 'length']),
      kind: {
        ...fields.kind,
        values: {
          'rpc.frame.v1': t(
            'Fixed native fragment marker for ordered byte reassembly.',
            '固定原生分片标记，用于有序字节重组。'
          )
        }
      },
      data: p(
        'One genuine Uint8Array fragment owned by the framing sender.',
        '发送分片器拥有的单个真实字节数组分片。'
      )
    },
    symbols.createBinaryFramer.example as string
  ),
  IJsonRpcBridgeErrorCode: typeDoc(
    'Union of stable JSON-RPC bridge error-code values, classified together with the bridge source.',
    '稳定外部调用桥错误码取值联合，须与桥来源共同分类。',
    {},
    jsonExample
  ),
  IJsonRpcFrameDecoder: typeDoc(
    'Connection-owned incremental Content-Length parser retaining one bounded header and body.',
    '连接持有的增量长度头解析器，只保留一个有界头和主体。',
    {
      push: m(
        'Consumes arbitrary read chunks and returns every complete parsed value in physical order.',
        '消费任意读取块，按物理顺序返回每个完整解析值。',
        {
          chunk: t(
            'Original incoming Uint8Array chunk from the connection reader.',
            '连接读取器提供的原始入站字节块。'
          )
        },
        t(
          'Parsed unknown values; malformed framing or JSON throws JSONRPC_FRAME_INVALID.',
          '返回已解析未知值；分帧或对象文本异常抛桥帧非法错误。'
        ),
        jsonExample
      ),
      finish: m(
        'Checks physical end-of-input for an incomplete retained header or body.',
        '在物理输入结束时检查是否仍保留未完成头部或主体。',
        {},
        t(
          'Returns void with no partial frame; otherwise throws JSONRPC_FRAME_INVALID.',
          '没有半帧时返回空值，否则抛桥帧非法错误。'
        ),
        'decoder.finish()'
      ),
      close: m(
        'Idempotently drops retained bytes and makes later pushes return no messages.',
        '幂等丢弃保留字节，后续推送不再返回消息。',
        {},
        t('All decoder-owned retained bytes are released.', '所有解码器持有的保留字节均已释放。'),
        'decoder.close()'
      ),
      bufferedBytes: p(
        'Current retained header plus received body bytes, not the full declared body capacity.',
        '当前保留头加已收主体字节，不是声明主体的全部容量。'
      )
    },
    jsonExample
  ),
  IRpcStreamFrameDecoderOptions: typeDoc(
    'Application callbacks for complete native length-prefix payloads and original terminal framing failures.',
    '应用处理完整原生长度前缀载荷及原始终止分帧失败的回调配置。',
    frameDecoderOptions,
    streamExample
  ),
  IRpcStreamFrameDecoder: typeDoc(
    'Connection-owned decoder for arbitrary read splits and one bounded native payload.',
    '连接持有的解码器，处理任意读取切分及一个有界原生载荷。',
    {
      push: m(
        'Feeds arbitrary native bytes; complete copied payloads are delivered synchronously to onFrame. Closing or finishing inside a callback stops the current chunk without a synthetic malformed-frame error.',
        '输入任意原生字节，完整复制载荷同步投递给帧回调；回调内关闭或结束会停止本批剩余交付，不生成额外异常帧错误。',
        {
          chunk: t(
            'Genuine Uint8Array received from the caller-owned byte stream.',
            '调用方所属字节流提供的真实字节数组。'
          )
        },
        t(
          'Returns void after available callbacks; invalid or terminal pushes throw INVALID_FRAME.',
          '可用回调完成后返回空值；非法或终态推送抛帧非法错误。'
        ),
        streamExample
      ),
      finish: m(
        'Ends decoding, reporting a partial prefix/payload once through onError and entering terminal state.',
        '结束解码，经错误回调一次报告不完整前缀或载荷，并进入终态。',
        {},
        t(
          'The decoder is terminal and holds no incomplete frame.',
          '解码器已进入终态，不保留不完整帧。'
        ),
        'decoder.finish()'
      ),
      close: m(
        'Idempotently abandons partial native framing without producing a synthetic error.',
        '幂等放弃未完成原生分帧，不生成额外错误。',
        {},
        t(
          'Retained partial payload and prefix counters are cleared.',
          '保留的未完成载荷及前缀计数已清理。'
        ),
        'decoder.close()'
      )
    },
    streamExample
  ),
  IRpcHandshakeFrameReceiverOptions: typeDoc(
    'Live role configuration read at the original complete-frame receive points.',
    '在原始完整帧接收时点读取的活动角色配置。',
    {
      role: {
        ...p(
          'Actual initiator or responder role of the caller-owned physical connection.',
          '调用方所属物理连接的实际发起或响应角色。',
          t(
            'Absent: responder-like first-frame handling without an initiator accept shortcut.',
            '默认不设置，按响应式首帧处理，不启用发起方接受捷径。'
          )
        ),
        values: { enum: 'RpcHandshakeRole' }
      }
    },
    symbols.createRpcHandshakeFrameReceiver.example as string
  ),
  IRpcHandshakeFrameReceiver: typeDoc(
    'Protocol-owned sole handshake wait and UTF-8 phase state, separate from physical connection ownership.',
    '协议拥有的唯一握手等待及编码阶段状态，与物理连接所有权分开。',
    {
      accept: m(
        'Decodes one complete payload once; the first text satisfies the sole handshake read, later permitted business text is returned.',
        '对完整载荷只解码一次；首文本满足唯一握手读取，后续允许的业务文本作为返回值交出。',
        {
          frame: t(
            'Complete native frame payload from the byte decoder, without its length prefix.',
            '来自字节解码器的完整原生帧载荷，不含长度前缀。'
          )
        },
        t(
          'Business text, original grammar Error, or undefined while consuming control; invalid UTF-8 is handshake/frame failure by phase, retaining the actual native decoder error on `cause`.',
          '返回业务文本、原语法错误或消费控制期间的未定义；编码非法按阶段归为握手或帧失败，原生解码错误保留在 `cause`。'
        ),
        symbols.createRpcHandshakeFrameReceiver.example as string
      ),
      readHandshakeFrame: m(
        'Consumes the cached first control text or installs exactly one pending reader.',
        '消费缓存首控制文本，或安装唯一待定读取者。',
        {},
        t(
          'Promise of original control text; duplicate reads reject HANDSHAKE_INVALID, closed reads reject the original close reason.',
          '返回原控制文本承诺；重复读取以握手非法错误拒绝，关闭后以原关闭原因拒绝。'
        ),
        symbols.createRpcHandshakeFrameReceiver.example as string
      ),
      deferActivation: m(
        'Allows the original post-accept business handoff before this receiver activates; it does not store an extra physical queue.',
        '允许接收器激活前原有接受后业务交接，不另建物理队列。',
        {},
        t(
          'Receiver activation remains deferred until activate is called.',
          '接收器保持延迟状态，直到执行激活。'
        ),
        'receiver.deferActivation()'
      ),
      beginAccept: m(
        'Marks the responder actual accept transition before its physical accept write.',
        '在响应方物理写出接受消息前标记实际接受迁移。',
        {},
        t(
          'Later early-business handling sees acceptance; a closed receiver throws its original reason.',
          '后续提前业务处理可以看到已接受；关闭接收器抛原始原因。'
        ),
        'receiver.beginAccept()'
      ),
      activate: m(
        'Activates normal business decoding only after an actual first control frame has arrived.',
        '只有实际首控制帧到达后才激活正常业务解码。',
        {},
        t(
          'ready becomes true; no received control throws HANDSHAKE_INVALID and closed receivers throw their original reason.',
          '就绪变为真；未收到控制帧抛握手非法错误，已关闭时抛原始原因。'
        ),
        symbols.createRpcHandshakeFrameReceiver.example as string
      ),
      close: m(
        'Releases the sole reader and cached frame using the first caller-supplied terminal reason.',
        '使用调用方首次提供的终止原因释放唯一读取者和缓存帧。',
        {
          reason: t(
            'Original connection closure or decode failure supplied by the owning carrier.',
            '所属载体提供的原始连接关闭或解码失败原因。'
          )
        },
        t(
          'Pending and future reads reject the retained original reason; repeated close preserves it.',
          '待定及后续读取以原始保留原因拒绝；重复关闭不更换原因。'
        ),
        'receiver.close(error)'
      ),
      ready: p(
        'Whether this receiver has explicitly activated its normal frame phase.',
        '该接收器是否已经显式激活正常帧阶段。'
      )
    },
    symbols.createRpcHandshakeFrameReceiver.example as string
  ),
  IRpcBootstrapFrameReceiver: typeDoc(
    'One original bootstrap Promise and at most one queued following control payload before attachment.',
    '一个原始引导承诺及附加前最多一个排队后续控制载荷。',
    {
      bootstrap: p(
        'Promise resolving to the exact first complete Uint8Array without copying; rejects with original prebootstrap failure.',
        '不复制而以精确首个完整字节数组兑现的承诺；引导前失败以原错误拒绝。'
      ),
      receivedBootstrap: p(
        'True once the first payload has been consumed; later frames cannot replace it.',
        '首载荷被消费后为真；后续帧不能替换该值。'
      ),
      ready: p(
        'Current receiver activation flag used by the physical carrier to restore normal limits.',
        '物理载体用于恢复正常上限的当前接收器激活标志。'
      ),
      accept: m(
        'Consumes bootstrap once, then delivers to the attached callback or retains one following frame.',
        '消费一次引导，之后向已附加回调投递或保留一个后续帧。',
        {
          frame: t(
            'Complete original payload from the carrier-owned native frame decoder.',
            '载体所属原生帧解码器提供的完整原载荷。'
          )
        },
        t(
          'Undefined on acceptance, or original HANDSHAKE_INVALID when more than one unattached control is queued.',
          '接受时返回未定义，未附加控制超过一个时返回原握手非法错误。'
        ),
        symbols.createRpcBootstrapFrameReceiver.example as string
      ),
      fail: m(
        'Preserves the original decoder failure: reject bootstrap before receipt, otherwise notify or retain for attachment.',
        '保留原解码失败：接收引导前拒绝承诺，之后立即通知或保留至附加。',
        {
          error: t(
            'Original Error from the actual byte decoder or connection owner.',
            '实际字节解码器或连接所有者提供的原错误。'
          )
        },
        t(
          'Returns after original failure delivery or retention; callback exceptions propagate.',
          '原失败投递或保留后返回，回调异常直接传播。'
        ),
        'receiver.fail(error)'
      ),
      attach: m(
        'Installs a direct frame/error consumer and transfers the queued error before any queued frame.',
        '安装直接帧及错误消费方，优先转交排队错误而非排队帧。',
        {
          onFrame: t(
            'Application synchronous callback receives the exact complete Uint8Array; returns void and throws propagate.',
            '应用同步回调接收精确完整字节数组，返回空值，抛错直接传播。'
          ),
          onError: t(
            'Application synchronous callback receives the original Error; returns void and throws propagate.',
            '应用同步回调接收原始错误，返回空值，抛错直接传播。'
          )
        },
        t(
          'Removal function clears attached callbacks; it does not close physical resources.',
          '返回移除函数以清空附加回调，不关闭物理资源。'
        ),
        symbols.createRpcBootstrapFrameReceiver.example as string
      ),
      activate: m(
        'Moves only this receiver to its normal frame-cap phase without opening or authenticating a channel.',
        '只把该接收器移到正常帧上限阶段，不打开或认证通道。',
        {},
        t(
          'ready becomes true; native resources remain caller-owned.',
          '就绪变为真；原生资源仍由调用方拥有。'
        ),
        'receiver.activate()'
      )
    },
    symbols.createRpcBootstrapFrameReceiver.example as string
  )
})

/** Common aliases never imply that data has already been negotiated or authenticated. */
Object.assign(types, {
  IRpcHandshakeVersion: typeDoc(
    'One application-supported major and highest compatible minor proposal.',
    '应用支持的一个主版本及其最高兼容次版本提案。',
    members(['major', 'minor'])
  ),
  IRpcPeerInfo: typeDoc(
    'Bounded application-provided peer identity retained only for diagnostics and connection policy.',
    '应用提供的有界对端身份，仅保留用于诊断和连接策略。',
    members(['id', 'runtime', 'runtimeVersion', 'implementation'])
  ),
  IRpcHandshakeOffer: typeDoc(
    'Actual local supported protocol/codec/capability proposals plus application peer and optional auth data.',
    '实际本地支持协议、编解码和能力提案，附应用身份及可选认证数据。',
    members(['versions', 'codecs', 'capabilities', 'peer', 'auth'])
  ),
  IRpcHandshakeAgreement: typeDoc(
    'Frozen actual common version/codec/capabilities with the remote peer, produced only by completed negotiation.',
    '冻结的实际共有版本、编解码、能力及远端身份，只由完成协商产生。',
    members(['major', 'minor', 'codec', 'capabilities', 'peer', 'auth'])
  ),
  IRpcHandshakeText: typeDoc(
    'Complete UTF-8-compatible string or Uint8Array for first-channel JSON negotiation; never an ordinary business envelope.',
    '首通道对象文本协商所用完整字符串或字节数组，不是普通业务信封。',
    {}
  ),
  IRpcHandshakeMessage: typeDoc(
    'Fresh validated hello, accept or reject control record; payload fields exist only on their selected step.',
    '新的已校验问候、接受或拒绝控制记录；载荷字段只存在于相应步骤。',
    {
      ...members([
        'major',
        'minor',
        'codec',
        'capabilities',
        'peer',
        'error',
        'versions',
        'codecs',
        'auth'
      ]),
      kind: { ...fields.kind, values: { handshake: enums.RpcReservedKind.values.handshake } },
      step: {
        ...p(
          'Selects hello proposal, accept agreement or serialized rejection.',
          '选择问候提案、接受协议或序列化拒绝。'
        ),
        values: { enum: 'RpcHandshakeStep' }
      },
      protocol: p(
        'Exact protocol identity migaia.rpc; unsupported identities cannot complete negotiation.',
        '精确协议身份标记，不支持的身份无法完成协商。'
      )
    }
  ),
  IRpcWireErrorOptions: typeDoc(
    'Received bounded error-node unknown-field policy, defaulting to rejection.',
    '收到有界错误节点时的未知字段策略，默认拒绝。',
    wireErrorOptions,
    errorExample
  ),
  IRpcSerializedError: typeDoc(
    'Bounded language-neutral error tree preserving native name, original remote stack and causal descendants.',
    '有界跨语言错误树，保留原生名称、原远端堆栈及原因后代。',
    {
      ...members([
        'source',
        'code',
        'name',
        'message',
        'stack',
        'cause',
        'errors',
        'data',
        'truncated'
      ]),
      route: p(
        'Optional one-to-four original node IDs, each 32 lowercase hexadecimal characters, held only as diagnostics.',
        '可选一至四个原节点标识，每个为三十二位小写十六进制，仅作诊断。'
      )
    },
    errorExample
  ),
  IRpcContractError: typeDoc(
    'Native Error with stable contract source and semantic code; the runtime class is preserved.',
    '带稳定契约来源和语义错误码的原生错误，保持运行时错误类。',
    { source: fields.source, code: { ...fields.code, values: { enum: 'RpcContractErrorCode' } } },
    errorExample
  ),
  IRpcContractErrorCode: typeDoc(
    'Union of stable values in RpcContractErrorCode, paired with the contract error source.',
    '规范契约错误码稳定取值的联合，须与契约错误来源共同使用。',
    {},
    errorExample
  ),
  IRpcWireErrorFailure: typeDoc(
    'Serializer report value retaining the exact property-read or portable-normalization failure.',
    '序列化上报值，保留精确属性读取或可移植规范化失败。',
    members(['pointer', 'field', 'error']),
    errorExample
  ),
  IRpcSerializeErrorOptions: typeDoc(
    'Required reporting policy for failures omitted from a bounded wire projection.',
    '有界线上投影中省略失败所必须提供的上报策略。',
    {
      report: p(
        'Application synchronous callback receives IRpcWireErrorFailure with pointer, field and original error; return void and avoid throwing.',
        '应用同步回调接收含指针、字段及原错误的失败记录，返回空值并避免抛错。'
      )
    },
    errorExample
  ),
  IRpcErrorWireSummary: typeDoc(
    'Exact-reference presentation override selecting a diagnostic code/message without granting runtime rights.',
    '按精确引用选择诊断错误码及消息的展示覆盖，不赋予运行权限。',
    {
      ...members(['code', 'message']),
      preserveSerializedError: {
        ...p(
          'True preserves this node’s existing serialized descendants rather than selecting a five-field summary.',
          '真值保留该节点已有序列化后代，而非只选择五字段摘要。'
        ),
        values: {
          true: t(
            'Keep the original serialized descendants in this projection.',
            '在本次投影中保留原序列化后代。'
          )
        }
      }
    },
    errorExample
  ),
  IRpcErrorWireMetadata: typeDoc(
    'Caller-held WeakMap readers choose diagnostic presentation and routes by exact native Error reference.',
    '调用方持有的弱映射读取端，按精确原生错误引用选择诊断展示和路由。',
    {
      summaries: p(
        'Optional WeakMap get port mapping original Error to IRpcErrorWireSummary; it conveys data only.',
        '可选弱映射读取端，把原错误映射为诊断摘要，只携带数据。'
      ),
      routes: p(
        'Optional WeakMap get port mapping original Error to bounded node-only route diagnostics.',
        '可选弱映射读取端，把原错误映射为有界纯节点路由诊断。'
      )
    },
    errorExample
  ),
  IRpcErrorWireRouteStore: typeDoc(
    'Caller-owned WeakMap set port recording admitted diagnostic routes against actual restored Error objects.',
    '调用方拥有的弱映射写入端，按实际恢复错误对象记录已接纳诊断路由。',
    {},
    errorExample
  ),
  IRpcJsonRpcErrorObject: typeDoc(
    'Foreign numeric error object carrying an optional canonical error tree in its portable data extension.',
    '外部数字错误对象，在可移植数据扩展中可携带规范错误树。',
    {
      code: p(
        'Foreign JSON-RPC integer code selected by the bridge caller.',
        '桥调用方选择的外部调用协议整数错误码。'
      ),
      message: fields.message,
      data: fields.data
    },
    'const foreign = toJsonRpcError(wire, -32000); console.log(fromJsonRpcError(foreign))'
  ),
  IRpcPortableBytes: typeDoc(
    'Legacy wire byte record using a bytes marker and canonical unpadded Base64URL data instead of a raw native backing.',
    '传统线上字节记录，使用字节标记和规范无填充文本编码，而非原生背板。',
    {
      $rpc: {
        ...p(
          'Fixed bytes tag selects the legacy portable byte record.',
          '固定字节标签选择传统可移植字节记录。'
        ),
        values: {
          bytes: t(
            'Treat base64url as the encoded binary data field.',
            '把编码字段视为二进制数据内容。'
          )
        }
      },
      base64url: p(
        'Canonical unpadded URL-safe Base64 payload containing the portable bytes.',
        '包含可移植字节的规范无填充网址安全文本编码载荷。'
      )
    },
    'const bytes = normalizePortable(new Uint8Array([1,2,3]))'
  ),
  IRpcPortableRecord: typeDoc(
    'Frozen string-keyed recursive portable values; unsupported prototypes and cycles cannot enter the wire model.',
    '冻结字符串键递归可移植值，不支持原型及循环不能进入线上模型。',
    {},
    'const record = normalizePortable({ count: 1 })'
  ),
  IRpcPortableValue: typeDoc(
    'Portable scalar, legacy bytes, recursive array/record or independently negotiated ArrayBuffer/Uint8Array native binary.',
    '可移植标量、传统字节、递归数组记录，或独立协商的原生缓冲及字节视图。',
    {},
    'const value = normalizePortable({ values: [1, true, null] })'
  ),
  IRpcWirePortableValue: typeDoc(
    'Legacy codec-facing portable union excludes raw ArrayBuffer and Uint8Array; native binary requires the independent manifest profile.',
    '传统编解码可移植联合排除原生背板及字节视图；原生二进制要求独立清单形态。',
    {},
    'const value = normalizePortable({ count: 1 })'
  ),
  IRpcApplicationPayload: typeDoc(
    'Application data slot accepts only admitted portable values, separate from the routing metadata record.',
    '应用数据位置只接受已接纳可移植值，与路由元数据记录分开。',
    {},
    'const payload = normalizePortable({ count: 1 })'
  )
})
/** Actual root legacy route and data nodes. */
Object.assign(types, {
  IRpcRouteHeader: typeDoc(
    'Contract-owned legacy routing header with per-variant optional control and deadline metadata.',
    '契约拥有的传统路由头，含按形式限制的可选控制和截止元数据。',
    {
      ...members([
        'applicationVersion',
        'senderId',
        'targetId',
        'sentAt',
        'receiverId',
        'dispatchOnly',
        'method',
        'manual',
        'resolvedTargetId',
        'platform',
        'accepted',
        'message',
        'operation',
        'variation',
        'timeoutMs',
        'idempotencyKey',
        'trace',
        'forwardRoute'
      ]),
      profile: {
        ...fields.profile,
        values: {
          'migaia.rpc.route': t(
            'Fixed profile keeps routing separate from application data.',
            '固定形态把路由与应用数据分开。'
          )
        }
      },
      type: choice('type', 'RpcRouteType')
    },
    'const envelope = normalizeRpcEnvelope(decoded); console.log(envelope.data.route.senderId)'
  ),
  IRpcEnvelopeData: typeDoc(
    'Legacy semantic data keeps validated route ownership separate from optional portable application payload.',
    '传统语义数据分开已校验路由所有权及可选可移植应用载荷。',
    members(['route', 'payload']),
    'const envelope = normalizeRpcEnvelope(decoded); console.log(envelope.data.payload)'
  ),
  IRpcControlData: typeDoc(
    'Legacy control data has the same route but an intentionally opaque optional control payload.',
    '传统控制数据具有相同路由和有意不透明的可选控制载荷。',
    {
      route: fields.route,
      payload: p(
        'Optional opaque variation payload retained by the control owner rather than portable-normalized here.',
        '控制所有者保留的可选不透明变化载荷，此处不执行可移植规范化。'
      )
    },
    'const control = normalizeRpcEnvelope(decoded)'
  ),
  IRpcBatchFrame: typeDoc(
    'Physical nonempty ordered envelope wrapper; grouping never creates a semantic task transaction.',
    '物理非空有序信封包装，分组不会创建语义任务事务。',
    {
      kind: { ...fields.kind, values: { batch: enums.RpcBatchPhysical.values.kind } },
      envelopes: p(
        'Nonempty ordered semantic envelope array; each member requires independent semantic validation.',
        '非空有序语义信封数组，每个成员须独立执行语义校验。'
      )
    },
    'const members = readRpcBatchMembers({ kind: "batch", envelopes: [envelope] })'
  ),
  IRpcUnknownFieldWarner: typeDoc(
    'Endpoint-owned bounded diagnostic cache; it owns no native connection and emits no duplicate field warnings per retained identity.',
    '端点拥有的有界诊断缓存，不拥有原生连接，保留身份内不重复发字段警告。',
    {
      note: m(
        'Normalizes array indexes and bounds field identities before emitting one connection-local warning.',
        '发出一次连接本地警告前，规范数组索引并限制字段身份长度。',
        {
          connection: t(
            'Actual inbound connection identity assigned by its transport owner.',
            '所属载体分配的实际入站连接身份。'
          ),
          kind: t(
            'Actual received semantic kind or variation subtype.',
            '实际收到的语义种类或变化子类型。'
          ),
          pointer: t(
            'Unknown-field pointer received by the normalizer callback.',
            '规范化回调收到的未知字段指针。'
          ),
          field: t(
            'Unknown field name received by the normalizer callback.',
            '规范化回调收到的未知字段名称。'
          )
        },
        t(
          'Returns void after deduplication or synchronous warn callback; warn throws propagate.',
          '去重或同步警告回调后返回空值；警告抛错保留原生类型及既有语义身份，否则附加 `CALLBACK_FAILED`，安全线上摘要不泄漏原回调文本。'
        ),
        symbols.createRpcUnknownFieldWarner.example as string
      ),
      clear: m(
        'Drops all connection and field identities so future observations may warn again.',
        '丢弃全部连接及字段身份，使后续观察可以再次警告。',
        {},
        t(
          'Diagnostic memory is empty; no physical connection is closed.',
          '诊断内存已清空，不关闭物理连接。'
        ),
        'warnings.clear()'
      )
    },
    symbols.createRpcUnknownFieldWarner.example as string
  )
})
/** Legacy envelopes preserve only fields permitted by the selected semantic kind. */
const legacyFields = members(['id', 'method', 'data', 'ok', 'code', 'message', 'error'])
Object.assign(legacyFields, {
  kind: choice('kind', 'RpcEnvelopeKind'),
  version: p(
    'Application version advertised by the discovery owner, not the wire protocol major.',
    '发现所有者声明的应用版本，不是线上协议主版本。'
  ),
  acceptVersions: p(
    'Application-compatible versions accepted by the discovery owner in declared order.',
    '发现所有者按声明顺序接受的应用兼容版本列表。'
  )
})
for (const [name, en, zh, names] of [
  [
    'IRpcEnvelope',
    'Fresh validated legacy request, response, discovery, variation or stream data.',
    '新的已校验传统请求、响应、发现、控制或流数据。',
    ['kind', 'id', 'method', 'data', 'ok', 'code', 'message', 'error', 'version', 'acceptVersions']
  ],
  [
    'IRpcRequestEnvelope',
    'Legacy method request with original correlation ID and validated route/payload.',
    '传统方法请求，含原始关联标识及已校验路由载荷。',
    ['kind', 'id', 'method', 'data']
  ],
  [
    'IRpcResponseFailure',
    'Legacy failed response retains code/message and optional full serialized Error tree.',
    '传统失败响应保留错误码、消息及可选完整序列化错误树。',
    ['kind', 'ok', 'id', 'code', 'message', 'data', 'error']
  ],
  [
    'IRpcResponseSuccess',
    'Legacy successful response forbids failure-only code/message/error properties.',
    '传统成功响应禁止只属于失败的错误码、消息及错误字段。',
    ['kind', 'ok', 'id', 'data', 'code', 'message', 'error']
  ],
  [
    'IRpcDiscoveryEnvelope',
    'Legacy application-version discovery query or response retains its route and portable data.',
    '传统应用版本发现查询或响应，保留路由及可移植数据。',
    ['kind', 'id', 'version', 'acceptVersions', 'data']
  ],
  [
    'IRpcStreamEnvelope',
    'Legacy correlated stream message retaining its admitted route and stream payload.',
    '传统关联流消息，保留已接纳路由及流载荷。',
    ['kind', 'id', 'data']
  ],
  [
    'IRpcVariationEnvelope',
    'Legacy control subtype envelope retaining its route and intentionally opaque control data.',
    '传统控制子类型信封，保留路由和有意不透明控制数据。',
    ['kind', 'id', 'data']
  ]
] as const)
  types[name] = typeDoc(
    en,
    zh,
    Object.fromEntries(names.map((key) => [key, legacyFields[key]])),
    'const envelope = normalizeRpcEnvelope(decoded); console.log(envelope.kind)'
  )

/** Literal fields expose exactly the values admitted by their selected variant. */
const literal = (field: string, value: string, meaning: IText): IMemberDoc => ({
  ...fields[field],
  values: { [value]: meaning }
})
for (const [name, kind] of [
  ['IRpcRequestEnvelope', 'request'],
  ['IRpcResponseFailure', 'response'],
  ['IRpcResponseSuccess', 'response'],
  ['IRpcDiscoveryEnvelope', 'discovery'],
  ['IRpcStreamEnvelope', 'stream'],
  ['IRpcVariationEnvelope', 'variation']
] as const)
  types[name] = {
    ...types[name],
    members: {
      ...types[name].members,
      kind: literal('kind', kind, enums.RpcEnvelopeKind.values[kind]),
      data: p(
        kind === 'variation'
          ? 'IRpcControlData with validated route and optional intentionally opaque control payload.'
          : 'IRpcEnvelopeData with validated route and optional portable application payload.',
        kind === 'variation'
          ? '含已校验路由及可选不透明控制载荷的传统控制数据。'
          : '含已校验路由及可选可移植应用载荷的传统信封数据。'
      )
    }
  }
types.IRpcResponseSuccess = {
  ...types.IRpcResponseSuccess,
  members: {
    ...types.IRpcResponseSuccess.members,
    ok: literal('ok', 'true', (fields.ok.values as Readonly<Record<string, IText>>)['true']),
    code: p(
      'TypeScript construction forbids this success property; the unknown-input normalizer observes it as additive data and discards it.',
      '类型构造约束禁止成功响应设置此属性；未知输入规范化器将它作为新增字段观察后丢弃。'
    ),
    message: p(
      'TypeScript construction forbids failure text on success; unknown received text is observed as an additive field and discarded.',
      '类型构造约束禁止成功响应设置失败文本；收到的未知文本按新增字段观察后丢弃。'
    ),
    error: p(
      'TypeScript construction forbids serialized failure on success; unknown received failure data is observed as additive and discarded.',
      '类型构造约束禁止成功响应设置序列化失败；收到的未知失败数据按新增字段观察后丢弃。'
    )
  }
}
types.IRpcResponseFailure = {
  ...types.IRpcResponseFailure,
  members: {
    ...types.IRpcResponseFailure.members,
    ok: literal('ok', 'false', (fields.ok.values as Readonly<Record<string, IText>>)['false'])
  }
}
/** Binary callbacks and captured resources have no transport admission authority. */
Object.assign(types, {
  IRpcBinaryBacking: typeDoc(
    'Full original backing metadata verifies bytes outside views as well as visible data.',
    '完整原始背板元数据同时验证视图外字节及可见数据。',
    members(['byteLength', 'sha256']),
    binaryExample
  ),
  IRpcBinaryManifest: typeDoc(
    'Closed protected binary manifest keeps tagged business data separate from exact native sidecar integrity.',
    '封闭受保护二进制清单，把标签业务数据与精确原生背板完整性分开。',
    {
      ...members(['envelope', 'backings']),
      profile: literal(
        'profile',
        'migaia.rpc.portable-binary/1',
        t(
          'Fixed manifest profile selects the canonical tagged binary grammar.',
          '固定清单形态选择规范标签二进制语法。'
        )
      ),
      storage: {
        ...p(
          'Representation selected before capture and required to match restoration.',
          '捕获前选择且必须与恢复相匹配的表示方式。'
        ),
        values: { enum: 'RpcBinaryStorage' }
      }
    },
    binaryExample
  ),
  IRpcPreparedBinary: typeDoc(
    'Caller-held prepared manifest and exact original sidecars, with total bytes captured before detachment.',
    '调用方持有的准备清单及精确原背板，总字节数在分离前捕获。',
    {
      manifest: p(
        'Closed IRpcBinaryManifest returned by canonical preparation.',
        '规范准备返回的封闭二进制清单。'
      ),
      sidecars: fields.sidecars,
      backingBytes: fields.backingBytes
    },
    binaryExample
  ),
  IRpcBinaryDigest: typeDoc(
    'Application async callback receives a complete original non-shared ArrayBuffer and resolves a canonical 64-character lowercase SHA-256 digest. Throws or rejection fail preparation/restoration.',
    '应用异步回调接收完整原始非共享背板，兑现规范六十四位小写摘要；抛错或拒绝使准备及恢复失败。',
    {},
    'const digest = async (backing: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", backing)), (byte) => byte.toString(16).padStart(2, "0")).join("")'
  ),
  IRpcCapturedBinaryData: typeDoc(
    'Synchronous original graph/backing snapshot retained until canonical preparation is requested.',
    '同步原图和背板快照，保留到请求规范准备时使用。',
    {
      prepare: m(
        'Finishes the captured original graph through the canonical encoding and digest owner, without another application graph scan.',
        '通过规范编码及摘要所有者完成捕获原图，不再扫描应用图。',
        {},
        t(
          'Promise of IRpcPreparedBinary; original codec/digest failure rejects with INVALID_ENVELOPE.',
          '返回准备结果承诺；原编解码或摘要失败以信封非法错误拒绝。'
        ),
        binaryExample
      )
    },
    binaryExample
  ),
  IRpcBinaryDataCodec: typeDoc(
    'Application-held data encoding capability used only at original capture and quota points; it conveys no prehash coordination authority.',
    '应用持有的数据编码能力，只用于原始捕获及配额时点，不赋予摘要前协调权限。',
    {
      encode: m(
        'Synchronously encodes actual manifest metadata at the original representation measurement boundary.',
        '在原表示计量边界同步编码实际清单元数据。',
        {
          value: t(
            'Actual canonical manifest value supplied by binary preparation.',
            '二进制准备提供的实际规范清单值。'
          )
        },
        t(
          'Encoded representation; throw fails preparation with the original cause retained.',
          '返回编码表示，抛错使准备失败且保留原始原因。'
        ),
        'const encoded = codec.encode(prepared.manifest)'
      ),
      captureJsonData: m(
        'Optionally captures whole JSON data using canonical binary root accounting instead of a second graph walk.',
        '可选使用规范二进制根计量捕获完整对象文本数据，避免第二次图遍历。',
        {
          value: t(
            'Canonical manifest object provided by the preparation owner.',
            '准备所有者提供的规范清单对象。'
          ),
          roots: t(
            'Canonical map from actual captured object roots to their counted byte charges.',
            '实际捕获对象根到已计量字节费用的规范映射。'
          ),
          backingBytes: t(
            'Actual original complete-backing total captured before asynchronous detachment.',
            '异步分离前捕获的实际原始完整背板总量。'
          )
        },
        t(
          'Codec-owned encoded capture result; throw fails the original preparation.',
          '返回编解码器拥有的编码捕获结果，抛错使原准备失败。'
        ),
        'const encoded = codec.captureJsonData?.(prepared.manifest, roots, prepared.backingBytes)'
      ),
      encodeInline: {
        ...p(
          'Optional synchronous callback receives actual inline Uint8Array bytes and returns canonical Base64URL text; throws fail preparation.',
          '可选同步回调接收实际内联字节数组并返回规范网址安全编码文本；抛错使准备失败。'
        ),
        default: t('Absent: canonical package encoding is used.', '默认不设置，使用包内规范编码。'),
        example: 'const text = codec.encodeInline?.(new Uint8Array([1,2]))'
      }
    },
    binaryExample
  )
})
/** Runtime field domains are local to their precise union, not inherited broad enum choices. */
const runtimeOptions: Record<string, IMemberDoc> = {
  orderKey: fields.orderKey,
  cancel: {
    ...p(
      'Only before-start requests final-provider cancellation arbitration before execution begins.',
      '只有启动前模式请求最终提供方在执行开始之前裁定取消。',
      t(
        'Absent: ordinary cancellation keeps its existing owner.',
        '默认不设置，普通取消保持既有所有者。'
      )
    ),
    values: {
      'before-start': t(
        'The final provider decides cancellation before its actual execution start.',
        '最终提供方在实际执行开始之前裁定取消。'
      )
    }
  },
  timeoutMs: fields.timeoutMs,
  idempotencyKey: fields.idempotencyKey
}
/** Runtime stream adds only finish-without-items and excludes consumer cancel. */
const runtimeStreamValues = {
  ...Object.fromEntries(
    Object.entries(enums.RpcStreamEvent.values).filter(([key]) => key !== 'cancel')
  ),
  'finish-without-items': t(
    'Drain the original producer to terminal without yielding more items; requires before-start cancellation.',
    '排空原生产方直到终止，不再产出条目，要求启动前取消模式。'
  )
}
/** Complete runtime envelope data nodes retain the original task identity at every hop. */
Object.assign(types, {
  IRpcRuntimeGeneration: typeDoc(
    'Exact restart/session generation issued by its real owner and bound by accepted directory state.',
    '实际所有者签发并由已接受目录状态绑定的精确重启或会话世代。',
    { ...members(['value', 'providerId']), kind: choice('kind', 'RpcRuntimeGenerationKind') },
    'const generation = normalizeRuntimeGeneration({ kind: "session", value: 0, providerId: "provider" })'
  ),
  IRpcRuntimeRoute: typeDoc(
    'Protected runtime routing subset uses actual sender/target/receiver identities and timestamp domains.',
    '受保护运行路由子集使用实际发送方、目标、接收身份及时间域。',
    members(['applicationVersion', 'senderId', 'targetId', 'receiverId', 'sentAt', 'forwardRoute']),
    'const envelope = createRuntimeCallEnvelope(header, payload)'
  ),
  IRpcRuntimeTask: typeDoc(
    'Exact original logical task identity retained across cancellation, streaming and terminal correlation.',
    '取消、流及终止关联期间保持的精确原始逻辑任务身份。',
    {
      ...members(['callerId', 'callerGeneration', 'targetGeneration', 'method']),
      mode: {
        ...p(
          'Original logical operation mode; request, notify and stream require method, group and outcome forbid it.',
          '原始逻辑操作模式；请求、通知及流要求方法，分组及结果查询禁止方法。'
        ),
        values: { enum: 'RpcRuntimeMode' }
      }
    },
    'const envelope = createRuntimeCallEnvelope(header, payload)'
  ),
  IRpcRuntimeOptions: typeDoc(
    'Protected wire options exclude local AbortSignal and false timeout values.',
    '受保护线上选项排除本地取消信号及假值截止时间。',
    runtimeOptions,
    'const required = runtimeOperationCapabilities("request", { cancel: "before-start", orderKey: "jobs" })'
  ),
  IRpcRuntimeCommon: typeDoc(
    'Shared protected profile, correlation ID, route and exact task tuple on every runtime variant.',
    '每种运行形式共有的受保护形态、关联标识、路由及精确任务元组。',
    {
      ...members(['id', 'route', 'task']),
      profile: literal(
        'profile',
        'migaia.rpc.runtime-api/1',
        t(
          'Fixed runtime profile separates semantic task grammar from legacy messages.',
          '固定运行形态把语义任务语法与传统消息分开。'
        )
      )
    },
    'const envelope = normalizeRuntimeEnvelope(candidate)'
  ),
  IRpcRuntimeCompletion: typeDoc(
    'Actual original success result or full serialized failure, omitting only actual undefined results.',
    '实际原始成功结果或完整序列化失败，只省略实际未定义结果。',
    members(['ok', 'result', 'error']),
    'const envelope = normalizeRuntimeEnvelope(terminalFrame)'
  ),
  IRpcRuntimeStep: typeDoc(
    'One request-semantic group method and optional portable input, reserved with every other step before execution.',
    '一个请求语义分组方法及可选可移植输入，执行前与其他步骤共同预留。',
    members(['method', 'payload']),
    'const steps = normalizeRuntimeSteps([{ method: "ping", payload: null }])'
  ),
  IRpcRuntimeStepOutcome: typeDoc(
    'Actual group step outcome; failure stops later work without rolling back earlier successful effects.',
    '实际分组步骤结果；失败停止后续工作，不回滚此前成功效果。',
    {
      ...members(['result', 'error']),
      state: {
        ...p(
          'Actual step execution classification, not an all-or-nothing transaction status.',
          '实际步骤执行分类，不是全部成功或回滚的事务状态。'
        ),
        values: { enum: 'RpcRuntimeStepState' }
      }
    },
    'const envelope = normalizeRuntimeEnvelope(groupTerminal)'
  ),
  IRpcRuntimeStream: typeDoc(
    'Original stream event/sequence with an opt-in finish intent; ordinary consumer cancel stays a runtime control operation.',
    '原始流事件及序号加显式结束意图；普通消费取消仍为运行控制操作。',
    {
      ...members(['seq', 'value', 'error', 'reason']),
      value: p(
        'Portable item value or optional `end` return value, under the stream value budget.',
        '条目事件的可移植值或 `end` 的可选结束返回值，受流值字节预算限制。'
      ),
      event: {
        ...p(
          'Original producer/consumer event or explicit finish-without-items intent.',
          '原生产或消费事件，或显式不产条目结束意图。'
        ),
        values: runtimeStreamValues
      }
    },
    'const failure = checkRpcRuntimeStreamTransition({ event: "finish-without-items" }, { cancel: "before-start" })'
  ),
  IRpcRuntimeStore: typeDoc(
    'Original final-provider outcome store facts; unavailable stores never invent an epoch.',
    '原最终提供方结果存储事实；不可用存储不会虚构实例标识。',
    {
      kind: choice('kind', 'RpcRuntimeStoreKind'),
      epoch: fields.epoch,
      continuity: {
        ...p(
          'Continuity issued by the actual original store owner rather than inferred from lookup misses.',
          '实际原存储所有者签发的连续性，不从查询未命中推断。'
        ),
        values: { enum: 'RpcRuntimeStoreContinuity' }
      }
    },
    'console.log(result.store.kind, result.store.continuity)'
  ),
  IRpcRuntimeOutcome: typeDoc(
    'Sealed original completion may predate the query generation and cannot settle a new business call.',
    '封存原完成可以早于查询世代，不能用来结算新的业务调用。',
    {
      ...members(['targetGeneration', 'completion']),
      mode: {
        ...p(
          'Original request, notify, stream or group mode; outcome lookup itself is excluded.',
          '原始请求、通知、流或分组模式，不包含结果查询本身。'
        ),
        values: Object.fromEntries(
          Object.entries(enums.RpcRuntimeMode.values).filter(([key]) => key !== 'outcome')
        )
      }
    },
    'console.log(result.outcome?.completion)'
  ),
  IRpcRuntimeOutcomeResult: typeDoc(
    'Read-only projection of actual store pending/done/unknown facts with no claim or execution authority.',
    '实际存储待定、完成或未知事实的只读投影，没有预留或执行权限。',
    {
      ...members(['store', 'outcome']),
      state: {
        ...p(
          'Actual lookup state reported by the original final-provider store.',
          '原始最终提供方存储报告的实际查询状态。'
        ),
        values: { enum: 'RpcRuntimeOutcomeState' }
      }
    },
    'console.log(result.state, result.store)'
  ),
  IRpcRuntimeEnvelope: typeDoc(
    'Closed complete runtime semantic union validated before touching canonical replay or execution owners.',
    '接触规范重放或执行所有者之前必须完整校验的封闭运行语义联合。',
    {
      ...members([
        'id',
        'route',
        'task',
        'options',
        'payload',
        'steps',
        'reason',
        'completion',
        'idempotencyKey',
        'store',
        'outcome'
      ]),
      profile: literal(
        'profile',
        'migaia.rpc.runtime-api/1',
        t(
          'Fixed runtime semantic profile on every complete envelope.',
          '每个完整信封都具有固定运行语义形态。'
        )
      ),
      kind: choice('kind', 'RpcRuntimeKind'),
      operation: choice('operation', 'RpcRuntimeOperation'),
      state: {
        ...p(
          'Outcome-result lookup state present only on result controls.',
          '只在结果控制存在的结果查询状态。'
        ),
        values: { enum: 'RpcRuntimeOutcomeState' }
      },
      stream: p(
        'IRpcRuntimeStream present only on a stream control operation.',
        '只在流控制操作中存在的运行流记录。'
      )
    },
    'const envelope = normalizeRuntimeEnvelope(candidate)'
  ),
  IRpcRuntimeCallHeader: typeDoc(
    'Caller-owned typed call header uses accepted route/task facts and explicit operation options.',
    '调用方拥有的类型化调用头，使用已接受路由任务事实及显式操作选项。',
    members(['id', 'route', 'task', 'options']),
    'const envelope = createRuntimeCallEnvelope(header, { count: 1 })'
  ),
  IRpcByteRuntimeBootstrap: typeDoc(
    'Private data-only byte launch bootstrap; keep token secret and derive provenance from actual held I/O elsewhere.',
    '私有纯数据字节启动引导；令牌必须保密，来源证明由别处实际持有输入输出推导。',
    members(['self', 'parentInstanceId', 'token'], {
      generation: p(
        'Optional execution generation issued by the actual launch owner; it is not a supervisor attempt ordinal.',
        '实际启动所有者签发的可选执行世代，不是监督器尝试序号。'
      )
    }),
    'const parsed = rpcByteRuntimeBootstrap.read(bootstrapBytes); if (parsed.valid) console.log(parsed.value.self.name)'
  ),
  IRpcStreamSequence: typeDoc(
    'Stream owner-held or actually received nonnegative sequence value, starting at zero.',
    '流所有者持有或实际接收的非负序号值，从零开始。',
    { seq: fields.seq },
    'const failure = checkRpcStreamInitialSequence({ seq: 0 })'
  ),
  IRpcStreamConsumerCredit: typeDoc(
    'Original consumer sequence and currently outstanding pull credit held by the existing stream owner.',
    '既有流所有者持有的原消费序号和当前未完成拉取额度。',
    members(['seq', 'pending']),
    'const failure = checkRpcStreamConsumerCredit({ seq: 0 }, { seq: 0, pending: true })'
  ),
  IRpcStreamProducerCredit: typeDoc(
    'Original producer sequence and busy pull flag; repeated overlapping pulls are refused.',
    '原生产序号及忙碌拉取标志，拒绝重复重叠拉取。',
    members(['seq', 'busy']),
    'const failure = checkRpcStreamProducerCredit({ seq: 0 }, { seq: 0, busy: false })'
  ),
  IRpcStreamPayload: typeDoc(
    'Admitted seven-event legacy stream data; the owner separately checks sequence and direction.',
    '已接纳七事件传统流数据，所有者另外检查序号和方向。',
    {
      ...members(['seq', 'value', 'error', 'reason']),
      value: p(
        'Portable item value or optional `end` return value, under the stream value budget.',
        '条目事件的可移植值或 `end` 的可选结束返回值，受流值字节预算限制。'
      ),
      event: {
        ...p(
          'Actual stream event selects permitted value/error/reason slots.',
          '实际流事件选择允许的值、错误及原因位置。'
        ),
        values: { enum: 'RpcStreamEvent' }
      }
    },
    'const payload = normalizeStreamPayload({ event: "open", seq: 0 })'
  )
})
/** Pure message-control parsing reports data validity, not runtime ownership. */
const controlResult = t(
  'Validity result with value when valid, otherwise field name; no capability agreement or physical receipt is minted.',
  '返回有效时的值，或无效时的字段名称；不创建能力协议或物理接收凭据。'
)
/** Actual complete control descriptor members include private startup spellings as public constants. */
const controlMembers: Record<string, IMemberDoc> = {
  staticCapabilities: p(
    'Fixed stream and batch capabilities supported by the built-in message-control grammar, independent from peer agreement.',
    '内置消息控制语法支持的固定流与攒批能力，与对端协议结果分开。'
  ),
  readOffer: m(
    'Synchronously snapshots a bounded unique capability list without enabling any capability.',
    '同步快照有界不重复能力列表，不启用任何能力。',
    {
      value: t(
        'Untrusted actual capability proposal received from the peer.',
        '从对端收到的实际未可信能力提案。'
      )
    },
    controlResult,
    'const offer = rpcMessageCapabilityControl.readOffer(["stream@1", "batch@1"])'
  ),
  localOffer: m(
    'Validates a local proposal and adds native binary only when actual portable-binary support is also declared.',
    '校验本地提案，只有实际声明可移植二进制支持时才增加原生二进制。',
    {
      capabilities: t(
        'Actual application-installed local capability names, not the remote agreement.',
        '应用实际安装的本地能力名称，不是远端协议结果。'
      )
    },
    controlResult,
    'const offer = rpcMessageCapabilityControl.localOffer(["portable-binary@1"])'
  ),
  readAcknowledgement: m(
    'Validates the closed three-field original capability acknowledgement before intersecting offers.',
    '求交提议之前校验封闭三字段原能力确认记录。',
    {
      value: t(
        'Actual raw capability acknowledgement received on the message connection.',
        '在消息连接上实际收到的原始能力确认。'
      )
    },
    controlResult,
    'const ack = rpcMessageCapabilityControl.acknowledgement(["stream@1"]); console.log(rpcMessageCapabilityControl.readAcknowledgement(ack))'
  ),
  readData: m(
    'Reads the original data/address wrapper and normalizes its optional portable application payload.',
    '读取原数据地址包装，并规范可选可移植应用载荷。',
    {
      value: t(
        'Actual untrusted raw startup data wrapper received from the carrier.',
        '载体实际收到的未可信原启动数据包装。'
      )
    },
    controlResult,
    'const result = rpcMessageCapabilityControl.readData(rawBootstrap)'
  ),
  intersect: m(
    'Returns exactly shared capability names in local order without transitively adding dependencies.',
    '按本地顺序返回精确共有能力名称，不传递增加依赖。',
    {
      local: t(
        'Validated actual local proposal returned by localOffer/readOffer.',
        '本地提议读取或构造返回的已校验实际本地提案。'
      ),
      peer: t(
        'Validated independent peer proposal returned by readOffer/readAcknowledgement.',
        '提议或确认读取返回的已校验独立对端提案。'
      )
    },
    t(
      'Frozen local-ordered intersection array; no runtime is enabled by this pure result.',
      '返回冻结本地顺序交集数组，纯结果本身不启用运行时。'
    ),
    'const shared = rpcMessageCapabilityControl.intersect(["stream@1", "batch@1"], ["stream@1"])'
  ),
  readInitial: m(
    'Reads actual original startup wrapper and independent runtime capability proposal, retaining exact private generation validation.',
    '读取实际原始启动包装及独立运行能力提案，保持精确私有世代校验。',
    {
      value: t(
        'Actual raw received initial message; business data is normalized before runtime metadata.',
        '实际收到的原始首消息；先规范业务数据再检查运行元数据。'
      )
    },
    controlResult,
    'const initial = rpcMessageCapabilityControl.readInitial(rawBootstrap)'
  ),
  acknowledgement: m(
    'Constructs the original versioned capability ACK from an actual proposal without asserting acceptance.',
    '根据实际提案构造原版本能力确认，不声称已经接受。',
    {
      offer: t(
        'Actual validated local capability array from localOffer or readOffer.',
        '本地提议构造或读取返回的实际已校验能力数组。'
      )
    },
    t(
      'Three-field kind/version/capabilities record for the owning message adapter to send.',
      '返回供所属消息适配器发送的种类、版本、能力三字段记录。'
    ),
    'const ack = rpcMessageCapabilityControl.acknowledgement(["stream@1"]); console.log(rpcMessageCapabilityControl.readAcknowledgement(ack))'
  ),
  data: {
    ...p(
      'Original startup data discriminator migaia.thread.data, separate from later business messages.',
      '原始启动数据判别字段，与后续业务消息分开。'
    ),
    values: {
      'migaia.thread.data': t(
        'Select the original startup data/address wrapper.',
        '选择原始启动数据和地址包装。'
      )
    }
  },
  ready: {
    ...p(
      'Legacy private readiness discriminator; this acknowledgement never contributes capability proposals.',
      '传统私有就绪判别字段，此确认不贡献能力提案。'
    ),
    values: {
      'migaia.thread.data.ack': t(
        'Recognize only the private data-ready acknowledgement.',
        '只识别私有数据就绪确认消息。'
      )
    }
  },
  version: {
    ...p(
      'Original private startup control version, independent from package/wire versions.',
      '原私有启动控制版本，与包和线上版本分开。'
    ),
    values: {
      '1': t('Use the exact private startup control version one.', '使用精确的私有启动控制版本一。')
    }
  },
  timeoutMs: {
    ...p(
      'Original data-bootstrap acknowledgement deadline of 10000 milliseconds.',
      '原始数据引导确认截止时间为一万毫秒。'
    ),
    values: {
      '10000': t(
        'Allow ten seconds for the original data acknowledgement.',
        '为原数据确认允许十秒等待时间。'
      )
    }
  },
  failureText: {
    ...p(
      'Stable private diagnostic text for unacknowledged thread data bootstrap.',
      '未收到确认的线程数据引导所用稳定私有诊断文本。'
    ),
    values: {
      'Thread data bootstrap was not acknowledged': t(
        'Report when the original thread data acknowledgement is missing.',
        '原始线程数据确认缺失时报告此诊断。'
      )
    }
  }
}
for (const [name, en, zh] of [
  [
    'isInitial',
    'Recognizes only the original data discriminator without completing validation.',
    '只识别原数据判别字段，不完成全部校验。'
  ],
  [
    'isAcknowledgement',
    'Recognizes only the versioned capability ACK discriminator.',
    '只识别带版本能力确认的判别字段。'
  ],
  [
    'isReady',
    'Recognizes private data-ready traffic without treating ordinary business as control.',
    '识别私有数据就绪流量，不把普通业务视为控制。'
  ]
] as const)
  controlMembers[name] = m(
    en,
    zh,
    {
      value: t(
        'Raw received message candidate from the original carrier.',
        '原载体收到的原始消息候选值。'
      )
    },
    t(
      'Boolean discriminator match only; call the matching reader for validation.',
      '只返回布尔判别匹配，校验须使用相应读取函数。'
    ),
    'const selected = rpcMessageCapabilityControl.' + name + '(rawMessage)'
  )
types.IRpcMessageCapabilityControl = typeDoc(
  'Canonical message startup control grammar; parsing pure data never grants physical source, generation or capability authority.',
  '规范消息启动控制语法；解析纯数据不赋予物理来源、世代或能力权限。',
  controlMembers,
  'const offered = rpcMessageCapabilityControl.localOffer(["stream@1", "batch@1"]); if (offered.valid) { const ack = rpcMessageCapabilityControl.acknowledgement(offered.value); console.log(rpcMessageCapabilityControl.readAcknowledgement(ack)) }'
)
scalar(
  'rpcMessageCapabilityControl',
  'Frozen canonical message-startup descriptor reads independent actual offers, capability ACKs and data readiness without minting provenance or accepted runtime identity.',
  '冻结规范消息启动描述对象读取独立实际提议、能力确认及数据就绪，不生成来源证明或已接受运行身份。',
  types.IRpcMessageCapabilityControl.example as string
)
types.rpcMessageCapabilityControl = {
  ...types.IRpcMessageCapabilityControl,
  surface: 'IRpcMessageCapabilityControl'
}
/** Byte bootstrap descriptor retains secret values only as admitted data. */
const byteBootstrapMembers: Record<string, IMemberDoc> = {
  kind: literal(
    'kind',
    'rpc-runtime-api-bootstrap',
    t(
      'Fixed first-byte bootstrap marker preceding ordinary RPC handshake.',
      '普通远程调用握手之前的固定首字节引导标记。'
    )
  ),
  version: {
    ...fields.version,
    values: {
      '1': t('Exact byte-bootstrap private format version one.', '精确字节引导私有格式版本一。')
    }
  },
  maxBytes: p(
    'Encoded byte-bootstrap JSON is limited to `65536` bytes, including private token and identity fields; local records receive field validation without this encoded-byte check.',
    '编码字节引导对象数据最多 `65536` 字节，包含私有令牌及身份字段；本地记录仅接受字段校验，不执行此编码字节检查。'
  ),
  read: m(
    'Strictly validates a byte-bounded complete buffer or a field-validated local closed record without exposing secret-bearing parser failures.',
    '严格校验有字节上限的完整缓冲或按字段校验的本地封闭记录，不暴露含秘密的解析失败。',
    {
      input: t(
        'Actual received Uint8Array bootstrap or local record with kind/version/self/parentInstanceId/token and optional generation.',
        '实际收到的字节引导或本地记录，包含种类、版本、自身、父实例标识、令牌及可选世代。'
      )
    },
    t(
      'Valid result with fresh IRpcByteRuntimeBootstrap, or valid false; no token is emitted in invalid diagnostics.',
      '返回有效及新字节运行引导，或无效结果；无效诊断不输出令牌。'
    ),
    'const parsed = rpcByteRuntimeBootstrap.read(bootstrapBytes); if (parsed.valid) console.log(parsed.value.self.name)'
  )
}
types.rpcByteRuntimeBootstrap = typeDoc(
  'Data-only byte-bootstrap descriptor validates private launch material while physical provenance stays with the actual I/O owner.',
  '纯数据字节引导描述对象校验私有启动材料，物理来源仍归实际输入输出所有者。',
  byteBootstrapMembers,
  'const parsed = rpcByteRuntimeBootstrap.read(bootstrapBytes); if (parsed.valid) console.log(parsed.value.self.name)'
)
scalar(
  'rpcByteRuntimeBootstrap',
  'Frozen data/parser for the bounded private first-byte launch bootstrap. It validates exact identity, token and optional generation without minting a trusted channel.',
  '冻结的有界私有首字节启动引导数据及解析器，校验精确身份、令牌及可选世代，不创建可信通道。',
  types.rpcByteRuntimeBootstrap.example as string
)

/** Component descriptor types close every method/property on constant components as well. */
types.IRpcProtocol = typeDoc(
  'Application-held stable protocol descriptor with a synchronous semantic normalizer.',
  '应用持有的稳定协议描述对象及同步语义规范化函数。',
  {
    ...descriptorMembers,
    normalize: m(
      'Snapshots and validates one unknown decoded semantic envelope at the selected protocol boundary.',
      '在所选协议边界快照并校验未知解码语义信封。',
      {
        value: t(
          'Unknown value produced by the actual codec or application input.',
          '实际编解码或应用输入产生的未知值。'
        ),
        options: t(
          'Optional IRpcEnvelopeOptions for observing unknown additive fields.',
          '用于观察新增未知字段的可选信封选项。'
        )
      },
      t(
        'Validated protocol envelope; original native validation errors propagate.',
        '返回已校验协议信封，原生校验错误直接传播。'
      ),
      'const envelope = rpcProtocolV1.normalize(decoded)'
    )
  },
  'const envelope = rpcProtocolV1.normalize(decoded)'
)
for (const name of ['rpcProtocolV1', 'rpcProtocol'])
  types[name] = { ...types.IRpcProtocol, surface: 'IRpcProtocol' }
for (const name of [
  'createStringFramer',
  'createBinaryFramer',
  'messageFramerV1',
  'messageFramer',
  'remoteProcessStringFramer'
])
  types[name] = { ...types.IRpcFramer, surface: 'IRpcFramer', example: symbols[name].example }
/** Bind real options to their named documentation node. */
for (const name of [
  'acceptRpcHandshake',
  'completeRpcHandshake',
  'normalizeRpcHandshake',
  'normalizeRpcEnvelope'
])
  symbols[name] = { ...symbols[name], options: 'IRpcEnvelopeOptions' }
for (const name of ['serializeRpcError', 'reachRpcError'])
  symbols[name] = { ...symbols[name], options: 'IRpcSerializeErrorOptions' }
for (const name of ['deserializeRpcError', 'normalizeRpcSerializedError'])
  symbols[name] = { ...symbols[name], options: 'IRpcWireErrorOptions' }
for (const name of ['createStringFramer', 'createBinaryFramer'])
  symbols[name] = { ...symbols[name], options: 'IRpcFramerOptions' }
for (const name of ['createRpcStreamFrameDecoder', 'createRpcStreamFrameDecoderWithLimit'])
  symbols[name] = {
    ...symbols[name],
    params: {
      ...symbols[name].params,
      options: t(
        'Application synchronous onFrame(frame) and onError(error) callbacks documented by IRpcStreamFrameDecoderOptions; callback throws propagate.',
        '应用同步帧回调及错误回调，详见字节流解码选项；回调抛错直接传播。'
      )
    }
  }
symbols.runtimeOperationCapabilities = {
  ...symbols.runtimeOperationCapabilities,
  options: 'IRpcRuntimeOptions'
}
/** Each stream finish check reads only the original cancel option, not the full runtime options bag. */
for (const name of [
  'checkRpcRuntimeStreamFinish',
  'checkRpcRuntimeStreamIntent',
  'checkRpcRuntimeStreamTransition'
])
  symbols[name] = { ...symbols[name], optionDocs: { cancel: runtimeOptions.cancel } }
/** The published JSON entry exports data directly, without a fabricated function signature. */
scalar(
  'schema/wire-error:default',
  'Published JSON Schema object for serialized RPC error structure. Its limit metadata is descriptive: independent validators must also enforce the normalizer limits, canonical byte tags and surrogate rules. It does not normalize values or create runtime state.',
  '已发布的序列化调用错误结构模式对象；上限元数据属于描述，独立校验器仍须实现规范化器的限制、规范字节标签及代理字符规则；此数据不规范化输入，也不创建运行状态。',
  `import schema from '@migaia/rpc-contract/schema/wire-error' with { type: 'json' }
console.log(schema.$schema)`
)
/** Runnable task evidence is attached after all symbol option refinements. */
for (const name of ['normalizePortable', 'serializeRpcError', 'createStringFramer']) {
  const first = rpcContractCases[name]![0]!
  symbols[name] = {
    ...symbols[name],
    exampleIntro: first.problem,
    example: first.example,
    exampleResult: first.result,
    cases: rpcContractCases[name]
  }
}
/** String framing exposes its real context and result choices beside its runnable cases. */
symbols.createStringFramer = {
  ...symbols.createStringFramer,
  purpose: t(
    'Creates an ordered bounded string fragment framer. frame(value, context) returns either one whole string or ordered rpc.frame.v1 fragments. context.source is the caller-owned source namespace and context.messageId is the sender correlation id; neither authenticates a peer.\n\naccept(frame, context) returns pending, complete with a reassembled string, or rejected with an Error carrying a semantic code. Assemblies are isolated by both context fields. close() clears retained assemblies/timers and makes later accept calls reject; it does not send network messages.',
    '创建有序有界的字符串分帧器，`frame(value, context)` 返回整字符串或有序 `rpc.frame.v1` 分片；`context.source` 为调用方拥有的来源命名空间，`context.messageId` 为发送方关联标识，两者均不认证对端。\n\n`accept(frame, context)` 返回 `pending`、携带重组字符串的 `complete`，或携带带码错误的 `rejected`，按两个上下文字段共同隔离；`close()` 清理保留组装与计时器，并使之后的接收拒绝，不会发送网络消息。'
  )
}
/** Application examples keep protocol I/O and service ownership with the caller. */
const rpcOptionExamples = {
  warningKeys:
    "import { createRpcUnknownFieldWarner } from '@migaia/rpc-contract'\n\nconst warnings = createRpcUnknownFieldWarner({\n  maxKeysPerConnection: 32,\n  warn: (connection, fieldKey) => reportProtocolChange(connection, fieldKey)\n})\nonGatewayClosed(() => warnings.clear())",
  warningConnections:
    "import { createRpcUnknownFieldWarner } from '@migaia/rpc-contract'\n\nconst warnings = createRpcUnknownFieldWarner({\n  maxConnections: 128,\n  warn: (connection, fieldKey) => reportProtocolChange(connection, fieldKey)\n})\nonGatewayClosed(() => warnings.clear())",
  wireIgnore:
    "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\nshowCheckoutFailure(failure)",
  wireReject:
    "import { normalizeRpcSerializedError } from '@migaia/rpc-contract/errors'\n\ntry {\n  const failure = normalizeRpcSerializedError(receivedError, { unknownFields: 'reject' })\n  saveValidatedFailure(failure)\n} catch (error) {\n  reportProtocolFailure(error)\n}",
  errorReport:
    "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure)\n})\nsendFailureToCheckout(wire)",
  errorReach:
    "import { reachRpcError } from '@migaia/rpc-contract/errors'\n\nfor (const failure of reachRpcError(checkoutFailure, {\n  report: (entry) => reportSerializationFailure(entry)\n})) {\n  addFailureToSupportView(failure)\n}",
  framerBounds:
    "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({\n  chunkBytes: 4096,\n  maxMessageBytes: 65536,\n  maxChunks: 16\n})\nfor (const frame of framer.frame(encodedOrder, messageContext)) {\n  await sendCarrierFrame(frame)\n}\nonCarrierClosed(() => framer.close())",
  framerBuffers:
    "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({\n  maxMessageBytes: 65536,\n  maxBufferedBytes: 1048576,\n  maxConcurrentMessages: 16,\n  assemblyTimeoutMs: 2000\n})\nonCarrierClosed(() => framer.close())",
  framerTimers:
    "import { createBinaryFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createBinaryFramer({\n  schedule: (task, delayMs) => carrierTimers.schedule(task, delayMs),\n  cancel: (handle) => carrierTimers.cancel(handle)\n})\nonCarrierClosed(() => framer.close())",
  framerNow:
    'const framer = createStringFramer({\n  ...framerConfiguration,\n  now: () => readCarrierClock()\n})',
  decoderFrames:
    "import { createRpcStreamFrameDecoder } from '@migaia/rpc-contract/framing/stream'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (payload) => handleOrderPayload(payload),\n  onError: (error) => closeCarrierWithFailure(error)\n})\nfor await (const chunk of carrierReads) decoder.push(chunk)\ndecoder.finish()\ndecoder.close()",
  decoderError:
    "import { createRpcStreamFrameDecoderWithLimit } from '@migaia/rpc-contract/framing/stream'\n\nconst decoder = createRpcStreamFrameDecoderWithLimit({\n  onFrame: (payload) => handleOrderPayload(payload),\n  onError: (error) => markOrderUploadFailed(error)\n}, () => orderUploadLimitBytes)\nfor await (const chunk of carrierReads) decoder.push(chunk)\ndecoder.finish()\ndecoder.close()",
  handshakeInitiator:
    "import { createRpcHandshakeFrameReceiver } from '@migaia/rpc-contract/framing/stream'\n\nconst receiver = createRpcHandshakeFrameReceiver({ role: 'initiator' })\nreceiver.accept(acceptPayload)\nawait completeClientHandshake(await receiver.readHandshakeFrame())\nreceiver.activate()\nonCarrierClosed((reason) => receiver.close(reason))",
  handshakeResponder:
    "import { createRpcHandshakeFrameReceiver } from '@migaia/rpc-contract/framing/stream'\n\nconst receiver = createRpcHandshakeFrameReceiver({ role: 'responder' })\nreceiver.accept(helloPayload)\nconst reply = await prepareServiceHandshake(await receiver.readHandshakeFrame())\nreceiver.beginAccept()\nawait sendHandshakeReply(reply)\nreceiver.activate()\nonCarrierClosed((reason) => receiver.close(reason))",
  handshakeUnknown:
    "import { normalizeRpcHandshake } from '@migaia/rpc-contract/handshake'\n\nconst hello = normalizeRpcHandshake(receivedHello, {\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\ninspectPricingHello(hello)",
  envelopeUnknown:
    "import { normalizeRpcEnvelope } from '@migaia/rpc-contract/v1'\n\nconst request = normalizeRpcEnvelope(receivedRequest, {\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\nrouteCheckoutRequest(request)",
  runtimeOrder:
    "import { runtimeOperationCapabilities } from '@migaia/rpc-contract/runtime'\n\nconst required = runtimeOperationCapabilities('request', {\n  orderKey: cartId,\n  idempotencyKey: checkoutAttemptId\n})\nrequirePricingCapabilities(required)",
  runtimeCancel:
    "import { runtimeOperationCapabilities, RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst required = runtimeOperationCapabilities('stream', { cancel: RpcRuntimeCancel })\nrequireExportCapabilities(required)",
  runtimeTimeout:
    "const required = runtimeOperationCapabilities('request', { timeoutMs: 2000 })\nrequirePricingCapabilities(required)",
  streamFinish:
    "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/stream'\nimport { RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst originalTaskOptions = { cancel: RpcRuntimeCancel } as const\nconst failure = checkRpcRuntimeStreamFinish(originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse finishOriginalStream()",
  streamFinishDenied:
    "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/stream'\n\nconst originalTaskOptions = { cancel: undefined }\nconst failure = checkRpcRuntimeStreamFinish(originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse finishOriginalStream()"
}
/** Each case describes one application choice. */
const rpcOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  unknownWarner: [
    {
      title: {
        en: 'Keep rollout warnings useful on a busy checkout connection',
        zh: '让繁忙结算连接的升级警告保持有用'
      },
      problem: {
        en: 'A newer checkout client repeats additive fields across many cart items. Bound the remembered field identities so one connection cannot fill the gateway’s diagnostic cache; repeated array indexes already share one identity.',
        zh: '新版结算客户端在大量购物车条目中重复新增字段。限制保留的字段身份，避免一个连接填满网关诊断缓存；重复数组下标本就共享同一身份。'
      },
      example:
        "import { createRpcUnknownFieldWarner } from '@migaia/rpc-contract'\n\nconst warnings = createRpcUnknownFieldWarner({\n  maxKeysPerConnection: 32,\n  warn: (connection, fieldKey) => reportProtocolChange(connection, fieldKey)\n})\nonGatewayClosed(() => warnings.clear())",
      result: {
        en: 'The gateway reports each retained field once, then uses one overflow warning instead of retaining more keys.',
        zh: '网关对每个保留字段只报告一次，达到上限后用一次溢出警告代替继续保存字段。'
      },
      covers: ['maxKeysPerConnection', 'warn']
    },
    {
      title: {
        en: 'Bound warning memory in a long-lived gateway',
        zh: '限制长期运行网关的警告内存'
      },
      problem: {
        en: 'A gateway serves changing checkout sessions all day. Keep a bounded connection cache so sessions that disappeared do not retain diagnostic state indefinitely; an evicted session may warn again when it returns.',
        zh: '网关全天服务不断变化的结算会话。限制连接缓存，避免已经消失的会话长期保留诊断状态；被移除的会话再次出现时可以重新警告。'
      },
      example:
        "import { createRpcUnknownFieldWarner } from '@migaia/rpc-contract'\n\nconst warnings = createRpcUnknownFieldWarner({\n  maxConnections: 128,\n  warn: (connection, fieldKey) => reportProtocolChange(connection, fieldKey)\n})\nonGatewayClosed(() => warnings.clear())",
      result: {
        en: 'Recent sessions retain warning deduplication while older cache entries are released.',
        zh: '近期会话继续复用警告去重状态，较旧缓存项则被释放。'
      },
      covers: ['maxConnections', 'warn']
    }
  ],
  wireError: [
    {
      title: {
        en: 'Read an additive error from a newer pricing service',
        zh: '读取新版价格服务增加字段后的错误'
      },
      problem: {
        en: 'A rolling pricing deployment may add diagnostic fields to its wire errors. When checkout can discard those additions, allow them explicitly and send their locations to rollout monitoring instead of losing the known error.',
        zh: '价格服务逐步升级时可能给线上错误增加诊断字段。结算页允许丢弃新增内容时，显式接纳并把位置交给升级监控，避免整份已知错误无法读取。'
      },
      example:
        "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\nshowCheckoutFailure(failure)",
      result: {
        en: 'Checkout can display the restored error while monitoring sees the omitted fields.',
        zh: '结算页可以展示恢复的错误，监控同时获知被省略的字段。'
      },
      covers: ['unknownFields', 'onUnknownField']
    },
    {
      title: {
        en: 'Keep the audit error archive strict',
        zh: '严格检查审计错误归档'
      },
      problem: {
        en: 'An audit archive only accepts the agreed error schema. Reject extra fields at ingress so unreviewed data does not enter the archive; omitting this option selects the same strict policy.',
        zh: '审计归档只接收约定的错误结构。在入口拒绝额外字段，避免未经审定的数据进入归档；省略选项也使用同一严格策略。'
      },
      example:
        "import { normalizeRpcSerializedError } from '@migaia/rpc-contract/errors'\n\ntry {\n  const failure = normalizeRpcSerializedError(receivedError, { unknownFields: 'reject' })\n  saveValidatedFailure(failure)\n} catch (error) {\n  reportProtocolFailure(error)\n}",
      result: {
        en: 'Only validated error records reach the archive; incompatible input goes to protocol monitoring.',
        zh: '只有通过校验的错误记录进入归档，不兼容输入交给协议监控。'
      },
      covers: ['unknownFields']
    }
  ],
  serializeError: [
    {
      title: {
        en: 'Keep a third-party failure report usable',
        zh: '保留第三方故障报告的可用部分'
      },
      problem: {
        en: 'A payment SDK error can have unreadable properties. The serializer can still produce its bounded wire error, but omitted reads need a local reporter so support can see why detail was lost.',
        zh: '支付 SDK 的错误属性可能无法读取。序列化器仍可生成有界线上错误，但需要本地报告器记录省略的读取失败，便于支持人员知道详情为何缺失。'
      },
      example:
        "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure)\n})\nsendFailureToCheckout(wire)",
      result: {
        en: 'Checkout receives the available error information and local monitoring keeps field-read failures.',
        zh: '结算端收到可用错误信息，本地监控保留字段读取失败。'
      },
      covers: ['report']
    },
    {
      title: {
        en: 'Show the reachable payment failure chain',
        zh: '展示可达的支付故障链'
      },
      problem: {
        en: 'A support view needs the original error and reachable aggregate children even if an SDK cause accessor fails. Report the unreadable branch while continuing to show the errors the traversal can reach.',
        zh: '支持界面需要原始错误及可达的聚合子错误，即使 SDK 的 cause 访问器失败。报告无法读取的分支，同时继续展示遍历能够到达的错误。'
      },
      example:
        "import { reachRpcError } from '@migaia/rpc-contract/errors'\n\nfor (const failure of reachRpcError(checkoutFailure, {\n  report: (entry) => reportSerializationFailure(entry)\n})) {\n  addFailureToSupportView(failure)\n}",
      result: {
        en: 'The support view keeps available failures, and missing branches remain observable locally.',
        zh: '支持界面保留可用故障，缺失分支仍可在本地追踪。'
      },
      covers: ['report']
    }
  ],
  framer: [
    {
      title: {
        en: 'Fit order messages into a small text carrier',
        zh: '让订单消息适应小型文本载体'
      },
      problem: {
        en: 'A text carrier only accepts small writes. Split an encoded order into bounded ordered fragments and cap the whole order as well, so a large cart cannot turn into an unbounded fragment sequence.',
        zh: '文本载体每次只接受小段写入。把已编码订单拆成有界有序分片，同时限制整份订单，避免大型购物车变成没有上限的分片序列。'
      },
      example:
        "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({\n  chunkBytes: 4096,\n  maxMessageBytes: 65536,\n  maxChunks: 16\n})\nfor (const frame of framer.frame(encodedOrder, messageContext)) {\n  await sendCarrierFrame(frame)\n}\nonCarrierClosed(() => framer.close())",
      result: {
        en: 'The carrier receives ordered fragments within the selected text-unit and message limits.',
        zh: '载体按顺序接收符合所选文本计量单位及消息上限的分片。'
      },
      covers: ['chunkBytes', 'maxMessageBytes', 'maxChunks']
    },
    {
      title: {
        en: 'Release abandoned inbound orders',
        zh: '释放被放弃的入站订单'
      },
      problem: {
        en: 'Mobile checkout connections can disappear between fragments. Limit incomplete orders and their retained text, and expire an unfinished assembly so one abandoned upload cannot keep its slot indefinitely.',
        zh: '移动结算连接可能在分片之间消失。限制未完成订单及保留文本量，并让未完成组装到期，避免一次被放弃的上传长期占用槽位。'
      },
      example:
        "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({\n  maxMessageBytes: 65536,\n  maxBufferedBytes: 1048576,\n  maxConcurrentMessages: 16,\n  assemblyTimeoutMs: 2000\n})\nonCarrierClosed(() => framer.close())",
      result: {
        en: 'Incomplete uploads remain bounded and their assembly expires under the selected timeout.',
        zh: '未完成上传占用有界资源，组装按所选时限到期。'
      },
      covers: ['maxMessageBytes', 'maxBufferedBytes', 'maxConcurrentMessages', 'assemblyTimeoutMs']
    },
    {
      title: {
        en: 'Keep assembly timers with the carrier',
        zh: '让组装计时器跟随载体'
      },
      problem: {
        en: 'A custom carrier already owns a timer service. Use that same service for incomplete-message expiry, including cancellation when an assembly finishes or the carrier closes.',
        zh: '自定义载体已持有计时服务。让未完成消息的到期也使用同一服务，并在组装完成或载体关闭时取消对应计时器。'
      },
      example:
        "import { createBinaryFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createBinaryFramer({\n  schedule: (task, delayMs) => carrierTimers.schedule(task, delayMs),\n  cancel: (handle) => carrierTimers.cancel(handle)\n})\nonCarrierClosed(() => framer.close())",
      result: {
        en: 'Assembly cleanup releases the original timer handles through the carrier’s timer service.',
        zh: '组装清理通过载体计时服务释放原始计时句柄。'
      },
      covers: ['schedule', 'cancel']
    }
  ],
  decoder: [
    {
      title: {
        en: 'Read complete orders from arbitrary byte chunks',
        zh: '从任意字节块读取完整订单'
      },
      problem: {
        en: 'A socket can split an order’s length prefix and body across reads. Give the decoder one consumer for complete payloads and one failure owner, rather than treating each socket read as a complete message.',
        zh: '套接字可能把订单长度前缀与主体拆到多次读取。给解码器提供完整载荷消费者和故障所有者，避免把每次读取误当成完整消息。'
      },
      example:
        "import { createRpcStreamFrameDecoder } from '@migaia/rpc-contract/framing/stream'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (payload) => handleOrderPayload(payload),\n  onError: (error) => closeCarrierWithFailure(error)\n})\nfor await (const chunk of carrierReads) decoder.push(chunk)\ndecoder.finish()\ndecoder.close()",
      result: {
        en: 'The order consumer receives complete payloads without their four-byte prefixes.',
        zh: '订单消费者收到不含四字节前缀的完整载荷。'
      },
      covers: ['onFrame', 'onError']
    },
    {
      title: {
        en: 'Fail an order upload that ends mid-frame',
        zh: '使在帧中途结束的订单上传失败'
      },
      problem: {
        en: 'An upload connection can end before its final payload is complete. Finish the decoder at EOF so the application marks that upload failed instead of silently accepting a partial order.',
        zh: '上传连接可能在最后一份载荷完成前结束。在流结束时完成解码器检查，让应用把上传标记为失败，避免静默接收残缺订单。'
      },
      example:
        "import { createRpcStreamFrameDecoderWithLimit } from '@migaia/rpc-contract/framing/stream'\n\nconst decoder = createRpcStreamFrameDecoderWithLimit({\n  onFrame: (payload) => handleOrderPayload(payload),\n  onError: (error) => markOrderUploadFailed(error)\n}, () => orderUploadLimitBytes)\nfor await (const chunk of carrierReads) decoder.push(chunk)\ndecoder.finish()\ndecoder.close()",
      result: {
        en: 'The failure handler receives the incomplete-frame error and the upload can show a failure state.',
        zh: '失败处理器收到未完成帧错误，上传可以显示失败状态。'
      },
      covers: ['onFrame', 'onError']
    }
  ],
  handshakeReceiver: [
    {
      title: {
        en: 'Read the pricing service’s handshake reply',
        zh: '读取价格服务的握手响应'
      },
      problem: {
        en: 'A custom outgoing carrier has already received the service’s accept payload. Mark this receiver as the initiator so its first control frame follows the client-side path before business decoding is activated.',
        zh: '自定义出站载体已收到服务的 accept 载荷。将接收器标为发起方，让首个控制帧走客户端路径，再激活业务解码。'
      },
      example:
        "import { createRpcHandshakeFrameReceiver } from '@migaia/rpc-contract/framing/stream'\n\nconst receiver = createRpcHandshakeFrameReceiver({ role: 'initiator' })\nreceiver.accept(acceptPayload)\nawait completeClientHandshake(await receiver.readHandshakeFrame())\nreceiver.activate()\nonCarrierClosed((reason) => receiver.close(reason))",
      result: {
        en: 'The client can complete its handshake before the receiver enters the business phase.',
        zh: '客户端可以先完成握手，再让接收器进入业务阶段。'
      },
      covers: ['role']
    },
    {
      title: {
        en: 'Accept a checkout connection before serving messages',
        zh: '服务消息前接纳结算连接'
      },
      problem: {
        en: 'A custom inbound carrier owns the hello payload and physical reply write. Use responder handling, record acceptance before sending its reply, and activate business decoding after that write completes.',
        zh: '自定义入站载体持有 hello 载荷并负责实际写回响应。采用响应方处理，在发送响应前记录接纳状态，写入完成后再激活业务解码。'
      },
      example:
        "import { createRpcHandshakeFrameReceiver } from '@migaia/rpc-contract/framing/stream'\n\nconst receiver = createRpcHandshakeFrameReceiver({ role: 'responder' })\nreceiver.accept(helloPayload)\nconst reply = await prepareServiceHandshake(await receiver.readHandshakeFrame())\nreceiver.beginAccept()\nawait sendHandshakeReply(reply)\nreceiver.activate()\nonCarrierClosed((reason) => receiver.close(reason))",
      result: {
        en: 'The service enters its business phase after its handshake response has been sent.',
        zh: '服务在握手响应发送完成后进入业务阶段。'
      },
      covers: ['role']
    }
  ],
  envelope: [
    {
      title: {
        en: 'Watch a pricing handshake rollout',
        zh: '观察价格服务握手升级'
      },
      problem: {
        en: 'A newer price service adds optional handshake fields. Record their locations during normalization so rollout monitoring can see the change while known handshake data remains usable.',
        zh: '新版价格服务给握手增加可选字段。在规范化时记录其位置，让升级监控获知变化，同时继续使用已知握手数据。'
      },
      example:
        "import { normalizeRpcHandshake } from '@migaia/rpc-contract/handshake'\n\nconst hello = normalizeRpcHandshake(receivedHello, {\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\ninspectPricingHello(hello)",
      result: {
        en: 'Known handshake fields remain available and additive fields reach rollout monitoring.',
        zh: '已知握手字段仍可使用，新增字段交给升级监控。'
      },
      covers: ['onUnknownField']
    },
    {
      title: {
        en: 'Observe a newer checkout request shape',
        zh: '观察新版结算请求结构'
      },
      problem: {
        en: 'A checkout rollout can add fields to requests before every service is updated. Observe those additions at normalization without failing known request data; keep the observer from throwing because it runs synchronously.',
        zh: '结算升级可能在所有服务更新前给请求增加字段。在规范化时观察新增内容，同时保留已知请求数据；观察器同步执行，应避免抛错。'
      },
      example:
        "import { normalizeRpcEnvelope } from '@migaia/rpc-contract/v1'\n\nconst request = normalizeRpcEnvelope(receivedRequest, {\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\nrouteCheckoutRequest(request)",
      result: {
        en: 'The normalized request remains available to routing and monitoring sees the new field locations.',
        zh: '规范化请求仍可交给路由，监控获知新字段的位置。'
      },
      covers: ['onUnknownField']
    }
  ],
  runtime: [
    {
      title: {
        en: 'Check support before retrying an ordered checkout',
        zh: '重试有序结算前检查支持能力'
      },
      problem: {
        en: 'A checkout adapter needs cart-local ordering and result lookup for one logical payment attempt. Compute the required peer capabilities before sending; this helper describes requirements and grants no execution rights.',
        zh: '结算适配器需要按购物车排序，并查询同一次逻辑支付尝试的结果。发送前计算对端所需能力；此辅助函数只描述需求，不授予执行权限。'
      },
      example:
        "import { runtimeOperationCapabilities } from '@migaia/rpc-contract/runtime'\n\nconst required = runtimeOperationCapabilities('request', {\n  orderKey: cartId,\n  idempotencyKey: checkoutAttemptId\n})\nrequirePricingCapabilities(required)",
      result: {
        en: 'The adapter can require ordering and outcome lookup before choosing a pricing connection.',
        zh: '适配器可在选择价格连接前要求顺序与结果查询能力。'
      },
      covers: ['orderKey', 'idempotencyKey']
    },
    {
      title: {
        en: 'Let the export provider arbitrate cancellation before start',
        zh: '让导出提供方在启动前裁定取消'
      },
      problem: {
        en: 'An export adapter asks the final provider to decide cancellation before execution starts. Require that capability before selecting the stream connection; this option does not add the ordinary deadline or abort requirements.',
        zh: '导出适配器请求最终提供方在执行启动前裁定取消。选择流连接前要求该能力；此选项不会增加普通截止时间或中止能力需求。'
      },
      example:
        "import { runtimeOperationCapabilities, RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst required = runtimeOperationCapabilities('stream', { cancel: RpcRuntimeCancel })\nrequireExportCapabilities(required)",
      result: {
        en: 'Connection selection can require before-start cancellation together with stream support.',
        zh: '连接选择可以同时要求启动前取消与流支持。'
      },
      covers: ['cancel']
    }
  ],
  streamCancel: [
    {
      title: {
        en: 'Validate finish for a before-start export',
        zh: '校验启动前取消导出的停止取项控制'
      },
      problem: {
        en: 'The export protocol owner retained the task’s actual before-start cancellation option. Validate a finish-without-items control against those original options before allowing the application to continue that control.',
        zh: '导出协议所有者已保留任务实际的启动前取消选项。按这些原始选项校验停止取项控制，再让应用继续处理该控制。'
      },
      example:
        "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/stream'\nimport { RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst originalTaskOptions = { cancel: RpcRuntimeCancel } as const\nconst failure = checkRpcRuntimeStreamFinish(originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse finishOriginalStream()",
      result: {
        en: 'A compatible control can reach the application’s existing stream owner; the checker itself does not drain the producer.',
        zh: '兼容控制可以交给应用已有的流所有者，校验器本身不排空生产方。'
      },
      covers: ['cancel']
    },
    {
      title: {
        en: 'Reject finish for an ordinary export',
        zh: '拒绝普通导出的停止取项控制'
      },
      problem: {
        en: 'An ordinary export did not opt into before-start cancellation. Validate the control against its original empty options so an unsupported finish-without-items request is reported instead of being treated as valid.',
        zh: '普通导出没有选择启动前取消。按原始空选项检查控制，让不支持的停止取项请求得到报告，避免误当成有效控制。'
      },
      example:
        "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/stream'\n\nconst originalTaskOptions = { cancel: undefined }\nconst failure = checkRpcRuntimeStreamFinish(originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse finishOriginalStream()",
      result: {
        en: 'The application receives a validation failure and can refuse the incompatible stream control.',
        zh: '应用收到校验失败，可以拒绝不兼容的流控制。'
      },
      covers: ['cancel']
    }
  ]
}
/** Stream validators retain their own public call in each option example. */
const rpcStreamOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  checkRpcRuntimeStreamFinish: [
    {
      title: {
        en: 'Validate finish for a before-start export',
        zh: '校验启动前取消导出的停止取项控制'
      },
      problem: {
        en: 'The export protocol owner retained the task’s actual before-start cancellation option. Validate a finish-without-items control against those original options before allowing the application to continue that control.',
        zh: '导出协议所有者已保留任务实际的启动前取消选项。按这些原始选项校验停止取项控制，再让应用继续处理该控制。'
      },
      example:
        "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/stream'\nimport { RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst originalTaskOptions = { cancel: RpcRuntimeCancel } as const\nconst failure = checkRpcRuntimeStreamFinish(originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse finishOriginalStream()",
      result: {
        en: 'A compatible control can reach the application’s existing stream owner; the checker itself does not drain the producer.',
        zh: '兼容控制可以交给应用已有的流所有者，校验器本身不排空生产方。'
      },
      covers: ['cancel']
    },
    {
      title: {
        en: 'Reject finish for an ordinary export',
        zh: '拒绝普通导出的停止取项控制'
      },
      problem: {
        en: 'An ordinary export did not opt into before-start cancellation. Validate the control against its original empty options so an unsupported finish-without-items request is reported instead of being treated as valid.',
        zh: '普通导出没有选择启动前取消。按原始空选项检查控制，让不支持的停止取项请求得到报告，避免误当成有效控制。'
      },
      example:
        "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/stream'\n\nconst originalTaskOptions = { cancel: undefined }\nconst failure = checkRpcRuntimeStreamFinish(originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse finishOriginalStream()",
      result: {
        en: 'The application receives a validation failure and can refuse the incompatible stream control.',
        zh: '应用收到校验失败，可以拒绝不兼容的流控制。'
      },
      covers: ['cancel']
    }
  ],
  checkRpcRuntimeStreamIntent: [
    {
      title: {
        en: 'Validate finish for a before-start export',
        zh: '校验启动前取消导出的停止取项控制'
      },
      problem: {
        en: 'The export protocol owner retained the task’s actual before-start cancellation option. Validate a finish-without-items control against those original options before allowing the application to continue that control.',
        zh: '导出协议所有者已保留任务实际的启动前取消选项。按这些原始选项校验停止取项控制，再让应用继续处理该控制。'
      },
      example:
        "import { checkRpcRuntimeStreamIntent } from '@migaia/rpc-contract/stream'\nimport { RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst originalTaskOptions = { cancel: RpcRuntimeCancel } as const\nconst failure = checkRpcRuntimeStreamIntent(pendingFinishIntent, originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse keepFinishIntent()",
      result: {
        en: 'A compatible control can reach the application’s existing stream owner; the checker itself does not drain the producer.',
        zh: '兼容控制可以交给应用已有的流所有者，校验器本身不排空生产方。'
      },
      covers: ['cancel']
    },
    {
      title: {
        en: 'Reject finish for an ordinary export',
        zh: '拒绝普通导出的停止取项控制'
      },
      problem: {
        en: 'An ordinary export did not opt into before-start cancellation. Validate the control against its original empty options so an unsupported finish-without-items request is reported instead of being treated as valid.',
        zh: '普通导出没有选择启动前取消。按原始空选项检查控制，让不支持的停止取项请求得到报告，避免误当成有效控制。'
      },
      example:
        "import { checkRpcRuntimeStreamIntent } from '@migaia/rpc-contract/stream'\n\nconst originalTaskOptions = { cancel: undefined }\nconst failure = checkRpcRuntimeStreamIntent(pendingFinishIntent, originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse keepFinishIntent()",
      result: {
        en: 'The application receives a validation failure and can refuse the incompatible stream control.',
        zh: '应用收到校验失败，可以拒绝不兼容的流控制。'
      },
      covers: ['cancel']
    }
  ],
  checkRpcRuntimeStreamTransition: [
    {
      title: {
        en: 'Validate finish for a before-start export',
        zh: '校验启动前取消导出的停止取项控制'
      },
      problem: {
        en: 'The export protocol owner retained the task’s actual before-start cancellation option. Validate a finish-without-items control against those original options before allowing the application to continue that control.',
        zh: '导出协议所有者已保留任务实际的启动前取消选项。按这些原始选项校验停止取项控制，再让应用继续处理该控制。'
      },
      example:
        "import { checkRpcRuntimeStreamTransition } from '@migaia/rpc-contract/stream'\nimport { RpcRuntimeCancel } from '@migaia/rpc-contract/runtime'\n\nconst originalTaskOptions = { cancel: RpcRuntimeCancel } as const\nconst failure = checkRpcRuntimeStreamTransition(receivedControl, originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse applyStreamControl()",
      result: {
        en: 'A compatible control can reach the application’s existing stream owner; the checker itself does not drain the producer.',
        zh: '兼容控制可以交给应用已有的流所有者，校验器本身不排空生产方。'
      },
      covers: ['cancel']
    },
    {
      title: {
        en: 'Reject finish for an ordinary export',
        zh: '拒绝普通导出的停止取项控制'
      },
      problem: {
        en: 'An ordinary export did not opt into before-start cancellation. Validate the control against its original empty options so an unsupported finish-without-items request is reported instead of being treated as valid.',
        zh: '普通导出没有选择启动前取消。按原始空选项检查控制，让不支持的停止取项请求得到报告，避免误当成有效控制。'
      },
      example:
        "import { checkRpcRuntimeStreamTransition } from '@migaia/rpc-contract/stream'\n\nconst originalTaskOptions = { cancel: undefined }\nconst failure = checkRpcRuntimeStreamTransition(receivedControl, originalTaskOptions)\nif (failure) rejectStreamControl(failure)\nelse applyStreamControl()",
      result: {
        en: 'The application receives a validation failure and can refuse the incompatible stream control.',
        zh: '应用收到校验失败，可以拒绝不兼容的流控制。'
      },
      covers: ['cancel']
    }
  ]
}
envelopeOptions.onUnknownField = {
  ...envelopeOptions.onUnknownField,
  whenToUse: t(
    'Observe allowed additive fields during a version rollout. The callback receives pointer and field and must return void; a throw aborts normalization. Omit it to ignore those fields silently.',
    '版本升级期间需要观察允许新增的字段时设置。回调接收 pointer 和 field，返回空值；抛错会终止规范化。省略时静默忽略这些字段。'
  ),
  example: rpcOptionExamples.handshakeUnknown
}
wireErrorOptions.unknownFields = {
  ...wireErrorOptions.unknownFields,
  whenToUse: t(
    'Use reject for strict received-error schemas; it is the default. Use ignore only when additive fields may be dropped. The observer does not choose or change that policy.',
    '需要严格接收错误结构时用 reject，它也是默认值。仅允许丢弃新增字段时用 ignore。观察回调不选择或改变策略。'
  ),
  example: rpcOptionExamples.wireIgnore
}
wireErrorOptions.onUnknownField = {
  ...wireErrorOptions.onUnknownField,
  whenToUse: t(
    'Use it with unknownFields ignore to record fields dropped from a newer peer’s error. Omit it for no observer; the default reject policy still rejects unknown fields.',
    '使用 unknownFields ignore 接收新版本对端错误时，用它记录丢弃字段。省略时没有观察者；默认 reject 策略仍拒绝未知字段。'
  ),
  example: rpcOptionExamples.wireIgnore
}
framerOptions.now = {
  ...framerOptions.now,
  whenToUse: t(
    'Supply only when sharing a framer configuration shape that already includes a clock. Current assembly expiry retains this callback but never invokes it; omission has the same expiry behavior. Use schedule to control expiry.',
    '只在复用已经包含时钟的分片配置形状时提供。当前组装到期逻辑保存但从不调用此回调；省略时到期行为相同。控制到期应使用 schedule。'
  ),
  example: rpcOptionExamples.framerNow
}
framerOptions.schedule = {
  ...framerOptions.schedule,
  whenToUse: t(
    'Set it when the carrier owns a timer queue. Return one handle for the expiry callback; cancel receives that handle. Omission uses host setTimeout when available, otherwise no timer is armed.',
    '载体持有计时队列时设置。为到期回调返回句柄，由 cancel 接收该句柄。省略时使用可用宿主 setTimeout，宿主没有计时器时不安排。'
  ),
  example: rpcOptionExamples.framerTimers
}
framerOptions.cancel = {
  ...framerOptions.cancel,
  whenToUse: t(
    'Set it when using a custom schedule so completed or closed assemblies release their pending timer. It receives the original opaque handle. Omission uses host clearTimeout when available.',
    '使用自定义 schedule 时设置此函数，使已完成或关闭的组装释放待执行计时器。它接收原始不透明句柄。省略时使用可用宿主 clearTimeout。'
  ),
  example: rpcOptionExamples.framerTimers
}
frameDecoderOptions.onFrame = {
  ...frameDecoderOptions.onFrame,
  whenToUse: t(
    'Always supply the complete-payload consumer. It runs synchronously after assembly state is released, and a throw propagates to push(). There is no default consumer.',
    '必须提供完整载荷消费者。它在组装状态释放后同步运行，抛错向 push() 传播。没有默认消费者。'
  ),
  example: rpcOptionExamples.decoderFrames
}
frameDecoderOptions.onError = {
  ...frameDecoderOptions.onError,
  whenToUse: t(
    'Always supply a framing failure sink. The first malformed or truncated frame makes the decoder terminal, then invokes it once. There is no default sink, and callback throws propagate to the caller.',
    '必须提供分帧失败接收方。首个异常或未完成帧使解码器进入终态，然后调用一次。没有默认接收方，回调抛错向调用者传播。'
  ),
  example: rpcOptionExamples.decoderError
}
runtimeOptions.cancel = {
  ...runtimeOptions.cancel,
  whenToUse: t(
    'Choose before-start only when the final provider must decide cancellation before actual execution starts. Omission leaves ordinary cancellation with its existing owner. In capability calculation this mode adds cancel-before-start and excludes ordinary timeout/signal requirements.',
    '仅当最终提供方必须在实际执行开始前裁定取消时选 before-start。省略时普通取消仍归已有所有者。计算能力时，此模式增加 cancel-before-start，排除普通超时及信号能力需求。'
  ),
  example: rpcOptionExamples.runtimeCancel
}
symbols.createRpcUnknownFieldWarner = {
  ...symbols.createRpcUnknownFieldWarner,
  optionCases: rpcOptionCases.unknownWarner,
  optionDocs: {
    ...symbols.createRpcUnknownFieldWarner.optionDocs,
    warn: {
      ...symbols.createRpcUnknownFieldWarner.optionDocs!.warn!,
      whenToUse: t(
        'Always supply the synchronous warning sink. It receives a connection identity and bounded field key, including * on key overflow. There is no default; a thrown callback failure propagates.',
        '必须提供同步警告接收方。它接收连接身份和有界字段键，键溢出时包含 *。没有默认实现，回调抛错会传播。'
      ),
      example: rpcOptionExamples.warningKeys
    }
  }
}
types.IRpcSerializeErrorOptions = {
  ...types.IRpcSerializeErrorOptions,
  optionCases: rpcOptionCases.serializeError,
  members: {
    ...types.IRpcSerializeErrorOptions.members,
    report: {
      ...types.IRpcSerializeErrorOptions.members.report!,
      whenToUse: t(
        'Always supply a local diagnostic sink for failed reads or portable projections omitted from the wire error. The callback receives pointer, field and the original failure. There is no default reporter.',
        '必须为线上错误省略的读取或可移植投影失败提供本地诊断接收方。回调接收 pointer、field 和原始失败。没有默认报告方。'
      ),
      example: rpcOptionExamples.errorReport
    }
  }
}
types.IRpcHandshakeFrameReceiverOptions = {
  ...types.IRpcHandshakeFrameReceiverOptions,
  optionCases: rpcOptionCases.handshakeReceiver,
  members: {
    ...types.IRpcHandshakeFrameReceiverOptions.members,
    role: {
      ...types.IRpcHandshakeFrameReceiverOptions.members.role!,
      whenToUse: t(
        'Use initiator for the side receiving accept; it permits post-accept business text before activation. Use responder for the side receiving hello. Omission uses responder-like first-frame handling without that initiator shortcut.',
        '接收 accept 的一端使用 initiator，它允许激活前接收 accept 之后的业务文本。接收 hello 的一端使用 responder。省略时按响应方首帧规则处理，不启用发起方捷径。'
      ),
      example: rpcOptionExamples.handshakeInitiator
    }
  }
}
types.IRpcEnvelopeOptions = { ...types.IRpcEnvelopeOptions, optionCases: rpcOptionCases.envelope }
types.IRpcWireErrorOptions = {
  ...types.IRpcWireErrorOptions,
  optionCases: rpcOptionCases.wireError
}
types.IRpcFramerOptions = { ...types.IRpcFramerOptions, optionCases: rpcOptionCases.framer }
types.IRpcStreamFrameDecoderOptions = {
  ...types.IRpcStreamFrameDecoderOptions,
  optionCases: rpcOptionCases.decoder
}
types.IRpcRuntimeOptions = { ...types.IRpcRuntimeOptions, optionCases: rpcOptionCases.runtime }
for (const name of [
  'checkRpcRuntimeStreamFinish',
  'checkRpcRuntimeStreamIntent',
  'checkRpcRuntimeStreamTransition'
])
  symbols[name] = {
    ...symbols[name],
    optionCases: rpcStreamOptionCases[name],
    optionDocs: {
      cancel: {
        ...runtimeOptions.cancel!,
        example: rpcStreamOptionCases[name]![0]!.example,
        whenToUse: t(
          'Pass the original task cancel option when validating finish-without-items. before-start admits that control; omission rejects it. These helpers only return the validation error and never cancel or drain a producer.',
          '检查 finish-without-items 时传入任务原始 cancel 选项。before-start 允许此控制，省略时拒绝。这些辅助函数只返回校验错误，不取消或排空生产方。'
        )
      }
    }
  }
/** Scalar fields stay independent when their choice needs no combined story. */
framerOptions.chunkBytes = { ...framerOptions.chunkBytes!, example: rpcOptionExamples.framerBounds }
framerOptions.maxMessageBytes = {
  ...framerOptions.maxMessageBytes!,
  example: rpcOptionExamples.framerBounds
}
framerOptions.maxChunks = { ...framerOptions.maxChunks!, example: rpcOptionExamples.framerBounds }
framerOptions.maxBufferedBytes = {
  ...framerOptions.maxBufferedBytes!,
  example: rpcOptionExamples.framerBuffers
}
framerOptions.maxConcurrentMessages = {
  ...framerOptions.maxConcurrentMessages!,
  example: rpcOptionExamples.framerBuffers
}
framerOptions.assemblyTimeoutMs = {
  ...framerOptions.assemblyTimeoutMs!,
  example: rpcOptionExamples.framerBuffers
}
runtimeOptions.timeoutMs = {
  ...runtimeOptions.timeoutMs!,
  example: rpcOptionExamples.runtimeTimeout
}
/** Module orientation uses canonical entry points even when other entries are aliases. */
const modules: ILibraryReference['modules'] = {
  index: {
    summary: t(
      'Core pure protocol tools and common root aliases; start with createDescriptor or import the canonical handshake, framing, errors and runtime subpaths.',
      '基础纯协议工具及常用根别名；从 `createDescriptor` 开始，或使用规范握手、分帧、错误及运行子入口。'
    ),
    example: handshakeExample
  },
  binary: {
    summary: t(
      'Use this entry when RPC messages contain byte buffers that must survive transport. `prepareRpcBinary` produces a description of the data and any separately carried buffers; `restoreRpcBinary` checks that description and restores the message.\n\nImport this subpath for the complete binary preparation and restoration workflow, which the root does not export. Use `binary/capture` when you need to capture data now and prepare it later.',
      '当远程调用消息包含需要跨连接传递的字节缓冲区时，使用此入口。`prepareRpcBinary` 生成数据清单及需单独传递的缓冲区，`restoreRpcBinary` 校验清单并还原消息。\n\n根入口不导出这套完整的二进制准备与还原操作，因此从此子路径导入。若需要先捕获数据、稍后准备发送，使用 `binary/capture`。'
    ),
    example: binaryExample
  },
  'binary/capture': {
    summary: t(
      'Use this entry when the data must be captured before asynchronous encoding begins. `captureRpcBinaryData` captures the message synchronously; calling `prepare()` on its result later produces the binary description and buffers to send.\n\nImport this subpath for capture alone rather than the broader root API. Receiving and restoring those buffers belongs to `binary` or `binary/lazy`.',
      '需要在异步编码开始前确定数据内容时，使用此入口。`captureRpcBinaryData` 同步捕获消息，稍后调用返回值的 `prepare()`，再生成待发送的数据清单和缓冲区。\n\n只需要捕获操作时，可直接导入此子路径，不必从根入口寻找相关能力。接收后的校验与还原由 `binary` 或 `binary/lazy` 提供。'
    ),
    example: binaryExample
  },
  'binary/inspect': {
    summary: t(
      'Use this entry to inspect a received native binary frame before decoding its message. `readRpcNativeBinary` checks the outer structure and counts the full underlying buffers against a size limit; `rpcBinaryView` reads a byte view’s offset and length.\n\nImport this inspection subpath because these operations are not exported by the root. Inspection does not encode data or verify its digest; use `binary` for preparation and restoration.',
      '需要在解码消息前检查收到的原生二进制帧时，使用此入口。`readRpcNativeBinary` 检查外层结构，并按完整底层缓冲区核对大小上限；`rpcBinaryView` 读取字节视图的偏移与长度。\n\n根入口不导出这些检查操作，因此从此子路径导入。这里不编码数据，也不校验摘要；准备与还原消息请使用 `binary`。'
    ),
    example: 'const selected = readRpcNativeBinary(frame, limit)'
  },
  'binary/lazy': {
    summary: t(
      'Use this entry to defer loading the binary codec until preparation or restoration needs it. `prepareRpcBinary` captures the message before loading the codec; `restoreRpcBinary` checks the binary description and restores the received data.\n\nImport this subpath for that loading behavior rather than the root, which does not expose these functions. Use `binary` when you want the ordinary entry without deferred codec loading.',
      '希望等到准备或还原二进制消息时才加载编解码器，可使用此入口。`prepareRpcBinary` 在加载前先捕获消息，`restoreRpcBinary` 则校验二进制清单并还原收到的数据。\n\n根入口不提供这些函数；此子路径还明确选择了按需加载方式。无需延迟加载时，使用 `binary`。'
    ),
    example:
      "import { captureRpcBinaryData } from '@migaia/rpc-contract/binary/capture'\nimport { restoreRpcBinary } from '@migaia/rpc-contract/binary/lazy'\n" +
      binaryExample
  },
  errors: {
    summary: t(
      'Use this entry to carry an error and its causes across a process or language boundary. `serializeRpcError` turns the error tree into bounded data, and `deserializeRpcError` restores supported native error types while retaining the sender’s stack.\n\nThe root also exports these functions; this subpath groups the error tools for focused imports. Converting an error does not frame or send a message.',
      '需要跨进程或跨语言传递错误及其原因时，使用此入口。`serializeRpcError` 把错误树转换为受大小限制的数据，`deserializeRpcError` 还原支持的原生错误类型并保留发送方的调用栈。\n\n根入口也导出这两个函数；此子路径便于集中导入错误工具。错误转换不负责分帧或发送消息。'
    ),
    example: errorExample
  },
  framing: {
    summary: t(
      'Use this entry to split an already encoded message into pieces and assemble received pieces back into one message. Start with `createStringFramer` for text or `createBinaryFramer` for bytes.\n\nImport this subpath because the root does not export these factories. For a continuous byte stream, choose the length-based framing in `framing/stream` or `framing/jsonrpc` instead.',
      '需要把已编码消息拆成小片，并将收到的小片重新组成完整消息时，使用此入口。文本从 `createStringFramer` 开始，字节数据从 `createBinaryFramer` 开始。\n\n根入口不导出这两个工厂，因此从此子路径导入。如果底层连续传递字节而不保留消息边界，应使用 `framing/stream` 或 `framing/jsonrpc` 的长度分帧。'
    ),
    example: framerExample
  },
  'framing/jsonrpc': {
    summary: t(
      'Use this entry when a JSON-RPC peer sends messages over a byte stream, where one read may contain part of a message or several messages. Each frame starts with a `Content-Length` header that gives the JSON body’s UTF-8 byte length.\n\nImport this subpath because the root does not export this framing format. `encodeJsonRpcFrame` creates a frame; `createJsonRpcFrameDecoder` accepts incoming byte chunks and returns complete messages. It does not execute JSON-RPC methods or perform the connection handshake.',
      '当 `JSON-RPC` 对端通过字节流传消息，一次读取可能只有半条消息，也可能包含多条消息时，使用此入口。每帧先写 `Content-Length` 头，声明后续消息正文编码后的字节数。\n\n根入口不导出这种分帧格式，因此从此子路径导入。`encodeJsonRpcFrame` 生成一帧，`createJsonRpcFrameDecoder` 接收陆续到达的字节块并返回完整消息。这里不执行远程方法，也不完成连接握手。'
    ),
    example: jsonExample
  },
  'framing/stream': {
    summary: t(
      'Use this entry to preserve message boundaries over the native RPC byte stream. `encodeRpcStreamFrame` prefixes a payload with its length in four bytes; `createRpcStreamFrameDecoder` joins arbitrary incoming chunks and delivers complete payloads to a callback.\n\nImport this subpath for the native framing functions, which the root does not export. A JSON-RPC peer uses the different header format in `framing/jsonrpc`.',
      '原生远程调用协议通过连续字节流传输时，使用此入口划定每条消息的边界。`encodeRpcStreamFrame` 在内容前写入四字节长度，`createRpcStreamFrameDecoder` 拼接任意切分的输入，并通过回调交付完整内容。\n\n根入口不导出这些原生分帧函数，因此从此子路径导入。`JSON-RPC` 对端需要另一种头部格式，应使用 `framing/jsonrpc`。'
    ),
    example: streamExample
  },
  'framing/v1': {
    summary: t(
      'Use this entry when the carrier already delivers complete messages and you need the version-one framing contract. `messageFramer.frame` returns the input as one frame, and `messageFramer.accept` returns it as a complete message.\n\nImport this versioned subpath for `messageFramer`; the root does not export it. It does not split large messages or recover boundaries from a byte stream.',
      '底层已经逐条交付完整消息，而你需要第一版分帧契约时，使用此入口。`messageFramer.frame` 将输入作为唯一一帧返回，`messageFramer.accept` 将输入作为完整消息返回。\n\n根入口不导出 `messageFramer`，因此从此带版本的子路径导入。它不拆分大消息，也不从连续字节流中恢复消息边界。'
    ),
    example: 'const frames = messageFramer.frame(message, context); messageFramer.close()'
  },
  handshake: {
    summary: t(
      'Use this entry to agree on a protocol version, data format and shared capabilities before exchanging RPC messages. `createRpcHello` creates the initiator’s opening message; `acceptRpcHandshake` selects compatible settings and creates the reply.\n\nThe initiator then validates that reply with `completeRpcHandshake`. These functions also exist at the root; this subpath groups the negotiation tools, while the connection owner remains responsible for checking credentials.',
      '交换远程调用消息前，需要先约定协议版本、数据格式和共同支持的能力，可使用此入口。`createRpcHello` 生成发起方的开场消息，`acceptRpcHandshake` 选择双方兼容的设置并生成回复。\n\n发起方随后用 `completeRpcHandshake` 校验回复。根入口也提供这些函数；此子路径集中提供协商工具，凭据校验仍由连接的管理方负责。'
    ),
    example: handshakeExample
  },
  portable: {
    summary: t(
      'Use this entry to convert application data into the restricted values accepted by the portable RPC format. `normalizePortable` copies supported records and arrays, freezes the resulting data, and converts byte views to tagged data.\n\nThe root also exports this function; import this subpath when your task is data normalization alone. It does not validate a complete RPC message or accept arbitrary class instances.',
      '需要把业务数据转换为可通过远程调用传递的受限数据格式时，使用此入口。`normalizePortable` 复制支持的对象与数组、冻结结果，并把字节视图转换为带标记的数据。\n\n根入口也导出这个函数；只处理数据规范化时，可直接从此子路径导入。它不校验完整远程调用消息，也不接受任意类实例。'
    ),
    example: 'const value = normalizePortable({ count: 1 })'
  },
  runtime: {
    summary: t(
      'Use this entry to check the message structures used by Peer calls, replies and control messages. `normalizeRuntimeEnvelope` validates an unknown message without executing property getters; `normalizeRuntimeGeneration` checks the identifiers that distinguish call generations.\n\nImport this subpath for runtime message validation, which the root does not expose as a complete API. Constructing an outgoing call belongs to `runtime/metadata`; this module does not open a connection.',
      '需要检查对端调用、回复和控制消息的结构时，使用此入口。`normalizeRuntimeEnvelope` 校验未知消息而不执行属性读取器，`normalizeRuntimeGeneration` 校验用于区分不同轮次调用的标识。\n\n根入口不提供完整的运行消息校验接口，因此从此子路径导入。构造出站调用请使用 `runtime/metadata`；本模块不建立连接。'
    ),
    example: 'const envelope = normalizeRuntimeEnvelope(candidate)'
  },
  'runtime/lazy': {
    summary: t(
      'Use this entry when a receiver should load runtime and stream parsers only when a message needs them. `normalizeRuntimeEnvelope` checks a runtime message, while `normalizeStreamPayload` checks the data describing a stream event.\n\nImport this subpath to select deferred parsing instead of the eager `runtime` entry or the general root. A call may return a value or a Promise, so use `await` when consuming the result.',
      '希望接收方等到消息需要时才加载运行消息与流消息的解析器，可使用此入口。`normalizeRuntimeEnvelope` 检查运行消息，`normalizeStreamPayload` 检查描述流事件的数据。\n\n与普通 `runtime` 入口及通用根入口相比，此子路径明确选择按需加载。调用可能直接返回结果，也可能返回异步结果，使用 `await` 统一接收。'
    ),
    example: 'const envelope = await normalizeRuntimeEnvelope(candidate)'
  },
  'runtime/metadata': {
    summary: t(
      'Use this entry when building an outgoing runtime call from a route and task header your code already owns. `createRuntimeCallEnvelope` checks that header and normalizes the payload before returning the call message.\n\nImport this subpath because the constructor is not exported by the root or `runtime`. To validate an unknown incoming message instead, use `normalizeRuntimeEnvelope` from `runtime`.',
      '已有由本方管理的路由与任务头，需要构造出站运行调用时，使用此入口。`createRuntimeCallEnvelope` 检查头部并规范化业务数据，再返回调用消息。\n\n根入口与 `runtime` 都不导出这个构造函数，因此从此子路径导入。若要检查来源未知的入站消息，应使用 `runtime` 的 `normalizeRuntimeEnvelope`。'
    ),
    example: 'const envelope = createRuntimeCallEnvelope(header, { count: 1 })'
  },
  'schema/wire-error': {
    summary: t(
      'Use this entry when configuring a JSON Schema validator for serialized RPC errors. JSON Schema describes expected fields and shapes; this subpath exports the schema document itself rather than a function from the root.\n\nLoad the document into your validator to start checking structure. For the package’s full checks, use `normalizeRpcSerializedError` from `errors`: the schema alone does not enforce every size, byte-encoding and text-validity rule.',
      '需要为序列化后的远程调用错误配置结构校验器时，使用此入口。这里发布的数据模式描述预期字段与形状；此子路径导出的是模式文档，而不是根入口中的函数。\n\n将文档交给校验器即可开始检查结构。若要执行本包的完整检查，使用 `errors` 的 `normalizeRpcSerializedError`；模式本身没有落实全部大小、字节编码和文本有效性规则。'
    )
  },
  stream: {
    summary: t(
      'Use this entry when implementing an RPC stream and checking the events exchanged by its producer and consumer. `normalizeStreamPayload` validates one event’s data; `checkRpcStreamSequence` checks whether its sequence number follows the caller’s current state.\n\nThe root exports the normalizer, but this subpath also provides sequence and flow-control checks. The checks return violations for the caller to handle; they do not read a byte stream or schedule delivery.',
      '实现远程调用流式调用，需要检查生产方与消费方交换的事件时，使用此入口。`normalizeStreamPayload` 校验一条事件的数据，`checkRpcStreamSequence` 根据调用方持有的当前状态检查序号是否连续。\n\n根入口提供规范化函数，此子路径还提供序号与发送额度检查。检查函数返回违规结果，由调用方处理；这里不读取字节流，也不调度交付。'
    ),
    example:
      'const payload = normalizeStreamPayload({ event: "open", seq: 0 }); console.log(checkRpcStreamInitialSequence(payload))'
  },
  v1: {
    summary: t(
      'Use this entry when handling the version-one request, response, discovery, control and stream message format. `normalizeRpcEnvelope` validates an incoming message; `rpcProtocol.normalize` exposes the same operation through a protocol descriptor.\n\nThe root re-exports these as `normalizeRpcEnvelope` and `rpcProtocolV1`; this subpath makes the chosen version explicit. Peer runtime call messages use the separate `runtime` contract.',
      '处理第一版请求、响应、发现、控制与流消息格式时，使用此入口。`normalizeRpcEnvelope` 校验入站消息，`rpcProtocol.normalize` 则通过协议描述对象提供同一操作。\n\n根入口以 `normalizeRpcEnvelope` 和 `rpcProtocolV1` 导出这些能力；此子路径让所选版本更明确。对端 的运行调用消息使用独立的 `runtime` 契约。'
    ),
    example: 'const envelope = normalizeRpcEnvelope(decoded)'
  },
  wire: {
    summary: t(
      'Use this entry when writing a compatible peer that needs the protocol’s public field names, message kinds and limits. Start with `RpcEnvelopeKind` to identify message categories and `RpcWireLimit` to read the shared size limits.\n\nThe root includes common constants; this subpath groups the broader wire vocabulary and data types. Constants describe the format but do not validate an incoming message or establish a connection.',
      '编写兼容对端，需要协议公开的字段名、消息种类和上限时，使用此入口。先用 `RpcEnvelopeKind` 查看消息分类，用 `RpcWireLimit` 读取共同遵守的大小限制。\n\n根入口包含常用常量，此子路径集中提供更完整的传输格式常量与数据类型。常量只描述格式，不校验入站消息，也不建立连接。'
    ),
    example: 'console.log(RpcEnvelopeKind.request, RpcWireLimit.maxHandshakeBytes)'
  }
}
/** Complete package reference with all canonical entry orientations. */
export const reference: ILibraryReference = { modules, symbols, types, enums, enhancers: {} }
