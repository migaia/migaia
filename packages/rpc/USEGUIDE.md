# @migaia/rpc 使用指南

同一套调用 API 用于进程与 Worker。四个生产入口是 createProcessPeer、createProcessPlugin、createThreadPeer、createThreadPlugin；没有包根入口，按用途导入子路径。Peer 是独立连接；Plugin 由 PluginHost 拥有，并发布 host.process 或 host.thread 共享出口。

## 入口与协议基线

| 用途                    | 子路径                                                                                         | 入口                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 进程 Peer / Plugin      | @migaia/rpc/process                                                                            | createProcessPeer / createProcessPlugin            |
| Worker Peer / Plugin    | @migaia/rpc/threads                                                                            | createThreadPeer / createThreadPlugin              |
| 测试中的真实对称 Peer   | @migaia/rpc/testing                                                                            | createPeerPair                                     |
| 显式底层语义与组装      | @migaia/rpc/contract、@migaia/rpc/core/*、@migaia/rpc/remote                                   | codec-independent contract、endpoint、remote ports |
| 浏览器与运行时适配      | @migaia/rpc/browser/adapters/_、@migaia/rpc/process/adapters/_、@migaia/rpc/threads/adapters/* | 选实际平台的 adapter                               |
| Content-Length JSON-RPC | @migaia/rpc/bridge/jsonrpc                                                                     | byte bridge                                        |

握手双方必须支持 v2 describe 和 batch 帧接收，否则在握手阶段沿既有错误码拒绝。库从真实 provide/expose 自动生成 schemaVersion 2 目录；没有 v1 describe、单帧或基础 1.1 回退。反向调用、orderKey、group、cancel before-start、outcome、binary 和 transfer 按双方实际能力协商；显式使用而对端缺失时 fail closed，不能偷偷改变业务语义。

contract/v1 是仍保留的语义描述子路径名，不代表 runtime-api 支持旧 describe 回退。JSON 是原握手基线 codec；其它 codec 由实际双方 offer 协商。底层 core 可按需组合 Feature，但新的 runtime Peer 必须遵守上述基线，不能用自定义 endpointFactory 伪造已安装能力。

## 四个生产工厂

从 `@migaia/rpc/process` 导入 `createProcessPeer`、`createProcessPlugin`，从 `@migaia/rpc/threads` 导入 `createThreadPeer`、`createThreadPlugin`。Peer 是调用方自己关闭的独立连接；Plugin 安装进真实 PluginHost，使用原 `host.process` 或 `host.thread` 共享出口。测试辅助 `@migaia/rpc/testing` 的 `createPeerPair` 仍装配真实 canonical Peer，不能据此声称拥有进程、Worker 或 transfer 能力。

`provide` 声明自己可被调用的函数。只接受可枚举的 own data 成员；嵌套对象生成点分路径，getter、循环、非法名字、重复路径在打开来源前拒绝。`expose` 默认为空，只把实际本地 Feature 方法或已接受连接的方法显式公开；`expose: ['math.add']` 不会授予 `math.sub`。类型声明不能替代运行时白名单、鉴权或资源所有权。

普通函数的 request/notify 接收可移植标量结果，stream 需要实际 iterable。目录由库生成并记录实际 route，不能从擦除后的 TypeScript 类型恢复 generator 模式。显式高级 contract 仍限制 schema、模式和幂等性；它不是旧 v1 describe 回退。

## 集成 API

自行管理底层连接时，从 `@migaia/rpc/remote` 使用 `createRuntimePeer`、`createManagedRuntimePeer` 或 `createRuntimePlugin`。传入的实际 channel/bootstrap、binding/execution 或 Host slot 操作决定可访问的资源；`RuntimePluginKey`、`RuntimeSourceKind`、`RuntimeConnectionDirection`、`RuntimeEventName`、`RuntimeQueryStatus`、`RuntimeApiMode` 和 `RUNTIME_API_SCHEMA_VERSION` 提供配置与查询的稳定词汇。`DEFAULT_DRAIN_MS` 是原关闭预算。公开的 Peer/source/plugin、目录/query/list/recent/unavailable/event、process/thread stop DTO 及 `IRuntimeSurface`、`IRuntimeFlatten`、`IRuntimeExpose`、`IRuntimeRegistry`、`IRuntimePluginTyping` 用于描述这些既有操作，不建立额外连接。

从 `@migaia/rpc/core` 构造实际通道的资源时，`createRuntimeApiEndpoint(config, channel, quota?)` 同步返回资源，`.ready` 是一次安装结果。传入的 channel 必须是实际持有的 transport、peer identity 和 agreement；借用完整绑定则使用 `createRuntimeApiEndpoint({ binding })`，保留原操作结果、stream consumer 和 dispose 的首次 Promise。未拉取的 cold stream 只保留同步 payload snapshot，首次 next/return/throw 才激活同一个 consumer。

共享 provider 预算从 `@migaia/rpc/core/features/provider` 导入 `createProviderAdmissionScope` 与 `IProviderAdmissionScope`。同一个 handle 由第一次实际 endpoint attachment 配置初始 provider limits；之后 `constrain(maxGlobal?, maxPerPeer?)` 只收紧该 quota。cold `constrain` 只进行原参数校验，cold `clear` 无操作；不要把冷阶段调用当成已保存限制。实际安装后使用示例：

```ts
import { createRuntimeApiEndpoint } from '@migaia/rpc/core'
import { createProviderAdmissionScope } from '@migaia/rpc/core/features/provider'

const quota = createProviderAdmissionScope()
const endpoint = createRuntimeApiEndpoint(config, channel, quota)
await endpoint.ready
quota.constrain(32, 8)
```

这里的 `config` 与 `channel` 是调用方已有的实际 endpoint 配置和通道资源。`createAuthenticationNonce` 同样从 `@migaia/rpc/core` 导入，用于现有 authentication middleware 的 nonce；它不建立认证会话。

| 入口 | 集成用途 |
| --- | --- |
| `@migaia/rpc/contract` | `RPC_PORTABLE_MAX_DEPTH` 表示现有 portable grammar 上限。 |
| `@migaia/rpc/contract/v1` | `IRpcBinaryDigest` 描述调用方提供的 whole-backing digest；`IRpcRuntimeStepOutcome` 描述 group 每步 success/failure/not-executed。 |
| `@migaia/rpc/contract/framing` | `readRpcBatchMembers` 读取物理 batch；`measureRpcPhysicalFrame`、`assertRpcPhysicalFrameSize`、`rejectRpcPhysicalFrameSize` 沿实际 carrier/limit 判断物理帧预算。 |
| `@migaia/rpc/contract/framing/v1` | `RpcBinaryProfile`、`RpcBinaryStorage`、`RpcNativeBinaryKind` 与 `RpcRuntime*` 常量提供现有 closed wire grammar 的稳定值。 |
| `@migaia/rpc/contract/spi` | `normalizeRuntimeEnvelope`、`normalizeRuntimeGeneration`、`normalizeRuntimeSteps` 校验协议值；`runtimeOperationCapabilities` 给出操作所需能力；`readRuntimeCarrier`、`wrapRuntimeCarrier` 读写现有 carrier 表示。 |
| `@migaia/rpc/contract/spi` | `prepareRpcBinary`、`restoreRpcBinary`、`readRpcNativeBinary`、`measureRpcNativeBinaryFrame`、`rpcBinaryBackingLength`、`rpcBinaryView` 和 `isRpcBinaryIntegrityFailure` 处理调用方提交的 binary backing/view、预算及完整性。 |
| `@migaia/rpc/contract/spi` | `createRpcStreamFrameDecoderWithLimit` 创建有界帧 decoder；`redactHandshake` 与 `isExcerptFree` 用于安全的 handshake 诊断表示。 |
| `@migaia/rpc/core/spi` | `defaultRpcId` 与 `assertRpcIdempotencyKey` 使用现有 ID/key 规则；`isRpcErrorInstance`、`isRpcRemoteError`、`isRpcTimeoutError` 分类原 native 或 coded 跨 realm 等价错误，保留原对象和 cause。 |
| `@migaia/rpc/remote/spi` | `normalizeRuntimeDescription` 校验 runtime directory description。 |

SPI 是稳定性层级，任何调用方都可导入；调用 codec、读取 DTO 或复制回调不会建立其它 process/channel/Host 的操作权。未知/custom 路径仍执行原完整校验。

String framer 接收到非字符串 encoded value 时保留原 native `TypeError` 与文本 `process channel requires a string encoded value`，错误身份为 `@migaia/rpc/contract / INVALID_FRAME`；此前针对这一场景的 `@migaia/rpc/core / PAYLOAD_INVALID` 分支需改用该身份。其它 payload 失败保持原 Core 身份。

## 类型

不提供 Remote 泛型时，没有可调用的远端方法类型。声明远端函数树后，request 保留路径、参数与结果类型；stream 只接受迭代器方法。`IRuntimeSurface<THost,TPlugin>` 从现有 Host tuple、provide、expose 提取纯类型，不创建运行时目录。显式 Remote 泛型与精确 name/expose/Host 类型同时需要时，显式填写其余泛型，沿 TypeScript 的部分推导规则。

`typedRemote` 可以是应用变量名，例如 `const typedRemote = await createThreadPeer<IChildApi>(options)`，并不是另一个生产工厂。显式 `IRuntimeDynamicSurface` 只放宽编译期的动态调用，运行时仍按已接受的方法和模式拒绝，不能拿它授权透明转发。

## 调用签名与目标选择

| 独立 Peer                           | PluginHost outlet                           | 结果                                           |
| ----------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| request(method, payload?, options?) | request(target, method, payload?, options?) | 原操作 Promise，解析为该方法结果               |
| notify(method, payload?, options?)  | notify(target, method, payload?, options?)  | Promise<void>，只到物理发送完成                |
| stream(method, payload?, options?)  | stream(target, method, payload?, options?)  | 原 lazy AsyncIterableIterator                  |
| group(steps, options?)              | group(target, steps, options?)              | 有序 success / failure / not-executed 步骤结果 |
| outcome(idempotencyKey)             | outcome(target, idempotencyKey)             | pending / done / unknown 与实际 store 连续性   |
| describe(options?)                  | list(options?) / get(target, options?)      | 安全本地可移植投影或选定文本格式               |
| close()                             | Host dispose / Plugin unUse                 | 原资源 owner 的关闭与 drain 结果               |

outlet target 可以是已安装连接名，或 `{ name, instanceId }` 精确选中该名字下的实际实例；同名多会话无法唯一选择时拒绝，不能偷偷选首项。on/watch、broadcast 与 stop/kill/restart/replace 由 Host outlet 提供，独立 Peer 的查询入口是 describe。broadcast 收集各目标结果并按原 report 处理失败，不是全体成功承诺。

调用选项使用 signal、timeoutMs、idempotencyKey、orderKey、cancel:'before-start'；thread 还按实际能力接受 transfer。参数 payload 与控制选项分开，不能把 signal、native handle 或新的管理对象塞进业务数据。group 只接受 `{ method, payload? }` 步骤，不接受逐步 target、mode 或 options；整组共享一个目标和选项。failure 的原序列化错误保留 source/code/name/message/stack 与 cause/errors 链，后续 not-executed 不是业务错误。

## 来源与所有权

对端目录中的 name 是显示标签，不是 launcher 名称认证或控制权限；控制依实际 authenticated instanceId、generation 和原 native handle。自动 process instanceId 是模块本地单调身份，不承诺跨模块副本或跨父进程全局唯一。

只有真实库 launcher 创建的 child、validated bootstrap 与实际原生父通道，才可以省略来源并自动连接。其余配置必须且只能指定一个 `spawn`、`connect` 或 `listen`；没有 `parent` 选项，没有隐藏 direct/upgrade 分配器。需要避开 relay 时，应用显式建立独立 connect/listen 通道。

spawn 使用既有 launcher、scheduler、unit budget、channel factory/establish、认证、健康、重启与 drain 配置。高级 source 回调必须交出实际完成协议协商的通道，不能伪造 capabilities 或身份。单纯 Worker 构造器、PID、名字、bootstrap 字段或 `ownership: 'owned'` 不授予 stop/kill/restart/replace 权限。connect/listen、借用 Worker 和 MessagePort 只关闭本端连接，不能结束对端。

旧 prewarm 池与新 bootstrap 严格来源身份不相容时拒绝，不修改 pool.launcher 伪造来源；高级原 binding 的 prewarm 支持不等于新自动工厂已支持该组合。Bun 使用它实际的 Bun/Web bootstrap adapter，Node adapter 不能替代。没有 native exit/resource 事实时明确 unavailable。

目录 ready 证明连接与方法已被接受，不证明远端 PluginHost use 事务已提交。需要控制安装后的 Feature 时，等待该应用真实提交结果，不用重试掩盖尚未完成的安装。

## 调用与超时

调用前的 method、payload、能力与本地选项准入可能同步抛错；需要统一处理时，把调用表达式放在 try/catch 内，不只对返回 Promise 调用 catch。这是既有严格前置准入语义。

request 返回原 canonical 操作 Promise；notify 在原物理发送 commit/completion 边界结束，不证明 provider 成功；stream 保留原 lazy iterator，在首个 next/preparation 前不发送业务帧。默认 request/stream 超时 30000 ms；factory 的 defaultTimeoutMs 必须有限且为正。每调用 `timeoutMs: false` 关闭默认期限，合法 `0` 表示立即到期；仍受原 launcher callWallTimeMs cap 限制。

有依赖的串行 await 不能自动合并。高频小调用请批量发送或使用 Promise.all，并控制并发。notify 适用于不需要业务应答的调用，发送成功不能用作结果确认。默认 provider 并发上限为每个 peer 64、全局 256；超过准入额度返回 OVERLOADED。降低调用并发，按下文逐错误码策略有界退避，不把通知发送成功当成 provider 已执行。

`orderKey` 在最终 provider 的原命名空间串行化。`cancel: 'before-start'` 只撤销开始许可；开始先赢后，保留原真实结果。已开始 stream 的 return/throw 进入原 finish/discard 分支，等待同一个 producer 真正终结，不创建第二条流或缓存所有 items。普通取消是协作式，本地取消不证明 provider 没执行。

group 原子预留完整组的执行容量，按序执行；保留成功步，第一失败后剩余步为 not-executed。它不回滚副作用，不是事务、分布式锁或 2PC。完整物理组受16MiB及更小carrier上限约束，不能分帧绕过。`outcome(key)` 只读原结果 owner并立即返回当前快照：pending 表示原操作仍在执行，消费侧在总预算内等待后再查；done 复用保留结果，unknown 不表示未执行。memory 的重启丢失连续性不能伪称安全再发。

## 转发

expose 已接受连接的方法前缀可透明转发。每一跳捕获实际 target/generation，正在执行的调用不随同名替换跳代；最终 provider 鉴权的是直接上一跳，不委托原调用者 principal。relay 不缓存业务 outcome。签名 route 拒绝环与第四个转发节点，最多三层转发。`PROVIDER_GENERATION_RETIRED` 的在飞转发可能已经执行，不能单凭该码再执行非幂等业务。

## 二进制和 transfer

ArrayBuffer/Uint8Array 需要实际协商的 binary profile；视图 offset/length 保真，共享同 backing 的视图共享完整所有权边界。SharedArrayBuffer/Atomics、其它未经裁定的 typed arrays 及伪造 native slots 不支持。process 只要有 own transfer 属性，包括空数组或 undefined，就拒绝；thread 还要求真实 clone-transfer carrier、binary/transfer/manifest 能力与实际支持的 sign-only 配置。

保护和预算计算覆盖完整 backing，不只是 view 可见字节。显式 transfer 在物理 commit 才 detach，所有共享 backing 的视图同时失去所有权；此后失败、断线或接收完整性拒绝不能恢复原 buffer。签名/detach 不代表 provider 成功。transfer 禁止自动重放，不保留隐藏输入备份；再次发送前先对账并显式重建输入。加密/opaque/缺digest/bytecarrier/chunk等不支持组合在commit前fail closed，不降级为明文。实际复制和速度引用C10测量，不宣称零复制。

### 已执行的二进制验收边界

C10 在 Node stdio、Node/Bun/Web Worker 的真实路径验证 ArrayBuffer / Uint8Array 类型、内容、view offset/length、完整 backing 所有权以及签名 transfer 的 detach；不能把旧 descriptor 成功当作 native 内容成功。默认 inline 路径需编码和规范化，signed native manifest 与 inline 是不同路径，不能把二者的速度差称作认证本身的收益。

C10 的 before/after 数据显示 inline 与 sign-only native/transfer 的成本不同。当前未取得新的 AC、负载≤3、A/A≤10%冻结值，因此这里不给当前机器吞吐承诺；不得把历史数字安装成新 W3 基线。完整历史数字与支持形状、真实 detach 的收据保留在实施交接，OS/crypto 总零复制未被证明。

process 的 1MiB inline 会受编码、规范化和 framing 成本影响；高频大 binary 不应按 scalar 小调用吞吐推算。共享内存/Atomics 没有进入支持面，不能由此用 SharedArrayBuffer 绕所有权边界。未认证 transfer 按 CAPABILITY_UNSUPPORTED 拒绝，失败并非自动复制降级。

inline Uint8Array 只携带 view 的可见 bytes，恢复为零前缀加原 offset/length；重复引用分别恢复。native manifest 则保留完整 backing 与 alias，并验证完整 backing 的 digest。大 binary 的编码资源与 JSON 准备复用不改变这两种 profile，也不自动选择 transfer。

## 查询、控制和事件

从 `@migaia/rpc/remote` 导入 `RuntimePluginKey`，用其 `process` / `thread` 值解释 Plugin 与查询的标量元数据。这两个标签不定位未持有的 Host slot，也不授予 channel 或 native execution 操作权；控制仍由实际持有的资源决定。

list/get/describe 是本地冷查询，默认返回可移植对象，格式参数选择字符串。methods 为名称数组，wire 模式目录独立保留；listener 在尚未接纳 session 时也有自己的本地方法目录。连接详情区分实际接纳的 generation 与 native launch attempt。缺资源、健康、退出或计数事实用 unavailable，不伪造0，也不遍历ledger或增加业务observer来重建。

on 返回幂等 disposer；监听抛错/迟到拒绝被报告而不替换主流程。watch 是原 publisher 的有界本地事件迭代器，超过100条会报告 RUNTIME_EVENT_OVERFLOW 并结束；先查询当前状态，再新订阅。没有清算 owner 的路径不编造 liquidated 事件。

close 同步撤销新业务准入，重复调用返回同一 Promise；原已准入 request/group/stream 在 native drain 内结算。stop/kill/restart/replace 沿原真实所有权与队列；thread stop 的 signal 字段（含显式 undefined）非法，process stop 的升级路径由原 supervisor 决定。

## 速率与并发边界

legacy 墓碑账本路径包括 web 载体、BroadcastChannel，以及自定义 ID 生成器。默认出站容量 4096/endpoint；入站容量 1024/peer、4096 全局；保留时间 310000 ms。C7 用 canonical owner 和受控单调时钟实际验证容量与到期，容量除以保留时间得到持续上限：出站约 13.21 次/秒/endpoint，入站约 3.30 次/秒/peer、全局约 13.21 次/秒。这是保留容量导出的持续速率界限，不是墙钟吞吐；短时突发仍受有限账本容量约束。

具备 replay-window L 原生资格的独占 process/Worker 通道只保留活跃请求，不受上述墓碑持续速率限制。只有真实 native source 的既有资格成立才适用；把任意 transport 标成 exclusive 或更改 ownership 字段不能获得此资格。

provider 并发默认每 peer 64、全局 256；同时进行的 request/notify/stream 按原 admission owner 计量。超限返回 OVERLOADED；降低并发，在剩余总业务预算内退避并加入抖动。客户端错误当前不包含 provider rejection reason，不能仅凭 OVERLOADED 判断零执行；provider 的原 onRejected 有具体 reason。

本次 C7 没有取得满足 AC Power、lowpowermode 0、起止负载≤3、同窗 A/A≤10% 的最终吞吐值，因此不提供当前机器的稳定吞吐数量级，也不把历史估计写成新基线。三次资格未通过的原始观察与电源、负载、噪声已保留给性能 owner；部署容量应以合格窗口实测为准。高频小调用请批量发送或使用 Promise.all；有依赖的串行 await 无法自动合并。需要业务结果时使用 request，notify 的成功只证明物理发送。

## U40/K270 与重试

非独占载体由实际 receiver 身份绑定 challenge，SIEVE 只决定会话驻留，不复活被淘汰的 challenge。SESSION_UNKNOWN 是 AUTHENTICATION_FAILED 的本地拒绝 reason，不是新增公开顶层错误码；只丢对应 challenge 缓存，未来新调用重新发现，任何旧业务帧不自动重放。receiver 重启不能证明旧业务没执行。 CHALLENGE_INVALID 同属 AUTHENTICATION_FAILED 的本地拒绝 reason，表示 challenge 字段语法或方向非法；修帧合同，不盲重试，也不是新的顶层 code。

先读取 `(source,code)`、原 cause/errors 链和可独立确认的执行阶段。客户端 provider 错误当前不带 rejection reason，OVERLOADED 不能独自区分并发、replay容量或其它准入分支；provider 的原 onRejected 才有 reason。降低并发，以剩余总业务预算做有界退避和抖动；只有独立证据确认零执行，或原 key/outcome/业务幂等机制足以对账，才新尝试。通道已恢复、deadline、transport loss、ordinary cancel、unknown 都不等于未执行。

下文附每个公开 RPC source/code 的完整策略表；业务或依赖包的原 source/code 不被RPC改成安全重试许可。

## 完整示例

以下六个文件经当前公开 d.ts 严格检查，编译后四个父端均真实调用得到 42 并正常退出。项目使用 ESM，把同目录 TypeScript 编译到 .js；四个父端分别运行，不复用一个已经启动的 spawn。

### Worker 子端 worker.ts

```ts
import { createThreadPeer } from '@migaia/rpc/threads'

await createThreadPeer({
  provide: { math: { double: (value: number) => value * 2 } },
  report: (error) => console.error(error)
})
```

### createThreadPeer 父端 main.ts

```ts
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc/threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc/threads/adapters/node'
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

### createThreadPlugin 父端 main.ts

```ts
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc/threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc/threads/adapters/node'
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
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc/threads'

const worker = createThreadPlugin<IChildApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn,
  report
})
const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(worker)
  console.log(await host.thread!.request('worker', 'math.double', 21))
} finally {
  await host.dispose()
}
```

### 进程子端 service.ts

```ts
import { createProcessPeer } from '@migaia/rpc/process'

await createProcessPeer({
  provide: { math: { double: (value: number) => value * 2 } },
  report: (error) => console.error(error)
})
```

### createProcessPeer 父端 main.ts

```ts
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  createProcessPeer,
  createProcessTransport,
  type IProcessByteChannel
} from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'

type IChildApi = { math: { double: (value: number) => number } }
type IOptions = Parameters<typeof createProcessPeer<IChildApi>>[0]
type ISpawn = Exclude<NonNullable<IOptions['spawn']>, Function>
const report = (error: unknown) => console.error(error)
const launcher = createNodeProcessLauncher()
const token = randomBytes(32).toString('base64url')
let handle: Awaited<ReturnType<typeof launcher.launch>>
const spawn: ISpawn = {
  kind: 'spawn',
  channelKind: 'byte',
  wire: 'native',
  token,
  supervision: {
    id: 'math-process',
    isolation: 'best-effort',
    report,
    launcher: {
      ...launcher,
      launch: async (spec, request) => {
        handle = await launcher.launch(spec, request)
        return handle
      }
    },
    budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
    spec: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./service.js', import.meta.url))],
      env: { inherit: ['PATH'], set: {} },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
    }
  },
  rawChannel: async () => handle.channel!,
  establish: (raw, prepared) =>
    createProcessTransport(raw as IProcessByteChannel, {
      role: 'initiator',
      offer: prepared.offer!,
      peerId: handle.runtimeApiIdentity!.instanceId,
      scheduler: prepared.scheduler,
      ipc: { ...prepared.session, log: () => undefined },
      report
    })
}
const typedRemote = await createProcessPeer<IChildApi>({ spawn, report })
try {
  console.log(await typedRemote.request('math.double', 21))
} finally {
  await typedRemote.close()
}
```

### createProcessPlugin 父端 main.ts

```ts
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  createProcessPeer,
  createProcessTransport,
  type IProcessByteChannel
} from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'

type IChildApi = { math: { double: (value: number) => number } }
type IOptions = Parameters<typeof createProcessPeer<IChildApi>>[0]
type ISpawn = Exclude<NonNullable<IOptions['spawn']>, Function>
const report = (error: unknown) => console.error(error)
const launcher = createNodeProcessLauncher()
const token = randomBytes(32).toString('base64url')
let handle: Awaited<ReturnType<typeof launcher.launch>>
const spawn: ISpawn = {
  kind: 'spawn',
  channelKind: 'byte',
  wire: 'native',
  token,
  supervision: {
    id: 'math-process',
    isolation: 'best-effort',
    report,
    launcher: {
      ...launcher,
      launch: async (spec, request) => {
        handle = await launcher.launch(spec, request)
        return handle
      }
    },
    budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
    spec: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./service.js', import.meta.url))],
      env: { inherit: ['PATH'], set: {} },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
    }
  },
  rawChannel: async () => handle.channel!,
  establish: (raw, prepared) =>
    createProcessTransport(raw as IProcessByteChannel, {
      role: 'initiator',
      offer: prepared.offer!,
      peerId: handle.runtimeApiIdentity!.instanceId,
      scheduler: prepared.scheduler,
      ipc: { ...prepared.session, log: () => undefined },
      report
    })
}
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc/process'

const child = createProcessPlugin<IChildApi, Record<never, never>, 'child'>({
  name: 'child',
  spawn,
  report
})
const host = defineHost<Record<string, never>, never, readonly [typeof child]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(child)
  console.log(await host.process!.request('child', 'math.double', 21))
} finally {
  await host.dispose()
}
```

Node process 示例显式使用 best-effort：当前 launcher 对整树 termination 的正式能力仍为 unsupported，原 supervision 会报告此降级，业务 42 与退出成功不证明严格整树终止。需要 strict 整树隔离时，使用已有平台能力已证实的 launcher；不要由 PID、channel close 或任意 ownership 字段推断。token 是本地生成的 private bootstrap/auth 材料，不打印、不放进 provide 或目录。示例中的 handle 来自真正 launcher，其 runtimeApiIdentity 是原身份 owner。

省略子端来源要求真实库 launcher 和其可信 bootstrap。单独运行 worker/service 文件会在配置阶段拒绝；应用需要借用来源时显式提供 connect/listen。

## 逐错误码处理与重试

先看(source,code)和发送/执行阶段。未知结果不等于未执行；caller错误目前不带provider rejection reason，不能只凭OVERLOADED证明provider0。provider本地onRejected才保具体分支。退避、限制并发和总业务预算属于consumer。原registration严格单次keyed重试保持。

| core code                      | 消费侧处理                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| PROVIDER_GENERATION_MISMATCH   | 重新选择已接受目标；确认零执行后才新尝试，不沿name偷换当前在飞目标。                        |
| PROVIDER_GENERATION_RETIRED    | U38在飞转发可已执行，不仅凭此码重执；同key查询outcome或业务对账。                           |
| FORWARD_LOOP                   | 修连接/路径；相同路径重试无效。                                                             |
| FORWARD_HOP_LIMIT              | 缩短路径或用connect/listen；相同路径重试无效。                                              |
| MIDDLEWARE_DUPLICATED          | 修构造配置。                                                                                |
| MIDDLEWARE_MISSING             | 在原owner装必需能力。                                                                       |
| CAPABILITY_UNSUPPORTED         | 换受支持method/mode/profile；不去掉order/group/cancel/transfer作隐式降级。                  |
| INVALID_CONFIG                 | 修配置/选项；process own transfer含[]/undefined必须删除或改用合法thread部署。               |
| PROVIDER_DUPLICATED            | 合并/改名注册，不能靠调用重试修复。                                                         |
| PROTOCOL_INVALID               | 修线材/协议与版本；不重发同一坏帧。                                                         |
| CONTRACT_INVALID               | 修method/模式/关联，key冲突保原操作；不能用换key掩盖已可能执行的业务。                      |
| PAYLOAD_INVALID                | 修数据/大小/受支持binary形状；准备失败可重构数据，但物理commit后的buffer可能已detach。      |
| PROVIDER_NOT_FOUND             | 查已接受目录，迁方法或等待provider兼容升级；不盲重试同名未知方法。                          |
| PROVIDER_NOT_SETTLED           | 修provider完成路径，不能推断业务副作用没发生。                                              |
| INTERNAL                       | 按业务错误和原cause链处理；默认不自动重执。                                                 |
| TARGET_UNKNOWN                 | 重新读取本地可用性/目标目录；在零发送事实成立后再选择新目标。                               |
| TARGET_NOT_IDENTIFIABLE        | 建立可pin的显式实例连接，不向广播匿名组重试逐实例操作。                                     |
| ENDPOINT_DISPOSED              | 新建Peer；不复活旧句柄，旧结果仍按原操作对账。                                              |
| CANCELLED                      | 尊重signal/reason；before-start start已赢时仍等原真实结果，不再发第二次业务。               |
| DEADLINE_EXCEEDED              | 已可能执行时查询同keyoutcome或对账；不换key盲跑。before-start明确未开始才可新尝试。         |
| PROVIDER_CONTEXT_EXPIRED       | 修provider生命周期；迟到完成不会补发副作用，不重新调用业务修补。                            |
| TRANSPORT                      | 物理commit/失联可能已执行，恢复通道后先查结果；transient不等于安全重试。                    |
| AUTHENTICATION_FAILED          | 修配置或建立新真实会话；SESSION_UNKNOWN只丢challenge缓存，不自动重放旧业务。                |
| SCHEMA_INVALID                 | 修参数/结果schema；原参数不重试。                                                           |
| CAPABILITY_CONFLICT            | 修装配/实例歧义；不能通过调用重试选择猜测的owner。                                          |
| OVERLOADED                     | 降并发，按总预算退避（consumer可用有界指数退避与抖动）；只有独立证据确定provider0才新尝试。 |
| STREAM_RESULT_UNKNOWN          | 不重放已交付item；先业务对账，再显式开新流。                                                |
| CHUNK_INVALID                  | 修framing/载体；native完整帧不通过chunk绕预算。                                             |
| PROPERTY_READ_FAILED           | 修getter/proxy或报告边界；坏输入不重试。                                                    |
| IDEMPOTENCY_RESULT_UNAVAILABLE | 原业务已执行但结果不保留；对账，不换key重执。                                               |
| STRING_CONVERSION_FAILED       | 修转换/诊断边界，原输入不重试。                                                             |

outcome：pending只在总预算内等待或查询；done复用保留成功/失败；unknown不推断未执行。memory连续性lost-since-restart需业务对账/放弃，外store真正done才确定。成功notify Promise只证明物理发送，不证明业务成功；错误的处理也必须遵守这一边界。

transfer：签名/detach不等于provider成功。真正native commit后原buffer及共享views可能分离；任何自动key retry禁用，不保存输入重试备份。需要再发时consumer显式重构数据，且先确定业务结果/幂等安全。

其它source的错误保原语义：remote的REMOTE_RESULT_UNKNOWN同样先查询/对账；REMOTE_CLOSED只允许新的目标选择而不重放已可能执行的调用；PluginHost可用性码按本地状态恢复，RPC不把业务或依赖副作用回滚成provider0。各公开 source 的处理见下表。

## 其它公开 source 的逐码指引

以下依据当前三个 package-owned error-code 文件。`REMOTE_CLOSED`、channel closed 或已恢复 ready 都不证明旧业务未执行；是否安全再发仍由发送事实、原 key/outcome 与业务对账决定。

| source              | code                              | 消费侧处理                                                                                               |
| ------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| @migaia/rpc/remote  | RUNTIME_EVENT_OVERFLOW            | 当前 watch 已失去完整事件历史；先 list/get/describe 查询当前状态，再新订阅。不要用缺失事件推断业务结果。 |
| @migaia/rpc/remote  | REMOTE_CONTRACT_INVALID           | 修目录/control 参数或契约；重复相同输入无效。                                                            |
| @migaia/rpc/remote  | REMOTE_HOST_NOT_ADOPTED           | 先完成该连接对同一远端定义的 hostUse，再 hostUnUse；不绕采纳者权限。                                     |
| @migaia/rpc/remote  | REMOTE_START_FAILED               | 查原 cause 与实际监督状态；确认没有发业务后，可在总预算内重新准备合法来源。                              |
| @migaia/rpc/remote  | REMOTE_CLOSED                     | 原注册或代已离开；重新读 ready 目标。对已发送的原业务先查结果，不自动转投同名后继。                      |
| @migaia/rpc/remote  | REMOTE_RESULT_UNKNOWN             | 业务可能已执行；查询原 key/outcome 或对账。非幂等业务不重执；transfer 不自动重放。                       |
| @migaia/rpc/process | PROCESS_USAGE_SAMPLE_FAILED       | 资源值报告 unavailable，保 cause；查询失败不触发 restart 或重执业务。                                    |
| @migaia/rpc/process | PROCESS_HOST_INVALID_OPTION       | 修命名字段，原配置不重试。该码属于仍保留的 process owner；不恢复已删除工厂。                             |
| @migaia/rpc/process | PROCESS_HOST_CLOSED               | 新建合法 Peer/注册；不复活原 façade，也不借恢复重发可能已执行的工作。                                    |
| @migaia/rpc/process | PROCESS_HANDSHAKE_TIMEOUT         | 关闭失败候选并重新建立通道；保原总预算。握手失败不是已发送业务的结果证明。                               |
| @migaia/rpc/process | PROCESS_CHANNEL_AUTH_REJECTED     | 修凭据/授权配置；不盲重试认证。                                                                          |
| @migaia/rpc/process | PROCESS_CHANNEL_CLOSED            | 重新连通前先处理原在飞结果未知；有独立零发送证据的工作才可另选目标。                                     |
| @migaia/rpc/process | PROCESS_CHANNEL_CONNECT_FAILED    | 查原 cause；修地址/权限/可用性后，可按剩余总预算退避重连。                                               |
| @migaia/rpc/process | PROCESS_CHANNEL_LISTEN_FAILED     | 修地址、权限或占用；原 listener 不存在时不能当成已接受连接。                                             |
| @migaia/rpc/process | PROCESS_PLUGIN_INVALID_OPTION     | 修 Plugin/source/权限选项，原配置不重试。                                                                |
| @migaia/rpc/process | PROCESS_RESILIENCE_INVALID_OPTION | 修 limits、ownership、health 配置；不把非法策略当运行时瞬时失败。                                        |
| @migaia/rpc/process | PROCESS_CONNECTION_LIMIT          | 降连接数、速率或 payload；该准入拒绝在 provider 前，可在限制满足且总预算允许时重试。                     |
| @migaia/rpc/process | PROCESS_INSTANCE_UNHEALTHY        | 等待真实 ready 后继或处理健康事件；不复用 suspended 实例，不重放旧代可能执行的业务。                     |
| @migaia/rpc/process | PROCESS_HEALTH_PING_FAILED        | 交原监督 owner 按策略处理；消费者不并行建立第二 restart owner。                                          |
| @migaia/rpc/process | PROCESS_TERMINAL_CALL             | 当前注册不再收新调用；等合法 ready 状态或新注册，旧调用仍按原结果对账。                                  |
| @migaia/rpc/process | PROCESS_LIQUIDATED                | 新建注册；不能 restart 已 liquidated 注册，不因此重执原业务。                                            |
| @migaia/rpc/threads | THREAD_USAGE_SAMPLE_FAILED        | 保 cause 并显示 unavailable；不以父进程数值替代，也不因采样失败改 Worker 生命周期。                      |

代码表与当前六个 package-owned 声明文件核对，共 68 个 source/code。下表不授予未知结果重执权限。

## contract 与 bridge 的逐码补齐

| source                     | code                      | 消费侧处理                                                                       |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| @migaia/rpc/contract       | INVALID_DESCRIPTOR        | 修 codec/framer/协议描述，重复坏配置无效。                                       |
| @migaia/rpc/contract       | INVALID_ENVELOPE          | 拒绝非法语义帧，修字段与发送端，不重放坏帧。                                     |
| @migaia/rpc/contract       | INVALID_STREAM            | 拒绝该流的非法序列、字段或值；不重放已交付 items。                               |
| @migaia/rpc/contract       | INVALID_FRAME             | 丢弃非法物理帧，修 framing/编码，不通过重试掩盖格式错误。                        |
| @migaia/rpc/contract       | FRAME_LIMIT_EXCEEDED      | 缩小业务；完整 group/native binary 不拆帧绕预算。普通 batch 仅沿原成员边界规则。 |
| @migaia/rpc/contract       | FRAME_ASSEMBLY_EXPIRED    | 关闭未完成重组，原业务执行状态须独立确认，不把重组超时当未执行。                 |
| @migaia/rpc/contract       | INVALID_WIRE_ERROR        | 拒绝坏错误帧，保留当前调用未知结果语义；不执行同一坏输入。                       |
| @migaia/rpc/contract       | HANDSHAKE_INVALID         | 关闭失败通道，修UTF8/JSON/协商字段，再建立新通道。                               |
| @migaia/rpc/contract       | HANDSHAKE_INCOMPATIBLE    | 升级双方必需v2 describe/batch基线；不回退v1或单帧。                              |
| @migaia/rpc/contract       | HANDSHAKE_REJECTED        | 查原拒绝cause并修授权/配置，不盲重试握手。                                       |
| @migaia/rpc/bridge/jsonrpc | JSONRPC_FRAME_INVALID     | 关闭错误byte连接，修header/编码/JSON/EOF；旧业务先对账。                         |
| @migaia/rpc/bridge/jsonrpc | JSONRPC_EXTENSION_MISSING | 对端需实现所需扩展；显式能力使用不降级。                                         |
| @migaia/rpc/bridge/jsonrpc | JSONRPC_PROFILE_INVALID   | 修profile或选项，重复相同调用无效。                                              |
| @migaia/rpc/bridge/jsonrpc | JSONRPC_UNSUPPORTED_MODE  | 改用受支持native通道，不把stream/group改成不同业务来重试。                       |
| @migaia/rpc/bridge/jsonrpc | JSONRPC_HANDSHAKE_TIMEOUT | 在原总预算内重新建立连接；不重放可能执行的业务。                                 |

## 显式 connect/listen 与透明转发

需要独立连接时，由应用创建实际 socket、MessagePort 或其它受支持载体。process connect 对象复用 address、token、dial、establish；listen 对象复用 address、listen、offer、verify、createConnectionContext。高级来源回调接收本端安全 self 与实际 capabilities，返回已经鉴权并完成协商的 channel。dial/accept 与拥有执行单元是两回事；borrowed connect/listen 不获得 kill、restart 或 replace 对端的权限。

listen 在接纳前提供 verifier，使用原 authenticated peer id 和 connection/session 身份；不能根据未经验证的 senderId 给 scope。每个 accepted session 独立路由，provider scope 由原 listener owner 共享。close 撤销本端准入并关闭自己的连接，外部服务仍由其 owner 管理。没有 direct/upgrade 工厂或自动 allocator。

Plugin 的 expose 可选择本地 Feature 或已接受连接的前缀：只有显式列出的实际方法进入远端目录。透明 relay 复用原 dispatch，最多三层转发；每跳固定实际 generation，原 key/outcome、截止时间、鉴权与所有权语义继续成立。需要平台锁或分布式协调时由消费侧处理。

## 底层 endpoint、协议与 bridge

已有 core client/provider/full/composed 子路径仍供显式底层组装使用。transport 只负责发送、订阅、关闭与真实来源；runtime-neutral foundation 不依赖 DOM、Node、Worker 或 Store。connect 是原来源验证边界；authentication 使用真实 sign/verify replay binding，encrypt-only 不成立。byte channel 先完成原 authenticated hello，再创建 endpoint；framing、deadline、replay、provider、生命周期各由原 owner 处理。

旧高级 IRemoteContract 仍可声明 schema、模式和幂等性；远端 PluginHost 控制使用显式 expose: ['host'] 及本地 resolver，真实 definePlugin 函数不跨 RPC。服务端 resolver 必须同步返回本地定义。目录 ready 不等于 Host 安装事务已提交，应用必须使用真正提交屏障。

JSON-RPC byte bridge 使用 Content-Length，完成原 migaia.hello 后支持同连接的 migaia.describe、migaia.invoke 与 migaia.cancel。入站 invoke 只进入实际已安装的 provider，describe 使用其原目录；无 id notify 不收到应答，batch 必须已协商。cancel 只选择同连接的既有调用，不新增 ACK、不回滚副作用，迟到 provider 结果按原规则丢弃。未知 profile、server stream、非法 params/meta、未协商 batch 或将 migaia.hello 当业务消息均拒绝；错误保留原 source/code/name/message/stack/cause 链。非法 frame/UTF-8/JSON 终止连接；未知/迟到 response id 按原规则报告丢弃。stream 和 transfer 的 bridge 限制沿稳定错误码 fail closed；不能把它们改成其它业务求成功。跨语言整数超过 ±(2^53−1) 时使用字符串。

## 构建与验证

拥有包配置的命令：pnpm --dir packages/rpc fmt、lint、build、typecheck、typecheck:test、test、test:e2e、test:conformance、test:packed。仓库集成由 make ci-fast / make ci 执行。重命令按仓库 Exclusive Measurement Window 规程串行；公开 API 的正确性、跨语言互通与性能是不同证据，示例执行成功不替代这些门禁。

### Child stderr diagnostic budget

The process connection emits at most 32 normal `ipc.stderr` records per 1000 ms interval for each session. Overflow adds at most one summary for that interval, with the same redacted text and a positive `droppedChunks` count. Closing the session flushes its remaining summary once. Normal traffic keeps its original record shape and timing. The binding continues draining the child's stderr pipe, and caller-provided supervision output callbacks still receive their original chunks. The fixed default uses the connection's existing scheduler and exposes no new option.
