# `@migaia/rpc-contract`

contract 定义唯一线上协议、host/plugin/feature 接口、可移植值规则和 RPC 家族错误契约。host 负责会话、握手、调用、provider、转发与取消；传输 plugin 负责原生连接、代际、编解码与分帧；信息流 plugin 和依附于 plugin 的 feature 自带可选能力。

本包不持有会话、连接、待决表、计时器或 IO。通常为每个 host 选择一种传输；虽然 host 支持多个命名空间，也不建议混用多种传输。

[English](./README.en.md) · [协议与使用指南](./USEGUIDE.md)

## 安装与入口

```bash
pnpm add @migaia/rpc-contract
```

| 入口                                     | 内容                                                          |
| ---------------------------------------- | ------------------------------------------------------------- |
| 根入口                                   | 协议、接口类型、portable、错误契约和错误码汇总                |
| `/protocol`                              | `migaia.rpc/2` 数据类型、常量、纯形状检查、flat wire-error 图 |
| `/interfaces`                            | host、载体、信息流 plugin 与执行 feature 的接口类型           |
| `/portable`                              | 可移植值规范化、快照与原生 backing 形状规则                   |
| `/errors`                                | 原生错误类、身份属性、错误树投影与恢复、隐私检查              |
| `/error-code`                            | RPC 家族唯一错误码表及 source 常量                            |
| `/schema/protocol`、`/schema/wire-error` | 随包发布的 JSON Schema                                        |

所有 RPC 包都可以直接声明本包依赖。包设置 `sideEffects: false`；只导入 `/error-code` 不会把协议、载体编解码或 portable 执行路径带入包。

`/interfaces` 提供纯 flow payload 类型；原生命名管道的 stage 类型由 `@migaia/rpc-host/sdk` 提供。

`IRpcCarrier.setInboundFrameLimit?(maxFrameBytes)` 是可选的入站帧预算端口。Session 在握手准入后、发送 accept 前调用它；byte carrier 从 64 KiB 启动，并用当前上限完成长度检查、JSON 解析与扩展帧识别。其他介质可以省略此端口；Session 不识别具体 byte carrier 实现。

`IRpcCarrier.startupMessagesMayBeLost?: true` 表示对端安装监听前的原生消息可能丢失。声明此事实的介质上，非应答方第一次收到对端 hello 时补发一次原 hello；应答方对同一对端的重复 hello 幂等。Window 声明此事实；BroadcastChannel 复用既有 targeted join 在语义 hello 之前安装路由的等价机制，不重复补发。可靠介质不增加握手帧。

```ts doc-test=check
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type {
  IRpcCarrier,
  IRpcEnvelopePayload,
  IRpcTimeoutFeature
} from '@migaia/rpc-contract/interfaces'

export const cancelled = RpcCoreErrorCode.cancelled
export type ITransportParts = Readonly<{
  carrier: IRpcCarrier
  envelope: IRpcEnvelopePayload
  timeout: IRpcTimeoutFeature
}>
```

## 捕获可移植值

默认 `normalizePortable` 复制并冻结记录/数组，把 `Uint8Array` 可见字节变成无填充 canonical base64url 标签。源对象的后续修改不影响快照。

```ts doc-test=run
import assert from 'node:assert/strict'
import { normalizePortable } from '@migaia/rpc-contract/portable'

const source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }
const snapshot = normalizePortable(source)
source.profile.name = 'Grace'
source.bytes[0] = 99
assert.equal(
  JSON.stringify(snapshot),
  '{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}'
)
assert.equal(Object.isFrozen(snapshot), true)
console.log('portable snapshot preserved')
```

支持 null、布尔、字符串、有限数、数组、普通或 null 原型记录及合法 bytes 标签。不支持非有限数、循环、undefined、函数、symbol、bigint、Date、Map、Set 或任意类实例。默认最大深度为64。

协议记录直接读取已知字段，忽略未知字段，通过后使用原对象；不检查原型、getter 或不可枚举属性。业务载荷仍遵守原有可移植值规则，默认 wire 遍历可能执行业务记录的 getter 一次。协商后的 native binary 可保留真正 ArrayBuffer/Uint8Array；能力判断、摘要、编码、transfer 和资源释放由实际载体 owner 执行。

## 一套协议

profile 为 `migaia.rpc/2`，协议版本为2.0，方法目录 schemaVersion 为3。握手直接交换身份、代际、方法 mode/schema，以及真实可用的 codec/扩展。业务帧共用一份 id、route 与 task，不保留 v1、旧 runtime carrier selector 或独立 JSON-RPC profile。

支持 `handshake`、`call`、`group`、`result`、`error`、`cancel`、`stream`、`outcome`、`control`、`directory`。`notify` 也有调用 id，以便写出之后传播取消；不为它增加业务确认或回执。`group` 是顺序业务步骤，不是物理合帧。

扩展使用载体外层 `{ kind: 'extension', extension: '<name>@<version>', data, sidecars? }`。插件必须实际安装且握手选中，才能执行 chunk/batch 等能力。contract 只检查数据形状，不启用能力。

详细字段、收发顺序、二进制和错误图见[协议说明](./USEGUIDE.md)。JSON Schema 是结构入口；跨字段关联、累计预算、原生能力与生命周期仍由相应 validator/执行 owner 负责。

## 错误契约

`/error-code` 维护全 RPC 家族的 source/code；其它包不再复制错误码表。语义身份不是授权。复制或从远端恢复的错误不因此获得本地重试、退场或控制权限。

新协议传递 `{ root, nodes }` flat error graph；节点保留 source、code、name、message、stack、cause/errors索引及可选诊断数据。恢复保留支持的原生类和发送方 stack，不以接收端新 stack 覆盖它。`/errors` 的旧独立错误树工具仍用于纯投影边界，不是另一套业务协议。

线上错误最多包含 1024 个节点，1025 个节点以 `INVALID_WIRE_ERROR` 拒绝，不再按旧错误树的 64 层深度拒绝。接收端迭代还原引用；同一图内的别名指向同一个错误对象，环也保留原有引用关系。

业务应用从 [rpc-host](../rpc-host/README.md) 的 `createRpcHost` 开始；载体作者使用 `@migaia/rpc-host/sdk`。旧 `/v1`、`/runtime`、`/framing`、`/binary`、`/remote` 入口及其 profile 已删除，没有兼容别名。

已删除的无抛出点错误码（无替代码）：`HOST_ASSEMBLER_DUPLICATE`, `HOST_FEATURE_DUPLICATE`, `PROVIDER_GENERATION_RETIRED`, `MIDDLEWARE_DUPLICATED`, `MIDDLEWARE_MISSING`, `PROVIDER_NOT_SETTLED`, `TARGET_NOT_IDENTIFIABLE`。
