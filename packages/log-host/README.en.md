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
import { thresholdFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** Host policies are output defaults; entry enrichment executes once per entry. */
const log = createLogHost({
  features: [thresholdFeature({ level: 'info' }), uuidFeature({ display: false })],
  plugins: [levelPlugin(), consolePlugin()]
})
log.debug('filtered by this output')
log.info('accepted')
await log.shutdown('manual')
```

Built-ins are `thresholdFeature`, `filterFeature`, `uuidFeature`, `formatFeature`, `batchFeature`, `retryFeature` and `timeoutFeature`. Import them together from `./features` or use individual default exports such as `./features/retry`.

Output-local policies replace host defaults of the same kind. Each scope admits one format regardless of kind; an output format replaces the host format. The fixed delivery order is threshold, filter, custom gates, format, batch, retry, timeout and transport, independently of built-in descriptor array order.

An output can declare `consumesText: false` to receive entries and a cancellation signal while skipping host formatting. It cannot configure a format or defaultFormat. Entry processing, gates and delivery policies still apply.

## Errors and lifecycle

- Log methods contain runtime delivery errors. `flush()` and `shutdown()` always fulfill. Observe failures with `onFailure()`; otherwise the host calls `report`.
- Listener failures reach the reporter as `HOOK_FAILED`, with the original on `cause`. Reporter failures are contained without recursive reporting.
- Invalid creation options throw identified errors synchronously. Configuration operations `use()` and `unUse()` may reject.
- Durable append, commit, read and invalid-handle operations keep their storage rejection contract. The logging guarantee does not mask transaction failures.
- The default pending-entry capacity is 10000. Overflow drops the oldest unprocessed entry and reports `QUEUE_OVERFLOW`.

## Entries

| Entry                              | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `@migaia/log-host`                 | Host factory, level/forward plugins, status, default reporter and host types |
| `@migaia/log-host/plugin`          | Feature/output definitions, shared error projection and plugin author types  |
| `@migaia/log-host/features`        | All seven built-in features                                                  |
| `@migaia/log-host/features/<name>` | The corresponding feature's default export                                   |

The host includes no output transport or third-party runtime dependency. It uses `@migaia/plugin-host`, `@migaia/middleware-pipeline`, `@migaia/lifecycle`, `@migaia/event-subscriber` and `@migaia/utils`.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for complete usage.
