# Durable log usage

## Standalone stores and ownership

```ts
import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'

await using store = memoryLogStore({ report: (error) => console.error(error) })
const [seq] = await store.append([{ kind: 'created', payload: { id: 'order-1' } }])
await store.setState(seq, LogRecordState.done)
console.log(await store.read(1, 100))
```

Each append atomically commits its entire batch, then publishes one frozen `onAppend` notice. Empty batches assign no sequence and publish no notice. Payloads accept finite numbers, strings, booleans, null, dense arrays and plain objects. Admission never executes getters, toJSON or class methods. Sequences start at 1 and retain their high watermark after complete truncation.

`dispose()` immediately closes admission, drains accepted work and releases the resource. Repeated calls share one Promise, including a cleanup rejection. `Symbol.asyncDispose` has a distinct stable Promise; it reports cleanup failure and fulfills. Plugin shutdown/uninstall returns the borrow and never disposes the creator-owned store.

## Files and runtimes

```ts
import { fileLogStore } from '@migaia/log-plugin-durable/file'

await using store = await fileLogStore('./records.sqlite')
await store.append([{ kind: 'persisted', payload: null }])
```

Node/Deno use `node:sqlite`; Bun uses `bun:sqlite`. The runtime must actually provide its builtin. File stores keep the original SQLite transactions, record format and exclusive connection lock. Corrupt committed data rejects recovery. An uncertain COMMIT stops admission on that instance; inspect the native cause and reopen rather than replaying the batch. The browser/default entry loads safely and rejects opening with `LOG_STORE_UNAVAILABLE`.

## Plugins

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

`binlog` supports append, appendBatch, read, lastSeq, truncate and subscribe. Subscribers receive retained history before following real store notices. Each cursor has at most one running listener; a slow listener does not block another cursor. Truncation past a cursor reports `LOG_SUBSCRIPTION_TRUNCATED` and stops that subscription. `echo: true` sends only seq/time metadata through ordinary host logging, never the business payload.

`wal.begin` returns an actually persisted intent sequence. `complete`/`abort` make only pending-to-done/aborted transitions; `pending` keeps sequence order. `undo.record` stores JSON images and rejects duplicate active txIds. `get` returns an independent snapshot; `list` uses reverse append order and accepts sinceTime/limit; `forget` is idempotent. Plugins never apply undo images to business data.

The optional binlog/undo `transaction` is an `ILogAppendPort` supplied by the actual storage owner. Await ready first. Append starts in the current stack without waiting behind ordinary FIFO work. Its provisional sequence result does not publish a committed record; the actual owner's commit and store notice do. The plugin never begins, commits or rolls back that native transaction. `whenIdle` includes the real append completion and is not a business commit acknowledgement.

## Native adapters and diagnostics

`snapshotLogRecords` captures input synchronously. `prepareLogAppend` assigns sequence/time from an already committed head without mutating indexes. `createLogStoreIndex` owns only committed data, with no resource, queue or cleanup authority. Adapters invoke index.applyAppend/applyState/applyTruncate only after their own real atomic commit. `snapshotLogStoreState` validates recovered metadata, rows and payloads. `assertLogInteger` preserves native RangeError and distinguishes sequence exhaustion.

`observe` receives fixed LogStage metadata without business records or native resources. A synchronous throw or rejected completion reaches only diagnostics and cannot change a committed result. Explicit report overrides the default. Its failure falls back to the same host-owned default; failure of that terminal reporter stops reporting. Actual storage I/O still rejects the operation with its original code, native type and cause/errors identity.

The error domain is `logging.durable`; `LogDurableErrorCode` declares twelve stable codes. `LOG_STORE_IN_USE` means another installed plugin already borrows the store. `RUNTIME_SHUTTING_DOWN` means resource or old-installation admission is revoked; a replacement installation does not revive an old handle.
