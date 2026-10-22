# `@migaia/rpc-core`

Turn asynchronous messages into calls with correlated replies, per-call deadlines, and cooperative cancellation while keeping transport closure with its owner.

## You may have run into this

- A later request replies first and wakes the wrong caller: replies are matched by method name or one shared pending slot.
- Another initialization path silently replaces a method: registration overwrites a map without conflict admission.
- Unmounting a component closes a shared channel: subscription lifetime and physical ownership have been conflated.
- Changing one request’s deadline affects other calls: only shared timeout configuration is available.
- Remote work continues after the page leaves: only the local wait rejects, without notifying the running provider.

## Why choose it

- **Keep concurrent replies attached to the correct request.** Each send correlates its result by operation identity, as shown in [Keep concurrent replies attached to their own requests](./USEGUIDE.en.md#keep-concurrent-replies-attached-to-their-own-requests).
- **Detect duplicate method registration where it happens.** provide rejects a second handler while preserving the original registration, as shown in [Reject a duplicate provider without replacing the active handler](./USEGUIDE.en.md#reject-a-duplicate-provider-without-replacing-the-active-handler).
- **Separate Endpoint release from physical channel closure.** Endpoints honor the actual transport’s owned/borrowed declaration, as shown in [Release an endpoint without closing its borrowed transport pair](./USEGUIDE.en.md#release-an-endpoint-without-closing-its-borrowed-transport-pair).
- **Override the waiting budget for one selected call.** Per-call timeoutMs overrides the installed timeout default, as shown in [Override one request’s inherited deadline without changing other calls](./USEGUIDE.en.md#override-one-requests-inherited-deadline-without-changing-other-calls).
- **Notify an already-running provider of cancellation.** abort routes caller cancellation to that operation’s context.signal, as shown in [Ask an already-running provider to stop cooperatively](./USEGUIDE.en.md#ask-an-already-running-provider-to-stop-cooperatively).

## Start here

```ts doc-test=run
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect({ transport: right })]
})
server.provide('double', (context) => context.success((context.data as number) * 2))
const client = await createEndpoint({
  id: 'client',
  targetIds: ['server'],
  transport: left,
  middlewares: [connect({ transport: left })]
})
console.log(await client.send<number>('server', 'double', 21))
await client.dispose()
await server.dispose()
left.close()
```

Output:

```text
42
```

Next: [correlate concurrent calls](./USEGUIDE.en.md#keep-concurrent-replies-attached-to-their-own-requests) or [cancel remote work cooperatively](./USEGUIDE.en.md#ask-an-already-running-provider-to-stop-cooperatively).

## Pitfalls when writing it yourself

This native send/receive sketch addresses the same request task and is displayed only, not executed; comments identify correlation and cleanup hazards.

```ts doc-test=check
let pending: ((value: unknown) => void) | undefined
function request(send: (value: unknown) => void, value: unknown) {
  return new Promise<unknown>((resolve) => {
    pending = resolve // Hazard: a second request replaces the first waiter.
    send(value)
  })
}
function receive(value: unknown) {
  pending?.(value) // Hazard: no operation identity distinguishes concurrent replies.
} // Hazard: no cancellation or close boundary owns unfinished waits.
void request
void receive
```

## A three-minute mental model

Choose the call layer and give it a genuine carrier; register providers, issue calls, then release both the call layer and any physical resources you own.

| Term             | Meaning                                                  | Tool                                               |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Transport        | The object that actually carries messages                | Memory, MessagePort, or a platform adapter         |
| Endpoint         | Correlates requests by target id and method              | createEndpoint / connect / provide / send          |
| Runtime Peer     | A higher-level connection with exchanged method catalogs | remote entry, composed by platform packages        |
| Provider context | This call’s data, cancellation signal, and settlement    | data / signal / success / failed                   |
| Owned / borrowed | Which owner closes the physical resource                 | Endpoint respects the actual transport declaration |

## Typical scenarios

| Scenario                                                               | How to combine                                         | Details                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Call a real provider through an in-memory endpoint pair                | `createMemoryTransportPair → connect → provide → send` | [Complete example](./USEGUIDE.en.md#call-a-real-provider-through-an-in-memory-endpoint-pair)               |
| Keep concurrent replies attached to their own requests                 | `provide(async) → send × 2`                            | [Complete example](./USEGUIDE.en.md#keep-concurrent-replies-attached-to-their-own-requests)                |
| Reject a duplicate provider without replacing the active handler       | `provide → duplicate rejection → send`                 | [Complete example](./USEGUIDE.en.md#reject-a-duplicate-provider-without-replacing-the-active-handler)      |
| Release an endpoint without closing its borrowed transport pair        | `dispose → transport.close`                            | [Complete example](./USEGUIDE.en.md#release-an-endpoint-without-closing-its-borrowed-transport-pair)       |
| Override one request’s inherited deadline without changing other calls | `timeout → send(timeoutMs)`                            | [Complete example](./USEGUIDE.en.md#override-one-requests-inherited-deadline-without-changing-other-calls) |
| Ask an already-running provider to stop cooperatively                  | `abort → send(signal) → context.signal`                | [Complete example](./USEGUIDE.en.md#ask-an-already-running-provider-to-stop-cooperatively)                 |

## Installation

```bash
pnpm add @migaia/rpc-core @migaia/rpc-contract
```

## Essential APIs

| API                       | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `createEndpoint(config)`  | Compose a bidirectional endpoint over a real carrier |
| `connect(config)`         | Bind the carrier and discover targets                |
| `endpoint.provide / send` | Register a provider and await its matching reply     |
| `timeout(config?)`        | Set a default deadline with per-call overrides       |
| `abort()`                 | Notify providers of cooperative cancellation         |
| `endpoint.dispose()`      | Release subscriptions and in-flight waits            |

## Contract details

### Layers, installation, and entries

This package owns runtime-neutral RPC routing, cancellation, deadlines, admission, error restoration, and lifecycle semantics. It does not launch operating-system processes or Workers and contains no node: imports. Coroutines use a supported host's global MessageChannel in the current event loop. Platform packages depend inward on this core; rpc-contract owns wire formats.

Install @migaia/rpc-core together with its peer dependency @migaia/rpc-contract. Matching workspace versions are not a runtime version-equality mechanism. Other direct dependencies are event-subscriber, lifecycle, plugin-host, serialize, supervision, and utils. Node requires >=18, while selected platform factories still need their actual host capabilities.

| Entry                                                          | Responsibility                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Root                                                           | createEndpoint (createFullEndpoint), createFullOneWayEndpoint, middleware, error guards, and idempotency storage |
| ./remote                                                       | Runtime/managed Peers, Runtime/Coroutine plugins, contracts, outlets, and events                                 |
| ./testing                                                      | createPeerPair assembles two original Peers over the real memory carrier                                         |
| ./client / ./provider / ./full / ./composed                    | Client, provider, bidirectional, and explicit Feature composition factories                                      |
| ./features/outbound / one-way / provider / discovery / control | Selected first-party roots for composition                                                                       |
| ./stream                                                       | Streaming and chunk assembly                                                                                     |
| ./adapters/memory                                              | createMemoryTransportPair                                                                                        |
| ./adapters/message-port                                        | Node/browser MessagePort transports                                                                              |
| ./adapters/web-worker                                          | Dedicated Worker/self transport                                                                                  |
| ./plugins/log / send-queue / flow-control                      | Optional diagnostics and send-policy middleware                                                                  |
| ./transport-kit / ./transport-constants                        | Transport tools and platform/topology/ownership values                                                           |
| ./adapter                                                      | defineMessageAdapter / defineByteAdapter for adapter authors                                                     |
| ./adapter/internal-advanced                                    | Low-level access retained for native Process, Threads, and Bridge owners                                         |
| ./probe                                                        | Synchronous observation, stage constants, snapshots, sampling, and Endpoint installation                         |

| Application task                                      | Entry to choose                                      |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Child/local processes or Python/Go/Rust services      | rpc-process                                          |
| Worker threads                                        | rpc-threads                                          |
| Supervised tasks in the current process               | remote createCoroutinePlugin                         |
| iframe, SharedWorker, reliable ordered RTCDataChannel | rpc-browser createBrowserPeer                        |
| Tab broadcast, ServiceWorker, WebTransport datagrams  | rpc-browser transport with this package’s Endpoint   |
| Existing MessagePort or Dedicated Worker              | adapters/message-port or adapters/web-worker         |
| New platform or physical I/O                          | adapter; testing createPeerPair for in-process peers |

Publication retains dist, schema, and all 24 export paths. The root owner is core/index rather than a top-level index. Selective factories restrict installed capabilities; actual bundle output depends on the bundler, without an unmeasured size or speed claim.

### Endpoints route by target and method

An Endpoint fits a caller with an existing transport. It routes by target id and method rather than automatically exchanging a Runtime method catalog. createEndpoint(config) resolves after middleware installation; its caller owns dispose.

| Configuration                   | Meaning                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| id                              | Required without a default; nonempty stable local identifier                                         |
| targetIds                       | Defaults to []; deduplicated with the local id removed; automatic discovery can resolve more targets |
| transport                       | The same real carrier supplied by the factory or connect; no default physical resource               |
| middlewares                     | Required middleware tuple, installed atomically during construction                                  |
| features                        | Optional finite tuple of synchronous Features                                                        |
| scheduler                       | Defaults to systemScheduler; monotonic clock shared by Endpoint and internal Host deadlines          |
| wallClock                       | Host wall clock by default; wire sentAt/hook at diagnostics only                                     |
| providerLimits                  | Inbound quotas and rejection observation                                                             |
| replay                          | Outbound message-id retention policy                                                                 |
| construction.signal / timeoutMs | Cancel or bound installation; false disables its deadline                                            |

The full factory includes outbound, provider, discovery, and control roots; ping/pingAll typing still depends on the selected ping middleware. createClientEndpoint sends calls; createProviderEndpoint provides methods while retaining outbound calls; createFullEndpoint is bidirectional; createComposedEndpoint(config, roots) explicitly selects Feature roots. One-way presets such as createFullOneWayEndpoint add sendOneWay, whose Promise confirms physical sending rather than business completion.

provide(method, handler) returns the Endpoint for chaining. Duplicate names reject without replacing the original handler. Read input from context.data and settle using context.success(value) or context.failed(message, code). An unsettled handler produces PROVIDER_NOT_SETTLED; an expired context's success/failed returns ok:false with PROVIDER_CONTEXT_EXPIRED, so inspect the returned result.

send(target, method, data, options?) waits for a result. The first three arguments are required; pass null when there is no payload. sendAll(method, data, options?) groups fulfilled/rejected results by known target. dispatch(target, method, data) and dispatchAll(method, data) return void synchronously without awaiting results. A root Endpoint has no Runtime Peer notify method. group/outcome need the selected capabilities, ping needs its middleware, and on/hooks.on subscriptions do not replace Endpoint disposal.

Send options include signal, timeoutMs, idempotencyKey, trace, and transfer. Without timeout middleware, Endpoint uses a 1000 ms fallback. Installing timeout({}) supplies undefined and leaves calls unbounded; explicit timeoutMs:false likewise disables timing. A per-call zero deadline rejects before send and false overrides the default. Runtime Peer's 30000 ms is a different layer's default. abort() enables remote abort notifications, while an already-aborted local signal is refused even without that middleware.

Neither cancellation nor timeout proves that the provider did not execute. dispose removes subscriptions and rejects in-flight waits without automatically closing borrowed carriers or undoing business side effects.

createRuntimeApiEndpoint(config, channel) is an advanced Runtime assembly that returns synchronously; await endpoint.ready before use. The single-argument form is restricted to { binding } with complete, genuine owned operations. Its facade reuses its first disposal Promise, including synchronous reentry, and invokes the underlying dispose once.

That advanced configuration also supports protocol, codec, framer, provider, idempotency, providerLimits, replay, middlewares, features, and construction. The transport receives framer output, and codec output must match framer input. Providers are registered before construction finishes. Idempotency applies to keyed calls rather than making every method idempotent.

### Middleware and extension boundaries

| Middleware                                                             | Arguments and role                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| connect({ transport })                                                 | Connection/discovery and sourceProof filtering                                                                                 |
| contract({ version, acceptVersions?, schemas?, maxIdentifierLength? }) | Business versions/schema; identifier limits cover discovery targetId/receiverId/uniqueTargetId/variation ids, not method names |
| protocol()                                                             | Standard protocol frames                                                                                                       |
| codec(descriptor) / framer(descriptor)                                 | Encoding/framing compatible with the actual carrier                                                                            |
| abort()                                                                | Remote cancellation notification                                                                                               |
| timeout({ timeoutMs })                                                 | Default call deadline, overridable per call                                                                                    |
| ping()                                                                 | ping/pingAll                                                                                                                   |
| authentication({ sign, verify, encrypt, decrypt, encodedType? })       | Per-frame authentication/encryption; encodedType is any/string/uint8array                                                      |
| hooks({ listeners, onHookError? })                                     | Lifecycle observation; listener failures do not change business results                                                        |
| uuid({ generate })                                                     | Custom message identifiers                                                                                                     |

defineMiddleware/defineFeature extend logging, diagnostics, or policy through existing owners. Public extensions cannot invent new protocol-level root capabilities. Feature/middleware claims must not conflict, and both sides need compatible encoding, framing, and capabilities.

connect defaults discoveryMode to automatic, with manual as the other value. Only explicit useBaseIdVerifyOnly:false invokes a custom identifier; missing identifier then rejects INVALID_CONFIG, and uniqueTargetId only applies in that combination. An omitted construction.timeoutMs or false leaves construction unbounded; internal Host mutation/drain use construction.timeoutMs ?? false. Failed construction rolls back accepted resources instead of returning a partly installed Endpoint.

### Carriers, ownership, and scheduling

IRpcTransport supplies send(message, options?), subscribe(listener), optional close, and platform plus optional topology/ownership/encodedType/sourceProof/onTransportError/onListenerError. sourceProof establishes origin on multiplexed carriers; an address string alone is not authentication. Omitted ownership is treated as owned, releasing the physical resource on close. Borrowed resources only lose this Endpoint's subscriptions and remain with their original owner.

createMemoryTransportPair(options?) defaults to {} and returns both sides. They are borrowed, exclusive, same-process carriers. Closing either side closes the whole pair and later send throws. Default delivery follows the native microtask order. An injected scheduler controls only pair delivery rather than the Endpoint deadline clock. Dispose both Endpoints, then let the creator close the pair.

createBrowserMessagePortTransport defaults ownership to owned, with borrowed leaving physical port closure to its caller. createNodeMessagePortTransport accepts a real Node-style port. createWebWorkerTransport receives a real Worker/self; capabilities are a static agreement that must match both sides, and peerId identifies the other side. This low-level carrier does not handshake. Window, broadcast, SharedWorker, ServiceWorker, WebRTC, and WebTransport scenarios belong to rpc-browser adapters/Peers.

transport-kit reuses listener management, failure reporting, and safe property reads rather than requiring duplicate listener owners. Manual clocks must run zero-time deferred reconciliation, departure notifications, and policy closure. Older two-method clocks receive this work through schedule(callback,0). Deadline schedule(0) semantics stay unchanged, and late jobs retain close checks and callback reporting.

### Runtime Peers and method catalogs

Runtime Peers build on Endpoint and call dotted method paths using request/notify/stream/group/outcome after exchanging capabilities and catalogs. createRuntimePeer requires exactly one of spawn/connect/listen. At Core level these are source callbacks; platform packages can offer object-style sources.

| Peer option              | Default and constraint                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| self                     | Omit to generate display name peer and a unique instanceId; explicit identity is retained, and name is not authentication |
| provide                  | Optional local method tree                                                                                                |
| spawn / connect / listen | Source receives self and genuinely compiled capabilities, then returns an actually negotiated channel                     |
| defaultTimeoutMs         | 30000; finite positive request/stream default                                                                             |
| providerLimits           | maxPerPeer 64, maxGlobal 256, optional onRejected                                                                         |
| authentication           | Optional existing authentication config for signed native transfer                                                        |
| contract                 | Optional modes, idempotency declarations, and schema                                                                      |
| keyFactory / retryPort   | Optional key generation and retry port                                                                                    |
| endpointFactory          | Optional advanced assembly over the real channel view                                                                     |
| probe                    | Optional single Probe or readonly array                                                                                   |
| report                   | Background errors use console.error when omitted                                                                          |

provide reads only own enumerable data properties and builds dotted paths from nested plain objects. Getters, cycles, invalid names, and duplicate paths fail before opening the source. Remote calls are limited to the negotiated catalog. Values must be portable JSON or negotiated binary; Date/Map/class instances are refused. Without an API generic there are no statically callable methods. IRuntimeDynamicSurface relaxes only type checking, not catalog admission. IterableIterator/AsyncIterableIterator return types identify stream methods; IRuntimeSurface extracts Host/plugin types without runtime code.

| Method                              | Completion and lifecycle                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| request(method, payload?, options?) | Await a result                                                                       |
| notify(method, payload?, options?)  | Confirm sending, not provider success                                                |
| stream(method, payload?, options?)  | Lazy until first next; early return asks the provider to stop                        |
| group(steps, options?)              | Execute in order, mark later steps not-executed after failure, no rollback           |
| outcome(key)                        | pending/done/unknown; unknown is not evidence of non-execution                       |
| describe(options?)                  | Local identity, connection, and catalog query                                        |
| close()                             | Refuse new work and close through the original owner; repeat calls share one Promise |
| on(event, listener)                 | Idempotent unsubscribe without initial-ready replay                                  |
| Symbol.asyncDispose                 | The original close function itself, for await using                                  |

Call options are timeoutMs, signal, idempotencyKey, orderKey, cancel, and transfer. Request/stream default to 30000 ms; per-call false disables the default and zero expires immediately, subject to source call ceilings. Retries and waiting for a successor generation retain the original absolute deadline. Signal cancellation is cooperative. cancel:'before-start' only retracts work that has not started; started work retains its actual outcome. Calls sharing orderKey run serially at the provider. Transfer is for negotiated thread capability rather than a normal memory pair.

Invalid names, values, or options may throw before a Promise is returned. Wrap the whole call expression in try instead of only attaching catch. After the Peer is closed, or its generation was stopped and replaced, a new call throws REMOTE_CLOSED synchronously; while the supervisor starts the next generation (for example while a crashed Worker restarts), the call returns a Promise that rejects with REMOTE_CLOSED instead of throwing. Close/events provide no business rollback and cannot turn disconnection into proof of non-execution.

### Host outlets, installation, and coroutines

createRuntimePlugin/createCoroutinePlugin and platform plugins install through the original Plugin Host. Connections of one family share host.process/thread/coroutine, named by RuntimePluginKey. Calls first select a connection name or exact { name, instanceId }; ambiguous same-name instances reject.

list/get/describe default to objects and can request text. Unknown facts are unavailable rather than fabricated zeroes. on handles ready/exit/degraded/restart/terminal/liquidated. watch has a 100-event backlog; overflow reports RUNTIME_EVENT_OVERFLOW and ends the iterator, requiring a fresh state query before resubscription. broadcast collects individual results without all-success guarantees.

stop/kill/restart/replace apply only to execution units actually created by spawn or a coroutine task. Borrowed connect/listen sources reject them with CAPABILITY_CONFLICT. Host methods are private by default and require explicit expose. Calls to local Feature expose entries during installation wait for the Host batch commit; rollback refuses them with TARGET_UNKNOWN. This does not cover forwarding/catalog entries or turn ready into confirmation of every remote installation transaction.

Initial ready is already represented by awaiting the factory and is not replayed to later listeners. A supervised Peer publishes actual supervisor exit/restart/degraded events; listener ready follows accepted sessions. Raw Peers fabricate neither native exit nor later ready. Unsubscribing does not stop an execution unit; close/await using owns release and unregisters events when closing begins.

Coroutine parent mode createCoroutinePlugin({ name, task, supervisor? }) supervises a task in the same event loop with a MessageChannel per generation. Child mode { name, connect } uses only that task's opaque connect rather than an arbitrary MessagePort. Choose exactly one of task/connect. Both support provide/expose, with local exposed providers installed first.

A task receives signal, heartbeat(), and connect and releases its own child Host in finally. Resolution means exited, rejection means crashed, and supervision controls subsequent behavior. The default budget is one coroutine unit per plugin. replace(name,{task}) selects the next generation; a non-function rejects INVALID_CONFIG without replacing the current unit. Cancellation requires cooperation; an ignoring task can delay completion and retain its budget lease until settlement. A blocked event loop cannot be forcibly terminated. terminal events retain the chain-ending source/code and connection name rather than invent native exit.

### Admission, replay, and idempotency

Inbound request/notify/stream share default limits of 64 per peer and 256 globally. Over-limit work does not call the business handler. Callers see OVERLOADED without a detailed admission reason; providerLimits.onRejected and RpcProviderRejectionReason distinguish concurrency from other refusal branches. createProviderAdmissionScope shares the existing quota owner across Endpoints rather than equating client in-flight counts with provider concurrency.

Exclusive channels proven by native Process/Threads launchers retain only in-flight calls. Other carriers use bounded ledgers: outbound defaults to 4096 entries per Endpoint with ttlMs 310000; inbound maxReplayEntriesPerPeer is 1024 and the global limit 4096 with the same retention. These bound admission over a retention window. Burst capacity and capacity/TTL arithmetic are not measured throughput.

createRpcIdempotencyStore defaults to retentionMs 300000, maxEntries 1024, maxEntriesPerScope 256, maxBytes 8 MiB, and maxOutcomeBytes 1 MiB, all positive safe integers. Pending work does not expire merely from retention. A tombstone can retain an unavailable-result state when the body cannot be retained, without executing again. In-memory owner restarts lose continuity rather than promise indefinite or cross-restart at-most-once execution.

### Binary values, forwarding, and retries

ArrayBuffer/Uint8Array require negotiated binary support and preserve view offset/length. Inline transport carries visible bytes; native thread manifests retain the whole backing and verify its digest. SharedArrayBuffer, Atomics, and other TypedArrays are unsupported. Transfer detaches at actual commit and cannot restore the input after failure; the library keeps no input copy and does not retry it automatically. Missing signing/capability requirements reject CAPABILITY_UNSUPPORTED without silently copying instead.

expose can forward a prefix of an accepted connection's methods. Each hop binds the selected target generation, with a three-hop maximum and loop refusal. Relays do not cache business results. The final provider authenticates its immediate upstream hop rather than the original caller.

Timeout, cancellation, disconnection, recovery, and unknown do not prove non-execution. Retry directly only with independent evidence, such as a definite concurrency refusal or successful before-start retraction. Otherwise query outcome with the same idempotencyKey or reconcile application state. A new key does not resolve an unknown result; the caller controls backoff and the total budget.

### Define adapters over genuine physical I/O

defineMessageAdapter({open,launch?}) opens a real port and optionally invokes the original launch operation, producing standalone Peers or host.thread plugins. defineByteAdapter({open,listen?,dial?}) accepts ordered byte I/O for Peers or host.process plugins. Definitions do not take finished Peers/channels, claimed negotiated capabilities, trusted identities, or fabricated ownership.

The message caller retains physical closure of borrowed ports. Byte I/O supplies real write/onData/onClose/close operations. Core keeps handshake, framing, capabilities, and catalogs under their original owners. Launch returns the native port, exited, and terminate; cold cancellation, handshake failure, and close use the existing termination-once owner. Managed platform sources continue to use their original supervisor/generation owners.

governor retains rate/payload/consecutive-timeout/idle policy and attaches its disposer to actual connection close. adapter.scope(store?) creates a provider scope; shared users close it after all Peers. Session idempotency requires the principal captured from actual authentication, not an ordinary address string; byte responders establish it through real auth.verify.

Byte verifier failures retain original cause/report locally, while the peer sees only a sanitized rejection summary rather than the verifier's error chain. Third-party adapters attach their own source/code through utils and retain original causes instead of impersonating Core/Contract errors.

### Errors and attribution

Errors retain native type, message, stack, and cause. Public shapes use IRpcError, IRpcPlatformValue, and IRpcTransportTopologyValue. Branch on source/code rather than message. Remote source/code is diagnostic data, not local authority.

The `source` values below identify errors; they are not import paths. Import Core APIs from `@migaia/rpc-core` and Remote APIs from `@migaia/rpc-core/remote`.

| source               | Constant / code table                             |
| -------------------- | ------------------------------------------------- |
| `@migaia/rpc/core`   | RPC_CORE_ERROR_SOURCE / RpcCoreErrorCode          |
| `@migaia/rpc/remote` | RPC_REMOTE_ERROR_SOURCE / RpcRemoteLayerErrorCode |

isRpcErrorInstance/isRpcRemoteError/isRpcTimeoutError use stable fields across realms/copies rather than instanceof. isRpcError only checks a string code and is not a substitute for those family guards. RpcError/RpcRemoteError/RpcTimeoutError and similar names are type-only exports. RpcLifecycleError is the only constructible public class, for consumers that own their own release state.

| Core code                                                       | Meaning                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| DEADLINE_EXCEEDED / CANCELLED                                   | TimeoutError/AbortError; reconcile a potentially unknown result                        |
| OVERLOADED                                                      | Admission refusal; inspect provider onRejected                                         |
| TRANSPORT                                                       | Carrier failure with uncertain delivery                                                |
| PROVIDER_NOT_FOUND / PROVIDER_DUPLICATED / PROVIDER_NOT_SETTLED | Missing path, duplicate registration, or unsettled provider                            |
| PROVIDER_CONTEXT_EXPIRED                                        | Expired settlement returns ok:false                                                    |
| PAYLOAD_INVALID / SCHEMA_INVALID                                | Value, size, binary, or schema failure                                                 |
| CONTRACT_INVALID / PROTOCOL_INVALID                             | Invalid method/mode/key or protocol message                                            |
| CAPABILITY_UNSUPPORTED / CAPABILITY_CONFLICT                    | Missing negotiated capability or ambiguous owner/instance                              |
| INVALID_CONFIG                                                  | Invalid config, including unsupported transfer                                         |
| TARGET_UNKNOWN / TARGET_NOT_IDENTIFIABLE                        | Missing or ambiguous target                                                            |
| ENDPOINT_DISPOSED                                               | Terminal Endpoint requiring a new instance                                             |
| AUTHENTICATION_FAILED                                           | Repair authentication/session state                                                    |
| STREAM_RESULT_UNKNOWN                                           | Stream results beyond delivered items are unknown                                      |
| IDEMPOTENCY_RESULT_UNAVAILABLE                                  | Executed business result was not retained; do not re-execute with a new key            |
| PROVIDER_GENERATION_MISMATCH / PROVIDER_GENERATION_RETIRED      | Wrong/retired generation; forwarded work may have run                                  |
| FORWARD_LOOP / FORWARD_HOP_LIMIT                                | Cycle or more than three hops                                                          |
| MIDDLEWARE_DUPLICATED / MIDDLEWARE_MISSING                      | Duplicate/missing assembly                                                             |
| CHUNK_INVALID                                                   | Chunk assembly failure                                                                 |
| PROPERTY_READ_FAILED / STRING_CONVERSION_FAILED                 | Property/string-conversion failure with its cause                                      |
| CALLBACK_FAILED                                                 | Cold Probe listener, middleware install, or reporter failure; inspect cause/host queue |
| INTERNAL                                                        | Internal failure without automatic retry                                               |

Authentication reason is RpcAuthenticationRejectionReason.sessionUnknown for rediscovery or challengeInvalid for malformed frames. Manual connect.query cancellation retains DOMException/AbortError, CANCELLED, and signal.reason as cause. Core serializeRpcError/deserializeRpcError also retain its redaction and forwarding metadata; rpc-contract owns error-tree structure and JSON-RPC mapping.

| Remote code             | Meaning                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| REMOTE_START_FAILED     | Source/handshake failed; inspect cause                                            |
| REMOTE_CLOSED           | Connection/generation closed; do not automatically retarget a same-name successor |
| REMOTE_RESULT_UNKNOWN   | Business may have executed; query outcome or reconcile                            |
| REMOTE_CONTRACT_INVALID | Invalid catalog/contract                                                          |
| REMOTE_HOST_NOT_ADOPTED | Complete the corresponding hostUse first                                          |
| RUNTIME_EVENT_OVERFLOW  | More than 100 queued events; query state and resubscribe                          |

An owned supervisor still attempts channel/native release after Endpoint close fails, preserving primary failures through cause/errors. Late physical send rejections remain observed. A reporter that throws is sent to the existing host exception queue without an unhandled reaction Promise.

### Probe observation and retention

The ./probe API observes synchronously without changing request/results. It exports numeric stage/direction/kind/outcome constants with matching name tables, defineProbe, snapshotProbeEvent, rpcProbeSampleKey, probePlugin, readProbeStages, subscribeProbeStages, and existing hostRethrowReporter/IpcReporterContext. Peers accept probe; Endpoints install probePlugin before activation, using the same emitter.

defineProbe(definition,host?) validates a nonempty known stages array. capture defaults off and must be a stages subset. sample defaults to all, within (0,1]. methods filters only method-bearing message/envelope events; variations without methods pass that filter, and other stages use sampling only. redact handles explicitly captured content without enabling other capture. describe/emit/onError provide description, synchronous consumption, and failure reporting. Definition failures retain TypeError/INVALID_CONFIG.

Omitting host returns an independent frozen handle. Providing host adds stageMask/captureMask/methods/sampleThreshold/setStages to that same object, registers its identity, freezes it, and returns THost & IRpcProbe without copying it. Host must be extensible, unfrozen, non-null, and lack those fields/previous registration. Validation precedes mutation. Existing host.emit remains unchanged; private state retains definition.emit.

Each emitter reuses its event view, valid only during synchronous emit. snapshotProbeEvent copies/freezes the top-level fields while retaining detail/error/content references and ownership. It is not a deep snapshot. Unknown sizeBytes/chunk/members/durationMs are -1. Strings and opaque containers always have sizeBytes -1 without additional encoding/scanning. Existing byte backing/view lengths are read directly. Nested transferables are neither traversed through getters nor deeply scanned/copied and may detach at real transfer; only directly captured backing/views that will detach preserve bytes.

protected appears only on a real authentication path with explicit capture. setStages([]) pauses; known stages resume without changing captureMask. A supplied host's stageMask remains the initial value, whereas an independent handle getter reflects current private state. readProbeStages reads the effective mask; subscribeProbeStages reports actual changes with idempotent release. Invalid stages preserve the old selection with INVALID_CONFIG. A cold listener failure still allows other listeners/emitters to adopt the new mask before CALLBACK_FAILED propagates.

Failures from emit/redact/describe, including rejection, reach onError as PROBE_FAILED with the original cause, otherwise the host reporter. They do not enter business dispatch. Activation delivers a descriptor once and calls carrier observe only when actually provided; the existing resource scope owns release. No events are sent after closing. Managed Process/Thread/Browser/pool sources forward the original Probe reference rather than invent new lifecycle owners.

variation retains route.variation for ping/pong/close/abort and registered subtypes. Abort kind is cancel; others are control; request/response and other stages have no variation. rpcProbeSampleKey uses FNV-1a 32-bit over concatenated senderId/messageId UTF-8 bytes for correlation, not authentication or uniqueness.

carrierSeq is an inbound carrier sequence within one emitter, or -1 without a link. Receive captures it into the physical record across asynchronous unprotect/decode. A collector maps Endpoint/source sequence to its global wire sequence. An unresolved origin already evicted from all retention windows cannot be recovered; resolved links survive with dependent rows. A source-sequence reset leaves a cutoff on old origins to prevent links to new rows, without ingestion-time generation history.

Outbound carrier context borrows messageId/senderId/targetId/trace from the current send and clears it on synchronous return. Repository carriers emit synchronously; a third-party asynchronous emit has no such borrowed context. Physical batches use the first actual member as representative without expanding payload members. Byte carrier events precede actual Core delivery, including each startup-buffered frame at delivery time; undelivered closed/overflowed frames do not emit business carrier events. Reused detail starts drainMs at -1 and reports frameBytes; real writer false/drain updates it later without changing write settlement or adding async events.

Observation preserves fast/native/batch/chunk selection. Descriptors may include frame while a fast send emits no fabricated frame event. Authentication descriptors read sign/encrypt-sign. Before decryption, sender/message identity is unavailable, so sampling need not match later stages. Anonymous earlier chunks are not assigned guessed identity; only the last decoded block can link through carrierSeq. Native Peer call options have no trace; applications explicitly pass existing trace at their own Endpoint.send boundary.
