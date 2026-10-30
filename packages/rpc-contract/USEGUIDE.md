# `@migaia/rpc-contract` 协议与使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

contract 只定义数据、接口和纯形状检查；host 负责 RPC 会话与调用执行。传输 plugin 负责载体、编解码、分帧和 transfer；信息流 plugin 和其 feature 持有自己的可选状态与策略。通常一个 host 选择一种传输，不建议混用多种传输。

## 版本与接收边界

所有语义消息的 `profile` 固定为 `migaia.rpc/2`。唯一协议版本为 `{ major: 2, minor: 0 }`，没有旧 v1 或 JSON-RPC 协商回退。先由载体解码，再使用 `/protocol` 的纯 normalizer检查形状；不能把收到的对象类型断言当作接纳。

协议 normalizer 先判断非数组对象，再直接读取已知字段并检查类型、范围和 kind；缺少必需字段或字段非法时仍以原错误码拒绝，pointer 指向首个不合格字段。通过后使用原对象，忽略未知字段，不检查原型、getter 或不可枚举属性。业务载荷的可移植值规则不变，方法 schema 由 schema plugin 执行。

## 握手与目录

`kind: 'handshake'` 按 `step` 分为三种记录：

| step     | 字段                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| `hello`  | `versions`、`codecs`、`extensions`、可选 `requiredExtensions`、`peer`、`directory`、可选 `auth` |
| `accept` | 选中的 `major/minor`、`codec`、`extensions`、`peer`、`directory`、可选 `auth`                   |
| `reject` | 完整 flat `error`                                                                               |

hello 提供实际支持的版本和 codec，公共 bootstrap 使用 JSON。accept 必须从真实 offer 中选择；required 扩展缺失时拒绝，optional 缺失不启用实现。扩展名遵循 `<name>@<positive-version>`。身份声明与目录并不自动成为认证授权，认证属于已安装的 auth plugin。

双方各发送一次 hello；instance id 较小的一方是发起端。响应端先准入对端名字与身份，写出 accept 后保留该预留会话。发起端校验协商结果并完成本地准入，再用同一 accept 形状确认，携带本方原 offer 的身份、目录和凭证，以及相同的版本、codec 和扩展。发起端在确认写出后发布 ready，响应端在收到确认后发布原预留会话。正常交换共有两个 hello、两个 accept；任何准入拒绝都使用 reject，不能让尚未得到双边准入的连接先报告 ready。业务帧沿同一有序载体排在确认之后。

目录为 `{ schemaVersion: 3, self: { name, instanceId, generation }, methods, nodeId? }`。每个方法包含 `name`、`supportedModes`、`modeSource`，可选 `idempotent/forwardedVia/input/output/yield`。`directory` 帧更新既有会话的目录；无需额外保留 describe RPC。

## 调用、路由与代际

下面只构造和检查一条语义消息，不建立连接或发送调用。

```ts doc-test=check
import { normalizeRpcFrame, RpcWireProfile, type IRpcEnvelope } from '@migaia/rpc-contract/protocol'

export const call: IRpcEnvelope = {
  profile: RpcWireProfile,
  kind: 'call',
  id: 'call-1',
  route: {
    applicationVersion: '1',
    senderId: 'caller',
    receiverId: 'provider',
    targetId: 'provider',
    sentAt: 0,
    remainingMs: 1000
  },
  task: {
    mode: 'request',
    callerId: 'caller',
    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },
    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },
    method: 'math.add'
  },
  options: {},
  payload: [20, 22]
}
export const admitted = normalizeRpcFrame(call)
```

操作帧共用 `id`、`route`、`task`，可带协商扩展的数据。route包含 `applicationVersion/senderId/receiverId/targetId/sentAt`，可选 `forwardRoute/trace/remainingMs`。task包含 `mode/callerId/callerGeneration/targetGeneration`，调用方法由 `method`表示。generation为 `{ kind: 'restart' | 'session', value, providerId }`。

待决调用与 host 的严格代际接纳不能仅用字符串id代替。结果、错误、取消与流事件必须关联原选定task；同名新连接不得结算旧调用。

| kind      | 专用数据                                                 |
| --------- | -------------------------------------------------------- |
| `call`    | `options`与可选`payload`；mode为request/notify/stream    |
| `group`   | `options`与有序`steps: [{method,payload?}]`              |
| `result`  | 可选`result`；实际undefined时省略                        |
| `error`   | flat `error`图                                           |
| `cancel`  | 可选 flat `reason`图                                     |
| `stream`  | `stream: {event,seq,value?,error?,reason?}`              |
| `outcome` | lookup含`idempotencyKey`；result含`state/store/outcome?` |

`options`只含线上`orderKey/cancel/idempotencyKey`，不传本地signal、timeout/retry实例或transfer权限。`route.remainingMs`是相对剩余预算，转发只能减少；`FeatureScope`解析单次策略配置对象或false、传输feature、链路默认的覆盖顺序，只有发起方重试。

notify也有id；物理写入后取消通过cancel帧传播至原provider signal，不等业务确认，不产生单向回执。

## 流、分组与控制

stream事件为open/pull/item/end/fail/cancelled/finish-without-items。`seq`和credit由host的StreamChannel维护；contract的序号/额度checker只返回形状错误，不发送数据、不调度iterator，也不分配另一个stream。

语义字节计量仅用于 `maxItemValueBytes` 限制的 stream 值槽。每个单项在发送方和接收方各计量一次：已有 codec 遍历时并入该遍历，否则使用 `measurePortableStreamValue`。request、notify 和普通结果不执行这项计量。

group按顺序执行，首个失败后的步骤为`not-executed`；步骤结果为`success/result?`或`failure/error`。物理合帧由batch plugin负责，与group无关。outcome查询由idempotency plugin执行；contract只定义pending/unknown/done与store continuity数据。

`control`帧有`id/route/operation/reason?`，operation为ping/pong/drain/close，不含业务task。`directory`帧有id/route及完整directory，也不创建provider调用。

## 载体、二进制与收发顺序

出站：`prepare → envelope.outbound → encode → frame.outbound → write`。入站：`frame.inbound → decode → envelope.inbound → restore`。auth先检查已准备的二进制元数据，载体随后恢复业务值；chunk/batch只处理编码后外层帧。

普通载体帧为 `{kind:'message',data,sidecars?}`，扩展为 `{kind:'extension',extension,data,sidecars?}`。通用JSON byte载体使用四字节无符号大端长度+UTF-8 JSON；长度不含四字节头，非空payload上限16MiB。读取必须支持任意切块，EOF半帧是错误。编解码器和有状态decoder属于host SDK/实际传输，不再从contract导出。

`IRpcCarrier` 可实现 `setInboundFrameLimit?(maxFrameBytes: number): void`。Session 在握手准入后、发送 accept 前传入 `maxFrameBytes`；byte carrier 初始使用 64 KiB，随后按当前上限检查长度并自行解析 JSON（包括扩展帧）。超限在分配完整 payload 或 JSON 解析前拒绝，不引入 Session 对具体 carrier 的依赖。

原生介质会丢弃对端监听安装前的消息时，载体可声明 `startupMessagesMayBeLost: true`。Session 在非应答方第一次收到对端 hello 时补发原 offer 一次，最多增加一帧；应答方复用已预留或已接纳的同一会话，对该对端的重复 hello 不再建立候选或重复认证。Window 使用此事实。BroadcastChannel 先通过既有 targeted join 安装对端路由，再交付语义 hello，复用这一等价机制；其他可靠载体仍保持原帧数。此行为不增加定时重试或新的握手状态表。

二进制清单保留 `profile: 'migaia.rpc.portable-binary/1'`、`storage: 'inline' | 'native'`、原 `envelope` 和逻辑 `backings` 数组。这是二进制表示版本，不是另一套 RPC 语法。`storage: 'inline'` 沿用可见字节内联，`backings` 与物理 sidecars 均为空；`storage: 'native'` 的每行描述一个完整 backing：

| 字段         | 规则                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `byteLength` | 完整 backing 的字节长度，不是某个视图的可见长度                                                                |
| `data`       | 可选；本行存在这个自有字段时，值必须是完整 backing 的无填充 canonical base64url，解码长度必须等于 `byteLength` |
| `sha256`     | 仅在没有 `data` 时使用；可省略，存在时必须是 64 位小写十六进制摘要                                             |

带 `data` 的行在还原时创建一次 backing，不消耗物理 sidecar，也不读取该行的 `sha256`。没有 `data` 的行依次消费下一个物理 sidecar，校验完整长度与唯一 backing 身份；多余或缺少 sidecar 都拒绝。业务值的二进制标记仍按逻辑 backing 索引引用，因此混合内联与原生行时，共享 backing 的别名、offset 和 length 仍保持。字段存在但值为 `undefined` 不等于省略字段。

纯协议检查只验证清单形状，不从对端字段推导完整性或 transfer 权限。接收方本地 codec context 的 `transferRequiresIntegrity` 为 true 时，原生 sidecar 行必须提供有效摘要，并校验完整 backing 的 SHA-256；否则不计算摘要。Host 当前在签名覆盖清单时，把未显式列在调用方 `transfer` 中且不超过 1125 字节的完整 backing 快照内联；其余 backing 保留为原生 sidecar 并带摘要。这个阈值是 SDK 内部选择，不是清单字段或公开配置项。未配置签名的原生行可只有 `{ byteLength }`。

codec prepare 借用调用方原授权的 transfer 列表，显式列出的 backing 无论大小都保留为原生 sidecar；实际移交后原 buffer 被 detach。最终 transfer 仍须与实际原生 sidecars 取交集，清单不会授予或扩大权限。旧接收方若要求每个原生行总有 `sha256`，或假定每行对应一个物理 sidecar，必须更新为上述格式。全局 inline 存储的编码方式不变。

## 可移植值与快照

默认`normalizePortable(value)`最大深度64，复制/冻结记录和数组；Uint8Array变成无填充canonical base64url bytes标签。默认域拒绝ArrayBuffer、undefined、非有限数、循环、函数、symbol、bigint及不支持的对象。合法数组中的嵌套字段同样接受检查。

默认wire遍历按自有可枚举字符串键取值，可能执行每个getter一次；`normalizeRpcPortable`对应已协商native值的严格own-data域，可保留真正ArrayBuffer/Uint8Array。不要把native保留域当作普通wire传输许可；实际载体还须完成能力、预算和完整性检查。

## 错误图与原生类型

线上错误为`{root,nodes}`。每个节点必须有source/code/name/message/stack，cause为节点索引，errors为有序索引数组，可带data/route/truncated。共享与循环边通过索引表达；接收端须检查索引、节点和累计预算。

节点上限为 1024；包含 1025 个节点的输入以原 `TypeError` / `INVALID_WIRE_ERROR` 拒绝。旧错误树的 64 层深度规则不适用于 flat 图的边。还原先为每个节点创建一个错误对象，再迭代接上引用，因此一个节点被多次引用时保持 `===`，环也指回同一批已还原对象；这不表示跨进程对象与发送端保持 `===`。

```ts doc-test=run
import assert from 'node:assert/strict'
import { serializeRpcWireError, deserializeRpcWireError } from '@migaia/rpc-contract/protocol'

const cause = new RangeError('sample limit')
const primary = new TypeError('sample operation', { cause })
const reports: unknown[] = []
const wire = serializeRpcWireError(primary, { report: (failure) => reports.push(failure) })
const restored = deserializeRpcWireError(wire)
assert(restored instanceof TypeError)
assert(restored.cause instanceof RangeError)
assert.equal(restored.stack, primary.stack)
assert.equal((restored.cause as Error).stack, cause.stack)
assert.equal(reports.length, 0)
console.log('native error graph preserved')
```

跨realm恢复会创建新错误对象，不能保留跨进程的`===`；支持的原生类与发送方stack保持。`serializeRpcWireError`要求report，读取/投影失败保留在本地报告；超预算裁剪会标truncated，不承诺每次文本裁剪都触发report。

独立错误树工具`serializeRpcError/deserializeRpcError/normalizeRpcSerializedError/reachRpcError`仍在`/errors`，用于纯诊断边界。wire业务协议只用flat图。恢复后的source/code是诊断，不授予本地控制权限；不能据对端填写的code决定本地资源所有权。

## 语法与预算依据

使用包内`schema/protocol.schema.json`和`schema/wire-error.schema.json`作为JSON结构起点。纯 normalizer 还检查已知字段、图边、canonical bytes 与适用的累计预算；schema检查不等同于会话、原生source或lifecycle接纳。外语实现向量位于rpc-integration的core-profile向量与独立peer测试。

`RpcWireLimit`固定标识128字符、trace256字符、idempotencyKey128字符、相对期限上限2147483647ms、握手65536字节、最多8版本/16codec/64扩展。方法目录最多4096方法；具体stream/error/portable预算由相应公开常量和normalizer维护。

旧`/v1`、`/runtime`、`/framing`、`/binary`、`/remote`入口、JSON-RPC桥转换和Content-Length profile已删除。只需要RPC调用时使用host；编写载体时使用host SDK；contract内没有独立的连接或策略执行器。

`RpcWireLimit.maxForwardHops` 为 16；`forwardRoute` 与序列化错误路由最多接受 `RpcWireLimit.maxForwardRouteNodes`（17）个节点 id，包含发起节点。Host 默认跳数仍为 3，协议容量不覆盖 host 自身配置。

已有原生宿主通过 Host SDK 的 `rpcHostPipelines(getHost, pipeline)` 提供 `domainCore(request)`，把同一个原生构造请求交还给宿主的 `pipeline(name, request)`。每个传输插件声明自己的七条短名管道，安装时创建、卸载时删除；helper 不再接收命名空间列表或返回管道声明。普通原生宿主先用 `rpcFeaturesPlugin({ features })` 安装共享信息流，再装传输，具体接法见 [Host 使用指南](../rpc-host/USEGUIDE.md#在已有宿主中安装-rpc)。内置出站顺序为 plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire，入站反向。传输 feature 仅覆盖本命名空间的同种能力，不另建执行器。
