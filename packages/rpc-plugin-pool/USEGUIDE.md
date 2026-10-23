# RPC 池使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md) · [统一调用规则](../rpc-host/USEGUIDE.md)

`poolPlugin` 是 feature，与一个能重复打开独立成员的传输一起安装。原调度器拥有容量、有限 FIFO、租约、扩缩容和排空；成员仍由原进程、线程或协作任务 owner 监督。

## 从三个真实线程开始

保存为独立 ESM TypeScript 入口，使用支持该入口的 Node 工具链。子端与父端使用同一文件，但只有父端安装 pool。

```ts doc-test=check
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

输出依次为 42、42、2。每次请求仅执行一次，返回标量。本 host 只有一个调用端点；三个成员各自保留真实原生寿命和监督租约。

## 一个逻辑目标

对外目标只有 `pool`，也可使用导出的 RPC_POOL_PEER_ID。隐藏成员不进入直连目标列表或 host.peers；不要按成员的原生 ID 发请求。

无目标的 request、notify、stream、group、outcome 都只做一次原调度选择。`send('pool', method, payload)` 同样返回标量，不产生广播数组。group 的整批由同一成员处理；outcome 只选择一个成员，不替应用遍历全池的结果存储。

spawn 的 process/thread/coroutine 以及可重复建立独立连接的 process connect 来源可组合。listen 与 connectToParent 来源会在任何成员打开前以 POOL_TRANSPORT_UNSUPPORTED 拒绝；它们不是独立成员工厂。

## 容量与排队

| 选项          | 规则                                                    |
| ------------- | ------------------------------------------------------- |
| size          | 必填正整数，安装等待目标数量成员就绪                    |
| maxQueue      | 默认 256，非负整数；0 表示没有等待槽                    |
| idleTimeoutMs | 省略关闭空闲回收；指定时为正有限毫秒且不超过 2147483647 |
| scheduler     | 只用于原空闲计时，不接管原生监督或调用期限              |

每个成员同一时刻只借出一个客户端槽。忙时操作进入有限 FIFO；queued 是尚未分配成员的已接纳项，inFlight 是客户端占槽，不等于 provider 或 CPU 并发。队列满在业务前拒绝，不偷偷扩容。

调用选项 signal 可取消等待项。取消已开始业务则沿原调用取消语义，不能据此断言远端副作用从未发生。业务期限与排队/原连接准备的具体状态由原调用 owner 处理，不新增池专用超时。

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

export async function cancellableWork(
  host: IRpcHost<{ work(value: number): number }>,
  signal: AbortSignal
) {
  return await host.send('pool', 'work', 21, { signal, timeoutMs: 1000 })
}
```

## 流的槽归属

流是惰性的，第一次 next 才申请成员。流结束、return、throw 或取消结算后才释放槽。保存但从未迭代的流不占一个成员；消费了一部分却既不继续也不 return，会阻止该槽排空。

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

export async function firstPoolValue(
  host: IRpcHost<{ pool: { values(end: number): AsyncIterable<number> } }>
) {
  const stream = host.peers.pool.values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}
```

提前 return 只释放流及所借槽，不关闭整个 pool。缩容不会强行中断已经占槽的流。

## controls 绑定实际 host

保留 `const pool = poolPlugin(...)` 的返回对象，然后用 `pool.controls(actualHost)`。controls 在该对象的安装之间按真实 host 隔离；不要传普通对象、另一 host 的代理或复制的 plugin。

```ts doc-test=check
import type { IRpcPoolControls } from '@migaia/rpc-plugin-pool'

export async function shrink(controls: IRpcPoolControls) {
  await controls.resize(1)
  const snapshot = controls.stats()
  return { target: snapshot.targetSize, busy: snapshot.inFlight, waiting: snapshot.queued }
}
```

stats 返回新的冻结快照，含 targetSize、memberCount、inFlight、queued、state。memberCount 在成员仍被保留清理时包含退休/关闭成员；它不保证瞬间等于 targetSize。host.describe 的安全描述附带 pool 统计。

resize 按调用顺序串行处理，先退休空闲成员，再等待忙成员完成。扩容仅打开缺少的成员；失败保留原 primary 并回滚目标容量。空闲回收不改变 targetSize，后续需求会通过原成员工厂补齐。

## 排空与失败

controls.close 同步停止新接纳，排空此前已接纳操作与连接准备，然后关闭成员。重复调用共享同一个 Promise。没有额外池排空超时；应用应让活动流结束或 return，而不是等待 close 替它无限消费业务流。

host.close 会先排空逻辑 pool，再释放隐藏成员。单独 controls.close 只关闭池；应用仍需最终关闭 host，撤回其余 feature 和自身资源。

部分构造失败会尝试清理所有已打开成员，保留输入顺序的原 primary。后续清理失败不会替换它，仍可沿 errors/cause 或报告到达。close 尝试所有成员，失败以原 CLOSE_FAILED AggregateError 保留原始错误；终态不会重新开放。

池 source 为 rpc.pool：INVALID_OPTIONS、POOL_TRANSPORT_UNSUPPORTED、POOL_CLOSED、QUEUE_FULL、CALL_ABORTED、CLOSE_FAILED。业务与原生传输失败保留原 owner 的错误身份。池不自动重放请求；需要重试时使用 host 原 retry 策略并明确业务幂等性。
