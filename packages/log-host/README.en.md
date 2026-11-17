# @migaia/log-host

[中文](./README.md)

Writing a log line is easy. The hard parts are around it: does a slow log backend slow down your requests, where do unsent lines go when the process exits, and can a failing log service take your business code down with it? `@migaia/log-host` hands these to one host. Log calls return at once and entries go to each output plugin in the background, in order. On shutdown the host delivers what is queued before it releases resources. Delivery failures go to a separate failure channel instead of into your code. Console, HTTP, file, process shutdown and durable logs are separate plugin packages that you install as needed.

## Problems you may have seen

- **Logging slows down requests**: every log line awaits a network call, so when the log service is slow, your responses are slow too. The cause is logging on the request's critical path.
- **The last lines are lost at exit**: during a deploy or when a container is recycled, lines being sent or still buffered disappear, and those are the lines that explain why the process stopped. The cause is that nobody waits for logs before exiting.
- **A log service failure breaks the business code**: a failed log request becomes an unhandled Promise rejection, or lands in the business `try/catch`. The cause is that log failures and business failures share one path.
- **Every output reimplements batching and retries**: console, HTTP and file each have their own buffering, retry and timeout, with different rules, and a fix in one is missed in the others. The cause is that these policies have no single owner.

## Why choose it

- **Log calls do not wait for delivery, and nothing is lost on shutdown.** `info()` returns synchronously and the entry goes into a bounded queue (10000 entries by default). `shutdown()` stops accepting new lines, drains each output's queue and batches, then releases the plugins. [Example](./USEGUIDE.en.md#create-a-host)
- **Delivery failures stay out of your control flow without being swallowed.** Log methods, `flush()` and `shutdown()` never throw or reject because delivery failed. Failures go to `onFailure()` listeners, or to `report` when there is no listener. [Example](./USEGUIDE.en.md#errors-and-lifecycle)
- **The host provides batching, retry and timeout once, and each output can override them.** Declare default policies once in a policy plugin and every output inherits them. When one output needs a different batch size, write an entry with the same name in that output's own `features`. [Example](./USEGUIDE.en.md#output-scopes-and-delivery)
- **The whole cause chain of an error is kept.** The JSON format and the HTTP output share one error projection, so `source`, `code`, `stack`, `cause` and every `AggregateError` branch reach the log. [Example](./USEGUIDE.en.md#errors-and-lifecycle)

For a local script that prints a few lines and does not care about exit or failures, plain `console.log` is simpler.

## Start here

The example below uses a slow log backend: each write takes 50 ms. Run it directly with Node 24.

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'

// A slow log backend: each write takes 50 ms
const remote = defineOutputPlugin({
  name: 'remote',
  batchable: false,
  defaultFormat: 'plain',
  async deliver(records) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    for (const record of records) console.log(`backend received: ${record.entry.message}`)
  }
})

const log = createLogHost({ plugins: [levelPlugin(), remote] })
log.info('order created')
log.warn('stock is low')
console.log('log calls returned; the request goes on')

// Call before the process exits: deliver queued lines, then release the plugins
await log.shutdown('manual')
console.log('closed')
```

Output:

```text
log calls returned; the request goes on
backend received: order created
backend received: stock is low
closed
```

When `info()` and `warn()` return, the backend has received nothing yet, so the first line prints first. `shutdown()` completes only after both lines reach the backend. `levelPlugin()` adds `debug`, `info`, `warn`, `error` and `fatal` to the host; `defineOutputPlugin` declares an output, and `deliver` receives records that are already formatted.

Real projects usually install a ready-made output plugin, such as `consolePlugin()` from [`@migaia/log-plugin-console`](../log-plugin-console/README.en.md). Next: to add batching and retry to every output, see [Output scopes and delivery](./USEGUIDE.en.md#output-scopes-and-delivery); to finish logging automatically when the process receives an exit signal, see [`@migaia/log-plugin-process`](../log-plugin-process/README.en.md).

## Pitfalls when writing it yourself

Here is a common hand-written log function. It works, but it has three hidden problems (for illustration only; no need to run it):

```ts doc-test=check
async function sendLog(message: string) {
  await fetch('https://logs.example.invalid', { method: 'POST', body: JSON.stringify({ message }) })
}

// Problem 1: awaiting on the request path; when the log service is slow, every request is slow
await sendLog('order created')

// Problem 2: without await, a failed send is an unhandled Promise rejection,
// and lines still being sent are lost when the process exits
void sendLog('stock low')

// Problem 3: adding a file output means writing batching, retry and timeout again,
// and the two sets of rules soon drift apart
```

With log-host, a log call only puts the entry into the queue: delivery happens in the background, failures go to the failure channel, `shutdown()` delivers everything before exit, and the host provides batching and retry once.

## The three-minute model

A log entry goes through these steps from the call to its destination:

1. **entry**: runs once at the host entry, for example to add a UUID.
2. **gate**: each output decides whether it wants the entry, for example a level threshold or a custom filter.
3. **format**: turns the entry into text (`json` or `plain`). Outputs that do not consume text skip this step.
4. **batch / retry / timeout**: per output, buffer entries into batches, retry failures and limit how long one delivery may take.
5. **deliver**: the output plugin writes the records to their real destination.

| Concept                  | In one sentence                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| host                     | The object returned by `createLogHost`; it owns the queue, the plugins and shutdown                                                                   |
| Output plugin            | Where logs go; declare one with `defineOutputPlugin` or install a `log-plugin-*` package                                                              |
| Policy plugin            | `defineLogPlugin({ name, features })` declares host-wide default policies that every output inherits                                                  |
| Feature                  | One policy, such as `thresholdFeature()` or `batchFeature()`, written in a `features` record whose key is its name                                    |
| Override rule            | An entry with the same name in an output's own `features` overrides the host-wide one; each output takes at most one format, batch, retry and timeout |
| `flush()` / `shutdown()` | Wait (with a time limit) until accepted lines are delivered / deliver, then release the plugins; repeated calls share one Promise                     |
| Failure channel          | `onFailure()` listens for delivery failures; with no listener they go to the `report` passed to the host                                              |

## Common scenarios

| Scenario                                                      | How to combine                                   | Details                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Console output, colored in development and JSON in production | `consolePlugin()` + `formatFeature`              | [log-plugin-console](../log-plugin-console/README.en.md)                      |
| Send batches to a log service and retry failures              | `httpPlugin()` + `batchFeature` + `retryFeature` | [log-plugin-http](../log-plugin-http/README.en.md)                            |
| Append to a file and rotate it                                | `filePlugin()`                                   | [log-plugin-file](../log-plugin-file/README.en.md)                            |
| Deliver queued lines before exiting on a signal               | `processPlugin()`                                | [log-plugin-process](../log-plugin-process/README.en.md)                      |
| Filter by level and change the threshold at run time          | `thresholdFeature` + `filterFeature`             | [Levels and entry policies](./USEGUIDE.en.md#levels-and-entry-policies)       |
| Change the batch size of one output only                      | Same-name entry in that output's `features`      | [Output scopes and delivery](./USEGUIDE.en.md#output-scopes-and-delivery)     |
| Hand entries to another host                                  | `forwardPlugin({ targets })`                     | [Forwarding and configuration](./USEGUIDE.en.md#forwarding-and-configuration) |
| Record replayable business events, write-ahead and undo logs  | `binlogPlugin` / `walPlugin` / `undoLogPlugin`   | [log-plugin-durable](../log-plugin-durable/README.en.md)                      |

## Install

```bash
pnpm add @migaia/log-host
```

The host has no built-in output; install the `@migaia/log-plugin-*` packages you need. It has no third-party runtime dependency; its building blocks come from `@migaia/plugin-host`, `@migaia/middleware-pipeline`, `@migaia/lifecycle`, `@migaia/event-subscriber` and `@migaia/utils`.

## Common APIs

| API                                                               | Purpose                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `createLogHost({ plugins, report?, maxPending? })`                | Create a host                                                 |
| `levelPlugin()`                                                   | Add `debug` / `info` / `warn` / `error` / `fatal` / `atLevel` |
| `log.flush()` / `log.shutdown(reason)`                            | Wait for delivery / deliver, then close                       |
| `log.onFailure(listener)`                                         | Listen for delivery failures; returns an unsubscribe function |
| `defineLogPlugin({ name, features })`                             | Declare host-wide default policies (`@migaia/log-host/sdk`)   |
| `defineOutputPlugin({ name, batchable, defaultFormat, deliver })` | Declare an output (`@migaia/log-host/sdk`)                    |

Built-in Features: `thresholdFeature`, `filterFeature`, `uuidFeature`, `formatFeature`, `batchFeature`, `retryFeature` and `timeoutFeature`. Import them together from `@migaia/log-host/features`, or one by one from `@migaia/log-host/features/<name>`. See the [usage guide](./USEGUIDE.en.md) for the full API.

## Contract details

### Composing policies

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/sdk'
import { thresholdFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** Host-wide policies are every output's defaults; entry policies run once. */
const log = createLogHost({
  plugins: [
    defineLogPlugin({
      name: 'policy',
      features: {
        threshold: thresholdFeature({ level: 'info' }),
        uuid: uuidFeature({ display: false })
      }
    }),
    levelPlugin(),
    consolePlugin()
  ]
})
log.debug('below the threshold, filtered')
log.info('accepted')
await log.shutdown('manual')
```

Feature factories return native `@migaia/plugin-host` definitions and expose no internal fields or control methods. `features` is always a `{ name: feature }` record. Each plugin installation creates its own state; control methods appear on the host as `${pluginName}_${name}_${method}`, for example `log.policy_threshold_setLevel('warn')`.

An output plugin's `features` apply only to that output. A same-name entry in an output overrides the host-wide entry. Each output takes at most one format, batch, retry and timeout: when an output configures one of these kinds, it replaces the host-wide entry of that kind even under a different name. Gates with different names all run, even when they come from the same factory. An output can set a kind to `false` so it does not inherit the host-wide entry of that kind.

One plugin's record may hold at most one format, batch, retry and timeout; otherwise it is rejected with `logging / INVALID_OPTION`. Two host-wide policy plugins that each provide the same kind are rejected with `plugin.host / FEATURE_ROLE_CONFLICT`. These checks run when the plugin is installed (`createLogHost` or `use()`); the rejected batch rolls back and the host keeps logging. Without an explicit format, the output's `defaultFormat` applies.

An output can declare `consumesText: false` to receive only the raw entry and the abort signal and skip formatting; such an output cannot configure a format and omits `defaultFormat`.

### Errors and lifecycle

- Log methods never throw delivery errors; `flush()` and `shutdown()` always fulfill. Observe failures with `onFailure()`; with no listener they go to `report`.
- A listener that fails is reported as `HOOK_FAILED` with the original error in `cause`. A failing `report` is contained and never reported recursively.
- Invalid creation options throw synchronously with `source` and `code`. `use()` and `unUse()` are configuration operations and may reject.
- `flush()` waits at most 3000 ms by default; when the time is up it reports `LIFECYCLE_DEADLINE` and fulfills, which does not mean every line was delivered.
- At most 10000 entries wait by default; beyond that the oldest unprocessed entry is dropped and `QUEUE_OVERFLOW` is reported.
- Durable plugins' append, commit and read still reject under their storage contract; the "log methods never throw" guarantee does not cover these transactional operations.

### Entries

| Entry                              | Contents                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@migaia/log-host`                 | `createLogHost`, `levelPlugin`, `forwardPlugin`, status constants, the default reporter and host types |
| `@migaia/log-host/sdk`             | `defineLogFeature`, `defineLogPlugin`, `defineOutputPlugin`, `projectLogEntry` and plugin-author types |
| `@migaia/log-host/features`        | The seven built-in Features                                                                            |
| `@migaia/log-host/features/<name>` | One built-in Feature                                                                                   |
