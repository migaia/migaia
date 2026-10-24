# @migaia/storage-plugin-archive

Explicitly move eligible string-key records from a transactional hot backend into immutable gzip NDJSON blob segments. Install the ordinary extension after both borrowed backends, then call `detect()` before operations. Memory, SQLite and PostgreSQL hot backends allow the required external I/O; IndexedDB hot storage is rejected before cold I/O.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'history',
    hot: 'hot',
    cold: 'cold',
    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]
  })
)
await host.detect()
try {
  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')
  console.log(await host.extensions.historyRun())
  console.log(await host.extensions.historyGet('event:one', { restore: true }))
  console.log(await host.extensions.historySweep())
} finally {
  await host.dispose()
}
```

The plugin id supplies the function prefix: `history` publishes `historyRun`, `historyGet`, and `historySweep`.

`historyRun({ rule?, limit?, signal?, timeoutMs? })` applies rules in declaration order and counts matching candidates toward the limit. Each segment defaults to 1,048,576 uncompressed UTF-8 bytes; an oversized record gets its own segment. A completed cold upload precedes one original hot transaction that checks the immutable object, rechecks records, updates manifests/reference counts and deletes unchanged eligible hot rows. Earlier committed segments survive later failures; cold orphans remain for explicit `historySweep()`.

`historyGet(key, { restore? })` checks hot storage first, otherwise validates the entire gzip/NDJSON snapshot through EOF before its finite hot/manifest recheck. Restore is opt-in and preserves a concurrently written hot value. Map/Set use the shared collections codec; bytes become its tagged portable representation. Date and functions are unsupported.

`historySweep()` follows opaque blob pages and point-checks segment directories under the same original control lock. It removes only unreferenced objects with this plugin's prefix and format/version metadata. It never scans every manifest. All methods use the current host organization, and closing drains accepted work without closing borrowed storage independently.

Errors use `storage.backend.archive`: `INVALID_OPTION`, `INVALID_ARGUMENT`, `ARCHIVE_OPERATION_FAILED`, `ARCHIVE_SEGMENT_INVALID`. Original causes remain reachable. Host admission/close, contract capability, conflict and coded cancellation errors preserve their identity. Archive-owned run failures expose only certainly committed `{ archived, skipped, segments }` progress; frozen original conflicts keep their identity and expose these counts through `onArchiveRunError`.
