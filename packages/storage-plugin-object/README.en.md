# @migaia/storage-plugin-object

Save attachments, exports and other binary content in a dedicated directory or S3 through the same `blob` API, then read complete bytes, a stream or a selected range. Choose a file or S3 driver and install the object plugin in a host to use organization isolation and disposable reads. Conditional writes require support from the selected driver and service; this package does not provide ordinary key-value storage or transactions.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Problems you may have seen

- Readers see a new data file before its metadata is updated because two writes become visible separately.
- Two requests overwrite a file from the same old version because checking and writing are unprotected.
- Reading a small section loads the entire file because the API has no range support.
- An interrupted download leaves a handle open because stream consumption and cleanup are separate.

## Why choose it

- The filesystem driver publishes content and metadata together; an open read keeps its original content. [Local files](./USEGUIDE.en.md#local-files-and-conditional-writes)
- `get()` returns a disposable object with a choice of `bytes()` or `stream()` and inclusive byte ranges. [Streams and ranges](./USEGUIDE.en.md#streams-and-range-reads)
- S3 distinguishes failed writes, unknown commits and failures reading metadata after a write, helping recovery decisions. [S3](./USEGUIDE.en.md#use-s3)
- Organization views separate logical keys, and page cursors are tied to organization and prefix. [Organizations and pages](./USEGUIDE.en.md#organizations-and-pagination)

## Start here

Use a directory dedicated to this plugin. This example writes `hello` and reads it from the actual filesystem.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './example-objects' }) })]
})
try {
  const objects = host.backend('object').use(blob)
  await objects.put('greeting', new TextEncoder().encode('hello'))
  const object = await objects.get('greeting')
  if (object) {
    try {
      console.log(new TextDecoder().decode(await object.bytes()))
    } finally {
      // hello
      await object.dispose()
    }
  }
  await objects.remove('greeting')
} finally {
  await host.dispose()
}
```

Expected output:

```text
hello
```

## Pitfalls when writing it yourself

Direct file writes save bytes, but metadata and concurrent updates need additional coordination:

```ts doc-test=check
import { writeFile, readFile } from 'node:fs/promises'

await writeFile('./example.bin', new Uint8Array([1, 2, 3])) // Other requests may read mid-write.
await writeFile('./example.meta', JSON.stringify({ size: 3 })) // Published separately from content.
console.log(await readFile('./example.bin')) // Full read; no range or etag condition.
```

## The three-minute model

`choose fs/S3 driver → install objectBackendPlugin → use(blob) → put/get → release reads and host`.

| Term          | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| Key           | An application key, not a file path within the directory                  |
| `IBlobInfo`   | Full size, etag, content type, metadata and update time                   |
| `IBlobObject` | Content from one read, together with cleanup                              |
| Etag          | A backend identifier to pass back for conditional writes; do not parse it |
| Driver        | Configuration selecting a directory or S3 client                          |

## Common scenarios

| Need                                                 | Composition              | Example                                                                     |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Local attachments without overwriting another update | fs + `ifMatch`           | [Files and conditions](./USEGUIDE.en.md#local-files-and-conditional-writes) |
| Large files or partial content                       | Stream + range           | [Streams and ranges](./USEGUIDE.en.md#streams-and-range-reads)              |
| S3 or a compatible service                           | s3 driver                | [S3](./USEGUIDE.en.md#use-s3)                                               |
| Upload or download links                             | Presign Feature, S3 only | [Signed links](./USEGUIDE.en.md#create-signed-links)                        |
| Organization attachments and paging                  | host org + blob list     | [Organizations and pages](./USEGUIDE.en.md#organizations-and-pagination)    |

## Install

These storage packages are currently `private: true` workspace packages in this repository, not published registry packages. Add them from a consuming package inside the workspace:

```bash
pnpm add --workspace @migaia/storage-plugin-object @migaia/storage-host @migaia/storage-contract
pnpm add @aws-sdk/client-s3@^3.1140.0 @aws-sdk/s3-request-presigner@^3.1140.0
```

The SDK packages are declared native peers. `/fs` selects a Node, Bun or Deno file adapter. Use `/s3` for S3 and `/features/presign` for signing. The root plugin factory does not open directories or construct clients; installation opens resources. The package declares Node.js `>=24`.

## Common APIs

| API                                                    | Purpose                                            |
| ------------------------------------------------------ | -------------------------------------------------- |
| `objectBackendPlugin({ id?, driver }, features?)`      | Install a backend, default ID `object`             |
| `fsObjectDriver({ root })` / `s3ObjectDriver(options)` | Choose a directory or S3                           |
| `store.use(blob).put/get/head`                         | Write content, open a read, or inspect metadata    |
| `object.bytes()` / `stream()` / `dispose()`            | Consume content once and release it                |
| `remove` / `removeByPrefix` / `list`                   | Delete or page through this organization's objects |
| `objectPresignFeature()`                               | Explicitly select S3 signing APIs                  |

## Behavior to know

- This backend provides blob, not ordinary KV or transactions. Logical keys are strings, including the empty string. Metadata values are strings; S3 additionally requires lowercase HTTP-token names and ASCII header values without line breaks.
- A real directory supports one writer instance in the current process. Sharing it across processes is unsupported. Keep it trusted and dedicated, without unrelated application files. Filesystem updates provide atomic visibility, not fsync-level power-loss durability. File etags are SHA-256 content hashes: the same bytes may retain an etag, so it is not an incrementing update version.
- Missing `get/head` returns `undefined`. `remove` reports whether it observed an object before deleting. `stream/bytes` share one consumption right. EOF or cancellation releases the read; explicitly dispose unread or abandoned objects.
- Range `start/end` are nonnegative safe integers; end is inclusive and optional. `info.size` remains the full size. A start beyond the content returns empty bytes, not an absent object.
- `ifMatch` and `ifNoneMatch: true` are mutually exclusive. Failed conditions use `WRITE_CONFLICT`. S3 conditions require detection support and reject with `UNSUPPORTED_CAPABILITY` when unavailable, without falling back to unconditional writes.
- Object errors use `source: 'storage.backend.object'`. `OBJECT_DATA_INVALID` means corrupt data or incomplete responses; `OBJECT_COMMIT_UNKNOWN` means commit confirmation is unknown. `OBJECT_FAILED` may include `committed: true` when writing succeeded but follow-up metadata reading failed. Inspect state before retrying.
- `host.org(uuid).backend('object').use(blob)` separates organizations. Host shutdown releases read resources and S3 clients created from config. A caller-supplied `S3Client` is always borrowed and must be closed by its caller.
