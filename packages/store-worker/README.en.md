# `@migaia/store-worker`

Connect computation or serialization parsers to a real Worker while keeping Promise, Resource and serialization-registry calls on the caller side.

## You may have run into this

- Two calculations finish and the wrong caller receives a result because raw messages do not associate requests with responses.
- Closing a screen terminates a borrowed Worker because client subscriptions and physical thread ownership were combined.
- A Worker sends only an error message, losing native error types, causes and stacks across the thread boundary.
- Inputs change while a view keeps the old result because loading state and caching were maintained separately beside each request.
- Moving an existing parser to a Worker duplicates format selection and cleanup in ad hoc messages.

## Why choose it

- **Use one request interface across a real thread boundary.** WorkerAdapter waits for endpoint initialization and delegates result matching to Core, while [Run a calculation in a real Worker](./USEGUIDE.en.md#run-a-calculation-in-a-real-worker) checks the returned process and thread identifiers.
- **Release the request client separately from its physical Worker.** close retires admission and dispose shares one cleanup Promise, and [Stop requests without terminating a borrowed Worker](./USEGUIDE.en.md#stop-requests-without-terminating-a-borrowed-worker) receives a native message after endpoint cleanup.
- **Keep cross-thread failures traceable through their causes.** createWorkerHandler uses RPC error transfer, and [Keep a Worker computation failure traceable](./USEGUIDE.en.md#keep-a-worker-computation-failure-traceable) checks native types, nested causes and stacks.
- **Use an existing state and cache model for results.** workerComputed connects input selection and requests to Resource, and [Use Resource state and cache for Worker results](./USEGUIDE.en.md#use-resource-state-and-cache-for-worker-results) demonstrates lazy work, fresh-cache reuse and explicit refresh.
- **Keep the application's existing registry calls.** workerPlugin registers the remote parser as a standard plugin, and [Run an existing JSON parser through a Worker registry plugin](./USEGUIDE.en.md#run-an-existing-json-parser-through-a-worker-registry-plugin) round-trips data with the same encode/decode interface.

## Start here

Save this as a separate ESM TypeScript file and run it with Node 24. The child reloads the same file, so avoid interactive standard input. Install this package first:

```bash
pnpm add @migaia/store-worker
```

```ts doc-test=run
import { Worker, MessageChannel, workerData, isMainThread } from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'
if (!isMainThread) {
  const handler = createWorkerHandler(Number, (m) => workerData.postMessage(m))
  workerData.on('message', (m: unknown) => void handler(m).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  console.log(await adapter.request('42'))
  await adapter.dispose()
  port1.close()
  await worker.terminate()
}
```

Output:

```text
42
```

Next, [Run a calculation in a real Worker](./USEGUIDE.en.md#run-a-calculation-in-a-real-worker) checks where the calculation ran and shows the complete cleanup order.

## Pitfalls when writing it yourself

This native-message sketch is for display and type checking only; do not run it:

```ts doc-test=check
import { MessageChannel } from 'node:worker_threads'

const { port1 } = new MessageChannel()
let resolveResult: ((value: number) => void) | undefined
const request = (input: string) =>
  new Promise<number>((resolve) => {
    resolveResult = resolve // Pitfall: concurrent calls overwrite the previous waiter.
    port1.postMessage(input) // Pitfall: no readiness or failure settlement path.
  })
port1.on('message', (value: number) => resolveResult?.(value))
// Pitfall: listener cleanup and physical-port ownership are not separated.
void request
```

The previous example uses the Adapter to await initialization and match requests, then awaits endpoint cleanup; the caller still closes and terminates the port and Worker it created.

## A three-minute mental model

| Task                                     | Tool                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Request a calculation from the main side | WorkerAdapter.request returns an asynchronous result.                                     |
| Receive work inside the Worker           | createWorkerHandler wraps compute; deliver real incoming messages to its handler.         |
| Add loading state and caching            | workerComputed returns a Resource that borrows an existing Adapter.                       |
| Keep serialization-registry calls        | createSerializeWorkerHandler in the Worker, workerPlugin / workerParser on the main side. |

An endpoint represents this message connection; the Adapter borrows the physical port. Resource manages freshness and fetching state without creating a thread. The parser owns the actual format algorithm; type is a registry label. Copy preserves input, while transfer explicitly gives up eligible byte storage and does not establish zero-copy payload delivery.

## Typical scenarios

| Scenario                                     | How to combine                                         | Details                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Check that computation runs in a Worker      | createWorkerHandler → WorkerAdapter.request → dispose  | [Run a calculation in a real Worker](./USEGUIDE.en.md#run-a-calculation-in-a-real-worker)                                                     |
| End a client while reusing its Worker        | close → dispose → native port messaging                | [Stop requests without terminating a borrowed Worker](./USEGUIDE.en.md#stop-requests-without-terminating-a-borrowed-worker)                   |
| Diagnose a cross-thread computation failure  | createWorkerHandler → request.catch → cause            | [Keep a Worker computation failure traceable](./USEGUIDE.en.md#keep-a-worker-computation-failure-traceable)                                   |
| Refresh inputs and reuse cached results      | workerComputed → state / promise → refetch → dispose   | [Use Resource state and cache for Worker results](./USEGUIDE.en.md#use-resource-state-and-cache-for-worker-results)                           |
| Move an existing format parser into a Worker | createSerializeWorkerHandler → workerPlugin → registry | [Run an existing JSON parser through a Worker registry plugin](./USEGUIDE.en.md#run-an-existing-json-parser-through-a-worker-registry-plugin) |
| Cancel decoding while retaining input bytes  | workerParser → decode(context.signal) → dispose        | [Keep input bytes available when a decode is cancelled](./USEGUIDE.en.md#keep-input-bytes-available-when-a-decode-is-cancelled)               |

## Installation

```bash
pnpm add @migaia/store-worker
```

Resource and serialization scenarios in the usage guide directly import two additional packages, which should also be installed directly:

```bash
pnpm add @migaia/reactive @migaia/serialize
```

The package has a root entry and the exact subentry `@migaia/store-worker/serialize/worker`; import workerPlugin and workerParser from that subentry. These Node examples use real Workers. Browser deployments still need their bundler's Worker-file setup and a suitable host environment.

## Essential APIs

| API                          | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| WorkerAdapter                | request computes a result, close retires admission, and dispose releases the endpoint. |
| createWorkerHandler          | Wrap a calculation and deliver messages inside the Worker.                             |
| workerComputed               | Create a Resource from a synchronous input selector.                                   |
| workerPlugin                 | Register a Worker parser with the serialization registry.                              |
| workerParser                 | Use the Worker serialization parser directly.                                          |
| createSerializeWorkerHandler | Connect a real parser to the Worker's message port.                                    |

## Contract details

### Responsibility, entries, and runtime boundaries

This package connects two Worker use cases. WorkerAdapter / createWorkerHandler execute general computation, and workerComputed connects those requests to Resource. The serialization subentry connects an ordinary parser to a Worker and SerializeRegistry. rpc-core owns request correlation, providers, cancellation, deadlines, source handling, and error transport. resource owns caching, retry, and reactive lifetime; serialize owns formats and registry behavior. This package owns payload conversion, chunk credit / ACK, and the integration rather than another RPC engine.

| Entry                                   | Public contents                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@migaia/store-worker`                  | WorkerAdapter, createWorkerHandler, workerComputed, IManagedRpcHandler, port / Resource option types, ownership / diagnostic constants, and errors. |
| `@migaia/store-worker/serialize/worker` | workerParser, workerPlugin, createSerializeWorkerHandler, IWorkerPluginOptions, IWorkerLike, and IWorkerFailureEvent.                               |

reactive, resource, serialize, rpc-core, rpc-contract, and utils are runtime dependencies. Install packages directly when your application imports them. Serialization factories no longer have root aliases, and there is no serialize/* wildcard entry; migrate imports to the exact subentry without a compatibility shim. encodeWorkerValue / decodeWorkerValue and transferablesOf are internal. CHUNK_MERGE_FAILED was removed because its former merge path no longer exists; six local codes remain.

The bridge uses exclusive topology: one logical connection has one port pair, with main and worker as default identities. connect performs Core consistency checks and directory wiring without a custom identifier. This is not a guarantee of arbitrary multi-client sharing on one Worker object. A MessagePort can satisfy the port surface while its creator still owns physical connection setup and resources.

IWorkerPort aliases Core IWebWorkerLikePort, requiring postMessage, addEventListener, and removeEventListener for message / error / messageerror events. Browser Workers, MessagePorts, and an individual SharedWorker port can provide that surface. Node examples run handlers in real Workers through native MessagePorts rather than fabricated ports. IWorkerLike additionally permits terminate(); accepting this structure does not transfer Worker creation or native-exit ownership.

### WorkerAdapter: the caller's connection

`new WorkerAdapter(port, options?)` returns synchronously while its Endpoint initializes asynchronously. request awaits initialization automatically; there is no additional ready API.

| Construction or request parameter | Default and behavior                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| port                              | Required actual borrowed message port.                                                                             |
| options.clientId                  | main, the local Core id. Use one adapter for one physical connection rather than duplicating adapters on a Worker. |
| options.timeoutMs                 | undefined, with no default request deadline; supply milliseconds when needed.                                      |
| request(payload, options?)        | Sends input and returns a result Promise; Input / Output generics provide caller-side static typing only.          |
| Request signal                    | Unset; cooperative cancellation scoped to that request.                                                            |
| Request transfer                  | Unset; an explicit native transfer list, distinct from serializer ownership policy.                                |

Construction captures clientId / timeoutMs, and requests capture signal / transfer without rereading caller getters after initialization. Invalid option objects or property reads produce INVALID_OPTION with caught failures on cause. request rejects its Promise while construction errors throw synchronously. Core retains later port and RPC admission rather than every Core failure becoming a local error.

One adapter supports concurrent requests. Core correlates results and handles each call's cancellation / deadline separately. Use Promise.all for independent work: built-in carriers supporting batch@1 immediately send when idle and coalesce ready requests or responses while a physical write is active. Dependent serial awaits do not become batching. request awaits provider results; internal one-way notify awaits sending rather than business completion.

| Member    | Lifetime                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| disposed  | `adapter.disposed` becomes `true` synchronously when `adapter.close()` or `adapter.dispose()` starts, marking this adapter closed to new requests.            |
| close()   | No arguments; synchronous and idempotent retirement. New requests reject ADAPTER_DISPOSED, but it does not release the Endpoint.                              |
| dispose() | No arguments; the sole async release operation. It closes admission, awaits initialization, then closes the Endpoint; repeated calls return the same Promise. |

Adapter.dispose does not terminate the borrowed Worker or port. Cleanup failures reject rather than disappearing. Closing before readiness also prevents later initialization from dispatching retired requests. The creator terminates physical resources in application order; Endpoint cleanup is not a native thread exit receipt.

### Worker handlers and payloads

`createWorkerHandler<Input, Output>(compute, postMessage, options?)` validates its two required callbacks before creating the handler. compute(payload, { signal }) returns a result or Promise and receives native cancellation. Long work should check or observe that signal; the framework does not forcibly interrupt running synchronous code. postMessage(message) delegates Core messages to the real parent port. options.timeoutMs defaults to undefined and affects requests initiated by that Endpoint, not provider execution time; normally configure deadlines on the main Adapter.

Feed actual message.data to the returned IManagedRpcHandler. It does not create a Worker or install a global onmessage callback itself. Browser listeners deliver data; Node uses MessagePort delivery. Initialization or delivery failure can still reject the handler Promise and must be observed by its host. Ordinary compute exceptions become Core failure responses, which does not mean every host callback can never reject.

The bridge converts input to portable data: plain records / arrays, finite primitives, undefined, and explicit ArrayBuffer / Uint8Array byte representations. It does not transparently structured-clone arbitrary prototypes, functions, Maps / Sets, or cyclic graphs. Define a transferable representation or an appropriate parser for those shapes. Internal $worker tag shapes are reserved rather than ordinary application records or declarations of trust.

### IManagedRpcHandler closure and cleanup

| Member           | Behavior                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| handler(message) | Accepts a parsed raw message value; after closure it resolves without processing late queue residue.                                               |
| pendingCount     | Admitted messages awaiting initialization or delivery, not completed provider computations.                                                        |
| disposed         | `handler.disposed` becomes `true` synchronously when `handler.close()` or `handler.dispose()` starts, marking this handler closed to new messages. |
| close()          | Synchronously and idempotently retires admission without Endpoint or user cleanup.                                                                 |
| dispose()        | Closes admission, awaits initialization, and cleans up the Endpoint; reuses one Promise and retains rejection.                                     |

A message admitted during initialization is not delivered after close, and pendingCount eventually returns to zero. This counter is not a safe quiescence gate for Worker.terminate. Core owns provider drain and cleanup; await dispose and follow physical-resource ownership. No disposeAsync alias exists. A serialization handler likewise releases its own Endpoint / provider registrations without invoking the borrowed parser.dispose; the parser creator owns its lifetime.

### workerComputed and Resource

`workerComputed(adapter, selectInput, options?)` returns a standard `Resource<Output>`. Each fetcher invocation synchronously calls selectInput once, requests that input through the Adapter, and forwards Resource signal plus optional transfer(input). Resource tracks synchronous signal / computed reads; reads after await do not become that invocation's synchronous dependencies. This does not establish global caching or deduplication across Resources or Workers.

| Parameter / option   | Default and meaning                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------- |
| adapter              | Required WorkerAdapter instance, borrowed rather than disposed by Resource.                  |
| selectInput          | Required synchronous function producing current input.                                       |
| runtime              | defaultRuntime.                                                                              |
| transfer             | undefined; when supplied, a function returning this input's transfer list.                   |
| ttl                  | Infinity, Resource cache lifetime.                                                           |
| autoStart            | true; false skips eager construction, while state / promise reads can still start lazy work. |
| staleWhileRevalidate | false.                                                                                       |
| retry                | 0; alternatively (failureCount, error) returns whether to retry.                             |
| retryDelay           | 0; alternatively (failureCount, error) returns milliseconds.                                 |
| keepAlive            | false.                                                                                       |
| initialSnapshot      | undefined.                                                                                   |
| debugName            | undefined.                                                                                   |
| scheduler            | systemScheduler.                                                                             |

Resource receives these options without Worker-specific reimplementation. Known keys are captured once without object-rest enumeration of unknown getters. Invalid adapter, selectInput, transfer, or option getters synchronously produce INVALID_OPTION before Resource ownership / automatic startup, retaining caught causes. refetch, load, state, and dispose retain the resource package's semantics.

Release Resource first, await adapter.dispose, then let the creator terminate the physical Worker / ports. Do not destroy a connection that Resource still uses. A transfer callback must reflect whether the application will read that input again; Resource retry cannot restore detached backing.

### Serialization parser and plugin

workerParser(options) is a caller-side ISerializeParser. workerPlugin(options) simply combines that parser's name and instance into an ISerializePlugin for createSerializeRegistry. Import both only from /serialize/worker.

| IWorkerPluginOptions field | Default and purpose                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| worker                     | Required IWorkerLike port.                                                                                                      |
| type                       | worker, the registry format label; it must describe the actual Worker parser's encoding and be selected correctly when reading. |
| clientId                   | main.                                                                                                                           |
| ownership                  | copy; the other value is transfer, described below.                                                                             |
| terminateOnDispose         | false; supplied Workers remain caller-owned.                                                                                    |

These five fields are read once at admission. Invalid option objects, reflection / property reads, or field values produce INVALID_OPTION. There is no parser.timeoutMs option. Use SerializeContext.signal for cancellation; registry lifecycle budgets remain separate.

encode(value, context) classifies Uint8Array input as bytes and other input as value, returning an asynchronous sequence of chunks rather than one merged result. decode(chunk, context) requests decoding and returns the result payload without another chunk wrapper. context carries signal and a diagnostic context name; the registry supplies its actual context.

workerParser.dispose retires active output and closes its Endpoint. By default it does not terminate the physical Worker. With terminateOnDispose true it still attempts optional terminate after Endpoint cleanup failure. This captures synchronous throws from terminate rather than awaiting native asynchronous exit. Endpoint-only failure retains RpcLifecycleError cleanup details; terminate-only failure retains that exception; both failures produce CLEANUP_FAILED AggregateError with Endpoint then termination in errors. Repeated parser.dispose calls reuse one Promise. Await Registry.dispose to observe its async cleanup result.

### Worker serialization and chunk streams

createSerializeWorkerHandler(parser, post) requires a real parser with encode / decode and a post(message, transfer?) callback delegating to its actual port. Invalid shapes reject synchronously before Endpoint creation. An unowned extensible native error thrown by a parser-member getter stays the same object with native type / stack and gains INVALID_OPTION. Complete foreign source/code identities survive, and values that cannot be annotated remain reachable through cause or aggregation.

The handler passes the input chunk payload to parser.encode. Results may be one valid ISerializeChunk or a sync / async chunk iterable. The caller receives open / chunk / end incrementally, with two initial credits and ordered ACK; consumption restores credit. Neither collectStream nor whole-output merging is used. Credit bounds sending progress for one stream, not the whole Worker's byte budget; the producer may obtain its next chunk before waiting for sending credit.

Valid text / bytes / value chunks retain order, including empty and mixed streams. The removed CHUNK_MERGE_FAILED no longer handles that path. parser.decode receives its original chunk, and a Uint8Array result becomes bytes while other results become value. Eligible complete byte backing may transfer on Worker output according to that send path; caller input ownership does not grant reuse guarantees for producer output.

Early consumer completion or cancellation notifies that stream, wakes producers awaiting credit, and attempts iterator.return. If cleanup also fails, existing secondary-error attachment retains the primary and secondary chains. Core RPC rejection transports source/code/name/message/stack/cause/errors rather than a separate application error frame. Uncooperative business code still requires application ownership; stream cancellation does not forcibly stop the Worker.

### Copying, transfer, and actual payloads

WorkerByteOwnership publicly defines copy / transfer and IByteOwnership is their union. WorkerDiagnosticType contains only worker, represented by IWorkerDiagnosticType. These constants take no arguments. Default copy preserves caller input, while transfer explicitly gives up exclusively owned storage.

Serializer input enters the transfer list only for bytes containing a genuine Uint8Array whose view spans one entire ordinary ArrayBuffer: offset zero and view length equal to backing length. Partial subarrays and SharedArrayBuffer-backed views fall back to copying. Other aliases of an eligible ordinary ArrayBuffer are not detected or excluded from transfer, so transferring that backing can detach them too. This does not provide a shared-memory computation protocol. Top-level text / value chunks do not recursively transfer their nested objects because of ownership alone.

A submitted native transfer may detach the full backing and all aliasing views. Pre-cancelled unsent input remains usable, so neither the option nor a cancellation code proves loss. Inspect actual backing before retrying, or use copy / retain an application copy. transferablesOf / exclusiveBuffer are internal rather than callable public APIs.

The current bridge base64url-encodes bytes as portable payload before separately passing a native transfer list. Detachment therefore does not prove zero-copy payload delivery. Small computations and object graphs still incur encoding and round trips. Old timings and ratios do not establish this implementation's behavior; no current timing or speed guarantee is made. Evaluate actual work instead of deriving speed from the presence of a Worker.

### Cancellation, errors, and ownership

General Adapter requests retain canonical Core cancellation, timeout, transport, and remote identities. A compute failure commonly has RpcRemoteError / INTERNAL outside reconstructed native TypeError / RangeError causes with their messages and stacks. Do not expect sender-side object identity or require the top-level error itself to be the original native class. Without a deadline, a provider that never settles can leave a request pending; every broken Worker is not guaranteed to settle promptly.

Serialization decode / request and pre-cancelled encode use SerializeCodecError / REQUEST_ABORTED with type (default worker), phase encode / decode, context, chunkIndex 0, and bytesConsumed (input byte length or zero). The caller's signal.reason remains on cause. Active encode streams can end with the original RPC / cancellation error rather than every codec diagnostic field. Credit waits and explicit stream stop create native DOMException / AbortError with message serialize stream cancelled and REQUEST_ABORTED, preserving native type, message, and stack through the error chain.

| StoreWorkerErrorCode property / value         | Trigger                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| invalidOption / INVALID_OPTION                | Invalid or inaccessible Worker, parser, or Resource configuration.                        |
| adapterDisposed / ADAPTER_DISPOSED            | A general Adapter request after close / dispose.                                          |
| requestAborted / REQUEST_ABORTED              | Cooperative serialization or stream cancellation; inspect reason and actual buffer state. |
| invalidRequestChunk / INVALID_REQUEST_CHUNK   | Invalid Worker request chunk.                                                             |
| invalidResponseChunk / INVALID_RESPONSE_CHUNK | Invalid response chunk or frame sequence.                                                 |
| cleanupFailed / CLEANUP_FAILED                | Both parser Endpoint cleanup and optional termination failed.                             |

STORE_WORKER_SOURCE is @migaia/store-worker. createStoreWorkerError(code, message, options?) requires code / message and accepts options.cause, returning an identified Error. createStoreWorkerAggregateError(code, errors, message) returns AggregateError retaining all values and ordering. code has type IStoreWorkerErrorCode, and factories do not overwrite stack. Complete foreign identities retain their owner.

### Troubleshooting and maintenance

For a pending request, check actual message.data delivery to the correct handler, then WorkerAdapter.timeoutMs / caller signal. workerParser uses context.signal and has no timeoutMs. Handle multi-chunk output incrementally rather than following the old local-merge model. A Worker still alive after Endpoint disposal usually reflects borrowed ownership: its creator terminates the general path, while serialization can opt into terminateOnDispose without claiming confirmed native exit.

The package has fmt / lint / typecheck / typecheck:test / test / build and typecheck:e2e / test:e2e. Browser e2e requires installed Playwright browsers. Node scenarios do not establish browser authorization or every host's behavior. Actual reports identify commands and results; a command list or old benchmark does not establish current verification.
