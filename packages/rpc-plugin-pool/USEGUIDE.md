# Pool 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md) · [Host 调用规则](../rpc-host/USEGUIDE.md)

Contract 定义纯协议与接口，Host 拥有会话、provider 和调用结算，transport 获取并监管真实原生资源。flow plugin 通过消息介入点提供 auth、chunk、batch、probe。`pool` 是 transport 的完整 feature：只拥有同载体成员调度、FIFO、扩缩容和排空；timeout/retry feature 各自拥有调用策略。

## 安装在 transport 上

父端示例使用三个真实 Thread 成员。一个 Host 允许安装命名空间不同的 transport；本例只安装一个 `thread` namespace，pool 不混合不同载体。

```ts doc-test=check
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { pool, RPC_POOL_PEER_ID } from '@migaia/rpc-plugin-pool'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'

type IWorkerApi = { work(value: number): number; values(end: number): AsyncIterable<number> }

const plugins = [
  threadPlugin({
    spawn: new URL('./worker.js', import.meta.url),
    features: {
      workers: pool({ size: 3, maxQueue: 32 }),
      timeout: timeoutFeature({ ms: 1500 }),
      retry: retryFeature({ attempts: 2 })
    }
  })
] as const

type IPoolHost = IRpcHost<IWorkerApi, typeof plugins>

export function open() {
  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })
}

export function work(host: IPoolHost, signal: AbortSignal) {
  return host.thread.send(RPC_POOL_PEER_ID, 'work', 21, {
    signal,
    timeout: { ms: 1000 },
    retry: false
  })
}

export async function firstValue(host: IPoolHost) {
  const stream = host.thread.peers.pool.values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}

export async function shrink(host: IPoolHost) {
  await host.thread.pool.resize(1)
  return { stats: host.thread.pool.stats(), members: await host.thread.members.list() }
}

export async function closeIdlePool(host: IPoolHost) {
  await host.thread.pool.close()
  await host.close()
}
```

相应 `worker.js` 使用独立子入口；只父端安装 pool，子端连接实际父端。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: {
    work: (value: number) => value * 2,
    values: async function* (end: number) {
      for (let value = 0; value < end; value += 1) yield value
    }
  }
})
```

工厂是 `pool(options)`，控制入口是该安装的 `host.thread.pool` 和 `host.thread.members`，不是工厂对象上的宿主查询方法。`features` 使用 `{ name: feature }` 接收原生 pool、timeout、retry token；单次调用 timeout/retry 使用策略配置对象或 `false` 覆盖。

## 一个逻辑目标

业务目录只呈现 `pool`（导出的 `RPC_POOL_PEER_ID`），不会把隐藏成员公开为直接调用目标。`host.thread.send('pool', ...)` 只借出一个成员；无目标 request/notify/stream/group 也只选择一次。`members` 管理实际原生资源，不是直接调用隐藏成员的业务捷径。

group 的整组保持同一成员。只有安装 idempotency plugin 才能调用 outcome；它也选择一个成员，不在所有成员存储中搜索结果。pool 本身不提供去重、幂等保证或业务重试。

来源必须可重复获取独立成员：Thread/Coroutine spawn，Process spawn 或 connect。listen/connectToParent 在原生成员获取前拒绝；pool 不把单条父连接复制成多个成员。自定义原生部署使用 `@migaia/rpc-host/sdk`。

## 容量、队列与取消

| 选项            | 规则                                         |
| --------------- | -------------------------------------------- |
| `size`          | 必填正整数，初次安装等待目标成员就绪         |
| `maxQueue`      | 默认 256；非负整数；0 表示不排队             |
| `idleTimeoutMs` | 省略则禁用；正有限毫秒，不超过 2147483647    |
| `scheduler`     | 只拥有空闲回收计时，不接管原生监督或调用期限 |

每成员同一时刻借出一个客户端槽。忙时操作进入有限 FIFO，满时拒绝为 QUEUE_FULL。`signal` 可取消等待项；开始后的取消沿原调用路径处理，不能据此断言远端没有副作用。

stats 是新的冻结快照：targetSize、memberCount、inFlight、queued、state。`queued` 仅计尚未分配成员的等待项；`inFlight` 是客户端占槽，不是远端 provider 或 CPU 并发。memberCount 包含尚未完成清理的退休成员，可能暂不等于 targetSize。

## 流、扩缩容与排空

流在第一次 `next()` 时才申请槽。完成、提前 return 或 throw/取消结算后释放；应用持有未完成的流会阻止相应槽排空。结束流不关闭整个 pool。

`resize` 按调用顺序串行处理，缩容优先退休空闲成员，等待忙成员完成。扩容只获取缺失成员；失败保留 primary 并在仍开放时恢复原目标。空闲回收不改变 targetSize，之后的需求会补齐成员。

显式 `host.thread.pool.close()` 停止新接纳，等待此前接受的操作与成员获取，再尝试关闭成员；重复调用共享关闭 Promise。pool 不添加自己的排空超时。应用应结束持有的业务与流，显式等待 pool 关闭，再完成 Host 清理；`closeIdlePool` 展示没有持有业务时的顺序。

## 错误与观察

池 source 为 `rpc.pool`：INVALID_OPTIONS、POOL_TRANSPORT_UNSUPPORTED、POOL_CLOSED、QUEUE_FULL、CALL_ABORTED、CLOSE_FAILED。业务与原生错误保留其原 owner 的 source/code/cause；池不自动重放。

部分构造失败会清理已获取成员并保留原 primary，次级清理错误继续从错误图或报告到达。最终关闭期间的成员清理失败以 CLOSE_FAILED AggregateError 保留原 errors 和首个 cause，关闭后不重新开放。开放期间已经通过 resize 拒绝或空闲回收报告交付的错误不会保留到最终 close 再次抛出。只读观察使用 `@migaia/rpc-host/plugins/probe`，不在 pool 中另装一套诊断或消息解析器。
