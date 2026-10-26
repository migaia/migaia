# rpc-host 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

contract 只定义协议、接口、可移植值和错误契约。host 负责 RPC 的会话、握手、调用、provider、转发、取消与截止时间传递。传输 plugin 负责原生连接、代际和编解码；信息流 plugin 与依附于 plugin 的 feature 各自实现可选能力。

一个 host 支持多个传输命名空间，但通常选择一种传输，不建议混用。所有调用写成 `host.<ns>.*`；`provide` 与整个 host 的 `close` 留在根上。完整可运行的双向协程示例见 [README](./README.md#开始使用)。

`createRpcHost` 先在同一个原生宿主上提交信息流 plugin、链路策略 plugin 及其 feature，再安装传输 plugin 及其 feature。这样 auth 等 stage 在首次握手前已经可见。两次安装共用生命周期 owner；传输安装失败时，已提交的前缀也由该 owner 回滚和清理。

## 注册普通方法与生成器

`provide` 接受嵌套函数对象。返回值成为业务结果，异常保留原错误链；重复方法名拒绝。运行中新增的方法通过原会话目录更新发布。

注册配置的反射或编译过程抛出异常时，公开入口以 `INVALID_CONFIG` 拒绝，并在 `cause` 上保留这个原异常。错误说明使用稳定文本，不调用异常的字符串转换，也不人为增加一项转换失败。

```ts doc-test=check
import type { IRpcHost, IRpcContext } from '@migaia/rpc-host'

export function exposeWork(host: IRpcHost) {
  host.provide({
    double: (value: number) => value * 2,
    values: async function* (end: number) {
      for (let value = 0; value < end; value++) yield value
    },
    wait: (_value: unknown, context: IRpcContext) => {
      if (context.signal.aborted) throw context.signal.reason
      return new Promise<void>((_resolve, reject) =>
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true
        })
      )
    }
  })
}
```

调用方通过 `options.signal` 取消，处理方读取自己的 `context.signal`。示例 `wait` 等待取消；实际任务应在自己的 finally 中释放资源。取消不回滚已执行副作用，也不自动终止进程。单向调用发送完成后，其 signal 仍可向下游传递取消。

## 选择目标并消费流

声明可描述一个能力，或按直连名称映射多个能力。命名空间决定使用哪个传输，名称和实例 id 决定该传输内的目标。

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkers = {
  worker: {
    double(value: number): number
    values(end: number): AsyncIterable<number>
  }
}

export async function useWorker(host: IRpcHost<IWorkers>) {
  const answer: number = await host.thread.send('worker', 'double', 21)
  const values: number[] = []
  for await (const value of host.thread.streamTo('worker', 'values', 3)) values.push(value)
  return { answer, values }
}
```

无目标 `request/notify/group` 在该命名空间内广播：零目标得到空 `fulfilled/rejected`，单目标返回标量，多目标各自保留成功或失败。多目标 `stream` 返回按实例身份索引的迭代器集合，每个迭代器独立背压和取消。

`streamTo(targetId, method, payload?, options?)` 定向选择一个直连目标，始终返回一个惰性迭代器；目标与 `send` 一样放在第一个参数。将原 `stream(method, payload, { targetId })` 改为此写法，options 只保留调用策略、signal、transfer 等原有选项。

stream 在第一次 `next()` 才启动。调用 `return()` 结束消费并等待对应清理；`throw(reason)` 保留调用方抛出的原因。连接失效后，已持有能力仍绑定原连接，不能转向同名新实例。

## 安装完整策略

下例只创建冷定义；把 `policy` 与 `transport` 交给 `createRpcHost({ plugins: [...] })`，并在 worker 入口安装对应子端来源。

```ts doc-test=check
import { timeout, retry } from '@migaia/rpc-host/features'
import { linkPolicy } from '@migaia/rpc-host/plugins'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

export const policy = linkPolicy({ features: [timeout({ ms: 3000 }), retry({ attempts: 2 })] })
export const transport = threadPlugin({
  spawn: new URL('./worker.ts', import.meta.url),
  features: [timeout({ ms: 1500 })]
})

export const callOptions = { timeout: timeout({ ms: 100 }), retry: false } as const
```

解析顺序唯一：单次调用完整实例或 `false`，然后传输 plugin 的 feature，最后链路策略 plugin。把 `callOptions` 传给 `host.thread.request(method, payload, callOptions)` 即可覆盖本次调用。不能写 `{ timeout: 100 }`、`timeoutMs` 或 `defaultTimeoutMs`。

`timeout: false` 不启用 feature 超时，持续等待响应；已经继承的上游剩余期限仍递减。`retry: false` 禁用重试。下游只得到剩余预算，转发不能延期。只有发起方的标量调用和 group 重试，stream 从不重放、只使用 timeout；超时或失联不证明业务未执行，非幂等操作须先对账。传输提供的握手准备期限是另一项配置，不是业务 timeout feature。

进入 provider 前剩余截止时间已经耗尽的调用，以 `DEADLINE_EXCEEDED` 拒绝，不执行 provider；`before-start` 的取消语义保持不变。

## 在已有宿主中安装 RPC

已有 `defineHost` 宿主使用 `rpcHostPipelines(getHost, pipeline, namespaces)`，同时获得管道声明和 `domainCore`。`namespaces` 列出这个宿主将安装的全部传输命名空间（示例为 `thread`）；安装未列出的命名空间时，传输启动会失败。helper 构造时不调用回调、不创建宿主或资源；安装时，`domainCore` 才读取真实宿主并借用其管道执行权。不要复制七条声明，也不要把另一个宿主的执行权交进来。

```ts doc-test=check
import { defineHost } from '@migaia/plugin-host'
import {
  rpcHostPipelines,
  type IRpcFlowPlugin,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'

/** Capture lazy authority callbacks before the real host is assigned. */
const rpc = rpcHostPipelines(
  () => host,
  (name) => host.pipeline(name),
  ['thread']
)
/** One native owner supplies both stage registration and execution. */
export const host = defineHost({
  ...rpc,
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})

/** Commit reusable flow definitions before opening any transport resource. */
export async function installRpc(
  flows: readonly IRpcFlowPlugin[],
  transports: readonly IRpcTransportPlugin[]
) {
  await host.use(...flows)
  await host.use(...transports)
}
```

class 宿主同样通过 helper 延迟读取 `this`。构造时把声明交给 `super`，之后由 `createPluginDomainCore` 提供同一份接法；无需公开原本受保护的 `pipeline`。构造完成后再按上面的顺序安装 plugin。

```ts doc-test=check
import { PluginHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'

/** Keep the helper's declaration and domain-core axes together. */
type IRpcSetup = ReturnType<typeof rpcHostPipelines>
/** Native installation receives only this owner's declared RPC core. */
type IRpcCore = ReturnType<IRpcSetup['domainCore']>

export class NativeRpcHost extends PluginHost<
  IRpcCore,
  unknown,
  readonly [],
  IRpcSetup['pipelines']
> {
  /** The setup lends this exact owner's protected pipeline without another executor. */
  readonly #rpc: IRpcSetup

  /** Register lazy callbacks before super without reading an unconstructed this. */
  constructor() {
    /** The same setup supplies declarations now and authority only after construction. */
    const rpc = rpcHostPipelines(
      () => this,
      (name) => this.pipeline(name),
      ['thread']
    )
    super({
      pipelines: rpc.pipelines,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    this.#rpc = rpc
  }

  /** Each install borrows this exact constructed owner's pipeline execution authority. */
  protected override createPluginDomainCore(): IRpcCore {
    return this.#rpc.domainCore()
  }
}
```

## 编写信息流与载体

`defineFlowFeature` 的每次 `setup` 返回本次安装的 `stages`，该 feature 放进宿主的 `plugins` 或某个传输的 `features`；setup 同时返回独立的 `observe` 与可选 `dispose`。stage 使用 SDK 的 `RpcFlowPoint` 和推导出的 payload 类型，转发时调用原生 `next(payload)`。握手、信封和 frame 的替换值分别放在 `handshake`、`prepared` 和 `frame`；dispatch 转发后从同一个 `payload.outcome.value` 读取结果，短路时也写入这个 cell。

frame 管道允许多次提交。每次 `await next(payload)` 的失败交给当前 stage：捕获并 report 后可以继续下一个成员；stage 不观察失败的 Promise 时，管道在所有已启动遍历结算后拒绝，多个未观察失败按提交顺序汇总。观察回调不负责执行或推进这些 stage。

`batch` 中取消的成员不再向下游提交，原调用以 `CANCELLED` 结算，原 reason 保留在 `cause`；同批其他成员继续完成。入站某个成员失败只 report 该成员，不阻止后续成员。

内置位置固定：出站 plaintext → schema → idempotency → limits → auth → chunk → batch → wire；入站反向。数组书写顺序不改变这些位置。第三方 stage 默认在 plaintext，高阶 SDK 作者可显式指定受支持的 `layer`。

`auth` 对完整消息执行保护，再由 `chunk` 拆成物理帧；接收端先重组，再还原保护。probe 的 `protected` 事件对应整条消息，`frame` 事件保留实际 `chunkIndex`、`chunkCount` 和 `members`。物理 batch 的成员数在 batch frame 上观察；`envelope` 事件仍对每条逻辑消息观察一次。

载体可选实现 `reserveWrite(options)`，借用原有流控 owner，返回带 `release()` 的容量凭据。Session 在编码之后为一次逻辑写出预留一次，等这次 frame 管道实际结算后释放；chunk 的所有分片借用同一凭据，batch 各成员保留各自凭据，合并的物理写出借用仍存活成员的凭据。载体的 `write` 仍在实际物理接纳后完成，不应再把分片或 batch 重复计为新的逻辑调用。凭据不进入线上数据。

同一组 `auth`、`chunk`、`batch`、`idempotency`、`limits`、`schema` 工厂支持 host 的 `plugins` 与传输的 `features`；传输配置只覆盖本命名空间。host 级 `limits` 共用额度，传输级各自独立。`probe`、`typegen`、Devtools 只装在 host 级。删除原 `namespaces` 作用范围选项，改为把 feature 放在对应传输上。

## 通知、分组与结果查询

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IApi = { update(value: number): number }
export async function sendUpdates(host: IRpcHost<IApi>) {
  await host.thread.notify('update', 1, { targetId: 'worker' })
  return host.thread.group([
    { method: 'update', payload: 2 },
    { method: 'update', payload: 3 }
  ])
}
```

`notify` 的 Promise 只表示物理发送，不表示业务确认。`dispatch(target, method, payload, options)` 同步返回 `void`，失败交给原 reporter。每个目标按顺序执行自己的 group，没有跨目标事务。

安装 `idempotency()` 信息流 plugin 后，才有 `host.<ns>.outcome(key)` 查询保留的结果。省略 plugin 时不会启用按幂等键保存和查询结果的存储。`auth()` 独立拥有请求 ID 去重：实际业务及流清理完成前保留活动身份，完成后的身份仅在真实原生来源独占时立即释放，其他来源按有界 TTL 保留；重复身份不再次执行或发送终态。`auth.maxReplayEntriesPerPeer` 默认 `1024`，必须为正安全整数；容量不足以 `OVERLOADED` 拒绝，`auth.onRejected` 接收冻结的 `replayLedgerFull` 或 `groupReplayFull` 通知。该回调失败按原 `INTERNAL` 错误及原因上报。推荐安装 `limits()`；不安装就不启用相应并发、速率或 payload 配额。

## 转发与持有能力

`host.process.send('b', 'c.render', value)` 先到 b；b 查询当前目录，再通过自己持有的 c 会话转发，可跨载体。也可显式发布已持有能力：

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type INext = { c: { render(value: string): string } }
export function publishHeldRender(host: IRpcHost<INext>) {
  host.provide({ render: host.thread.peers.c.render })
}
```

持有的函数不自动跟随替换。目标断开时拒绝；未知方法、环路与超出跳数在原准入边界拒绝。转发不创建第二个调用端点或 per-session Peer 外观。

在每个转发 host 上设置 `createRpcHost({ forward: { maxHops: 3 }, plugins: [...] })`。省略时为 3，只接受 1–16 的整数。各 host 将当前转发跳序与自身上限比较；环路拒绝先于 `FORWARD_HOP_LIMIT`。

probe 的 `forward` 阶段发出 `received`、实际交给载体时的 `sent`，或带 `loop`、`hop-limit`、`target-unknown`、`method-unavailable` 原因的 `rejected`。首个转发 host 的 `hop` 为 1，`maxHops` 为自身上限。`route` 仅借用到回调返回，保留事件前须复制；最终目标的 message 入站事件带经过的 `hop` 与 `route`。不装 probe 或 Devtools 时，Forwarder 跳过事件构造。

## 观察与类型生成

观察通过同一 host 的 `probe` 信息流 plugin 安装；类型生成消费已接受目录。事件视图只在 `emit` 期间有效，延后读取前须复制需要的字段。

```ts doc-test=check
import { probe, typegen } from '@migaia/rpc-host/plugins'

export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const declarations = typegen({
  out: { write: (fileName, text) => console.log(fileName, text) }
})
```

把这两个定义与传输一起放入 `plugins`。`typegen.out.write` 是应用拥有的输出能力，文件 I/O 由应用决定；失败通过 reporter 传播。关闭 host 或卸载相应 plugin 后释放订阅。

## 迁移入口

| 旧用法                                                | 新用法                                      |
| ----------------------------------------------------- | ------------------------------------------- |
| 根级 `host.request/send/notify/stream/dispatch/group` | `host.<ns>` 下的同名调用                    |
| `@migaia/rpc-host/plugin`                             | `@migaia/rpc-host/sdk`                      |
| `/probe` + `defineFeaturePlugin`                      | `/plugins/probe` 的 `probe` / `defineProbe` |
| `authFeature/chunkFeature/typegenFeature`             | `/plugins` 的 `auth/chunk/typegen`          |
| 根 `defaultTimeoutMs` / 单次数字 timeout              | plugin 的 `features` 与完整 timeout 实例    |
| `poolPlugin`、pool assembler                          | 传输 `features: [pool({ size })]`           |
| endpoint、RuntimePeer、v1、JSON-RPC profile           | 单一 Host 调用 owner 与新协议，无兼容入口   |
| 根级 `outcome` / 幂等 store                           | 安装 `/plugins/idempotency`，在命名空间查询 |

`remote.host.use`、`remote.host.unUse` 和 `remote.host.inspect` 已移除，不再提供通过 RPC 管理远端宿主插件的协议；本地原生宿主的安装与释放 API 保持各自契约。

汇总入口和各单项默认子路径均可 tree-shake。错误码从 `@migaia/rpc-contract/error-code` 引入；错误类和契约从 `/errors` 引入。传输作者只提交原生载体与编解码能力，host 负责握手、Session、待决表与 provider 执行。

## 关闭与错误

`host.close()` 与 `host[Symbol.asyncDispose]()` 共享原关闭 Promise；`host.<ns>.close()` 只关闭对应命名空间。拥有的原生资源由其原 owner 释放，借用资源仍按原生所有权处理。

公开关闭会以 `ENDPOINT_DISPOSED` 结算待决调用，并关闭真实载体。载体的 `close` 要结算自己拥有的排队写入，因此被挂住的原生写入也会拒绝；它不等于强行完成任意业务 Promise。已有 `defineHost` 或 class 宿主的 `dispose()` 仍返回其原生 cleanup summary 与共享 Promise，不套另一层 RPC 清理外壳。

按 `source/code` 识别错误，保留原生类型、stack、cause 与 errors。不要把超时、取消或未知结果当成业务未执行证明。原生成员控制位于传输贡献的 `host.<ns>.members`，池控制位于其 feature 贡献的 `host.<ns>.pool`；这些控制不替代调用入口。

`send`、`request` 等返回 Promise 的调用通过拒绝传播非法 `idempotencyKey`、transfer 准入被拒绝或命名空间已关闭的错误，保留各入口原有的 `source/code` 和 `cause`；非法 key 仍为 `CONTRACT_INVALID`。使用 `await` 或 `Promise.catch` 处理失败。`dispatch` 仍同步返回 `void` 并向 reporter 交付失败，`stream` 与 `streamTo` 仍返回延迟启动的异步迭代器。

## 公开行为与迁移

未分类的 provider 异常使用 `INTERNAL`，原生异常保留在错误图中。标量调用直接以还原的远端 Error 拒绝；不再增加 `RpcRemoteError` 外壳，调用方须改用真实错误的 `source/code`。协程远端 `context.signal.reason` 接收原 abort reason，不合成取消码；`stream.return(value)` 返回 runtime 的真实结束结果，不回传调用者传入的 `value`。

无目标调用按调用时已接受的会话选择；从 `peers` 保存的函数绑定原代次，退场后拒绝且不转向替代连接。即时 process 启动失败只保留一层 `PROCESS_CHANNEL_CLOSED`，原生 EPIPE 在 cause 图中；没有真实原生错误的 thread 关闭诊断不合成 message-port cause。

自行构造的原生宿主保留 `dispose()` 的原生 cleanup summary 与共享 Promise，不再附加 RPC 清理外壳。原失败叶对象、errors 顺序、cause 可达性和 disposer 一次执行保持；`createRpcHost` 返回的 `host.close()` 则保持自己的公开关闭语义。

幂等指纹使用对象自身的键序；同一 body 改变键序后是不同请求，同键冲突以 `CONTRACT_INVALID` 拒绝，原 store 的字符串指纹 ABI 保持不变。

原生 Feature 的 descriptors 每次冷编译只捕获一次，首次 selector 的校验及错误顺序保持；后续 selector 不再重复触发 Proxy reflection。

auth() 的已完成请求 ID 仅在实际原生 owner 证明来源独占时立即释放；其他来源继续按有界 TTL 保留。活动请求与 stream 仍保留到实际业务及迭代器清理完成。

配置 sign/verify 时，auth 在既有签名握手中交换并验证每个来源的新挑战；应用回调仍须签名和验证收到的完整输入。此过程不增加公开 discovery 或握手配置。

verifyCredentials 可返回 { principalId: 非空字符串 }，把真实认证主体交给当前 Session；抛出或拒绝仍拒绝认证。void、字符串及其他原先被忽略的结果不会授予主体身份。

原六个 `/features/{auth,batch,chunk,idempotency,limits,schema}` 入口已删除，改从 `/plugins/*` 或 `/plugins` 导入。`rpcHostPipelines(getHost, pipeline, namespaces)` 的第三参数须在原生宿主构造前声明全部未来传输命名空间。以下无抛出点错误码已删除，不提供替代码：`HOST_ASSEMBLER_DUPLICATE`, `HOST_FEATURE_DUPLICATE`, `PROVIDER_GENERATION_RETIRED`, `MIDDLEWARE_DUPLICATED`, `MIDDLEWARE_MISSING`, `PROVIDER_NOT_SETTLED`, `TARGET_NOT_IDENTIFIABLE`。

被父端拉起并收到原生启动事实的子节点（process、thread、coroutine、dedicated worker 或 pool 成员），Host 名字按父端指定名、子节点 `self.name`、现有默认名依次选择；`instanceId` 也以父端为准。父端省略名字时，按子节点握手报回的名字寻址。显式子节点名字与父端不同时，构造成功，子节点只发出一次 `SELF_IGNORED` 警告。通过 `createRpcHost({ onWarning })` 接收，事件含 `code`、`message`、`parentName`、`ignoredName`，公开常量为 `RpcWarningCode.selfIgnored`；未配置回调时交给 `console.warn`。警告不进 `report`，不带错误码。两份互相冲突的父端启动事实仍以 `INVALID_CONFIG` 拒绝。
