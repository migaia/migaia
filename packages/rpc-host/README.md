# `@migaia/rpc-host`

`contract` 定义协议、接口、可移植值和错误契约；`host` 负责 RPC 调用、会话、握手、provider、转发与取消。传输 plugin 负责原生连接、代际、编解码、分帧与 transfer；信息流 plugin 和依附于 plugin 的 feature 各自实现可选能力。

一个 host 可以安装多个传输，调用按 `host.<ns>` 隔离。不建议一个 host 混用多种传输；通常每个 host 选择一种。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 开始使用

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

下面建立两个同一事件循环内的真实 host。父端的 timeout feature 安装在 coroutine plugin 上；子端接收本代专属 connect 句柄。输出 `42`，finally 关闭原生资源。

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { timeout } from '@migaia/rpc-host/features'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      features: [timeout({ ms: 1500 })],
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

已有 `defineHost` 或 class 宿主通过 `@migaia/rpc-host/sdk` 的 `rpcHostPipelines(getHost, pipeline, namespaces)` 一次取得管道声明和 `domainCore`。回调延后到安装时才读取真实宿主，并借用它自己的管道执行权。先提交信息流与链路策略，再安装传输；无需手写七条管道。具体接法见[使用指南](./USEGUIDE.md#在已有宿主中安装-rpc)。

## 调用与归属

| 入口                                                       | 完成含义                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `host.<ns>.request(method, payload?, options?)`            | 等待业务结果                                              |
| `host.<ns>.notify(method, payload?, options?)`             | 等待物理发送；不等待业务确认，`targetId` 可选单个直连目标 |
| `host.<ns>.stream(method, payload?, options?)`             | 惰性迭代器；多目标时各自独立消费                          |
| `host.<ns>.streamTo(targetId, method, payload?, options?)` | 选择一个直连目标，返回一个惰性迭代器 |
| `host.<ns>.group(steps, options?)`                         | 每个目标按顺序执行 `{ method, payload }`，没有跨目标事务  |
| `host.<ns>.send(targetId, method, payload?, options?)`     | 选择一个直连目标，返回标量                                |
| `host.<ns>.dispatch(targetId, method, payload?, options?)` | 同步返回 `void`，异步失败交给 reporter                    |
| `host.provide(definition)`                                 | 增量注册本地方法；重复名拒绝                              |
| `host.<ns>.peers`                                          | 已接受的直连能力；保存的函数绑定原连接代次                |
| `host.close()`                                             | 关闭整个 host；重复调用共享原 Promise                     |

上述无目标调用只在所属命名空间内选择目标：零个返回空 `fulfilled/rejected`，一个返回标量，多个返回按实例身份索引的 `fulfilled/rejected`。流集合中的迭代器独立取消。根级 `host.request` 等调用入口已删除。

定向流使用 `streamTo`，目标放在第一个参数；`stream` 的 options 不再接受 `targetId`。两者复用相同的流背压、取消和代次隔离。

`remote.host.use`、`remote.host.unUse` 和 `remote.host.inspect` 已移除，不再提供通过 RPC 管理远端宿主插件的协议；本地原生宿主的安装与释放 API 保持各自契约。

`host.<ns>.send('b', 'c.render', value)` 先到直连 b，再由 b 查询当前目录并转发到 c。持有的 `host.<ns>.peers.c.render` 不会自动改指重连后的新代。转发可跨命名空间，且不能延长上游截止时间。

在 `createRpcHost` 上用 `forward: { maxHops: 3 }` 配置各转发 host。默认 3，只接受 1–16 的整数，其他值以 `INVALID_CONFIG` 拒绝。各 host 检查自己的转发跳序；先检查环路，再检查跳数。

## 可选能力

信息流 plugin 安装进 host 的 `plugins`；feature 安装进所依附 plugin 的 `features`。

```ts doc-test=check
import { timeout, retry } from '@migaia/rpc-host/features'
import { linkPolicy, limits, probe } from '@migaia/rpc-host/plugins'
import timeoutFromSubpath from '@migaia/rpc-host/features/timeout'

export const defaults = linkPolicy({ features: [timeout({ ms: 1500 }), retry({ attempts: 2 })] })
export const capacity = limits({ maxGlobal: 256, maxPerPeer: 64 })
export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const perCallDeadline = timeoutFromSubpath({ ms: 100 })
```

汇总入口与默认子路径导入均可 tree-shake。其他信息流 plugin 为 `auth`、`chunk`、`batch`、`idempotency`、`schema`、`typegen`。推荐安装 `limits`；省略它就不启用这些配额。安装 `idempotency` 后，才有 `host.<ns>.outcome(key)`。`auth` 独立拥有请求 ID 重放账本；`maxReplayEntriesPerPeer` 限制每个已接纳对端保留的身份数量，`onRejected` 接收重放容量拒绝原因。

自定义信息流通过 `defineFlowPlugin` 的 `setup` 返回 `stages`；stage 接收该管道的 payload 和原生 `next(payload)`。观察事件单独放在 `observe`。frame 管道允许多次提交，各成员独立：捕获并报告一个成员失败后可以继续交出下一个；忽略失败的 `next()` Promise 会使管道拒绝。被取消的 batch 成员由原调用以 `CANCELLED` 结算，原 reason 保留在 `cause`，其他成员照常完成。

`auth` 对完整消息执行保护，再由 `chunk` 拆成物理帧；接收端先重组，再还原保护。probe 的 `protected` 事件对应整条消息，`frame` 事件保留实际 `chunkIndex`、`chunkCount` 和 `members`。物理 batch 的成员数在 batch frame 上观察；`envelope` 事件仍对每条逻辑消息观察一次。

自定义载体可以提供可选的 `reserveWrite`，借用已有流控容量。每次逻辑写出只预留一次；chunk 的分片共用凭据，batch 保留各成员的凭据，完成后释放。`write` 的完成仍表示实际物理接纳，`close` 必须结算载体拥有的排队写入。

[pool](../rpc-plugin-pool/README.md) 是传输的 `pool({ size })` feature，同一池只包含同载体成员，只公开一个逻辑对端。成员打开、调度和关闭属于 pool；`host.<ns>.members` 由传输提供原生控制。

## 期限、取消与错误

`FeatureScope` 唯一解析覆盖顺序：单次调用 `options.timeout/retry`、所在传输 plugin 的 feature、链路策略 plugin。单次值只接受完整 feature 实例或 `false`，不接受数字或配置对象。`timeout: false` 不启用 feature 超时，持续等待响应；已经继承的上游剩余期限仍递减。`retry: false` 禁用重试。只有发起方的标量调用和 group 重试，stream 从不重放、只使用 timeout；转发跳不重新开始预算。

进入 provider 前剩余截止时间已经耗尽的调用，以 `DEADLINE_EXCEEDED` 拒绝，不执行 provider；`before-start` 的取消语义保持不变。

所有调用种类支持 `signal`，单向调用物理发送之后也能向下游传播取消。provider 读取自己的 `context.signal`。取消不等于杀进程，也不回滚业务副作用。

按 `source/code` 识别错误，保留原生类型、`stack`、`cause` 和 `AggregateError.errors`。超时或断开不证明业务未执行；非幂等操作须先对账再考虑重试。

`send`、`request` 等返回 Promise 的调用通过拒绝传播非法 `idempotencyKey` 或命名空间已关闭的错误，保留各入口原有的 `source/code` 和 `cause`；非法 key 仍为 `CONTRACT_INVALID`。使用 `await` 或 `Promise.catch` 处理失败。`dispatch` 仍同步返回 `void` 并向 reporter 交付失败，`stream` 与 `streamTo` 仍返回延迟启动的异步迭代器。

公开 provider 注册失败以 `INVALID_CONFIG` 拒绝，原注册错误直接保留在 `cause`；错误说明不通过调用异常的字符串转换来生成。关闭后，待决调用以 `ENDPOINT_DISPOSED` 结算，实际载体关闭会拒绝仍被挂住的写入；不要求任意业务 Promise 因关闭而强行完成。

自定义 plugin 作者从 `@migaia/rpc-host/sdk` 开始。观察入口是 `/plugins/probe`；旧 `/plugin`、`/probe`、endpoint、per-session Peer 和 v1/JSON-RPC profile 已删除。rpc 家族可以直接依赖 `@migaia/rpc-contract`；只需错误码时导入 `/error-code`，不会带入协议与编解码执行代码。

## 公开行为与迁移

未分类的 provider 异常使用 `INTERNAL`，原生异常保留在错误图中。标量调用直接以还原的远端 Error 拒绝；不再增加 `RpcRemoteError` 外壳，调用方须改用真实错误的 `source/code`。协程远端 `context.signal.reason` 接收原 abort reason，不合成取消码；`stream.return(value)` 返回 runtime 的真实结束结果，不回传调用者传入的 `value`。

无目标调用按调用时已接受的会话选择；从 `peers` 保存的函数绑定原代次，退场后拒绝且不转向替代连接。即时 process 启动失败只保留一层 `PROCESS_CHANNEL_CLOSED`，原生 EPIPE 在 cause 图中；没有真实原生错误的 thread 关闭诊断不合成 message-port cause。

自行构造的原生宿主保留 `dispose()` 的原生 cleanup summary 与共享 Promise，不再附加 RPC 清理外壳。原失败叶对象、errors 顺序、cause 可达性和 disposer 一次执行保持；`createRpcHost` 返回的 `host.close()` 则保持自己的公开关闭语义。

幂等指纹使用对象自身的键序；同一 body 改变键序后是不同请求，同键冲突以 `CONTRACT_INVALID` 拒绝，原 store 的字符串指纹 ABI 保持不变。

原生 Feature 的 descriptors 每次冷编译只捕获一次，首次 selector 的校验及错误顺序保持；后续 selector 不再重复触发 Proxy reflection。

auth() 的已完成请求 ID 仅在实际原生 owner 证明来源独占时立即释放；其他来源继续按有界 TTL 保留。活动请求与 stream 仍保留到实际业务及迭代器清理完成。

配置 sign/verify 时，auth 在既有签名握手中交换并验证每个来源的新挑战；应用回调仍须签名和验证收到的完整输入。此过程不增加公开 discovery 或握手配置。

verifyCredentials 可返回 { principalId: 非空字符串 }，把真实认证主体交给当前 Session；抛出或拒绝仍拒绝认证。void、字符串及其他原先被忽略的结果不会授予主体身份。
