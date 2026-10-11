# @migaia/rpc-core

Core 包包括 Endpoint、Remote、Testing，并为运行时适配器作者提供作用于实际持有资源的普通操作。进程、线程、浏览器与外部语言 bridge 分别由可选包提供。

| 工厂                | 入口                | 所有权与调用                           |
| ------------------- | ------------------- | -------------------------------------- |
| createProcessPeer   | @migaia/rpc-process | 独立进程连接，调用者 close             |
| createProcessPlugin | @migaia/rpc-process | PluginHost 拥有，host.process 共享出口 |
| createThreadPeer    | @migaia/rpc-threads | 独立 Worker 连接，调用者 close         |
| createThreadPlugin  | @migaia/rpc-threads | PluginHost 拥有，host.thread 共享出口  |

需要自行组装连接时，可从 `@migaia/rpc-core/remote` 导入 `createRuntimePeer`、`createManagedRuntimePeer`、`createRuntimePlugin`。它们使用调用方实际持有的通道、执行资源或 Host slot 操作；显示名称、协议字段和复制的配置不会授予其它连接的操作权。`RuntimePluginKey` 提供稳定的 Host namespace 名称。

`@migaia/rpc-core` 的 `createRuntimeApiEndpoint` 同步返回 endpoint 资源；先等待其稳定的 readonly `ready`，再使用已安装的控制与 provider。也可传入完整的 `{ binding }`，借用该对象已有的 request、notify、stream 和生命周期操作。`@migaia/rpc-core/features/provider` 的 `createProviderAdmissionScope` 用于在多个 endpoint 间共享同一个 quota handle；初始限制由第一次实际 attachment 的配置决定，ready 后的 `constrain` 只收紧限制，cold `constrain` 只校验而不保存策略，`clear` 清除该 handle 的现有占用。

Core Endpoint 的 `group(steps, options)` 将 request-only steps 提交为一个 task，返回逐步 outcome；先失败后余项保持 not-executed，不回滚已执行的副作用。`outcome(idempotencyKey)` 读取同一连接的 pending/unknown/done 和原 store/result，不重新执行 provider。两者要求实际已就绪的 native runtime directory，选项与 wire 模式沿既有 owner。


自定义字符串 carrier 已保证每次交付完整消息时，从 `@migaia/rpc-contract/framing` 使用 `processStringFramer`；接收未知类型的值时使用 `remoteProcessStringFramer`，由它校验字符串域。两者都不分片，也不改变 carrier 已有的消息边界。未知值 framer 的非字符串输入保留 `TypeError`、`@migaia/rpc/contract` 的 `INVALID_FRAME` 和原文本；Process codec 的字符串入参校验仍保留 Core `PAYLOAD_INVALID` 身份。

## Worker 入门

子端 worker.ts：

```ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: { math: { double: (value: number) => value * 2 } },
  report: (error) => console.error(error)
})
```

父端 main.ts：

```ts
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

type IChildApi = { math: { double: (value: number) => number } }
const report = (error: unknown) => console.error(error)
const spawn = {
  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: createNodeThreadLauncher(),
  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
  report
}
const typedRemote = await createThreadPeer<IChildApi>({ spawn, report })
try {
  console.log(await typedRemote.request('math.double', 21))
} finally {
  await typedRemote.close()
}
```

同目录编译为 .js，项目使用 ESM。当前 Node 原生 Worker 已实际返回 42 并正常退出；省略子端来源只在真实 launcher 的可信 bootstrap 下成立。进程与两个 PluginHost 工厂的完整独立示例见 [USEGUIDE](./USEGUIDE.md#完整示例)。

## 提供、暴露与能力

provide 声明自己的函数；嵌套对象生成点分名称，getter、循环和非法名字在启动来源前拒绝。Plugin expose 默认为空，只有显式公开的本地 Feature 或 accepted connection 方法可被调用。Remote 泛型保持参数和结果类型；IRuntimeSurface 是纯类型投影，typedRemote 可以是应用变量名，没有第二个同名工厂。类型不能授予运行时鉴权或白名单权限。

握手双方必须支持 v2 describe 与 batch 帧接收；缺失就按现有错误拒绝，没有旧 describe/基础 1.1/单帧回退。reverse、orderKey、group、cancel before-start、outcome、binary 与 transfer 保持协商，显式使用而对端不支持时 fail closed。

## 来源、调用与生命周期

对端目录中的 name 是显示标签，不是 launcher 名称认证或控制权限；控制依实际 authenticated instanceId、generation 和原 native handle。自动 process instanceId 是模块本地单调身份，不承诺跨模块副本或跨父进程全局唯一。

每个连接选择且只选择一个 spawn、connect 或 listen；只有真实库 launcher 的子端允许自动来源。connect/listen 借用对端，只关闭本端连接，不自动拥有 stop/kill/restart/replace。需要避开 relay 时显式建立独立 connect/listen 通道；没有 direct/upgrade 分配器。

调用前的 method、payload、能力与本地选项准入可能同步抛错；需要统一处理时，把调用表达式放在 try/catch 内，不只对返回 Promise 调用 catch。这是既有严格前置准入语义。

request 等待业务结果。notify 等待原物理发送完成，成功不证明 provider 已执行。stream 保留 lazy iterator 与原取消、drain owner。默认 request/stream 超时 30000 ms；defaultTimeoutMs 有限且为正，单调用 timeoutMs:false 关闭默认期限，0 表示立即到期；仍受 launcher 的总 callWallTimeMs cap 限制。

orderKey 使用最终 provider 的原串行命名空间；before-start 只撤销开始许可，已经开始就保留原真实结果。group 保留已完成步骤，第一失败后余项 not-executed，不回滚副作用，也不是事务或分布式锁。outcome 的 unknown 不等于未执行。close 同步拒绝新调用，重复 close 返回同一 Promise，已接受工作按原 drain 结算。

## 速率与并发边界

legacy 墓碑账本路径包括 web 载体、BroadcastChannel，以及自定义 ID 生成器。默认出站容量 4096/endpoint；入站容量 1024/peer、4096 全局；保留时间 310000 ms。C7 用 canonical owner 和受控单调时钟实际验证容量与到期，容量除以保留时间得到持续上限：出站约 13.21 次/秒/endpoint，入站约 3.30 次/秒/peer、全局约 13.21 次/秒。这是保留容量导出的持续速率界限，不是墙钟吞吐；短时突发仍受有限账本容量约束。

具备 replay-window L 原生资格的独占 process/Worker 通道只保留活跃请求，不受上述墓碑持续速率限制。只有真实 native source 的既有资格成立才适用；把任意 transport 标成 exclusive 或更改 ownership 字段不能获得此资格。

provider 并发默认每 peer 64、全局 256；同时进行的 request/notify/stream 按原 admission owner 计量。超限返回 OVERLOADED；降低并发，在剩余总业务预算内退避并加入抖动。客户端错误当前不包含 provider rejection reason，不能仅凭 OVERLOADED 判断零执行；provider 的原 onRejected 有具体 reason。

本次 C7 没有取得满足 AC Power、lowpowermode 0、起止负载≤3、同窗 A/A≤10% 的最终吞吐值，因此不提供当前机器的稳定吞吐数量级，也不把历史估计写成新基线。三次资格未通过的原始观察与电源、负载、噪声已保留给性能 owner；部署容量应以合格窗口实测为准。高频小调用请批量发送或使用 Promise.all；有依赖的串行 await 无法自动合并。需要业务结果时使用 request，notify 的成功只证明物理发送。

## 二进制、转发与重试

ArrayBuffer / Uint8Array 使用双方实际 binary profile。线程显式 transfer 还要求真正 native clone-transfer 与受支持的 sign-only manifest；process 不接受 own transfer 字段，空数组或 undefined 也拒绝。physical commit 后 buffer 及共享 backing 的 views 会 detach；后续失败不能恢复，禁止自动重放，不保留隐藏输入备份。支持组合和 C10 实测边界见 [USEGUIDE](./USEGUIDE.md#二进制和-transfer)，不宣称零复制。

process inline 保留原 base64 wire：Uint8Array 仅携带可见 bytes，接收端恢复原 offset 与零前缀；native manifest 保留完整 backing、alias 与 digest。大载荷复用已拥有的 JSON 准备结果，能力选择与 transfer 规则不变。

透明转发只公开显式 expose 的 accepted route，每跳固定实际 generation，最多三层；下一跳鉴权直接上一跳。性能固有成本不能成为绕过白名单、portable admission、replay 或 deadline 的理由。

每个调用入口保留原选项读取与 payload 捕获顺序；重试复用同一逻辑调用的快照。stream 保持原首次 next/return/throw 触发，准备沿原条件执行；iterator 复用同一 consumer。转发复用接收端完整验证的原对象；复制对象、反射字段或 custom protocol 不能取得这项复用。

非独占载体按 receiver 身份绑定 challenge；SIEVE 管理驻留会话。SESSION_UNKNOWN 是 AUTHENTICATION_FAILED 的本地 rejection reason：只清对应 challenge 缓存，未来新调用重新发现，不自动重放旧业务帧。receiver 重启不能证明业务未执行。 CHALLENGE_INVALID 同属 AUTHENTICATION_FAILED 的本地拒绝 reason，表示 challenge 字段语法或方向非法；修帧合同，不盲重试，也不是新的顶层 code。

先看 (source,code)、原 cause/errors 和已发送/已执行事实。OVERLOADED、transport loss、deadline、普通取消或恢复 ready 都不单独证明安全重试；使用原 key/outcome 或业务对账，剩余总预算内退避。客户端 provider 错误当前不含 reason。完整 68 项策略见 [USEGUIDE](./USEGUIDE.md#逐错误码处理与重试)。

## 其它入口

`@migaia/rpc-core/remote` 的 `RuntimePluginKey` 提供 `process` / `thread` 标量标签，用于解释 Plugin 和查询中的平台元数据；标签本身不授予 Host slot、channel 或 native execution 操作权。

@migaia/rpc-core/testing 的 createPeerPair 装配真实对称 Peer，用于应用测试，不授予 native spawn/transfer 权限。显式底层 client、provider、full、composed，@migaia/rpc-contract/v1 语义描述与 remote ports 仍按各自层级保留；adapter 从对应 rpc-browser、rpc-process、rpc-threads 的公开子路径导入。平台锁与部署协调由消费侧负责。

本地 list/get/describe 读取原 owner 的安全投影，methods 为名称数组；资源、退出或健康事实缺失时返回 unavailable。Host outlet 的 on 返回 disposer，watch 是有界事件 iterator；目录 ready 不证明远端 Host 安装事务提交。查询、事件、控制、借用资源与 JSON-RPC bridge 的限制见 [USEGUIDE](./USEGUIDE.md)。

JSON-RPC bridge 完成原 hello 后允许同连接的 invoke、describe、无 id notify 与已协商 batch 到实际已安装 provider。cancel 只选择该连接的既有调用，不新增 ACK；不支持 server stream，也不把 wire 字段作为执行权限。


## Runtime/carrier adapter resources

`@migaia/rpc-core/adapter` constructs a complete channel from ordered raw I/O held by a runtime or carrier adapter. It owns the handshake, physical frame queue, IPC gate, codec/framer composition and exact private batch/replay facts. It never accepts an existing RPC transport to mark, an agreed/trusted/owned flag, or a registration callback. The historical `staticAgreement` option contains two local/peer protocol proposals; the constructor validates their equality and creates its own static agreement for its own new transport. It is not a receipt for another transport.

Node adapter authors can give `@migaia/rpc-core/adapter/node` their actual child pipes, process stdio or duplex socket. `createAdapterChildStdio(child)` and `createAdapterProcessStdio(io)` retain the original physical lifetime/exclusive reader observation; `createAdapterSocketByteIO(socket)` preserves the ordinary socket profile without claiming launch replay ownership. `@migaia/rpc-core/adapter/web-streams` constructs the original reader/writer scope from held Web Streams. These ordinary subentries are separate from the neutral Core root.

A third-party custom IPC adapter needs only the ordinary constructors and the standalone Contract toolkit:

```ts
import { createAdapterChannel } from '@migaia/rpc-core/adapter'
import { createAdapterSocketByteIO } from '@migaia/rpc-core/adapter/node'
import { RpcCodecId, RpcPeerRuntime, RpcProtocol } from '@migaia/rpc-contract'

// socket is the actual duplex resource acquired by this adapter.
const raw = createAdapterSocketByteIO(socket)
const channel = await createAdapterChannel(raw, {
  peerId: 'service',
  role: 'initiator',
  offer: {
    peer: { id: 'client', runtime: RpcPeerRuntime.node },
    versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
    codecs: [RpcCodecId.json],
    capabilities: []
  },
  scheduler,
  ipc: { connectionId: 'custom-ipc', sessionId: 'session', log },
  report
})
// The returned channel can be supplied to the normal Core/Remote endpoint construction.
await channel.close()
```

Adapters propagate the original owner errors. `RPC_PROCESS_ERROR_SOURCE` and `RpcProcessErrorCode` remain ordinary diagnostic data at `@migaia/rpc-core/adapter/diagnostics`; their semantic source stays `@migaia/rpc/process`. Process text and stderr diagnostic tables are private. Trust writers, owned snapshots and physical receipt readers remain private. Adapter authors attach their own source/code through `@migaia/utils/error`; they do not ask Core to mint arbitrary operation errors.


### Thread execution and foreign-language byte adapters

A third-party runtime adapter can give Core its native module acquisition resource. Core performs
Worker construction, observes real exit/error events, receives the private ACK and constructs the
channel over that exact Worker. The import still happens at the original launch boundary. The
returned handle exposes `identity`, `port`, `exited`, `terminate`, `sampleUsage` and a complete
`open` operation; preparation and receive-handoff callbacks remain private.

```ts
import { createNodeThreadLauncher } from '@migaia/rpc-threads/adapters/node'

const launcher = createNodeThreadLauncher()
const handle = await launcher.launch(threadSpec, { signal })
const channel = await handle.open(signal, { scheduler })
```

Here `threadSpec`, `signal` and `scheduler` are the deployment's actual existing resources. Web
runtime adapters use `createAdapterWebThreadLauncher` with their actual Worker constructor.
`createAdapterNodeThreadChannelFactory` and `createAdapterWebThreadChannelFactory` retain the
existing strict raw-port path for custom handles; a copied handle cannot supply a private ACK or
receive-handoff owner. The Web handle's existing `prepared` Promise remains available, while the
old `runtimeApi` plumbing output is removed from both handle families. `RpcThreadErrorCode` and
`RPC_THREAD_ERROR_SOURCE` classify a `sampleUsage` failure with its original native error cause.

A foreign-language bridge adapter supplies its held ordered byte connection to the complete
JSON-RPC channel operation. The bridge owns JSON-RPC framing and correlation. Core reads the authenticated hello
through held object I/O and constructs the gated transport; its object port and batch facts stay private.

```ts
import { createJsonRpcAdapterChannel } from '@migaia/rpc-bridge-jsonrpc'

const channel = await createJsonRpcAdapterChannel({
  byte: heldByteIO,
  peerId,
  target: { kind: 'plugin', contract: remoteContract },
  offer: localOffer,
  token: issuedToken,
  scheduler,
  wallClock,
  ipc,
  report
})
```

The variables above belong to the existing deployment and authentication issuer. JSON-RPC frame
operations and diagnostic catalogs come from `@migaia/rpc-contract/framing/jsonrpc`. Neither this
operation nor the Thread operations accept an existing target transport to qualify. Spreading a
returned transport, adding capability labels or copying a codec never recreates its private
registration. The neutral Core entry does not import native runtime modules or these adapter
entries.


`AdapterNodeThreadParentChannel` holds an actual parent MessagePort and provides its complete
`open(peerId, options)` operation. Holding it installs no listeners. The original Node adapter
import retains this resource privately, so later direct `createNodeThreadChannel(parentPort, ...)`
calls preserve lazy replay qualification. Only actual channel construction consumes the existing
Core-private initializer; there is no public lifetime registrar or target transport input.

自定义载体可从 Core 根入口使用 `serializeRpcError` / `deserializeRpcError`，对持有的错误或 wire 数据编码/恢复，保留 Core/Remote 的原脱敏与 forwarding-route 策略；私有 maps 留 Core，完整 walker 仍唯一归 Contract。

## 第三方公开错误面

协议实现者使用 `@migaia/rpc-contract/errors` 的 wire schema、序列化/校验/遍历及 JSON-RPC 映射；适配器作者使用 Core 根入口的 wire 操作和 `isRpcErrorInstance`、`isRpcRemoteError`、`isRpcTimeoutError`。六个 source 常量与各 owner 的错误码表公开，原 source 字符串不变。B6 守卫跨 realm/模块副本用于诊断；`isRpcError` 的 code-is-string 检查不能替代它们。

`*ErrorText` / `*Diagnostic` 文本表和 `tagRpcError` 私有；这是更名后包的破坏性导出收敛。错误类仅作类型导出，唯一 `RpcLifecycleError` 运行时类供 Store Worker 等持有自身 dispose 状态的消费方构造诊断，不 mint Core 操作身份。真实 dispose 失败后的 cleanup 展示沿原路径复用原 Error 身份，不决定是否关闭操作。

已接纳错误的现有字段，包括 caller 取消 reason、store/缓存及解码后的 wire 错误，可沿既有 wire 和 terminal report 展示。mint、cancel、retry、close、计数、retire 与 replay admission 由 owner 私有身份或实际操作状态决定，不能依据这些错误的公开 source/code。普通解码与公开 listener failure helpers 只产生诊断，不登记 Core 控制身份。

第三方通过 `@migaia/utils/error` 的 `attachErrorIdentity` 抛自己的 source/code；Core 保留原错误或 cause。source/code 表、wire schema/限额、普通 JSON-RPC 映射及短例见 [USEGUIDE](./USEGUIDE.md#第三方公开错误面与错误编码)。
