# @migaia/log-plugin-durable

为 `@migaia/log-host` 提供 binlog、WAL 和 undo 插件，以及可独立使用的原子日志存储。宿主是精确同版本 peer；当前两个包均为 `0.0.11`。

```ts
import { createLogHost } from '@migaia/log-host'
import { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'

const store = memoryLogStore()
const log = createLogHost({ plugins: [binlogPlugin({ store })] })
try {
  await log.binlog.ready()
  const seq = await log.binlog.append('order.created', { id: 'order-1' })
  console.log(await log.binlog.read(seq, { limit: 1 }))
} finally {
  await log.shutdown('manual')
  await store.dispose()
}
```

`binlogPlugin` 安装 `host.binlog`，`walPlugin` 安装 `host.wal`，`undoLogPlugin` 安装 `host.undo`。插件借用原始 store，卸载后归还；creator 始终负责 store 的销毁。同一 store 只能有一个已安装的 durable 插件借用。

根入口还导出 `memoryLogStore`、`snapshotLogRecords`、`assertLogInteger`、`prepareLogAppend`、`snapshotLogStoreState`、`createLogStoreIndex`、`LogRecordState`、`LogStage` 和相应记录、存储、观察及扩展类型。

`@migaia/log-plugin-durable/file` 提供 `fileLogStore(path, options?)`。Node、Bun、Deno 条件使用实际 SQLite builtin；browser/default 入口可安全加载，打开文件以 `LOG_STORE_UNAVAILABLE` 拒绝。文件连接保留独占锁，关闭后才能由其它 owner 打开。

日志方法与宿主 flush/shutdown 的失败由宿主收口；存储 append/read、事务状态变化、ready 和失效的 durable 句柄仍可拒绝。检查 `LOG_DURABLE_ERROR_SOURCE`（`logging.durable`）与 `LogDurableErrorCode`，并沿 `cause` 读取原始故障。

独立 store 的 `observe`/`report` 仅用于诊断。默认 report 引用宿主唯一的 `defaultLogFailureReporter`；自定义 reporter 失败转交默认，默认自身失败终止诊断，不改变原始存储结果。

详见 [USEGUIDE](./USEGUIDE.md)；[English](./README.en.md)。
