# File output guide

## Installation and defaults

Install matching versions of `@migaia/log-host` and `@migaia/log-plugin-file`. Add `filePlugin({ path })` to `createLogHost` plugins, together with `levelPlugin()` when level methods are needed. Default JSON uses the host's canonical error projection, retaining public error chains without serializing private fields on the raw Error.

Each delivery joins the formatted records with newlines, appends a final newline and calls `writer.append(path, text)` once. Default JSON therefore produces NDJSON. An explicit custom format changes the line contents; the plugin does not serialize them again. `flush()` drains admitted work. Await `shutdown()` when the application finishes.

## Injecting a writer

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { filePlugin } from '@migaia/log-plugin-file'

/** The application owns this writer; uninstall never closes it. */
class MemoryWriter {
  /** Retain complete append batches for the application's chosen storage. */
  readonly writes: { path: string; text: string }[] = []
  /** Resolution acknowledges that the writer accepted this batch. */
  async append(path: string, text: string): Promise<void> {
    this.writes.push({ path, text })
  }
}

/** An explicit capability works in both browser and server conditions. */
const writer = new MemoryWriter()
/** The host owns buffering and draining for this output's batch policy. */
const log = createLogHost({
  plugins: [
    levelPlugin(),
    filePlugin({
      path: 'application.ndjson',
      writer,
      features: { batch: batchFeature({ maxSize: 2 }) }
    })
  ]
})
log.info('first')
log.info('second')
await log.flush()
await log.shutdown('manual')
```

Writers provide `append(path, text): Promise<void>` and optionally `rotate(path): Promise<void>`. The application owns their resources and prepares destination directories. The plugin only borrows the methods.

## Options and rotation

| Option              | Behavior                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| `path`              | Required nonempty string, passed unchanged to the writer                 |
| `writer`            | Explicit capability takes precedence over native defaults                |
| `features`          | Output-level host policies for format, batching, retry and timeout       |
| `rotate.maxEntries` | Positive integer; rotate when this delivery reaches the entry count      |
| `rotate.maxBytes`   | Positive integer; rotate when this delivery reaches the UTF-8 byte count |

Either threshold triggers rotation. Append must succeed before rotate is called. Counts do not accumulate across batches. Native writers have no rotate method; configuring a threshold without `writer.rotate` fails during creation.

Node/Bun load `node:fs/promises.appendFile` dynamically. Deno uses native `Deno.writeTextFile` with append enabled. Browser/default condition entries import none of these native modules and require an injected writer.

## Errors and shutdown

The source is `LOG_FILE_ERROR_SOURCE` (`logging.file`). `INVALID_OPTION` identifies invalid path or rotation options. `FILE_SINK_UNAVAILABLE` identifies a missing writer. Both can throw synchronously during creation. `DELIVERY_FAILED` identifies append or rotation failure and retains the original error on `cause`. Observe it through the host's `onFailure` channel; logging calls do not throw delivery failures. Uninstall leaves application-owned writers open.

`features` uses the native plugin-host record form `{ alias: feature }`. Each feature is an opaque `defineFeature` token; the plugin installs it and exposes its controls as `file_alias_method` extensions on the host and plugin handle. Runtime state belongs to each installation. For example, a `threshold` alias exposes `file_threshold_setLevel`. Host-wide defaults are declared by a non-output `defineLogPlugin({ name, features })` from `@migaia/log-host/plugin`, passed in `createLogHost({ plugins: [...] })`; an output feature overrides only the same host-wide record key. Gates under different keys both apply. A repeated host-wide key is a conflict. At actual installation, each output checks the merged policies after key overrides: at most one format and one each of batch, retry and timeout, rejecting a collision with the existing `INVALID_OPTION`. `createLogHost({ features })` and feature arrays are no longer supported.
