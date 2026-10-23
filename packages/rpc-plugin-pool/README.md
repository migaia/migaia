# `@migaia/rpc-plugin-pool`

把一个 host 的真实进程、线程或协作任务成员交给原有有限调度、FIFO、扩缩容与排空 owner。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- 一个逻辑对端 **pool**，每次业务操作只选择一个成员执行，不广播给所有成员。
- 成员忙时进入有限 FIFO；队列取消只移除该项，溢出在进入业务前拒绝。
- 缩容先退休空闲成员，流在结束前保留自己的槽。
- 关闭先停止接纳，再排空已接受操作，最后沿原连接归属关闭成员。

## 从这里开始

下面使用 Node 24 的实际 Worker；保存为独立 ESM TypeScript 入口，或用工具链先编译为 ESM。

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread @migaia/rpc-plugin-pool
```

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { poolPlugin } from '@migaia/rpc-plugin-pool'

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const pool = poolPlugin({ size: 3, maxQueue: 32 })
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [threadPlugin({ spawn: true }), pool]
  })
  try {
    console.log(await host.request('double', 21))
    console.log(await host.send('pool', 'double', 21))
    await pool.controls(host).resize(2)
    console.log(pool.controls(host).stats().targetSize)
  } finally {
    await host.close()
  }
}
```

依次输出 `42`、`42`、`2`。两次调用各执行一次，均返回标量。三个成员拥有独立原生寿命，但本 host 仍只构造一个调用端点。

## 目标与成员

pool 是 feature，必须与一个可重复打开独立成员的传输组合：`processPlugin({ spawn / connect })`、`threadPlugin({ spawn })` 或 `coroutinePlugin({ spawn })`。listen 或 connectToParent 来源在打开任何成员前以 `POOL_TRANSPORT_UNSUPPORTED` 拒绝。

对外直连集合只有 `pool`，隐藏成员不进入 `host.peers` 或直接目标列表。`request / notify / stream / group / outcome` 以及 `send('pool', ...)` 都只经过一次原调度选择。group 的整组由同一成员执行，outcome 也只选择一个成员，不替应用做全池结果搜索。不要按隐藏成员原生 ID 定向调用。

## 控制与统计

保留工厂返回的准确实例，然后用 `pool.controls(actualHost)` 读取该安装的原 controls。同一定义可安装到不同 host，controls 按实际 host 隔离。

| API / 选项              | 行为                                                   |
| ----------------------- | ------------------------------------------------------ |
| `size`                  | 必填正整数；安装等待目标数量的独立成员就绪             |
| `maxQueue`              | 默认 256，非负整数；0 表示不排队                       |
| `idleTimeoutMs`         | 省略则不空闲回收；正有限毫秒值，回收后需要时补成员     |
| `scheduler`             | 只拥有原 idle 定时；不替换原生重启或调用期限时钟       |
| `controls.stats()`      | 冻结快照：targetSize/memberCount/inFlight/queued/state |
| `controls.resize(size)` | 串行接受容量变更，忙成员安全退休后结算                 |
| `controls.close()`      | 停止池接纳并排空；重复调用共享原 Promise               |
| `host.describe()`       | canonical host 描述附带 pool 统计                      |

`inFlight` 统计客户端占槽，不代表远端 provider 或 CPU 并发。流是惰性的，第一次 next 才申请槽；结束、return、throw 或取消后释放。主 host.close 会先排空逻辑池，再释放成员；只关闭 controls 不代替应用最终关闭 host。

## 错误与生命周期

池拥有的 source 为 `rpc.pool`，包括 INVALID_OPTIONS、POOL_TRANSPORT_UNSUPPORTED、POOL_CLOSED、QUEUE_FULL、CALL_ABORTED 与 CLOSE_FAILED。原业务/传输失败保持原 source/code/cause，池不自动重放业务。

部分构造失败会尝试关闭所有已打开成员并保留原 primary；清理失败继续可从其错误图或报告中定位。close 尝试所有成员，聚合清理错误时保留原 errors/cause，池保持终态。更多排队、取消、缩容和失败示例见[使用指南](./USEGUIDE.md)。
