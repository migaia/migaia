# @migaia/log-plugin-durable

[English](./README.en.md)

给 `@migaia/log-host` 增加三种需要落盘的日志：按顺序记录业务事件的 binlog、记录“开始做但还没做完”的预写日志（WAL），以及保存修改前后数据的撤销日志（undo）。它们都写到你提供的日志存储里；内存存储用于测试，`/file` 入口提供基于 SQLite 的文件存储。

## 你可能遇到过

- **进程在操作中途崩溃，重启后不知道哪些做完了**：例如扣款请求已经发出，结果还没记下来。根因是“开始做”和“做完了”没有在动手之前落盘。
- **需要按顺序重放业务事件，却只有散落的普通日志**：普通日志可能被采样、丢弃或乱序，不能当作事件流。根因是缺少带序号、可从任意位置继续读取的事件记录。
- **多步修改失败了，不知道怎么改回去**：改到一半出错，只能人工对照数据恢复。根因是修改前的数据没有先保存下来。

## 从这里开始

下面演示 WAL 的用法：第一次运行中一笔扣款完成了，另一笔开始后进程“崩溃”；重启后读出还没完成的那一笔。用 Node 24 直接运行。

```ts doc-test=run
import { createLogHost } from '@migaia/log-host'
import { walPlugin, memoryLogStore } from '@migaia/log-plugin-durable'

// 日志存储由应用创建并负责释放；真实部署用 /file 入口的 fileLogStore(path)
const intents = memoryLogStore()

// 第一次运行
const first = createLogHost({ plugins: [walPlugin({ store: intents })] })
await first.wal.ready()
const paid = await first.wal.begin('charge-card', { orderId: 'o1' })
await first.wal.complete(paid) // 这一笔做完了
await first.wal.begin('charge-card', { orderId: 'o2' }) // 这一笔开始后“崩溃”，没有 complete
await first.shutdown('manual')

// 重启后
const restarted = createLogHost({ plugins: [walPlugin({ store: intents })] })
await restarted.wal.ready()
for (const intent of await restarted.wal.pending())
  console.log(`未完成：${intent.kind} ${JSON.stringify(intent.payload)}`)
await restarted.shutdown('manual')
await intents.dispose()
```

输出：

```text
未完成：charge-card {"orderId":"o2"}
```

`begin()` 在你动手之前把意图写进存储并返回它的序号；做完后 `complete()`，放弃时 `abort()`。重启后 `pending()` 按原序号列出所有还没完成的意图，由业务决定重试还是撤销。

## 常用 API

| API                                                       | 说明                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `binlogPlugin({ store })` → `host.binlog`                 | `append`、`appendBatch`、`read`、`lastSeq`、`truncate`、`subscribe`：带序号的业务事件 |
| `walPlugin({ store })` → `host.wal`                       | `begin`、`complete`、`abort`、`pending`：预写日志                                     |
| `undoLogPlugin({ store })` → `host.undo`                  | `record`、`get`、`list`、`forget`：按事务 ID 保存修改前后的数据                       |
| `memoryLogStore()`                                        | 内存存储，用于测试                                                                    |
| `fileLogStore(path)`（`@migaia/log-plugin-durable/file`） | 基于运行时自带 SQLite 的文件存储                                                      |

每个插件安装后都要先 `await host.<名称>.ready()` 再使用。

## 契约细节

- 插件只借用存储，卸载后归还；存储由创建者负责 `dispose()`。同一个存储同时只能被一个 durable 插件借用，否则报 `LOG_STORE_IN_USE`。
- `fileLogStore` 在 Node、Bun、Deno 上使用运行时自带的 SQLite；浏览器和默认入口可以加载，但打开文件以 `LOG_STORE_UNAVAILABLE` 拒绝。文件连接持有独占锁，关闭后其他使用者才能打开。
- 普通日志方法和 `flush()` / `shutdown()` 的失败由 host 收口；但 durable 的 `append`、`read`、事务状态变化、`ready` 和失效句柄仍会拒绝，不能把持久化失败当成成功。错误域是 `logging.durable`（`LOG_DURABLE_ERROR_SOURCE`），错误码见 `LogDurableErrorCode`，原始故障沿 `cause` 可达。
- `binlog.subscribe` 先交付已有的历史，再跟随新记录；慢的监听器只拖慢自己。截断越过某个订阅的位置时，报告 `LOG_SUBSCRIPTION_TRUNCATED` 并停止该订阅。
- 插件不替业务执行撤销：`undo` 只保存数据，怎样用这些数据恢复由业务决定。
- log-host 与本包必须是同一版本（目前都是 `0.0.11`）。

完整用法、文件存储和自定义存储适配见 [使用指南](./USEGUIDE.md)。
