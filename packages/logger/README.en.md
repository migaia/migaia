# `@migaia/logger`

Send log entries through composable processing and outputs, then wait for tracked asynchronous work at request or process cleanup boundaries.

## You may have run into this

- An audit collector has to recover order fields from terminal text: formatting and structured delivery share one interface.
- One output annotates a display field and another sees the change: both received the same mutable entry.
- The log call has returned but data is still unwritten at exit: the sink Promise never reached a shared drain boundary.
- Several shutdown owners each write the final entry: their cleanup functions do not share one terminal completion.

## Why choose it

- **Consume logs by named fields rather than reverse-engineering text.** Core entries deliver message, context, and meta separately, as shown in [Collect structured request details without a console formatter](./USEGUIDE.en.md#collect-structured-request-details-without-a-console-formatter).
- **Keep one output’s top-level changes out of another.** Each sink receives separate shallow containers with an explicit nested-reference boundary, as shown in [Keep one sink from rewriting another sink’s entry fields](./USEGUIDE.en.md#keep-one-sink-from-rewriting-another-sinks-entry-fields).
- **Wait for admitted asynchronous output before continuing.** Promises returned by sinks participate in flush tracking, as shown in [Wait for asynchronous sink work before continuing](./USEGUIDE.en.md#wait-for-asynchronous-sink-work-before-continuing).
- **Let several cleanup owners share one shutdown.** Shutdown publishes a stable Promise before final entries and cleanup run, as shown in [Write the final entry once during shared shutdown](./USEGUIDE.en.md#write-the-final-entry-once-during-shared-shutdown).
- **Control the level threshold separately from temporary filters.** level provides setLevel and a removable addFilter instead of repeated call-site checks, as shown in [Apply a threshold and temporarily remove private entries](./USEGUIDE.en.md#apply-a-threshold-and-temporarily-remove-private-entries).

## Start here

```ts doc-test=run
import { Logger } from '@migaia/logger'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  context: ['checkout']
})
log.useSink((entry) => {
  console.log(entry.context.join('.'), entry.message, entry.meta?.orderId)
})
log.dispatchRaw({ tag: 'audit', message: 'order saved', meta: { orderId: 'A-17' } })
await log.shutdown('manual')
```

Output:

```text
checkout order saved A-17
```

Next: [drain asynchronous output](./USEGUIDE.en.md#wait-for-asynchronous-sink-work-before-continuing) or [add thresholds and filters](./USEGUIDE.en.md#apply-a-threshold-and-temporarily-remove-private-entries).

## Pitfalls when writing it yourself

This native function illustrates the same delivery task and is displayed only, not executed; its comments identify field ownership, shared objects, and lost completion.

```ts doc-test=check
type IEntry = { message: string; args: unknown[] }
const sinks: ((entry: IEntry) => void | Promise<void>)[] = []
function log(message: string, ...args: unknown[]) {
  const entry = { message, args } // Hazard: an order object is still an argument, without named metadata.
  for (const sink of sinks) {
    const completion = sink(entry) // Hazard: every sink can mutate the same object.
    void completion // Hazard: asynchronous completion is discarded.
  }
}
void log
```

## A three-minute mental model

Construct a logger, choose processing and sinks, then write entries; await flush or shutdown at the owning host boundary.

| Term     | Meaning                                               | Tool                                           |
| -------- | ----------------------------------------------------- | ---------------------------------------------- |
| Entry    | Named fields from one log call                        | log / dispatchRaw                              |
| Pipeline | Steps that transform or stop an entry before delivery | usePipeline; level adds a threshold step       |
| Sink     | A callback that consumes entries                      | useSink; color/http/file are concrete adapters |
| Flush    | Wait for observed async work or the drain deadline    | flush, no arguments, internal 3000 ms budget   |
| Shutdown | Write final entries, drain, then release plugins      | shutdown(reason) / dispose()                   |

## Typical scenarios

| Scenario                                                       | How to combine                                  | Details                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Collect structured request details without a console formatter | `new Logger → useSink → dispatchRaw → shutdown` | [Complete example](./USEGUIDE.en.md#collect-structured-request-details-without-a-console-formatter) |
| Keep one sink from rewriting another sink’s entry fields       | `useSink × 2 → dispatchRaw`                     | [Complete example](./USEGUIDE.en.md#keep-one-sink-from-rewriting-another-sinks-entry-fields)        |
| Wait for asynchronous sink work before continuing              | `useSink(async) → log → flush`                  | [Complete example](./USEGUIDE.en.md#wait-for-asynchronous-sink-work-before-continuing)              |
| Write the final entry once during shared shutdown              | `onShutdown → shutdown / dispose`               | [Complete example](./USEGUIDE.en.md#write-the-final-entry-once-during-shared-shutdown)              |
| Apply a threshold and temporarily remove private entries       | `level → addFilter → setLevel`                  | [Complete example](./USEGUIDE.en.md#apply-a-threshold-and-temporarily-remove-private-entries)       |
| Render an error chain as JSON through the chosen host console  | `color(json) → runtimeManager.console → flush`  | [Complete example](./USEGUIDE.en.md#render-an-error-chain-as-json-through-the-chosen-host-console)  |

## Installation

```bash
pnpm add @migaia/logger
```

## Essential APIs

| API                   | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `new Logger(options)` | Create a core with explicit budgets and host capabilities |
| `log / dispatchRaw`   | Send arguments or named structured fields                 |
| `useSink / onFailure` | Attach outputs and observe failures                       |
| `level(config?)`      | Add level methods, a threshold, and filters               |
| `color(config?)`      | Add pretty/JSON console rendering                         |
| `flush / shutdown`    | Wait for tracked output or close the logger               |

## Contract details

### Responsibility, entry points, and conditions

The core builds entries, runs a pipeline, dispatches to sinks, and waits for cleanup. Levels and console rendering are optional plugins. Dependencies are event-subscriber, lifecycle, middleware-pipeline, plugin-host, utils, and ansis; plugin installation and resource ownership belong to Plugin Host rather than another lifecycle implementation. Logger does not inherit PluginHost.

| Entry                         | Exports and host boundary                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `@migaia/logger`              | Logger, Runtime capability management, state/error constants, and application/plugin types  |
| `@migaia/logger/plugins`      | level, color, batch, http, process, reasoning, uuid, and public configuration/Feature types |
| `@migaia/logger/plugins/file` | file and its config, with independent conditional exports; not part of the plugins barrel   |

The node, bun, and deno file conditions use injected fs or lazily load node:fs/promises. Browser/default conditions do not import Node file modules and require fs injection. ESM metadata declares sideEffects: false; actual tree shaking depends on the bundler, without a zero-code guarantee for every output. The Node engine requirement is >=18. Browser, Worker, and other host support depends on the capabilities required by the selected plugins.

### Logger construction and context

new Logger(options) requires options and execution.

| Field                            | Default and meaning                                                               |
| -------------------------------- | --------------------------------------------------------------------------------- |
| execution.mutationTimeoutMs      | Required, no default; Plugin Host mutation budget, number or false                |
| execution.pipelineDrainTimeoutMs | Required, no default; Host pipeline drain budget, number or false                 |
| runtimeManager                   | Capture the current module default when omitted                                   |
| scheduler                        | systemScheduler; log deadlines and batch tasks share this clock domain            |
| context                          | []; default entry.context path                                                    |
| topic                            | ''; a display name for forwarding, not a cycle-detection identity                 |
| options                          | {}; application configuration exposed to plugins                                  |
| on                               | {}; named hooks registered during construction                                    |
| pipeline.mode                    | 'sync'; also 'async', 'generator', or 'async-generator'; fixed after construction |
| plugins                          | []; synchronous constructor admission ordered by Feature dependencies             |

The pipeline object contains only mode. Both execution budgets accept a finite non-negative number, including zero and fractions, or false for no deadline. They do not change the public flush() method's internal 3000 ms budget. Constructor installation rejects Promise/thenable install results and rolls back accepted resources rather than returning a partially installed Logger. Use await log.use(plugin) after construction for asynchronous installation.

ctx contains stable id, options, path, topic, createdAt, and env with isTTY/isCI. The context, path, top-level options, and env containers are frozen. Nested option values and the createdAt Date retain their identity and remain mutable; this is not a deep snapshot.

### Dispatch, outputs, and observation

| API                                            | Arguments, defaults, and result                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| log(tag, message, ...args)                     | Required tag/message, optional args; returns void; a trailing object is not automatically meta               |
| dispatchRaw(input, options?)                   | Required input.tag/message, other entry fields optional; options.asyncOutput defaults to false; returns void |
| raw(text, options?)                            | Required text; asyncOutput defaults to false; writes directly without pipeline, hooks, or sinks              |
| useSink(fn)                                    | Required callback; returns an off handle for this registration                                               |
| hook(name, fn) / fireHook(name, entry)         | All arguments required; hook returns its registration's off handle, fireHook returns void                    |
| onFailure(fn)                                  | Required observer, returns off; does not replace default host diagnostics                                    |
| defer(task)                                    | Required task; schedules tracked work and returns void immediately                                           |
| onFlush(fn) / onShutdown(fn)                   | Required callback, returns off                                                                               |
| flush()                                        | No arguments; returns `Promise<void>`; concurrent calls share the current round's Promise                    |
| shutdown(reason) / dispose()                   | Required reason; dispose means shutdown('manual'); stable `Promise<IPluginHostDisposalResult>`               |
| extends(...others) / unextend(...others)       | Add complete output paths / remove edges; return this / whether any edge was removed                         |
| use(...plugins) / unUse(name)                  | use returns handles in input order; unUse requires name and returns `Promise<void>`                          |
| config.get(path) / config.update(name, recipe) | Read a plugin path / shallow-merge the recipe patch into a new owned snapshot                                |

Shutdown reasons are 'signal', 'uncaughtException', 'unhandledRejection', and 'manual'; onShutdown receives that reason. Static constructor plugins contribute methods to the instance type. Dynamic use exposes methods on handle.extensions without expanding the existing variable's type. unUse rejects missing names with Plugin Host's PLUGIN_NOT_INSTALLED, and required Feature consumers can prevent provider removal.

Sink, hook, and pipeline failures normally reach onFailure without being thrown from the business log/dispatchRaw call. This is not a guarantee that arbitrary input reads, construction, configuration, topology changes, or raw can never throw. In particular, synchronous raw write failures may escape directly. A failure observer's own failure goes to the host reporter without recursively invoking itself; ordinary failures also continue to runtime console.error/write, so subscribing does not replace default reporting.

### Entries and shallow isolation

ILogEntry has id, tag, time, message, args, meta, context, error, and data. The core generates id. time is a current-realm Date, created when omitted. args defaults to an empty array, context to logger.ctx.path (the constructor context defaults to []), and data to an empty object; meta/error are optional. A tag has no built-in level meaning without a plugin.

An Error argument produces a name/message/stack projection while error.raw retains the original Error. HTTP and color JSON use the bounded utils error-chain projection, retaining source/code/name/message/stack/cause/errors without sending raw. Business errors without semantic identity use the diagnostic placeholders unknown/UNKNOWN rather than a fabricated Logger error code. Local console/custom sinks can still inspect the original Error.

The built-in phase order is before → `before:<tag>` → pipeline → sinks → after → `after:<tag>` → forwarding. Hooks receive a live entry. Each sink gets separate top-level containers: args, meta, context, and data are shallow-copied and time is copied as a Date. Nested business values remain shared references. An after hook cannot change snapshots already given to sinks, but its changes can reach the subsequent forwarding step.

Pipeline replacements must retain a current-realm Date time. Serialized timestamps and foreign-realm Dates report PIPELINE_ENTRY_INVALID with failure source pipeline, then deliver the original entry without throwing from dispatch. Registering the same hook function more than once still gives each registration its own off handle.

### Pipeline modes and configuration

| mode              | Method and ordering                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| 'sync'            | usePipeline; next records a value and downstream starts after the current stage returns           |
| 'async'           | useAsyncPipeline; await next(entry) waits for downstream, allowing subsequent cleanup             |
| 'generator'       | useGeneratorPipeline; exhaust each stage before using its terminal value                          |
| 'async-generator' | useAsyncGeneratorPipeline; await each stage to completion, without forwarding intermediate yields |

Sync stages promote to every mode; generator stages also promote to async-generator. Other async/generator stages require the matching mode. Incompatible methods are never in a concrete mode type and fail at runtime with PIPELINE_MODE_MISMATCH. Stages cannot be added during execution. Duplicate next produces PIPELINE_NEXT_DUPLICATE and late next produces a PIPELINE_NEXT_LATE diagnostic; omitting next drops the entry. middleware-pipeline and Plugin Host own execution and adaptation.

Application config.get accepts 'plugin', 'plugin.key', and 'plugin.[index].key'. Objects and arrays in plugin config are recursively frozen. config.update(name, recipe) commits a shallow-merged patch without mutating the old snapshot. The install(core) facade exposes only core.config.get() for that plugin's own configuration; it cannot read/update other plugins or serve as an external-condition polling channel.

Create a fresh plugin object for each installation rather than share stateful instances across Loggers. During installation, core.onDispose(resource) owns resources; application variables do not expose this installation capability. Removal releases the plugin's stages, sinks, hooks, flush/shutdown callbacks, and extensions. Use ILoggerCore/ILoggerPluginCore publicly; ILoggerDomainCore is internal assembly detail, and inference-only helper types are carried by declarations/editor tooling.

### Flush, shutdown, and delivery

flush() waits for observed deferred work, sink/hook thenables, onFlush handlers, batches, and forwarding targets. It drains rounds against an absolute 3000 ms scheduler budget rather than waiting forever for an uncooperative Promise. Expiry reports LIFECYCLE_DEADLINE through onFailure; later flush calls can continue observing remaining work. Foreign-realm Promises and ordinary thenables are tracked without an instanceof Promise requirement.

Shutdown marks its state synchronously and publishes one completion Promise before invoking callbacks. onShutdown may still log/dispatchRaw final entries, but raw stops output as soon as shutdown starts. It then flushes, unloads plugins, and becomes terminal. Handlers and flush share the 3000 ms drain budget; subsequent Host disposal uses execution budgets, so the whole shutdown is not bounded to three seconds.

Concurrent, reentrant, completed, and failed repeated shutdown/dispose calls reuse the same Promise rather than repeat cleanup. Terminal log/dispatchRaw/raw calls are silently ignored, without a dedicated onFailure notification. Failure does not revive the Logger; create a new instance. cleanupErrors/cleanupComplete describe physical cleanup, not delivery acknowledgement. Transport failures and deadlines still need host-level remediation. Clock failures reject that stable Promise with INVALID_OPTION/cause while still attempting Host cleanup; secondary cleanup errors do not replace the primary failure.

### Level and color

level(config?) defaults to {} and adds debug/info/warn/error/fatal, setLevel, addFilter, and removeFilter.

| level field | Default / values                                          |
| ----------- | --------------------------------------------------------- |
| level       | 'debug'; one of 'debug', 'info', 'warn', 'error', 'fatal' |
| filters     | []; every filter must return true                         |
| asyncOutput | false; whether calls generated by this plugin use defer   |

Unknown tags bypass the five-level threshold but still run filters. setLevel changes the active threshold. addFilter returns an idempotent off handle; removeFilter removes matches by function identity. Built-in level captures minLevel/filters at installation. config.update commits a snapshot and calls optional plugin.update; it does not automatically update level's captured runtime state because that plugin has no update hook.

color(config?) defaults to {} and supplies a console sink plus the paint(tag, text)/dim(text) Feature. Its stable plugin name is ansis.

| color field  | Default / values                                                       |
| ------------ | ---------------------------------------------------------------------- |
| color        | 'auto'; also 'always' or 'never'                                       |
| format       | 'auto'; also 'pretty' or 'json'                                        |
| timestamp    | true; ISO timestamp in pretty format                                   |
| colorMessage | 'none'; also 'head', 'tail', 'head-tail', or 'all'                     |
| colorMap     | undefined; the built-in level mapping remains unless overridden by tag |

data.silent === true suppresses only this console sink; others still receive the entry. For auto color, truthy NO_COLOR disables it first, truthy FORCE_COLOR other than '0' enables it, then TTY or CI enables it, otherwise it stays off. Auto format first honors LOG_FORMAT json/pretty, then selects pretty for CI/TTY and json otherwise. colorMessage tail also colors message when there are no args. All environment reads use the captured Runtime; color does not redefine core tags.

### Batching and HTTP

batch(config?) defaults to {} and adds no instance methods. Its Feature supplies createBatcher(config, onBatch) for arbitrary items, not only log entries.

| batch field          | Default / boundary                                                               |
| -------------------- | -------------------------------------------------------------------------------- |
| maxSize              | 20; threshold that releases a batch                                              |
| maxWaitMs            | 2000; wait from the first buffered item                                          |
| maxConcurrentBatches | 1; positive safe integer                                                         |
| maxPendingBatches    | 1024; queued plus executing batches, positive safe integer                       |
| flushTimeoutMs       | 3000; finite non-negative drain budget for batcher flush/dispose                 |
| asyncOutput          | true; defer full-batch callbacks, while timer callbacks are already asynchronous |

push(item) buffers items; flush() sends the remainder and waits for running callbacks. Batchers automatically register with Logger flush. Overflow reports BATCH_OVERFLOW and drops the oldest queued batch; if every occupied slot is in flight, it drops the incoming batch. detail.dropped counts entries. Bounded queues do not promise lossless delivery. Uninstall closes admission, attempts to drain, and reports undelivered items; cleanupComplete is not a delivery receipt.

http(config) requires url and sends POST { entries }.

| HTTP field       | Default / boundary                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| authToken        | undefined; supplies Bearer Authorization when set                                                                                                   |
| headers          | {}                                                                                                                                                  |
| retries          | 2; finite non-negative integer counting additional attempts                                                                                         |
| requestTimeoutMs | 10000; budget for attempting request cancellation                                                                                                   |
| maxRetryAfterMs  | 30000; clamp a valid Retry-After delay to this ceiling                                                                                              |
| batch            | undefined; optional maxSize/maxWaitMs/maxConcurrentBatches/maxPendingBatches/asyncOutput, with unspecified fields inherited from the batch provider |

Network failures, 429, and 5xx can retry; other 4xx fail directly. A valid Retry-After takes priority for 429, with exponential backoff when missing/invalid. Expiry attempts to abort the current request. runtimeManager.createAbortController can supply cancellation, otherwise native AbortController is attempted; without a controller no request timer is scheduled, and a fetch that ignores its signal is not guaranteed to terminate or settle. Missing fetch reports TRANSPORT_UNAVAILABLE when sending through the failure path. Serialization uses SERIALIZE_FAILED; unsuccessful responses or exhausted attempts use DELIVERY_FAILED.

Batch/http in one admission batch are ordered by Feature dependencies, so reversed [http(...), batch()] also works. A provider may already be installed; installing it in a later use call does not rebind an existing HTTP plugin. Without a provider, explicit http.batch creates a bounded local queue with maxSize: 1 and asyncOutput: false while retaining other concurrency/capacity settings. Without either provider or batch config, the sink sends entries directly one at a time. Shutdown first tries to drain final logs, then HTTP disposal cancels remaining transport.

### File, process, reasoning, and UUID

file(config) comes only from its dedicated entry. path is required. Optional batch supports all IBatchPluginConfig fields; optional rotate.maxEntries/maxBytes have no default thresholds. Batches become JSON lines, and the optional fs.rotate(path) runs when the current batch's entry count or encoded byte size reaches a threshold, not when the accumulated disk file reaches it. The Node default provides append without rotate. A private batcher is used when no provider exists. Missing browser/default fs.append fails installation, with FILE_SINK_UNAVAILABLE reachable through the Host installation error's cause. Write failures go through onFailure.

process(config?) defaults to {}, with captureCrashes true, shutdownTimeoutMs 3000, and interceptProcessExit false. Without a Runtime process it is a no-op. Otherwise it handles signals, crashes, and exit; interceptProcessExit changes the normally immediate exit semantics. Participants share one set of listeners and must agree on process identity, config, and scheduler domain or receive PLUGIN_CONFIG_CONFLICT. Final removal detaches listeners and resets shared state. Late diagnostics use the first installer's captured manager, without a promise that a crash delivers every log.

reasoning(config?) adds startThinking/thinking/endThinking/startResponse/response/endResponse. labels.thinking defaults to 'Thinking...', labels.response to undefined, and asyncOutput to false. Tokens use raw; each phase end also emits a complete entry with data.silent = true for HTTP/audit sinks. An optional color Feature supplies paint/dim, falling back to plain text; same-batch dependencies follow topology.

uuid(config?) writes data.uuid and data.uuidDisplay for every entry. display defaults to false and controls color pretty/JSON rendering. UUID generation uses the Logger's captured Runtime; it does not replace ctx.id.

### Forwarding and Runtime capabilities

extends(...others) sends entries through each target's complete pipeline and sinks, retaining its level/filter policy. Each hop records topic for display and stable ctx.id for cycle detection separately, since topics can be empty or duplicated. Static admission rejects EXTENDS_SELF/EXTENDS_CYCLE; runtime forwarding skips already-visited ids. Sink-private data exposes display topicChain without leaking the cycle-detection symbol.

unextend removes edges by target ctx.id without closing the target, returning false for repeated removal. Flush follows downstream edges. Forwarding does not merge the target's plugin extension types into the source variable.

| Runtime capability                     | Requirement / default                                                 |
| -------------------------------------- | --------------------------------------------------------------------- |
| randomUUID(), defer(task), write(text) | Required on injected managers                                         |
| process                                | Optional; host process by default, with no exit listeners when absent |
| console                                | Optional log/warn/error; can fall back to write                       |
| fetch                                  | Optional host fetch by default                                        |
| fs                                     | Absent by default; async append(path, text), optional rotate(path)    |
| createAbortController                  | Optional; native controller when available if omitted                 |

Logger retains the runtimeManager object itself; plugins share that reference. Replacing the module default does not retarget existing instances or deep-copy the manager. getLoggerRuntimeManager() returns the active object; do not mutate it. setLoggerRuntimeManager(manager) selects the default for future instances and returns an idempotent restore supporting nested layers. Pass an explicit constructor owner for deterministic ownership. Default UUID prefers crypto.randomUUID with a local identifier fallback; defer prefers setImmediate, then setTimeout(0), then queueMicrotask; write prefers process.stdout, otherwise console.log.

LoggerLevel, LoggerColorMode, LoggerReasoningPhase, LoggerStatus, and LOGGER_SOURCE are stable public constants. Import ILoggerColorMode/ILoggerLevel from the root; the old IColorMode/ILogLevel are no longer exported from plugins.

### Error identity and troubleshooting

Logger-owned errors use source logging. Complete identities from Plugin Host, middleware, or another owner remain with that owner. LoggerErrorCode has 17 values.

| code                            | Trigger                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| INVALID_OPTION                  | Unreadable/invalid config; getter cause retained                                    |
| PIPELINE_ENTRY_INVALID          | Replacement time is not a current-realm Date; report and deliver the original entry |
| RUNTIME_SHUTTING_DOWN           | Process installation after shared shutdown starts                                   |
| PLUGIN_CONFIG_CONFLICT          | Incompatible process identity, config, or clock domain                              |
| TRANSPORT_UNAVAILABLE           | Missing HTTP fetch                                                                  |
| SERIALIZE_FAILED                | HTTP payload serialization failure                                                  |
| DELIVERY_FAILED                 | Unsuccessful response or exhausted retries                                          |
| INVALID_RETRY_COUNT             | Retry count is not a finite non-negative integer                                    |
| LIFECYCLE_DEADLINE              | Flush/shutdown drain expires with pending work                                      |
| PROCESS_INSTALL_ROLLBACK_FAILED | Listener rollback fails in addition to installation                                 |
| PLUGIN_UNINSTALL_CLEANUP_FAILED | Final plugin cleanup failure, possibly with dropped detail                          |
| PLUGIN_SHUTDOWN_CLEANUP_FAILED  | Deadline task or exit cleanup failure                                               |
| HOOK_FAILED                     | Failure observer itself fails; host diagnostic only                                 |
| EXTENDS_SELF                    | Self-forwarding                                                                     |
| EXTENDS_CYCLE                   | New forwarding edge creates a cycle                                                 |
| BATCH_OVERFLOW                  | Queue capacity exceeded; inspect detail.dropped                                     |
| FILE_SINK_UNAVAILABLE           | No injected fs or default capability for the active condition                       |

failure.source is a separate stage dimension: defer/hook/sink/pipeline/flush/forward/shutdown. It is not the semantic package source. If the host reporter throws/rejects, the existing host exception queue keeps it observable without reporter recursion or replacing the business result.

For missing output, first check that a sink exists, then level/filter policy and data.silent. For single-entry HTTP sends, check that batch was admitted in the same batch or earlier. Closed Loggers cannot resume, and dynamic extension methods live on handle.extensions. Await flush/shutdown where completion matters, without treating them as remote persistence receipts. A production combination can use level, uuid, batch, http, color, and process with a real endpoint; keep failure observation installed until shutdown finishes rather than send network requests merely to demonstrate composition.

```bash
pnpm --filter @migaia/logger run fmt
pnpm --filter @migaia/logger run lint
pnpm --filter @migaia/logger run typecheck
pnpm --filter @migaia/logger run typecheck:test
pnpm --filter @migaia/logger run test
```

The test script builds this package first. typecheck:browser and test:e2e are separate existing commands; listing them here is not an execution claim.

## Durable log plugins

`@migaia/logger/plugins/durable` exports the `binlog`, `wal`, and `undoLog` plugin factories, the `ILogStore` contract, `memoryLogStore`, `LogRecordState`, and `LogStage`. Each plugin borrows one distinct caller-owned store. The original object remains intact, including class methods and symbols; it never enters plugin configuration. Another installed plugin cannot borrow the same object. Plugins never close injected resources.

`binlog` adds ordered append/read/subscribe operations. `wal.begin` commits pending intent before it returns; `complete` and `abort` only advance pending records to a terminal state. `undoLog` adds `undo.record/get/list/forget`; it stores images and does not apply business rollback. Active transaction ids are unique. Forget persists done before removing the active image, and then permits id reuse. `list` defaults to 100 items, newest time first with sequence descending for ties; `sinceTime` includes its boundary. Reads return independent snapshots.

```ts
import { Logger } from '@migaia/logger'
import { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'

await using events = memoryLogStore()
await using intents = memoryLogStore()
await using images = memoryLogStore()
const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]
})
try {
  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])
  const seq = await log.binlog.append('order.created', { id: 'o1' })
  const off = log.binlog.subscribe(seq, (record) => console.log(record.seq))
  const intent = await log.wal.begin('save-order', { id: 'o1' })
  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])
  await log.wal.complete(intent)
  console.log(await log.undo.get('tx1'))
  await log.undo.forget('tx1')
  off()
} finally {
  try {
    await log.shutdown('manual')
  } finally {
    await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()])
  }
}
```

Call `ready()` before opening a native transaction. Ordinary methods automatically await initialization. `whenIdle()` remains callable after uninstall and waits for already accepted work; it does not await external subscriber callbacks or prove that an owning business transaction committed. Logger flush/shutdown retain their existing finite budgets. Always wait for durable `whenIdle` in `finally`, including rejected shutdown, before the creator closes the stores. Old nested APIs and extracted methods stay revoked after reinstall.

`binlog.append(kind,payload,options?)` returns one sequence; `appendBatch(records,options?)` returns all sequences. `read(fromSeq,{limit?})` starts inclusively and defaults to 100; `lastSeq()` retains the committed high watermark after `truncate(beforeSeq)` removes the strict prefix. Subscribers process history and live data through one cursor, one callback at a time; slow listeners do not block writes or other subscribers. Cancellation is idempotent. Callback failure stops that subscriber and reports the original error through source `hook`. Truncation past its cursor stops it with `LOG_SUBSCRIPTION_TRUNCATED`. Optional `echo:true` emits tag `binlog`, message `kind`, and metadata `{seq,time}` without copying payload into output.

A native transaction owner may pass `ILogAppendOptions.transaction` to binlog append methods or `undo.record`. That owner creates an `ILogAppendPort` bound to the exact store and active transaction. Logger starts the captured append in the current stack, returns provisional sequences without committing, and registers its actual Promise in the same FIFO for `whenIdle`. Store-owned `onAppend` publishes once after real commit, including a late commit after plugin reinstall. Rollback publishes nothing and does not reserve undo ids. Memory/file stores do not provide cross-resource transaction ports; supplying the same backend name does not establish atomicity.

### Native log resources

`memoryLogStore(options?)` provides process-local atomicity. `fileLogStore(path,options?)` from the separate `/plugins/durable/file` entry uses builtin SQLite: Node/Deno load `node:sqlite`, Bun loads `bun:sqlite`. macOS, Linux, and Windows local filesystems form the support matrix; only runtime/OS combinations actually exercised establish verification. Network filesystems do not receive a locking/durability guarantee. The file resource uses `synchronous=FULL`, one native transaction per mutation, and a retained exclusive connection lock. Prepared statements release before the connection closes. No storage package or third-party native driver is required. A failed COMMIT stops admission because its outcome may be unknown; reopen to recover committed state without automatic replay.

```ts
import { fileLogStore } from '@migaia/logger/plugins/durable/file'

await using store = await fileLogStore('./orders.sqlite')
await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])
console.log(await store.lastSeq())
```

`ILogStore.append` atomically creates records and pending states, allocating sequences from one. Empty batches allocate nothing. `read(fromSeq,limit)` reads ascending retained records; limits are nonnegative safe integers. `setState(seq,state)` permits pending to done/aborted, or an unchanged pending state; terminal/missing records reject `WAL_RECORD_INVALID`. `states(LogRecordState.pending)` returns only active sequences. Truncation preserves the permanent sequence/time watermark, so new records never reuse committed numbers. `onAppend` returns an idempotent off function and delivers one frozen `{lastSeq,count}` notice after a nonempty commit; empty appends, state changes, rollback, and truncation do not publish. Listener failures only report.

Payloads accept plain JSON data: no undefined, nonfinite numbers, bigint, functions, classes, cycles, sparse arrays, or accessors. Input snapshots complete before FIFO admission without invoking getters/toJSON. Shared subobjects are copied as JSON values. Store and plugin observations use fixed `LogStage` names and identity statistics, never records, transaction ids, native handles, or authentication settings. Observer failure only reports. Original I/O failures stay reachable through `cause`; payload/range/closed/lock errors retain their semantic codes.

Explicit `dispose()` returns a stable main Promise that rejects on cleanup failure. The asynchronous disposal symbol returns a different stable Promise that reports failure and resolves. Both share one physical cleanup. The creator owns the resource and may use raw methods before borrowing; while borrowed, business reads/writes go through its one plugin. A custom store must implement the same atomicity, snapshots, sequence/state, notices, and resource rules. This forwarding example preserves one existing owner rather than creating a second commit mechanism:

```ts
import { memoryLogStore } from '@migaia/logger/plugins/durable'
import type { ILogStore } from '@migaia/logger/plugins/durable'

const delegate = memoryLogStore()
// A custom implementation must preserve this single owner's atomic commit and notices.
const custom: ILogStore = {
  append: (records) => delegate.append(records),
  read: (fromSeq, limit) => delegate.read(fromSeq, limit),
  lastSeq: () => delegate.lastSeq(),
  onAppend: (listener) => delegate.onAppend(listener),
  truncate: (beforeSeq) => delegate.truncate(beforeSeq),
  setState: (seq, state) => delegate.setState(seq, state),
  states: (filter) => delegate.states(filter),
  dispose: () => delegate.dispose(),
  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()
}
await custom.append([{ kind: 'custom', payload: null }])
await custom.dispose()
```

`assertLogInteger(value, minimum = 1)` reuses original numeric admission: a safe integer at or above minimum. Invalid values retain `RangeError/INVALID_OPTION`; exhausted integers retain `LOG_SEQUENCE_EXHAUSTED`.

Native log adapters reuse `snapshotLogRecords`, `prepareLogAppend`, `snapshotLogStoreState`, and `createLogStoreIndex` from the same durable entry. Capture portable JSON before asynchronous admission, prepare sequence/time from the serialized committed head, and persist with the adapter's original transaction. Only after its actual commit, apply the exact prepared batch with `index.applyAppend` and publish the original append notice once. Rollback does not apply the batch or advance watermarks. Check state/truncation before native writes and apply those changes after commit. Recovery reuses the file store's row/state/payload checks; an optional payload decoder runs after row identity validation. The index contains committed data and the original pending-list algorithm only; it provides no queue, resource, notification channel, or close authority. These author helpers do not change the synchronous commit or observation timing of memory/file stores.

```ts
import {
  snapshotLogRecords,
  prepareLogAppend,
  snapshotLogStoreState,
  createLogStoreIndex
} from '@migaia/logger/plugins/durable'

const state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])
const index = createLogStoreIndex(state)
const batch = prepareLogAppend(
  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),
  index
)
console.log(index.lastSeq, batch[0]?.seq) // 0 1: preparation is not a commit.
```

`level()` also supplies `atLevel(level, entry)`. The entry keeps its category tag, normal `dispatchRaw` payload and original Error references while passing through the same level threshold and filters. For example, `log.atLevel('debug', { tag: 'storage', message: 'get', meta: { operation: 'get' } })` uses the original asyncOutput and output resources. Ordinary unknown tags retain their existing filter-only policy; debug/error and other existing methods keep their behavior.
