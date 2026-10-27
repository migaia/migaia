# Object storage usage guide

[中文](./USEGUIDE.md) · [Overview and installation](./README.en.md)

| Your task                                         | Start here                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Save local content and protect overwrites         | [Local files and conditional writes](#local-files-and-conditional-writes) |
| Avoid reading a whole large file into memory      | [Streams and range reads](#streams-and-range-reads)                       |
| Use a remote bucket and multipart uploads         | [Use S3](#use-s3)                                                         |
| Let a client upload or download directly          | [Create signed links](#create-signed-links)                               |
| Separate organization files and page through keys | [Organizations and pagination](#organizations-and-pagination)             |
| Decide whether a failed write can be retried      | [Errors and shutdown](#errors-and-shutdown)                               |

## Local files and conditional writes

`root` is a nonempty path to a dedicated directory. This example writes and reads content, then overwrites only while its etag still matches.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './guide-objects' }) })]
})
try {
  const objects = host.backend('object').use(blob)
  const info = await objects.put('photo', new Uint8Array([1, 2, 3]), {
    contentType: 'application/octet-stream',
    metadata: { author: 'ada' }
  })
  const object = await objects.get('photo')
  if (object) {
    try {
      console.log([...(await object.bytes())])
    } finally {
      // [1, 2, 3]
      await object.dispose()
    }
  }
  await objects.put('photo', new Uint8Array([4]), { ifMatch: info.etag })
  console.log((await objects.head('photo'))?.size) // 1
  await objects.remove('photo')
} finally {
  await host.dispose()
}
```

`ifNoneMatch: true` creates only if absent; `ifMatch: etag` writes only when the current identifier matches. They are mutually exclusive. A failed condition uses contract `WRITE_CONFLICT` without overwriting existing content. Pass the etag back unchanged. Filesystem etags are content hashes, so writing the same bytes may leave the etag unchanged; it cannot detect every metadata-only update.

The filesystem driver supports Node, Bun and Deno, selecting an adapter during installation. A real directory allows one writer in this process and cannot be shared by writing processes. Keep it trusted and dedicated because the plugin may reclaim its unfinished files. A single pointer replacement publishes bytes and metadata together; open read objects retain their content after overwrite or deletion. This does not provide power-loss durability or cross-process locking.

## Streams and range reads

Uploads accept `Uint8Array` or an unlocked `ReadableStream<Uint8Array>`; chunks must be byte arrays. Upload four bytes from a stream, then read inclusive range `[1, 2]`:

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './guide-streams' }) })]
})
try {
  const objects = host.backend('object').use(blob)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([10, 20, 30, 40]))
      controller.close()
    }
  })
  await objects.put('sample', body)
  const object = await objects.get('sample', { range: { start: 1, end: 2 } })
  if (object) {
    try {
      console.log(object.info.size) // 4
      console.log([...(await object.bytes())]) // [20, 30]
    } finally {
      await object.dispose()
    }
  }
  await objects.remove('sample')
} finally {
  await host.dispose()
}
```

Omit `end` to read through EOF; ends beyond EOF are clipped. A start beyond the size or an empty object returns an empty stream. `info.size` still describes the full object. For continuous consumption use `object.stream().pipeTo(destination)`, then do not call `bytes()`. Both share one consumption right; consuming again rejects. `bytes()` collects the selected content and suits reads with bounded size.

EOF, stream errors and cancellation release the native read. Use `finally` or `await using` for unread objects, early exits and failures. Do not give one object to multiple independent consumers. Provide cancellation and timeout through `options.ctx`; stream producers must cooperate with cancellation rather than block indefinitely.

## Use S3

Create a bucket and configure credentials the SDK can resolve. This example assumes an `application-objects` bucket in `us-east-1` and uses the SDK's default credential chain rather than hard-coded secrets.

```ts doc-test=check
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'

const host = await createStorageHost({
  plugins: [
    objectBackendPlugin({
      driver: s3ObjectDriver({
        config: { region: 'us-east-1' },
        bucket: 'application-objects',
        prefix: 'guide/'
      })
    })
  ]
})
try {
  const objects = host.backend('object').use(blob)
  await objects.put('report', new TextEncoder().encode('ready'), { contentType: 'text/plain' })
  const object = await objects.get('report')
  if (object) {
    try {
      console.log(new TextDecoder().decode(await object.bytes()))
    } finally {
      // ready
      await object.dispose()
    }
  }
  await objects.remove('report')
} finally {
  await host.dispose()
}
```

For compatible services, set `endpoint` and `forcePathStyle` in `config`. Choose exactly one of `client` and `config`. A supplied client is borrowed and never destroyed by the host; config creates a client during installation and destroys it during shutdown. `prefix` defaults to `''`. Logical keys are also encoded for organizations, so do not assume they equal raw bucket object names.

| Upload option             | Default and range                                          |
| ------------------------- | ---------------------------------------------------------- |
| `multipartThresholdBytes` | `16777216` (16 MiB), positive safe integer                 |
| `partBytes`               | `8388608` (8 MiB), safe integer at least `5242880` (5 MiB) |
| `partConcurrency`         | `4`, positive safe integer                                 |

Unknown-length streams and byte arrays at or above the threshold use multipart. Default buffering is bounded by five parts plus the current input chunk. Failed uploads attempt to clean up incomplete multipart state; cleanup failures reach the host report callback. Mutation requests locally disable SDK retries and region redirects without changing the supplied client's global settings, avoiding automatic replay of uncertain commits.

Default environment detection starts with `HeadBucket`; failure prevents host creation. It then writes and deletes random probe objects under a reserved prefix to check conditions. Missing probe permissions or unsupported conditions are reported and leave conditional writes unavailable, rather than treating unconditional writes as conditional success. Actual unconditional operations still require service permissions. Conditional multipart also requires conditions on the final Complete request; unsupported services reject without fallback.

S3 metadata names must be lowercase HTTP tokens, and values must be ASCII without line breaks. Content type must also be a valid header value. Etags are opaque; updatedAt comes from native LastModified. Range reads verify Content-Range and length; incomplete responses are failures, not missing objects.

## Create signed links

Signing is S3-only and requires explicit `objectPresignFeature()` selection. Generate an upload request constrained by content type; signing itself does not upload data.

```ts doc-test=check
import { createStorageHost } from '@migaia/storage-host'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'
import { objectPresignFeature } from '@migaia/storage-plugin-object/features/presign'

const host = await createStorageHost({
  plugins: [
    objectBackendPlugin(
      {
        driver: s3ObjectDriver({ config: { region: 'us-east-1' }, bucket: 'application-objects' })
      },
      { presign: objectPresignFeature() }
    )
  ]
})
try {
  const signing = host.backend('object').api.presign
  const upload = await signing.upload('avatar', {
    expiresInSeconds: 300,
    contentType: 'image/png',
    metadata: { author: 'ada' }
  })
  console.log(upload.method, upload.headers) // PUT and required request headers
  const download = await signing.download('avatar', { expiresInSeconds: 300 })
  console.log(download.method) // GET
} finally {
  await host.dispose()
}
```

Give the actual HTTP client the returned `url`, `method` and every header. Omitting content, metadata, condition or range headers changes the signed request. `expiresInSeconds` accepts integer seconds from `1` to `604800`, defaulting to `900`. Actual validity cannot exceed credential expiry. Uploads support the same conditions as `put`; downloads support inclusive ranges. Keep temporary signed URLs out of public logs.

## Organizations and pagination

Write two objects inside a new organization, then page with the returned cursor. Do not construct cursors or reuse them across organizations.

```ts doc-test=run
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [
    objectBackendPlugin({
      driver: fsObjectDriver({ root: './guide-organizations' })
    })
  ]
})
try {
  const orgId = createOrgId()
  const objects = host.org(orgId).backend('object').use(blob)
  await objects.put('photos/a', new Uint8Array([1]))
  await objects.put('photos/b', new Uint8Array([2]))
  let after: string | undefined
  do {
    const page = await objects.list({ prefix: 'photos/', limit: 1, after })
    console.log(page.items.map((item) => item.key)) // photos/a, then photos/b
    after = page.next
  } while (after !== undefined)
  await host.dropOrg(orgId)
} finally {
  await host.dispose()
}
```

`list` defaults to prefix `''` and limit `100`. Limit must be a positive safe integer. Keys use UTF-16 lexical order; cursors bind to one installation, organization and prefix. Paging is not a snapshot across pages: concurrent writes can change later results. `removeByPrefix('')` clears only this organization and counts observed removals; it is not a cross-object transaction.

## Errors and shutdown

| Error                             | Meaning and action                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Contract `INVALID_ARGUMENT`       | Correct keys, bodies, ranges, conditions or headers                                      |
| Contract `WRITE_CONFLICT`         | Etag condition failed; reread and decide how to merge                                    |
| Contract `UNSUPPORTED_CAPABILITY` | The driver, condition or Feature does not support this combination                       |
| `OBJECT_DATA_INVALID`             | Stored data or a service response is incomplete; do not treat it as absent               |
| `OBJECT_COMMIT_UNKNOWN`           | Commit was sent but confirmation is unknown; inspect head/content before replaying       |
| `OBJECT_FAILED`                   | Inspect cause; `committed: true` means the write succeeded and metadata follow-up failed |

Object errors use `source: 'storage.backend.object'`; shared validation and condition errors come from `storage.contract`. Retain causes for diagnosis. Explicit cleanup rejects on failure; resource syntax reports cleanup failures to preserve a primary error. Release read objects before closing the host. Supplied S3 clients remain yours to close. Shutdown does not delete stored content.
