# @migaia/rpc-pool 使用手册

## 1. 高阶用法：线程池、通知与 stream

这些文件使用真实 Worker。类型参数描述远端方法，调用形式与 Peer 一致。

```ts doc-test=run group=pool-operations file=worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: {
    double: (value: number) => value * 2,
    mark: (_value: number) => undefined,
    values: async function* (count: number) {
      for (let index = 0; index < count; index++) yield index
    }
  }
})
```

```ts doc-test=run group=pool-operations file=main.ts
import { createThreadPool } from '@migaia/rpc-pool'

const pool = await createThreadPool<{
  double(value: number): number
  mark(value: number): void
  values(count: number): AsyncIterableIterator<number>
}>({ spawn: new URL('./worker.js', import.meta.url), size: 2, maxQueue: 8, idleTimeoutMs: 1000 })
try {
  console.log(await pool.request('double', 21))
  await pool.notify('mark', 1)
  for await (const value of pool.stream('values', 3)) console.log(value)
  await pool.resize(1)
  console.log(pool.stats())
} finally {
  await pool.close()
}
```

## 2. 创建进程池

使用 `createProcessPool<T>({ spawn, size, maxQueue?, idleTimeoutMs?, probe? })`，同 README 的真实进程示例。不同程序可用 URL/路径；外语 JSON-RPC 使用原 `{ command, args, wire: 'jsonrpc', contract }`。通信本身不需要文件。此工厂保留 Process 的 call-options 类型，不提供 thread transfer。

两个池工厂都接受 `defineProbe()` 返回的原始 Probe 或只读 Probe 数组。`probe` 原样进入每个成员的 `createThreadPeer` / `createProcessPeer`，握手、ready 和监督重启事件沿原 Peer 路径发出。共享 Probe 的回调用 `endpointId` 区分成员；`seq` 仍属于对应端点，而非整个池的统一序号。

## 3. 取消、恢复与关闭

原 signal/options 对象进入 Peer。取消排队项仅移除那一项，`CALL_ABORTED` 的 cause 保留原 reason；已经派发的取消由原 Peer 执行。queue 等待不重算或缩短原 timeoutMs。

崩溃成员由原 supervisor 重新绑定；恢复期间调用可收到原 CLOSED，池不自动重放。关闭停止新 request/notify、首次 stream next 和 resize；已接受的工作排空后才关闭成员。stream 未消费完会延长 drain，使用 iterator.return 或 signal 取消。

缩容先回收闲置成员，忙成员结束后关闭；扩容只创建差额。闲置回收仍使用原公开 close/factory。stats 的 in-flight 是本池客户端操作，不是 provider concurrency；notify 的槽只覆盖原发送完成点。

## 4. 所有权与错误边界

池拥有自己创建的 Peer 和本地 FIFO，没有 Native 句柄、握手、admission 或 trust 权限入口。默认 queue 容量 256，maxQueue=0 禁止等待；overflow 在接纳前拒绝。

idleTimeoutMs 必须为有限正数且不超过 2147483647 毫秒，避免原生 timer 溢出变成立即回收。非法 size/maxQueue/idleTimeoutMs 在创建前以 TypeError/RangeError+INVALID_OPTIONS 拒绝。部分启动失败保留原 primary 并关闭本批已取得 Peer；secondary cleanup 报告。close 汇总原失败在 AggregateError.errors/cause，不只保留 code。source 与完整代码列表见 README。

支持环境继承原工厂。当前文档执行使用 Node 24 的真实 Process/Worker；Bun、Deno、浏览器线程仍受原入口、权限与 native lifetime 限制，不把 Node 文档结果当作其他运行时验证。

### Idle clock injection

Pass a host or manual scheduler in the common options of createThreadPool/createProcessPool. The option and scheduler methods are captured before invoking a native Peer factory. Advancing a manual clock drives idle expiry; reserving a member and closing the pool remove their previous tasks. Task unref is a liveness hint, not a change to timeout duration. Native Peer methods and close results retain their original ownership and identity. This option does not replace a member's own supervision scheduler.
