# @migaia/log-plugin-durable

Binlog, write-ahead and undo plugins for `@migaia/log-host`, plus standalone atomic log stores. The host is an exact-version peer; both packages currently use `0.0.11`.

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

`binlogPlugin` installs `host.binlog`, `walPlugin` installs `host.wal`, and `undoLogPlugin` installs `host.undo`. Plugins borrow the original store and release that borrow on uninstall. Its creator always owns disposal. Only one installed durable plugin may borrow a given store.

The root also exports `memoryLogStore`, `snapshotLogRecords`, `assertLogInteger`, `prepareLogAppend`, `snapshotLogStoreState`, `createLogStoreIndex`, `LogRecordState`, `LogStage`, and their record, storage, observation and extension types.

`@migaia/log-plugin-durable/file` exports `fileLogStore(path, options?)`. Node, Bun and Deno conditions use the actual SQLite builtin. The browser/default entry loads safely and rejects opening with `LOG_STORE_UNAVAILABLE`. A file connection retains an exclusive lock until its owner closes it.

The host contains failures from ordinary logging and flush/shutdown. Durable append/read, transaction state changes, readiness and revoked handles still reject. Inspect `LOG_DURABLE_ERROR_SOURCE` (`logging.durable`) with `LogDurableErrorCode`; the original failure remains reachable through `cause`.

Standalone store `observe`/`report` callbacks are diagnostic only. The default is the host's single `defaultLogFailureReporter`. A failed custom reporter falls back to that default; failure of the default ends reporting without changing the storage result.

See [USEGUIDE](./USEGUIDE.en.md); [中文](./README.md).
