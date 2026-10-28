# Durable 日志用法

## 独立存储与资源归属

```ts
import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'

await using store = memoryLogStore({ report: (error) => console.error(error) })
const [seq] = await store.append([{ kind: 'created', payload: { id: 'order-1' } }])
await store.setState(seq, LogRecordState.done)
console.log(await store.read(1, 100))
```

一次 append 原子提交整个批次，随后发出一次冻结的 `onAppend` 通知；空批次不分配序号、不发通知。JSON payload 只允许有限数字、字符串、布尔值、null、无空洞数组和普通对象，不执行 getter、toJSON 或类方法。序号从 1 递增，完整截断后仍保留高水位。

`dispose()` 立即停止接纳新操作，排空已接纳工作后关闭资源；重复调用返回同一 Promise，清理失败仍拒绝。`Symbol.asyncDispose` 有自己独立且稳定的 Promise；清理失败上报后兑现。插件 shutdown/uninstall 只归还借用，不调用 creator-owned store 的 dispose。

## 文件与运行环境

```ts
import { fileLogStore } from '@migaia/log-plugin-durable/file'

await using store = await fileLogStore('./records.sqlite')
await store.append([{ kind: 'persisted', payload: null }])
```

Node/Deno 使用 `node:sqlite`，Bun 使用 `bun:sqlite`；运行环境必须实际提供相应 builtin。存储使用原生 SQLite 事务、原有记录格式与独占连接锁。损坏数据拒绝恢复；COMMIT 结果不确定时，该实例停止接纳操作，调用方检查原始 cause 后重新打开，不能自行重放同一批次。browser/default 入口不加载 Node 文件模块，打开以 `LOG_STORE_UNAVAILABLE` 拒绝。

## 插件

```ts
import { createLogHost } from '@migaia/log-host'
import { binlogPlugin, walPlugin, undoLogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'

const events = memoryLogStore()
const intents = memoryLogStore()
const images = memoryLogStore()
const host = createLogHost({
  plugins: [
    binlogPlugin({ store: events }),
    walPlugin({ store: intents }),
    undoLogPlugin({ store: images })
  ]
})
try {
  await Promise.all([host.binlog.ready(), host.wal.ready(), host.undo.ready()])
  await host.binlog.append('created', { id: 'order-1' })
  const intent = await host.wal.begin('save-order', { id: 'order-1' })
  await host.undo.record('tx-1', [{ target: 'order-1', before: null, after: { total: 12 } }])
  await host.wal.complete(intent)
  await host.undo.forget('tx-1')
} finally {
  await host.shutdown('manual')
  await Promise.all([events.dispose(), intents.dispose(), images.dispose()])
}
```

`binlog` 支持 append、appendBatch、read、lastSeq、truncate 与 subscribe。订阅先交付保留历史，再追随真实 store 通知；每个订阅者最多一个 listener 在执行，慢 listener 不阻塞其它订阅者。截断越过游标时，上报 `LOG_SUBSCRIPTION_TRUNCATED` 并停止该订阅。`echo: true` 仅通过普通日志管线输出 seq/time 元数据，不携带业务 payload。

`wal.begin` 返回实际已持久化的 intent 序号；`complete`/`abort` 只允许 pending 记录单向转为 done/aborted，`pending` 保持原序号顺序。`undo.record` 保存 JSON images；活动 txId 不可重复，`get` 返回独立快照，`list` 按逆追加顺序并支持 sinceTime/limit，`forget` 幂等释放已提交身份。插件不代替业务应用 undo images。

binlog/undo 的可选 `transaction` 是实际存储 owner 提供的 `ILogAppendPort`。必须先 await ready。append 在当前调用栈开始，不排在普通 FIFO 任务之后；结果是暂定序号，只有 owner 的真实 commit/store 通知发布可见记录。插件不开始、不提交、不回滚该事务。`whenIdle` 覆盖原始 append 完成，不能把结果当成业务提交确认。

## 原生 adapter 与诊断

`snapshotLogRecords` 同步捕获批次，`prepareLogAppend` 从已提交 head 分配序号/时间但不修改 index；`createLogStoreIndex` 只拥有已提交数据，不拥有资源、队列或清理权。adapter 在自己的真实原子提交成功后调用 index.applyAppend/applyState/applyTruncate。`snapshotLogStoreState` 验证恢复 head、行和 payload，`assertLogInteger` 保留原生 RangeError 与序号耗尽的区别。

`observe` 只有固定 LogStage 元数据，不含记录内容或原生资源。回调同步抛错或异步拒绝仅进入 reporter，不改变已提交结果。显式 report 覆盖默认；reporter 再失败交给同一个 host 默认 reporter，终端自身失败停止。原始存储 I/O 失败仍向操作调用方拒绝，并保留 code、原生类型及 cause/errors 的原始身份。

错误域为 `logging.durable`；十二个稳定 code 由 `LogDurableErrorCode` 定义。`LOG_STORE_IN_USE` 表示 store 已被另一个插件借用；`RUNTIME_SHUTTING_DOWN` 表示 resource 或旧安装已停止接纳；不要使用新安装恢复旧句柄。
