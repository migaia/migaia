# @migaia/store-worker usage guide

Choose a complete example for your task, then consult the parameter and lifecycle contract below. These examples use real Node 24 Workers and MessagePorts. They demonstrate wiring, computation, caching or cleanup, without establishing browser permissions or process isolation.

## Find a scenario

| Scenario                                                     | Main API              | Details                                                                           |
| ------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------- |
| Run a calculation in a real Worker                           | `WorkerAdapter`       | [Complete example](#run-a-calculation-in-a-real-worker)                           |
| Stop requests without terminating a borrowed Worker          | `WorkerAdapter`       | [Complete example](#stop-requests-without-terminating-a-borrowed-worker)          |
| Keep a Worker computation failure traceable                  | `createWorkerHandler` | [Complete example](#keep-a-worker-computation-failure-traceable)                  |
| Use Resource state and cache for Worker results              | `workerComputed`      | [Complete example](#use-resource-state-and-cache-for-worker-results)              |
| Run an existing JSON parser through a Worker registry plugin | `workerPlugin`        | [Complete example](#run-an-existing-json-parser-through-a-worker-registry-plugin) |
| Keep input bytes available when a decode is cancelled        | `workerParser`        | [Complete example](#keep-input-bytes-available-when-a-decode-is-cancelled)        |

## Run the examples

Install this package. The Resource example directly imports reactive, and serialization examples directly import serialize, so install those packages directly too.

```bash
pnpm add @migaia/store-worker @migaia/reactive @migaia/serialize
```

Save each example as a separate ESM TypeScript file and run that file with Node 24. Avoid interactive standard input: the Worker reloads the same file through import.meta.url. The child receives the transferred native port, and the parent closes and terminates its resources in finally. No browser-port substitute or additional Worker wrapper is needed.

## Run a calculation in a real Worker

A large calculation needs to leave the UI thread without making callers manage message identifiers and response matching.

Posting application data alone leaves request matching, startup readiness and failure settlement to handwritten listeners.

Create a real Node Worker, transfer a MessagePort to it, and pair WorkerAdapter with createWorkerHandler. request waits for endpoint initialization; the returned PID and thread id show where the calculation ran.

### Example parameters

`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` executes this file in another thread. `isMainThread` selects the branch, `workerData` carries the child port, and `transferList` transfers that port rather than application input. `port1.start()` enables native port event delivery. The two request type arguments describe input and output statically; the payload is `[20, 22]`, with no cancellation signal. Adapter defaults are `clientId: 'main'` and `timeoutMs: undefined`, meaning no deadline.

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(
    (values: number[]) => ({
      total: values.reduce((sum, value) => sum + value, 0),
      pid: process.pid,
      threadId
    }),
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  try {
    const result = await adapter.request<
      number[],
      {
        total: number
        pid: number
        threadId: number
      }
    >([20, 22])
    console.log('result:', result.total, result.pid === process.pid, result.threadId !== threadId)
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

Output:

```text
result: 42 true true
```

The output is `result: 42 true true`: the result is 42, the Worker shares the parent's process, and it runs on a different thread.

This is Node 24 native Worker execution, not a browser or process-isolation test. clientId defaults to 'main' and timeoutMs to undefined; the caller must close its borrowed port and terminate its own Worker.

## Stop requests without terminating a borrowed Worker

A screen closes its RPC client while the application still owns the Worker and its port.

Terminating the Worker inside client cleanup destroys a resource owned elsewhere; only marking the client closed leaves its endpoint subscriptions installed.

Use close to reject new requests immediately, then await dispose to release the endpoint. Repeated dispose calls share one Promise; a native ping afterward checks that the borrowed Worker port still works.

### Example parameters

`close()` and `dispose()` take no arguments. The former retires request admission synchronously; the latter releases the endpoint asynchronously and shares one Promise across calls. The native `'ping'` / `'pong'` exchange checks that the borrowed port still works; it is separate from this package's request protocol. This example created the port and Worker, so its `finally` block closes and terminates them.

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(
    (value: number) => value * 2,
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => {
    if (message === 'ping') {
      port.postMessage('pong')
      return
    }
    void handler(message).catch(console.error)
  })
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  try {
    console.log('before close:', await adapter.request(21))
    adapter.close()
    const failure = await adapter.request(21).catch((error: unknown) => error)
    console.log('closed:', adapter.disposed, (failure as { code?: string }).code)
    const first = adapter.dispose()
    console.log('same cleanup:', first === adapter.dispose())
    await first
    const pong = new Promise<unknown>((resolve) => port1.once('message', resolve))
    port1.postMessage('ping')
    console.log('borrowed port:', await pong)
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

Output:

```text
before close: 42
closed: true ADAPTER_DISPOSED
same cleanup: true
borrowed port: pong
```

The output is `before close: 42`, `closed: true ADAPTER_DISPOSED`, `same cleanup: true`, then `borrowed port: pong`.

close only changes admission; dispose performs asynchronous endpoint cleanup and can reject. Neither closes the native port nor terminates the Worker. The final ping is a separate native host message, not an RPC request.

## Keep a Worker computation failure traceable

A Worker calculation throws a TypeError caused by an earlier RangeError, but the caller needs both failures to diagnose the input.

Sending only an error message loses native types, the nested cause and the original stack information across the thread boundary.

Wrap the real computation with createWorkerHandler and forward incoming messages to it. RPC restores the native TypeError and its RangeError cause; no custom error-message protocol is needed.

### Example parameters

Both functions passed to `createWorkerHandler(compute, postMessage)` are required. Here, compute throws a native `TypeError` with a cause, while postMessage delegates to the native port. No timeout is configured, so requests have no default deadline. Read the transferred cause chain rather than expecting object identity with the child-side error. The message listener observes delivery failures from the handler's Promise.

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const root = new RangeError('invalid row')
  const failure = new TypeError('cannot compute total', { cause: root })
  const handler = createWorkerHandler(
    () => {
      throw failure
    },
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  try {
    const failure = (await adapter.request([1, 2]).catch((error: unknown) => error)) as Error
    const primary = failure
    const root = primary.cause as Error
    console.log('remote:', failure.name, (failure as Error & { code?: string }).code)
    console.log('primary:', primary instanceof TypeError, primary.message)
    console.log('cause:', root instanceof RangeError, root.message)
    console.log('stacks:', Boolean(primary.stack), Boolean(root.stack))
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

Output:

```text
remote: TypeError INTERNAL
primary: true cannot compute total
cause: true invalid row
stacks: true true
```

The output is `remote: TypeError INTERNAL`, `primary: true cannot compute total`, `cause: true invalid row`, then `stacks: true true`.

The native terminal restores the provider TypeError at the top level, tagged rpc.endpoint / INTERNAL, retaining its stack and original RangeError cause; no RpcRemoteError outer is added. The message handler's Promise covers delivery, not compute completion; await the main-side request for the operation result.

## Use Resource state and cache for Worker results

A view needs loading and successful states plus a cached Worker result, and its inputs can change later.

Keeping a separate result variable and cache beside Worker requests duplicates Resource behavior and makes it easy to show a result for outdated inputs.

Use workerComputed with a synchronous selector and the signal's Runtime. autoStart false skips eager construction work; reading state can still start lazy work. Await refetch, read the cached promise, then explicitly refresh after input changes.

### Example parameters

`runtime` is explicitly the input signal's runtime; omission uses `defaultRuntime`. The selector synchronously returns `values.value`. `autoStart: false` overrides the default `true` only for eager construction; the first `state` read can still start work. `ttl` defaults to `Infinity` and is unchanged here. `refetch()` forces work, while passive `promise` reads can reuse fresh cache. Dispose the Resource before its borrowed adapter and native Worker.

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { createRuntime } from '@migaia/reactive'
import { WorkerAdapter, createWorkerHandler, workerComputed } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(
    (values: number[]) => values.reduce((total, value) => total + value, 0),
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  const runtime = createRuntime()
  const values = runtime.signal([1, 2, 3])
  const sum = workerComputed<number[], number>(adapter, () => values.value, {
    runtime,
    autoStart: false
  })
  try {
    console.log('before:', sum.state.status)
    console.log('first:', await sum.refetch(), sum.state.status)
    const cached = sum.promise
    console.log('cache:', cached === sum.promise, await cached)
    values.value = [4, 5]
    console.log('next:', await sum.refetch(), sum.state.status)
  } finally {
    sum.dispose()
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

Output:

```text
before: pending
first: 6 success
cache: true 6
next: 9 success
```

The output is `before: pending`, `first: 6 success`, `cache: true 6`, then `next: 9 success`.

autoStart defaults to true; false skips eager construction, not lazy state reads. The first state read starts work and reports pending. ttl defaults to Infinity; passive promise reads reuse fresh cache, while refetch forces work. Dispose Resource before its borrowed adapter and Worker.

## Run an existing JSON parser through a Worker registry plugin

An application already uses a serialization registry, but one parser should execute inside a Worker.

Replacing registry calls with ad hoc messages duplicates format routing and cleanup, while running another parser on the main thread defeats the intended execution boundary.

Install jsonParser with createSerializeWorkerHandler inside a real Worker, then register workerPlugin on the main side. Keep the existing registry encode and decode calls; the type label selects this plugin.

### Example parameters

`worker` is required and receives a native port. `type: 'json'` overrides the default `'worker'` label for local registry routing; it does not change the Worker-side `jsonParser()` algorithm. Defaults are `clientId: 'main'`, and `terminateOnDispose: false`. Registry encode/decode calls use the plugin; registry disposal releases its endpoint, while the example still owns the native port and Worker.

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { createSerializeRegistry } from '@migaia/serialize'
import { jsonParser } from '@migaia/serialize/plugins'
import { createSerializeWorkerHandler, workerPlugin } from '@migaia/store-worker/serialize/worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>
    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const registry = createSerializeRegistry([workerPlugin({ worker: port1, type: 'json' })])
  try {
    const chunk = await registry.encode({ title: 'report', count: 2 })
    const value = (await registry.decode(chunk)) as { title: string; count: number }
    console.log('chunk:', chunk[0])
    console.log('restored:', value.title, value.count)
  } finally {
    await registry.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

Output:

```text
chunk: text
restored: report 2
```

The output is `chunk: text`, then `restored: report 2`: the Worker-side JSON parser produces a text chunk and restores the original fields.

The explicit type 'json' replaces the default 'worker'; terminateOnDispose defaults to false. Registry disposal releases its parser endpoint, while the caller closes the native port and Worker. This is wiring evidence, not a speed measurement.

## Keep input bytes available when a decode is cancelled

A byte buffer may be needed for a later retry, while the current decode can become unnecessary before it is sent.

All Worker calls copy parameters without detaching caller input. Cancellation and input memory remain separately observable; work already running must cooperate with its signal.

Use workerParser's copying path for the real Worker JSON parser. Decode once, then pass a pre-aborted signal and inspect its failure cause and the original bytes before deciding whether to retry.

### Example parameters

`workerParser({ worker: port1 })` uses `type: 'worker'`, `clientId: 'main'`, and `terminateOnDispose: false`. Decode receives `['bytes', bytes]` plus context: `signal` controls this call, and `'settings'` names its diagnostic context. The second call is cancelled before sending, preserving the original `DOMException` as cause and keeping the bytes attached; this does not prove forced interruption of work already running.

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { jsonParser } from '@migaia/serialize/plugins'
import { createSerializeWorkerHandler, workerParser } from '@migaia/store-worker/serialize/worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>
    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const parser = workerParser({ worker: port1 })
  const bytes = new TextEncoder().encode('{"count":2}')
  try {
    const context = { signal: new AbortController().signal, context: 'settings' }
    const value = (await parser.decode(['bytes', bytes], context)) as { count: number }
    console.log('decoded:', value.count, bytes.byteLength)
    const controller = new AbortController()
    const reason = new DOMException('Request no longer needed', 'AbortError')
    controller.abort(reason)
    const failure = (await Promise.resolve(
      parser.decode(['bytes', bytes], {
        signal: controller.signal,
        context: 'settings'
      })
    ).catch((error: unknown) => error)) as Error & { code?: string }
    console.log('cancelled:', failure.code, failure.cause === reason)
    console.log('input:', new TextDecoder().decode(bytes))
  } finally {
    await parser.dispose?.()
    port1.close()
    await worker.terminate()
  }
}
```

Output:

```text
decoded: 2 11
cancelled: REQUEST_ABORTED true
input: {"count":2}
```

The output is `decoded: 2 11`, `cancelled: REQUEST_ABORTED true`, then `input: {"count":2}`.

All Worker calls copy parameters without detaching caller input. This pre-cancelled decode preserves the caller's reason as cause and does not send work; it does not prove interruption of an already-running calculation.

## Contract details

### Responsibility, entries, and runtime boundaries

This package connects two Worker use cases. WorkerAdapter / createWorkerHandler execute general computation, while workerComputed connects requests to Resource; the serialization subentry connects an ordinary parser to Worker and SerializeRegistry. The bridge internally creates one `createRpcHost` with `dedicatedWorkerPlugin({ worker })`. rpc-host owns request correlation, providers, cancellation, deadlines, source identity, and error transport; rpc-plugin-browser lends the physical carrier. Resource owns caching and reactive lifetime, and serialize owns formats. This package retains payload conversion and chunk credit / ACK without another RPC engine.

| Entry                                   | Public contents                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@migaia/store-worker`                  | WorkerAdapter, createWorkerHandler, workerComputed, IManagedRpcHandler, port / Resource option types, diagnostic constants, and errors. |
| `@migaia/store-worker/serialize/worker` | workerParser, workerPlugin, createSerializeWorkerHandler, IWorkerPluginOptions, IWorkerLike, and IWorkerFailureEvent.                   |

Runtime dependencies are reactive, resource, serialize, rpc-host, rpc-plugin-browser, rpc-contract, and utils. Install directly imported packages explicitly. Serialization factories use the exact `/serialize/worker` subentry, without root aliases or a wildcard. encodeWorkerValue / decodeWorkerValue stay internal. The obsolete CHUNK_MERGE_FAILED path is removed; six local codes remain.

One bridge owns one RPC host and one borrowed physical Worker connection, defaulting to local identity main and remote identity worker. Initial providers register before connection preparation; later registration uses the same Host provide path. This does not make one Worker object a shared multi-client service. A MessagePort can satisfy the port shape, but its creator still arranges a separate physical link and ownership.

IWorkerPort aliases the browser plugin's IWebWorkerLikePort: postMessage, addEventListener, and removeEventListener with message / error / messageerror events. Browser Worker, MessagePort, or one SharedWorker.port can provide that shape. Node examples use an actual Worker and native MessagePort. IWorkerLike also permits optional terminate(); structural compatibility does not transfer native Worker creation or exit ownership.

### WorkerAdapter: the caller's connection

`new WorkerAdapter(port, options?)` returns synchronously while its Endpoint initializes asynchronously. request awaits initialization automatically; there is no additional ready API.

| Construction or request parameter | Default and behavior                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| port                              | Required actual borrowed message port.                                                                             |
| options.clientId                  | main, the local Core id. Use one adapter for one physical connection rather than duplicating adapters on a Worker. |
| options.timeoutMs                 | undefined, with no default request deadline; supply milliseconds when needed.                                      |
| request(payload, options?)        | Sends input and returns a result Promise; Input / Output generics provide caller-side static typing only.          |
| Request signal                    | Unset; cooperative cancellation scoped to that request.                                                            |

Construction captures clientId / timeoutMs, and requests capture signal without rereading caller getters after initialization. Invalid option objects or property reads produce INVALID_OPTION with caught failures on cause. request rejects its Promise while construction errors throw synchronously. Core retains later port and RPC admission rather than every Core failure becoming a local error.

One Adapter supports concurrent requests. The Host correlates each result and isolates its deadline / cancellation. Independent requests can use Promise.all, but this native runtime path emits call/terminal operations and does not promise legacy envelope auto-batching. request waits for business completion. Internal notify uses `host.worker.notify(method, payload, { targetId })`: its Promise settles after actual physical send, not a provider reply. A native postMessage failure rejects with its original error on cause; no business response is sent for notification.

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

`workerComputed(adapter, selectInput, options?)` returns a standard `Resource<Output>`. Each fetcher invocation synchronously calls selectInput once, requests that input through the Adapter, and forwards Resource signal. Resource tracks synchronous signal / computed reads; reads after await do not become that invocation's synchronous dependencies. This does not establish global caching or deduplication across Resources or Workers.

| Parameter / option   | Default and meaning                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------- |
| adapter              | Required WorkerAdapter instance, borrowed rather than disposed by Resource.                  |
| selectInput          | Required synchronous function producing current input.                                       |
| runtime              | defaultRuntime.                                                                              |
| ttl                  | Infinity, Resource cache lifetime.                                                           |
| autoStart            | true; false skips eager construction, while state / promise reads can still start lazy work. |
| staleWhileRevalidate | false.                                                                                       |
| retry                | 0; alternatively (failureCount, error) returns whether to retry.                             |
| retryDelay           | 0; alternatively (failureCount, error) returns milliseconds.                                 |
| keepAlive            | false.                                                                                       |
| initialSnapshot      | undefined.                                                                                   |
| debugName            | undefined.                                                                                   |
| scheduler            | systemScheduler.                                                                             |

Resource receives these options without Worker-specific reimplementation. Known keys are captured once without object-rest enumeration of unknown getters. Invalid adapter, selectInput, or option getters synchronously produce INVALID_OPTION before Resource ownership / automatic startup, retaining caught causes. refetch, load, state, and dispose retain the resource package's semantics.

Release Resource first, await adapter.dispose, then let the creator terminate the physical Worker / ports. All Worker calls copy their parameters without detaching caller input.

### Serialization parser and plugin

workerParser(options) is a caller-side ISerializeParser. workerPlugin(options) simply combines that parser's name and instance into an ISerializePlugin for createSerializeRegistry. Import both only from /serialize/worker.

| IWorkerPluginOptions field | Default and purpose                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| worker                     | Required IWorkerLike port.                                                                                                      |
| type                       | worker, the registry format label; it must describe the actual Worker parser's encoding and be selected correctly when reading. |
| clientId                   | main.                                                                                                                           |
| terminateOnDispose         | false; supplied Workers remain caller-owned.                                                                                    |

These four fields are read once at admission. Invalid option objects, reflection / property reads, or field values produce INVALID_OPTION. There is no parser.timeoutMs option. Use SerializeContext.signal for cancellation; registry lifecycle budgets remain separate.

encode(value, context) classifies Uint8Array input as bytes and other input as value, returning an asynchronous sequence of chunks rather than one merged result. decode(chunk, context) requests decoding and returns the result payload without another chunk wrapper. context carries signal and a diagnostic context name; the registry supplies its actual context.

workerParser.dispose retires active output and closes its Endpoint. By default it does not terminate the physical Worker. With terminateOnDispose true it still attempts optional terminate after Endpoint cleanup failure. This captures synchronous throws from terminate rather than awaiting native asynchronous exit. Endpoint-only failure retains RpcLifecycleError cleanup details; terminate-only failure retains that exception; both failures produce CLEANUP_FAILED AggregateError with Endpoint then termination in errors. Repeated parser.dispose calls reuse one Promise. Await Registry.dispose to observe its async cleanup result.

### Worker serialization and chunk streams

createSerializeWorkerHandler(parser, post) requires a real parser with encode / decode and a post(message, transfer?) callback delegating to its actual port. Invalid shapes reject synchronously before Endpoint creation. An unowned extensible native error thrown by a parser-member getter stays the same object with native type / stack and gains INVALID_OPTION. Complete foreign source/code identities survive, and values that cannot be annotated remain reachable through cause or aggregation.

The handler passes the input chunk payload to parser.encode. Results may be one valid ISerializeChunk or a sync / async chunk iterable. The caller receives open / chunk / end incrementally, with two initial credits and ordered ACK; consumption restores credit. Neither collectStream nor whole-output merging is used. Credit bounds sending progress for one stream, not the whole Worker's byte budget; the producer may obtain its next chunk before waiting for sending credit.

Valid text / bytes / value chunks retain order, including empty and mixed streams. parser.decode receives the original chunk; Uint8Array output is classified as bytes and other output as value. Worker inputs and outputs use the existing portable-copy representation without detaching caller input.

Early consumer completion or cancellation notifies that stream, wakes producers awaiting credit, and attempts iterator.return. If cleanup also fails, existing secondary-error attachment retains the primary and secondary chains. Core RPC rejection transports source/code/name/message/stack/cause/errors rather than a separate application error frame. Uncooperative business code still requires application ownership; stream cancellation does not forcibly stop the Worker.

### Copied Worker inputs

All Worker calls copy their parameters without detaching caller input. WorkerDiagnosticType contains worker; bytes travel through the existing base64url portable representation. Encoding and round trips still cost time; no zero-copy delivery or speed ratio is promised.

### Cancellation, errors, and ownership

General Adapter requests retain canonical Host cancellation, timeout, and transport errors. Unclassified provider failures retain their native Error/TypeError at the top level, tagged rpc.endpoint / INTERNAL. Their message, stack, and nested cause chain remain intact; unidentified native cause nodes retain unknown / UNKNOWN. There is no RpcRemoteError outer. A cross-realm object is reconstructed rather than retaining sender-side reference identity. Without a deadline, a provider that never settles can still leave a request pending.

Serialization decode / request and pre-cancelled encode use SerializeCodecError / REQUEST_ABORTED with type (default worker), phase encode / decode, context, chunkIndex 0, and bytesConsumed (input byte length or zero). The caller's signal.reason remains on cause. Active encode streams can end with the original RPC / cancellation error rather than every codec diagnostic field. Credit waits and explicit stream stop create native DOMException / AbortError with message serialize stream cancelled and REQUEST_ABORTED, preserving native type, message, and stack through the error chain.

| StoreWorkerErrorCode property / value         | Trigger                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| invalidOption / INVALID_OPTION                | Invalid or inaccessible Worker, parser, or Resource configuration.                        |
| adapterDisposed / ADAPTER_DISPOSED            | A general Adapter request after close / dispose.                                          |
| requestAborted / REQUEST_ABORTED              | Cooperative serialization or stream cancellation; inspect reason and actual buffer state. |
| invalidRequestChunk / INVALID_REQUEST_CHUNK   | Invalid Worker request chunk.                                                             |
| invalidResponseChunk / INVALID_RESPONSE_CHUNK | Invalid response chunk or frame sequence.                                                 |
| cleanupFailed / CLEANUP_FAILED                | Both parser Endpoint cleanup and optional termination failed.                             |

STORE_WORKER_SOURCE is store.worker. createStoreWorkerError(code, message, options?) requires code / message and accepts options.cause, returning an identified Error. createStoreWorkerAggregateError(code, errors, message) returns AggregateError retaining all values and ordering. code has type IStoreWorkerErrorCode, and factories do not overwrite stack. Complete foreign identities retain their owner.

### Troubleshooting and maintenance

For a pending request, check actual message.data delivery to the correct handler, then WorkerAdapter.timeoutMs / caller signal. workerParser uses context.signal and has no timeoutMs. Handle multi-chunk output incrementally rather than following the old local-merge model. A Worker still alive after Endpoint disposal usually reflects borrowed ownership: its creator terminates the general path, while serialization can opt into terminateOnDispose without claiming confirmed native exit.

The package has fmt / lint / typecheck / typecheck:test / test / build and typecheck:e2e / test:e2e. Browser e2e requires installed Playwright browsers. Node scenarios do not establish browser authorization or every host's behavior. Actual reports identify commands and results; a command list or old benchmark does not establish current verification.
