# `@migaia/rpc-devtools` usage guide

Choose an operational task below. Collector/log examples observe real Core Endpoints over the public memory transport; offline examples supply complete v1 records without inventing hosts or connections.

## Find a scenario

| Scenario                                                     | API                       | Details                                                                           |
| ------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| Keep recent RPC events without losing cumulative call counts | `createRpcDevtools`       | [Complete example](#keep-recent-rpc-events-without-losing-cumulative-call-counts) |
| Clear the live view without ending an active recording       | `createRpcDevtools`       | [Complete example](#clear-the-live-view-without-ending-an-active-recording)       |
| Round-trip captured bytes and a native error chain           | `encodeRpcDevtoolsRecord` | [Complete example](#round-trip-captured-bytes-and-a-native-error-chain)           |
| Sort a nonmonotonic recording before limiting the timeline   | `createRpcDevtoolsHub`    | [Complete example](#sort-a-nonmonotonic-recording-before-limiting-the-timeline)   |
| Mark missing interaction sides instead of inventing them     | `createRpcDevtoolsHub`    | [Complete example](#mark-missing-interaction-sides-instead-of-inventing-them)     |
| Redact real RPC log fields while isolating a failing sink    | `createRpcLogProbe`       | [Complete example](#redact-real-rpc-log-fields-while-isolating-a-failing-sink)    |

## Running the examples

```bash
pnpm add @migaia/rpc-devtools @migaia/rpc-core @migaia/rpc-contract
```

Run each snippet as an independent Node 24 TypeScript module. All imports use public entries; memory transports are real Core carriers, while records are complete offline inputs. Examples create no external network connection and perform no file writes. Endpoints, collectors, and hubs have separate cleanup owners.

## Keep recent RPC events without losing cumulative call counts

Long-running diagnostics need recent events, but the total call count must not disappear when older events leave the screen.

Using one bounded event list as the source of every statistic makes cumulative counts shrink whenever old entries are evicted.

Attach the collector through probePlugin to a real Endpoint; maxEvents bounds query retention while stats keeps completed method counts separately.

```ts doc-test=run
import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createRpcDevtools } from '@migaia/rpc-devtools'

const devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect()],
  provider: { double: (context) => context.success((context.data as number) * 2) }
})
const client = await createEndpoint({
  id: 'client',
  transport: left,
  middlewares: [connect(), probePlugin(devtools)]
})
try {
  for (const value of [1, 2, 3]) await client.send('server', 'double', value)
  const page = devtools.query({ methods: ['double'], limit: 2 })
  console.log(page.events.length)
  console.log(devtools.stats().methods.find((row) => row.method === 'double')?.calls)
  console.log(page.counters.evicted > 0)
} finally {
  await Promise.all([client.dispose(), server.dispose()])
  devtools.close()
  left.close()
}
```

Output:

```text
2
3
true
```

The output is 2, 3, true: two recent events remain, all three completed calls are counted, and older entries have been evicted.

The example overrides the default 10000-event ring with capacity 2 and selects message events only. Aggregates survive eviction until clear; this is a retention guarantee, not a total process-memory bound.

### Example parameters

collector.stages selects only message here instead of the message/peer default. maxEvents is 2 rather than 10000. query.methods=['double'] selects actual method-bearing rows and limit=2 overrides 1000. The public memory pair is a real transport. Endpoint ids are client/server with left/right transports; connect uses its Endpoint's transport and probePlugin installs devtools. provider.double reads context.data and returns twice it with success; send supplies target, method, and data. Without timeout middleware, Core uses its 1000 ms fallback. Endpoint disposal leaves the borrowed pair open; left.close finally closes both sides.

## Clear the live view without ending an active recording

An operator clears a noisy live view while a recording window must keep the evidence collected before that reset.

Sharing the same storage for display and recording lets a harmless UI reset erase the investigation data.

Start record with its own capacity, observe a real request, and clear the main collector before stopping and exporting that recording.

```ts doc-test=run
import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createRpcDevtools } from '@migaia/rpc-devtools'

const devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect()],
  provider: { echo: (context) => context.success(context.data) }
})
const client = await createEndpoint({
  id: 'client',
  transport: left,
  middlewares: [connect(), probePlugin(devtools)]
})
try {
  const recording = devtools.record({ maxEvents: 64 })
  await client.send('server', 'echo', 42)
  devtools.clear()
  console.log(devtools.query().events.length, devtools.stats().methods.length)
  const record = recording.stop()
  const restored = devtools.importRecord(devtools.exportRecord(record))
  console.log(record.events.length > 0)
  console.log(restored.events.length === record.events.length)
} finally {
  await Promise.all([client.dispose(), server.dispose()])
  devtools.close()
  left.close()
}
```

Output:

```text
0 0
true
true
```

The output is 0 0, true, true: the main ring and statistics are empty, the independent record still contains events, and its exported text imports with the same event count.

record capacity defaults to the collector's maxEvents; this example sets it to 64. clear does not end recording or reset sequence numbers; stop is single-use and close discards an active recording.

### Example parameters

Endpoint and probe installation match the preceding example. record.maxEvents defaults to the main capacity, here overridden from 2 to 64. echo returns payload 42. clear resets the main ring/statistics without stopping recording. A successful recording.stop consumes its active ownership. exportRecord/importRecord only encode/decode v1 without file I/O. finally separately closes Endpoints, collector, and memory pair.

## Round-trip captured bytes and a native error chain

An offline diagnostic file must retain byte payloads and the cause behind a failed operation.

Ordinary JSON turns typed bytes into object fields and loses non-enumerable Error properties, leaving the imported incident incomplete.

Encode the full v1 record with encodeRpcDevtoolsRecord and decode it through the matching codec, which handles reserved byte tags and the native error graph.

```ts doc-test=run
import * as format from '@migaia/rpc-devtools/contract'

const causeText = 'invalid field'
const failureText = 'request failed'
const cause = new TypeError(causeText)
const failure = new Error(failureText, { cause })
Object.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })
Object.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })
const text = format.encodeRpcDevtoolsRecord({
  header: format.RpcDevtoolsRecordFormat,
  events: [
    {
      seq: 1,
      at: 10,
      endpointId: 'client',
      stage: 'message',
      direction: 'outbound',
      content: new Uint8Array([1, 2, 3]),
      error: failure
    }
  ]
})
const restored = format.decodeRpcDevtoolsRecord(text)
const error = restored.events[0]?.error
console.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)
console.log(error instanceof Error && error.stack === failure.stack)
console.log([...(restored.events[0]?.content as Uint8Array)].join(','))
```

Output:

```text
true true
true
1,2,3
```

The output is true true, true, then 1,2,3: decoding restores the native Error and TypeError cause, keeps the recorded stack, and restores the byte values.

The codec transforms an offline representation and performs no file I/O. A sole $bytes object is reserved v1 syntax; arbitrary objects, prototypes, and functions do not have a general lossless round-trip guarantee.

### Example parameters

record.header uses RpcDevtoolsRecordFormat. Each event requires finite numeric seq/at and string endpointId/stage/direction. content contains bytes [1,2,3], and error is a native Error with its original cause. Object.defineProperties adds example diagnostic source/code without granting control authority. The encoder/decoder each take one input. Restored Errors retain recorded stacks rather than original object identity.

## Sort a nonmonotonic recording before limiting the timeline

An imported recording has timestamps out of sequence, but the operator asks for the earliest two events.

Taking two rows before sorting can return a later event while silently excluding an earlier retained one.

Import the valid recording as an offline target; timeline sorts all retained candidates before applying its result limit.

```ts doc-test=run
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import * as format from '@migaia/rpc-devtools/contract'

const text = format.encodeRpcDevtoolsRecord({
  header: format.RpcDevtoolsRecordFormat,
  events: [50, 10, 30].map((at, index) => ({
    seq: index + 1,
    at,
    endpointId: 'client',
    stage: 'message',
    direction: 'outbound'
  }))
})
const hub = createRpcDevtoolsHub()
try {
  hub.importRecord('saved', text)
  console.log(hub.status('saved'))
  const events = hub.timeline({ targets: ['saved'], limit: 2 })
  console.log(events.map((event) => event.alignedAt).join(','))
  console.log(events.every((event) => event.uncertaintyMs === undefined))
  console.log((await hub.stats('saved')).methods.length)
} finally {
  await hub.close()
}
```

Output:

```text
offline
10,30
true
0
```

The output is offline, 10,30, true, 0: the earliest two timestamps are selected, clock uncertainty is unavailable, and offline data does not invent aggregate statistics.

Offline alignedAt equals the recorded at value. maxEvents defaults to 50000 per target; no remote connection, clock alignment, or periodic realignment is started by importRecord.

### Example parameters

File sequence remains 1..3 while at deliberately uses 50/10/30; timestamps need not be monotonic. Omitted Hub options mean maxEvents=50000 per target, realignMs=undefined, and onError=undefined with console.error reporting. saved is a unique target name. timeline.targets selects it and limit=2 applies after ordering; no limit is the default. Offline uncertaintyMs is undefined and stats does not reconstruct cumulative counts from events.

## Mark missing interaction sides instead of inventing them

Two diagnostic files may contain opposite sides of one call, while a missing file leaves only one side visible.

Joining solely by method name can combine unrelated calls, and filling the missing side creates evidence that was never observed.

The hub correlates explicit senderId and messageId with trace filtering; removing a target updates that same retained interaction index.

```ts doc-test=run
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import * as format from '@migaia/rpc-devtools/contract'

const outbound = {
  seq: 1,
  at: 10,
  endpointId: 'client',
  stage: 'message',
  direction: 'outbound',
  kind: 'request',
  senderId: 'client',
  messageId: 'call-1',
  method: 'load',
  trace: 'trace-1'
}
const inbound = { ...outbound, at: 11, endpointId: 'server', direction: 'inbound' }
const encode = (event: typeof outbound) =>
  format.encodeRpcDevtoolsRecord({ header: format.RpcDevtoolsRecordFormat, events: [event] })
const hub = createRpcDevtoolsHub()
try {
  hub.importRecord('caller', encode(outbound))
  console.log(hub.interactions('trace-1')[0]?.oneSided)
  hub.importRecord('provider', encode(inbound))
  const interaction = hub.interactions('trace-1')[0]
  console.log(interaction?.oneSided, interaction?.targets.join(','))
  await hub.removeTarget('provider')
  await hub.removeTarget('provider')
  console.log(hub.status('provider'), hub.interactions('trace-1')[0]?.oneSided)
} finally {
  await hub.close()
}
```

Output:

```text
true
false caller,provider
removed true
```

The output is true, false caller,provider, then removed true: one file is one-sided, the matching second file completes the observed pair, and removing it makes the interaction one-sided again.

Only retained request/response roles establish observed sides. The hub propagates no trace and starts no business request; a successfully removed target can be removed again without recreating it.

### Example parameters

Both records share senderId=client, messageId=call-1, and trace=trace-1; endpointId and direction establish caller/provider roles. A matching method name alone is insufficient. Hub imports caller/provider, and interactions(trace) filters retained evidence. removeTarget(provider) clears indexes before joining owned watch cleanup; this offline example owns no remote watch. Repeating successful removal is harmless.

## Redact real RPC log fields while isolating a failing sink

Diagnostics need selected RPC content, but logging must not expose the original data or change a successful business result.

Keeping a reusable probe view lets later events overwrite queued fields, while an uncaught logger error can disrupt the caller.

Install createRpcLogProbe through the real Core emitter with capture, redact and onError; it extracts fields synchronously and reports sink failures separately.

```ts doc-test=run
import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createRpcLogProbe } from '@migaia/rpc-devtools/log'

const failureText = 'log sink failed'
const failure = new Error(failureText)
const masked = { hidden: true }
const fieldsSeen: object[] = []
const reports: unknown[] = []
const logger = {
  debug() {},
  info() {},
  error() {},
  warn(_message: string, fields: object) {
    fieldsSeen.push(fields)
    throw failure
  }
}
const probe = createRpcLogProbe(logger, {
  stages: ['message'],
  capture: ['message'],
  slowMs: 0,
  redact: () => masked,
  onError: (error) => {
    reports.push(error)
  }
})
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect()],
  provider: { echo: (context) => context.success(context.data) }
})
const client = await createEndpoint({
  id: 'client',
  transport: left,
  middlewares: [connect(), probePlugin(probe)]
})
try {
  console.log(await client.send('server', 'echo', 42))
  console.log(
    fieldsSeen.length > 0,
    fieldsSeen.every((fields) => Reflect.get(fields, 'content') === masked)
  )
  console.log(new Set(fieldsSeen).size === fieldsSeen.length)
  console.log(
    reports.length === fieldsSeen.length,
    reports.every((error) => error === failure)
  )
} finally {
  await Promise.all([client.dispose(), server.dispose()])
  left.close()
}
```

Output:

```text
42
true true
true
true true
```

The output is 42, true true, true, true true: the request succeeds, qualified logs contain the redacted object, each field object is separate, and every sink failure is reported by original identity.

slowMs defaults to undefined, so normal settled calls are omitted; this example uses 0 to include them. Capture is off by default, redaction replaces content by reference, and buffering or external I/O belongs to the sink.

### Example parameters

The logger supplies all four methods. warn retains each independent fields object and throws the same failure; onError retains that exact exception. stages is message, capture explicitly enables message rather than its default absence, and slowMs=0 includes successful calls that undefined normally omits. redact returns the same masked object by reference. With no levels override, slow maps to warn. The real Endpoint's probePlugin connects the probe to Core; no event view is fabricated, and echo still returns 42.

## Contract details

### Ownership and four entries

| Entry                         | Purpose                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| @migaia/rpc-devtools          | createRpcDevtools, collector types, and error identity                                            |
| @migaia/rpc-devtools/contract | Service/wire/record types, RpcDevtoolsRecordFormat, record encode/decode, and error identity      |
| @migaia/rpc-devtools/hub      | createRpcDevtoolsHub, targets, clock alignment, timeline, interactions, stats, and offline import |
| @migaia/rpc-devtools/log      | createRpcLogProbe and the structural logger boundary                                              |

The collector is itself a Core Probe, a synchronous observation interface. It creates no Peer, transport, persistent storage, or file. defineProbe's host form attaches compiled fields to the same object and freezes it without changing identity. Install it on an existing Endpoint/Peer and manage the connection and collector separately. Core observation, Peers, managed sources, and pool members share that probe contract.

Hub accepts existing service clients or offline records; it creates no connections, reconnection supervisor, or business retries. The log probe selects events and extracts fields while the logger owns buffering and output. This workspace-private package has rpc-core/rpc-contract peer dependencies that consumers should declare directly. There is no runtime package-version equality check. Publishing retains dist and the four entries.

### Collector options and ingestion

| Option          | Exact default and supported domain                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| stages          | ['message','peer']; enable envelope/encoded/frame/protected/carrier explicitly, including through setStages           |
| capture         | undefined, no content; selecting stages alone does not enable capture                                                 |
| redact          | undefined; synchronously transforms selected content, reporting REDACT_FAILED/cause and discarding content on failure |
| methods         | undefined, no name filter; filters message/envelope rows with a method, while methodless control variations pass      |
| sample          | undefined, equivalent to full sampling at 1; 0<sample≤1, so 0 cannot pause collection                                 |
| maxEvents       | 10000; positive safe integer ≤4294967295, bounding the main query ring                                                |
| maxContentBytes | 8*1024*1024; nonnegative safe integer, bounding only main-ring content                                                |
| maxInterned     | 65536; positive safe integer ≤94906264, bounding the reader name table                                                |
| exposeContent   | false; permits content across the service boundary separately from capture                                            |
| onError         | undefined; Core's host reporter handles failures unless a callback is supplied                                        |

Invalid options use this package's INVALID_OPTION TypeError. Actual allocation still depends on host memory. Logical message/peer events are the defaults; physical frames are not implicitly recorded, and ingestion has no separate sync/async mode.

emit(view) consumes top-level metadata into owned raw columns before returning. Strings retain references; the reusable emitter view is not retained. Ingestion performs no name interning, refcount work, carrier-sequence translation, or per-watcher enqueue. Query, watch delivery, stats, record.stop, export, and service boundaries derive names, associations, and wire representations when needed. Never hand a reusable view to asynchronous processing.

Optional message/envelope variation preserves the original route subtype, including ping, pong, close, abort, and registered user names. abort has kind cancel; other variations are control. Request/response and other stages omit it, while query/watch/wire/record codecs retain it.

detail, error, and captured content that was not actually transferred remain references; later mutation can affect reads. snapshotProbeEvent copies only top-level metadata rather than deep-copying those values. Content charges use UTF-8 string length, ArrayBuffer/View.byteLength, or an opaque object's supplied view.sizeBytes. Unknown opaque sizeBytes=-1 costs 0 without traversing or encoding its graph. Recording/watch references are outside the main-ring budget, so maxContentBytes is not a process-wide, cross-window, or arbitrary-object-graph memory bound.

### Query, stats, pause, and watch

query(input?) returns {events,nextSeq,counters} after one retained-ring scan. nextSeq is the next afterSeq cursor, not an array index. Counters are evicted, contentDropped, droppedReentrant, sampledOut, ignoredWhilePaused, ignoredAfterClose, and internOverflow, recording retention loss, content loss, reentry, sampling, lifecycle ignores, and name overflow.

| Query field           | Default and meaning                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| afterSeq              | 0; nonnegative safe integer, selecting greater sequence numbers                                      |
| limit                 | 1000; safe integer in 1..1000                                                                        |
| stages / outcomes     | undefined selects all; an empty array matches nothing; names use Core's public stage/outcome domains |
| methods / endpointIds | undefined applies no filter; arrays match the corresponding field                                    |
| trace                 | undefined applies no filter; a supplied string matches exactly                                       |

Construction methods filter ingestion. Query/watch methods match actual method-bearing rows, so a reader method filter excludes methodless control events. When the reader name table fills, new names use overflow id 0 and increment internOverflow; existing names remain readable. maxInterned does not bound cumulative raw endpoint/method keys, which survive until clear and can grow as unique combinations grow.

Only settled/failed/rejected message events containing a method and nonnegative durationMs synchronously update stats, once per qualifying event. Per-endpoint/method calls, failed, rejected, timedOut, and aborted counts survive main-ring eviction. failed includes every outcome=failed event, while timedOut/aborted add separate classifications, so those counters are not disjoint categories to sum into total calls. Latency uses 24 log2 buckets at 0.0625 ms×2^k, k=0..23. Percentiles interpolate inside buckets; the terminal bucket is open above latencyOverflowFromMs=262144 ms, and p50/p95/p99 are clamped to observed latencyMaxMs. There is no fixed-width terminal-bucket error guarantee. describe.now and Core event at use monotonic milliseconds by default, whereas stats.since is wall time.

pause saves current stages and clears the emitter mask; repeated pause does not overwrite that choice. resume restores it, including stages set after construction. Direct emit during pause increments ignoredWhilePaused. clear resets the main ring, cumulative stats, and loss counters without ending independent recording/watch ownership; sequence numbers remain collector-owned.

watch(input?) omits afterSeq/limit and activates a consumer on first next. Active watchers share a 16384-row raw pending window. Each synchronous burst schedules at most one microtask notification; no active watchers means no notification. The raw window retains rows before notification applies each watcher's filters. Batches contain at most 256 events, with at most 64 queued batches per consumer; overflow drops the oldest batch. In {events,dropped}, dropped combines pre-filter raw overwrite and post-filter consumer batch loss, so it cannot reconstruct exact filter-matching loss.

Raw loss is assigned to watchers active at notification time. A watcher whose first next occurs after a burst was scheduled but before delivery can see pre-subscription raw loss. This is a current source limitation rather than a promise of exact post-subscription accounting. iterator.return wakes its own pending next and ends normally without closing the collector; collector.close terminates waiting watches with CLOSED.

### Recording, service, and offline format

record({maxEvents?}) defaults to the main maxEvents but owns a separate ring. Main-ring clear/eviction does not stop recording, and only one recording may be active. handle.stop returns IRpcDevtoolsRecord. Repeated stop or a stale handle fails with RECORD_NOT_ACTIVE; overlapping record fails with RECORD_ACTIVE. collector.close discards an unfinished recording and idempotently releases collector state without closing a business Peer. Closed query/stats/describe and controls reject with CLOSED; direct emit only increments ignoredAfterClose. exportRecord/importRecord remain pure codec entry points.

Attach devtools.service to a separate existing Peer's provide:{devtools:devtools.service}. Remote methods are devtools.describe/query/watch/stats/record.start/record.stop/clear/pause/resume; consume watch with Peer.stream. Service record.stop returns encoded text, unlike the local handle's record object. Content is hidden by default. Capture and exposeContent:true are separate decisions, with redaction and remote access authorization still owned by the application.

Service uses actual context.localEndpointId to exclude its serving endpoint from later ingestion and retained query/stats results. It does not drop legitimate business events merely named devtools.*. A separate service Peer keeps business endpoints observable. Remote watch cancellation uses the original stream signal. Service converts at the JSON/portable boundary: serialized Error chains and byte tags survive, undefined/functions and class prototypes do not, and BigInt becomes a string. This is not lossless arbitrary JS graph transfer. Conversion failure throws TypeError/SERVICE_RESULT_INVALID with the original cause.

RpcDevtoolsRecordFormat is {format:'migaia-rpc-devtools',version:1}. encodeRpcDevtoolsRecord returns UTF-8-compatible NDJSON: one header line, one event per following line, and a terminal newline. decodeRpcDevtoolsRecord accepts an optional terminal newline but rejects interior empty lines. Events require finite numeric seq/at and string endpointId/stage/direction. The codec neither sorts file order nor aligns timestamps. Invalid headers, versions, events, JSON, or byte tags fail with RECORD_FORMAT_INVALID/cause; no persistence resource is created.

ArrayBuffer/Uint8Array use {$bytes:base64}. At any event depth, a sole-key object of that shape is reserved v1 syntax decoded as Uint8Array; invalid or noncanonical Base64 is rejected. To preserve an ordinary object with that shape, store its JSON.stringify text and JSON.parse it after import. There is no automatic escaping or general lossless content:unknown graph guarantee.

Record.error accepts native Error or serialized IRpcWireError. Encoding reuses the RPC error codec to preserve source/code/name/message/stack/cause and aggregate members, normalizing already-serialized errors. Decoding restores native Errors without regenerating stacks. Service wire event.error stays serialized; Hub offline import converts restored Errors back through that same wire owner.

### Hub: existing clients, clocks, and queries

| Hub option | Default and meaning                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| maxEvents  | 50000; positive safe integer ≤4294967295, independently per target                                                |
| realignMs  | undefined, registration-only alignment; a positive finite number, including fractions, enables periodic alignment |
| onError    | undefined, default console.error; reporter failure remains observable with the original failure                   |

addTarget(name,client) requires a nonempty unique name and an existing request/stream client. Hub calls request('describe'/'query'/'stats') and stream('watch') without creating connections. If the service uses nested devtools.* paths, map them at the supplied client boundary rather than creating another Peer inside Hub.

Alignment takes five sequential describe samples and selects the smallest RTT: offset=remoteNow-(t0+t1)/2, uncertaintyMs=RTT/2, alignedAt=event.at-offset. This assumes symmetric delay and is not an error-free clock. Custom samples must share their events' clock domain; one sample cannot align mixed domains. Realignment commits only after all samples succeed and updates retained timeline wrappers, so previously returned references can observe new alignedAt values.

Initialization starts the sole watch's first read before paginated historical catch-up at 1000 events per page, then consumes that already-started watch and deduplicates by seq. It retains the collector's existing bounded queue. status/on('status') use connecting/connected/disconnected/offline/removed lifecycle values rather than error codes. Omitting the status name returns a new status Map. on('event') delivers stored wrappers as events arrive; a listener failure is reported without skipping later listeners.

timeline({targets,stages,trace,method,from,to,limit}) applies no filters by default. from/to use aligned time. limit is a nonnegative safe integer; 0 returns nothing. Ordered target rings are checked then k-way merged. Valid nonmonotonic events are fully sorted before limit. Global ordering is alignedAt, target name, then seq, without changing source file order or event identity.

interactions(trace?) associates explicit traces and (senderId,messageId) rather than automatically propagating trace. oneSided follows request/response business-role evidence, not target count: two endpoints inside one target can prove both sides, while repeated caller recordings cannot manufacture the provider side. Hub infers no missing events and replays no business calls. stats(name) forwards a live target's original result. stats() sums counts and histogram buckets before calculating percentiles rather than averaging p50/p95/p99. Existing maxima survive; missing legacy maxima are not invented.

importRecord(name,text) creates a readonly offline target with alignedAt=original at and uncertaintyMs=undefined; recorded offsets are not restored. Record v1 contains no cumulative stats, so offline stats is {since:0,methods:[]} and aggregate queries invent no offline counts. timeline/interactions arrays reuse stored wrappers and internal events; detail/error/untransferred content remain references. Do not mutate readonly query results. The codec is the independent text-representation boundary.

### Correlation retention and lifetime failures

carrierSeq refers only to a carrier row in the same collector/target. At read boundaries, Collector translates Core-local ordinals using origins retained by the main ring, recording, and watch windows; it maintains no additional ingestion-time generation history. An origin evicted everywhere before first resolution cannot be recovered. Known links survive while their dependent rows remain. A cold read detecting source-sequence reset records the old origin's cutoff, preventing old rows from associating with a new generation while retaining known historical links.

After real decode supplies identity, Hub incrementally attaches same-target anonymous protected/frame/carrier rows to the interaction without mutating the original wire event or using another target's matching seq. Eviction also removes interaction/trace indexes. Some anonymous preceding chunks still cannot all be attributed. Repository carriers emit synchronously inside send; third-party asynchronous emit has no outbound context. Native Peer does not automatically propagate application trace; pass it explicitly from the application's own Endpoint.send. Frame/nested transfer content remains referenced, detail.drainMs may update after native drain, and top-level snapshots do not deep-copy it.

Duplicate names fail with TARGET_DUPLICATE, unknown names with TARGET_UNKNOWN, and repeated removal of an already-removed name is harmless. removeTarget invalidates the target and clears indexes before awaiting iterator.return; release failure is reported and rejected unchanged. Reentrant close joins owned pending removal cleanup without repeating return. Late describe/watch results cannot revive a removed target.

Describe/query initialization failure marks disconnected, reports and rejects addTarget with the original error, and releases an acquired watch without replacing the primary failure with cleanup errors. A running watch failure reports and retains received events without automatic retry; synchronous next failure cannot publish a later connected state. Hub.close immediately seals new operations, shares one Promise, and releases owned watches. Failures form a registration-ordered TARGET_RELEASE_FAILED AggregateError whose cause/errors[0] is the first original; it is reported before close resolves. Hub never closes the supplied client/Peer. Public calls after closure fail with CLOSED except repeated close.

### Log probe

createRpcLogProbe(logger,options?) requires complete debug/info/warn/error(message,fields) methods without depending on @migaia/logger. Default stages=['message','peer']; only these stages are supported here. Core compiles methods/sample using the same domains. capture/redact use the original emitter boundary. content defaults to false; content:true conveniently requests capture for subscribed stages, while explicit capture takes precedence. slowMs defaults to undefined, skipping normal settled calls; a finite nonnegative threshold, including 0, records settled durationMs≥slowMs as slow.

levels overrides failed/rejected/timeout/aborted/slow/lifecycle with debug/info/warn/error/off. Defaults are failed→error, rejected/timeout/aborted/slow→warn, lifecycle→info. timeout/aborted are derived from failure identity, not extra outcome literals. Optional message(view) replaces package category messages only for qualifying events; onError defaults to the host reporter.

The probe synchronously extracts independent fields: method/messageId/senderId/targetId/trace/durationMs/outcome/kind/rejection/lifecycle/peerId/error. It does not pass a reusable view to asynchronous logging, but error and explicit content remain references rather than deep snapshots. Each qualifying event invokes one logger method synchronously. A throw or thenable rejection goes to onError without changing business results; reporter failures go to the host reporter. The asynchronous logger path observes thenables without introducing Promises into ordinary collector business ingestion.

Logger methods must enqueue without blocking. This package creates no extra buffer, batcher, file writer, lock, rotation, or flush. With @migaia/logger, combine level/batch/file and explicitly choose asyncOutput:true, then let the application await flush/shutdown. Node file defaults to asynchronous append with directories created by the application; other hosts need their file capability. Directly importing those entries requires directly installing that package, but the log probe does not require it.

### Error identity and development commands

RPC_DEVTOOLS_SOURCE is rpc.devtools; use RpcDevtoolsErrorCode with source rather than matching messages.

| Code                              | Scenario                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| INVALID_OPTION                    | Unsupported construction/query input; correct the option                                 |
| CLOSED                            | An operation on a closed collector/hub; create a new owner                               |
| RECORD_ACTIVE / RECORD_NOT_ACTIVE | Overlapping recording or no matching active recording to stop                            |
| RECORD_FORMAT_INVALID             | Invalid NDJSON/header/event/bytes/error representation; inspect cause                    |
| REDACT_FAILED                     | A redactor failed; report its cause and discard content                                  |
| TARGET_DUPLICATE / TARGET_UNKNOWN | Duplicate registration or a target never registered                                      |
| TARGET_RELEASE_FAILED             | Hub watch cleanup aggregation; inspect cause/errors                                      |
| SERVICE_RESULT_INVALID            | A service result cannot cross its representation boundary; inspect cause or hide content |

The package attaches identity to native errors without replacing stack/cause. Client runtime failures retain their original identity rather than being replaced by target status. These existing scripts are listed without claiming this documentation editor ran them or treating a benchmark as established performance evidence:

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
```
