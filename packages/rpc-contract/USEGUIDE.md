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

`options`只含线上`orderKey/cancel/idempotencyKey`，不传本地signal、timeout/retry实例或transfer权限。`route.remainingMs`是相对剩余预算，转发只能减少；`FeatureScope`解析单次完整实例或false、传输feature、链路默认的覆盖顺序，只有发起方重试。

notify也有id；物理写入后取消通过cancel帧传播至原provider signal，不等业务确认，不产生单向回执。

## 流、分组与控制

stream事件为open/pull/item/end/fail/cancelled/finish-without-items。`seq`和credit由host的StreamChannel维护；contract的序号/额度checker只返回形状错误，不发送数据、不调度iterator，也不分配另一个stream。

语义字节计量仅用于 `maxItemValueBytes` 限制的 stream 值槽。每个单项在发送方和接收方各计量一次：已有 codec 遍历时并入该遍历，否则使用 `measurePortableStreamValue`。request、notify 和普通结果不执行这项计量。

group按顺序执行，首个失败后的步骤为`not-executed`；步骤结果为`success/result?`或`failure/error`。物理合帧由batch plugin负责，与group无关。outcome查询由idempotency plugin执行；contract只定义pending/unknown/done与store continuity数据。

`control`帧有`id/route/operation/reason?`，operation为ping/pong/drain/close，不含业务task。`directory`帧有id/route及完整directory，也不创建provider调用。

## 载体、二进制与收发顺序

出站：`prepare → envelope.outbound → encode → frame.outbound → write`。入站：`frame.inbound → decode → envelope.inbound → restore`。auth先检查已准备的二进制元数据，载体随后恢复业务值；chunk/batch只处理编码后外层帧。

普通载体帧为 `{kind:'message',data,sidecars?}`，扩展为 `{kind:'extension',extension,data,sidecars?}`。通用JSON byte载体使用四字节无符号大端长度+UTF-8 JSON；长度不含四字节头，非空payload上限16MiB。读取必须支持任意切块，EOF半帧是错误。编解码器和有状态decoder属于host SDK/实际传输，不再从contract导出。

二进制manifest保留 `profile: 'migaia.rpc.portable-binary/1'`、storage(inline/native)、原envelope及`backings: [{byteLength,sha256}]`。这是二进制表示版本，不是第二种RPC语法。native载体校验完整backing的长度与真实SHA-256，按实际原生能力处理sidecar和transfer；inline载体按自己的编码规则承载可见字节。能力与权限不得从payload标志推断。

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

Host 按命名空间通过 `rpcHostPipelines(getHost, pipeline, namespaces)` 声明管道。内置出站顺序为 plaintext → schema → idempotency → limits → auth → chunk → batch → wire，入站反向。传输 feature 仅覆盖本命名空间的同种能力，不另建执行器。
