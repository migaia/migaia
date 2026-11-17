# @migaia/log-plugin-file

[中文](./README.md)

An output plugin that appends logs to a file, used with `@migaia/log-host`. By default each line is one JSON object (NDJSON), so log collectors can read it line by line; batching, formatting, retries and timeouts come from host Features. Node, Bun and Deno have a built-in default writer; browsers and other environments inject their own.

## Problems you may have seen

- **The file is opened once per log line**: under heavy logging, disk writes match the line count. The cause is no batching.
- **The last batch never reaches the file at exit**: buffered lines disappear with the process. The cause is not waiting for writes before exiting.

## Start here

The example injects a writer that only prints, instead of a real file. Run it directly with Node 24.

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { filePlugin } from '@migaia/log-plugin-file'

// This writer only prints; without writer, Node/Bun/Deno append to a real file
const writer = {
  async append(path: string, text: string) {
    const lines = text
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line).message)
    console.log(`append to ${path}: ${lines.join(', ')}`)
  },
  async rotate(path: string) {
    console.log(`rotate ${path}`)
  }
}
const log = createLogHost({
  plugins: [
    levelPlugin(),
    filePlugin({
      path: 'app.ndjson',
      writer,
      rotate: { maxEntries: 2 }, // rotate once a batch reaches 2 entries
      features: { batch: batchFeature({ maxSize: 2 }) } // write every 2 entries
    })
  ]
})
log.info('a')
log.info('b')
log.info('c')
await log.shutdown('manual')
```

Output:

```text
append to app.ndjson: a, b
rotate app.ndjson
append to app.ndjson: c
```

The first two entries form one batch written by a single `append`, and reaching the rotation threshold calls `rotate`. The third entry is written as the last batch during `shutdown()`.

## Common options

| Option                                  | Description                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `path`                                  | Required; passed to the writer unchanged                                                                               |
| `writer`                                | `append(path, text)` and optional `rotate(path)`; an explicit writer wins over the default                             |
| `rotate.maxEntries` / `rotate.maxBytes` | Rotate when one delivery's entry count or UTF-8 byte count reaches the threshold; a threshold requires `writer.rotate` |
| `features`                              | This output's policies, such as `batchFeature` or `formatFeature`                                                      |

## Contract details

- Each delivery joins the batch's texts with newlines, adds a trailing newline and calls `writer.append` once. `rotate` is called only after `append` succeeds. Rotation thresholds are counted per delivery batch, not across batches.
- Node and Bun append with `node:fs/promises` by default, Deno with `Deno.writeTextFile(..., { append: true })`. The browser and default entries do not load these modules and need an injected `writer`. The application prepares the target directory; the default writer cannot rotate.
- The error domain is `logging.file` (`LOG_FILE_ERROR_SOURCE`). An invalid path or rotation option (`INVALID_OPTION`) or no writer in the current environment (`FILE_SINK_UNAVAILABLE`) throws synchronously at creation. A failed `append` or `rotate` is reported as `DELIVERY_FAILED` with the original error in `cause`, through the host's failure channel; log methods do not throw because of it.
- Removing the plugin does not close an application-provided writer.
- `features` is a `{ name: feature }` record; controls appear on the host as `file_<name>_<method>`. For host-wide defaults and override rules see [Composing policies in log-host](../log-host/README.en.md#composing-policies).

See the [usage guide](./USEGUIDE.en.md) for all options and injection examples.
