# `@migaia/rpc-contract`

[English](./README.en.md)

为 RPC 的业务值、消息、握手、分片和错误树建立共同的数据边界，让独立载体与语言实现使用同一套线上规则。

## 你可能遇到过

- 校验后的消息还会被外部修改，根因是只保留原对象或浅拷贝，嵌套记录和字节仍共享。
- 发送前的 NaN 变成了 null，根因是把 JSON 转换结果当成有效业务值。
- 接收端只有一行错误文字，根因是没有传递原生类型、语义码与原因堆栈。
- 生成错误诊断时又因 getter 抛错而丢掉整条记录，根因是没有独立报告字段读取失败。
- 不同对端的同名分片混在一起，根因是重组缓冲只以消息标识作键，没有来源维度。

## 为什么选它

- **校验时就捕获独立载荷。** 浅拷贝仍别名嵌套记录与字节，normalizePortable 复制记录并生成字节标签，后续外部修改不改变快照 [运行证明](./USEGUIDE.md#在调用者修改前捕获数据)。
- **不把非法数字悄悄替换成合法值。** JSON 会把 NaN 改成 null，而 portable 遍历检查全部后代并明确拒绝非有限数与环 [运行证明](./USEGUIDE.md#拒绝在线上传输时会失去原意的值)。
- **跨边界仍能辨认原始错误链。** 只发送 message 会丢失类型和堆栈，错误树工具保留语义码、原生类和发送方的原因堆栈 [运行证明](./USEGUIDE.md#保留原生错误类型与远端原因堆栈)。
- **被省略的错误字段也有诊断依据。** 直接读取可能让异常逃出日志，serializeRpcError 通过必填 report 交出原读取失败并继续生成受大小限制的错误树 [运行证明](./USEGUIDE.md#报告不可读字段并继续生成线上错误)。
- **相同消息标识按来源隔离。** 仅按 messageId 存缓冲会混合对端数据，framer 用来源与消息标识共同保存组装状态 [运行证明](./USEGUIDE.md#隔离不同对端的相同消息标识)。

## 从这里开始

先捕获一份载荷，再修改调用者对象；本例只做本地规范化，不发送请求。value 必填，未传 depth/active 时从深度 0 开始使用本次祖先集合。

```ts doc-test=run
import { normalizePortable } from '@migaia/rpc-contract/portable'

const source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }
const snapshot = normalizePortable(source)
source.profile.name = 'Grace'
source.bytes[0] = 99
console.log(JSON.stringify(snapshot))
console.log(Object.isFrozen(snapshot))
```

输出：

```text
{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}
true
```

遇到数值悄悄变更，看[显式拒绝非法值](./USEGUIDE.md#拒绝在线上传输时会失去原意的值)；遇到远端错误只剩文字，看[保留类型与原因堆栈](./USEGUIDE.md#保留原生错误类型与远端原因堆栈)。

## 手写时的隐患

原生 JSON 可以编码数据，但不会替你建立这个协议的值域与快照边界。以下只展示隐患，进行类型检查，不运行：

```ts doc-test=check
const source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }
const snapshot = { ...source } // 隐患：浅拷贝仍共享 profile 和字节数组，后续修改会改变载荷。
const text = JSON.stringify({ ...snapshot, total: Number.NaN }) // 隐患：NaN 被替换为 null，值域问题被掩盖。
const received = JSON.parse(text) as typeof source // 隐患：类型断言不校验记录，也不会还原二进制含义。
void received
```

normalizePortable 先按共同规则捕获与校验，再交给后续 codec 或载体。若只是本地 JSON 文档且接受其转换语义，原生操作本身即可使用。

## 三分钟心智模型

| 你要处理的问题                   | 对应工具                                |
| -------------------------------- | --------------------------------------- |
| 捕获可跨语言表示的业务值         | normalizePortable                       |
| 传递或检查完整错误原因           | serializeRpcError / deserializeRpcError |
| 协商版本、codec 与能力           | handshake 入口                          |
| 载体逐条给字符串或二进制消息     | framing 的消息 framer                   |
| 载体只提供任意切块字节           | framing/stream 或 framing/jsonrpc       |
| 校验 runtime、流控制或二进制清单 | runtime / stream / binary 分层入口      |

“portable”是协议能明确表示的值域；“信封”是在载荷外附加种类与路由的记录；“framer”划定消息边界并组装分片；“source”是载体告诉分帧器的来源标识；“codec”负责数据与编码值之间转换；“sidecar”是清单之外随消息发送的原生二进制。以上工具不等于连接、认证或调用执行器。

## 典型场景

| 场景                             | 怎么组合             | 详细说明                                                   |
| -------------------------------- | -------------------- | ---------------------------------------------------------- |
| 在调用者修改前捕获数据           | `normalizePortable`  | [完整示例](./USEGUIDE.md#在调用者修改前捕获数据)           |
| 拒绝在线上传输时会失去原意的值   | `normalizePortable`  | [完整示例](./USEGUIDE.md#拒绝在线上传输时会失去原意的值)   |
| 保留原生错误类型与远端原因堆栈   | `serializeRpcError`  | [完整示例](./USEGUIDE.md#保留原生错误类型与远端原因堆栈)   |
| 报告不可读字段并继续生成线上错误 | `serializeRpcError`  | [完整示例](./USEGUIDE.md#报告不可读字段并继续生成线上错误) |
| 隔离不同对端的相同消息标识       | `createStringFramer` | [完整示例](./USEGUIDE.md#隔离不同对端的相同消息标识)       |
| 拒绝乱序分片并关闭未完成组装     | `createStringFramer` | [完整示例](./USEGUIDE.md#拒绝乱序分片并关闭未完成组装)     |

## 安装

```bash
pnpm add @migaia/rpc-contract
```

运行时只依赖 serialize 与 utils，没有 peer 依赖。下面场景只导入本包公开入口，无需连接、服务端或 I/O。直接导入相关包的独立 API 时，把该包列为消费项目的直接依赖。

## 常用 API

| API                                                        | 什么时候用               |
| ---------------------------------------------------------- | ------------------------ |
| normalizePortable                                          | 捕获并校验默认线上业务值 |
| serializeRpcError / deserializeRpcError                    | 跨边界保留错误链与原生类 |
| createRpcHello / acceptRpcHandshake / completeRpcHandshake | 生成并确认握手协商结果   |
| createStringFramer / createBinaryFramer                    | 对消息载体分片和有界重组 |
| createRpcStreamFrameDecoder / createJsonRpcFrameDecoder    | 处理各自字节流边界       |
| normalizeRuntimeEnvelope / normalizeStreamPayload          | 校验调用信封或流负载     |

## 契约细节

### 职责、依赖与入口

本包定义 RPC 的线上格式并提供数据构造、校验、规范化与分帧函数。它不打开连接、不执行远程方法、不拥有 Endpoint，也不绑定 Node、DOM 或 Worker。状态型 framer 只拥有有界重组缓存及 assembly expiry 计时器。运行时依赖仅 `@migaia/serialize` 与 `@migaia/utils`，没有 peer 依赖。

普通 TS 调用方通常通过 rpc-core 使用它；rpc-core 将它列为 peer 依赖。独立语言对端、载体适配器和跨边界错误处理才需要直接使用这些入口。rpc-process 复用 Content-Length 分帧及错误转换；serialize 提供底层可移植遍历与错误链实现。

| 公开入口                                                            | 用途                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `@migaia/rpc-contract`                                              | 常量、V1 信封、握手、portable 与错误工具                     |
| `./wire`                                                            | 线上常量和类型，也含 measurePortableStreamValue 等纯数据操作 |
| `./portable`                                                        | wire portable 规范化与深度常量                               |
| `./errors`                                                          | 错误树序列化、还原、校验、JSON-RPC 转换与本地分类            |
| `./handshake`                                                       | hello/accept/reject 的构造、协商与校验                       |
| `./v1`、`./framing/v1`                                              | 协议 1.x 信封与消息 framer                                   |
| `./framing`                                                         | 字符串/二进制消息分片、重组、物理帧检查                      |
| `./framing/stream`                                                  | 四字节大端长度前缀及 bootstrap/handshake 接收器              |
| `./framing/jsonrpc`                                                 | Content-Length 字节分帧及桥错误码                            |
| `./runtime`、`./runtime/metadata`、`./runtime/lazy`                 | runtime 信封、调用头部、generation/steps，及按需加载版本     |
| `./stream`                                                          | 流负载、序号、进度、额度和控制状态检查                       |
| `./binary`、`./binary/lazy`、`./binary/capture`、`./binary/inspect` | 二进制捕获、准备、还原、清单、完整性与大小检查               |
| `./schema/wire-error`                                               | 随包发布的错误树 JSON Schema                                 |

以上共根入口及 18 个子入口，最后一项是 JSON 文件。不要导入内部文件。`./v1` 使用具名 rpcProtocol 与 normalizeRpcEnvelope，没有 default 聚合；根入口以 rpcProtocolV1 提供该协议对象。`createReassembler` / `IRpcReassembler` 已移除，直接使用原 framer.accept/close，或 Pick 相应方法类型。完整字符串统一用 remoteProcessStringFramer，bare processStringFramer 不再公开，没有兼容别名。

### 常量、描述符与线上格式

`RpcProtocol` 给出协议标识 `migaia.rpc` 与当前 major/minor `1.1`。`RpcCodecId` 维护 codec 名称，如 json；`RpcCapability` 维护带版本能力名，如 ping@1、batch@1、stream@1、runtime-api@1、group@1、transfer@1。独立实现应使用同一线上值，不自行拼接另一套字符串。

`RpcPeerRuntime` 有 node、bun、deno、electron、python、rust、go、java 等标签键；合法 runtime 字符串 browser 不等于存在同名常量键。`RpcEnvelopeKind`、`RpcRouteField/Key/Profile/Type`、`RpcWireLimit`、`RpcStreamLimit`、`RpcWireErrorLimit` 维护信封、路由与预算词汇。路由字段包括 timeoutMs、idempotencyKey、trace 等；`RpcRuntime*` 描述 runtime 调用，二进制标签 `RpcBinaryTag` 从 wire 入口导入，binary 子入口公开 profile/storage/native-kind 等域。

`createDescriptor(id, version)` 返回冻结的精确身份对象；id 和正安全整数 version 必填，无默认，非法描述符为 TypeError / INVALID_DESCRIPTOR。描述符不会建立连接或登记服务。

### portable：数据快照与二进制域

普通 `normalizePortable(value, depth?, active?)` 使用 wire 域；value 必填，depth 默认 0，active 默认由遍历创建的祖先集合，不是全局对象去重表。`RPC_PORTABLE_MAX_DEPTH` 为 64。相同对象在不同分支出现会各自得到副本，只有当前祖先链回边是循环。

| 输入                                                                                 | 默认 wire 结果                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| null、布尔、字符串、有限数（包括 -0）                                                | 保留值                                                     |
| 普通或 null 原型对象                                                                 | 冻结的 null 原型副本，按自有可枚举字符串键读取，每字段一次 |
| 数组                                                                                 | 按项规范化                                                 |
| 真正的 Uint8Array                                                                    | `{ $rpc: 'bytes', base64url }`，无填充 canonical base64url |
| ArrayBuffer、Date、Map、Set、类实例、函数、symbol、bigint、undefined、非有限数、循环 | 拒绝，通常为 TypeError / INVALID_ENVELOPE                  |

属性值为 undefined 也会拒绝。保留的 `$rpc` 标记只用于严格合法的 bytes 标签；非法字母、填充或非 canonical 尾位不是合法字节标签。Uint8Array 通过真实内部字节品牌判断，可接受跨 realm 和合法子类，不因伪造 toStringTag 就接纳 DataView 或伪视图。

普通 wire 遍历会执行对象 getter，并仅捕获一次；不要把它与下面 runtime 的严格 own-data 校验混为一谈。反射或 getter 失败保留原因为 cause。带 native guard 的高级重载在二进制准入点以无 receiver 方式调用 guard，原失败保持身份；普通业务代码无需手动维护 active 或 guard。

协商后的 runtime native-binary 分支有独立重载，可保留 ArrayBuffer/Uint8Array 身份，并要求严格自有 data 描述符；这不扩大默认 wire normalizer 的返回域。ArrayBuffer 的跨对端传输由二进制 profile 处理，不能把它直接塞进普通 portable 数据。

### 握手：本地 offer 与对端文本

发起方 createRpcHello(offer) 返回要发送的 JSON 文本；响应方 acceptRpcHandshake(localOffer, hello) 选共同参数并返回 `{ ok, reply, agreement? , error? }`；发起方 completeRpcHandshake(localOffer, reply) 确认 agreement。normalizeRpcHandshake(text) 只校验收到的握手文本；函数不负责实际收发或认证。

offer 包括 peer、versions、codecs、capabilities；peer.id/runtime 描述本端，versions 每项为 major/minor，codecs 必须含 json 并按偏好排列，capabilities 为唯一的带版本能力列表，空表表示不提议可选能力。可选 auth 携带凭据，由上层认证；有 auth 字段不等于认证已成功。规范化后的 agreement.peer 指向对端：响应方看发起方，发起方看响应方。

协商选最高共同主版本，次版本取双方较小者，codec 按发起方顺序选首个共同项，能力取交集并保留发起方顺序。无共同版本或 codec 时响应方返回 ok false 和可发送的 reject reply；发起方收到拒绝抛 HANDSHAKE_REJECTED，cause 可保留 HANDSHAKE_INCOMPATIBLE。非法 UTF-8、JSON、字段或选择结果为 HANDSHAKE_INVALID，不能自动降级为旧协议。

握手错误的公开 cause 可能是有界、冻结的脱敏摘要，不会无条件保留包含凭据的原始文本、对象或引擎 JSON 摘录。可确认安全的原生 decoder/getter 错误仍保持原身份。独立适配器应按 source/code 处理，不依赖未经脱敏的输入回显。

### 字节流分帧

原生长度前缀与 JSON-RPC Content-Length 是两种不同格式，不可混用：

| 格式                                 | 操作与失败模型                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 四字节无符号大端长度 + payload       | encodeRpcStreamFrame 编码，createRpcStreamFrameDecoder 通过 onFrame 交付、onError 报首个协议错误并终止    |
| ASCII Content-Length 头 + UTF-8 JSON | encodeJsonRpcFrame 编码，createJsonRpcFrameDecoder.push 返回本轮完整值数组，非法 push/finish 直接抛桥错误 |

长度前缀 encoder 的 payload 必须为非空 Uint8Array，最大 `RPC_STREAM_MAX_FRAME_BYTES` 为 16 MiB；空或非法负载为 INVALID_FRAME，超限为 FRAME_LIMIT_EXCEEDED。decoder 的 options 必填，onFrame(frame) 和 onError(error) 都必填、无默认；push 接收任意切块，复制输入到自身帧内存以免调用方复用 chunk。finish 检查残留半帧，结束此 decoder；close 丢弃状态。onFrame 中 close/finish 会停止当前 chunk 剩余交付。

createRpcStreamFrameDecoderWithLimit(options, maxFrameBytes) 在每帧分配前读取当前上限，适用于握手阶段小预算；callback 与预算函数由调用方提供。createRpcBootstrapFrameReceiver/createRpcHandshakeFrameReceiver 用于激活前处理第一帧与排队后续数据，不拥有连接。

JSON-RPC encoder 按 UTF-8 实际字节写 Content-Length，而非 JS 字符串长度。decoder 无构造参数，push(chunk) 可收到任意边界，返回零条或多条完整消息；bufferedBytes 反映保留的字节。JsonRpcLimit 的 headerBytes 为 1024，bodyBytes 为 16 MiB，handshakeMs 为 10000。非法头部、重复/缺失长度、非法 UTF-8 或 JSON、半帧 EOF 为 JSONRPC_FRAME_INVALID。这里 finish **只检查残留，不关闭 decoder**；close 才清空且使后续 push 返回空数组。不要套用长度前缀 decoder 的 onError/终止语义。

### 消息 framer 与重组所有权

createStringFramer(options?) 与 createBinaryFramer(options?) 产生 descriptor、输入/输出 encoded 类型、frame(value, context)、accept(frame, context)、close(reason?)。context 的 source 与 messageId 必填；source 由载体边界提供，用来隔离不同来源的同名消息。frame 返回物理帧数组；accept 返回 pending、complete/value 或 rejected/error，不是为拒绝结果一概抛错。

options 默认空对象，其数字字段均须为正安全整数：

| 字段                    | 默认      |
| ----------------------- | --------- |
| chunkBytes              | 16384     |
| maxMessageBytes         | 16777216  |
| maxChunks               | 4096      |
| maxBufferedBytes        | 67108864  |
| maxConcurrentMessages   | 256       |
| assemblyTimeoutMs       | 30000     |
| now / schedule / cancel | undefined |

chunkBytes 不可大于 maxMessageBytes，后者不可大于 maxBufferedBytes。schedule(callback, delayMs) 与 cancel(handle) 可由调用方注入，省略时使用宿主可用的 setTimeout/clearTimeout；宿主无 timer 时不会凭空创建计时能力。now 字段只读取保留，不驱动组装期限；单独改变 fake now 不会推进计时器。framer 拥有并释放自己的 timer，调用方使用后应 close。完整载体和分片都执行 maxMessageBytes；字符串沿用 UTF-16 code unit 计量，二进制按 byteLength。不能把字符串预算当作真实 UTF-8 物理大小；编码后尺寸检查另用 inspectRpcPhysicalFrame(value, limit)。

分片严格要求首片、顺序、数量与长度匹配，迟到、重复、超限或到期会被拒绝。重组以 source/messageId 二元组隔离，不能靠含分隔符的简单拼接猜身份。没有显式网络发送，调用方负责按 accept 结果决定后续处理。

计时器先从 owner 脱离再取消，重入 close 不重复取消。schedule/warn 未分类回调失败附 CALLBACK_FAILED；cancel 失败经可用宿主 reportError 或 utils 宿主异常队列观察，保留 primary 与 reporter secondary，不替换已产生的帧结果。inspectRpcPhysicalFrame 按实际编码帧测量；可拆批次用 splitBatch 对半拆分，单条超限以 RangeError 拒绝。

remoteProcessStringFramer 用于每次已交付完整字符串的载体，保留消息边界且不再分片；非字符串为 TypeError / INVALID_FRAME。

### runtime、stream 与 Decoded 信任边界

normalizeRuntimeEnvelope(value) 校验收到的 runtime 信封，严格读取自有 data 属性，拒绝访问器而不执行 getter。runtime request/notify/stream/group 的元数据词汇在 runtime 入口维护；createRuntimeCallEnvelope 从 runtime/metadata 构造出站调用头，normalizeRuntimeGeneration/normalizeRuntimeSteps 校验代次与 group 步骤。steps 须为非空、稠密的 own-data 数组，没有独立固定步数上限，物理字节预算另管。

normalizeRuntimeEnvelopeDecoded、restoreRpcBinaryDecoded 只用于本库 codec 刚输出、未经过其它代码的对象。它们保持相同数据规则、首错与冻结元数据，但省去完整属性描述符检查，可能执行自行构造对象上的 getter。它们仍检查普通原型，structuredClone 保留的 Date/Map 不能因此被当作记录。未知来源用严格版本，不要把 Decoded 作为公开信任开关。runtime/lazy 的 scalar 分支可同步返回，stream 分支可返回 Promise，调用方应支持两种返回域。

stream 入口的 normalizeStreamPayload 校验负载；checkRpcStreamSequence/Progress/ConsumerCredit/ProducerCredit 检查连续序号、进度、消费者额度与生产者忙碌状态。合法返回 undefined，协议违规返回带 code 的 Error，由调用方选择报告、终止或取消，不把返回值当作已经自动抛错。checkRpcRuntimeStreamTransition/Intent 校验结束与提前控制是否符合起始选项。它们不调度生产者、不发送数据，也不重放已交付项。

### binary：捕获、清单、还原与预算

prepareRpcBinary(envelope, storage, limit?, digest?, codec?) 生成二进制清单、sidecar 与总量；restoreRpcBinary 校验清单与完整性后还原，Decoded 版有前述信任限制。captureRpcBinaryData 同步捕获，稍后 prepare，适用于捕获时间早于编码；binary/lazy 同名操作在完整 codec 加载前捕获数据，并在需要摘要的 native 分支计算首个摘要。

native 按完整底层 ArrayBuffer 计入 backing 预算；inline 按 offset + visibleLength 计入分配预算，只复制可见字节并保留零前缀语义。limit 不无条件覆盖清单全部元数据。native + encode-only codec 的 prehash 分支另查实际整帧，inline 或其他 codec 的物理帧上限由对应 codec 或调用者负责。

digest 参数可省略；选择 native 存储时必须由调用方提供覆盖完整 backing 的真实 SHA-256，不能用占位摘要替代，inline 不需要 digest。limit 省略时默认 16 MiB，还原时 sidecars 默认空数组 []。可选末参 codec 提供元数据编码。binary/inspect 的 assertRpcNativeBinaryFrameSize 等按完整 backing 检查帧大小、读取原生二进制并分类完整性错误。这些函数不负责选择载体、传输或释放对端资源。

### 错误树、原生类型与 JSON-RPC 转换

serializeRpcError(value, options, metadata?) 的 value 和 options.report 必填；report 接收 `{ pointer, field, error }`，用于被跳过的属性读取或数据规范化失败，不能用次数统计全部截断。它按 source、code、name、message、stack，加可选 cause/errors/data/route/truncated 输出有界错误树；无身份错误使用 unknown/UNKNOWN。跨 realm 原生类型名和发送方 stack 被保留，deserializeRpcError 校验后还原 Error、RangeError、TypeError 等类型，不重新制造发送方 stack。

RpcWireErrorLimit：maxNesting 48、maxEmbeddingDepth 16、maxNodes 1024、maxStringBytes 65536、maxBytes 1048576。超预算或文本截断会裁掉内容并标 truncated；不保证每次裁剪都 report。循环边被裁去；reachRpcError(value, { report }) 遍历 cause、errors 与 cleanup 错误并按引用去重，RpcErrorReachLimit.maxObjects 为 4096。

normalizeRpcSerializedError(value, options?) 的 options 默认空对象；unknownFields 为 reject（默认）或 ignore，onUnknownField 可选、无默认 callback。deserializeRpcError(value, options?, routes?) 采用相同规则，routes 可接调用方 WeakMap 的 set 能力保存已接纳路由。序列化读取固定字段，某字段 getter 失败可报告并保留根、设置 truncated；不承诺读取错误对象的所有任意自有属性。

第三参数 metadata 的 summaries/routes 都可选，是按 Error 引用查询的 WeakMap get 能力。summaries 可给 code/message 对外摘要并隐藏内部 cause；preserveSerializedError: true 才保留该节点既有后代。routes 提供有界路由诊断，不授予控制权限。

toJsonRpcError(wire, code) 把错误树放入 error.data.migaiaWireError；整数 code 由调用方选定，不默认等于 wire code。fromJsonRpcError 也接受无扩展的普通 JSON-RPC 错误，使用 foreignSource `jsonrpc-2.0` 与整数 code 的字符串。RpcJsonRpcWireError.dataKey 维护扩展键。独立适配器使用自己的 source/code，可直接安装 utils 并用 attachErrorIdentity 保留原生错误；不要冒用官方 RPC 身份。

classifyRpcContractError(error) 只按本地对象引用识别本包签发错误，返回对外 code/message；复制或远端还原的错误返回 undefined。远端 source/code 是诊断身份，不证明本地来源，也不授予重试或控制权。

schema/wire-error 只提供结构校验起点，不等于有界 normalizer。独立实现还须执行 x-migaia-limits、canonical base64url、surrogate 等规则；Schema 的 additionalProperties 与 normalizer 默认 reject 并不等价。用其它语言实现原生对端还需长度前缀、握手和 runtime 信封；JSON-RPC 桥还需其四个扩展方法，由 rpc-process 的协议层负责，不由本包完成连接。

### 错误身份与维护

本包错误的语义来源 `source` 为 `@migaia/rpc/contract`，由常量 `RPC_CONTRACT_SOURCE` 表示，code 来自 RpcContractErrorCode：

| code                   | 原生类型与含义                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| CALLBACK_FAILED        | 默认 Error，原生回调失败保留其类；warn/schedule/cancel 等未分类回调失败，原错或 cause 保留 |
| INVALID_DESCRIPTOR     | TypeError；描述符身份或配置非法                                                            |
| INVALID_ENVELOPE       | TypeError；信封或 portable 业务值非法                                                      |
| INVALID_STREAM         | TypeError；流字段、序号、额度或值非法                                                      |
| INVALID_FRAME          | RangeError；帧语法、空负载或物理批次非法                                                   |
| FRAME_LIMIT_EXCEEDED   | RangeError；帧或重组预算超限                                                               |
| FRAME_ASSEMBLY_EXPIRED | RangeError；分片未在预算内组齐                                                             |
| INVALID_WIRE_ERROR     | TypeError；错误树非法，可能带 pointer/violation/cause                                      |
| HANDSHAKE_INVALID      | TypeError；握手编码、JSON 或字段非法                                                       |
| HANDSHAKE_INCOMPATIBLE | Error；版本、codec 或所需能力不兼容                                                        |
| HANDSHAKE_REJECTED     | Error；对端拒绝，检查受控 cause                                                            |

形状失败保留对应原生类；可写回调错误原位附码且不改 stack，不可写或非 Error 值经 cause，完整外包 source/code 保留原 owner。fatal UTF-8 decoder 失败在 HANDSHAKE_INVALID/INVALID_FRAME 的 cause 中保留。

JSON-RPC 桥身份为 `@migaia/rpc/bridge/jsonrpc`（JSONRPC_BRIDGE_ERROR_SOURCE），其 JsonRpcBridgeErrorCode 包括 JSONRPC_FRAME_INVALID、JSONRPC_EXTENSION_MISSING、JSONRPC_PROFILE_INVALID、JSONRPC_UNSUPPORTED_MODE、JSONRPC_HANDSHAKE_TIMEOUT，分别用于分帧、缺扩展、profile、模式和握手期限。不要把桥错误当作 contract source。

其他层的 source 分别是 rpc-core 的 `@migaia/rpc/core`（RPC_CORE_ERROR_SOURCE / RpcCoreErrorCode）、rpc-core/remote 的 `@migaia/rpc/remote`（RPC_REMOTE_ERROR_SOURCE / RpcRemoteLayerErrorCode）、rpc-process 的 `@migaia/rpc/process`（RPC_PROCESS_ERROR_SOURCE / RpcProcessErrorCode）与 rpc-threads 的 `@migaia/rpc/threads`（RPC_THREAD_ERROR_SOURCE / RpcThreadErrorCode）。按 source/code 分支；message 用于展示，不用于决定重试。

```bash
pnpm --filter @migaia/rpc-contract run fmt
pnpm --filter @migaia/rpc-contract run lint
pnpm --filter @migaia/rpc-contract run typecheck
pnpm --filter @migaia/rpc-contract run typecheck:test
pnpm --filter @migaia/rpc-contract run test
```

test 的现有脚本包含 coverage；结果仅以实际执行为准。独立协议实现应以发布常量、schema 和 normalizer 的边界为依据；只需要调用远端方法时，使用上层 RPC 包。
