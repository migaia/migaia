# @migaia/log-plugin-file

File output for `@migaia/log-host`. Entries use NDJSON by default. Host features own batching, formatting, retry and timeout policy.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { filePlugin } from '@migaia/log-plugin-file'

/** The host drains admitted work before releasing the output plugin. */
const log = createLogHost({
  plugins: [
    levelPlugin(),
    filePlugin({ path: './application.ndjson', features: { batch: batchFeature({ maxSize: 20 }) } })
  ]
})
log.info('request completed', { requestId: 'r1' })
await log.shutdown('manual')
```

Node and Bun append through their native `node:fs/promises` implementation. Deno uses `Deno.writeTextFile(..., { append: true })`. The browser/default entry requires an injected `writer` and imports no native filesystem module. The application prepares the destination directory.

`filePlugin({ path, writer?, rotate?, features? })` validates its options during creation. Native writers do not implement rotation. Setting `rotate.maxBytes` or `rotate.maxEntries` requires an injected `rotate(path)` method. Thresholds apply to each delivered batch.

Delivery failures reach the host's `onFailure` channel as `logging.file / DELIVERY_FAILED`, with the original writer error on `cause`. Invalid configuration and missing writers can throw synchronously during creation. The package's peer version must match the host version.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for options and writer injection.

`features` uses the native plugin-host record form `{ alias: feature }`. Each feature is an opaque `defineFeature` token; the plugin installs it and exposes its controls as `file_alias_method` extensions on the host and plugin handle. Runtime state belongs to each installation. For example, a `threshold` alias exposes `file_threshold_setLevel`. Host-wide defaults are declared by a non-output `defineLogPlugin({ name, features })` from `@migaia/log-host/plugin`, passed in `createLogHost({ plugins: [...] })`; an output feature overrides only the same host-wide record key. Gates under different keys both apply. A repeated host-wide key is a conflict. At actual installation, each output checks the merged policies after key overrides: at most one format and one each of batch, retry and timeout, rejecting a collision with the existing `INVALID_OPTION`. `createLogHost({ features })` and feature arrays are no longer supported.
