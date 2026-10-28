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
    filePlugin({ path: './application.ndjson', features: [batchFeature({ maxSize: 20 })] })
  ]
})
log.info('request completed', { requestId: 'r1' })
await log.shutdown('manual')
```

Node and Bun append through their native `node:fs/promises` implementation. Deno uses `Deno.writeTextFile(..., { append: true })`. The browser/default entry requires an injected `writer` and imports no native filesystem module. The application prepares the destination directory.

`filePlugin({ path, writer?, rotate?, features? })` validates its options during creation. Native writers do not implement rotation. Setting `rotate.maxBytes` or `rotate.maxEntries` requires an injected `rotate(path)` method. Thresholds apply to each delivered batch.

Delivery failures reach the host's `onFailure` channel as `logging.file / DELIVERY_FAILED`, with the original writer error on `cause`. Invalid configuration and missing writers can throw synchronously during creation. The package's peer version must match the host version.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for options and writer injection.
