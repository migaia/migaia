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

const rpcErrorModuleGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
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
  })
}

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

const rpcErrorCatalogGuides = {
  contract: errorIdentityGuide({
    importPath: '@migaia/rpc-contract/errors',
    source: 'RPC_CONTRACT_SOURCE',
    codeTable: 'RpcContractErrorCode',
    member: 'frameLimitExceeded',
    purposeEn:
      'Identifies Contract protocol violations with the unchanged rpc.contract source and public code table. A frame quota diagnostic does not itself alter the carrier or replay state.',
    purposeZh:
      '用不变的 rpc.contract source 与公开 code 表识别 Contract 协议违例。frame 配额诊断本身不改变载体或 replay 状态。',
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
    importPath: '@migaia/rpc-host',
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
    importPath: '@migaia/rpc-host/plugin',
    source: 'RPC_REMOTE_ERROR_SOURCE',
    codeTable: 'RpcRemoteLayerErrorCode',
    member: 'resultUnknown',
    purposeEn:
      'Identifies Remote layer failures with the stable rpc.remote source. REMOTE_RESULT_UNKNOWN reports a lost result rather than proof that a non-idempotent method did not execute.',
    purposeZh:
      '用稳定的 rpc.remote source 识别 Remote 层失败。REMOTE_RESULT_UNKNOWN 表示结果丢失，不证明非幂等方法没有执行。',
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
    importPath: '@migaia/rpc-plugin-process',
    source: 'RPC_PROCESS_ERROR_SOURCE',
    codeTable: 'RpcProcessErrorCode',
    member: 'usageSampleFailed',
    purposeEn:
      'Identifies actual Process launch, connection, lifecycle and sampling failures with the stable rpc.transport.process source. Native details remain reachable through the original cause.',
    purposeZh:
      '用稳定的 rpc.transport.process source 识别实际 Process 启动、连接、生命周期与采样失败。原生详情沿原 cause 保持可达。',
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
    importPath: '@migaia/rpc-plugin-thread',
    source: 'RPC_THREAD_ERROR_SOURCE',
    codeTable: 'RpcThreadErrorCode',
    member: 'usageSampleFailed',
    purposeEn:
      'Identifies the native Worker sampling failure with the stable rpc.transport.thread source and THREAD_USAGE_SAMPLE_FAILED code. This diagnostic grants no Worker stop or replacement authority.',
    purposeZh:
      '用稳定的 rpc.transport.thread source 与 THREAD_USAGE_SAMPLE_FAILED code 识别原生 Worker 采样失败。此诊断不授予 Worker stop 或 replacement 权限。',
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
      'Identifies framing, profile, extension and hello-deadline failures with the stable rpc.contract.jsonrpc source. The JSON-RPC integer code policy remains with the foreign peer profile.',
    purposeZh:
      '用稳定的 rpc.contract.jsonrpc source 识别 framing、profile、扩展与 hello deadline 失败。JSON-RPC 整数 code 策略仍归外部 peer profile。',
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

const rpcProtocolGuideContexts = {
  binary: {
    quickStart:
      "import { prepareRpcBinary, restoreRpcBinary, RpcBinaryStorage } from '@migaia/rpc-contract/binary/lazy'\nimport type { IRpcRuntimeEnvelope } from '@migaia/rpc-contract/runtime'\n\n/** Prepare the actual outgoing snapshot at the application's existing capture point. */\nexport async function prepareOutgoing(envelope: IRpcRuntimeEnvelope) {\n  return await prepareRpcBinary(envelope, RpcBinaryStorage.inline, 1_048_576)\n}\n\n/** Restore the received manifest at the receiver's existing asynchronous stage. */\nexport async function restoreIncoming(manifest: unknown) {\n  return await restoreRpcBinary(manifest, RpcBinaryStorage.inline, [])\n}\n// The carrier sends the returned manifest and sidecars.\n// Native storage additionally needs the authentication owner's whole-backing digest.",
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
      "import { RpcCodecId, RpcPeerRuntime, RpcProtocol } from '@migaia/rpc-contract'\nimport { acceptRpcHandshake, completeRpcHandshake, createRpcHello, normalizeRpcHandshake } from '@migaia/rpc-contract'\n\nconst client = {\n  peer: { id: 'client', runtime: RpcPeerRuntime.node },\n  versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],\n  codecs: [RpcCodecId.json], capabilities: []\n}\nconst service = { ...client, peer: { id: 'service', runtime: RpcPeerRuntime.node } }\nconst hello = createRpcHello(client)\nconst received = normalizeRpcHandshake(hello)\nconst acceptance = acceptRpcHandshake(service, hello)\nif (!acceptance.ok) throw acceptance.error\nconst agreement = completeRpcHandshake(client, acceptance.reply)\nconsole.log(received.step, agreement.codec)\n// These are protocol proposals and negotiated data. The real carrier still owns authentication.",
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
  'rpc-contract:index:acceptRpcHandshake': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      "Negotiates common protocol version, codec and capabilities from the responder's actual offer and received hello. It returns an acceptance reply/agreement or a rejection reply/original error without retaining the received input in diagnostics.",
    purposeZh:
      '按 responder 的实际 offer 与收到的 hello 协商共同协议版本、codec 和 capabilities，返回 acceptance reply/agreement 或 rejection reply/原错误。诊断不保留收到的输入；仍需实际载体鉴权。'
  }),
  'rpc-contract:index:completeRpcHandshake': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      "Verifies a responder's actual reply against the initiator's retained local offer and returns the negotiated agreement. Unsupported choices reject at the canonical Contract boundary without creating channel or execution authority.",
    purposeZh:
      '按 initiator 保留的本地 offer 验证 responder 实际 reply，返回协商 agreement。无法接受的选择在规范 Contract 边界拒绝，不因此创建通道或执行权限。'
  }),
  'rpc-contract:index:createRpcHello': guide({
    ...rpcProtocolGuideContexts.handshakeData,
    purposeEn:
      "Encodes the initiator's local protocol offer into the first-channel UTF-8 JSON hello text. Invalid offers preserve the bounded redacted failure policy instead of retaining the caller's original token or data subtree.",
    purposeZh:
      '把 initiator 本地协议 offer 编码为首通道 UTF-8 JSON hello 文本。非法 offer 保留有界脱敏失败策略，不保留调用者原 token 或数据子树；返回文本供实际载体发送。'
  }),
  'rpc-contract:index:normalizeRpcHandshake': guide({
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

const rpcAdapterGuideContexts = {
  object: {
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
  message: {
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
  errors: {
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
  }
}

const rpcAdapterGuides = {
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

function probeValueGuide(input: {
  readonly name: string
  readonly expression: string
  readonly purposeEn: string
  readonly purposeZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: input.purposeEn,
    purposeZh: input.purposeZh,
    quickStart: `import { ${input.name} } from '@migaia/rpc-host/probe'\n\nconsole.log(${input.expression})`,
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

const rpcProbeGuides = {
  'rpc-host:probe:readProbeStages': guide({
    purposeEn:
      "Reads the genuine Probe's current effective numeric mask after setStages, including frozen host-form handles whose public stageMask remains initial. This cold control reader adds no business-path work.",
    purposeZh:
      '读取真正 Probe 经 setStages 更新后的有效数值 mask，包含公开 stageMask 保留初值的冻结 host handle；该冷控制读取不增加业务路径工作。',
    quickStart: `import { defineProbe, readProbeStages } from '@migaia/rpc-host/probe'

/** Cold control inspects actual private selection. */
const probe = defineProbe({ stages: ['message'], emit() {} }, {})
probe.setStages(['message', 'carrier'])
console.log(readProbeStages(probe))`,
    useEn: [
      'Read actual stage selection before pause or another explicit control operation.',
      'Inspect a host-form handle without treating its frozen initial field as current state.'
    ],
    useZh: [
      '在暂停或其它显式控制操作之前读取当前阶段选择。',
      '检查 host handle 时不把被冻结的初始公开字段当作当前状态。'
    ],
    avoidEn: [
      'Using this cold metadata contract as a new business-path validator.',
      'Assuming diagnostic metadata replaces the original resource or error owner.'
    ],
    avoidZh: [
      '把冷元数据契约作为新的业务路径验证器。',
      '把诊断元数据当作原资源或错误 owner 的替代物。'
    ]
  }),
  'rpc-host:probe:subscribeProbeStages': guide({
    purposeEn:
      'Subscribes to actual stage-mask changes at the canonical Probe owner. Each effective change notifies once; the original disposer is idempotent and does not add a per-message callback.',
    purposeZh:
      '在规范 Probe owner 订阅实际阶段 mask 变更；每次有效变更通知一次，原释放函数可重复调用，不添加逐消息 callback。',
    quickStart: `import { defineProbe, subscribeProbeStages, readProbeStages } from '@migaia/rpc-host/probe'

/** One cold subscription follows control changes. */
const probe = defineProbe({ stages: ['message'], emit() {} })
const release = subscribeProbeStages(probe, () => console.log(readProbeStages(probe)))
probe.setStages(['message', 'frame'])
release()`,
    useEn: [
      'Keep a collector control mask synchronized after genuine setStages changes.',
      'Release a cold listener when its application-owned controller ends.'
    ],
    useZh: [
      '在真正 setStages 变更后同步 collector 的控制 mask。',
      '应用自己拥有的控制器结束时释放冷监听器。'
    ],
    avoidEn: [
      'Using this cold metadata contract as a new business-path validator.',
      'Assuming diagnostic metadata replaces the original resource or error owner.'
    ],
    avoidZh: [
      '把冷元数据契约作为新的业务路径验证器。',
      '把诊断元数据当作原资源或错误 owner 的替代物。'
    ]
  }),
  'rpc-host:probe:hostRethrowReporter': guide({
    purposeEn:
      'Re-exports the existing utils promise host reporter so diagnostic failures retain their original owner rather than acquiring a duplicate rethrow bridge. Reporting does not create a devtools transport.',
    purposeZh:
      '重导出 utils promise 的既有宿主 reporter，使诊断失败保留原 owner，不另建重复 rethrow bridge；reporter 不创建 devtools transport。',
    quickStart: `import { hostRethrowReporter, IpcReporterContext } from '@migaia/rpc-host/probe'

/** Use only at an existing error reporting boundary. */
export function reportDiagnostic(error: unknown) {
  hostRethrowReporter(error, IpcReporterContext)
}`,
    useEn: [
      'Report a diagnostic callback failure through the existing host boundary.',
      'Reuse the canonical reporter when an application reporter cannot handle its own error.'
    ],
    useZh: [
      '通过既有宿主边界报告诊断 callback 的失败。',
      '应用 reporter 自身不能处理错误时复用规范宿主 reporter。'
    ],
    avoidEn: [
      'Using this cold metadata contract as a new business-path validator.',
      'Assuming diagnostic metadata replaces the original resource or error owner.'
    ],
    avoidZh: [
      '把冷元数据契约作为新的业务路径验证器。',
      '把诊断元数据当作原资源或错误 owner 的替代物。'
    ]
  }),
  'rpc-host:probe:IpcReporterContext': guide({
    purposeEn:
      'Re-exports the package-owned IPC reporter context used by the canonical host reporter. Consumers pass this existing value instead of constructing divergent diagnostic source metadata.',
    purposeZh:
      '重导出包内维护的 IPC reporter context，供规范宿主 reporter 使用；消费者交入这个既有值，避免各自构造不一致的诊断来源元数据。',
    quickStart: `import { IpcReporterContext } from '@migaia/rpc-host/probe'

console.log(IpcReporterContext)`,
    useEn: [
      'Pass the existing IPC context to the canonical host error reporter.',
      "Keep collector fallback reporting aligned with Core's current source ownership."
    ],
    useZh: [
      '把既有 IPC context 交给规范宿主错误 reporter。',
      '使 collector 的 fallback 报告与 Core 的来源所有权保持一致。'
    ],
    avoidEn: [
      'Using this cold metadata contract as a new business-path validator.',
      'Assuming diagnostic metadata replaces the original resource or error owner.'
    ],
    avoidZh: [
      '把冷元数据契约作为新的业务路径验证器。',
      '把诊断元数据当作原资源或错误 owner 的替代物。'
    ]
  }),
  'rpc-host:probe:RpcProbeStage': probeValueGuide({
    name: 'RpcProbeStage',
    expression: 'RpcProbeStage.message',
    purposeEn:
      'Defines the seven fixed numeric observation stages from peer through carrier. Use the values for mask bits; content capture is separately opt-in, including the protected stage.',
    purposeZh:
      '定义从 peer 到 carrier 的七个固定数值观察阶段，用于计算阶段掩码；内容捕获独立按阶段显式启用，protected 阶段也遵守该规则。'
  }),
  'rpc-host:probe:RpcProbeStageName': probeValueGuide({
    name: 'RpcProbeStageName',
    expression: 'RpcProbeStageName[1]',
    purposeEn:
      'Maps the fixed numeric stage index to its public name in the same order as RpcProbeStage. This table belongs at diagnostics and service boundaries rather than in Core event dispatch.',
    purposeZh:
      '按与 RpcProbeStage 相同的顺序，把固定数值阶段转换为公开名称；名称表用于诊断与 service 出口，Core 事件分发继续读取数值。'
  }),
  'rpc-host:probe:RpcProbeDirection': probeValueGuide({
    name: 'RpcProbeDirection',
    expression: 'RpcProbeDirection.outbound',
    purposeEn:
      'Defines the fixed outbound, inbound and local numeric directions of a Probe event. Direction records the observed side and does not infer an unseen remote event.',
    purposeZh:
      '定义 Probe 事件的 outbound、inbound 与 local 固定数值方向；方向描述实际观察到的一侧，不推断尚未观察到的远端事件。'
  }),
  'rpc-host:probe:RpcProbeDirectionName': probeValueGuide({
    name: 'RpcProbeDirectionName',
    expression: 'RpcProbeDirectionName[0]',
    purposeEn:
      'Converts a Probe direction index to its maintained outbound, inbound or local name. Preserve this order when producing a string event at a diagnostic or service boundary.',
    purposeZh:
      '把 Probe 方向索引转换为统一维护的 outbound、inbound 或 local 名称；诊断与 service 出口生成字符串事件时保持该固定顺序。'
  }),
  'rpc-host:probe:RpcProbeKind': probeValueGuide({
    name: 'RpcProbeKind',
    expression: 'RpcProbeKind.request',
    purposeEn:
      'Defines fixed numeric kinds for requests, responses, notifications, stream events, cancellation, control and lifecycle. A kind describes an observation and does not issue a business operation.',
    purposeZh:
      '定义请求、响应、通知、流事件、取消、控制与生命周期的固定数值种类；kind 只描述实际观察事件，读取它不会发起业务操作。'
  }),
  'rpc-host:probe:RpcProbeKindName': probeValueGuide({
    name: 'RpcProbeKindName',
    expression: 'RpcProbeKindName[0]',
    purposeEn:
      'Maps each Probe kind index to the stable request, response, stream or lifecycle name. Convert only at the consumer boundary so event dispatch can retain small integers.',
    purposeZh:
      '把每个 Probe kind 索引映射为固定的请求、响应、流或生命周期名称；只在消费者出口转换，事件分发继续使用小整数。'
  }),
  'rpc-host:probe:RpcProbeOutcome': probeValueGuide({
    name: 'RpcProbeOutcome',
    expression: 'RpcProbeOutcome.settled',
    purposeEn:
      'Defines the fixed numeric progress and terminal outcomes attached to observed events. An outcome is event metadata and never replaces the original RPC result or failure.',
    purposeZh:
      '定义观察事件携带的固定数值进展与终态结果；outcome 是事件元数据，不会替换原 RPC 返回值、错误身份或失败处理语义。'
  }),
  'rpc-host:probe:RpcProbeOutcomeName': probeValueGuide({
    name: 'RpcProbeOutcomeName',
    expression: 'RpcProbeOutcomeName[6]',
    purposeEn:
      'Converts an observed Probe outcome index into its stable public name. Keep the table aligned with RpcProbeOutcome when formatting service events and recordings.',
    purposeZh:
      '把实际观察到的 Probe outcome 索引转换为固定公开名称；生成 service 事件与录制数据时，名称表与 RpcProbeOutcome 始终保持对应。'
  }),
  'rpc-host:probe:defineProbe': guide({
    purposeEn:
      'Validates and compiles Probe options. The optional host receives Probe fields and private registration, is frozen and returns unchanged by identity; no host copy is made. Pass the handle through the Host probe option.',
    purposeZh:
      '验证并编译 Probe 配置；可选 host 直接接收 Probe 字段与私有注册，随后冻结并返回同一引用，不复制 host。把 handle 交给 Host 的 probe 选项。',
    quickStart: `import { defineProbe, RpcProbeStageName } from '@migaia/rpc-host/probe'

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
      'Use explicit capture and redaction; detail, error and untransferred content retain references.',
      'Read IRpcProbeEventView.variation on message/envelope controls: abort keeps kind cancel, other variations use control, and request/response or other stages leave it undefined.'
    ],
    useZh: [
      '把 Probe 附到可扩展且未冻结的已有对象，保留原有成员与对象身份。',
      '显式配置 capture/redact；detail、error 与未转移的 content 保留引用。',
      '从 message/envelope 的 IRpcProbeEventView.variation 读取 control subtype；abort 的 kind 为 cancel，其余 variation 为 control，request/response 与其它阶段为 undefined。'
    ],
    avoidEn: [
      'Retaining a reusable view after emit returns without copying the required fields inside emit; copies are shallow and nested content stays application-owned.',
      'Applying methods to frame-level events or expecting it to remove methodless variations: it filters only method-bearing message/envelope events; other stages use sampling.'
    ],
    avoidZh: [
      '在 emit 返回后直接保留复用 view，而没有在回调内复制需要保留的字段；浅复制不转移嵌套内容的所有权。',
      '把 methods 过滤应用到帧层或期望它删除没有 method 的 variation：它只过滤携带 method 的 message/envelope，其它阶段只受采样控制。'
    ]
  }),

  'rpc-host:probe:rpcProbeSampleKey': guide({
    purposeEn:
      'Returns the FNV-1a 32-bit key over UTF-8 senderId plus messageId. Both observed sides use the same identifiers to reach a deterministic sampling decision without shared state.',
    purposeZh:
      '对 UTF-8 的 senderId 与 messageId 拼接计算 FNV-1a 32 位键；两侧使用相同标识，在没有共享状态时也能得到一致的确定性采样决定。',
    quickStart: `import { rpcProbeSampleKey } from '@migaia/rpc-host/probe'

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
  })
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

const rpcDevtoolsErrorGuide = guide({
  purposeEn:
    'Provides the canonical rpc.devtools source and seven semantic error codes shared by the collector, portable service and record conversion. Configuration, lifecycle and conversion failures keep their registered identity and original cause.',
  purposeZh:
    '提供 collector、portable service 与录制转换共用的 rpc.devtools source 和七个语义错误码；配置、生命周期与转换失败保留注册身份与原 cause。',
  quickStart: `import { RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools'

console.log(RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode)`,
  useEn: [
    'Branch on source and code when decoding a record, configuring the collector or converting a service result.',
    'Keep the original parse, validation or runtime failure reachable through cause.'
  ],
  useZh: [
    '解码录制数据、配置 collector 或转换 service 结果失败时，按 source 与 code 进行分支。',
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

const rpcDevtoolsGuides = {
  'rpc-plugin-devtools:index:RpcDevtoolsErrorCode': rpcDevtoolsErrorGuide,
  'rpc-plugin-devtools:index:RPC_DEVTOOLS_SOURCE': rpcDevtoolsErrorGuide
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

/** Maintained guides use the host, transport plugins, features, and retained author contracts. */
/** One actual feature definition shares the same bilingual guide at every import spelling. */
const authFeatureGuide = guide({
  purposeEn:
    'Installs the supplied signing and verification policy on the same host as its transport. Both sides must agree on credentials before business calls are admitted; encryption, when configured, uses that same authenticated connection. Closing the host removes its subscriptions without taking ownership of the application key store.',
  purposeZh:
    '将签名、验证及可选加密配置安装到实际业务 host，与原传输共用同一条连接。双方应使用相互匹配的凭据，认证通过后才接受业务调用；能力标签不能代替签名验证。配置由应用提供，host 关闭时释放自身订阅，不接管密钥仓库的生命周期，也不替应用轮换密钥。',
  quickStart:
    "import { createRpcHost, type IRpcAuthenticationConfig } from '@migaia/rpc-host'\nimport { authFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\n// The remote provider uses matching signing and verification credentials.\nexport async function readAuthenticatedBalance(\n  transport: IRpcTransportPlugin,\n  credentials: IRpcAuthenticationConfig\n) {\n  const host = await createRpcHost<{ balance(account: string): number }>({\n    plugins: [transport, authFeature(credentials)]\n  })\n  try {\n    return await host.request('balance', 'account-42')\n  } finally {\n    await host.close()\n  }\n}",
  useEn: [
    'Authenticate an account query before it reaches its provider.',
    'Keep application-owned keys separate from the lifetime of one RPC host.'
  ],
  useZh: ['在账户查询进入 provider 前完成认证。', '让应用密钥的持有期独立于单个 RPC host。'],
  avoidEn: [
    'The peer cannot implement the configured signing or encryption profile.',
    'A copied capability label is being treated as proof of authentication.'
  ],
  avoidZh: ['对端没有实现配置的签名或加密方案。', '试图把复制的能力标签当成已经认证的证明。']
})

/** One actual feature definition shares the same bilingual guide at every import spelling. */
const chunkFeatureGuide = guide({
  purposeEn:
    'Installs the existing fragmentation and reassembly policy beside one transport. Large reports still use the host request API and its negotiated limits, correlation, cancellation and error paths. Install the compatible feature on the receiving host; it does not create a second transport, queue or endpoint.',
  purposeZh:
    '在一个传输旁安装既有分块与重组能力，让较大的报表继续通过普通 request 发送。分块保留原调用关联、取消和错误路径，仍受双方协商后的限制；接收端也应安装相容功能。它没有旧组合工厂的依赖参数，不会另外创建传输、队列或第二个 endpoint，也不授予未协商的二进制权限。',
  quickStart:
    "import { createRpcHost } from '@migaia/rpc-host'\nimport { chunkFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\n// Install chunkFeature() on the receiving host as well; its provider exposes echo.\nexport async function echoLargeReport(transport: IRpcTransportPlugin) {\n  const host = await createRpcHost<{ echo(report: string): string }>({\n    plugins: [transport, chunkFeature()]\n  })\n  try {\n    const report = 'order,total\\n'.repeat(32768)\n    return await host.request('echo', report)\n  } finally {\n    await host.close()\n  }\n}",
  useEn: [
    'Send a large text report over an already selected transport.',
    'Retain ordinary request cancellation and errors while the payload is reassembled.'
  ],
  useZh: [
    '通过已经选定的传输发送较大的文本报表。',
    '在重组 payload 时继续使用普通请求的取消和错误处理。'
  ],
  avoidEn: [
    'The payload already fits the carrier and no fragmentation is needed.',
    'The caller intends to bypass negotiated frame or payload limits.'
  ],
  avoidZh: ['数据已经适合载体，不需要额外分块。', '调用方想绕过已经协商的帧或 payload 限制。']
})

/** One actual feature definition shares the same bilingual guide at every import spelling. */
const retryFeatureGuide = guide({
  purposeEn:
    'Uses the existing generation-aware retry policy after an actual supervised connection replacement. The accepted provider declaration decides whether a method is idempotent. A lost non-idempotent result remains uncertain, and caller cancellation or its deadline still ends the logical call instead of permitting unlimited replay.',
  purposeZh:
    '连接由原 supervisor 换代后，选择既有的感知代次重试策略。方法是否幂等来自已经接受的 provider 声明，不能由调用方随意猜测；非幂等调用丢失结果仍需业务对账。原调用的取消、deadline 和 cause 继续有效，安装该功能不会另外启动监督器、复制计时器，或允许无限重放。',
  quickStart:
    "import { createRpcHost } from '@migaia/rpc-host'\nimport { retryFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\n// readBalance is declared idempotent in the remote provider contract.\n// The transport already owns supervision and replacement generations.\nexport async function readRecoverableBalance(transport: IRpcTransportPlugin) {\n  const host = await createRpcHost<{ readBalance(account: string): number }>({\n    plugins: [transport, retryFeature()]\n  })\n  try {\n    return await host.request('readBalance', 'account-42', { timeoutMs: 5000 })\n  } finally {\n    await host.close()\n  }\n}",
  useEn: [
    'Read an idempotent account projection across a supervised restart.',
    'Keep one logical key while the original retry owner waits for a replacement generation.'
  ],
  useZh: ['跨受监督重启读取幂等的账户投影。', '等待后继代时保留原重试所有者维护的同一个逻辑 key。'],
  avoidEn: [
    'A payment or other non-idempotent operation has an unknown outcome.',
    'The transport has no supported supervised replacement path.'
  ],
  avoidZh: ['支付等非幂等操作的结果已经未知。', '传输没有受支持的监督换代路径。']
})

/** One actual feature definition shares the same bilingual guide at every import spelling. */
const timeoutFeatureGuide = guide({
  purposeEn:
    'Sets the host call default through the existing timeout policy. A call timeoutMs overrides host defaultTimeoutMs, which overrides this feature; connect.timeoutMs remains the independent handshake budget. A deadline ends the caller wait and sends normal cancellation, but cannot undo business effects that already occurred remotely.',
  purposeZh:
    '通过原超时策略设置调用默认期限。单次调用的 timeoutMs 优先于 host 的 defaultTimeoutMs，随后才使用本功能；connect.timeoutMs 仍是独立的握手预算。deadline 会结束调用方等待并沿原路径发送取消，不会回滚远端已经发生的业务副作用。应用应保留原错误及 cause，并在 finally 中等待 host 关闭。',
  quickStart:
    "import { createRpcHost, isRpcTimeoutError } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function loadMonthlyReport(transport: IRpcTransportPlugin) {\n  const host = await createRpcHost<{ loadReport(month: string): string }>({\n    plugins: [transport, timeoutFeature({ ms: 1500 })]\n  })\n  try {\n    // This one call overrides the feature default; handshake timeout is separate.\n    return await host.request('loadReport', '2026-10', { timeoutMs: 750 })\n  } catch (error) {\n    if (isRpcTimeoutError(error)) console.error('report deadline exceeded', error)\n    throw error\n  } finally {\n    await host.close()\n  }\n}",
  useEn: [
    'Give report queries a default deadline with a shorter per-call override.',
    'Distinguish connection preparation time from a running business operation.'
  ],
  useZh: ['为报表查询配置默认期限，并单独缩短某次调用。', '区分连接准备时间与已经执行的业务操作。'],
  avoidEn: [
    'The goal is to force termination of an uncooperative remote process.',
    'A connection handshake budget is required instead of a call timeout.'
  ],
  avoidZh: ['目标是强制终止不配合取消的远端进程。', '需要限制的是握手时间，而不是业务调用时间。']
})

/** One actual feature definition shares the same bilingual guide at every import spelling. */
const typegenFeatureGuide = guide({
  purposeEn:
    'Writes client declarations from the exact accepted provider directory and its input, output and yield schemas. The peer language does not matter. A replacement handshake refreshes output, while host closure unsubscribes future writes. The application supplies the output capability and owns any persistence, compilation and import of the produced files.',
  purposeZh:
    '从已经接受的 provider 目录及其 input、output、yield schema 生成客户端声明，不区分对端实现语言。后继代握手时更新内容，关闭 host 后退订，不再写入。应用显式提供输出能力，并负责保存、编译和导入生成文件；目录中的名称不会直接成为任意输出路径，也不会作为可执行代码运行。',
  quickStart:
    "import { createRpcHost } from '@migaia/rpc-host'\nimport { typegenFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function readGeneratedClient(transport: IRpcTransportPlugin) {\n  const declarations = new Map<string, string>()\n  const host = await createRpcHost<{ ping(): boolean }>({\n    plugins: [transport, typegenFeature({\n      out: { write(fileName, text) { declarations.set(fileName, text) } }\n    })]\n  })\n  try {\n    console.log(await host.request('ping'))\n    return Object.fromEntries(declarations)\n  } finally {\n    // Removes directory subscriptions; the application owns the saved output.\n    await host.close()\n  }\n}",
  useEn: [
    'Generate a typed client from a foreign-language service directory.',
    'Refresh saved declarations when a replacement peer advertises a new schema.'
  ],
  useZh: ['根据外语言服务的目录生成类型化客户端。', '后继对端公布新 schema 时刷新已保存声明。'],
  avoidEn: [
    'The peer publishes no schemas and unknown types are insufficient for the application.',
    'The application expects the feature to choose arbitrary filesystem paths or compile output.'
  ],
  avoidZh: [
    '对端没有 schema，而 unknown 类型不能满足应用需求。',
    '期望该功能自行选择任意文件系统路径或编译输出。'
  ]
})

/** Root and author SDK re-export the same default reporter. */
const rpcDefaultReporterGuide = guide({
  purposeEn:
    'Writes an observed background RPC failure to the host console through the same fallback used by RPC adapters. It reports the supplied value unchanged and leaves cancellation, retries and endpoint shutdown with their existing owners.',
  purposeZh:
    '将已经观察到的 RPC 后台失败交给宿主控制台，与 RPC 适配器未配置 report 时使用的默认出口一致。它原样报告收到的值，取消、重试和 endpoint 关闭仍由各自已有的所有者处理。',
  quickStart: `import { defaultRpcReporter } from '@migaia/rpc-host'

/** Reports a failure already observed by an application-owned background task. */
function reportBackgroundFailure(error: unknown): void {
  defaultRpcReporter(error)
}`,
  useEn: [
    'An application-owned background task should use the same console fallback as its RPC adapters.',
    'A custom reporter needs to delegate an already redacted failure to the default host console sink.'
  ],
  useZh: [
    '应用自有后台任务需要与 RPC 适配器使用同一个默认控制台诊断出口。',
    '自定义 reporter 已完成敏感信息脱敏，需要将失败转交默认宿主控制台。'
  ],
  avoidEn: [
    'Diagnostics require durable storage, structured redaction or routing to an application telemetry service.',
    'The caller needs to reject an operation or restart an endpoint; reporting alone performs neither action.'
  ],
  avoidZh: [
    '诊断需要持久化、结构化脱敏或发送到应用自己的遥测服务，应注入专用 report。',
    '调用方需要拒绝操作或重启 endpoint 时，报告函数不会代替这些生命周期动作。'
  ]
})

/** Capacities configure the original process connection gate without creating another queue. */
const processSendQueueGuide = guide({
  purposeEn:
    'Configures data and control capacity on the original process IPC send gate. Explicit fields override matching transport ipc fields; omitted fields keep their original values. No second queue or admission owner is installed.',
  purposeZh:
    '配置原进程 IPC send gate 的数据和控制容量。显式字段覆盖传输 ipc 同名字段，省略字段保留原值；不安装第二队列或准入 owner。',
  quickStart:
    "import { sendQueueFeature } from '@migaia/rpc-plugin-process/features'\nimport individual from '@migaia/rpc-plugin-process/features/send-queue'\nimport { sendQueueFeature as named } from '@migaia/rpc-plugin-process/features/send-queue'\n\nconst capacity = sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 })\nconsole.log(sendQueueFeature === individual, named === individual) // true true\n// Install capacity beside processPlugin in createRpcHost({ plugins: [transport, capacity] }).",
  useEn: [
    'One process connection needs explicit pending data/control limits.',
    'The same process feature works on createRpcHost and an ordinary PluginHost.'
  ],
  useZh: [
    '单条进程连接需要显式待发送数据/控制容量。',
    '同一进程 feature 可用于 createRpcHost 和普通 PluginHost。'
  ],
  avoidEn: [
    'Do not create another gate or queue around the native connection.',
    'Do not install two configured instances of this feature definition on one host.'
  ],
  avoidZh: [
    '不要围绕原生连接再建 gate 或 queue。',
    '同一 host 不要安装该 feature 定义的两个配置实例。'
  ]
})

/** The original IPC log owner invokes this exact captured sink once per physical event. */
const processIpcLogGuide = guide({
  purposeEn:
    'Routes original IPC records to the captured report callback. This feature overrides only the matching ipc.log report field; native connection installation remains the sole log/subscription owner. Synchronous throws and rejected sink Promises follow its existing reporting policy.',
  purposeZh:
    '把原 IPC 记录交给捕获的 report 回调，仅覆盖 ipc.log 对应的 report 字段；原生连接安装仍是唯一日志/订阅 owner。同步抛错和 sink Promise 拒绝沿用原报告策略。',
  quickStart:
    "import { ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport individual from '@migaia/rpc-plugin-process/features/log'\nimport { ipcLogFeature as named } from '@migaia/rpc-plugin-process/features/log'\n\nconst logging = ipcLogFeature({ report(record) { console.log(record) } })\nconsole.log(ipcLogFeature === individual, named === individual) // true true\n// Install logging beside processPlugin; the application owns the sink and its flush.",
  useEn: [
    'An application needs original physical IPC admission and send diagnostics.',
    'A process transport should use one application-owned structured sink.'
  ],
  useZh: ['应用需要原物理 IPC 准入和发送诊断。', '进程传输需要单个应用拥有的结构化日志 sink。'],
  avoidEn: [
    'Do not attach a parallel log feature to the same physical connection.',
    'Do not treat successful logging as business acknowledgement.'
  ],
  avoidZh: ['不要在同一物理连接安装平行日志 feature。', '不能把日志成功当作业务确认。']
})

/** The same native flow-control vocabulary is retained at the process and author entries. */
const processSendClassGuide = guide({
  purposeEn:
    'Reads the original data/control lane vocabulary. These are shared constants, not a flow-control factory; capacity still belongs to the connection gate.',
  purposeZh:
    '读取原 data/control lane 词汇。这是共享常量，不是 flow-control 工厂；容量仍归连接 gate。',
  quickStart:
    "import { IpcSendClass } from '@migaia/rpc-plugin-process/features/flow-control'\nconsole.log(IpcSendClass)",
  useEn: [
    'Interpret an existing physical connection record.',
    'Use canonical named values instead of copying native protocol strings.'
  ],
  useZh: ['解释已有物理连接记录。', '使用规范命名值，不复制原生协议字符串。'],
  avoidEn: [
    'Do not call or mutate this constant object.',
    'Do not infer extra transport authority from its public labels.'
  ],
  avoidZh: ['不要调用或修改该常量对象。', '不能从公开标签推断额外传输权限。']
})

/** The same native flow-control vocabulary is retained at the process and author entries. */
const processLogEventGuide = guide({
  purposeEn:
    'Reads the original IPC log event vocabulary. Selecting an event label neither attaches a sink nor creates a connection or queue.',
  purposeZh: '读取原 IPC 日志事件词汇。选择事件标签不会安装 sink，也不会创建连接或队列。',
  quickStart:
    "import { IpcLogEventName } from '@migaia/rpc-plugin-process/features/flow-control'\nconsole.log(IpcLogEventName)",
  useEn: [
    'Interpret an existing physical connection record.',
    'Use canonical named values instead of copying native protocol strings.'
  ],
  useZh: ['解释已有物理连接记录。', '使用规范命名值，不复制原生协议字符串。'],
  avoidEn: [
    'Do not call or mutate this constant object.',
    'Do not infer extra transport authority from its public labels.'
  ],
  avoidZh: ['不要调用或修改该常量对象。', '不能从公开标签推断额外传输权限。']
})

/** Exact public author operations retain their canonical data and resource owners. */
const rpcPublicAuthorGuides = {
  'rpc-host:plugin:runtimeQuery': guide({
    purposeEn:
      'Wrap a cold snapshot reader in the original query overload/serialization policy, without caching a second runtime view. Original query callable; each invocation reads through the supplied owner and applies the existing format conversion.',
    purposeZh:
      '以原查询重载和序列化策略包装冷快照读取，不缓存第二份运行时视图。返回原查询函数，每次经传入所有者读取并采用既有格式转换。',
    quickStart:
      "import { runtimeQuery } from '@migaia/rpc-host/plugin'\n\nconst orders = new Map<string, { total: number }>()\nconst describeOrders = runtimeQuery(() => ({ count: orders.size }))\norders.set('order-1', { total: 42 })\nconsole.log(await describeOrders())",
    useEn: [
      'A diagnostic owner exposes a fresh count in default or serialized query form.',
      'The input boundary is read. Original query callable; each invocation reads through the supplied owner and applies the existing format conversion.'
    ],
    useZh: [
      '诊断所有者需要以默认或序列化查询形式读取最新数量。',
      '输入边界为 read。返回原查询函数，每次经传入所有者读取并采用既有格式转换。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:resolveAdapterEntry': guide({
    purposeEn:
      'Resolve explicit or self-spawn entries from native-owner snapshots, without inspecting the caller stack or opening a resource. Resolved entry string. Exact URL bytes remain unchanged; unsupported self-spawn or unresolved relative input throws the original configuration error.',
    purposeZh:
      '从原生所有者快照解析显式或自身启动入口，不检查调用栈，也不打开资源。返回解析入口字符串，精确地址字节不变；不支持自身启动或缺少相对基准时抛原配置错误。',
    quickStart:
      "import { resolveAdapterEntry } from '@migaia/rpc-host/plugin'\n\n/** Resolve a launcher input against the native main entry captured by its owner. */\nexport function resolveLaunchEntry(entry: Parameters<typeof resolveAdapterEntry>[0], native: Parameters<typeof resolveAdapterEntry>[1]) {\n  return resolveAdapterEntry(entry, native)\n}",
    useEn: [
      'A launcher resolves an explicit entry using native main-entry and base snapshots.',
      'The input boundary is entry, options. Resolved entry string. Exact URL bytes remain unchanged; unsupported self-spawn or unresolved relative input throws the original configuration error.'
    ],
    useZh: [
      '启动器根据原生主入口和基准快照解析显式入口。',
      '输入边界为 entry、options。返回解析入口字符串，精确地址字节不变；不支持自身启动或缺少相对基准时抛原配置错误。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:retainAdapterRuntimeFlags': guide({
    purposeEn:
      'Preserve runtime/loader flags while removing eval, print and test-controller entry selection. A retained flag list; the input and native launcher remain caller-owned.',
    purposeZh:
      '保留运行时及加载器参数，移除求值、打印和测试控制器入口选择。返回保留参数列表，输入及原生启动器仍归调用者。',
    quickStart:
      "import { retainAdapterRuntimeFlags } from '@migaia/rpc-host/plugin'\n\nimport { execArgv } from 'node:process'\n\n// Feed retained loader flags to the native launcher; keep entry selection separate.\nexport const childExecArgv = retainAdapterRuntimeFlags(execArgv)",
    useEn: [
      'A self-spawn launcher retains loader flags without inheriting test-controller entry selection.',
      'The input boundary is flags. A retained flag list; the input and native launcher remain caller-owned.'
    ],
    useZh: [
      '自身启动器要保留加载器参数，又不继承测试控制器的入口选择。',
      '输入边界为 flags。返回保留参数列表，输入及原生启动器仍归调用者。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:createJsonRpcBridgeError': guide({
    purposeEn:
      'Construct the canonical JSON-RPC bridge failure without reflecting peer payload or replacing the original cause. Native Error or TypeError with the canonical bridge source/code and original cause; no live channel authority is created.',
    purposeZh:
      '构造规范桥接失败，不反射对端载荷，也不替换原原因。返回附规范桥接领域错误码及原原因的原生错误或类型错误，不创建活动通道权限。',
    quickStart:
      "import { createJsonRpcBridgeError } from '@migaia/rpc-host/plugin'\nimport { JsonRpcBridgeErrorCode } from '@migaia/rpc-contract/framing/jsonrpc'\n\nexport function rejectUnsupportedBridge(cause: unknown) {\n  return createJsonRpcBridgeError(JsonRpcBridgeErrorCode.unsupportedMode, cause, true)\n}",
    useEn: [
      'Construct the canonical JSON-RPC bridge failure without reflecting peer payload or replacing the original cause.',
      'The input boundary is code, cause, local. Native Error or TypeError with the canonical bridge source/code and original cause; no live channel authority is created.'
    ],
    useZh: [
      '构造规范桥接失败，不反射对端载荷，也不替换原原因。',
      '输入边界为 code、cause、local。返回附规范桥接领域错误码及原原因的原生错误或类型错误，不创建活动通道权限。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:createAdapterSourceConfigurationError': guide({
    purposeEn:
      'Create the original invalid-source diagnostic using its canonical code and text. RpcError with INVALID_CONFIG; it owns no source, reader or native cleanup.',
    purposeZh:
      '使用规范错误码及文本创建原非法来源诊断。返回非法配置错误，不拥有来源、读取器或原生清理。',
    quickStart:
      "import { createAdapterSourceConfigurationError } from '@migaia/rpc-host/plugin'\n\n/** Reject source selection before acquiring a native port. */\nexport function requirePort<T>(port: T | undefined): T {\n  if (port === undefined) throw createAdapterSourceConfigurationError()\n  return port\n}",
    useEn: [
      'Create the original invalid-source diagnostic using its canonical code and text.',
      'RpcError with INVALID_CONFIG; it owns no source, reader or native cleanup.'
    ],
    useZh: [
      '使用规范错误码及文本创建原非法来源诊断。',
      '返回非法配置错误，不拥有来源、读取器或原生清理。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:createAdapterId': guide({
    purposeEn:
      'Allocate an ordinary local resource address through the canonical identifier owner. New string identifier, never authentication, provenance or a registered resource token.',
    purposeZh:
      '经规范标识所有者分配普通本地资源地址。返回新字符串标识，不代表认证、来源或已登记资源令牌。',
    quickStart:
      "import { createAdapterId } from '@migaia/rpc-host/plugin'\n\n// Resource addresses identify this local launch; they are not authentication tokens.\nconst launchId = createAdapterId()\nconst resources = new Map([[launchId, { phase: 'opening' }]])\nconsole.log(resources.get(launchId))",
    useEn: [
      'Allocate an ordinary local resource address through the canonical identifier owner.',
      'New string identifier, never authentication, provenance or a registered resource token.'
    ],
    useZh: [
      '经规范标识所有者分配普通本地资源地址。',
      '返回新字符串标识，不代表认证、来源或已登记资源令牌。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:readAdapterAbortReason': guide({
    purposeEn:
      'Read the original signal reason at a held resource operation boundary. Original abort reason or the canonical fallback; the signal is borrowed and is not aborted by this read.',
    purposeZh:
      '在持有资源的操作边界读取原信号原因。返回原取消原因或规范回退值，仅借用信号，读取不会取消它。',
    quickStart:
      "import { readAdapterAbortReason } from '@migaia/rpc-host/plugin'\n\n/** Preserve the caller's reason when raw I/O observes cancellation. */\nexport function assertOpening(signal: AbortSignal) {\n  if (signal?.aborted) throw readAdapterAbortReason(signal)\n}",
    useEn: [
      'Read the original signal reason at a held resource operation boundary.',
      'The input boundary is signal. Original abort reason or the canonical fallback; the signal is borrowed and is not aborted by this read.'
    ],
    useZh: [
      '在持有资源的操作边界读取原信号原因。',
      '输入边界为 signal。返回原取消原因或规范回退值，仅借用信号，读取不会取消它。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),

  'rpc-host:plugin:createAdapterConfigurationError': guide({
    purposeEn:
      'Attach the established invalid-configuration identity to a new canonical diagnostic. RpcError with INVALID_CONFIG; no live resource registration is minted.',
    purposeZh:
      '为新的规范诊断附加既有非法配置身份，用于在原生来源获取前拒绝无效的本地配置；返回的错误不签发活动资源登记。',
    quickStart:
      "import { createAdapterConfigurationError } from '@migaia/rpc-host/plugin'\n\n/** Keep adapter-owned configuration wording separate from peer payloads. */\nexport function requireEntry(entry: string | undefined) {\n  if (!entry) throw createAdapterConfigurationError('An explicit launch entry is required')\n  return entry\n}",
    useEn: [
      'Attach the established invalid-configuration identity to a new canonical diagnostic.',
      'The input boundary is message. RpcError with INVALID_CONFIG; no live resource registration is minted.'
    ],
    useZh: [
      '为新的规范诊断附加既有非法配置身份。',
      '输入边界为 message。返回非法配置错误，不签发活动资源登记。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:createAdapterConfigurationTypeError': guide({
    purposeEn:
      'Create a native TypeError with canonical invalid-configuration identity while preserving its cause. The new TypeError instance with code attached; it does not register an external error or live resource.',
    purposeZh:
      '创建附规范非法配置身份的原生类型错误并保留原因。返回附错误码的新类型错误实例，不登记外部错误或活动资源。',
    quickStart:
      "import { createAdapterConfigurationTypeError } from '@migaia/rpc-host/plugin'\n\n/** Retain the original parsing failure on the native TypeError cause chain. */\nexport function rejectConfiguration(cause: unknown): never {\n  throw createAdapterConfigurationTypeError('The local launch configuration is invalid', cause)\n}",
    useEn: [
      'Create a native TypeError with canonical invalid-configuration identity while preserving its cause.',
      'The input boundary is message, cause. The new TypeError instance with code attached; it does not register an external error or live resource.'
    ],
    useZh: [
      '创建附规范非法配置身份的原生类型错误并保留原因。',
      '输入边界为 message、cause。返回附错误码的新类型错误实例，不登记外部错误或活动资源。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:createAdapterTransportError': guide({
    purposeEn:
      'Construct the original native transport diagnostic without granting private control identity. RpcTransportError retaining its original native class and cause.',
    purposeZh:
      '为实际原生读写失败构造传输诊断，保留原生错误类及原始原因链；该诊断只描述失败，不授予重试、取消或私有控制身份。',
    quickStart:
      "import { createAdapterTransportError } from '@migaia/rpc-host/plugin'\n\n/** Classify a native write failure without changing the held cause. */\nexport function failedWrite(cause: unknown) {\n  return createAdapterTransportError('The adapter could not write its frame', cause)\n}",
    useEn: [
      'Construct the original native transport diagnostic without granting private control identity.',
      'The input boundary is args. RpcTransportError retaining its original native class and cause.'
    ],
    useZh: [
      '构造原生传输诊断，不授予私有控制身份。',
      '输入边界为 args。返回保留原生类及原因的传输错误。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:holdAdapterLaunch': guide({
    purposeEn:
      'Read launch proposal metadata attached by the canonical owner to this exact request; never trust copied caller labels. Readonly proposal projection, or undefined proposal if the request is not held. No setters or accepted identity claims are exposed.',
    purposeZh:
      '读取规范所有者附在精确请求上的启动提议元数据，不信任复制的调用者标签。返回只读提议投影，未持有请求的提议为空，不公开设置器或已接纳身份声称。',
    quickStart:
      "import { holdAdapterLaunch } from '@migaia/rpc-host/plugin'\n\n/** Read the genuine proposal inside the launcher's existing launch callback. */\nexport function inspectLaunch(request: Parameters<typeof holdAdapterLaunch>[0]) {\n  const held = holdAdapterLaunch(request)\n  // Do not copy proposal fields into an accepted peer identity.\n  return held\n}",
    useEn: [
      'Read launch proposal metadata attached by the canonical owner to this exact request; never trust copied caller labels.',
      'The input boundary is request. Readonly proposal projection, or undefined proposal if the request is not held. No setters or accepted identity claims are exposed.'
    ],
    useZh: [
      '读取规范所有者附在精确请求上的启动提议元数据，不信任复制的调用者标签。',
      '输入边界为 request。返回只读提议投影，未持有请求的提议为空，不公开设置器或已接纳身份声称。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createAdapterBindingDrain': guide({
    purposeEn:
      'Reuse the original generation-bound drain owner for one actual adapter binding. Original wrap, trackCurrent and drainCurrent operations, registered with exact drain identity; replacement never inherits old-generation work.',
    purposeZh:
      '为一个实际适配器绑定复用原按代次排空所有者。返回原包装、当前请求跟踪及排空操作，并登记精确排空身份，替换不会继承旧代工作。',
    quickStart:
      "import { createAdapterBindingDrain } from '@migaia/rpc-host/plugin'\n\n/** Each native binding owns one drain resource and its existing deadline clock. */\nexport function createDrain(...options: Parameters<typeof createAdapterBindingDrain>) {\n  return createAdapterBindingDrain(...options)\n}\n// The binding wraps its accepted endpoint and calls drainCurrent() before release.",
    useEn: [
      'A managed binding waits for the current generation work before native release.',
      'The input boundary is args. Original wrap, trackCurrent and drainCurrent operations, registered with exact drain identity; replacement never inherits old-generation work.'
    ],
    useZh: [
      '受监督绑定需要在原生释放前等待当前代工作。',
      '输入边界为 args。返回原包装、当前请求跟踪及排空操作，并登记精确排空身份，替换不会继承旧代工作。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),

  'rpc-host:plugin:createRuntimeByteConnection': guide({
    purposeEn:
      'Perform original framed control negotiation over real ordered byte I/O and retain its accepted connection. Promise of negotiated IRuntimeByteConnection; its original close releases connection cleanup before physical close. It creates no host endpoint.',
    purposeZh:
      '在真实有序字节输入输出上执行原分帧控制协商并保留已接纳连接。返回已协商字节连接的承诺，原关闭先清理连接再物理关闭，不创建宿主端点。',
    quickStart:
      "import { createRuntimeByteConnection } from '@migaia/rpc-host/plugin'\n\n/** Negotiate one raw ordered byte source; no second endpoint is constructed. */\nexport async function negotiateBytes(...input: Parameters<typeof createRuntimeByteConnection>) {\n  const connection = await createRuntimeByteConnection(...input)\n  // Return this receipt from deployment.open; Host then owns its accepted session.\n  return connection\n}",
    useEn: [
      'A raw byte deployment needs an actual negotiated channel receipt.',
      'The input boundary is channel, options, diagnostics. Promise of negotiated IRuntimeByteConnection; its original close releases connection cleanup before physical close. It creates no host endpoint.'
    ],
    useZh: [
      '原始字节部署需要实际已协商通道回执。',
      '输入边界为 channel、options、diagnostics。返回已协商字节连接的承诺，原关闭先清理连接再物理关闭，不创建宿主端点。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:readRuntimeByteBootstrap': guide({
    purposeEn:
      'Consume exactly one original framed bootstrap while transferring the same decoder into subsequent handshake. Promise of channel plus bootstrap bytes. The channel retains the original decoder; omitted timeout installs no bootstrap-read timer.',
    purposeZh:
      '消费一个原分帧启动记录，并将同一解码器转交后续握手。返回通道及启动字节的承诺，通道保留原解码器，省略期限时不安装启动读取定时器。',
    quickStart:
      "import { readRuntimeByteBootstrap } from '@migaia/rpc-host/plugin'\n\n/** The child owns this first read; the returned channel retains its decoder. */\nexport async function receiveBootstrap(...input: Parameters<typeof readRuntimeByteBootstrap>) {\n  const received = await readRuntimeByteBootstrap(...input)\n  return received\n}\n// Pass received.channel to the same byte handshake, never start a competing reader.",
    useEn: [
      'A child receives framed bootstrap data before the ordinary byte handshake.',
      'The input boundary is channel, diagnostics, options. Promise of channel plus bootstrap bytes. The channel retains the original decoder; omitted timeout installs no bootstrap-read timer.'
    ],
    useZh: [
      '子端需要在普通字节握手前接收分帧启动数据。',
      '输入边界为 channel、diagnostics、options。返回通道及启动字节的承诺，通道保留原解码器，省略期限时不安装启动读取定时器。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createRuntimeProviderGovernor': guide({
    purposeEn:
      'Enforce original connection rate, payload and idle limits at actual provider execution. Governor with original limit/provider/stream wrappers and close. It owns its connection timers/subscriptions, not another endpoint.',
    purposeZh:
      '在实际提供方执行处实施原连接速率、负载及空闲限制。返回含原限制、提供方、流包装及关闭的治理器，仅拥有连接定时器和订阅，不拥有另一个端点。',
    quickStart:
      "import { createRuntimeProviderGovernor } from '@migaia/rpc-host/plugin'\n\n/** Bind execution limits to this actual channel, using the source's close callback. */\nexport function governSession(...input: Parameters<typeof createRuntimeProviderGovernor>) {\n  return createRuntimeProviderGovernor(...input)\n}\n// Lend the returned provider/stream wrappers through deployment.prepareEndpoint.",
    useEn: [
      'A native session needs payload, rate and idle limits at provider execution.',
      'The input boundary is channel, options, closeSession, report. Governor with original limit/provider/stream wrappers and close. It owns its connection timers/subscriptions, not another endpoint.'
    ],
    useZh: [
      '原生会话需要在提供方执行处实施负载、速率及空闲限制。',
      '输入边界为 channel、options、closeSession、report。返回含原限制、提供方、流包装及关闭的治理器，仅拥有连接定时器和订阅，不拥有另一个端点。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createRuntimeProviderScope': guide({
    purposeEn:
      'Construct the original shared principal-scoped idempotency and provider admission resource. Scope whose session derives keys from authenticated channel identity; retire sessions before closing its shared admission registry.',
    purposeZh:
      '构造原按主体划分的共享幂等及提供方准入资源。返回从已认证通道身份推导会话键的范围，关闭共享准入登记前须退休会话。',
    quickStart:
      "import { createRuntimeProviderScope } from '@migaia/rpc-host/plugin'\n\n// One listener shares this scope across its authenticated accepted sessions.\nexport const listenerScope = createRuntimeProviderScope()\n// session(channel) derives principal-scoped keys from that genuine channel.\n// Retire sessions before closing the listener scope; never substitute caller identity labels.",
    useEn: [
      'A listener shares principal-scoped idempotency and admission across accepted sessions.',
      'The input boundary is inputStore. Scope whose session derives keys from authenticated channel identity; retire sessions before closing its shared admission registry.'
    ],
    useZh: [
      '监听器要在已接纳会话间共享按主体划分的幂等及准入。',
      '输入边界为 inputStore。返回从已认证通道身份推导会话键的范围，关闭共享准入登记前须退休会话。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createEventEmitterMessageResource': guide({
    purposeEn:
      'Hold actual EventEmitter messaging and optional native launch completion through the canonical resource owner. Held IAdapterMessageResource. Its original close releases capture/launch resources; it never constructs a second host endpoint.',
    purposeZh:
      '经规范资源所有者持有实际事件发射消息及可选原生启动完成。返回持有消息资源，原关闭释放捕获及启动资源，不构造第二个宿主端点。',
    quickStart:
      "import { createEventEmitterMessageResource } from '@migaia/rpc-host/plugin'\n\n/** Capture an actual native on/off port before the host handshake begins. */\nexport function holdEmitterPort(port: Parameters<typeof createEventEmitterMessageResource>[0]) {\n  return createEventEmitterMessageResource(port)\n}\n// The returned resource keeps cold messages and releases only its own capture subscriptions.",
    useEn: [
      'A native on/off port must capture early messages before host installation.',
      'The input boundary is port, launch. Held IAdapterMessageResource. Its original close releases capture/launch resources; it never constructs a second host endpoint.'
    ],
    useZh: [
      '原生 on/off 端口必须在宿主安装前捕获早期消息。',
      '输入边界为 port、launch。返回持有消息资源，原关闭释放捕获及启动资源，不构造第二个宿主端点。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createEventTargetMessageResource': guide({
    purposeEn:
      'Hold actual EventTarget messaging with the original bounded cold receive capture. Held IAdapterMessageResource using original resource cleanup and borrowed native lifetime semantics.',
    purposeZh:
      '以原有界冷接收捕获持有实际事件目标消息。返回使用原资源清理及借用原生寿命语义的持有消息资源。',
    quickStart:
      "import { createEventTargetMessageResource } from '@migaia/rpc-host/plugin'\n\n/** Capture the real addEventListener/removeEventListener port once. */\nexport function holdEventTarget(port: Parameters<typeof createEventTargetMessageResource>[0]) {\n  return createEventTargetMessageResource(port)\n}\n// Reuse this resource for initial identity and open; do not add another message listener.",
    useEn: [
      'A native EventTarget port needs bounded cold receive capture.',
      'The input boundary is port, launch. Held IAdapterMessageResource using original resource cleanup and borrowed native lifetime semantics.'
    ],
    useZh: [
      '原生 EventTarget 端口需要有界冷接收捕获。',
      '输入边界为 port、launch。返回使用原资源清理及借用原生寿命语义的持有消息资源。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createRuntimeEventByteIO': guide({
    purposeEn:
      'Adapt native event reader/writer and physical close into the one original ordered byte port. IRuntimeByteIO retaining original subscriptions, writes and close; no caller predicate or label grants trust.',
    purposeZh:
      '将原生事件读取写入及物理关闭接入唯一原有序字节端口。返回保留原订阅、写入及关闭的字节接口，调用者谓词或标签不授予信任。',
    quickStart:
      "import { createRuntimeEventByteIO } from '@migaia/rpc-host/plugin'\n\n/** Adapt native data/drain/error events without replacing their physical lifetime owner. */\nexport function eventBytes(...input: Parameters<typeof createRuntimeEventByteIO>) {\n  return createRuntimeEventByteIO(...input)\n}\n// Return the IRuntimeByteIO from a byte adapter opener; its close uses the supplied physical resource.",
    useEn: [
      'A native stream emits data, drain and error events instead of Web streams.',
      'The input boundary is reader, writer, physical, closedDiagnostic, byteViewFactory. IRuntimeByteIO retaining original subscriptions, writes and close; no caller predicate or label grants trust.'
    ],
    useZh: [
      '原生流通过数据、排空及错误事件工作，而非 Web 流。',
      '输入边界为 reader、writer、physical、closedDiagnostic、byteViewFactory。返回保留原订阅、写入及关闭的字节接口，调用者谓词或标签不授予信任。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createRuntimeMessageConnection': guide({
    purposeEn:
      'Negotiate on held whole-message I/O through the original bounded capability acknowledgement path. Promise of the genuine source result; actual negotiation and resource cleanup remain connection-owned.',
    purposeZh:
      '在持有完整消息输入输出上沿原有界能力确认路径协商。返回真实来源结果的承诺，实际协商及资源清理仍归连接。',
    quickStart:
      "import { createRuntimeMessageConnection } from '@migaia/rpc-host/plugin'\n\n/** Negotiate the supplied raw message I/O using the native adapter's diagnostics. */\nexport async function negotiateMessages(...input: Parameters<typeof createRuntimeMessageConnection>) {\n  return createRuntimeMessageConnection(...input)\n}\n// deployment.open returns this accepted source receipt to Host assembly.",
    useEn: [
      'A raw message deployment negotiates capabilities before accepting RPC data.',
      'The input boundary is io, options, diagnostics. Promise of the genuine source result; actual negotiation and resource cleanup remain connection-owned.'
    ],
    useZh: [
      '原始消息部署需要在接纳 RPC 数据前协商能力。',
      '输入边界为 io、options、diagnostics。返回真实来源结果的承诺，实际协商及资源清理仍归连接。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:carrierSizeBytes': guide({
    purposeEn:
      'Read byte-like payload length without serializing structured-clone values or allocating another buffer. Known byte length, or the canonical unknown-size sentinel for a non-byte object; observation does not consume the message.',
    purposeZh:
      '读取类字节负载长度，不序列化结构化克隆值，也不分配另一缓冲。返回已知字节长度或非字节对象的原未知大小标记，观察不消费消息。',
    quickStart:
      "import { carrierSizeBytes } from '@migaia/rpc-host/plugin'\n\nconst frame = new Uint8Array([1, 2, 3, 4])\nconst measuredBytes = carrierSizeBytes(frame)\n// Feed this estimate to an observer; do not use it as authentication or wire validation.\nconsole.log(measuredBytes)",
    useEn: [
      'A carrier observer estimates emitted payload sizes without changing delivery.',
      'The input boundary is message. Known byte length, or the canonical unknown-size sentinel for a non-byte object; observation does not consume the message.'
    ],
    useZh: [
      '载体观察器需要估算已发负载大小且不改变投递。',
      '输入边界为 message。返回已知字节长度或非字节对象的原未知大小标记，观察不消费消息。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:holdAdapterObjectChannel': guide({
    purposeEn:
      'Hold actual object I/O cold so the original connection negotiates and qualifies its own paired object port. IRuntimeObjectConnection with prepare/negotiate/open/close; it accepts local proposals, never caller-supplied accepted agreement proofs.',
    purposeZh:
      '冷持有实际对象输入输出，由原连接自行协商并确定成对对象端口资格。返回含准备、协商、打开和关闭的对象连接，接收本地提议而非调用者提交的已接纳协商证明。',
    quickStart:
      "import { holdAdapterObjectChannel } from '@migaia/rpc-host/plugin'\n\n/** Keep exchange, text and object operations on the same physical source. */\nexport function holdObjectSource(io: Parameters<typeof holdAdapterObjectChannel>[0]) {\n  return holdAdapterObjectChannel(io)\n}\n// The original prepare/negotiate/open sequence derives accepted capabilities from the remote exchange.",
    useEn: [
      'A carrier offers text and object operations on one actual physical resource.',
      'The input boundary is io. IRuntimeObjectConnection with prepare/negotiate/open/close; it accepts local proposals, never caller-supplied accepted agreement proofs.'
    ],
    useZh: [
      '载体在同一实际物理资源上提供文本及对象操作。',
      '输入边界为 io。返回含准备、协商、打开和关闭的对象连接，接收本地提议而非调用者提交的已接纳协商证明。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:materializeAdapterJson': guide({
    purposeEn:
      'Materialize the canonical JSON data-only view without revisiting caller getters or minting an owned receipt. Ordinary materialized value; physical source identity, listeners and lifetime remain unchanged.',
    purposeZh:
      '形成规范仅数据的序列化视图，不重复访问调用者访问器，也不签发拥有回执。返回普通投影值，物理来源身份、监听和寿命不变。',
    quickStart:
      "import { materializeAdapterJson } from '@migaia/rpc-host/plugin'\n\nconst input = { order: { id: 'order-1', total: 42 } }\nconst portable = materializeAdapterJson(input)\n// Send the materialized value through the adapter's existing JSON write path.\nconsole.log(JSON.stringify(portable))",
    useEn: [
      'Materialize the canonical JSON data-only view without revisiting caller getters or minting an owned receipt.',
      'The input boundary is value. Ordinary materialized value; physical source identity, listeners and lifetime remain unchanged.'
    ],
    useZh: [
      '形成规范仅数据的序列化视图，不重复访问调用者访问器，也不签发拥有回执。',
      '输入边界为 value。返回普通投影值，物理来源身份、监听和寿命不变。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:prepareJsonRpcOffer': guide({
    purposeEn:
      'Validate supported local bridge options before readers, timers or physical writes, then add canonical JSON/auth/profile fields. Canonical IRpcHandshakeOffer; unsupported streams or capabilities reject before I/O. The caller retains credentials and physical ownership.',
    purposeZh:
      '在读取器、定时器或物理写入前验证支持的本地桥接选项，再加入规范序列化、认证及协议字段。返回规范握手提议，不支持的流或能力在输入输出前拒绝，调用者保留凭据及物理归属。',
    quickStart:
      "import { prepareJsonRpcOffer } from '@migaia/rpc-host/plugin'\n\n/** Validate local bridge policy before adding readers, timers or physical writes. */\nexport function prepareBridge(options: Parameters<typeof prepareJsonRpcOffer>[0]) {\n  return prepareJsonRpcOffer(options)\n}\n// Use the returned local offer in the canonical control exchange; it is not an accepted agreement.",
    useEn: [
      'Validate supported local bridge options before readers, timers or physical writes, then add canonical JSON/auth/profile fields.',
      'The input boundary is options. Canonical IRpcHandshakeOffer; unsupported streams or capabilities reject before I/O. The caller retains credentials and physical ownership.'
    ],
    useZh: [
      '在读取器、定时器或物理写入前验证支持的本地桥接选项，再加入规范序列化、认证及协议字段。',
      '输入边界为 options。返回规范握手提议，不支持的流或能力在输入输出前拒绝，调用者保留凭据及物理归属。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:readJsonRpcReply': guide({
    purposeEn:
      'Admit the actual bridge response shape without echoing its reply/authentication text into diagnostics. The original reply string; invalid response shape throws the canonical profile error without changing channel ownership.',
    purposeZh:
      '接纳实际桥接回复形状，不把回复或认证文本回显到诊断。返回原回复字符串，形状非法时抛规范协议配置错误，不改变通道归属。',
    quickStart:
      "import { readJsonRpcReply } from '@migaia/rpc-host/plugin'\n\n/** A JSON-RPC carrier receives text control replies, not arbitrary object coercions. */\nexport function receiveReply(received: unknown) {\n  return readJsonRpcReply(received)\n}",
    useEn: [
      'Admit the actual bridge response shape without echoing its reply/authentication text into diagnostics.',
      'The input boundary is result. The original reply string; invalid response shape throws the canonical profile error without changing channel ownership.'
    ],
    useZh: [
      '接纳实际桥接回复形状，不把回复或认证文本回显到诊断。',
      '输入边界为 result。返回原回复字符串，形状非法时抛规范协议配置错误，不改变通道归属。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:assertJsonRpcExtensions': guide({
    purposeEn:
      'Check required capabilities and all four responder extension methods after the original control exchange. Void on success; missing extensions throw the original bridge error. No handshake or reader is added.',
    purposeZh:
      '在原控制交换后检查必需能力及响应端全部四种扩展方法。成功返回空值，缺失扩展抛原桥接错误，不添加握手或读取器。',
    quickStart:
      "import { assertJsonRpcExtensions } from '@migaia/rpc-host/plugin'\n\n/** Check the actual remote reply against the bridge's advertised extensions. */\nexport function acceptExtensions(capabilities: readonly string[], reply: unknown) {\n  assertJsonRpcExtensions(capabilities, reply)\n  return reply\n}",
    useEn: [
      'Check required capabilities and all four responder extension methods after the original control exchange.',
      'The input boundary is capabilities, result. Void on success; missing extensions throw the original bridge error. No handshake or reader is added.'
    ],
    useZh: [
      '在原控制交换后检查必需能力及响应端全部四种扩展方法。',
      '输入边界为 capabilities、result。成功返回空值，缺失扩展抛原桥接错误，不添加握手或读取器。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:validateJsonRpcDescription': guide({
    purposeEn:
      'Apply the canonical remote description checker and the bridge profile stream exclusion. Void on success; malformed data or stream methods keep their canonical errors. Validation grants no source identity.',
    purposeZh:
      '应用规范远端描述检查及桥接协议的流排除规则。成功返回空值，非法数据或流方法保留规范错误，验证不授予来源身份。',
    quickStart:
      "import { validateJsonRpcDescription } from '@migaia/rpc-host/plugin'\n\n/** Stop an invalid directory before exposing its remote methods. */\nexport function acceptDescription(received: unknown) {\n  validateJsonRpcDescription(received)\n  return received\n}",
    useEn: [
      'Apply the canonical remote description checker and the bridge profile stream exclusion.',
      'The input boundary is value. Void on success; malformed data or stream methods keep their canonical errors. Validation grants no source identity.'
    ],
    useZh: [
      '应用规范远端描述检查及桥接协议的流排除规则。',
      '输入边界为 value。成功返回空值，非法数据或流方法保留规范错误，验证不授予来源身份。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:createRpcTransportError': guide({
    purposeEn:
      'Construct the original transport error class and preserve its registered identity. Native RpcTransportError with original cause; no private live-control brand is granted to external errors.',
    purposeZh:
      '构造原传输错误类并保留登记身份。返回带原原因的原生传输错误，不为外部错误授予私有活动控制标记。',
    quickStart:
      "import { createRpcTransportError } from '@migaia/rpc-host/plugin'\n\n/** Preserve the actual native failure on cause for the caller's diagnostics. */\nexport function transportFailure(cause: unknown) {\n  return createRpcTransportError('The native byte stream closed during a write', cause)\n}",
    useEn: [
      'Construct the original transport error class and preserve its registered identity.',
      'The input boundary is args. Native RpcTransportError with original cause; no private live-control brand is granted to external errors.'
    ],
    useZh: [
      '构造原传输错误类并保留登记身份。',
      '输入边界为 args。返回带原原因的原生传输错误，不为外部错误授予私有活动控制标记。'
    ],
    avoidEn: [
      'Do not treat this returned diagnostic or local data as proof of an accepted remote capability.',
      'Keep native I/O and cleanup at their existing owner; this operation does not acquire them.'
    ],
    avoidZh: [
      '不要把返回的诊断或本地数据当作已接纳远端能力的证明。',
      '原生输入输出及清理仍由既有所有者负责；此操作不获取这些资源。'
    ]
  }),
  'rpc-host:plugin:holdAdapterByteBootstrapSource': guide({
    purposeEn:
      'Hold the original private byte first-frame snapshot before the unique host endpoint is constructed. Exact opaque IAdapterByteBootstrapSource; no second reader or endpoint is opened and invalid source authority rejects.',
    purposeZh:
      '在唯一宿主端点构造前持有原私有字节首帧快照。返回精确不透明字节启动句柄，不打开第二个读取器或端点，非法来源权限拒绝。',
    quickStart:
      "import { holdAdapterByteBootstrapSource } from '@migaia/rpc-host/plugin'\n\n/** Hold only the I/O carrying the canonical first-frame bootstrap receipt. */\nexport function childByteSource(...input: Parameters<typeof holdAdapterByteBootstrapSource>): ReturnType<typeof holdAdapterByteBootstrapSource> {\n  return holdAdapterByteBootstrapSource(...input)\n}\n// Return this opaque token from deployment.bootstrap; Host adopts identity before its only endpoint.",
    useEn: [
      'A process child must adopt its genuine first-frame identity before endpoint construction.',
      'The input boundary is io, local. Exact opaque IAdapterByteBootstrapSource; no second reader or endpoint is opened and invalid source authority rejects.'
    ],
    useZh: [
      '进程子端必须在构造端点前接纳真实首帧身份。',
      '输入边界为 io、local。返回精确不透明字节启动句柄，不打开第二个读取器或端点，非法来源权限拒绝。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:holdAdapterMessageBootstrapSource': guide({
    purposeEn:
      'Hold native initial message identity with the original resource and one shared deadline before host endpoint construction. Promise of exact opaque message bootstrap token; failure cleans original capture and retains primary error identity.',
    purposeZh:
      '在宿主端点构造前以原资源和唯一共享期限持有原生首消息身份。返回精确不透明消息启动令牌的承诺，失败清理原捕获并保留主错误身份。',
    quickStart:
      "import { holdAdapterMessageBootstrapSource } from '@migaia/rpc-host/plugin'\n\n/** Receive initial identity on the same held native resource and one shared budget. */\nexport async function childMessageSource(resource: Parameters<typeof holdAdapterMessageBootstrapSource>[0]): ReturnType<typeof holdAdapterMessageBootstrapSource> {\n  return holdAdapterMessageBootstrapSource(resource, { connectTimeoutMs: 1000 })\n}\n// Return this exact opaque token from deployment.bootstrap; never rebuild it from copied fields.",
    useEn: [
      'A thread child must preserve its held initial resource and handshake deadline.',
      'The input boundary is resource, options. Promise of exact opaque message bootstrap token; failure cleans original capture and retains primary error identity.'
    ],
    useZh: [
      '线程子端必须保留持有的首消息资源及握手期限。',
      '输入边界为 resource、options。返回精确不透明消息启动令牌的承诺，失败清理原捕获并保留主错误身份。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createAdapterMessageHandshakeBudget': guide({
    purposeEn:
      'Capture one absolute preparation deadline before initial-message and capability acknowledgement work. Budget object or undefined when no timeout was supplied. It creates no timer and cannot reset the deadline on later phases.',
    purposeZh:
      '在首消息及能力确认开始前捕获唯一绝对准备期限。返回预算对象，未提供期限时为空值；不创建定时器，也不能在后续阶段重置期限。',
    quickStart:
      "import { createAdapterMessageHandshakeBudget } from '@migaia/rpc-host/plugin'\n\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst budget = createAdapterMessageHandshakeBudget(systemScheduler, 1000)\n// Pass this same budget to exchangeIdentity and open.handshakeBudget.\n// Construct it once: receiving initial data must not reset the ACK deadline.\nconsole.log(budget?.deadline)",
    useEn: [
      'Initial identity and ACK wait must consume one deadline in the same scheduler.',
      'The input boundary is scheduler, timeoutMs. Budget object or undefined when no timeout was supplied. It creates no timer and cannot reset the deadline on later phases.'
    ],
    useZh: [
      '首身份与确认等待必须消耗同一调度器上的一个期限。',
      '输入边界为 scheduler、timeoutMs。返回预算对象，未提供期限时为空值；不创建定时器，也不能在后续阶段重置期限。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createRuntimeWebByteStream': guide({
    purposeEn:
      'Acquire native reader/writer once and reuse their buffering and write ordering in the shared reliable byte pump. IRuntimeByteIO whose same terminal cleanup cancels reader, aborts writer, invokes physical close and releases the reader lock; no second queue or session owner.',
    purposeZh:
      '仅获取一次原生读写器，并在共享可靠字节泵中复用原缓冲及写入顺序。返回字节接口，同一终态清理取消读取器、终止写入器、调用物理关闭并释放读取锁，不添加另一队列或会话所有者。',
    quickStart:
      "import { createRuntimeWebByteStream } from '@migaia/rpc-host/plugin'\n\n/** Adapt an acquired reliable native stream; its owner supplies errors and session cleanup. */\nexport function reliableBytes(...input: Parameters<typeof createRuntimeWebByteStream>) {\n  return createRuntimeWebByteStream(...input)\n}\n// Give the returned I/O to a byte deployment. Reader cancel/writer abort remain on this pump.",
    useEn: [
      'A reliable native Web stream must reuse ordered writes and terminal reader/writer cleanup.',
      'The input boundary is readable, writable, closePhysical, options. IRuntimeByteIO whose same terminal cleanup cancels reader, aborts writer, invokes physical close and releases the reader lock; no second queue or session owner.'
    ],
    useZh: [
      '可靠原生 Web 流需要复用有序写入及终态读写器清理。',
      '输入边界为 readable、writable、closePhysical、options。返回字节接口，同一终态清理取消读取器、终止写入器、调用物理关闭并释放读取锁，不添加另一队列或会话所有者。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createBrowserMessagePortTransport': guide({
    purposeEn:
      'Wrap one actual browser-style MessagePort using the canonical lazy EventTarget subscription algorithm. IRpcTransport retaining transfer lists and original native error causes. Owned close closes the port; borrowed close only removes adapter listeners.',
    purposeZh:
      '使用规范惰性事件订阅算法包装一个实际浏览器式消息端口。返回保留转移列表及原生错误原因的传输，拥有时关闭物理端口，借用时仅移除适配器监听。',
    quickStart:
      "import { createBrowserMessagePortTransport } from '@migaia/rpc-host/plugin'\n\n/** Borrow one native MessagePort without taking ownership of port.close(). */\nexport function messagePortSource(port: Parameters<typeof createBrowserMessagePortTransport>[0]) {\n  return createBrowserMessagePortTransport(port, { ownership: 'borrowed' })\n}\n// Dispose the transport subscriptions before the application's native port owner closes the port.",
    useEn: [
      'A plugin author borrows a native MessagePort with its existing subscription owner.',
      'The input boundary is port, options. IRpcTransport retaining transfer lists and original native error causes. Owned close closes the port; borrowed close only removes adapter listeners.'
    ],
    useZh: [
      '插件作者需要借用原生 MessagePort 及其既有订阅所有者。',
      '输入边界为 port、options。返回保留转移列表及原生错误原因的传输，拥有时关闭物理端口，借用时仅移除适配器监听。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createWebWorkerTransport': guide({
    purposeEn:
      'Wrap a real Worker/port EventTarget with the canonical subscription and failure observer, without duplicating native transport state. Borrowed IRpcTransport; error/messageerror fail pending work through the original transport path. close removes hooks and never terminates the Worker.',
    purposeZh:
      '以规范订阅和失败观察包装真实工作程序端口，不复制原生传输状态。返回借入传输，原生错误沿原传输路径结束等待工作；关闭移除监听，不终止工作程序。',
    quickStart:
      "import { createWebWorkerTransport } from '@migaia/rpc-host/plugin'\n\n/** Adapt the native Worker messaging surface; termination remains application-owned. */\nexport function workerSource(port: Parameters<typeof createWebWorkerTransport>[0]) {\n  return createWebWorkerTransport(port)\n}\n// Release this transport's subscriptions separately from the native worker's terminate().",
    useEn: [
      'A plugin author adapts a structural Worker port without moving native termination ownership.',
      'The input boundary is port, options. Borrowed IRpcTransport; error/messageerror fail pending work through the original transport path. close removes hooks and never terminates the Worker.'
    ],
    useZh: [
      '插件作者要适配结构化 Worker 端口，又不转移原生终止所有权。',
      '输入边界为 port、options。返回借入传输，原生错误沿原传输路径结束等待工作；关闭移除监听，不终止工作程序。'
    ],
    avoidEn: [
      'Do not replace this operation with caller-supplied accepted identity or copied resource tokens.',
      'Use the native owner described above; this helper does not construct an application host or transfer its physical ownership.'
    ],
    avoidZh: [
      '不要用调用者提交的已接纳身份或复制的资源令牌替代此操作。',
      '沿用上述原生所有者；该操作不构造应用宿主，也不转移其物理所有权。'
    ]
  }),
  'rpc-host:plugin:createAdapterDeployment': guide({
    purposeEn:
      'A transport package publishes cold raw open, listener or managed-binding operations. Host retains endpoint construction, negotiation and accepted-session cleanup.',
    purposeZh:
      '传输包要发布冷的原始打开、监听或受监督绑定操作。宿主保留端点构造、协商及已接纳会话清理；定义只提供实际原始来源，不接收伪造的已接纳能力。',
    quickStart:
      "import { createAdapterDeployment } from '@migaia/rpc-host/plugin'\n\nimport type { IAdapterDeploymentRecipe } from '@migaia/rpc-host/plugin'\n\n/** Publish cold raw operations; Host calls them with its genuine identity and cancellation context. */\nexport function deploymentFor(recipe: IAdapterDeploymentRecipe): ReturnType<typeof createAdapterDeployment> {\n  return createAdapterDeployment(recipe)\n}\n// recipe.open returns an accepted raw source receipt, never a complete Peer or another endpoint.",
    useEn: [
      'A transport package publishes cold raw open, listener or managed-binding operations.',
      'The adapter must contribute its raw resource to the one endpoint owned by createRpcHost.'
    ],
    useZh: [
      '传输包要发布冷的原始打开、监听或受监督绑定操作。',
      '适配器必须把原始资源交给 createRpcHost 拥有的唯一端点。'
    ],
    avoidEn: [
      'Do not return a complete Peer or construct a second endpoint inside the opener.',
      'Do not copy the opaque deployment token to claim another source identity.'
    ],
    avoidZh: [
      '不要在打开函数中返回完整 Peer 或另建第二个端点。',
      '不要复制不透明部署令牌以声称另一来源身份。'
    ]
  }),
  'rpc-host:plugin:defineByteAdapter': guide({
    purposeEn:
      'A native carrier exposes ordered bytes and needs canonical framed control negotiation. Host retains endpoint construction, negotiation and accepted-session cleanup.',
    purposeZh:
      '原生载体提供有序字节，需要规范分帧控制协商。宿主保留端点构造、协商及已接纳会话清理；定义只提供实际原始来源，不接收伪造的已接纳能力。',
    quickStart:
      "import { defineByteAdapter } from '@migaia/rpc-host/plugin'\n\nimport { createRuntimeByteConnection } from '@migaia/rpc-host/plugin'\n\ntype IByteIO = Parameters<typeof createRuntimeByteConnection>[0]\n\n// The physical owner supplies actual ordered bytes; canonical control framing stays in Host.\nconst byteAdapter: ReturnType<typeof defineByteAdapter<IByteIO>> = defineByteAdapter<IByteIO>({ open: io => io })\nexport function connectedBytes(io: IByteIO): ReturnType<typeof byteAdapter.deployment> {\n  return byteAdapter.deployment({ connect: io })\n}",
    useEn: [
      'A native carrier exposes ordered bytes and needs canonical framed control negotiation.',
      'The adapter must contribute its raw resource to the one endpoint owned by createRpcHost.'
    ],
    useZh: [
      '原生载体提供有序字节，需要规范分帧控制协商。',
      '适配器必须把原始资源交给 createRpcHost 拥有的唯一端点。'
    ],
    avoidEn: [
      'Do not return a complete Peer or construct a second endpoint inside the opener.',
      'Do not copy the opaque deployment token to claim another source identity.'
    ],
    avoidZh: [
      '不要在打开函数中返回完整 Peer 或另建第二个端点。',
      '不要复制不透明部署令牌以声称另一来源身份。'
    ]
  }),
  'rpc-host:plugin:defineMessageAdapter': guide({
    purposeEn:
      'A native port needs the existing message capture and negotiation owner. Host retains endpoint construction, negotiation and accepted-session cleanup.',
    purposeZh:
      '原生端口需要复用既有消息捕获及协商所有者。宿主保留端点构造、协商及已接纳会话清理；定义只提供实际原始来源，不接收伪造的已接纳能力。',
    quickStart:
      "import { defineMessageAdapter } from '@migaia/rpc-host/plugin'\n\nimport type { IMessageAdapterPort } from '@migaia/rpc-host/plugin'\n\n// Opening returns a native port only. The definition owns canonical message preparation.\nconst messageAdapter: ReturnType<typeof defineMessageAdapter<IMessageAdapterPort>> = defineMessageAdapter<IMessageAdapterPort>({ open: port => port })\nexport function connectedMessages(port: IMessageAdapterPort): ReturnType<typeof messageAdapter.deployment> {\n  return messageAdapter.deployment({ connect: port })\n}",
    useEn: [
      'A native port needs the existing message capture and negotiation owner.',
      'The adapter must contribute its raw resource to the one endpoint owned by createRpcHost.'
    ],
    useZh: [
      '原生端口需要复用既有消息捕获及协商所有者。',
      '适配器必须把原始资源交给 createRpcHost 拥有的唯一端点。'
    ],
    avoidEn: [
      'Do not return a complete Peer or construct a second endpoint inside the opener.',
      'Do not copy the opaque deployment token to claim another source identity.'
    ],
    avoidZh: [
      '不要在打开函数中返回完整 Peer 或另建第二个端点。',
      '不要复制不透明部署令牌以声称另一来源身份。'
    ]
  }),
  'rpc-host:index:isRpcError': guide({
    purposeEn:
      'Recognize a structurally coded RPC error for diagnostics, without relying on one JavaScript realm.',
    purposeZh:
      '识别带领域及错误码的 RPC 诊断，不要求错误来自同一个 JavaScript realm。只读取诊断，不改变原对象，也不授予重试或取消权限。',
    quickStart:
      "import { isRpcError } from '@migaia/rpc-host'\n\n/** Keep the original failure for reporting or rethrowing. */\nexport function classifyFailure(error: unknown) {\n  if (isRpcError(error)) return { source: error.source, code: error.code }\n  return { message: String(error) }\n}",
    useEn: [
      'An application must classify the actual failure before displaying a diagnostic.',
      'A cross-realm error cannot safely be classified with instanceof alone.'
    ],
    useZh: [
      '应用需要先分类实际失败，再展示诊断。',
      '跨 realm 错误无法只通过 instanceof 安全分类。'
    ],
    avoidEn: [
      'Do not infer permission to retry non-idempotent work from this diagnostic check.',
      'Do not replace or discard the original error after classifying it.'
    ],
    avoidZh: ['不要由此诊断判断推导非幂等工作的重试权限。', '分类后不要替换或丢弃原始错误。']
  }),
  'rpc-host:index:isRpcErrorInstance': guide({
    purposeEn:
      'Recognize the supported Core error family and code, including admitted cross-realm diagnostics.',
    purposeZh:
      '识别受支持的 Core 错误家族及错误码，包括可接纳的跨 realm 诊断。只读取诊断，不改变原对象，也不授予重试或取消权限。',
    quickStart:
      "import { isRpcErrorInstance } from '@migaia/rpc-host'\n\n/** Keep the original failure for reporting or rethrowing. */\nexport function classifyFailure(error: unknown) {\n  if (isRpcErrorInstance(error)) return { source: error.source, code: error.code, message: error.message }\n  return { message: String(error) }\n}",
    useEn: [
      'An application must classify the actual failure before displaying a diagnostic.',
      'A cross-realm error cannot safely be classified with instanceof alone.'
    ],
    useZh: [
      '应用需要先分类实际失败，再展示诊断。',
      '跨 realm 错误无法只通过 instanceof 安全分类。'
    ],
    avoidEn: [
      'Do not infer permission to retry non-idempotent work from this diagnostic check.',
      'Do not replace or discard the original error after classifying it.'
    ],
    avoidZh: ['不要由此诊断判断推导非幂等工作的重试权限。', '分类后不要替换或丢弃原始错误。']
  }),
  'rpc-host:index:isRpcRemoteError': guide({
    purposeEn:
      'Identify a received remote failure while retaining its remote semantic code and cause graph.',
    purposeZh:
      '识别收到的远端失败，同时保留其远端语义错误码及原因图。只读取诊断，不改变原对象，也不授予重试或取消权限。',
    quickStart:
      "import { isRpcRemoteError } from '@migaia/rpc-host'\n\n/** Keep the original failure for reporting or rethrowing. */\nexport function classifyFailure(error: unknown) {\n  if (isRpcRemoteError(error)) return { source: error.source, code: error.code, message: error.message }\n  return { message: String(error) }\n}",
    useEn: [
      'An application must classify the actual failure before displaying a diagnostic.',
      'A cross-realm error cannot safely be classified with instanceof alone.'
    ],
    useZh: [
      '应用需要先分类实际失败，再展示诊断。',
      '跨 realm 错误无法只通过 instanceof 安全分类。'
    ],
    avoidEn: [
      'Do not infer permission to retry non-idempotent work from this diagnostic check.',
      'Do not replace or discard the original error after classifying it.'
    ],
    avoidZh: ['不要由此诊断判断推导非幂等工作的重试权限。', '分类后不要替换或丢弃原始错误。']
  }),
  'rpc-host:index:isRpcTimeoutError': guide({
    purposeEn:
      'Identify an actual RPC deadline failure before choosing timeout-specific user feedback.',
    purposeZh:
      '识别实际 RPC 期限失败，再选择对应的用户提示。只读取诊断，不改变原对象，也不授予重试或取消权限。',
    quickStart:
      "import { isRpcTimeoutError } from '@migaia/rpc-host'\n\n/** Keep the original failure for reporting or rethrowing. */\nexport function classifyFailure(error: unknown) {\n  if (isRpcTimeoutError(error)) return { source: error.source, code: error.code, message: error.message }\n  return { message: String(error) }\n}",
    useEn: [
      'An application must classify the actual failure before displaying a diagnostic.',
      'A cross-realm error cannot safely be classified with instanceof alone.'
    ],
    useZh: [
      '应用需要先分类实际失败，再展示诊断。',
      '跨 realm 错误无法只通过 instanceof 安全分类。'
    ],
    avoidEn: [
      'Do not infer permission to retry non-idempotent work from this diagnostic check.',
      'Do not replace or discard the original error after classifying it.'
    ],
    avoidZh: ['不要由此诊断判断推导非幂等工作的重试权限。', '分类后不要替换或丢弃原始错误。']
  }),

  'rpc-contract:framing-jsonrpc:checkJsonRpcDescription': guide({
    purposeEn:
      'Validate an untrusted JSON-RPC method directory as portable protocol data. A success returns the checked snapshot; a failure returns a structured reason and path without constructing a host.',
    purposeZh:
      '将不可信JSON-RPC 方法目录作为可移植协议数据校验，成功返回已检查快照，失败返回结构化原因和路径；不构造宿主或接纳实际通道。',
    quickStart:
      "import { checkJsonRpcDescription } from '@migaia/rpc-contract/framing/jsonrpc';\n\nexport function inspectDirectory(received: unknown) {\n  const checked = checkJsonRpcDescription(received)\n  if (!checked.ok) return { reason: checked.reason, path: checked.path }\n  return checked.value\n}",
    useEn: [
      'A protocol implementation receives a JSON-RPC method directory before exposing its methods.',
      'A conformance tool needs the canonical reason and path for invalid wire data.'
    ],
    useZh: [
      '协议实现要先检查收到的JSON-RPC 方法目录，再展示方法。',
      '一致性工具需要非法线路数据的规范原因及路径。'
    ],
    avoidEn: [
      'Do not treat a checked data snapshot as live session or authentication authority.',
      'Do not create a second remote validator with different getter or portable-value rules.'
    ],
    avoidZh: [
      '不要把已检查数据快照当作活动会话或认证权限。',
      '不要另建具有不同访问器或可移植值规则的远端校验器。'
    ]
  }),
  'rpc-contract:remote:checkRemoteHostCatalog': guide({
    purposeEn:
      'Validate an untrusted remote host catalog as portable protocol data. A success returns the checked snapshot; a failure returns a structured reason and path without constructing a host.',
    purposeZh:
      '将不可信远端宿主目录作为可移植协议数据校验，成功返回已检查快照，失败返回结构化原因和路径；不构造宿主或接纳实际通道。',
    quickStart:
      "import { checkRemoteHostCatalog } from '@migaia/rpc-contract/remote';\n\nexport function inspectDirectory(received: unknown) {\n  const checked = checkRemoteHostCatalog(received)\n  if (!checked.ok) return { reason: checked.reason, path: checked.path }\n  return checked.value\n}",
    useEn: [
      'A protocol implementation receives a remote host catalog before exposing its methods.',
      'A conformance tool needs the canonical reason and path for invalid wire data.'
    ],
    useZh: [
      '协议实现要先检查收到的远端宿主目录，再展示方法。',
      '一致性工具需要非法线路数据的规范原因及路径。'
    ],
    avoidEn: [
      'Do not treat a checked data snapshot as live session or authentication authority.',
      'Do not create a second remote validator with different getter or portable-value rules.'
    ],
    avoidZh: [
      '不要把已检查数据快照当作活动会话或认证权限。',
      '不要另建具有不同访问器或可移植值规则的远端校验器。'
    ]
  }),
  'rpc-contract:runtime:checkRuntimeDescription': guide({
    purposeEn:
      'Validate an untrusted runtime method description as portable protocol data. A success returns the checked snapshot; a failure returns a structured reason and path without constructing a host.',
    purposeZh:
      '将不可信运行时方法描述作为可移植协议数据校验，成功返回已检查快照，失败返回结构化原因和路径；不构造宿主或接纳实际通道。',
    quickStart:
      "import { checkRuntimeDescription } from '@migaia/rpc-contract/runtime';\n\nexport function inspectDirectory(received: unknown) {\n  const checked = checkRuntimeDescription(received)\n  if (!checked.ok) return { reason: checked.reason, path: checked.path }\n  return checked.value\n}",
    useEn: [
      'A protocol implementation receives a runtime method description before exposing its methods.',
      'A conformance tool needs the canonical reason and path for invalid wire data.'
    ],
    useZh: [
      '协议实现要先检查收到的运行时方法描述，再展示方法。',
      '一致性工具需要非法线路数据的规范原因及路径。'
    ],
    avoidEn: [
      'Do not treat a checked data snapshot as live session or authentication authority.',
      'Do not create a second remote validator with different getter or portable-value rules.'
    ],
    avoidZh: [
      '不要把已检查数据快照当作活动会话或认证权限。',
      '不要另建具有不同访问器或可移植值规则的远端校验器。'
    ]
  }),
  'rpc-contract:remote:checkRemoteControlShape': guide({
    purposeEn:
      'Validate one received control payload against the selected canonical definition and return portable data or a structured failure. The check invokes no control operation and grants no session authority.',
    purposeZh:
      '根据所选规范控制定义校验收到的负载，返回规范可移植数据或带原因与路径的结构化失败诊断。校验不执行控制操作，也不授予会话权限。',
    quickStart:
      "import { checkRemoteControlShape } from '@migaia/rpc-contract/remote'\n\nexport function inspectControl(definition: Parameters<typeof checkRemoteControlShape>[0], received: unknown) {\n  return checkRemoteControlShape(definition, received)\n}",
    useEn: [
      'A control dispatcher validates received data before dispatch.',
      'A foreign implementation needs the same shape failure reasons as TypeScript.'
    ],
    useZh: [
      '控制分发器需要先校验收到的数据再分发。',
      '外语实现需要与 TypeScript 一致的形状失败原因。'
    ],
    avoidEn: [
      'Do not dispatch a control operation merely because its payload is portable.',
      'Do not use a caller-written lookalike definition to bypass the actual protocol whitelist.'
    ],
    avoidZh: ['不要仅因负载可移植就分发控制操作。', '不要用调用者仿造的定义绕过实际协议白名单。']
  }),
  'rpc-contract:remote:sameRemoteContract': guide({
    purposeEn:
      'Compare two checked contract snapshots using canonical semantic equality and return whether their descriptions are equivalent. This compares contract data only and does not establish compatibility with a live peer.',
    purposeZh:
      '按规范语义比较两份已检查的契约快照，返回两份契约描述是否等价的布尔结果。该操作只比较契约数据，不建立与活动对端的兼容性，也不授予远端能力。',
    quickStart:
      "import { checkRemoteContract, sameRemoteContract } from '@migaia/rpc-contract/remote'\n\nexport function equalContracts(left: unknown, right: unknown) {\n  const a = checkRemoteContract(left)\n  const b = checkRemoteContract(right)\n  return a.ok && b.ok && sameRemoteContract(a.value, b.value)\n}",
    useEn: [
      'A cache compares two admitted contract descriptions.',
      'A conformance test compares equivalent independently materialized snapshots.'
    ],
    useZh: ['缓存需要比较两份已接纳契约描述。', '一致性测试需要比较独立物化但等价的快照。'],
    avoidEn: [
      'Do not compare unchecked objects with getters instead of obtaining canonical snapshots.',
      'Do not infer live-session identity from equal contract data.'
    ],
    avoidZh: [
      '不要跳过规范快照而直接比较带访问器的未检查对象。',
      '不要从契约数据相等推导活动会话身份。'
    ]
  })
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

/** Native author guides describe the actual carrier and launcher ownership boundary. */
const rpcNativeAuthorGuides = {
  'rpc-plugin-process:index:isProcessChild': guide({
    purposeEn:
      "Synchronously classifies whether this entry was launched with the library's process bootstrap marker, so a self-spawning entry can choose parent or child work. It remembers an observed marker after discovery consumes it; it does not authenticate the parent.",
    purposeZh:
      '同步判断当前入口是否带有库的进程 bootstrap 标记启动，让自重启入口选择父端或子端工作。发现流程消耗标记后会记住已识别结果，但该判断不认证父进程。',
    quickStart:
      "import { isProcessChild, processPlugin } from '@migaia/rpc-plugin-process'\n\n/** The same entry runs again in the child; select one source before parent-only work. */\nexport function sourceForThisEntry() {\n  return isProcessChild()\n    ? processPlugin({ connectToParent: true })\n    : processPlugin({ spawn: true })\n}\n// Pass the returned plugin to createRpcHost.\n// connectToParent still consumes and validates the real launch bootstrap.",
    useEn: [
      'A spawn:true entry must avoid running parent-only initialization again inside its child.',
      'The same executable chooses a genuine connectToParent source after library-controlled process launch.'
    ],
    useZh: [
      'spawn:true 的入口必须避免在子进程中再次运行仅属于父端的初始化。',
      '同一可执行入口需要在库控制的进程启动后选择真实 connectToParent 来源。'
    ],
    avoidEn: [
      'An arbitrary child process is being detected; unrelated children without this marker return false.',
      'The result is used as authentication or source authority; actual bootstrap and handshake admission remain necessary.'
    ],
    avoidZh: [
      '要检测任意子进程；没有此标记的无关子进程会返回 false。',
      '把返回值用于认证或授予来源权限；真实 bootstrap 和握手准入仍然不可省略。'
    ]
  }),

  'rpc-plugin-thread:index:isThreadChild': guide({
    purposeEn:
      'Asynchronously identifies a genuine library-launched native thread child before a self-spawning entry chooses its branch. Node uses actual parentPort/workerData; Bun/Deno workers may first await captured bootstrap. This is discovery, not capability authority.',
    purposeZh:
      '在自重启入口选择分支前，异步识别真实由库启动的原生线程子端。Node 读取实际 parentPort/workerData，Bun/Deno Worker 可能先等待已捕获的 bootstrap。它负责发现，不授予 capability 权限。',
    quickStart:
      "import { isThreadChild, threadPlugin } from '@migaia/rpc-plugin-thread'\n\n/** Await before parent-only work; a Bun/Deno child may still be receiving its initial bootstrap. */\nexport async function sourceForThisEntry() {\n  return (await isThreadChild())\n    ? threadPlugin({ connectToParent: true })\n    : threadPlugin({ spawn: true })\n}\n// Pass the returned plugin to createRpcHost.\n// Native main threads return false; an unrelated browser Worker is not a thread child.",
    useEn: [
      'A spawn:true thread entry must avoid recursively executing parent-only initialization.',
      'One Node/Bun/Deno entry chooses a genuine connectToParent source while retaining the original bootstrap owner.'
    ],
    useZh: [
      'spawn:true 的线程入口必须避免递归执行仅属于父端的初始化。',
      '同一 Node/Bun/Deno 入口需要选择真实 connectToParent 来源，并保留原来的 bootstrap 所有者。'
    ],
    avoidEn: [
      'The Promise is tested without await; a Promise object cannot classify the current execution branch.',
      'The caller wants to classify any browser Worker or bypass handshake authority; invalid/missing worker bootstrap may reject.'
    ],
    avoidZh: [
      '未 await 就判断 Promise；Promise 对象不能用来区分当前执行分支。',
      '要识别任意浏览器 Worker，或绕过握手权限；无效、缺失 Worker bootstrap 可能导致拒绝。'
    ]
  })
} satisfies Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>>

export const rpcApiGuides = {
  'rpc-host:features-auth:authFeature': authFeatureGuide,
  'rpc-host:features-chunk:chunkFeature': chunkFeatureGuide,
  'rpc-host:features-retry:retryFeature': retryFeatureGuide,
  'rpc-host:features-timeout:timeoutFeature': timeoutFeatureGuide,
  'rpc-host:features-typegen:typegenFeature': typegenFeatureGuide,
  'rpc-host:plugin:defaultRpcReporter': rpcDefaultReporterGuide,
  'rpc-host:plugin:IpcReporterContext': rpcProbeGuides['rpc-host:probe:IpcReporterContext'],
  'rpc-plugin-process:features:IpcSendClass': processSendClassGuide,
  'rpc-plugin-process:features-flow-control:IpcSendClass': processSendClassGuide,
  'rpc-host:plugin:IpcSendClass': processSendClassGuide,
  'rpc-plugin-process:features:IpcLogEventName': processLogEventGuide,
  'rpc-plugin-process:features-flow-control:IpcLogEventName': processLogEventGuide,
  'rpc-host:plugin:IpcLogEventName': processLogEventGuide,
  'rpc-plugin-process:features:sendQueueFeature': processSendQueueGuide,
  'rpc-plugin-process:features-send-queue:sendQueueFeature': processSendQueueGuide,
  'rpc-plugin-process:features-send-queue:default': processSendQueueGuide,
  'rpc-plugin-process:features:ipcLogFeature': processIpcLogGuide,
  'rpc-plugin-process:features-log:ipcLogFeature': processIpcLogGuide,
  'rpc-plugin-process:features-log:default': processIpcLogGuide,

  'rpc-host:index:defaultRpcReporter': rpcDefaultReporterGuide,
  'rpc-host:plugin:serializeRpcError': guide({
    purposeEn:
      'Encodes a held Core or Remote error as bounded protocol data using its existing presentation and forwarding-route policy. Custom carriers retain the local error and cause while sending the same controlled diagnostic fields as the built-in transport.',
    purposeZh:
      '按原诊断与 forwarding-route 策略，把持有的 Core 或 Remote 错误编码为有界协议数据。自定义载体保留本地错误及 cause，线上使用与内置 transport 相同的受控诊断字段。',
    quickStart:
      "import { attachErrorIdentity } from '@migaia/utils/error'\nimport { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\n\n/** This adapter owns its semantic identity and display wording. */\nconst ADAPTER_SOURCE = 'example.custom.ipc'\n/** A native write failure never claims a Core timeout or cancellation. */\nconst AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const\n/** Keep private native details on cause rather than quoting payload bytes. */\nconst AdapterErrorText = { writeFailed: 'adapter write failed' } as const\n\n/** Project an actual native write failure using this adapter's own identity. */\nexport function projectWriteFailure(cause: unknown) {\n  const original = attachErrorIdentity(new Error(AdapterErrorText.writeFailed, { cause }), {\n    source: ADAPTER_SOURCE, code: AdapterErrorCode.writeFailed\n  })\n  const wire = serializeRpcError(original, { report: ({ error }) => console.error(error) })\n  return { original, wire }\n}\n\n/** Reconstruct received error data without minting Core's private operation identity. */\nexport function receiveFailure(received: unknown) {\n  return deserializeRpcError(received)\n}\n// The serializer keeps Core/Remote disclosure and forwarding routes for actual held errors.\n// A wire source/code/name and a restored error never authorize retry, cancellation or close.",
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
  'rpc-host:plugin:deserializeRpcError': guide({
    purposeEn:
      'Validates received error protocol data and restores its native error graph without replacing the transmitted stack. Core retains the admitted route for subsequent forwarding or re-encoding by a custom carrier.',
    purposeZh:
      '校验接收到的错误协议数据并恢复原生错误图，不替换传来的 stack。Core 持有已接纳的 route，供自定义载体随后转发或重新编码同一个错误。',
    quickStart:
      "import { attachErrorIdentity } from '@migaia/utils/error'\nimport { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\n\n/** This adapter owns its semantic identity and display wording. */\nconst ADAPTER_SOURCE = 'example.custom.ipc'\n/** A native write failure never claims a Core timeout or cancellation. */\nconst AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const\n/** Keep private native details on cause rather than quoting payload bytes. */\nconst AdapterErrorText = { writeFailed: 'adapter write failed' } as const\n\n/** Project an actual native write failure using this adapter's own identity. */\nexport function projectWriteFailure(cause: unknown) {\n  const original = attachErrorIdentity(new Error(AdapterErrorText.writeFailed, { cause }), {\n    source: ADAPTER_SOURCE, code: AdapterErrorCode.writeFailed\n  })\n  const wire = serializeRpcError(original, { report: ({ error }) => console.error(error) })\n  return { original, wire }\n}\n\n/** Reconstruct received error data without minting Core's private operation identity. */\nexport function receiveFailure(received: unknown) {\n  return deserializeRpcError(received)\n}\n// The serializer keeps Core/Remote disclosure and forwarding routes for actual held errors.\n// A wire source/code/name and a restored error never authorize retry, cancellation or close.",
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
  'rpc-host:index:RPC_CORE_ERROR_SOURCE': guide({
    purposeEn:
      'Provides the stable @migaia/rpc/core diagnostic source. Compare it with the public code table on validated received error data; it is not a credential or proof of local Core construction.',
    purposeZh:
      '提供稳定的 @migaia/rpc/core 诊断 source。在已校验的接收错误数据上与公开 code 表一起比较；它不是凭据，也不证明本地 Core 构造身份。',
    quickStart:
      "import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-host'\nimport { normalizeRpcSerializedError } from '@migaia/rpc-contract/errors'\n\n/** Classify a received diagnostic tree after the wire grammar accepts it. */\nexport function reportCoreDeadline(received: unknown) {\n  const wire = normalizeRpcSerializedError(received)\n  if (wire.source === RPC_CORE_ERROR_SOURCE && wire.code === RpcCoreErrorCode.deadlineExceeded) {\n    console.error(wire)\n  }\n  return wire\n}\n// The pair reports the failure; actual execution/outcome controls any retry decision.",
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
  'rpc-host:index:RpcLifecycleError': guide({
    purposeEn:
      "Represents failure after disposal of the caller's own resource. StoreWorker uses this public constructor after its real disposePromise starts and retains cleanup failures through cause/cleanupErrors. Construction supplies diagnostics, never Core private operation identity.",
    purposeZh:
      '表示调用方自己的资源开始 disposal 后发生的失败。StoreWorker 在真实 disposePromise 开始后使用这个公开构造器，并通过 cause/cleanupErrors 保留清理失败。构造只提供诊断，不产生 Core 操作私有身份。',
    quickStart:
      "import { RpcLifecycleError } from '@migaia/rpc-host'\n\n/** The resource owner supplies its actual disposal promise and owned display text. */\nexport function rejectAfterDisposal(disposePromise: Promise<void> | undefined, message: string) {\n  if (disposePromise !== undefined) throw new RpcLifecycleError(message)\n}\n// StoreWorker's workerParser uses this pattern before request/stream dispatch.\n// Construction cannot retire another Core generation or authorize a close.",
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

  'rpc-contract:remote:checkRemoteContract': guide({
    purposeEn:
      'Checks received remote contract metadata, returning a canonical snapshot or a diagnostic with the stable RpcShapeReason and path. It neither opens resources nor changes host state. The shipped method schema subset is inert data, with bounded local references only.',
    purposeZh:
      '通过纯协议校验收到的远端契约元数据，成功返回规范快照，失败返回带稳定原因与路径的诊断。校验既不打开资源，也不改变 host 状态。随包方法 schema 子集是惰性数据，仅支持有界本地引用。',
    quickStart:
      "import { checkRemoteContract } from '@migaia/rpc-contract/remote'\n\nexport function inspectContract(received: unknown) {\n  const result = checkRemoteContract(received)\n  if (!result.ok) console.error(result.reason, result.path)\n  return result\n}",
    useEn: [
      'A protocol receiver checks remote declarations before consuming them.',
      'The same grammar must apply across host and foreign runtime implementations.'
    ],
    useZh: ['协议接收端消费远端声明前先校验。', 'host 与外部 runtime 实现必须使用同一形状语法。'],
    avoidEn: [
      'Do not use schema data as executable validation code or grant resource authority.',
      'Do not replace native owner errors with a structural checker failure.'
    ],
    avoidZh: [
      '不能把 schema 数据作为可执行验证程序或授予资源权限。',
      '不要用结构 checker 失败替换原生 owner 错误。'
    ]
  }),

  'rpc-host:index:createRpcHost': guide({
    purposeEn:
      'Creates one host with exactly one transport plugin and optional features. Untargeted calls return empty target maps, one scalar, or per-target results for zero, one, or many direct peers. send and dispatch select only live direct targets.',
    purposeZh:
      '用恰好一个传输 plugin 和可选 features 创建单个 host。不指定目标时，零、一、多个直连对端分别返回空目标记录、单值或逐目标结果；send 和 dispatch 只选择当前存活的直连对端。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await host.request('double', 21))\n} finally {\n  await host.close()\n}",
    useEn: [
      'An application combines one physical source with its providers and optional features.',
      'A multi-peer listener needs fanout calls and direct-target send on one endpoint.'
    ],
    useZh: [
      '应用把一个物理来源与自己的提供方及可选功能组合。',
      '多对端监听器需要在一个端点上执行广播及直连目标单发。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-plugin-process:index:processPlugin': guide({
    purposeEn:
      'Connects a real process source: spawn, connect, listen, or connectToParent. Named rendezvous connectTimeoutMs and the SDK handshake connect.timeoutMs are distinct budgets.',
    purposeZh:
      '连接真实进程来源：spawn、connect、listen 或 connectToParent。命名发现的 connectTimeoutMs 与 SDK 握手的 connect.timeoutMs 是独立预算。',
    quickStart:
      "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst name = 'orders-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: name })],\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const client = await createRpcHost<{ double(value: number): number }>({\n    self: { name: 'dashboard', instanceId: randomUUID() },\n    plugins: [processPlugin({ connectTimeoutMs: 1500, connect: { target: name, timeoutMs: 1000 } })],\n    provide: { label: () => 'orders-dashboard' }\n  })\n  try {\n    console.log(await client.request('double', 21))\n    console.log(await server.send('dashboard', 'label'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}\n// connectTimeoutMs bounds rendezvous; connect.timeoutMs independently bounds the handshake.",
    useEn: [
      'A native child must be spawned with its original execution and restart owner.',
      'A process listener or named/socket client must exchange calls in both directions.'
    ],
    useZh: [
      '原生子进程需要沿原执行及重启所有者启动。',
      '进程监听器或命名、socket 客户端需要双向调用。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-plugin-thread:index:threadPlugin': guide({
    purposeEn:
      'Launches a native Node, Bun, or Deno thread, or joins its actual parent with connectToParent: true. Browser Workers use the browser plugin.',
    purposeZh:
      '启动原生 Node、Bun 或 Deno 线程，或用 connectToParent: true 接入真实父端；浏览器 Worker 使用 browser plugin。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin } from '@migaia/rpc-plugin-thread'\n\n// Parent module: entry names the real worker module for the selected native runtime.\nexport async function runThread(entry: string) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: entry, connect: { timeoutMs: 1500 } })],\n    provide: { label: () => 'orders-parent' }\n  })\n  try { return await host.request('double', 21) }\n  finally { await host.close() }\n}\n\n// Worker module: its application supplies its shutdown Promise; use true only inside a real child.\nexport async function serveThread(shutdown: Promise<void>) {\n  const host = await createRpcHost<{ label(): string }>({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try { console.log(await host.request('label')); await shutdown }\n  finally { await host.close() }\n}\n// threadPlugin supports Node/Bun/Deno workers; browser Worker sources use rpc-plugin-browser.",
    useEn: [
      'A Node, Bun or Deno worker runs an isolated application provider.',
      'The parent must retain native restart, replacement and worker termination ownership.'
    ],
    useZh: [
      'Node、Bun 或 Deno Worker 运行隔离的应用提供方。',
      '父端必须保留原生重启、替换及线程终止所有权。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-plugin-coroutines:index:coroutinePlugin': guide({
    purposeEn:
      'Runs a cooperative task in the same event loop. The child joins with the actual generation-local opaque connect handle, never true. Task lifetime and call cancellation remain distinct.',
    purposeZh:
      '在同一事件循环执行协作任务。子端使用该代实际 opaque connect 句柄接入，不能传 true；任务生命周期与调用取消相互独立。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}",
    useEn: [
      'A supervised task must expose methods without another operating-system process.',
      'The child uses the exact opaque connect handle received by its task.'
    ],
    useZh: [
      '受监督任务需要在不新增操作系统进程的情况下提供方法。',
      '子端需要使用任务实际收到的精确不透明连接句柄。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-plugin-pool:index:poolPlugin': guide({
    purposeEn:
      'Adds the existing bounded scheduler to repeatedly openable transport members. Only the logical target pool is public; every operation selects one member and returns a scalar. controls(host) reads that installation.',
    purposeZh:
      '为能反复打开成员的传输安装已有有界调度器。仅公开逻辑目标 pool，每个操作选择一个成员并返回单值；controls(host) 读取对应安装的控制能力。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { poolPlugin } from '@migaia/rpc-plugin-pool'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const pool = poolPlugin({ size: 3, maxQueue: 32 })\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true }), pool]\n  })\n  try {\n    console.log(await host.request('double', 21))\n    console.log(await host.send('pool', 'double', 21))\n    await pool.controls(host).resize(2)\n    console.log(pool.controls(host).stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
    useEn: [
      'Repeated managed sources need bounded queueing and the existing member scheduler.',
      'Each call must execute once while exposing only the logical pool target.'
    ],
    useZh: [
      '重复打开的受监督来源需要有界排队及既有成员调度器。',
      '每次调用必须只执行一次，且只公开 pool 逻辑目标。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-plugin-devtools:index:devtoolsPlugin': guide({
    purposeEn:
      'Installs the original collector as a feature on a business host. Host closure removes its observation; the application closes tools.collector after all observation ends.',
    purposeZh:
      '以 feature 在业务 host 安装原 collector。host 关闭撤销该 host 的观察，所有观察结束后由应用关闭 tools.collector。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\n// transport connects to an application peer providing readBalance.\nexport async function inspectBalance(transport: IRpcTransportPlugin) {\n  const tools = devtoolsPlugin({ maxEvents: 1000 })\n  const collector = tools.collector\n  const host = await createRpcHost<{ readBalance(): number }>({ plugins: [transport, tools] })\n  const recording = collector.record({ maxEvents: 2000 })\n  try {\n    console.log(await host.request('readBalance'))\n    collector.pause()\n    console.log(collector.describe().paused)\n    collector.resume()\n    console.log(collector.describe().paused)\n    return collector.exportRecord(recording.stop())\n  } finally {\n    recording.stop()\n    await host.close() // removes only this host's observation\n    collector.close() // the application owns the collector\n  }\n}",
    useEn: [
      'A business host needs bounded live event collection without changing its results.',
      'Several hosts share one application-owned collector and independent observation lifetimes.'
    ],
    useZh: [
      '业务宿主需要有界实时事件收集，又不改变业务结果。',
      '多个宿主共享应用拥有的收集器，各自保持独立观察寿命。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-plugin-browser:index:windowPlugin': guide({
    purposeEn:
      'Calls an iframe or other actual Window while checking the exact native source and configured origin. Each side supplies its own receiving Window and the other side as its sending target. Closing the host removes RPC listeners; it never navigates or closes either Window.',
    purposeZh:
      '通过实际 Window 与 iframe 调用，同时核对原生来源和显式 origin。双方分别配置本地 receiver 与对端发送目标；关闭 host 只移除 RPC 监听，不导航或关闭窗口。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\n// Page: target is the actual iframe Window; origin is its exact expected origin.\nexport async function readFrameTitle(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n    provide: { parentLabel: () => 'dashboard' }\n  })\n  try { return await host.request('title') }\n  finally { await host.close() }\n}\n\n// Iframe module: call with window.parent, the parent origin and its shutdown Promise.\nexport async function serveFrame(parent: Window, origin: string, shutdown: Promise<void>) {\n  const host = await createRpcHost<{ parentLabel(): string }>({\n    plugins: [windowPlugin({ window: parent, origin, receiver: window })],\n    provide: { title: () => document.title }\n  })\n  try { console.log(await host.request('parentLabel')); await shutdown }\n  finally { await host.close() }\n}",
    useEn: [
      'Read an iframe title while letting the frame call a parent method.',
      'Keep an exact origin for each connected Window.'
    ],
    useZh: [
      '读取 iframe 标题，同时让子页面调用父页面方法。',
      '为每个 Window 连接保留精确 origin。'
    ],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-plugin-browser:index:dedicatedWorkerPlugin': guide({
    purposeEn:
      'Connects a page Worker and its worker-side self through their existing message API. Both sides provide and request methods on the one connection. The host borrows the Worker; its creator chooses when native termination is appropriate.',
    purposeZh:
      '通过已有消息接口连接页面 Worker 与 Worker 内 self，同一连接两端均可提供并调用方法。host 借用 Worker；原生终止时机仍由创建者决定。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin, type IWorkerPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })],\n    provide: { label: () => 'page' }\n  })\n  try { return await host.request('double', 21) }\n  finally { await host.close() }\n}\n\n// Worker module: scope is self; its creator supplies the eventual shutdown signal.\nexport async function serveDedicated(scope: IWorkerPluginOptions['worker'], shutdown: Promise<void>) {\n  const host = await createRpcHost<{ label(): string }>({\n    plugins: [dedicatedWorkerPlugin({ worker: scope })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try { console.log(await host.request('label')); await shutdown }\n  finally { await host.close() }\n}\n// The creator, not host.close(), eventually calls worker.terminate().",
    useEn: [
      'Move a calculation to a browser Worker.',
      'Call page-provided methods from the worker before it shuts down.'
    ],
    useZh: ['把计算交给浏览器 Worker。', '让 Worker 在结束前调用页面提供的方法。'],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-plugin-browser:index:sharedWorkerPlugin': guide({
    purposeEn:
      'Connects a page through sharedWorker.port or accepts independent connect-event ports with listen. These modes are mutually exclusive. One listener host serves several accepted sessions without closing borrowed ports when another session departs.',
    purposeZh:
      '页面经 sharedWorker.port 接入，Worker 经 listen 接纳独立的 connect 事件端口，两种模式互斥。一个 listener host 服务多个会话，单个会话退出不关闭其他借用端口。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin, type ISharedWorkerPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(sharedWorker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker })],\n    provide: { label: () => 'dashboard' }\n  })\n  try { return await host.request('value') }\n  finally { await host.close() }\n}\n\n// SharedWorker module: supply self and the worker application's shutdown Promise.\nexport async function serveShared(\n  scope: NonNullable<ISharedWorkerPluginOptions['listen']>, shutdown: Promise<void>\n) {\n  const host = await createRpcHost({\n    plugins: [sharedWorkerPlugin({ listen: scope })],\n    provide: { value: () => 42 }\n  })\n  try { await shutdown }\n  finally { await host.close() }\n}\n// Native ports remain borrowed; their original owners choose when to close them.",
    useEn: [
      'Share one provider across several browser tabs.',
      'Keep each accepted port and its cleanup isolated.'
    ],
    useZh: ['让多个标签页共享一个 provider。', '隔离每个接入端口及其清理。'],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-plugin-browser:index:broadcastChannelPlugin': guide({
    purposeEn:
      'Discovers and handshakes independent participants on a borrowed native BroadcastChannel. Wait for accepted readiness before addressed work; a channel name alone is not peer identity. Untargeted calls use the current accepted target set, while send selects one live name or endpoint id.',
    purposeZh:
      '在借用的原生 BroadcastChannel 上发现并握手独立参与者；定向业务前等待已接受的 ready，频道名本身不是对端身份。广播使用当前已接受集合，send 只选一个存活名字或端点 id。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nconst name = 'orders-' + crypto.randomUUID()\nconst leftChannel = new BroadcastChannel(name)\nconst rightChannel = new BroadcastChannel(name)\nconst left = await createRpcHost({\n  self: { name: 'left', instanceId: crypto.randomUUID() },\n  plugins: [broadcastChannelPlugin({ channel: leftChannel })],\n  provide: { echo: (value: string) => value }\n})\ntry {\n  const joined = Promise.withResolvers<void>()\n  const stop = left.on('ready', () => joined.resolve())\n  const right = await createRpcHost({\n    self: { name: 'right', instanceId: crypto.randomUUID() },\n    plugins: [broadcastChannelPlugin({ channel: rightChannel })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try {\n    await joined.promise\n    console.log(await left.send('right', 'double', 21))\n    console.log(await right.request('echo', 'ready'))\n  } finally { stop(); await right.close() }\n} finally {\n  await left.close()\n  leftChannel.close()\n  rightChannel.close()\n}",
    useEn: [
      'Coordinate same-origin tabs after a real join.',
      'Use a direct name for work that must execute on one participant.'
    ],
    useZh: ['在真实 join 后协调同源标签页。', '必须只执行一次的工作按直连名字选择参与者。'],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-plugin-browser:index:serviceWorkerPlugin': guide({
    purposeEn:
      'Separates the page sending ServiceWorker from the receiving ServiceWorkerContainer. The worker accepts clients through native Client.id and clients.get(id), so one client cannot supply another session’s frames. Silent disconnection is observed through existing call deadlines rather than invented native exit events.',
    purposeZh:
      '分离页面发送目标 ServiceWorker 与接收面的 ServiceWorkerContainer。Worker 通过原生 Client.id 和 clients.get(id) 接纳客户端，避免一个客户端冒充另一会话；静默失联沿既有调用 deadline 处理，不伪造退出事件。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin, type IServiceWorkerPluginOptions } from '@migaia/rpc-plugin-browser'\n\n// Page: pass registration.active after the native registration becomes ready.\nexport async function readWorkerVersion(serviceWorker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker, receiver: navigator.serviceWorker })],\n    provide: { pageLabel: () => document.title }\n  })\n  try { return await host.request('version') }\n  finally { await host.close() }\n}\n\n// ServiceWorker module: clients owns native message events and clients.get(id).\nexport async function serveClients(\n  clients: NonNullable<IServiceWorkerPluginOptions['clients']>, shutdown: Promise<void>\n) {\n  const host = await createRpcHost({\n    plugins: [serviceWorkerPlugin({ clients })],\n    provide: { version: () => 'orders-v1' }\n  })\n  try { await shutdown }\n  finally { await host.close() }\n}\n// Registration updates and unregister remain the browser application's responsibility.",
    useEn: [
      'Call the current active ServiceWorker from a page.',
      'Keep two page Clients isolated on one worker listener.'
    ],
    useZh: [
      '从页面调用当前 active ServiceWorker。',
      '在同一个 Worker listener 内隔离两个页面 Client。'
    ],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-plugin-browser:index:rtcDataChannelPlugin': guide({
    purposeEn:
      'Borrows an already-open RTCDataChannel after the application completes signaling. RPC requires ordered reliable delivery: ordered=true and both retransmission/lifetime limits null. Both endpoints run the same provide/request role, and host closure leaves the native channel with its owner.',
    purposeZh:
      '应用完成信令后借用已打开 RTCDataChannel。RPC 要求有序可靠传递：ordered=true，重传次数与包寿命限制均为 null。两端运行相同 provide/request 角色，host 关闭后原生通道仍归原所有者。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\n// Run this role on each side of an already-open, reliable ordered channel.\n// WebRTC signaling and peer connection ownership stay with the application.\nexport async function exchangeRtc(channel: RTCDataChannel, shutdown: Promise<void>) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })],\n    provide: { echo: (value: string) => value }\n  })\n  try {\n    console.log(await host.request('echo', 'orders-ready'))\n    await shutdown\n  } finally {\n    await host.close()\n  }\n}\n// ordered=true, maxRetransmits=null, maxPacketLifeTime=null are required.",
    useEn: [
      'Exchange application methods across an established WebRTC channel.',
      'Retain peer connection lifetime outside the RPC host.'
    ],
    useZh: [
      '通过已建立的 WebRTC 通道交换应用方法。',
      '让 peer connection 生命周期独立于 RPC host。'
    ],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-plugin-browser:index:webTransportPlugin': guide({
    purposeEn:
      'Waits for a borrowed WebTransport session and opens exactly one reliable bidirectional byte stream. The compatible server must implement the byte RPC handshake and directory exchange. Host close cancels its reader and aborts its writer once; the application still owns the WebTransport session.',
    purposeZh:
      '等待借用 WebTransport session，并打开恰好一个可靠双向字节流。对端服务器必须实现 byte RPC 握手和目录交换；host 关闭时释放自身 reader/writer，WebTransport session 仍归应用持有。',
    quickStart:
      "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\n// The HTTP/3 server must speak the compatible reliable byte RPC protocol.\nexport async function readReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })],\n    provide: { clientLabel: () => 'orders-page' }\n  })\n  try { return await host.request('echo', 'orders-ready') }\n  finally { await host.close() }\n}\n// The plugin creates one bidirectional stream and releases its reader/writer.\n// The application owns session.close(); datagrams do not carry this RPC host.\n\n// Compatible HTTP/3 server: its native library supplies the acquired reliable I/O.\nimport { defineByteAdapter, defineTransportPlugin, createRuntimeByteConnection } from '@migaia/rpc-host/plugin'\n\ntype IByteIO = Parameters<typeof createRuntimeByteConnection>[0]\nconst reliableResponder = defineByteAdapter<IByteIO>({ open: io => io, listen: io => io })\nexport async function serveReliableStream(io: IByteIO, shutdown: Promise<void>) {\n  const host = await createRpcHost({\n    plugins: [defineTransportPlugin({\n      name: 'http3-reliable-stream', mode: 'listen',\n      // Local pre-hello routing label; the real peer identity comes from negotiation.\n      deployment: reliableResponder.deployment({ listen: io, peerId: 'webtransport-byte' })\n    })],\n    provide: { echo: (value: string) => value }\n  })\n  try { await shutdown }\n  finally { await host.close() }\n}\n// HTTP/3 session acquisition, authentication and session.close stay with the native server owner.",
    useEn: [
      'Call a compatible HTTP/3 reliable-stream RPC service.',
      'Keep one application session alive while retiring this host’s stream.'
    ],
    useZh: ['调用相容的 HTTP/3 可靠流 RPC 服务。', '结束本 host 的流，同时保留应用 session。'],
    avoidEn: [
      'The supplied native carrier is not ready or does not meet this transport’s delivery contract.',
      'The application needs a different realm or carrier; select its corresponding transport plugin.'
    ],
    avoidZh: [
      '原生载体尚未准备好，或不满足此传输的交付要求。',
      '应用需要不同作用域或载体时，应选择对应传输插件。'
    ]
  }),
  'rpc-host:features:timeoutFeature': timeoutFeatureGuide,
  'rpc-host:features-timeout:default': timeoutFeatureGuide,
  'rpc-host:features:chunkFeature': chunkFeatureGuide,
  'rpc-host:features-chunk:default': chunkFeatureGuide,
  'rpc-host:features:retryFeature': retryFeatureGuide,
  'rpc-host:features-retry:default': retryFeatureGuide,
  'rpc-host:features:authFeature': authFeatureGuide,
  'rpc-host:features-auth:default': authFeatureGuide,
  'rpc-host:features:typegenFeature': typegenFeatureGuide,
  'rpc-host:features-typegen:default': typegenFeatureGuide,
  'rpc-host:plugin:defineTransportPlugin': guide({
    purposeEn:
      'Defines a genuine plugin-host transport object from a cold raw deployment. The same object installs on createRpcHost or an ordinary PluginHost; no complete peer is accepted as a source.',
    purposeZh:
      '从冷 raw deployment 定义真正的 plugin-host 传输对象。同一对象可安装到 createRpcHost 或普通 PluginHost；不能把完整 peer 冒充来源。',
    quickStart:
      "import type { MessagePort } from 'node:worker_threads'\nimport { defineMessageAdapter, defineTransportPlugin } from '@migaia/rpc-host/plugin'\n\nconst messages = defineMessageAdapter({ open: (port: MessagePort) => port })\nexport function portPlugin(port: MessagePort) {\n  return defineTransportPlugin({\n    name: 'port', mode: 'connect',\n    deployment: messages.deployment({ connect: port })\n  })\n}",
    useEn: [
      'Both sides provide real application methods through the same connection.',
      'The host owns calls and closure; the native transport keeps its resource ownership.'
    ],
    useZh: [
      '同一连接两端都提供实际业务方法。',
      'host 管理调用与关闭，原生传输保留自己的资源所有权。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  'rpc-host:plugin:defineFeaturePlugin': guide({
    purposeEn:
      'Defines a genuine feature without creating another call or lifecycle owner. A module-level factory keeps one definition identity across configured instances; installing it twice on one host rejects synchronously.',
    purposeZh:
      '定义真实 feature，不创建另一调用或生命周期 owner。模块级工厂让不同配置实例保持同一定义身份，同一 host 重复安装同步拒绝。',
    quickStart:
      "import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'\n\nexport const applicationTimeout = defineFeaturePlugin((options: { ms: number }) => ({\n  name: 'application-timeout',\n  contribution: { defaultTimeoutMs: options.ms }\n}))",
    useEn: [
      'Both sides provide real application methods through the same connection.',
      'The host owns calls and closure; the native transport keeps its resource ownership.'
    ],
    useZh: [
      '同一连接两端都提供实际业务方法。',
      'host 管理调用与关闭，原生传输保留自己的资源所有权。'
    ],
    avoidEn: [
      'Do not construct a standalone endpoint or complete peer beside this host.',
      'Do not treat reconnection as proof that uncertain non-idempotent work did not execute.'
    ],
    avoidZh: [
      '不要在该 host 旁边另外构造 endpoint 或完整 peer。',
      '不要因为重连成功就认定结果未知的非幂等业务没有执行。'
    ]
  }),
  ...rpcContractGuides,
  ...rpcErrorModuleGuides,
  ...rpcProtocolToolkitGuides,
  ...rpcAdapterGuides,
  ...rpcPublicAuthorGuides,
  ...rpcNativeAuthorGuides,
  ...rpcProbeGuides,
  ...rpcDevtoolsGuides,
  'rpc-contract:errors:RPC_CONTRACT_SOURCE': rpcErrorCatalogGuides.contract,
  'rpc-contract:errors:RpcContractErrorCode': rpcErrorCatalogGuides.contract,
  'rpc-contract:framing-jsonrpc:JSONRPC_BRIDGE_ERROR_SOURCE': rpcErrorCatalogGuides.jsonrpcAdapter,
  'rpc-contract:framing-jsonrpc:JsonRpcBridgeErrorCode': rpcErrorCatalogGuides.jsonrpcAdapter,
  'rpc-host:index:RpcCoreErrorCode': rpcErrorCatalogGuides.core,
  'rpc-host:plugin:RPC_REMOTE_ERROR_SOURCE': rpcErrorCatalogGuides.remote,
  'rpc-plugin-process:index:RpcProcessErrorCode': rpcErrorCatalogGuides.process,
  'rpc-plugin-thread:index:RpcThreadErrorCode': rpcErrorCatalogGuides.threads
} as const
