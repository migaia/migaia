# log-host usage guide

## Create a host

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin } from '@migaia/log-plugin-console'

/** Each host independently owns context, plugin registrations and its delivery queue. */
const log = createLogHost({
  context: ['orders'],
  topic: 'api',
  maxPending: 10000,
  plugins: [levelPlugin(), consolePlugin()]
})
log.info('created', { orderId: 'o1' })
log.log('audit', 'arbitrary tags remain valid')
await log.flush()
await log.shutdown('manual')
```

Options are `plugins`, `context`, `topic`, `maxPending`, `scheduler`, `randomUUID`, `report` and plugin-host `execution`. The scheduler defaults to utils `systemScheduler`; UUID generation defaults to `globalThis.crypto.randomUUID()`. Both may be injected per host.

An injected scheduler must run callbacks after `schedule()` returns its receipt. Callbacks invoked synchronously before the receipt is returned are unsupported.

The host facade and top-level context containers are frozen. Nested user values and Date instances retain identity. `dispatchRaw()` captures shallow input containers synchronously and generates its own id. Each output receives a shallow snapshot; native errors and nested business objects retain their identities.

## Levels and entry policies

`levelPlugin()` adds `debug`, `info`, `warn`, `error`, `fatal` and `atLevel`. A string first argument becomes message; other values remain native args. The plugin performs no filtering itself.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/plugin'
import { thresholdFeature, filterFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** A cold definition can be reused; each plugin installation owns its live threshold state. */
const threshold = thresholdFeature({ level: 'warn' })
/** The cold filter has no controls; its installed plugin extension provides add. */
const filters = filterFeature()
/** Entry enrichment runs once per entry at host scope. */
const log = createLogHost({
  plugins: [
    defineLogPlugin({
      name: 'policy',
      features: { threshold, filter: filters, uuid: uuidFeature({ display: false }) }
    }),
    levelPlugin(),
    consolePlugin()
  ]
})
/** Revocation removes only this added occurrence. */
const off = log.policy_filter_add((entry) => entry.message !== 'hidden')
log.atLevel('error', { tag: 'storage', message: 'write failed' })
log.policy_threshold_setLevel('debug')
off()
await log.shutdown('manual')
```

Unknown tags bypass only the standard level threshold. `atLevel()` keeps the business tag while supplying an explicit standard level. UUID enrichment always writes `data.uuid`; display controls only `data.uuidDisplay`.

## Output scopes and delivery

Entry features execute once at host ingress. Each output then follows gate, format, batch, retry, timeout and transport phases, retaining effective record declaration order within the gate phase. `defineLogPlugin({ name, features })` installs host-wide policy through native `definePlugin`. `createLogHost` has no `features` option; policies arrive through caller-declared plugins. `defineOutputPlugin` policies apply only to their own output. Both use `{ alias: feature }` records in property declaration order. The record key is the only feature name: output `features.<key>` overrides only the same host-wide key. Different keys retain both features even when they use the same factory; `{ a: thresholdFeature(), b: thresholdFeature() }` applies both gates. Surviving host gates precede local gates in declaration order. Entry features belong only to host-wide carriers.

Keys within a record are unique. Two host-wide carriers declaring the same key use the existing name-conflict error path. At actual installation, each output merges host and local features by key and admits at most one effective format and one each of batch, retry and timeout. Different keys do not override one another; singular-slot collisions use the existing `INVALID_OPTION`, including during dynamic `use()`. The output's `defaultFormat` applies only when no explicit formatter survives.

| Feature                               | Behavior                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `thresholdFeature({ level })`         | Standard threshold; installed `${pluginName}_${alias}_setLevel()` control                   |
| `filterFeature({ filters })`          | Ordered predicates; installed `${pluginName}_${alias}_add()` returns an independent remover |
| `uuidFeature({ display })`            | Entry enrichment using the installing host's generator                                      |
| `formatFeature({ format })`           | Shared `json` or uncolored `plain` rendering                                                |
| `batchFeature(options)`               | Bounded buffering and output draining                                                       |
| `retryFeature({ attempts, backoff })` | Canonical utils retry; attempts includes the first call                                     |
| `timeoutFeature({ ms })`              | Canonical utils timeout for one attempt                                                     |

Batch defaults are `maxSize: 20`, `maxWaitMs: 2000`, `maxConcurrentBatches: 1`, `maxPendingBatches: 1024` and `drainTimeoutMs: 3000`. Capacity counts queued and active batches. Overflow drops the oldest queued batch, or the incoming batch when every slot is active, and reports `BATCH_OVERFLOW` with `detail.dropped`. Output removal drains its final buffer before revoking the registration signal used for delivery.

Retry requires an explicit positive safe-integer attempts count. Backoff is milliseconds or a function receiving the failed attempt's index. Transport `retryable` controls repetition; `retryDelay` is captured through `beforeRetry` and takes precedence over ordinary backoff. Timeout failures report `DELIVERY_FAILED`, retaining the canonical utils timeout on cause.

When delivery fails and timeout cleanup also fails, `retryable` and `retryDelay` receive the original delivery error. Cleanup failures follow it in the original aggregate, retained on a `logging / DELIVERY_FAILED` wrapper's `cause`. Cleanup after successful delivery reports once through the same host error boundary and never replays the successful operation.

## Define an output

```ts
import { createLogHost } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/plugin'
import { batchFeature, formatFeature } from '@migaia/log-host/features'

/** The transport owns its destination while the host owns delivery policy and resources. */
const lines: string[] = []
/** Local policy replaces host defaults without duplicating batching or formatting. */
const output = defineOutputPlugin({
  name: 'memory-output',
  batchable: true,
  defaultFormat: 'json',
  features: { batch: batchFeature({ maxSize: 2 }), format: formatFeature({ format: 'plain' }) },
  deliver(records) {
    for (const record of records) lines.push(record.text)
  }
})
/** The general log method works without installing standard level methods. */
const log = createLogHost({ plugins: [output] })
log.log('info', 'one')
log.log('info', 'two')
await log.flush()
await log.shutdown('manual')
```

`deliver` receives readonly records and `{ signal, format }`. Each record carries native entry and selected text. `context.format` is the selected installed formatter implementation, rather than the cold feature token. Observe its formatter or optional pretty-rendering behavior instead of comparing token identity.

Set `consumesText: false` and omit `defaultFormat` for an entry-only output. Its callback receives records containing only `entry` and a context containing only `signal`. Host formatting is skipped for that output; configuring any output-local format throws `INVALID_OPTION` at creation. Entry features, gates, batching, retry and timeout still apply. Omitting `consumesText` keeps the existing text callback types and required defaultFormat.

`defineLogPlugin` and `defineOutputPlugin` declare real native `features` records. Their optional `install(core)` reads native outputs through `core.features[alias]` and returns precisely inferred host and dynamic-handle extensions. Filter and threshold controls automatically use `${pluginName}_${alias}_${method}` names; plugin-host rejects duplicate complete extension names. Reusing a token never shares mutable state between plugin or host installations. A carrier control affects every output inheriting that carrier policy. The real core provides scoped config, lifecycle, scheduler, install-owned resources, sinks, failures, deferred work, flush and shutdown. Plugin-host retains rollback and resource ownership.

Use `defineLogFeature()` for a complete entry, gate or format implementation, for example `defineLogFeature({ phase: 'gate', accept: () => true })`. Delivery remains limited to built-in batch/retry/timeout factories. Every factory returns an opaque native `defineFeature` token without phase, stage, setLevel or add fields. The definition accepts no feature name; the record key supplies it. Package-private metadata describes phase and scope rules and identifies only the three built-in singular delivery policies; native installation outputs own state and controls. Object literals, shallow copies and type assertions cannot manufacture plugin-host identity.

## Errors and lifecycle

`projectLogEntry(entry)` replaces only error with utils `serializeErrorChain(entry.error.raw)`. Structured output retains source, code, name, message, stack, cause and aggregate branches while excluding raw private fields. JSON and HTTP use this same projection; the original native raw object remains unchanged.

```ts
import { createLogHost } from '@migaia/log-host'

/** Report unhandled failures and errors thrown by failure observers. */
const log = createLogHost({ report: (error) => console.error(error) })
/** This removal capability owns only one failure observer. */
const off = log.onFailure(({ source, error }) => console.error(source, error))
log.log('audit', 'event')
await log.flush()
off()
await log.shutdown('manual')
```

Log methods and flush/shutdown contain runtime failures. Creation errors and configuration use/unUse rejection remain visible to callers. Without failure listeners the reporter receives the error directly. Listener failures report `HOOK_FAILED` with the original on cause. Reporter throws, hostile then getters and rejections remain contained without recursive reporting.

The default 3000 ms flush budget is a bounded wait, not proof of successful delivery. A deadline reports `LIFECYCLE_DEADLINE` and fulfills; late rejections remain observed. Shutdown shares one Promise and the first reason. Final-log handlers run before admission closes and plugins release. Inspect structured `cleanupErrors` when cleanup matters to the application.

## Forwarding and configuration

`forwardPlugin({ targets })` forwards processed logical entries into target hosts' own pipelines and policies. Installation rejects self-links and multi-hop cycles as `FORWARD_SELF` and `FORWARD_CYCLE`. Source flush includes target asynchronous work.

`use(...plugins)` returns the canonical input-ordered handle tuple without changing the original variable's static extension type. `unUse(name)` returns the peer removal result; removing an absent registration rejects. Removing forward disconnects its edges. Source shutdown leaves target hosts alive.

## Migrating from `@migaia/logger`

| Previous entry or behavior                      | Replacement                                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Logger(...)` and `level()`                 | `createLogHost(...)` and `levelPlugin()`; use `thresholdFeature()` and `filterFeature()` for filtering                                                                                                                            |
| `uuid()` and `batch()`                          | `uuidFeature()` and `batchFeature()`; the host owns batching, retries and timeouts                                                                                                                                                |
| `color()` and console output                    | `consolePlugin()` and `prettyFeature()`; native args retain identity, meta remains a shallow copy, and an original arg plus its meta copy remain separate arguments                                                               |
| `http({ retries, ... })`                        | `httpPlugin()` with `retryFeature({ attempts: retries + 1, backoff: 200 })`; attempts includes the first POST                                                                                                                     |
| HTTP-owned batch/timeout/format                 | Explicit `batchFeature()` and `timeoutFeature({ ms: 10000 })`; HTTP skips text formatting and still sends the `{ entries }` JSON envelope                                                                                         |
| `file()` and runtime file writes                | `filePlugin({ path, writer })`; the application owns the borrowed writer and rotation thresholds still apply per delivered batch                                                                                                  |
| `process()`                                     | `processPlugin({ process })`; the injected capability owns actual listeners and exit, while the host owns flush/shutdown                                                                                                          |
| `reasoning()` and raw output                    | `reasoningPlugin({ write })`; all six reasoning methods and the default `asyncOutput: false` remain, while console owns its raw extension                                                                                         |
| Durable factories and file store                | `binlogPlugin()`, `walPlugin()` and `undoLogPlugin()` from `@migaia/log-plugin-durable`; import its file store through the `/file` entry                                                                                          |
| One logging error domain                        | Host uses `logging`; HTTP/file/process use `logging.http`, `logging.file` and `logging.process`, and durable uses `logging.durable`; console/reasoning preserve original capability errors; inspect actual source, code and cause |
| `extends()` and `unextend()`                    | Install or remove `forwardPlugin()`, without compatibility aliases                                                                                                                                                                |
| Global runtime manager                          | Host scheduler/randomUUID/report and plugin-owned capability options                                                                                                                                                              |
| Host sync/generator modes and host asyncOutput  | Asynchronous logging delivery; await flush before reading output; the reasoning option of the same name remains supported                                                                                                         |
| hook/fireHook, constructor on and dispose alias | Hooks/on are removed; release the host with `shutdown('manual')`                                                                                                                                                                  |
| `shutting-down`                                 | `LogHostStatus.shuttingDown`, whose value is `shuttingDown`                                                                                                                                                                       |

Runtime logging, flush and shutdown failures use the failure channel instead of escaping into business control flow; configuration errors may still reject. Durable append/read/transaction operations retain rejection semantics, keeping original errors reachable through cause or aggregate branches. A failed durable operation must never look successful. These two complete examples inject memory capabilities and perform no network or disk I/O.

```ts doc-test=run
import assert from 'node:assert/strict'
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/plugin'
import {
  batchFeature,
  formatFeature,
  retryFeature,
  timeoutFeature
} from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'
import { httpPlugin } from '@migaia/log-plugin-http'
import { filePlugin } from '@migaia/log-plugin-file'

/** Injected capabilities keep this example offline and leave application resources borrowed. */
const observed = { console: [] as string[], http: [] as string[], file: [] as string[] }
/** All console levels use this one injected destination. */
const target = {
  log(text: unknown) {
    observed.console.push(JSON.parse(String(text)).message)
  },
  warn(text: unknown) {
    this.log(text)
  },
  error(text: unknown) {
    this.log(text)
  }
}
/** An ordinary carrier declares delivery policy; each transport owns its destination. */
const log = createLogHost({
  plugins: [
    defineLogPlugin({
      name: 'policy',
      features: {
        format: formatFeature({ format: 'json' }),
        batch: batchFeature({ maxSize: 2 }),
        retry: retryFeature({ attempts: 2, backoff: 0 }),
        timeout: timeoutFeature({ ms: 10000 })
      }
    }),
    levelPlugin(),
    consolePlugin({ console: target }),
    httpPlugin({
      url: 'https://example.invalid/logs',
      async fetcher(_url, init) {
        for (const entry of JSON.parse(init.body).entries) observed.http.push(entry.message)
        return { ok: true, status: 200, headers: new Headers() }
      }
    }),
    filePlugin({
      path: 'application.ndjson',
      writer: {
        async append(_path, text) {
          for (const line of text.trimEnd().split('\n'))
            observed.file.push(JSON.parse(line).message)
        }
      }
    })
  ]
})
try {
  log.info('created')
  log.warn('queued')
  await log.flush()
  assert.deepEqual(observed.console, ['created', 'queued'])
  assert.deepEqual(observed.http, observed.console)
  assert.deepEqual(observed.file, observed.console)
} finally {
  await log.shutdown('manual')
}
```

```ts doc-test=run
import assert from 'node:assert/strict'
import { createLogHost } from '@migaia/log-host'
import { binlogPlugin, walPlugin, undoLogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'

/** The application owns these stores; installed plugins borrow their lifetime. */
const records = memoryLogStore()
/** WAL intent state is independent from ordered business records. */
const intents = memoryLogStore()
/** Undo images are JSON data owned by the business operation. */
const images = memoryLogStore()
/** Explicit execution budgets retain durable operation admission semantics. */
const log = createLogHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [
    binlogPlugin({ store: records }),
    walPlugin({ store: intents }),
    undoLogPlugin({ store: images })
  ]
})
try {
  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])
  await log.binlog.append('order.created', { id: 'o1' })
  const intent = await log.wal.begin('order.update', { id: 'o1' })
  await log.undo.record('tx-1', [{ target: { id: 'o1' }, before: null, after: { state: 'ready' } }])
  await log.wal.complete(intent)
  assert.equal((await log.binlog.read(1))[0]?.kind, 'order.created')
  assert.equal((await log.undo.get('tx-1'))?.length, 1)
  assert.deepEqual(await log.wal.pending(), [])
} finally {
  await log.shutdown('manual')
  await Promise.all([records.dispose(), intents.dispose(), images.dispose()])
}
```
