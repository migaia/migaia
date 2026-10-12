# @migaia/rpc-pool

在公开 RPC Peer 上组合线程与进程池。每个成员一个客户端操作槽，最少 in-flight 调度，平局轮转；忙时进入有限 FIFO。通信、握手、监督与错误仍由原 Peer 管理。

## createThreadPool：线程池

`spawn` 原样交给 `createThreadPeer`，支持 `true`、入口路径、URL 和现有配置。不同程序才需要入口。此例的两个文件由文档检查器构建并运行。

```ts doc-test=run group=pool-thread file=worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
```

```ts doc-test=run group=pool-thread file=main.ts
import { createThreadPool } from '@migaia/rpc-pool'

const pool = await createThreadPool<{ double(value: number): number }>({
  spawn: new URL('./worker.js', import.meta.url), size: 2
})
try {
  console.log(await Promise.all([pool.request('double', 21), pool.request('double', 10)]))
  await pool.resize(3)
  console.log(pool.stats())
} finally {
  await pool.close()
}
```

## createProcessPool：进程池

`spawn` 原样交给 `createProcessPeer`。入口、运行时与权限规则和原工厂一致。名字端点用于独立进程；池 API 创建自己的成员程序。

```ts doc-test=run group=pool-process file=service.ts
import { createProcessPeer } from '@migaia/rpc-process'

await createProcessPeer({ provide: { add: (value: { a: number; b: number }) => value.a + value.b } })
```

```ts doc-test=run group=pool-process file=main.ts
import { createProcessPool } from '@migaia/rpc-pool'

const pool = await createProcessPool<{ add(value: { a: number; b: number }): number }>({
  spawn: new URL('./service.js', import.meta.url), size: 2, maxQueue: 16
})
try {
  console.log(await pool.request('add', { a: 20, b: 22 }))
} finally {
  await pool.close()
}
```

## 调度与生命周期

两个工厂都返回 `request / notify / stream / resize / close / stats`。没有 Proxy。

- `size` 是正整数；`maxQueue` 默认 256，允许 0。所有槽忙且队列满时拒绝 `QUEUE_FULL`，不发送业务调用。
- `stats()` 是池自身的客户端操作快照，不是远端 provider 并发。request 到 Promise 完成、notify 到发送 Promise 完成、stream 到 done/return/throw 才释放槽。
- `stream` 是惰性 iterator：首次 `next()` 才接纳；未开始的 iterator 不阻碍关闭。长 stream 需要消费、return 或取消才能 drain。
- `resize(size)` 按调用顺序增减成员，缩容等正在使用的成员完成。`close()` 停止新接纳并排空已接受的队列，重复调用返回同一 Promise。
- `idleTimeoutMs` 设置为不超过 2147483647 毫秒的有限正数时，闲置成员通过原 `peer.close()` 退役，下一个任务通过原公开工厂补回目标大小。
- 原 supervisor 负责崩溃重启与重新绑定。默认裸 spawn 使用原 on-failure 策略和五次预算；不重置用户预算。恢复期间原 Peer 可以拒绝 `CLOSED`；恢复后未来新调用使用同一个 Peer。池不自动重放失败业务调用。
- 派发后的 call options 和 signal 原样传给 Peer；排队阶段取消为 DOMException AbortError，`CALL_ABORTED` 的 cause 是原 reason。`timeoutMs` 从原 Peer 接收操作时起算，池不另建队列 deadline。

`spawn: true` 会重跑整个主入口，使用原 `isProcessChild()` / `await isThreadChild()` guard。相对字符串基于主入口目录；URL 精确。浏览器线程沿原 URL 规则；Node `.ts` 去类型不重写 `.js` 导入，使用编译输出或 loader。详细入口、认证与运行时边界见 rpc-process / rpc-threads 使用手册。

## 错误

本包 source 为 `@migaia/rpc-pool`：`INVALID_OPTIONS`（TypeError/RangeError）、`POOL_CLOSED`、`QUEUE_FULL`、`CALL_ABORTED`（DOMException）、`CLOSE_FAILED`（AggregateError）。原 Native/Peer 错误保持自己的 source/code 与实例；启动回滚的 secondary cleanup 报告，原 primary 保留；关闭汇总保留原 errors/cause。

只依赖 rpc-core、rpc-process、rpc-threads 的公开入口。没有工作窃取、跨机器池或另一套 RPC/native supervision。
