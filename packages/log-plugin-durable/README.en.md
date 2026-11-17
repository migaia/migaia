# @migaia/log-plugin-durable

[中文](./README.md)

Adds three kinds of logs that must survive a crash to `@migaia/log-host`: a binlog of ordered business events, a write-ahead log (WAL) of work that has started but not finished, and an undo log of data before and after a change. They are written to a log store you provide; the in-memory store is for tests, and the `/file` entry provides a file store backed by SQLite.

## Problems you may have seen

- **The process crashes in the middle of an operation, and after restart nobody knows what finished**: for example a charge request was sent but its result was never recorded. The cause is that "started" and "finished" were not written down before doing the work.
- **Business events must be replayed in order, but there are only ordinary log lines**: ordinary logs can be sampled, dropped or reordered and cannot serve as an event stream. The cause is the lack of numbered records that can be read again from any position.
- **A multi-step change fails and nobody knows how to undo it**: the change failed half way and recovery means comparing data by hand. The cause is that the data before the change was not saved first.

## Start here

The example shows the WAL: in the first run one charge completes, and the process "crashes" after another one starts; after restart the unfinished one is read back. Run it directly with Node 24.

```ts doc-test=run
import { createLogHost } from '@migaia/log-host'
import { walPlugin, memoryLogStore } from '@migaia/log-plugin-durable'

// The application creates and disposes the store; real deployments use fileLogStore(path) from /file
const intents = memoryLogStore()

// First run
const first = createLogHost({ plugins: [walPlugin({ store: intents })] })
await first.wal.ready()
const paid = await first.wal.begin('charge-card', { orderId: 'o1' })
await first.wal.complete(paid) // this one finished
await first.wal.begin('charge-card', { orderId: 'o2' }) // "crash" after starting: no complete
await first.shutdown('manual')

// After restart
const restarted = createLogHost({ plugins: [walPlugin({ store: intents })] })
await restarted.wal.ready()
for (const intent of await restarted.wal.pending())
  console.log(`unfinished: ${intent.kind} ${JSON.stringify(intent.payload)}`)
await restarted.shutdown('manual')
await intents.dispose()
```

Output:

```text
unfinished: charge-card {"orderId":"o2"}
```

`begin()` writes the intent to the store before you do the work and returns its sequence number; call `complete()` when done or `abort()` to give up. After a restart, `pending()` lists every unfinished intent in sequence order, and the business code decides whether to retry or undo it.

## Common APIs

| API                                                      | Description                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `binlogPlugin({ store })` → `host.binlog`                | `append`, `appendBatch`, `read`, `lastSeq`, `truncate`, `subscribe`: numbered business events |
| `walPlugin({ store })` → `host.wal`                      | `begin`, `complete`, `abort`, `pending`: write-ahead log                                      |
| `undoLogPlugin({ store })` → `host.undo`                 | `record`, `get`, `list`, `forget`: before/after data per transaction ID                       |
| `memoryLogStore()`                                       | In-memory store for tests                                                                     |
| `fileLogStore(path)` (`@migaia/log-plugin-durable/file`) | File store backed by the runtime's built-in SQLite                                            |

After installing a plugin, `await host.<name>.ready()` before using it.

## Contract details

- Plugins only borrow the store and return it on removal; the creator calls `dispose()`. A store can be borrowed by one durable plugin at a time; otherwise `LOG_STORE_IN_USE` is raised.
- `fileLogStore` uses the runtime's built-in SQLite on Node, Bun and Deno. The browser and default entries can be loaded, but opening a file rejects with `LOG_STORE_UNAVAILABLE`. A file connection holds an exclusive lock until it is closed.
- Failures of ordinary log methods and `flush()` / `shutdown()` are contained by the host, but durable `append`, `read`, transaction state changes, `ready` and stale handles still reject; a failed write is never reported as success. The error domain is `logging.durable` (`LOG_DURABLE_ERROR_SOURCE`); see `LogDurableErrorCode` for codes, and the original failure is reachable through `cause`.
- `binlog.subscribe` delivers existing history first, then follows new records; a slow listener only slows itself. When truncation passes a subscription's position, `LOG_SUBSCRIPTION_TRUNCATED` is reported and that subscription stops.
- The plugins do not undo anything for you: `undo` stores the data, and the business code decides how to use it.
- log-host and this package must have the same version (both `0.0.11` today).

See the [usage guide](./USEGUIDE.en.md) for full usage, the file store and custom store adapters.
