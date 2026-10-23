# `@migaia/rpc-plugin-devtools`

Observe real host calls through bounded events, cumulative statistics, incremental watches, independent recording, and offline timelines.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Why use it

- Event eviction does not subtract cumulative calls, and clear does not stop independent recording.
- A `devtoolsPlugin` installs the original collector on the host without another business connection or forwarding emitter.
- Logical/physical stages, content capture, redaction, and remote content exposure remain explicit choices.
- The existing NDJSON codec retains bytes and error chains. Hub borrows existing clients or offline records without creating connections.

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-devtools
```

Keep the feature's same collector. This example demonstrates recording controls without fabricating business events:

```ts doc-test=run
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 1000 })
const collector = tools.collector
const recording = collector.record({ maxEvents: 2000 })
collector.pause()
console.log(collector.describe().paused)
collector.resume()
console.log(collector.describe().paused)
const text = collector.exportRecord(recording.stop())
console.log(collector.importRecord(text).header.version)
collector.close()
```

It prints `true`, `false`, and `1`. To observe real traffic, install tools beside the transport with `createRpcHost({ plugins: [transport, tools] })`. transport is the actual result of your chosen [process](../rpc-plugin-process/README.en.md), [thread](../rpc-plugin-thread/README.en.md), [browser](../rpc-plugin-browser/README.en.md), or [coroutine](../rpc-plugin-coroutines/README.en.md) plugin factory.

## Installation and ownership

The same tools object can be installed on two hosts, merging both sides' original observations into one collector. A host can install this feature definition only once. host.close withdraws that host's observation without closing the collector; the application explicitly calls collector.close after observation ends. Closing the collector does not close business hosts.

`tools.query/watch/stats/describe/close` delegate directly to that collector. Use `tools.collector` for pause/resume, clear, record, export/import, and service; they do not create another state owner.

## Observation and retention

| API / option                      | Behavior                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `stages`                          | Defaults to message and peer; explicitly enable envelope/encoded/frame/protected/carrier                    |
| `capture` / `redact`              | Explicit captured stages and synchronous content projection; selecting stages alone does not retain content |
| `methods` / `sample`              | Method filtering and deterministic sampling; 0 < sample <= 1                                                |
| `maxEvents`                       | Default 10000, bounding main-ring event count                                                               |
| `maxContentBytes`                 | Default 8 MiB main-ring content budget, not a process-wide memory bound                                     |
| `query({ afterSeq, limit, ... })` | Reads the ring by sequence cursor; default limit=1000                                                       |
| `watch(filters?)`                 | First next subscribes; batches contain events and dropped; return ends only that watch                      |
| `stats()`                         | Cumulative eligible method counts and latency buckets survive ring eviction                                 |
| `record({ maxEvents? })`          | Independent retention window; stop produces an exportable record                                            |
| `pause/resume/clear`              | Pause/restore stages or reset the ring and cumulative values without closing business work                  |

Watch and recording retain separate bounded windows; loss counters are not zero-loss guarantees. Nested content, detail, and error can remain references. Ring capacity is neither a deep copy of arbitrary object graphs nor a global memory budget. Slow watchers can lose batches; collector.close wakes waiting watches with CLOSED.

## Retained entries

| Entry       | Purpose                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Root        | `devtoolsPlugin`, collector/options types, and error identity                                        |
| `/contract` | Wire/service/record types, NDJSON format, and encode/decode                                          |
| `/hub`      | `createRpcDevtoolsHub`: existing clients, clock alignment, timeline/interactions, and offline import |
| `/log`      | `createRpcLogProbe`: synchronous qualifying fields for an application-owned structured logger        |

Record v1 retains format `migaia-rpc-devtools`; package renaming does not change the recording grammar. Hub does not close borrowed clients, invent missing events, or replay business calls. Log probe owns no files, batching, or flush; the logger owns actual I/O and final shutdown.

## Remote access and errors

The application can publish `collector.service` through an existing host's nested provide. The application owns authorization. `capture` and `exposeContent: true` are independent choices. Service reads exclude observations from their actual serving host; the application chooses the existing host that publishes them. The remote boundary uses existing portable/wire conversion, not arbitrary lossless JavaScript graph transport.

The source is `rpc.devtools`. INVALID_OPTION, CLOSED, RECORD_ACTIVE/RECORD_NOT_ACTIVE, RECORD_FORMAT_INVALID, REDACT_FAILED, TARGET_DUPLICATE/TARGET_UNKNOWN, TARGET_RELEASE_FAILED, and SERVICE_RESULT_INVALID preserve native types and original causes. Diagnostic callback failures are reported without changing completed business results. See the [usage guide](./USEGUIDE.en.md).
