# `@migaia/rpc-threads`

Run functions in real Workers and use one bidirectional request and stream API to manage results, restart, and closure.

## You may have run into this

- **A Worker gets stuck and the call never returns.** The input is too large, the algorithm loops, or the user has cancelled, yet the main thread's Promise stays pending and you have to build timeouts and cancel messages yourself. [Example](./USEGUIDE.en.md#fail-a-stuck-call-at-its-deadline-or-cancel-it-midway)
- **After a Worker crashes, waiting calls never get a reply.** The thread is gone and nothing rejects the Promises still waiting on it. [Example](./USEGUIDE.en.md#fail-in-flight-calls-at-once-when-the-worker-crashes)
- **An error thrown in a Worker reaches the main thread without its `code`.** A custom error turns into a plain `Error`, so you cannot handle it by kind. [Example](./USEGUIDE.en.md#get-the-error-class-code-and-cause-back-from-the-worker)
- **Under a request peak, messages pile up in the Worker's queue.** Every call waits longer, memory grows, and the caller cannot tell the Worker is overloaded. [Example](./USEGUIDE.en.md#reject-calls-beyond-the-workers-limit-instead-of-queueing-them)
- **A Worker needs to call back into the main thread or return results one by one.** You end up adding another set of message types and routes and matching requests to replies all over again. [Example](./USEGUIDE.en.md#call-the-parent-and-consume-worker-results-through-one-connection)

## Why choose it

The usual approach is to add request ids on top of `postMessage`, or to use a thin wrapper that turns a Worker into a proxy object so calls read `await api.method()`. Those make a call look local, but they leave you on your own once the call goes wrong. That is the part this package covers:

- **Stuck calls expire, and any call can be cancelled.** A typical wrapper resolves only when the Worker replies, so timeouts and cancellation are yours to build. Here every call has a 30-second deadline by default, which `timeoutMs` overrides, and accepts an `AbortSignal`; a call that expires or is cancelled rejects with a `TimeoutError` or `AbortError` carrying a `code`. [Example](./USEGUIDE.en.md#fail-a-stuck-call-at-its-deadline-or-cancel-it-midway)
- **When the Worker crashes, calls in flight fail at once.** A typical wrapper leaves you to listen for `exit` and reject each waiting call yourself. Here, as soon as the connection drops, unfinished calls reject with `REMOTE_RESULT_UNKNOWN`, which tells you plainly that the result is unknown and should be reconciled before a retry; by default the Worker is also restarted with a growing delay. [Example](./USEGUIDE.en.md#fail-in-flight-calls-at-once-when-the-worker-crashes)
- **Errors come back intact.** Structured cloning turns a custom error into a plain `Error` and drops custom fields such as `code`. Here the class name, `code` and `cause` chain are restored, so the main thread keeps branching on `code`. [Example](./USEGUIDE.en.md#get-the-error-class-code-and-cause-back-from-the-worker)
- **Overload is rejected, not queued forever.** A typical wrapper pushes every message into the Worker's queue. Here the number of calls running at once is capped; a call over the cap rejects immediately with `OVERLOADED` without running the provider, so the caller can throttle or degrade right away. [Example](./USEGUIDE.en.md#reject-calls-beyond-the-workers-limit-instead-of-queueing-them)
- **Calls in both directions and streams share one connection.** Either side can provide methods and make calls, and a method that returns an async generator is read item by item with `stream()`, with no extra message routing. [Example](./USEGUIDE.en.md#call-the-parent-and-consume-worker-results-through-one-connection)

When you do not need it: if you only hand the occasional computation to a Worker and do not care about timeouts, crashes or overload, plain `postMessage` is simpler. When you need process-level permission or fault isolation, use [rpc-process](../rpc-process/README.en.md).

## Start here

Install this package and both Core and Contract peers, save overview.ts in an ESM project, and run the real file with Node 24; the Worker re-executes the complete entry.

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract
```

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const worker = await createThreadPeer<{ double(value: number): number }>({ spawn: true })
  try {
    console.log(await worker.request('double', 21))
  } finally {
    await worker.close()
  }
}
```

Output:

```text
42
```

For byte ownership, see [Keep copied bytes usable when unsigned RPC transfer is refused](./USEGUIDE.en.md#keep-copied-bytes-usable-when-unsigned-rpc-transfer-is-refused); for calls after restart, see [Call a restarted Worker as soon as its Host reports ready](./USEGUIDE.en.md#call-a-restarted-worker-as-soon-as-its-host-reports-ready).

provide.double accepts a number; spawn: true selects this entry, and the parent closes its Worker in finally. Short-source defaults are budget 1, systemScheduler, best-effort isolation, and a 30000 ms call deadline. Omitted self uses a generated identity, and omitted report uses the default diagnostic output.

## Pitfalls when writing it yourself

Display only: the same send-a-number and receive-a-result task, without executing this fragment:

```ts doc-test=check
import { Worker } from 'node:worker_threads'

const source = `
  import { parentPort } from 'node:worker_threads'
  parentPort.on('message', (value) => parentPort.postMessage(value * 2))
`
const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)))
worker.once('message', (value) => console.log(value)) // No request id to correlate concurrent results
worker.postMessage(21) // No call deadline or cancellation path
void worker // No final release; the Worker can remain alive
```

The preceding example correlates one request with its result and closes its owned Worker in finally; the child guard prevents recursive spawning when the entry runs again. This native fragment is displayed only and is not executed.

## A three-minute mental model

| Problem                              | Tool                             | Release owner                                                  |
| ------------------------------------ | -------------------------------- | -------------------------------------------------------------- |
| One independent Worker               | createThreadPeer + spawn         | Its creator awaits close.                                      |
| Calling back into the parent         | Parent provide + Worker request  | The same Peer connection.                                      |
| Incremental results                  | stream + iterable provider       | The consumer ends iteration and eventually closes the Peer.    |
| Host-managed restart and replacement | createThreadPlugin + host.thread | The Host.                                                      |
| An existing MessagePort              | connect + channel                | The connection unsubscribes; the caller still closes the port. |

A **Peer** is a call object holding one logical connection. A **generation** is the Worker instance from one launch. A **capability proposal** lists locally supported protocol features; actual agreement is required before use. A **budget** limits simultaneously live Workers rather than measuring CPU time.

## Typical scenarios

| Scenario                                                                     | How to combine                                              | Details                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Run work on a real Worker without confusing it with another process          | isThreadChild → createThreadPeer → request → close          | [Complete code](./USEGUIDE.en.md#run-work-on-a-real-worker-without-confusing-it-with-another-process)          |
| Call the parent and consume Worker results through one connection            | provide → request / stream → close                          | [Complete code](./USEGUIDE.en.md#call-the-parent-and-consume-worker-results-through-one-connection)            |
| Keep copied bytes usable when unsigned RPC transfer is refused               | request → transfer admission → request                      | [Complete code](./USEGUIDE.en.md#keep-copied-bytes-usable-when-unsigned-rpc-transfer-is-refused)               |
| Call a restarted Worker as soon as its Host reports ready                    | createThreadPlugin → host.use → restart → request → dispose | [Complete code](./USEGUIDE.en.md#call-a-restarted-worker-as-soon-as-its-host-reports-ready)                    |
| Close a borrowed channel while keeping its native port usable                | channel → subscribe → close → native postMessage            | [Complete code](./USEGUIDE.en.md#close-a-borrowed-channel-while-keeping-its-native-port-usable)                |
| Retain captured bytes across a real native transfer and observer replacement | observe → send(transfer) → replace / stop                   | [Complete code](./USEGUIDE.en.md#retain-captured-bytes-across-a-real-native-transfer-and-observer-replacement) |

## Installation

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract
```

Node 24 can run the real .ts files on this page directly. The published engine minimum is >=18, which does not imply that every supported Node version strips TypeScript like Node 24. Browser entries need built module URLs. Install utils directly for the channel examples and PluginHost for the Host example:

```bash
pnpm add @migaia/plugin-host @migaia/utils
```

## Essential APIs

| API                              | When to use it                                                    |
| -------------------------------- | ----------------------------------------------------------------- |
| createThreadPeer                 | Own a Worker connection or connect through an existing port.      |
| isThreadChild                    | Choose the child branch before self spawn.                        |
| peer.request / notify            | Await one result or invoke without a business-completion receipt. |
| peer.stream                      | Consume a remote sequence incrementally.                          |
| createThreadPlugin / host.thread | Delegate installation, restart, and replacement to a Host.        |
| peer.close / host.dispose        | Release the connections and Workers you own.                      |

## Contract details

### Responsibility, installation, and entries

This package creates Workers, connects their message ports, and delegates admission budgets, startup, restart, and release to supervision. Core owns call correlation, catalogs, deadlines, cancellation, error restoration, and retry; Contract owns the protocol and portable values. Use it to move parsing, compression, image processing, or similar work off the main thread, or to let a Host manage several Worker connections.

Threads share a process and do not replace separate process permissions or fault isolation. Use [rpc-process](../rpc-process/README.en.md) for a separate process. [rpc-browser](../rpc-browser/README.en.md) provides Peers for windows, iframes, SharedWorkers, and reliable ordered RTCDataChannels, and Endpoint transports for Service Workers and BroadcastChannels. SharedArrayBuffer / Atomics shared memory is outside this package's supported profile.

| Entry                                        | Contents                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@migaia/rpc-threads`                        | Peer, Plugin, child guard, error codes, advanced channels and Web launcher, plus public configuration and handle types. |
| `@migaia/rpc-threads/adapters/node`          | `createNodeThreadLauncher`, `createNodeThreadChannelFactory`.                                                           |
| `@migaia/rpc-threads/adapters/electron-main` | `createElectronMainThreadLauncher`, `createElectronMainThreadChannelFactory`.                                           |

Install both Core and Contract peer dependencies explicitly. The package does not enforce a hardcoded equality between their version numbers. lifecycle, supervision, and utils are runtime dependencies. The Electron-main entry additionally uses the optional peer `electron: ^44.0.0`. Install PluginHost or utils directly when an example imports them.

Web, Bun, Deno, and Electron renderer use the root Web launcher and channel factory. Import `INodeThreadHandle`, `IWebThreadHandle`, `IWebThreadLauncherOptions`, and advanced native runtime types from the root. Core's typed surfaces, query/detail/list/event types, and thread stop options are re-exported rather than defining another call protocol.

### Peer sources, typing, and calls

`createThreadPeer<TRemote>(options, runtime?)` returns a typed Peer. `TRemote` defaults to `Record<never, never>`; it checks the caller's paths without registering Worker methods. `IRuntimeDynamicSurface` relaxes static path checking while the actual remote catalog still controls runtime admission. The default local identity is `{ name: 'thread', instanceId: generated value }`; set self.name and self.instanceId for a stable address.

On the main thread, choose a short spawn, a full spawn source, or Core's connect / listen source; do not combine sources. Inside a Worker launched by this library, omit the source to connect through its real Node parentPort / workerData or Web bootstrap. Running an ordinary Worker file separately does not grant that connection. `isThreadChild()` reads the launch marker to choose a branch; it does not authorize an external Worker or replace capability acknowledgement.

Omitting provide exposes no application methods. Own enumerable data properties containing functions define methods; nested objects form dotted paths. Accessors are not method declarations. Call iterable / async iterable providers through stream. The Worker also receives a Peer and can request methods from its parent's provide descriptor.

| Operation                            | Purpose and boundary                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `request(method, ...args)`           | Await one result using the actual catalog and typed surface.                                                                          |
| `notify(method, ...args)`            | Send a one-way invocation without a receipt proving business completion.                                                              |
| `stream(method, ...args)`            | Consume a remote iterable / async iterable incrementally; cancellation remains cooperative.                                           |
| `group`, `outcome`, `describe`, `on` | Use Core's group, result reconciliation, catalog, and event contracts.                                                                |
| `close()` and async disposal         | The creator releases an independent Peer; spawn also releases its owned Worker, while a borrowed source releases only its connection. |

defaultTimeoutMs defaults to 30000, must be positive and finite, and applies only to request / stream. Per-call timeoutMs accepts a nonnegative finite value or false: 0 expires immediately and false disables that deadline. Provider concurrency defaults to 256 globally and 64 per peer, configurable through providerLimits.maxGlobal and providerLimits.maxPerPeer. OVERLOADED rejects before running that provider. spec.limits.callWallTimeMs, when present, caps a longer call deadline.

signal requests cooperative cancellation. A timeout, cancellation, or disconnect does not prove the Worker did not execute. Reconcile non-idempotent writes using a business identifier. For declared idempotent calls with retained results, idempotencyKey and outcome(key) can help; arbitrary retries do not become exactly-once execution. report defaults to Core's diagnostic reporter, normally console.error. probe, contract, authentication, endpointFactory, keyFactory, and retryPort retain their Core-owned contracts.

### Short spawn, entry resolution, and supervision defaults

| spawn                   | Meaning                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| true                    | Re-execute every top-level statement in the main module; await the child guard and keep parent-only effects in the parent branch. |
| URL                     | Use that exact URL.                                                                                                               |
| Path string             | Resolve relative to the main module under Node / Bun / Deno; encode absolute filesystem paths as file URLs.                       |
| `{ entry, ...options }` | entry accepts true, URL, or string; the following fields override defaults.                                                       |

| Short-source field       | Omitted value and purpose                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base                     | Unset. Relative entries use the main module unless an explicit module URL / URL string changes the base; no stack inspection guesses the caller.                    |
| name, data, limits       | Unset; passed into the Worker spec. normalizePortable snapshots data before Worker construction; invalid data produces Core INVALID_CONFIG with its cause retained. |
| scheduler                | systemScheduler, shared by the budget and default channel factory.                                                                                                  |
| budget                   | `createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler })`.                                                                                                     |
| launcher, channelFactory | Loaded lazily for the actual runtime; a custom factory must use the same scheduler.                                                                                 |
| report                   | source.report, then top-level options.report, then Core's default reporter.                                                                                         |
| health                   | Unset. Only launchers without enforced exit observation receive an actual Endpoint ping by default; explicit health takes precedence and retains its identity.      |
| supervisor.isolation     | Short sources default to best-effort; accepted values are required and best-effort.                                                                                 |
| keyFactory, retryPort    | Unset; top-level fields take precedence over source fields.                                                                                                         |

Short syntax expands the existing full source. It accepts no declaration that negotiation or trust has already occurred. Supervision still validates and executes the following policy:

| Field                                                   | Default and values                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| supervisor.id                                           | Generated.                                                                                                                                                                        |
| supervisor.ready                                        | Unset; may provide a real readiness check.                                                                                                                                        |
| supervisor.startupTimeoutMs                             | 10000 ms.                                                                                                                                                                         |
| supervisor.restart.mode                                 | on-failure; alternatives never and always.                                                                                                                                        |
| supervisor.restart.maxRestarts / windowMs               | 5 / 60000 ms.                                                                                                                                                                     |
| supervisor.restart.initialDelayMs / factor / maxDelayMs | 250 ms / 2 / 30000 ms, bounding exponential backoff.                                                                                                                              |
| supervisor.terminalPolicy                               | Omission behaves as mode stay, leaving the supervisor terminal; mode cooldown with afterMs permits another attempt later. Terminal does not mean explicit recovery is impossible. |
| supervisor.stop.exitTimeoutMs / reapTimeoutMs           | 5000 ms each.                                                                                                                                                                     |
| supervisor.stop.beforeTerminate                         | Unset; the binding first drains current calls within the remaining budget, then invokes a custom hook.                                                                            |

The default RPC health policy uses a 5000 ms interval, a 2000 ms check budget, and 3 consecutive failures. The original preparation deadline governs an unbound Endpoint; a bound check addresses only the Endpoint for that actual handle. Removing ping without supplying custom health produces INVALID_CONFIG. A health check does not strengthen an unsupported native exit capability.

Node / Bun self spawn retains runtime flags. A different explicit entry filters the parent's eval, print, and test controller flags while retaining loader and runtime flags. Self spawn rejects with INVALID_CONFIG when a REPL, eval, single binary, Electron application, or test runner has no reusable main module. It does not guess an entry, nor does this rule prohibit an explicitly supplied usable entry.

Node 24 strips TypeScript types but does not redirect a relative ./x.js import to ./x.ts; Bun supports that mapping. Use built output or a suitable loader under Node / Deno for modules containing such specifiers; resolution failures retain the original cause. Browsers require an explicit URL and reject true / bare strings. Dynamic Worker construction also cannot replace a bundler's literal source discovery: supply a built module URL or keep the literal Worker construction in a custom constructor. Deno Workers still require the appropriate host permissions.

### PluginHost and generation ownership

`createThreadPlugin(options, runtime?)` shares Peer sources, provide, and authentication. It additionally requires name. expose defaults to an empty array, exposing no Host application methods to the Worker; only explicitly selected paths are visible. The Host owns installed connections and Workers through host.thread, while the creator owns an independent Peer.

host.thread.request / notify / stream / group / outcome take a connection name or `{ name, instanceId }` first. list / get inspect connections and generations; broadcast returns an individual outcome per target; on / watch use Core's event catalog. stop / kill / restart / replace apply only to spawn sources and cannot terminate an external Worker behind a borrowed connection. Thread stop accepts only `{ graceMs }`; a signal field is rejected even when its value is undefined.

When restart returns ready or replace returns replaced, the new generation is already in the call catalog and may be called immediately. No extra ready event or application backoff is required. Replacement does not move calls already sent to the old generation. Host execution.mutationTimeoutMs and pipelineDrainTimeoutMs require explicit configuration; false disables the respective budget.

### Binary copying, signing, and transfer

| Input or option                       | Behavior                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ArrayBuffer / Uint8Array              | Copied by default, leaving caller storage usable; Uint8Array offset / length are preserved.                             |
| `{ transfer: [buffer] }`              | Requires actual agreement on native binary and transfer, plus signing authentication; otherwise CAPABILITY_UNSUPPORTED. |
| SharedArrayBuffer / other TypedArrays | Unsupported and rejected during call admission.                                                                         |

Configure authentication with sign and verify on both ordinary createThreadPeer factories to use signed native binary; a custom Endpoint is unnecessary. sign must protect the complete semantic input, including Core's integrity digest for native backing storage; verify must reject forged signatures. This profile signs without encryption and uses the default any encodedType. Actual ports acknowledge capability proposals; configuration labels do not establish trust.

For HMAC, both sides obtain the same key from their own deployment configuration. Never send it over RPC or log it. Application code can sign the complete input using createHmac, check the received signature length, then verify with timingSafeEqual and reject invalid authentication. RPC_SIGNING_KEY in the previous example is an application environment variable, not a credential supplied by the library. Node Workers inherit the environment; configure it before importing a module that reads the key.

Storage detaches when the message is physically submitted: byteLength becomes 0 and every view sharing its backing becomes unusable. A later signature rejection or failed call cannot restore it. Transfer calls are not automatically retried, and the library retains no input copy. Reconcile the business outcome before rebuilding data for a retry. This describes the native mechanism without making an unmeasured speed claim.

### Existing ports and advanced sources

createNodeThreadChannel(port, peerId, options) borrows an EventEmitter port; createWebThreadChannel borrows an EventTarget port. options.scheduler is required. Omitted capabilities select the fixed baseline, return synchronously, and perform no runtime hello. Fixed subsets containing only stream / batch also use this synchronous path. Extension proposals return a Promise and wait for Core's bilateral ACK on the actual ports; missing or invalid ACK rejects rather than accepting a one-sided declaration.

In a Peer connect callback, pass context.capabilities to the channel and start both sides together. context.self is Core's prepared local address; peerId identifies the opposite connection. Explicit capabilities narrow the proposal and cannot expand a real launch offer or counterfeit agreement or trust. Logical channel.close / Peer.close removes its own listeners and observer without closing the borrowed native port. The caller closes that port last. A fixed raw channel is not a complete runtime Peer.

A full IRuntimeThreadSpawn requires spec, launcher, budget, scheduler, channelFactory, and report; health, supervisor, keyFactory, and retryPort are optional. It does not inherit the short syntax's isolation override: omitting supervisor.isolation leaves supervision's required default. spec.entry is a Node absolute path / file URL or a Web absolute module URL; spec.name / data / limits are optional. heapBytes and callWallTimeMs are positive limits. The former maps to Node Worker's maxOldGenerationSizeMb, while the latter caps a call deadline; neither is a whole-process memory or CPU quota.

| Platform                          | Launcher / channel factory   | Native capability                                                                                                            |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Node                              | The two node-entry factories | termination, exit-observation, and heap-limit are enforced; only a real exit settles exited.                                 |
| Bun                               | The root Web factories       | termination and exit-observation are enforced; the native Worker close event settles exited. heap-limit remains unsupported. |
| Deno, browsers, Electron renderer | The root Web factories       | All three are unsupported; a terminate request supplies no actual-exit receipt.                                              |
| Electron main                     | The electron-main factories  | Reuse worker_threads but explicitly retain all three as unsupported; Node evidence is not Electron proof.                    |

The Web launcher requires report and accepts a Worker constructor, defaulting to global Worker, plus optional runtimeApi. Its constructor receives entry and `{ type: 'module', name }`. Node launcher options default to an empty object and accept execArgv / runtimeApi; advanced createAdapterNodeThreadLauncher also takes a real runtime resource. Host capabilities are acquired only when a launch occurs. Node sampleUsage is a cold query for this isolate's available heap, CPU microseconds, and ELU. sharedPid is identity only; unavailable native methods leave fields absent, and an exited Worker returns an empty object rather than borrowing parent-process totals.

handle.identity contains a stable fingerprint and, on Node, the threadId captured at construction. handle.port holds real messaging; terminate requests stopping; exited observes exit; Web also exposes prepared. Node settles exited from native exit and Bun from native Worker close. Deno, browsers and Electron renderer declare exit observation unsupported: forced reap immediately reports supervision EXIT_UNOBSERVABLE and retains an abandoned budget lease without waiting for reapTimeoutMs or falsely freeing admission capacity. Observable exit timeouts still report REAP_TIMEOUT; best-effort admission still reports CAPABILITY_UNSUPPORTED. Custom Node / Web handles open a generation with open(signal, { scheduler, capabilities? }); the factory must share its scheduler.

When construction or opening fails, launcher / supervision ownership releases acquired listeners and the candidate Worker. The primary exception stays identical or reachable through cause, with cleanup failures retained in errors. A Node Endpoint construction failure reaps the real Worker and frees its budget. A Web terminate request still cannot manufacture exit proof. Advanced callers that launch directly own logical channel closure, termination, and actual-exit observation; do not await Web exited forever when the platform supplies no receipt.

AdapterNodeThreadParentChannel retains the real parentPort without adding listeners until open selects the fixed profile. createAdapterNodeThreadPeer receives an already held parentPort and original workerData. A runtime resource loads the real Worker module; its pid identifies the shared process. receiveThreadData consumes the matching initial bootstrap, removes its listener, awaits prepare(data, peerId), sends ready, and returns portable business data. readThreadBootstrap validates and extracts peerId / data. These helpers do not authorize arbitrary external Workers.

New adapters reuse defineMessageAdapter from the [Core adapter SDK](../rpc-core/USEGUIDE.en.md); complex native assembly may use its internal-advanced entry without duplicating capability negotiation, retries, or lifecycle ownership. Node Workers and Bun 1.4.3 native Workers have business and shutdown evidence; these results do not establish browser, Deno, or Electron permissions and exit capabilities.

### Carrier observation

transport.observe(probe) on the final channel installs physical message observation, with one event per send and receive. Outbound detail.transfers is the native transfer-list length; inbound is -1 because structured clone does not reveal whether a received buffer was copied or transferred. sizeBytes is the byte length for a direct ArrayBuffer / view and -1 for other native messages, without additional object serialization.

Content is read only when probe.capturing is enabled. Non-transferred content borrows the original reference; transferred backing is copied before sending to preserve observable bytes. Core's selective own-data capture preserves cycles, shared backing, and non-transferred references inside Array, Record, Map, and Set. No additional getter evaluation is promised for transferred buffers exposed only through accessors.

Probe failures report Core TRANSPORT through onListenerError with the original exception on cause, while messaging continues. Reinstalling observe replaces its generation; an old disposer cannot remove the new one. The current disposer, logical close, and existing native terminal path retire observation. Closing a borrowed channel changes neither physical port ownership nor the existing listener and error-cause ordering.

### Errors and retry

The table distinguishes thread sampling, supervision, Core and Remote errors. Import thread APIs from `@migaia/rpc-threads`, Core APIs from `@migaia/rpc-core`, and Remote APIs from `@migaia/rpc-core/remote`; each `source` value retains its error identity.

| Source / code                                      | Meaning and response                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@migaia/rpc/threads` / THREAD_USAGE_SAMPLE_FAILED | Thread CPU / memory sampling failed, with cause retained; display unavailable without changing Worker lifecycle.    |
| @migaia/supervision / EXIT_UNOBSERVABLE            | Exit observation is explicitly unsupported; immediate abandonment retains the lease without a reap wait.            |
| `rpc.endpoint` / INVALID_CONFIG                | Invalid entry, source, bootstrap, capability ACK, portable data, or configuration; inspect field details and cause. |
| `@migaia/rpc/core` / TRANSPORT                     | Native message I/O or startup resource failure, preserving native error type and cause.                             |
| `@migaia/rpc/core` / DEADLINE_EXCEEDED             | TimeoutError; the Worker may already have executed, so reconcile first.                                             |
| `@migaia/rpc/core` / CANCELLED                     | AbortError; cooperative cancellation does not prove non-execution.                                                  |
| `@migaia/rpc/core` / OVERLOADED                    | Provider concurrency was full and that provider was not called; reduce load before retrying.                        |
| `@migaia/rpc/core` / CAPABILITY_UNSUPPORTED        | A required capability was not agreed, such as unsigned transfer.                                                    |
| `@migaia/rpc/core` / TARGET_UNKNOWN                | No current catalog target; check its name and active generation.                                                    |
| `@migaia/rpc/remote` / REMOTE_CLOSED               | Connection or generation is closed; select a current target and reconcile previously sent work.                     |

When native Node Worker construction rejects its arguments, the Node launcher classifies the failure as Core INVALID_CONFIG. If a native code already exists, a wrapper keeps the original Error, name, message, stack, and native code on cause rather than overwriting them. This describes the Node constructor boundary, not every Web constructor exception.

The local RpcThreadErrorCode object contains only usageSampleFailed, whose value is THREAD_USAGE_SAMPLE_FAILED; RPC_THREAD_ERROR_SOURCE is `rpc.transport.thread`. Calls, supervision, and Host boundaries retain their own sources rather than becoming sampling failures. Branch on source / code rather than message text. Business errors crossing Workers preserve native type, message, stack, source/code, and cause / errors chains; the received object cannot retain sender-side identity.

A standalone Worker configuration failure usually means no library bootstrap exists. A caller buffer that remains attached is the default copy behavior. Restart depends on policy; use Host restart / replace for explicit recovery and list / get for generation and exit information.
