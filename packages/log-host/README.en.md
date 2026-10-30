# @migaia/log-host

An asynchronous logging host. Log calls return synchronously; entries then pass through an ordered asynchronous pipeline and output policies. Separate plugins provide console, HTTP, file, process shutdown, reasoning and durable logging.

## Quick start

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin } from '@migaia/log-plugin-console'

/** The host owns plugin installation, delivery and terminal cleanup. */
const log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })
log.info('request completed', { requestId: 'r1' })
await log.flush()
await log.shutdown('manual')
```

Output has not started when `info()` returns. `flush()` drains admitted entries, tracked asynchronous work and plugin buffers within a default 3000 ms wait budget. `shutdown()` runs final-log handlers, closes admission, drains and releases plugins. Concurrent shutdown calls share the same Promise.

## Compose policies

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/plugin'
import { thresholdFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** Host policies are output defaults; entry enrichment executes once per entry. */
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
log.debug('filtered by this output')
log.info('accepted')
await log.shutdown('manual')
```

Built-ins are `thresholdFeature`, `filterFeature`, `uuidFeature`, `formatFeature`, `batchFeature`, `retryFeature` and `timeoutFeature`. Import them together from `./features` or use individual default exports such as `./features/retry`.

Feature factories return opaque native `@migaia/plugin-host` definitions without descriptor fields or controls. `defineLogPlugin` uses `definePlugin` to assemble an ordinary host-wide plugin; `createLogHost` receives policies only through `plugins`. Every `features` declaration uses a `{ alias: feature }` record. Each plugin installation owns independent state. Controls are plugin extensions named `${pluginName}_${alias}_${method}`, for example `log.policy_threshold_setLevel('warn')`.

Features on an output plugin apply only to that output. An output feature replaces the host-wide feature with the same key, and an output that configures its own format, batch, retry or timeout replaces the host-wide one of that kind even under a different key. Gates under different keys both execute, including two instances of the same factory. One plugin record holds at most one format, batch, retry and timeout; host-wide carriers cannot share a key or each supply the same one of those four kinds. Violations use the existing `INVALID_OPTION`. Execution follows entry, gate, format, batch, retry, timeout and transport phases, retaining effective record order within the gate phase. The output default format applies only when no explicit format survives.

An output can declare `consumesText: false` to receive entries and a cancellation signal while skipping host formatting. It cannot configure a format or defaultFormat. Entry processing, gates and delivery policies still apply.

## Errors and lifecycle

- Log methods contain runtime delivery errors. `flush()` and `shutdown()` always fulfill. Observe failures with `onFailure()`; otherwise the host calls `report`.
- Listener failures reach the reporter as `HOOK_FAILED`, with the original on `cause`. Reporter failures are contained without recursive reporting.
- Invalid creation options throw identified errors synchronously. Configuration operations `use()` and `unUse()` may reject.
- Durable append, commit, read and invalid-handle operations keep their storage rejection contract. The logging guarantee does not mask transaction failures.
- The default pending-entry capacity is 10000. Overflow drops the oldest unprocessed entry and reports `QUEUE_OVERFLOW`.

## Entries

| Entry                              | Purpose                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@migaia/log-host`                 | Host factory, level/forward plugins, status, default reporter and host types                          |
| `@migaia/log-host/plugin`          | `defineLogFeature`, `defineLogPlugin`, `defineOutputPlugin`, shared error projection and author types |
| `@migaia/log-host/features`        | All seven built-in features                                                                           |
| `@migaia/log-host/features/<name>` | The corresponding feature's default export                                                            |

The host includes no output transport or third-party runtime dependency. It uses `@migaia/plugin-host`, `@migaia/middleware-pipeline`, `@migaia/lifecycle`, `@migaia/event-subscriber` and `@migaia/utils`.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for complete usage.
