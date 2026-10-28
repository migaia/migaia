# `@migaia/rpc-host`

`contract` 定义协议、接口、可移植值和错误契约；`host` 负责 RPC 调用、会话、握手、provider、转发与取消。传输 plugin 负责原生连接、代际、编解码、分帧与 transfer；信息流 plugin 和依附于 plugin 的 feature 各自实现可选能力。

一个 host 可以安装多个传输，调用按 `host.<ns>` 隔离。不建议一个 host 混用多种传输；通常每个 host 选择一种。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 开始使用

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

`@migaia/rpc-contract` 是精确 lockstep 的 peer 依赖，必须与 host 和传输插件一起安装相同版本。它们共用应用提供的同一份 contract；开发者显式安装的重复副本不在支持范围内。

错误类、错误判断和可移植值使用 `@migaia/rpc-host/contract`：它按名字转出 `RpcLifecycleError`、`RpcConstructionError`、`RpcAbortError`、`isRpcError`、`isRpcErrorInstance`、`isRpcRemoteError`、`isRpcTimeoutError`、`RPC_CORE_ERROR_SOURCE`、`normalizeRpcPortable`，以及 `RpcError` 等错误类型和 `IRpcPortableValue`。转出与应用提供的 contract 保持同一个对象，跨入口 `instanceof` 一致。原根入口的 contract 值与类型已迁移到此处，不保留旧转出；`createRpcHost` 仍从根入口导入。

下面建立两个同一事件循环内的真实 host。父端的 timeout feature 安装在 coroutine plugin 上；子端接收本代专属 connect 句柄。输出 `42`，finally 关闭原生资源。

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { timeoutFeature } from '@migaia/rpc-host/features'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      features: [timeoutFeature({ ms: 1500 })],
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true })
            )
        } finally {
          await child.close()
        }
      }
    })
  ]
})
try {
  console.log(await host.coroutine.request('double', 21))
} finally {
  await host.close()
}
```

协程不提供 Worker 隔离。独立进程、原生线程和浏览器场景分别选择 [process](../rpc-plugin-process/README.md)、[thread](../rpc-plugin-thread/README.md) 和 [browser](../rpc-plugin-browser/README.md) 的传输 plugin。

## 初始化与自定义宿主

`createRpcHost` 在同一个原生 plugin-host 上先提交信息流 plugin、链路策略 plugin 及其 feature，再安装传输 plugin 及其 feature。传输开始握手时，auth 等 stage 已经可用；后续安装失败由同一生命周期 owner 回滚并释放已取得的资源。

构造后可用 `const extended = await host.use(transport)` 后装传输，返回同一个冻结的原生 host，并在返回值的类型上增加命名空间。每次 `use` 独立提交或回滚；构造时那一批则一起成功或失败。改变消息流的宿主级 Feature 只能在构造的 `plugins` 中配置，后装会以 `INVALID_CONFIG` 拒绝；后装传输自动借用它们，传输自己的 `features` 随传输一起安装，仍只覆盖本命名空间。只读观察插件，包括警告订阅，可以后装。

已有 `defineHost` 或 class 宿主通过 `@migaia/rpc-host/sdk` 的 `rpcHostPipelines(getHost, pipeline)` 取得 `domainCore`，并把原生构造请求转交 `pipeline(name, request)`。每个传输自己声明管道，无需预列命名空间。普通原生宿主用 `rpcFlowPlugin([...features])` 安装共享信息流，再装传输。具体接法见[使用指南](./USEGUIDE.md#在已有宿主中安装-rpc)。

## 调用与归属

| 入口                                                       | 完成含义                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `host.<ns>.request(method, payload?, options?)`            | 等待业务结果                                              |
| `host.<ns>.notify(method, payload?, options?)`             | 等待物理发送；不等待业务确认，`targetId` 可选单个直连目标 |
| `host.<ns>.stream(method, payload?, options?)`             | 惰性迭代器；多目标时各自独立消费                          |
| `host.<ns>.streamTo(targetId, method, payload?, options?)` | 选择一个直连目标，返回一个惰性迭代器                      |
| `host.<ns>.group(steps, options?)`                         | 每个目标按顺序执行 `{ method, payload }`，没有跨目标事务  |
| `host.<ns>.send(targetId, method, payload?, options?)`     | 选择一个直连目标，返回标量                                |
| `host.<ns>.dispatch(targetId, method, payload?, options?)` | 同步返回 `void`，异步失败交给 reporter                    |
| `host.provide(definition)`                                 | 增量注册本地方法；重复名拒绝                              |
| `host.<ns>.peers`                                          | 已接受的直连能力；保存的函数绑定原连接代次                |
| `host.close()`                                             | 关闭整个 host；重复调用共享原 Promise                     |
| `host.use(...plugins)`                                     | 独立安装事务，返回带新增命名空间类型的同一 host           |
| `host.unUse(name)`                                         | 原生卸载结果；活动信息流限制下以状态错误拒绝              |

上述无目标调用只在所属命名空间内选择目标：零个返回空 `fulfilled/rejected`，一个返回标量，多个返回按实例身份索引的 `fulfilled/rejected`。流集合中的迭代器独立取消。根级 `host.request` 等调用入口已删除。

定向流使用 `streamTo`，目标放在第一个参数；`stream` 的 options 不再接受 `targetId`。两者复用相同的流背压、取消和代次隔离。

`remote.host.use`、`remote.host.unUse` 和 `remote.host.inspect` 已移除，不再提供通过 RPC 管理远端宿主插件的协议；本地原生宿主的安装与释放 API 保持各自契约。

`host.<ns>.send('b', 'c.render', value)` 先到直连 b，再由 b 查询当前目录并转发到 c。持有的 `host.<ns>.peers.c.render` 不会自动改指重连后的新代。转发可跨命名空间，且不能延长上游截止时间。

在 `createRpcHost` 上用 `forward: { maxHops: 3 }` 配置各转发 host。默认 3，只接受 1–16 的整数，其他值以 `INVALID_CONFIG` 拒绝。各 host 检查自己的转发跳序；先检查环路，再检查跳数。

## 可选能力

同一组 `authFeature`、`chunkFeature`、`batchFeature`、`idempotencyFeature`、`limitsFeature`、`errorMapFeature`、`schemaFeature` 工厂既可放进 host 的 `plugins`，也可放进传输的 `features`。host 配置作用于所有命名空间；传输配置只覆盖本命名空间的同种能力，每个命名空间只启用一份实现。host 级 `limitsFeature` 跨命名空间共用额度，传输级各自独立。`probe`、`typegen` 和 Devtools 只装在 host 级。原 `namespaces` 作用范围选项已删除，按传输选择范围时使用 `features`。

```ts doc-test=check
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'
import { linkPolicy, limitsFeature, probe } from '@migaia/rpc-host/plugins'
import timeoutFromSubpath from '@migaia/rpc-host/features/timeout'

export const defaults = linkPolicy({
  features: [timeoutFeature({ ms: 1500 }), retryFeature({ attempts: 2 })]
})
export const capacity = limitsFeature({ maxGlobal: 256, maxPerPeer: 64 })
export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const perCallDeadline = timeoutFromSubpath({ ms: 100 })
```

汇总入口与默认子路径导入均可 tree-shake。推荐安装 `limitsFeature`；省略它就不启用这些配额。安装 `idempotencyFeature` 后，才有 `host.<ns>.outcome(key)`。auth 默认把签名绑定对象交给 `sign/verify`；文本和字节模式只编码一层绑定。它的请求 ID 去重默认在完成后立即释放，也可选择签名窗口或毫秒 `retain`；`maxReplayEntriesPerPeer` 只限制数字保留模式，`onRejected` 接收容量拒绝原因。配置和 HMAC 示例见[认证说明](./USEGUIDE.md#认证签名与重复请求)。

`errorMapFeature` 同步决定对端能看到哪些错误信息，不改变本地原错、report、警告或日志观察。回调抛错、返回 Promise 或结果无法序列化时，报告映射失败，并按未映射时的规则发送原错误。未配置映射时，未认证对端的握手失败仍默认隐藏细节。见[错误映射](./USEGUIDE.md#映射发往对端的错误)。

自定义信息流通过 `defineFlowFeature` 的 `setup` 返回 `stages`，放进宿主的 `plugins` 或某个传输的 `features`；stage 接收该管道的 payload 和原生 `next(payload)`。观察事件单独放在 `observe`。frame 管道允许多次提交，各成员独立：捕获并报告一个成员失败后可以继续交出下一个；忽略失败的 `next()` Promise 会使管道拒绝。被取消的 batch 成员由原调用以 `CANCELLED` 结算，原 reason 保留在 `cause`，其他成员照常完成。

内置位置固定：出站 plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire；入站反向。数组书写顺序不改变这些位置。第三方 stage 默认在 plaintext，高阶 SDK 作者可显式指定受支持的 `layer`。

`authFeature` 对完整消息执行保护，再由 `chunkFeature` 拆成物理帧；接收端先重组，再还原保护。probe 的 `protected` 事件对应整条消息，`frame` 事件保留实际 `chunkIndex`、`chunkCount` 和 `members`。物理 batch 的成员数在 batch frame 上观察；`envelope` 事件仍对每条逻辑消息观察一次。

自定义载体可以提供可选的 `reserveWrite`，借用已有流控容量。每次逻辑写出只预留一次；chunk 的分片共用凭据，batch 保留各成员的凭据，完成后释放。`write` 的完成仍表示实际物理接纳，`close` 必须结算载体拥有的排队写入。

载体支持原生二进制时，显式列在 `transfer` 中的 ArrayBuffer 始终原生转移，移交后原 buffer 被 detach；配置签名时也会计算并校验摘要。没有显式转移的小 buffer 在签名路径上可内联，原 buffer 保留可用；未配置签名时不计算二进制摘要。共享 buffer 的视图仍保持别名关系和偏移。见[二进制说明](./USEGUIDE.md#二进制完整性与-transfer)。

会话使用中的共享或局部信息流 Feature 不能热卸载，移除相应原生注册以 `LIFECYCLE_MUTATION` 拒绝；先关闭受影响命名空间，再冷删除。auth、chunk、batch 等改变线上格式的能力，只有两端都安装才保证能建立通信；单端配置不提供兼容保证，也不主动禁止。见[后装与卸载](./USEGUIDE.md#后装与卸载传输)。

[pool](../rpc-plugin-pool/README.md) 是传输的 `pool({ size })` feature，同一池只包含同载体成员，只公开一个逻辑对端。成员打开、调度和关闭属于 pool；`host.<ns>.members` 由传输提供原生控制。

## 期限、取消与错误

`FeatureScope` 唯一解析覆盖顺序：单次调用 `options.timeout/retry`、所在传输 plugin 的 feature、链路策略 plugin。单次值只接受完整 feature 实例或 `false`，不接受数字或配置对象。`timeout: false` 不启用 feature 超时，持续等待响应；已经继承的上游剩余期限仍递减。`retry: false` 禁用重试。只有发起方的标量调用和 group 重试，stream 从不重放、只使用 timeout；转发跳不重新开始预算。

进入 provider 前剩余截止时间已经耗尽的调用，以 `DEADLINE_EXCEEDED` 拒绝，不执行 provider；`before-start` 的取消语义保持不变。

所有调用种类支持 `signal`，单向调用物理发送之后也能向下游传播取消。provider 读取自己的 `context.signal`。取消不等于杀进程，也不回滚业务副作用。

按 `source/code` 识别错误，保留原生类型、`stack`、`cause` 和 `AggregateError.errors`。超时或断开不证明业务未执行；非幂等操作须先对账再考虑重试。

`send`、`request` 等返回 Promise 的调用通过拒绝传播非法 `idempotencyKey`、transfer 准入被拒绝或命名空间已关闭的错误，保留各入口原有的 `source/code` 和 `cause`；非法 key 仍为 `CONTRACT_INVALID`。使用 `await` 或 `Promise.catch` 处理失败。`dispatch` 仍同步返回 `void` 并向 reporter 交付失败，`stream` 与 `streamTo` 仍返回延迟启动的异步迭代器。

公开 provider 注册失败以 `INVALID_CONFIG` 拒绝，原注册错误直接保留在 `cause`；错误说明不通过调用异常的字符串转换来生成。关闭后，待决调用以 `ENDPOINT_DISPOSED` 结算，实际载体关闭会拒绝仍被挂住的写入；不要求任意业务 Promise 因关闭而强行完成。

自定义 plugin 作者从 `@migaia/rpc-host/sdk` 开始。观察入口是 `/plugins/probe`；旧 `/plugin`、`/probe`、endpoint、per-session Peer 和 v1/JSON-RPC profile 已删除。rpc 家族可以直接依赖 `@migaia/rpc-contract`；只需错误码时导入 `/error-code`，不会带入协议与编解码执行代码。

## 公开行为与迁移

未分类的 provider 异常使用 `INTERNAL`，原生异常保留在错误图中。标量调用直接以还原的远端 Error 拒绝；不再增加 `RpcRemoteError` 外壳，调用方须改用真实错误的 `source/code`。协程远端 `context.signal.reason` 接收原 abort reason，不合成取消码；`stream.return(value)` 返回 runtime 的真实结束结果，不回传调用者传入的 `value`。

无目标调用按调用时已接受的会话选择；从 `peers` 保存的函数绑定原代次，退场后拒绝且不转向替代连接。即时 process 启动失败只保留一层 `PROCESS_CHANNEL_CLOSED`，原生 EPIPE 在 cause 图中；没有真实原生错误的 thread 关闭诊断不合成 message-port cause。

自行构造的原生宿主保留 `dispose()` 的原生 cleanup summary 与共享 Promise，不再附加 RPC 清理外壳。原失败叶对象、errors 顺序、cause 可达性和 disposer 一次执行保持；`createRpcHost` 返回的 `host.close()` 则保持自己的公开关闭语义。

幂等指纹使用对象自身的键序；同一 body 改变键序后是不同请求，同键冲突以 `CONTRACT_INVALID` 拒绝，原 store 的字符串指纹 ABI 保持不变。

原生 Feature 的 descriptors 每次冷编译只捕获一次，首次 selector 的校验及错误顺序保持；后续 selector 不再重复触发 Proxy reflection。

auth 的默认签名输入从文本改为对象；依赖文本的回调自行规范化，或设置 `encodedType: 'string'`。完成的请求 ID 默认立即释放，需要旧行为时配置 `retain: 310_000`。本地 verifier 与凭据解析器的原始错误保留在 cause 上，对端脱敏通过同步 `errorMapFeature` 控制。

配置 sign/verify 时，auth 在既有签名握手中交换并验证每个来源的新挑战；应用回调仍须签名和验证收到的完整输入。此过程不增加公开 discovery 或握手配置。

verifyCredentials 可返回 { principalId: 非空字符串 }，把真实认证主体交给当前 Session；抛出或拒绝仍拒绝认证。void、字符串及其他原先被忽略的结果不会授予主体身份。

原六个 `/features/{auth,batch,chunk,idempotency,limits,schema}` 入口已删除，改从 `/plugins/*` 或 `/plugins` 导入。`rpcHostPipelines` 删除第三参数与 `pipelines` 输出，改为转交真实构造请求；管道由传输声明。以下无抛出点错误码已删除，不提供替代码：`HOST_ASSEMBLER_DUPLICATE`, `HOST_FEATURE_DUPLICATE`, `PROVIDER_GENERATION_RETIRED`, `MIDDLEWARE_DUPLICATED`, `MIDDLEWARE_MISSING`, `PROVIDER_NOT_SETTLED`, `TARGET_NOT_IDENTIFIABLE`。

被父端拉起的子节点优先使用真实父端指定的名字与 instanceId。父端未命名时，保留显式的子节点 `self.name`；子节点也未命名时，默认名随父端的 instanceId 更新。可按子节点握手报回的名字寻址。显式子节点名字或 instanceId 被父端覆盖时，只发出一次 `RpcWarningCode.selfIgnored`（`SELF_IGNORED`）警告。警告为 `{ code, message, data }`，`data` 只含实际被忽略的项：`parentName`/`ignoredName`、`parentInstanceId`/`ignoredInstanceId`。先交给 `onWarning` 选项，再交给宿主级 SDK 订阅插件；无人接收才用 `console.warn`。警告本身不进 report，接收者失败则报告原错并继续。冲突的父端启动事实仍为 `INVALID_CONFIG`。见[警告订阅](./USEGUIDE.md#警告与子节点名称)。
