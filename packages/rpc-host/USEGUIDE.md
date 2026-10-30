# rpc-host 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

## 安装

同时安装 `@migaia/rpc-host`、`@migaia/rpc-contract` 和所需传输插件，三者使用相同版本。contract 是精确 lockstep 的 peer 依赖，由应用提供同一份安装；开发者显式引入的重复副本不在支持范围内。

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

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

调用方通过 `options.signal` 取消，处理方读取自己的 `context.signal`。示例 `wait` 等待取消；实际任务应在自己的 finally 中释放资源。取消不回滚已执行副作用，也不自动终止进程。需要可取消、可知道何时完成的远程动作，请使用 `request`。

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
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'
import { linkPolicy } from '@migaia/rpc-host/plugins'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

export const policy = linkPolicy({
  features: { timeout: timeoutFeature({ ms: 3000 }), retry: retryFeature({ attempts: 2 }) }
})
export const transport = threadPlugin({
  spawn: new URL('./worker.ts', import.meta.url),
  features: { timeout: timeoutFeature({ ms: 1500 }) }
})

export const callOptions = { timeout: { ms: 100 }, retry: false } as const
```

解析顺序唯一：单次调用策略配置对象或 `false`，然后传输 plugin 的 feature，最后链路策略 plugin。把 `callOptions` 传给 `host.thread.request(method, payload, callOptions)` 即可覆盖本次调用。不能写 `{ timeout: 100 }`、`timeoutMs` 或 `defaultTimeoutMs`。

`timeout: false` 不启用 feature 超时，持续等待响应；已经继承的上游剩余期限仍递减。`retry: false` 禁用重试。下游只得到剩余预算，转发不能延期。只有发起方的标量调用和 group 重试，stream 从不重放、只使用 timeout；超时或失联不证明业务未执行，非幂等操作须先对账。传输提供的握手准备期限是另一项配置，不是业务 timeout feature。

进入 provider 前剩余截止时间已经耗尽的调用，以 `DEADLINE_EXCEEDED` 拒绝，不执行 provider；`before-start` 的取消语义保持不变。

## 后装与卸载传输

`createRpcHost({ plugins })` 构造时安装的整批定义一起成功或一起回滚。构造完成后，`host.use(...)` 每次开启一个独立的原生安装事务；失败只回滚本批新资源，已提交的命名空间继续工作。返回值还是同一个公开 host；用新变量接住它，才能在类型上取得新命名空间。

```ts doc-test=check
import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import { limitsFeature } from '@migaia/rpc-host/plugins'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

const host = await createRpcHost({
  plugins: [rpcFeaturesPlugin({ features: { limits: limitsFeature({ maxGlobal: 256 }) } })]
})
try {
  const extended = await host.use(threadPlugin({ spawn: new URL('./worker.ts', import.meta.url) }))
  await extended.thread.notify('refresh')
  await extended.thread.close()
  await extended.unUse('thread')
} finally {
  await host.close()
}
```

传输插件的名字就是命名空间；重复名字或保留名在安装前被拒绝。改变消息流的宿主级 Feature（如 auth、limits）只能放在构造时的 `createRpcHost({ plugins })` 中，只准备一次；后装会以 `INVALID_CONFIG` 拒绝。后装传输沿用同一份安装与共享额度，传输自己的 `features` 随传输一起安装，同种能力只覆盖本命名空间。只读观察插件，包括警告订阅，可以后装。`use` 返回的仍是同一个冻结的原生宿主；新增命名空间只体现在 `const extended = await host.use(...)` 的返回类型中。

`unUse(name)` 沿用原生卸载结果 `{ ok, affected, errors? }`。没有活动信息流约束时，卸载先按正常关闭流程关闭该传输的会话，再删除其管道组。会话仍在使用所选宿主级 Feature，或传输自己持有的局部 Feature 时，移除相应注册会以 `plugin.host / LIFECYCLE_MUTATION` 拒绝；共享 Feature 的卸载单位是原生共享封装，局部 Feature 的卸载单位是所属传输。先关闭受影响命名空间的会话，再冷删除；示例因此先调用 `thread.close()`。没有选中信息流 Feature 的传输、只读观察插件不受这项限制。宿主关闭或重新构造后也可去掉能力，框架不再保证原来的能力。

auth、chunk、batch 等通过握手协商并改变线上格式的能力，只有两端都装时才保证能建立通信。只装一端时不提供兼容，也不会主动禁止这种配置；应用需要自行提供匹配的 plugin 或 feature。

## 在已有宿主中安装 RPC

已有 `defineHost` 宿主使用 `rpcHostPipelines(getHost, pipeline)` 取得 `domainCore`。helper 构造时不调用回调、不创建宿主或资源；安装时才读取真实宿主，并把本次原生构造请求交还给这个宿主的 `pipeline(name, request)`。传输插件自己声明七条短名管道，安装时创建、卸载时删除，不需要预先列出命名空间，也不再有 `rpc.pipelines`。不要复制声明，或借用另一个宿主的执行权。

```ts doc-test=check
import { defineHost } from '@migaia/plugin-host'
import {
  rpcHostPipelines,
  rpcFeaturesPlugin,
  type IRpcFlowFeature,
  type IRpcFlowPlugin,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'

/** Capture lazy authority callbacks before the real host is assigned. */
const rpc = rpcHostPipelines(
  () => host,
  (name, request) => host.pipeline(name, request)
)
/** One native owner supplies both stage registration and execution. */
export const host = defineHost({
  domainCore: rpc.domainCore,
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})

/** Commit reusable flow definitions before opening any transport resource. */
export async function installRpc(
  features: Readonly<Record<string, IRpcFlowFeature<object>>>,
  observers: readonly IRpcFlowPlugin[],
  transports: readonly IRpcTransportPlugin[]
) {
  await host.use(...observers, rpcFeaturesPlugin({ features }))
  await host.use(...transports)
}
```

`rpcFeaturesPlugin({ features })` 是普通原生宿主安装共享信息流 Feature 的封装，实际 setup 与清理由原生注册持有；不能把 `authFeature()` 等 Feature 直接当原生 plugin 交给 `host.use`。先提交这个封装和只读观察插件，再装传输，确保首次握手已经有完整策略。

class 宿主同样通过 helper 延迟读取 `this`。`createPluginDomainCore` 必须转交本次构造请求；无需公开原本受保护的 `pipeline`。构造完成后按上面的顺序安装 plugin。

```ts doc-test=check
import { PluginHost, type IHostCoreConstructionRequest } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'

/** Retain the helper's domain-core construction port. */
type IRpcSetup = ReturnType<typeof rpcHostPipelines>
/** Native installation receives only this owner's declared RPC core. */
type IRpcCore = ReturnType<IRpcSetup['domainCore']>

export class NativeRpcHost extends PluginHost<IRpcCore, unknown, readonly []> {
  /** The setup lends this exact owner's protected pipeline without another executor. */
  readonly #rpc: IRpcSetup

  /** Register lazy callbacks before super without reading an unconstructed this. */
  constructor() {
    /** The callbacks are invoked only after construction by the actual native installation. */
    const rpc = rpcHostPipelines(
      () => this,
      (name, request) => this.pipeline(name, request)
    )
    super({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    this.#rpc = rpc
  }

  /** Each install borrows this exact constructed owner's pipeline execution authority. */
  protected override createPluginDomainCore(request: IHostCoreConstructionRequest): IRpcCore {
    return this.#rpc.domainCore(request)
  }
}
```

## 编写信息流与载体

`defineFlowFeature` 的每次 `setup` 返回本次安装的 `stages`，该 feature 放进 `rpcFeaturesPlugin` 的 `features` record 或某个传输的 `features` record；setup 同时返回独立的 `observe` 与可选 `dispose`。stage 使用 SDK 的 `RpcFlowPoint` 和推导出的 payload 类型，转发时调用原生 `next(payload)`。握手、信封和 frame 的替换值分别放在 `handshake`、`prepared` 和 `frame`；dispatch 转发后从同一个 `payload.outcome.value` 读取结果，短路时也写入这个 cell。

frame 管道允许多次提交。每次 `await next(payload)` 的失败交给当前 stage：捕获并 report 后可以继续下一个成员；stage 不观察失败的 Promise 时，管道在所有已启动遍历结算后拒绝，多个未观察失败按提交顺序汇总。观察回调不负责执行或推进这些 stage。

`batchFeature` 中取消的成员不再向下游提交，原调用以 `CANCELLED` 结算，原 reason 保留在 `cause`；同批其他成员继续完成。入站某个成员失败只 report 该成员，不阻止后续成员。

内置位置固定：出站 plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire；入站反向。record 的键名与插入顺序不决定执行顺序。第三方 feature 必须声明整数 `phase`（0–65535）；同一 stage point 与 layer 不允许 phase 冲突。`dependencies` 决定原生安装顺序，`phase` 决定执行顺序。第三方 stage 默认在 plaintext，高阶 SDK 作者可显式指定受支持的 `layer`。

`authFeature` 对完整消息执行保护，再由 `chunkFeature` 拆成物理帧；接收端先重组，再还原保护。probe 的 `protected` 事件对应整条消息，`frame` 事件保留实际 `chunkIndex`、`chunkCount` 和 `members`。物理 batch 的成员数在 batch frame 上观察；`envelope` 事件仍对每条逻辑消息观察一次。

`chunkFeature({ maxConcurrentMessagesPerSource, maxBufferedBytesPerSource })` 为每个物理来源设置子配额。默认分别为 64 条未完成消息和 16 MiB，低于默认全局 256 条和 64 MiB；默认来源并发取 `min(64, max(1, floor(maxConcurrentMessages / 4)))`，默认来源字节取 `max(maxMessageBytes, min(16777216, floor(maxBufferedBytes / 4)))`，保证一条允许的完整消息能获得预留。显式 `maxBufferedBytesPerSource` 小于 `maxMessageBytes` 时，构造会按既有配置错误拒绝。首片按完整声明长度预留来源字节额度，完成、过期或来源关闭时归还。超出来源配额只拒绝该来源的新分片消息，已接纳消息继续使用其预留额度；其他来源仍受各自子配额和原全局实际保留字节预算约束。字符串额度单位为 UTF-16 code unit，二进制为字节。

本地 codec capture 在原遍历中按节点累计常数时间 JSON 字节下界，不对字符串、键、二进制标签或元数据调用 `JSON.stringify`。下界超过当前 `maxFrameBytes` 时立即以 `FRAME_LIMIT_EXCEEDED` 拒绝，避免共享引用的指数展开；下界未超限时，唯一的实际编码出口仍按真实 UTF-8 长度检查同一上限。下界不会大于真实 JSON 字节数；正常共享引用仍按 JSON 逐次展开，线上表示保持不变。

载体可选实现 `reserveWrite(options)`，借用原有流控 owner，返回带 `release()` 的容量凭据。Session 在编码之后为一次逻辑写出预留一次，等这次 frame 管道实际结算后释放；chunk 的所有分片借用同一凭据，batch 各成员保留各自凭据，合并的物理写出借用仍存活成员的凭据。载体的 `write` 仍在实际物理接纳后完成，不应再把分片或 batch 重复计为新的逻辑调用。凭据不进入线上数据。

同一组 `authFeature`、`chunkFeature`、`batchFeature`、`idempotencyFeature`、`limitsFeature`、`errorMapFeature`、`schemaFeature` 工厂支持 host 的 `plugins` 与传输的 `features`；传输配置只覆盖本命名空间。host 级 `limitsFeature` 共用额度，传输级各自独立。`probe`、`typegen`、Devtools 只装在 host 级。删除原 `namespaces` 作用范围选项，改为把 feature 放在对应传输上。

## 认证、签名与重复请求

默认 `encodedType: 'any'` 且未配置 `encrypt` 时，`sign` 收到带 nonce、counter 和对象 payload 的签名绑定对象，`verify` 收到对端还原出的同一结构。回调必须签名、验证完整输入；框架不先将它转换成文本。HMAC 等按字节处理的算法由应用决定规范化方式，两端必须一致。

```ts doc-test=check
import { createHmac } from 'node:crypto'
import { authFeature } from '@migaia/rpc-host/plugins'

/** Both peers use the same application-owned key and binding representation. */
function mac(value: unknown, key: string): string {
  return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
}

/** The application supplies its key; callbacks cover the entire replay binding. */
export function signedAuthentication(key: string) {
  return authFeature({
    sign: (value) => ({ value, mac: mac(value, key) }),
    verify: (envelope) => {
      const signed = envelope as { value: unknown; mac: string }
      if (signed.mac !== mac(signed.value, key)) throw new Error('signature mismatch')
      return signed.value
    }
  })
}
```

显式选择 `'string'`、`'uint8array'`，或配置 `encrypt` 时，绑定改用带前缀的文本或相应 UTF-8 字节。整个绑定只编码一次，里面的 payload 仍是对象，入站只解析这层文本。加密仍先于签名，入站先验证再解密；支持的原生对象路径保持不变。原先假定默认输入总是文本的回调，应自行 `JSON.stringify` 或改用 `encodedType: 'string'`。nonce、签名计数器窗口及其重放检查没有改变。

auth 始终挡住还在执行的同一请求 ID，直到实际业务及 stream 清理完成。完成后如何释放由 `retain` 决定：

| `retain`         | 完成后的释放时机               | 使用边界                                                            |
| ---------------- | ------------------------------ | ------------------------------------------------------------------- |
| `false`（默认）  | 立即释放                       | 只保留在途身份，不按已完成请求数累积                                |
| `'window'`       | 原签名计数器被 64 位窗口越过时 | 必须配置签名，否则为 `INVALID_CONFIG`；窗口前进不释放仍在执行的请求 |
| 正安全整数毫秒数 | 完成后保留指定时长             | 非法数字以 `INVALID_CONFIG` 拒绝；数值模式受容量限制                |

可以在 `authFeature({ retain })` 设置默认值，也可以在传输连接选项 `connect: { retain }` 中覆盖；只有未指定连接值时才回退，所以连接级 `false` 也会覆盖宿主设置。需要旧的 310 秒行为时显式配置 `retain: 310_000`。

`maxReplayEntriesPerPeer` 默认 `1024`，只限制数字模式中的活动与保留身份，必须是正安全整数；满额以 `OVERLOADED` 拒绝。`false` 和 `'window'` 不受这个数值容量限制。`onRejected` 接收冻结的 `replayLedgerFull` 或 `groupReplayFull` 通知，回调失败仍按原错误及原因报告。重复请求静默丢弃，不再次执行，也不补发终态；需要把已完成结果回放给重发方时，安装 `idempotencyFeature()`。

## 映射发往对端的错误

verifier 或凭据解析器抛出、拒绝时，auth 在本地错误的 `cause` 上保留原始错误。用 `errorMapFeature(map)` 决定对端能看到哪些错误信息，例如把含凭据的细节换成公开提示。本地抛出的错误、`report`、警告和只读观察插件看到的仍是原始错误，与插件安装先后无关。它可放在宿主 `plugins` 或传输 `features`，传输级覆盖宿主级。

```ts doc-test=check
import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import { errorMapFeature, type IRpcErrorMap } from '@migaia/rpc-host/plugins'

/** Decide what remote callers may learn while preserving local diagnostic causes. */
const redact: IRpcErrorMap = (error) =>
  new Error(
    error instanceof Error && /credential/i.test(error.message)
      ? 'request rejected'
      : 'request failed'
  )

export const host = await createRpcHost({
  plugins: [rpcFeaturesPlugin({ features: { errorMap: errorMapFeature(redact) } })]
})
```

`map(error, context)` 必须同步返回 `Error`、可移植值或 `undefined`。返回值就是发给对端的错误内容，不自动附加原错的原因链。回调抛错或返回值无法序列化时，报告映射失败，并按未映射时的规则发送原错误。返回 Promise/thenable 时报告 `INVALID_CONFIG`，立即按原规则发送，不等待它，因此同一会话的后续消息不会被它卡住；迟到的 Promise 拒绝仍会单独报告。

没有 `errorMapFeature` 时，未认证对端收到的握手拒绝默认隐藏细节；其他错误保留完整的原因链。跨进程或线程会还原成新对象，不保证与发送方原错 `===`。需要隐藏对端可见信息时配置映射，本地日志和原因链仍可用于排查。

连接或 Auth 安装在验签中途关闭时，这次入站处理按取消结束，不再报告为认证失败；原始取消原因仍保留，真正的验签失败照常报告。直接执行 Auth SDK 阶段的调用者，在安装关闭后会得到现有的 `UtilsAbortError` 及原始 `cause`，而不是 `AUTHENTICATION_FAILED`。

## 二进制完整性与 transfer

载体支持原生二进制时，显式列在 `transfer` 中的 ArrayBuffer 始终原生转移，实际移交后原 buffer 被 detach；配置签名时也会计算并校验 SHA-256。没有显式转移的 buffer 在签名路径上才按大小处理：不超过 1125 字节时复制到签名内容中，原 buffer 保留可用，也不计算摘要；较大的 buffer 用原生二进制传送并校验摘要。未配置签名时不计算二进制摘要。1125 字节是 SDK 内部阈值，不是公开配置项。

大小和摘要针对整个 ArrayBuffer，Uint8Array 的可见切片再小，也不会缩小其底层 buffer。共享同一 buffer 的视图在接收端仍共享同一 buffer，并保留各自的偏移和长度。

`transfer` 表示移交所有权，只能使用调用方显式授权的 buffer，并且载体必须支持这种移交；不支持时仍按原能力规则拒绝。普通调用者不必处理二进制清单，载体作者所需的线上格式见 [contract 协议说明](../rpc-contract/USEGUIDE.md#载体二进制与收发顺序)。

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

`notify` 的 Promise 只表示物理发送，不表示业务确认。普通 `notify`（没有 `cancel: 'before-start'`、没有 `orderKey`，且非转发）发送完成后解除调用方 signal 监听；之后 abort 不再发送远端取消。`dispatch(target, method, payload, options)` 同步返回 `void`，失败交给原 reporter。每个目标按顺序执行自己的 group，没有跨目标事务。

安装 `idempotencyFeature()` 信息流 Feature 后，才有 `host.<ns>.outcome(key)` 查询保留的结果。省略时不启用按幂等键保存和查询结果的存储。auth 的请求 ID 去重与它独立，三种保留方式见[认证说明](#认证签名与重复请求)。推荐安装 `limitsFeature()`；不安装就不启用相应并发、速率或 payload 配额。

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

## 警告与子节点名称

警告是冻结的 `{ code, message, data }` 记录，不是错误，不会进 `report`，也不阻止构造或调用。每条记录先交给 `createRpcHost({ onWarning })`，再按注册顺序交给宿主级 SDK 插件 setup 返回的 `onWarning`；所有接收者拿到同一个记录。没有接收者时只调用一次 `console.warn`。接收者抛错或异步拒绝时，报告原错误，其他接收者继续收到警告。

```ts doc-test=check
import { createRpcHost, type IRpcWarning } from '@migaia/rpc-host'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'

/** Subscribe through the native host registration lifetime. */
const warnings = defineFlowPlugin({
  name: 'application-warnings',
  setup: () => ({
    onWarning: (warning: IRpcWarning) => console.log(warning.code, warning.data)
  })
})

export const host = await createRpcHost({
  onWarning: (warning) => console.log(warning.message),
  plugins: [warnings]
})
```

只读警告订阅可后装，卸载或安装回滚时由原生注册移除。订阅只能由宿主级 `defineFlowPlugin` 提供；放进传输 `features`，或让 `defineFlowFeature` 返回 `onWarning`，均以 `INVALID_CONFIG` 拒绝。

被父端拉起并收到真实原生启动事实的子节点（process、thread、coroutine、dedicated worker 或 pool 成员）优先使用父端指定名，`instanceId` 也以父端事实为准。父端未命名时，保留子节点显式的 `self.name`；子节点也未命名时，默认名随父端的 instanceId 更新。用子节点握手报回的名字寻址。显式子节点名字或 instanceId 被父端覆盖时，构造成功，只发出一次 `RpcWarningCode.selfIgnored`（`SELF_IGNORED`）警告。`warning.data` 只含实际被忽略的项：名字冲突带 `parentName`/`ignoredName`，身份冲突带 `parentInstanceId`/`ignoredInstanceId`；只有 instanceId 不同也会警告。两份冲突的父端启动事实仍以 `INVALID_CONFIG` 拒绝。

## 迁移入口

| 旧用法                                                | 新用法                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| 根级 `host.request/send/notify/stream/dispatch/group` | `host.<ns>` 下的同名调用                        |
| `@migaia/rpc-host/plugin`                             | `@migaia/rpc-host/sdk`                          |
| 根入口的 contract 错误类、判断函数和错误类型          | `@migaia/rpc-host/contract`                     |
| `/probe` + `defineFeaturePlugin`                      | `/plugins/probe` 的 `probe` / `defineProbe`     |
| `authFeature/chunkFeature/typegenFeature`             | `/plugins` 的 `auth/chunk/typegen`              |
| 根 `defaultTimeoutMs` / 单次数字 timeout              | plugin 的 `features` record 与单次 timeout 配置 |
| `poolPlugin`、pool assembler                          | 传输 `features: { workers: pool({ size }) }`    |
| endpoint、RuntimePeer、v1、JSON-RPC profile           | 单一 Host 调用 owner 与新协议，无兼容入口       |
| 根级 `outcome` / 幂等 store                           | 安装 `/plugins/idempotency`，在命名空间查询     |

`remote.host.use`、`remote.host.unUse` 和 `remote.host.inspect` 已移除，不再提供通过 RPC 管理远端宿主插件的协议；本地原生宿主的安装与释放 API 保持各自契约。

汇总入口和各单项默认子路径均可 tree-shake。错误码从 `@migaia/rpc-contract/error-code` 引入；应用使用的错误类、错误判断和类型改从 `@migaia/rpc-host/contract` 引入，根入口不再提供这些转出。`RpcConstructionError` 与 `RpcAbortError` 在此为运行时类，可以用于 `instanceof`；它们与直接 contract 导入保持同一对象。该入口同时提供 `normalizeRpcPortable` 与类型 `IRpcPortableValue`，可用于已协商 native 值的严格 own-data 域规范化；不为调用者复制或安装另一份 contract。SDK 和 limits 面向插件作者的原有类型转出保持不变。传输作者只提交原生载体与编解码能力，host 负责握手、Session、待决表与 provider 执行。

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

auth 默认以对象交给 sign/verify；依赖旧文本输入时自行规范化或选择 `encodedType: 'string'`。完成的请求 ID 默认立即释放，需要旧保留时长时设置 `retain: 310_000`。本地 verifier/凭据解析错误保留原 cause，对端脱敏改用同步 `errorMapFeature`。

配置 sign/verify 时，auth 在既有签名握手中交换并验证每个来源的新挑战；应用回调仍须签名和验证收到的完整输入。此过程不增加公开 discovery 或握手配置。

verifyCredentials 可返回 { principalId: 非空字符串 }，把真实认证主体交给当前 Session；抛出或拒绝仍拒绝认证。void、字符串及其他原先被忽略的结果不会授予主体身份。

原六个 `/features/{auth,batch,chunk,idempotency,limits,schema}` 入口已删除，改从 `/plugins/*` 或 `/plugins` 导入。`rpcHostPipelines` 删除第三参数和 `pipelines` 输出，构造请求必须传给 `domainCore(request)`；传输自己声明管道。以下无抛出点错误码已删除，不提供替代码：`HOST_ASSEMBLER_DUPLICATE`, `HOST_FEATURE_DUPLICATE`, `PROVIDER_GENERATION_RETIRED`, `MIDDLEWARE_DUPLICATED`, `MIDDLEWARE_MISSING`, `PROVIDER_NOT_SETTLED`, `TARGET_NOT_IDENTIFIABLE`。

`onWarning` 的被忽略身份项放在 `data`，只包含实际发生冲突的名字或 instanceId。签名的小 buffer 只有未显式 `transfer` 时才可能内联；显式转移仍移交并 detach 原 buffer。载体实现须同步采用[当前清单格式](../rpc-contract/USEGUIDE.md#载体二进制与收发顺序)。
