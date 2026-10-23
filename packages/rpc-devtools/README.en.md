# `@migaia/rpc-devtools`

Turn RPC events into bounded queries, cumulative statistics, independent recordings, and offline timelines while keeping diagnostic failures separate from business calls.

## You may have run into this

- Cumulative counts shrink as old events disappear because statistics and display share one bounded list.
- Clearing a live view erases investigation evidence because recording has no independent retention window.
- Exported bytes and error causes cannot be restored because plain JSON lacks their representation.
- An earlier recorded event is missing because results were truncated before sorting.
- A failing log sink disrupts a successful call because diagnostics lack a separate failure channel.

## Why choose it

- **Retain recent events without shrinking cumulative call counts.** Recent-event storage and statistics own separate state, so eviction does not subtract completed calls from stats, demonstrated in [Keep recent RPC events without losing cumulative call counts](./USEGUIDE.en.md#keep-recent-rpc-events-without-losing-cumulative-call-counts).
- **Clear a live view without discarding an active recording.** record owns an independent capacity while clear resets only the main ring and statistics, demonstrated in [Clear the live view without ending an active recording](./USEGUIDE.en.md#clear-the-live-view-without-ending-an-active-recording).
- **Preserve bytes and native error chains in offline files.** The v1 codec reuses RPC error serialization and reserved byte tags, restoring bytes and the recorded stack, demonstrated in [Round-trip captured bytes and a native error chain](./USEGUIDE.en.md#round-trip-captured-bytes-and-a-native-error-chain).
- **Order offline candidates before limiting results.** Hub fully sorts valid nonmonotonic records instead of taking an early prefix that can omit earlier events, demonstrated in [Sort a nonmonotonic recording before limiting the timeline](./USEGUIDE.en.md#sort-a-nonmonotonic-recording-before-limiting-the-timeline).
- **Keep redaction and log-sink failures separate from business results.** The log probe extracts independent fields synchronously from the real emitter and reports sink failures through onError, demonstrated in [Redact real RPC log fields while isolating a failing sink](./USEGUIDE.en.md#redact-real-rpc-log-fields-while-isolating-a-failing-sink).

## Start here

```ts doc-test=run
import { createRpcDevtools } from '@migaia/rpc-devtools'

const devtools = createRpcDevtools({ maxEvents: 2 })
const recording = devtools.record({ maxEvents: 4 })
devtools.pause()
console.log(devtools.describe().paused)
devtools.resume()
console.log(devtools.describe().paused)
const text = devtools.exportRecord(recording.stop())
console.log(devtools.importRecord(text).header.version)
devtools.close()
```

Output:

```text
true
false
1
```

This short example controls an empty recording without collecting business traffic; see [retention and cumulative stats](./USEGUIDE.en.md#keep-recent-rpc-events-without-losing-cumulative-call-counts) for real calls, or [interaction correlation](./USEGUIDE.en.md#mark-missing-interaction-sides-instead-of-inventing-them) for multiple files.

## Pitfalls when writing it yourself

This native array version represents the same recording window. It is displayed only; comments identify shared retention and information lost through plain JSON.

```ts doc-test=check
const events: object[] = []
const recording = events // Pitfall: recording and live display share one array.
const failureText = 'request failed'
events.push({ error: new Error(failureText), content: new Uint8Array([1, 2]) })
const text = JSON.stringify(recording) // Pitfall: native Error chains and typed bytes have no stable round-trip representation.
events.length = 0 // Pitfall: clearing the live list also erases the active recording.
void text
```

The quick start's record owns a separate window, with stop/export/import using the fixed v1 representation; the full business example also proves that clearing the main ring does not stop recording.

## A three-minute mental model

A Probe is Core's synchronous observation interface. The collector consumes metadata from the reusable view immediately; record retains a separate window, and Hub queries existing services or offline files. None creates a business connection.

| Task / term                      | Tool                           | Meaning                                                   |
| -------------------------------- | ------------------------------ | --------------------------------------------------------- |
| Recent events / collector        | createRpcDevtools → query      | Bound the main ring while stats retains cumulative values |
| Investigation window / recording | record → stop → export         | Keep evidence independently of main-ring clear            |
| Offline representation / NDJSON  | encode/decodeRpcDevtoolsRecord | One format header followed by event lines                 |
| Several sources / target         | createRpcDevtoolsHub           | Use existing clients or files without creating Peers      |
| Diagnostic output / log probe    | createRpcLogProbe              | Extract fields while the logger owns queues and I/O       |

## Typical scenarios

| Scenario                                                     | How to combine                                                 | Details                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Keep recent RPC events without losing cumulative call counts | `probePlugin → Endpoint.send → query / stats`                  | [Complete example](./USEGUIDE.en.md#keep-recent-rpc-events-without-losing-cumulative-call-counts) |
| Clear the live view without ending an active recording       | `record → send → clear → stop → export`                        | [Complete example](./USEGUIDE.en.md#clear-the-live-view-without-ending-an-active-recording)       |
| Round-trip captured bytes and a native error chain           | `encodeRpcDevtoolsRecord → decodeRpcDevtoolsRecord`            | [Complete example](./USEGUIDE.en.md#round-trip-captured-bytes-and-a-native-error-chain)           |
| Sort a nonmonotonic recording before limiting the timeline   | `importRecord → timeline({limit}) → stats`                     | [Complete example](./USEGUIDE.en.md#sort-a-nonmonotonic-recording-before-limiting-the-timeline)   |
| Mark missing interaction sides instead of inventing them     | `import caller/provider → interactions → removeTarget`         | [Complete example](./USEGUIDE.en.md#mark-missing-interaction-sides-instead-of-inventing-them)     |
| Redact real RPC log fields while isolating a failing sink    | `createRpcLogProbe → capture / redact → probePlugin → onError` | [Complete example](./USEGUIDE.en.md#redact-real-rpc-log-fields-while-isolating-a-failing-sink)    |

## Installation

```bash
pnpm add @migaia/rpc-devtools @migaia/rpc-core @migaia/rpc-contract
```

The complete examples use only these public packages and Node capabilities. A supplied logger can be any complete structural sink; no logging package or external file output is required.

## Essential APIs

| API                                  | Purpose                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| `createRpcDevtools(options?)`        | Create an installable collector Probe                     |
| `devtools.query / stats`             | Read retained events and cumulative method counts         |
| `devtools.watch(filters?)`           | Consume bounded incremental event batches                 |
| `devtools.record(options?)`          | Start an independent recording and obtain its stop handle |
| `createRpcDevtoolsHub(options?)`     | Aggregate existing services and offline records           |
| `createRpcLogProbe(logger,options?)` | Send qualifying events to a structural logger             |

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

RPC_DEVTOOLS_SOURCE is `rpc.devtools`; use RpcDevtoolsErrorCode with source rather than matching messages.

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
