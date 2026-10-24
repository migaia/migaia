# RPC Devtools guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Host guide](../rpc-host/USEGUIDE.en.md)

devtoolsPlugin() installs a feature backed by the original bounded collector. Its query/watch/stats/describe/close conveniences delegate to that same collector. It creates no business connection or separate forwarded probe stream.

## Observe real calls on both sides

Install the same tools object on two real hosts. First next subscribes the watch before the call. Finally, close hosts before explicitly closing the application-owned collector.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })
const parent = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect }), tools],
          provide: { double: (value: number) => value * 2 }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        } finally {
          await child.close()
        }
      }
    }),
    tools
  ]
})
const watch = tools.watch({ stages: ['message'] })
try {
  const next = watch.next()
  console.log(await parent.request('double', 21))
  const batch = await next
  console.log(batch.value?.events.length)
  console.log(tools.stats().methods)
} finally {
  await watch.return(undefined)
  await parent.close()
  tools.close()
}
```

The business result is 42. Event counts depend on qualifying observations from both sides; one call does not imply one record. The same tools object can install in multiple hosts, once per host. Closing one host removes only its observation; the other host and collector continue working.

## Stages, capture, and redaction

Default stages are message and peer. Explicitly enable envelope, encoded, frame, protected, or carrier when needed. Visibility also depends on the actual carrier and stages traversed. Subscribing to stages alone does not retain content. capture defaults to none and must be a subset of stages. redact projects content synchronously at the original emitter.

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

export const tools = devtoolsPlugin({
  stages: ['message', 'peer', 'carrier'],
  capture: ['message'],
  redact: () => ({ redacted: true }),
  maxEvents: 2000,
  maxContentBytes: 1024 * 1024,
  onError: (error) => console.error(error)
})
```

This example replaces all captured content explicitly. Write redaction for your data structure; do not assume credentials are recursively removed automatically. A throwing redactor reports REDACT_FAILED and drops that content without changing completed business results.

methods selects exact methods. sample is a deterministic ratio greater than 0 and at most 1. Pause with collector.pause, not sample: 0. collector.resume restores the saved stages without reviving a closed collector.

## Query, watch, and bounds

query uses a sequence cursor rather than an array position. Pass nextSeq as the next afterSeq even when some scanned rows were filtered out. Default limit is 1000; accepted values are 1 through 1000.

```ts doc-test=check
import type { IRpcDevtools } from '@migaia/rpc-plugin-devtools'

export function readPage(collector: IRpcDevtools, afterSeq: number) {
  const page = collector.query({ afterSeq, limit: 100, stages: ['message'] })
  return { events: page.events, cursor: page.nextSeq, loss: page.counters }
}
```

watch subscribes to future events on first next; query reads retained history. Batches contain at most 256 events, with at most 64 queued batches and a bounded raw pre-filter window. batch.dropped accounts for loss, so slow consumers cannot claim lossless delivery. return ends only that watch and wakes its pending read. collector.close rejects a pending next with CLOSED.

The main ring defaults to maxEvents=10000 and maxContentBytes=8388608. The latter is a main-ring content budget. maxInterned defaults to 65536. Watch/record windows and content/detail/error references have separate ownership; the main-ring limit is not a hard process-memory bound. query.counters explains eviction, content loss, reentrant drops, and intern overflow.

stats accumulates qualifying message events independently of ring eviction. Latency percentiles interpolate bounded histogram buckets rather than exact retained samples. clear resets the main ring, statistics, and counters while preserving sequence progress and record/watch lifetimes.

## Independent recording and NDJSON

Only one recording can be active. It has its own capacity; stop consumes its handle and returns a record. Export/import are pure codecs: they neither persist data nor ingest decoded events into this collector.

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 100 })
try {
  const recording = tools.collector.record({ maxEvents: 200 })
  tools.collector.clear()
  const record = recording.stop()
  const text = tools.collector.exportRecord(record)
  const decoded = tools.collector.importRecord(text)
  console.log(decoded.header.version)
} finally {
  tools.close()
}
```

The v1 header remains { format: 'migaia-rpc-devtools', version: 1 }; package renaming does not change it. collector.exportRecord/importRecord own record encoding and decoding. Bytes use reserved $bytes syntax with canonical base64. Native errors restore names, stacks, and cause chains without generating replacement remote stacks. The format does not promise arbitrary JavaScript class-graph round trips.

## Remote service on an existing host

collector.service is a nested provide object published on an application-owned existing host. Applications own authorization and the business connection. Observation needs no second call endpoint.

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'
import type { IDevtoolsPlugin } from '@migaia/rpc-plugin-devtools'

export function exposeDiagnostics(host: IRpcHost, tools: IDevtoolsPlugin) {
  host.provide({ diagnostics: tools.collector.service })
}
```

capture and exposeContent: true are independent choices. Remote content is hidden by default. Service reads exclude observations from their actual serving host to avoid observing their own queries. The service retains query/watch/stats/describe, record.start/stop, clear, pause, and resume; RPC output uses the original portable/wire conversion.

## Final cleanup and errors

Return owned watches, stop recording, close business hosts, then close the remaining application-owned collector. collector.close is idempotent and leaves business hosts open; host.close likewise leaves the collector open.

The source is rpc.devtools. INVALID_OPTION, CLOSED, RECORD_ACTIVE, RECORD_NOT_ACTIVE, RECORD_FORMAT_INVALID, REDACT_FAILED, and SERVICE_RESULT_INVALID preserve native error types and original causes. Handle or report diagnostic and cleanup failures without replacing the original business failure.
