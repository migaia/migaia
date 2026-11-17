# @migaia/rpc-host

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

Once computation moves into a Worker, a child process or another page, the code that calls it is often harder to get right than the computation: after a timeout the other side keeps running, errors arrive as a bare string, and calls are still waiting when everything shuts down. `@migaia/rpc-host` lets you call functions on the other side like local functions, and carries timeouts, cancellation, errors and shutdown across the boundary: when the caller times out, the other side receives a cancellation signal at once; an error thrown there comes back with its original `source`, `code`, stack and `cause`; closing the host settles every waiting call.

A transport plugin decides the channel: coroutines (same event loop), Worker threads, child processes, browser windows and iframes each have a package, and calls look the same on all of them.

## Problems you may have seen

- **After a timeout, the other side keeps computing**: the caller gives up after 5 seconds, but the Worker finishes the computation anyway and holds the CPU for nothing. The cause is that the timeout exists only on the caller's side and is never sent across as cancellation.
- **Errors are unrecognizable after crossing the boundary**: an error thrown in a child process reaches the main process as a `message` only, without `code` or `cause`, so you can only compare strings. The cause is that the error was serialized into a plain object.
- **Calls hang forever at shutdown**: the Worker is terminated and the Promises waiting for results never settle. The cause is that nobody settles pending calls on shutdown.
- **Switching channels means rewriting the call code**: moving from a Worker to a child process means rewriting request IDs, message formats and timeout logic. The cause is that call logic is tied to the channel.

## Why choose it

The common approach is `postMessage` plus a "request ID → Promise" map, or a proxy that turns method calls into messages. It handles the happy path but breaks in these places:

- **Timeouts and cancellation reach the other side.** When the caller times out or calls `signal.abort()`, the provider's `context.signal` aborts too, so it can stop its work. [Example](./USEGUIDE.en.md#install-complete-policies)
- **Errors come back as the original errors.** Remote errors are restored as native Errors with `source`, `code`, `stack`, `cause` and `AggregateError.errors`, so you can branch on `source/code`. [Example](./USEGUIDE.en.md#close-and-retain-errors)
- **One call API; switching channels means switching plugins.** `request`, `notify`, `stream` and `group` work the same over coroutines, threads, child processes and browser channels; only the transport plugin changes. [Example](./USEGUIDE.en.md#select-targets-and-consume-streams)
- **Shutdown is ordered.** `host.close()` first settles every waiting call with `ENDPOINT_DISPOSED`, then closes the underlying connections; repeated calls share one Promise. [Example](./USEGUIDE.en.md#close-and-retain-errors)
- **Authentication, limits and deduplication are optional Features.** `authFeature`, `limitsFeature`, `idempotencyFeature` and others are separate Features; what you do not install is not bundled. [Example](./USEGUIDE.en.md#authentication-signing-and-duplicate-requests)

If you only call a few functions inside one module, or send data to a Worker once without needing a result or cancellation, plain `postMessage` is simpler.

## Start here

The example uses the coroutine channel in one process: the other side provides two methods, and `slowReport` takes 1 second while the caller's timeout is 100 ms. Run it directly with Node 24.

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

type IReportService = {
  double(value: number): number
  slowReport(): Promise<string>
}

const host = await createRpcHost<IReportService>({
  plugins: [
    coroutinePlugin({
      features: { timeout: timeoutFeature({ ms: 100 }) }, // each call waits at most 100 ms
      // The other side: in a real project it runs in a Worker or child process;
      // here it stays in the same process so the example can run as is
      spawn: async ({ connect, signal }) => {
        const worker = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: {
            double: (value: number) => value * 2,
            slowReport: (_input: undefined, context: { signal: AbortSignal }) =>
              new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => resolve('report'), 1000)
                context.signal.addEventListener('abort', () => {
                  clearTimeout(timer)
                  console.log('the other side was cancelled and stopped the report')
                  reject(context.signal.reason)
                })
              })
          }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true })
            )
        } finally {
          await worker.close()
        }
      }
    })
  ]
})
try {
  console.log(await host.coroutine.request('double', 21))
  await host.coroutine.request('slowReport')
} catch (error) {
  const { source, code } = error as { source: string; code: string }
  console.log(`call failed: ${source} / ${code}`)
} finally {
  await host.close()
}
```

Output:

```text
42
call failed: rpc.endpoint / DEADLINE_EXCEEDED
the other side was cancelled and stopped the report
```

`double` returns `42`. After 100 ms, `slowReport` fails on the caller's side with `DEADLINE_EXCEEDED`, and the other side's `context.signal` aborts, so the report stops instead of running the full second in the background. Calls are written `host.coroutine.request(...)`: `coroutine` is the namespace of this transport plugin; with Worker threads it would be `host.thread.request(...)`.

Next: to move computation into a Worker, see [`@migaia/rpc-plugin-thread`](../rpc-plugin-thread/README.en.md); into a child process, see [`@migaia/rpc-plugin-process`](../rpc-plugin-process/README.en.md); to give every call a default timeout and retry, see [Install complete policies](./USEGUIDE.en.md#install-complete-policies).

## Pitfalls when writing it yourself

Here is a common hand-written Worker call. It works, but it has three hidden problems (for illustration only; no need to run it):

```ts doc-test=check
declare const worker: {
  postMessage(message: unknown): void
  onmessage: ((event: { data: { id: number; result: unknown } }) => void) | null
}

const pending = new Map<number, (value: unknown) => void>()
let nextId = 0

worker.onmessage = (event) => {
  pending.get(event.data.id)?.(event.data.result)
  pending.delete(event.data.id)
}

function call(method: string, payload: unknown): Promise<unknown> {
  const id = nextId++
  worker.postMessage({ id, method, payload })
  // Problem 1: the timeout only stops waiting; the Worker still finishes and holds the CPU
  return Promise.race([
    new Promise((resolve) => pending.set(id, resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
  ])
}

// Problem 2: errors thrown in the Worker must be serialized by hand; code, cause and stack usually get lost
// Problem 3: after worker.terminate(), the Promises in pending never settle
void call('render', { page: 1 })
```

With rpc-host, the timeout reaches the other side as cancellation, errors are restored as they were, and `close()` settles every waiting call.

## The three-minute model

| Concept          | In one sentence                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| host             | The object returned by `createRpcHost`; it owns connections, pending calls and shutdown                                                 |
| Transport plugin | Decides the channel, such as `coroutinePlugin`, `threadPlugin` or `processPlugin`; each transport has one namespace                     |
| Namespace        | The call entry `host.<namespace>.request(...)`; a host usually installs one transport                                                   |
| provider         | A method registered for the other side through the `provide` option or `host.provide()`; its second argument is a context with `signal` |
| Feature          | One optional capability, such as `timeoutFeature`, `retryFeature` or `authFeature`, placed in a transport or flow plugin's `features`   |
| Flow plugin      | `defineFlowPlugin({ name, features })` installs default capabilities for every namespace; only at construction                          |

Call kinds:

| Call                                              | What completion means                                           |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `request(method, payload?, options?)`             | The business result arrived                                     |
| `notify(method, payload?, options?)`              | The message was sent; the other side's handling is not awaited  |
| `stream(method, payload?, options?)`              | An async iterator over values produced by the other side        |
| `group(steps, options?)`                          | A few steps in order per target; not a cross-target transaction |
| `send(targetId, ...)` / `streamTo(targetId, ...)` | Call one chosen target                                          |
| `dispatch(targetId, ...)`                         | Returns synchronously; failures go to the reporter              |

## Common scenarios

| Scenario                                                            | How to combine                                          | Details                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Move heavy computation into a Worker                                | `threadPlugin`                                          | [rpc-plugin-thread](../rpc-plugin-thread/README.en.md)                                                            |
| Run isolated work in child processes and restart them after crashes | `processPlugin`                                         | [rpc-plugin-process](../rpc-plugin-process/README.en.md)                                                          |
| Call between browser windows, iframes and SharedWorkers             | The `rpc-plugin-browser` factories                      | [rpc-plugin-browser](../rpc-plugin-browser/README.en.md)                                                          |
| Spread calls over a group of Workers or child processes             | The transport's `features: { workers: pool({ size }) }` | [rpc-plugin-pool](../rpc-plugin-pool/README.en.md)                                                                |
| Default timeout and retry for every call                            | `defineFlowPlugin` + `timeoutFeature` / `retryFeature`  | [Install complete policies](./USEGUIDE.en.md#install-complete-policies)                                           |
| Signed authentication and duplicate rejection                       | `authFeature` + `idempotencyFeature`                    | [Authentication, signing, and duplicate requests](./USEGUIDE.en.md#authentication-signing-and-duplicate-requests) |
| Control the error details sent to the other side                    | `errorMapFeature`                                       | [Map errors sent to the peer](./USEGUIDE.en.md#map-errors-sent-to-the-peer)                                       |
| Observe calls and generate types                                    | `probe` / `typegen` (`@migaia/rpc-host/plugins`)        | [Observe and generate types](./USEGUIDE.en.md#observe-and-generate-types)                                         |
| See the timeline of several hosts                                   | `@migaia/rpc-plugin-devtools`                           | [rpc-plugin-devtools](../rpc-plugin-devtools/README.en.md)                                                        |

## Install

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

`@migaia/rpc-contract` is a peer dependency that must have the same version; the host and every transport plugin share the one copy provided by the application, and installing your own duplicate copy is not supported. Choose transport plugins by scenario.

## Common APIs

| API                                                          | Purpose                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `createRpcHost({ plugins, provide?, forward?, onWarning? })` | Create a host                                                                   |
| `host.<ns>.request` / `notify` / `stream` / `group`          | Call the other side                                                             |
| `host.provide(definition)`                                   | Register local methods; duplicate names are rejected                            |
| `host.use(...plugins)` / `host.unUse(name)`                  | Install or remove transports after construction                                 |
| `host.close()`                                               | Close the whole host; repeated calls share one Promise                          |
| `defineFlowPlugin({ name, features })`                       | Declare default capabilities shared by every namespace (`@migaia/rpc-host/sdk`) |

Import built-in Features from `@migaia/rpc-host/features`, or one by one from `@migaia/rpc-host/features/<name>`; import error classes and predicates from `@migaia/rpc-host/contract`. See [Entries](./USEGUIDE.en.md#entries) for all entries.

## Contract details

### Construction and later installation

`createRpcHost` commits flow plugins and their Features on one native plugin-host before installing transport plugins and their Features, so capabilities such as authentication are in place when a transport starts its handshake. If a later installation fails, resources already acquired are rolled back and released by the same lifecycle.

After construction, `const extended = await host.use(transport)` installs another transport and returns the same host, typed with the new namespace. Each `use` commits or rolls back on its own; the construction batch succeeds or fails as a whole. Flow plugins that change the message flow can only be configured in the construction `plugins`; installing one later is rejected with `INVALID_CONFIG` (message `RPC flow hooks cannot be installed after transport startup`). Later transports use them automatically, and a transport's own `features` apply only to its namespace. Read-only observation plugins can be installed later.

Existing `defineHost` or class hosts obtain `domainCore` from `rpcHostPipelines(getHost, pipeline)` in `@migaia/rpc-host/sdk`; see [Install RPC in an existing host](./USEGUIDE.en.md#install-rpc-in-an-existing-host).

### Target selection and forwarding

Untargeted calls choose targets only within their namespace: with no target they return empty `fulfilled/rejected`, with one target a scalar, and with several targets `fulfilled/rejected` keyed by instance identity. Each iterator in a stream collection is cancelled independently. `host.<ns>.peers` lists accepted direct peers; functions saved from `peers` stay bound to that connection and do not follow a reconnected peer.

`host.<ns>.send('b', 'c.render', value)` reaches the direct peer b first, and b forwards to c using its current directory. Forwarding can cross namespaces but cannot extend the upstream deadline. `forward: { maxHops }` defaults to 3 and accepts integers 1–16; each host checks for cycles first, then the hop count.

### Optional capabilities

`authFeature`, `chunkFeature`, `batchFeature`, `idempotencyFeature`, `limitsFeature`, `errorMapFeature`, `schemaFeature`, `timeoutFeature` and `retryFeature` all come from `@migaia/rpc-host/features`. Put them into `defineFlowPlugin({ name, features })` (every namespace) or a transport's `features` (overrides the same capability for that namespace only). Each namespace enables one implementation per capability. A host-level `limitsFeature` shares quotas across namespaces; transport-level ones have their own. `probe`, `typegen` and Devtools are host-level only.

```ts doc-test=check
import { timeoutFeature, retryFeature, limitsFeature } from '@migaia/rpc-host/features'
import { probe } from '@migaia/rpc-host/plugins'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import timeoutFromSubpath from '@migaia/rpc-host/features/timeout'

export const defaults = defineFlowPlugin({
  name: 'call-defaults',
  features: { timeout: timeoutFeature({ ms: 1500 }), retry: retryFeature({ attempts: 2 }) }
})
export const capacity = limitsFeature({ maxGlobal: 256, maxPerPeer: 64 })
export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const deadlineFeature = timeoutFromSubpath({ ms: 100 })
export const perCallDeadline = { ms: 100 }
```

The aggregate entry and single subpaths both tree-shake. Without `limitsFeature` there are no quotas; `host.<ns>.outcome(key)` exists only with `idempotencyFeature`. Auth passes the signing binding object to `sign/verify` by default; completed request IDs are released immediately unless you `retain` them for the signing window or a number of milliseconds. See [authentication](./USEGUIDE.en.md#authentication-signing-and-duplicate-requests) for configuration and an HMAC example.

`errorMapFeature` decides synchronously what error information the other side can see, without changing the local original error, reporting or observation. If the callback throws, returns a Promise or produces something that cannot be serialized, the mapping failure is reported and the error is sent under the unmapped rules. Without a mapping, handshake failures of unauthenticated peers hide details by default.

The outbound order is fixed: plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire; inbound is the reverse. Key names and their order in `features` do not decide execution order. Third-party Features are defined with `defineFlowFeature` and must declare an integer `phase` from 0 to 65535; `dependencies` decide installation order and `phase` decides execution order. Auth protects the whole message before chunk splits it into physical frames; the receiver reassembles first, then verifies.

Flow capabilities in use by a session cannot be removed while running; removing their registration is rejected with `LIFECYCLE_MUTATION`, so close the affected namespace first. Capabilities that change the wire format, such as auth, chunk and batch, only guarantee communication when both sides install them.

### Deadlines, cancellation and errors

Timeout and retry take their value in this order: the call's `options.timeout` / `options.retry`, the transport's Feature, then the flow plugin's default. A call accepts `{ ms }`, a retry configuration object or `false`. `timeout: false` disables the timeout, but an inherited upstream deadline still counts down; `retry: false` disables retries. Only the caller's scalar calls and groups retry; streams never replay, and forwarding does not restart the budget.

A call whose remaining deadline has run out before it reaches the provider is rejected with `DEADLINE_EXCEEDED`, and the provider does not run. Every call kind accepts `signal`, and a one-way call can still pass cancellation downstream after it is sent; providers read their own `context.signal`. Cancellation does not kill a process or undo business side effects that already happened.

Branch on `source/code`. Unclassified provider exceptions are `INTERNAL`, with the original error kept in the error graph; scalar calls reject with the restored remote Error. A timeout or disconnect does not prove the business work did not run; reconcile before retrying non-idempotent operations. Calls that return a Promise reject on an invalid `idempotencyKey` (`CONTRACT_INVALID`), a rejected transfer or a closed namespace; `dispatch` returns synchronously and hands failures to the reporter. A failed provider registration rejects with `INVALID_CONFIG` and the original error in `cause`. After shutdown, waiting calls settle with `ENDPOINT_DISPOSED`.

### Child names and warnings

A child started by a parent prefers the name and instanceId chosen by the parent; when the parent gives no name, the child keeps its own `self.name`. When an explicit child name or instanceId is overridden by the parent, one `RpcWarningCode.selfIgnored` (`SELF_IGNORED`) warning is emitted, and `data` holds only the items actually ignored. Warnings go to `onWarning` first, then to host-level subscription plugins, and only fall back to `console.warn` when nobody receives them; warnings are not reported. See [warning subscriptions](./USEGUIDE.en.md#warnings-and-child-names).

### Duplicate call policies

Timeout and retry are singleton roles regardless of their names. Declaring the same role twice in a transport or flow plugin is rejected with `plugin.host / FEATURE_ROLE_CONFLICT`; a flow plugin that conflicts with a transport's built-in capability is rejected with `rpc.endpoint / FEATURE_COMBINATION_CONFLICT`.
