# @migaia/storage-plugin-archive

Move rarely read records out of the storage used for everyday updates and into blob storage, while keeping reads by original key and an explicit restore operation. Connect the plugin to installed hot and object backends, then run archive rules when your application chooses. Each segment commits separately; the whole archive job is not a transaction across both stores.

## Sound familiar?

- Hot tables grow, but deleting old records makes historical queries lose data.
- A record changes after archive upload, so deleting the earlier snapshot would lose the new value.
- An archive job fails halfway through without showing what already committed.
- Cold objects remain after restoration because there is no way to tell which ones are still referenced.

## Why choose it?

- After upload, it rereads hot values and moves only unchanged records that still match. See [Archive by retention time](./USEGUIDE.en.md#archive-by-retention-time).
- Reads prefer hot values; explicit restore does not overwrite concurrent hot writes. See [Read restore and clean up](./USEGUIDE.en.md#read-restore-and-clean-up).
- Progress includes only certainly committed records and segments. See [Observe committed progress](./USEGUIDE.en.md#observe-committed-progress).
- Explicit sweep removes only this plugin's unreferenced archive objects. See [Read restore and clean up](./USEGUIDE.en.md#read-restore-and-clean-up).

## Start here

Use real in-memory records and blobs to demonstrate the whole flow. Choose persistent backends for production data.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
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
console.log((await host.extensions.archiveRun()).archived)
console.log((await hot.getRecord('event:a')) === undefined)
console.log((await host.extensions.archiveGet('event:a')) !== undefined)
```

Expected output:

```text
1
true
true
```

For age-based selection, read [Archive by retention time](./USEGUIDE.en.md#archive-by-retention-time). To bring data back, read [Read restore and clean up](./USEGUIDE.en.md#read-restore-and-clean-up).

## What hand-written code gets wrong

Upload-then-delete looks simple, but it is not one atomic operation across two stores. This example is shown without execution.

```ts doc-test=check
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { blob } from '@migaia/storage-contract'

await using host = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const hot = host.backend('hot')
const value = await hot.getRecord('event:a')
await host
  .backend('cold')
  .use(blob)
  .put('archive:a', new TextEncoder().encode(JSON.stringify(value)))
// Pitfall: a newer hot value may have appeared during upload.
await hot.deleteRecord('event:a')
// Pitfall: a failure here has no manifest for read-through or orphan cleanup.
```

After upload, archive uses the hot transaction to compare records, commit references and delete only eligible originals. It does not pretend that the entire job is a cross-store transaction.

## The model in three minutes

| Name              | Meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| hot               | A backend with records, iteration, transactions and the required control lock. |
| cold              | A blob backend.                                                                |
| rule              | A string-key prefix, business condition and retention duration.                |
| segment           | An immutable gzip NDJSON object containing records.                            |
| Run / Get / Sweep | Explicit movement, read/restore by key, and unreferenced-object cleanup.       |

Publish hot/cold first, then call host.use(archivePlugin(...)) and detect. Operations use the current host organization. The plugin id sets function prefixes; it creates no backend slot.

## Typical scenarios

| Scenario                           | Building blocks           | Details                                                                                 |
| ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| Archive events older than a day    | rule + archiveRun         | [Archive by retention time](./USEGUIDE.en.md#archive-by-retention-time)                 |
| Read history and restore on demand | archiveGet + archiveSweep | [Read restore and clean up](./USEGUIDE.en.md#read-restore-and-clean-up)                 |
| Share rules across organizations   | host.org + historyRun/Get | [Organizations and custom prefixes](./USEGUIDE.en.md#organizations-and-custom-prefixes) |
| Monitor a partially completed job  | probe plugin + progress   | [Observe committed progress](./USEGUIDE.en.md#observe-committed-progress)               |

## Install

The package is currently private: true for this repository's workspace. Do not assume a registry release. From an application in the same workspace:

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-archive
```

Use Node.js 24 or later with gzip CompressionStream/DecompressionStream. The in-memory example needs no additional peer. For PostgreSQL, SQLite or object storage, install the corresponding workspace plugin and its real driver dependencies.

## Essential API

| API                                         | Purpose                                             |
| ------------------------------------------- | --------------------------------------------------- |
| `archivePlugin({id, hot, cold, rules})`     | Install an ordinary extension.                      |
| `host.extensions.archiveRun(options?)`      | Move matching records and return progress.          |
| `host.extensions.archiveGet(key, options?)` | Read a hot/archived value, optionally restoring it. |
| `host.extensions.archiveSweep(ctx?)`        | Remove unreferenced archive objects.                |
| `host.org(id).extensions`                   | Call the same flat functions for an organization.   |

## Contract details

With id archive, the functions are archiveRun, archiveGet and archiveSweep. With id history, they are historyRun, historyGet and historySweep. There is no nested archive object or extension-specific dispose.

Memory, SQLite and PostgreSQL can supply hot storage. IndexedDB cannot perform cold I/O during its transaction and rejects installation before cold I/O. Cold storage must supply blob. The plugin creates no drivers and does not replace hot transactions or independently close borrowed backends.

Segments commit separately; later failures do not roll back earlier segments. Explicit Sweep removes unreferenced cold objects. Get does not restore by default. Sweep neither archives nor deletes records by age. Error source is storage.backend.archive. See the [usage guide](./USEGUIDE.en.md) for rules, cancellation and failure progress.

## Migrating nested extension calls

Earlier drafts used `host.extensions.archive.run()`, `.get()` and `.sweep()`. Replace them with `host.extensions.archiveRun()`, `archiveGet()` and `archiveSweep()`. An `id: 'history'` configuration uses `historyRun`, `historyGet` and `historySweep`. Organization views expose the same flat functions through `host.org(id).extensions`. Arguments and results retain each operation's contract. There is no old nested object or compatibility alias; the host still owns resource cleanup.
