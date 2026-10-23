# Object storage backend

`@migaia/storage-plugin-object` supplies the shared `blob` capability through a native filesystem or an S3-compatible service. The root factory does not load the SDK or open a directory. Install the real peers `@migaia/storage-host`, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

await using host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './objects' }) })] as const
})
const objects = host.backend('object').use(blob)
const info = await objects.put('photo', new Uint8Array([1, 2, 3]), {
  contentType: 'application/octet-stream',
  metadata: { owner: 'ada' }
})
const object = await objects.get('photo', { range: { start: 1, end: 2 } })
if (object) {
  try {
    console.log(object.info.size, await object.bytes())
  } finally {
    await object.dispose()
  }
}
await objects.put('photo', new Uint8Array([4]), { ifMatch: info.etag })
```

The filesystem entry detects Node, Bun or Deno and loads only that runtime's native adapter. One real directory has one writer instance per process. Do not share it between processes or mix unrelated files into it. A pointer rename publishes immutable data and metadata together. Open reads retain their original generation after replacement or removal. SHA-256 identifies content; a same-content write may retain its etag. This is atomic visibility, without an fsync durability guarantee.

`get` returns one content snapshot. Choose `stream()` or `bytes()` once. EOF and cancel release the underlying resource; always dispose an unconsumed object. Range end is inclusive, and `info.size` remains the full size. Missing get/head return undefined; remove returns whether an object was observed before deletion.

## S3

```ts
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'
import { objectPresignFeature } from '@migaia/storage-plugin-object/features/presign'

const plugin = objectBackendPlugin(
  {
    driver: s3ObjectDriver({
      config: { region: 'us-east-1', endpoint: 'http://127.0.0.1:19000', forcePathStyle: true },
      bucket: 'objects',
      prefix: 'app/'
    })
  },
  { presign: objectPresignFeature() }
)
```

An injected `client` is borrowed and never destroyed. A `config` creates an owned client during installation. Credentials follow the SDK's ordinary providers. Service detection uses a reserved random probe object to verify single-put conditional writes. Permission failure or unsupported conditions are reported without failing host creation; unconditional operations retain their native permission behavior. Conditional multipart support is determined by its actual completion request and never downgraded.

Unknown-length streams and byte values at least 16 MiB use multipart. Defaults are 8 MiB per part and four outstanding parts. The buffer bound is five part buffers plus the current input chunk. Modification commands disable SDK retries and regional redirects locally; the borrowed client's configuration is unchanged. An unknown dispatched commit reports `OBJECT_COMMIT_UNKNOWN`; inspect head before replaying. A confirmed put whose metadata follow-up fails reports `OBJECT_FAILED` with `committed: true`.

S3 metadata names must be lowercase HTTP tokens; values use ASCII header bytes without newlines. Etag is opaque and updatedAt comes from native LastModified. Signed uploads return every content, metadata and condition header that the caller must send. Expiry is integer seconds from 1 through 604800, default 900, and cannot outlive the credentials. Signing executes no upload or download.

## Organization and paging

Use `host.org(orgId).backend('object').use(blob)` for an immutable organization view. The host creates no registry data on first write. Physical keys use the shared organization tuple and ordered-key encoder; returned keys remain logical. `list({ prefix, limit, after })` defaults to 100 items in UTF-16 lexical order. Cursors bind one backend installation, organization and prefix. Listings have no cross-page snapshot. `removeByPrefix('')` clears only that organization. Cache and archive consume `blob` through the host and do not depend on driver files.
