# Devtools usage guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md)

Contract provides pure event/interface contracts. Host owns business sessions and calls; transports provide real carriers. Devtools is a flow plugin borrowing real events at the canonical probe observe hook; timeout/retry features execute call policies. The application owns the collector without a second observation connection. A Host may have distinct transport namespaces; this example uses only coroutine.

## Observe real calls

This example additionally needs `@migaia/rpc-plugin-coroutines`. Install the same tools on two real parent/child Hosts. The watch's first next subscribes to future events before business begins. Flow plugins go in Host.plugins rather than transport.features.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

async function untilStopped(signal: AbortSignal): Promise<void> {
  let complete!: () => void
  const stopped = new Promise<void>((resolve) => {
    complete = resolve
  })
  signal.addEventListener('abort', complete, { once: true })
  if (signal.aborted) complete()
  try {
    await stopped
  } finally {
    signal.removeEventListener('abort', complete)
  }
}

const tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })
const task: ICoroutineUserTask = async ({ connect, signal }) => {
  const child = await createRpcHost({
    plugins: [tools, coroutinePlugin({ connectToParent: connect })],
    provide: { double: (value: number) => value * 2 }
  })
  try {
    await untilStopped(signal)
  } finally {
    await child.close()
  }
}

type IWorkerApi = { double(value: number): number }
const plugins = [tools, coroutinePlugin({ spawn: task })] as const
const parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
const watch = tools.watch({ stages: ['message'] })
try {
  const next = watch.next()
  console.log(await parent.coroutine.request('double', 21))
  console.log((await next).value?.events.length)
  console.log(tools.stats().methods)
} finally {
  await watch.return(undefined)
  await parent.close()
  tools.close()
}
```

The business call returns 42. Event counts depend on actual eligible observations at both ends, rather than one event per business call. Default message/peer/forward observes this call. Other stages require explicit selection and true facts from the actual carrier.

## Capture, redaction, queries, and service

```ts doc-test=check
import { devtoolsPlugin, type IRpcDevtools } from '@migaia/rpc-plugin-devtools'
import type { IRpcHost } from '@migaia/rpc-host'

export const tools = devtoolsPlugin({
  stages: ['message', 'peer', 'carrier'],
  capture: ['message'],
  redact: () => ({ redacted: true }),
  maxEvents: 2000,
  maxContentBytes: 1024 * 1024,
  onError: (error) => console.error(error)
})

export function readPage(collector: IRpcDevtools, afterSeq: number) {
  const page = collector.query({ afterSeq, limit: 100, stages: ['message'] })
  return { events: page.events, cursor: page.nextSeq, loss: page.counters }
}

export function exposeDiagnostics(host: IRpcHost) {
  host.provide({ diagnostics: tools.collector.service })
}
```

This explicitly replaces captured content. Redact runs synchronously; failures report REDACT_FAILED and discard that content without changing the business result. Methods match exactly. Sample is greater than zero and at most one; use collector.pause to pause. Resume restores previous stages without reviving a closed collector.

query.afterSeq is an exclusive sequence cursor. Continue from page.nextSeq, which includes scanned rows excluded by filters. Limit defaults to 1000 and ranges from 1–1000. Watch subscribes from first next rather than reading history. Each batch holds at most 256 events, with 64 queued batches; batch.dropped reports loss. Return ends only its watch; collector.close rejects pending next with CLOSED.

Main-ring defaults are maxEvents10000, maxContentBytes8388608, maxInterned65536. Watch, record, and content/detail/error references have separate ownership. Ring capacity does not imply arbitrary graph deep-copying or a process-wide memory bound. query.counters reports eviction, content loss, reentrant loss, sampling, and intern overflow.

collector.service is a nested provide object. Applications own authorization; remote reads hide captured content unless exposeContent:true. Service reads exclude observations of their actual serving Host to avoid query recursion. Observation does not require another business Host.

## Recording and NDJSON

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 100 })
try {
  const recording = tools.collector.record({ maxEvents: 200 })
  tools.collector.clear()
  const record = recording.stop()
  const text = tools.collector.exportRecord(record)
  console.log(tools.collector.importRecord(text).header.version)
} finally {
  tools.close()
}
```

Only one recording is active at a time, and stop consumes its handle. Clear resets the main ring, statistics, and counters while retaining sequence progress and record/watch lifetime. Stats accumulates eligible message events without subtracting ring eviction; latency quantiles interpolate bounded histogram buckets.

The record header remains `{ format: 'migaia-rpc-devtools', version: 1 }`. Export/import is pure NDJSON encoding, without persistence or reinjecting events. Bytes and error graphs follow the record contract; arbitrary JavaScript class graphs are not promised lossless roundtrip.

## Cleanup and boundaries

End your watches and recording, close business Hosts, then close the caller-owned collector. A Host installation owns only its emitter cleanup; collector.close does not close business Hosts. Consumers retaining a reusable synchronous emit view must read or copy fields according to the public probe contract.

Import custom probes from `@migaia/rpc-host/plugins/probe` and deployment SDK from `@migaia/rpc-host/sdk`. Physical carrier/protected stages depend on actual paths, without semantic messages presented as raw data. Diagnostics must not replace business results. Errors use source rpc.devtools, including INVALID_OPTION, CLOSED, RECORD_ACTIVE/RECORD_NOT_ACTIVE, RECORD_FORMAT_INVALID, REDACT_FAILED, SERVICE_RESULT_INVALID, with original native type and cause.

Forwarding rows are included by default. Query or record the ordered rows and correlate `messageId`, `route`, and the caller’s optional `trace` to inspect each host’s `hop`, `maxHops`, and refusal reason. The existing ring copies borrowed routes when retaining rows; live probe callbacks still borrow them.

Raw endpoint/method statistics retain at most 4096 pairs, independently of the event ring and name table. New pairs evict the earliest first insertion; updating an existing pair does not refresh its age. `stats().evictedPairs` reports the number of raw pairs evicted in the current clear epoch; `clear()` resets it to zero.
