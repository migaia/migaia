# Archive usage guide

## Find your scenario

| Need                                          | Scenario                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Move records by business age                  | [Archive by retention time](#archive-by-retention-time)                 |
| Read history, restore and reclaim space       | [Read restore and clean up](#read-restore-and-clean-up)                 |
| Use custom function prefixes per organization | [Organizations and custom prefixes](#organizations-and-custom-prefixes) |
| Monitor certainly committed counts            | [Observe committed progress](#observe-committed-progress)               |

## Archive by retention time

Archive events older than a day while keeping new records hot.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'archive',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
await hot.putRecord({ createdAt: 0, value: 'old' }, 'event:old')
await hot.putRecord({ createdAt: Date.now(), value: 'new' }, 'event:new')
const result = await host.extensions.archiveRun({ rule: 'old', limit: 1 })
console.log(result.archived)
console.log((await hot.getRecord('event:old')) === undefined)
console.log((await hot.getRecord('event:new')) !== undefined)
```

Expected output:

```text
1
true
true
```

id sets extension-function prefixes. hot/cold are previously installed backend IDs. rules must be nonempty, with unique names and string-key prefixes. olderThanMs is a nonnegative safe integer. where(cutoffMs) receives one sampled current time minus retention and returns the record condition. The condition explicitly chooses a time field; the plugin never guesses one.

segmentBytes defaults to 1,048,576 uncompressed UTF-8 row bytes and must be a positive safe integer. An oversized record gets its own segment. Optional rule selects one named rule; omission runs declaration order. Optional limit is a positive safe integer counting matching candidates across selected rules. The same key is not counted twice.

Records become immutable gzip NDJSON segments. After upload, a hot transaction checks the object, rereads candidates, updates archive references and deletes only unchanged values that still match. Concurrent changes count as skipped instead of deleting new data. There is no global hot/cold transaction. If a later segment fails, earlier segments remain committed and unused cold objects await explicit Sweep.

Archive is an explicit operation, without a background scheduler or automatic age deletion. The application decides when to call Run. Use persistent backends for production; the in-memory example loses data when its process ends.

## Read restore and clean up

Referenced cold segments remain. Once the last record is restored, Sweep can reclaim its segment.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'archive',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
await hot.putRecord({ createdAt: 0, value: 42 }, 'event:a')
await host.extensions.archiveRun()
console.log((await host.extensions.archiveSweep()).removed)
await host.extensions.archiveGet('event:a', { restore: true })
console.log((await hot.getRecord('event:a')) !== undefined)
console.log((await host.extensions.archiveSweep()).removed)
console.log((await host.extensions.archiveSweep()).removed)
```

Expected output:

```text
0
true
1
0
```

Get reads hot storage first. If absent, it reads the archive reference and segment. It validates complete gzip/NDJSON through EOF, then performs one bounded recheck of the hot value/reference. Finding the requested line is not enough to declare success. restore defaults to false. true restores in a hot transaction without overwriting a concurrent hot write. Missing values return undefined.

Map/Set use the collections codec. Bytes return its tagged portable representation. Date and functions are unsupported; archives are not arbitrary JavaScript-object snapshots.

Sweep uses native opaque blob pages within this plugin's prefix. It deletes only objects with matching format/version metadata and zero hot references. It does not scan every record manifest for every segment, delete referenced objects, or replace the blob backend's own native storage cleanup. scanned counts listed candidates; removed counts actual successful deletions. A repeated Sweep can return 0.

## Organizations and custom prefixes

With id history, the flat functions are historyRun, historyGet and historySweep. Organization views call them normally.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'history',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
const org = host.org('11111111-1111-4111-8111-111111111111')
await hot.putRecord({ createdAt: 0, value: 'root' }, 'event:a')
await org.backend('hot').putRecord({ createdAt: 0, value: 'tenant' }, 'event:a')
console.log((await org.extensions.historyRun()).archived)
console.log((await org.backend('hot').getRecord('event:a')) === undefined)
console.log((await hot.getRecord('event:a')) !== undefined)
console.log((await org.extensions.historyGet('event:a')) !== undefined)
```

Expected output:

```text
1
true
true
true
```

Operations use the invoking organization and project both hot/cold into it. Do not pass a different orgId in options; mismatched context rejects. Identical root and organization string keys remain separate. There is no host.backend('history') or extensions.history.run().

## Observe committed progress

afterArchiveRun observes a successful result; business code should still use returned progress.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [storageProbe(), memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'archive',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
host.extensions.observe('afterArchiveRun', (event) => console.log(event.archived))
await hot.putRecord({ createdAt: 0, value: 42 }, 'event:a')
const result = await host.extensions.archiveRun()
console.log(result.segments)
```

Expected output:

```text
1
1
```

archived/skipped/segments count only certainly committed results. A later failure does not roll those counts back. beforeArchiveRun provides the rule count and optional limit. onArchiveRunError provides committed progress and an available code. afterArchiveRestore reports restored; afterArchiveSweep reports scanned/removed. Hooks observe only. Throws/rejections are reported without changing the operation result.

## Arguments and failures

Run accepts rule, limit and operation context such as signal/timeoutMs/pageSize. Get adds restore; Sweep accepts only operation context. Cancellation stops later work while committed segments remain. Host shutdown waits for accepted physical work; early caller cancellation is not physical completion.

| source / code                                      | Meaning and action                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| storage.backend.archive / INVALID_OPTION           | Invalid installation configuration; fix IDs, backend references or rules.                               |
| storage.backend.archive / INVALID_ARGUMENT         | Invalid runtime key, rule name or limit.                                                                |
| storage.backend.archive / ARCHIVE_OPERATION_FAILED | An explicit operation failed; inspect cause and committed progress.                                     |
| storage.backend.archive / ARCHIVE_SEGMENT_INVALID  | Invalid cold segment/private metadata; the parsing failure remains reachable.                           |
| @migaia/storage-contract / UNSUPPORTED_CAPABILITY  | A backend lacks a required capability; IndexedDB cannot hold its transaction across arbitrary cold I/O. |

Native error classes and original errors remain reachable through cause/errors. Existing host/contract shutdown, conflict and coded-cancellation errors retain their objects. Archive-created Run failures carry progress. Nonextensible original conflicts do not receive extra fields; read committed progress from onArchiveRunError. Failure progress does not mean the whole job rolled back. Verify native state before replaying an unknown commit.

Hot storage needs records, iteration, transactions and the required control lock. Memory, SQLite and PostgreSQL support them; IndexedDB installation rejects before cold I/O. Cold storage needs blob and the runtime needs gzip support. Archive does not independently close drivers or hot/cold backends. Dispose the host through its normal shutdown path and release caller-managed connection pools through their actual client APIs.
