# @migaia/log-plugin-reasoning

[中文](./README.md)

Adds two streaming phases, thinking and response, to `@migaia/log-host`, for content that arrives a piece at a time, such as large-model output. Each fragment is written as soon as it arrives, so users see it live; when a phase ends, other outputs receive one structured entry with the full text for audit and search.

## Problems you may have seen

- **Streamed output is either live or searchable, never both**: logging each fragment leaves hundreds of pieces in the log system; logging only at the end makes users wait for everything. The cause is mixing the stream for people with the record for systems in one output.
- **The console shows the same text twice**: the fragments were already printed, and the console prints the full record again. The cause is that the full record is not marked as "do not show again".

## Start here

```ts doc-test=run
import { createLogHost } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

// Streamed fragments land here; without write they go to stdout
const streamed: string[] = []
// Another output stands for the audit log; it gets only each phase's full text
const audit = defineOutputPlugin({
  name: 'audit',
  batchable: false,
  defaultFormat: 'plain',
  deliver(records) {
    for (const { entry } of records) console.log(`audit ${entry.tag}: ${entry.message}`)
  }
})
const log = createLogHost({
  plugins: [reasoningPlugin({ write: (text) => streamed.push(text) }), audit]
})
log.startThinking()
log.thinking('check stock, ')
log.thinking('then shipping')
log.endThinking()
log.startResponse()
log.response('It ships today.')
log.endResponse()
await log.shutdown('manual')
console.log('streamed fragments:', JSON.stringify(streamed))
```

Output:

```text
audit thinking: check stock, then shipping
audit response: It ships today.
streamed fragments: ["Thinking...\n\n","check stock, ","then shipping","\n\n","It ships today.","\n"]
```

Fragments are written as soon as `thinking()` / `response()` are called, together with the phase title and line breaks; the audit output receives one full record only when each phase ends.

## Common APIs

| API                                                          | Description                                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `reasoningPlugin({ write?, asyncOutput? })`                  | `write` receives raw text without colors; without it, text goes to the detected stdout, or `console.log` when there is none |
| `startThinking(label?)` / `thinking(text)` / `endThinking()` | Thinking phase                                                                                                              |
| `startResponse(label?)` / `response(text)` / `endResponse()` | Response phase                                                                                                              |

## Contract details

- The full record sent when a phase ends has the tag `thinking` or `response`, with `reasoningPhase` and `silent: true` in `data`. The console plugin skips `silent` entries to avoid showing them twice; HTTP, file and other outputs receive the full text as usual.
- `asyncOutput` defaults to `false`; when enabled, streamed writes and full-record dispatch are scheduled and tracked by the host, and `flush()` waits for them.
- A synchronous error thrown by `write` goes to the host's failure channel. Removing the plugin discards an unfinished phase's buffer without sending a full record.
- This plugin does not depend on the console plugin and does not need the host's `raw`.

See the [usage guide](./USEGUIDE.en.md) for phase rules and options.
