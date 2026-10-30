# `@migaia/rpc-plugin-pool`

把同一种 transport 的多个真实成员呈现为一个逻辑对端 `pool`。

`rpc-contract` 定义纯协议与接口，`rpc-host` 拥有会话、provider、调用结算与取消；transport plugin 获取并监管原生资源。auth、chunk、batch、probe 等 flow plugin 处理消息流。`pool` 是安装在 transport 上的 feature，负责成员选择、有限 FIFO、扩缩容和排空；timeout、retry 也是完整 feature。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 开始使用

下面使用 Node 24 的真实 Worker。保存为独立 ESM TypeScript 入口，或先编译为 ESM。仅父端安装 pool，子端连接实际父端。

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread @migaia/rpc-plugin-pool
```

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { pool } from '@migaia/rpc-plugin-pool'

type IWorkerApi = { double(value: number): number }

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const plugins = [
    threadPlugin({ spawn: true, features: { workers: pool({ size: 3, maxQueue: 32 }) } })
  ] as const
  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
  try {
    console.log(await host.thread.send('pool', 'double', 21))
    await host.thread.pool.resize(2)
    console.log(host.thread.pool.stats().targetSize)
  } finally {
    await host.close()
  }
}
```

输出 `42` 和 `2`。每次调用只选一个成员，返回该次操作的结果，不广播到三个成员。

## 安装与逻辑目标

`pool({ size })` 放在 `threadPlugin`、`processPlugin` 或 `coroutinePlugin` 的 `features` 中。来源必须能重复获取独立成员：thread/coroutine spawn，或 process spawn/connect。listen、connectToParent 在获取成员前拒绝为 `POOL_TRANSPORT_UNSUPPORTED`。

调用与控制都在 transport 的命名空间：`host.thread.send('pool', ...)`、`host.thread.pool`、`host.thread.members`。隐藏成员不进入该 namespace 的业务目标目录；`members` 仅提供真实原生资源的诊断和管理。一个 Host 可以容纳命名空间不同的 transport；pool 本身只聚合同一种载体。

`request/notify/stream/group` 每次只进行一次成员选择。group 的整组使用同一成员。`outcome` 查询需要安装 idempotency plugin；查询只选择一个成员，不进行全池结果搜索。

## 选项与控制

| API / 选项                      | 行为                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `size`                          | 必填正整数；初次安装等待目标成员就绪                     |
| `maxQueue`                      | 默认 256，非负整数；0 表示没有等待槽                     |
| `idleTimeoutMs`                 | 省略则不回收；正有限毫秒，最大 2147483647                |
| `scheduler`                     | 只负责 pool 空闲计时                                     |
| `host.thread.pool.stats()`      | 冻结的 targetSize/memberCount/inFlight/queued/state 快照 |
| `host.thread.pool.resize(size)` | 按顺序调整目标容量，忙成员完成后安全退休                 |
| `host.thread.pool.close()`      | 停止新接纳，等待已接纳操作，再关闭成员                   |

`inFlight` 是客户端占槽数，不代表 provider 或 CPU 并发。流第一次 `next()` 才占槽，消费完毕或结束迭代后释放。缩容优先退休空闲成员。

业务与传输失败保留各自错误身份，pool 不自行重放业务。池错误 source 为 `rpc.pool`；按 code/cause 处理，参见[使用指南](./USEGUIDE.md)。自定义 transport 使用 `@migaia/rpc-host/sdk`，观察使用 `@migaia/rpc-host/plugins/probe`。
