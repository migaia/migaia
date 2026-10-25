# `@migaia/rpc-plugin-devtools`

Retain real RPC observations as bounded events, cumulative statistics, watches, and independent recordings.

Contract defines pure protocol rules and interfaces. Host owns sessions, providers, and call settlement; transports acquire real carriers. Devtools is a flow plugin consuming readonly observation through the canonical probe implementation, without a business connection. Features such as timeout and retry attach to their owning plugin and execute call policies.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Collector basics

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-devtools
```

The factory creates a caller-owned collector. This demonstrates actual recording controls without manufacturing business events.

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 1000 })
try {
  const recording = tools.collector.record({ maxEvents: 2000 })
  tools.collector.pause()
  console.log(tools.describe().paused)
  tools.collector.resume()
  console.log(tools.describe().paused)
  const text = tools.collector.exportRecord(recording.stop())
  console.log(tools.collector.importRecord(text).header.version)
} finally {
  tools.close()
}
```

It prints `true`, `false`, and `1`. Observe real work by installing the same tools with a selected transport in `createRpcHost({ plugins: [tools, transport] })`; see the guide for a complete Coroutine example. No additional probe forwarding plugin is needed.

## Installation and ownership

One tools object may be installed on several real Hosts. Each installation has its own observation lifetime and feeds the same collector. Install that definition once per Host. A Host allows transports with distinct namespaces; calls remain under `host.<ns>.*`, without root call methods added by Devtools.

Host.close removes its observation. The application calls tools.close or collector.close after all uses end. Collector closure does not close business Hosts. Convenience query/watch/stats/describe/close methods borrow the same collector. Use tools.collector for pause/resume, record, clear, export/import, and service.

## Observation and retention

| API / option         | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `stages`             | Default message/peer/forward; explicitly enable other physical/envelope stages |
| `capture` / `redact` | Explicit content capture and synchronous content projection                    |
| `methods` / `sample` | Exact method selection and deterministic sampling, 0 < sample ≤ 1              |
| `maxEvents`          | Main ring capacity, default 10000                                              |
| `maxContentBytes`    | Main content budget, default 8 MiB                                             |
| `query` / `watch`    | Sequence-based history / future events from first next                         |
| `stats`              | Cumulative eligible message statistics, unaffected by ring eviction            |
| `record`             | Independent bounded window, exportable after stop                              |

Stages alone do not capture content; capture must be a subset of stages. Raw carrier events require actual carrier observation capability rather than semantic frames relabelled as native data. Read watch/eviction loss alongside events. A main-ring bound is not a process-memory ceiling.

The package root exports devtoolsPlugin, collector/options types, and error identity. Record format is migaia-rpc-devtools version 1. Use collector.exportRecord/importRecord; neither persists data nor reinjects imported events. Custom observation uses `@migaia/rpc-host/plugins/probe`; raw carrier deployment uses `@migaia/rpc-host/sdk`.

Applications may explicitly provide collector.service on an existing Host, with their own authorization. Capture and exposeContent are independent settings. Errors use source rpc.devtools while preserving native types and cause. See the [usage guide](./USEGUIDE.en.md).

Forwarding rows are included by default. Query or record the ordered rows and correlate `messageId`, `route`, and the caller’s optional `trace` to inspect each host’s `hop`, `maxHops`, and refusal reason. The existing ring copies borrowed routes when retaining rows; live probe callbacks still borrow them.
