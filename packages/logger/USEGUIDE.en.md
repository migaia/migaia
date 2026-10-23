# `@migaia/logger` Usage guide

Choose the delivery problem you need to solve; all examples use public entries and in-memory collection without HTTP requests or file writes.

| Problem to solve                                               | Public entry | Complete scenario                                                        |
| -------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| Collect structured request details without a console formatter | Logger       | [Start](#collect-structured-request-details-without-a-console-formatter) |
| Keep one sink from rewriting another sink’s entry fields       | Logger       | [Start](#keep-one-sink-from-rewriting-another-sinks-entry-fields)        |
| Wait for asynchronous sink work before continuing              | Logger       | [Start](#wait-for-asynchronous-sink-work-before-continuing)              |
| Write the final entry once during shared shutdown              | Logger       | [Start](#write-the-final-entry-once-during-shared-shutdown)              |
| Apply a threshold and temporarily remove private entries       | level        | [Start](#apply-a-threshold-and-temporarily-remove-private-entries)       |
| Render an error chain as JSON through the chosen host console  | color        | [Start](#render-an-error-chain-as-json-through-the-chosen-host-console)  |

## Before running the examples

Install this package to run every scene here; plugins is an entry of the same package. Use an ESM TypeScript environment with top-level await.

```bash
pnpm add @migaia/logger
```

## Collect structured request details without a console formatter

An audit event needs a request path and an order id that a downstream collector can read as fields. Printing an object beside a message leaves every collector to interpret its shape.

A trailing object passed to log() remains an argument, not metadata. A hand-written console wrapper can also mix formatting with delivery and hide which component owns completion.

Construct Logger with explicit execution budgets, register a sink, and pass named fields through dispatchRaw. context supplies the default entry path; shutdown waits for the logger cleanup boundary.

### Arguments used here

execution is required; both mutationTimeoutMs and pipelineDrainTimeoutMs are false, explicitly disabling those Host deadlines; context defaults to [] and is checkout here; dispatchRaw requires tag/message, meta.orderId is application data, and manual is one of the four shutdown reasons.

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

### Output and boundaries

```text
checkout order saved A-17
```

Prints `checkout order saved A-17`. The sink reads the default context, message and explicit metadata directly; no formatting plugin is needed for structured consumption.

The core installs no sink or level methods by default. This example supplies useSink itself; level() adds info/warn and color() adds console rendering. Both required execution budgets are false here, explicitly opting out of their Host time limits.

## Keep one sink from rewriting another sink’s entry fields

A console sink annotates an entry for display, then an audit sink unexpectedly sees those annotations. At the same time, application objects inside arguments may be shared deliberately.

Passing one mutable entry to every sink lets top-level formatting state leak between outputs. Deep-cloning everything has a different cost and changes application object identity.

Logger supplies each sink with a shallow snapshot and a separate data record. Mutate one sink’s data and a nested argument, then observe the second sink to see the exact isolation boundary.

### Arguments used here

Both execution budgets are false; data defaults to {} and args to [], overridden here with route and details; each useSink gets a shallow entry copy while the nested details object keeps its identity.

```ts doc-test=run
import { Logger } from '@migaia/logger'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
const details = { count: 1 }
log.useSink((entry) => {
  entry.data.route = 'changed'
  ;(entry.args[0] as { count: number }).count = 2
})
log.useSink((entry) => {
  console.log(entry.data.route, (entry.args[0] as { count: number }).count)
})
log.dispatchRaw({ tag: 'audit', message: 'checkout', data: { route: 'original' }, args: [details] })
console.log(details.count)
await log.shutdown('manual')
```

### Output and boundaries

```text
original 2
2
```

Prints `original 2` and `2`. The second sink keeps the original data.route, but both sinks and the caller observe the same nested argument object after its count changes.

Isolation is shallow: args, context, data, metadata and the Date container are copied for each sink, while nested application values remain shared. Redaction that must protect a nested value should replace it in the pipeline before delivery.

## Wait for asynchronous sink work before continuing

A request finishes its log call and immediately closes its response or process. An asynchronous sink has started but has not saved the entry yet.

A fire-and-forget sink hides its completion from the caller. Waiting only for a buffer callback does not cover promises returned directly by other sinks.

Return the sink’s actual Promise and await log.flush(). Logger tracks that completion along with deferred tasks and hooks; the example uses a microtask, so it needs no guessed delay.

### Arguments used here

Both execution budgets are false; the sink returns its actual Promise, flush takes no argument and has an internal 3000 ms budget, and shutdown uses manual afterward.

```ts doc-test=run
import { Logger } from '@migaia/logger'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
const saved: string[] = []
log.useSink(async (entry) => {
  await Promise.resolve()
  saved.push(entry.message)
})
log.log('audit', 'saved')
console.log(saved.length)
await log.flush()
console.log(saved.length, saved[0])
await log.shutdown('manual')
```

### Output and boundaries

```text
0
1 saved
```

Prints `0` and `1 saved`. The log call returns before the asynchronous sink commits, and flush completes after the tracked Promise has saved its entry.

Public flush() takes no argument and uses a 3000 ms drain budget on the logger scheduler. Deadline diagnostics go to onFailure; a deadline does not abort underlying work or prove remote receipt. A sink must return its Promise to participate.

## Write the final entry once during shared shutdown

Several owners close a logger at the same time, and a shutdown callback still needs to record the final state. Repeating shutdown can duplicate the final entry or dispose resources too early.

Independent cleanup functions can race a final log call against sink disposal. Returning unrelated promises also makes it difficult for callers to share one terminal outcome.

Register the final entry through onShutdown, then retain shutdown’s Promise. dispose() returns that same completion; Logger attempts to drain final entries within its waiting budget before releasing the installed plugins.

### Arguments used here

Both execution budgets are false; onShutdown receives the reason, unused here; manual selects explicit shutdown, and argument-free dispose aliases shutdown(manual).

```ts doc-test=run
import { Logger } from '@migaia/logger'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
const entries: string[] = []
log.useSink((entry) => {
  entries.push(entry.message)
})
log.onShutdown(() => {
  log.log('audit', 'final')
})
const closing = log.shutdown('manual')
console.log(closing === log.dispose())
await closing
log.log('audit', 'after close')
console.log(entries.join(','))
```

### Output and boundaries

```text
true
final
```

Prints `true` and `final`. shutdown and dispose share the same Promise, the callback’s final structured entry reaches the sink, and the later entry after closing is ignored.

Shutdown is terminal. Its handlers and flush share a 3000 ms waiting budget; subsequent Host disposal uses execution budgets separately. A disposal result reports cleanup status and errors, rather than serving as a delivery receipt.

## Apply a threshold and temporarily remove private entries

A service wants warnings and errors normally, but one operation needs an extra privacy filter. Removing that temporary rule must leave the level threshold intact.

Scattered if statements duplicate level comparisons at every call site. A single shared mutable filter list makes it easy to remove another owner’s rule or forget to restore the threshold.

Install level({ level: LoggerLevel.warn }), then add a filter and retain its removal handle. setLevel changes the threshold independently; the sink shows which entries survive both checks.

### Arguments used here

level defaults to debug, filters to [], and asyncOutput to false; this example selects warn; the complete standard level set is debug/info/warn/error/fatal; addFilter supplies a removable predicate and setLevel changes the active threshold independently.

```ts doc-test=run
import { Logger, LoggerLevel } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [level({ level: LoggerLevel.warn })]
})
const entries: string[] = []
log.useSink((entry) => {
  entries.push(entry.tag + ':' + entry.message)
})
const off = log.addFilter((entry) => entry.message !== 'private')
log.info('below threshold')
log.warn('private')
log.error('shown')
off()
off()
log.warn('private')
log.setLevel(LoggerLevel.info)
log.info('visible')
console.log(entries.join(','))
await log.shutdown('manual')
```

### Output and boundaries

```text
error:shown,warn:private,info:visible
```

Prints `error:shown,warn:private,info:visible`. The first info entry fails the threshold and the first private warning fails the filter; removing that filter and lowering the threshold each affects later calls.

Defaults are level: debug, filters: [], and asyncOutput: false. Standard levels are debug, info, warn, error and fatal; non-level tags bypass the threshold but still pass through filters. The off function removes matching filter function identities.

## Render an error chain as JSON through the chosen host console

A collector needs parseable JSON with an error name, message and stack. Printing an Error as a plain JSON object can lose its non-enumerable built-in fields.

JSON.stringify(new Error()) usually produces an empty object. A custom console wrapper can also accidentally print JSON to a different host console than the one owned by its logger.

Install color({ format: "json" }) and supply the public runtimeManager.console port. The example borrows all other default capabilities and captures only console output in memory; it performs no file or HTTP write.

### Arguments used here

color defaults to format auto, color auto, timestamp true, colorMessage none, and colorMap undefined; only format json is overridden here; runtimeManager reuses default capabilities except console.log/warn/error, which capture in memory; context defaults to [] and is checkout here.

```ts doc-test=run
import { Logger, getLoggerRuntimeManager } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'

const lines: string[] = []
const capture = (...args: unknown[]): void => {
  lines.push(String(args[0]))
}
const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  context: ['checkout'],
  runtimeManager: {
    ...getLoggerRuntimeManager(),
    console: { log: capture, warn: capture, error: capture }
  },
  plugins: [color({ format: 'json' })]
})
const original = new Error('insufficient balance')
log.log('error', 'checkout failed', original)
await log.flush()
const entry = JSON.parse(lines[0]!)
console.log(entry.tag, entry.context, entry.error.name, entry.error.message)
console.log(typeof entry.error.stack === 'string', Object.hasOwn(entry.error, 'raw'))
await log.shutdown('manual')
```

### Output and boundaries

```text
error checkout Error insufficient balance
true false
```

Prints `error checkout Error insufficient balance` and `true false`. The JSON payload keeps the error name, message and a stack string, while excluding the local raw Error reference.

format defaults to auto, color to auto, timestamp to true, colorMessage to none, and colorMap to no overrides. JSON rendering uses bounded error-chain serialization; nested args and application data still follow ordinary JSON semantics.

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

Logger-owned errors use source @migaia/logger. Complete identities from Plugin Host, middleware, or another owner remain with that owner. LoggerErrorCode has 17 values.

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

## Durable log storage

`memoryLogStore` from `@migaia/logger/plugins/durable` is an atomic, process-local log resource. `fileLogStore` from `@migaia/logger/plugins/durable/file` uses builtin SQLite: `node:sqlite` in Node and Deno, `bun:sqlite` in Bun. The file implementation supports local files on macOS, Linux, and Windows; network filesystems do not receive a locking or durability guarantee. A retained SQLite connection owns the exclusive writer lock until disposal. No storage package or third-party native driver is required.

```ts
import { memoryLogStore, LogRecordState } from '@migaia/logger/plugins/durable'

await using store = memoryLogStore()
const [seq] = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])
await store.setState(seq, LogRecordState.done)
console.log(await store.read(1, 100))
```

Records accept plain JSON data, capture inputs immediately, and return independent snapshots. A batch creates all records and their pending states atomically. Sequence numbers start at one and remain monotonic after prefix truncation. `onAppend` reports one frozen `{ lastSeq, count }` notice after each nonempty append commit. It never publishes state changes or truncation.

Explicit `dispose()` returns a cached Promise that rejects on cleanup failure. The async disposal symbol returns a separate cached Promise that reports failure and resolves. Both share one physical cleanup. The creator owns disposal; installed plugins only borrow the original resource.
