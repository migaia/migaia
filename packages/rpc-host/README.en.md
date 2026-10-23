# `@migaia/rpc-host`

Connect application functions across processes, threads, browsers, or cooperative tasks through `createRpcHost`. Install one transport plugin per host and add features as needed.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Why use it

- **Calls and resource ownership stay connected.** The host owns calls, directories, and pending work; the transport preserves native process, Worker, listener, and borrowed-resource ownership.
- **One connection supports both directions and streams.** Both sides can `provide`; `request` waits for a result, `notify` for physical sending, and `stream` yields items.
- **Multiple targets have explicit results.** Calls without a target broadcast. `send` and `dispatch` select a direct target, retaining each target's own failure.
- **Features configure the existing path.** Add deadlines, authentication, retry, chunking, or type generation without assembling lower-level call objects.

## Start here

Install the host, protocol package, and the coroutine transport used below:

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

This creates two real hosts in one event loop. The task's `connect` handle belongs to this generation; closing the parent cancels the task through its original signal.

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
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
    })
  ]
})
try {
  console.log(await host.request('double', 21))
} finally {
  await host.close()
}
```

It prints `42`. Choose another transport below for a separate process or thread; `provide` and the call interface stay the same.

## The model

| Concept          | Responsibility                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| host             | Local identity, providers, calls, and closure; one host constructs one call endpoint                       |
| transport plugin | Prepares the actual source; exactly one per host                                                           |
| feature          | Contributes configuration or observation to existing owners; each definition appears at most once per host |
| `provide`        | Ordinary functions or generators; return values become results and exceptions retain their error chain     |
| `peers`          | Current direct capabilities; held functions remain bound to their original connection generation           |

Set `self` to `{ name, instanceId }`, or let the host generate an independent identity. Names select direct peers; instance IDs distinguish actual instances. A new connection with the same name probes the old session: a responsive old session rejects it, while a failed old session can be retired and replaced.

## Calls and targets

| API                                          | Completion                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `request(method, payload?, options?)`        | Business results from current direct targets                                                                |
| `notify(method, payload?, options?)`         | Physical send completion, without business acknowledgement; `options.targetId` can select one direct target |
| `stream(method, payload?, options?)`         | One iterator or independent iterators indexed by target                                                     |
| `group(steps, options?)`                     | A group of `{ method, payload }` steps per target, without a cross-target transaction                       |
| `outcome(idempotencyKey)`                    | Retained logical outcomes on current targets                                                                |
| `send(targetId, method, payload?, options?)` | A scalar result from one current direct target                                                              |
| `dispatch(targetId, method, payload?)`       | Single-target send with failure reporting; returns `void` synchronously                                     |
| `provide(definition)`                        | Adds local methods; duplicate names reject instead of replacing providers                                   |
| `describe()` / `on(...)`                     | Reads identity, directory, and state; observes existing lifecycle events                                    |
| `close()`                                    | Releases the host; repeated calls share one Promise                                                         |

For an ordinary host, an untargeted call returns `{ fulfilled: {}, rejected: {} }` with zero targets, a scalar with one target (rejecting on its failure), and `fulfilled` / `rejected` maps indexed by target identity with multiple targets. Stream iterators cancel independently. A [pool](../rpc-plugin-pool/README.en.md) exposes only `pool`: every operation selects one member and returns a scalar.

`send('b', 'c.render', payload)` reaches direct peer b first. b must verify that c is its current live direct peer before looking up c's current method directory and forwarding. a cannot directly select c without a connection. b can also explicitly publish a held capability through `provide({ render: b.peers.c.render })`; that function does not silently retarget a later generation.

## Choose transport and features

| Use case                                                             | Package / factory                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Child processes, local services, JSON-RPC byte services              | [rpc-plugin-process](../rpc-plugin-process/README.en.md) / `processPlugin`            |
| Native Node, Bun, Deno threads                                       | [rpc-plugin-thread](../rpc-plugin-thread/README.en.md) / `threadPlugin`               |
| Window, browser Workers, broadcast, ServiceWorker, RTC, WebTransport | [rpc-plugin-browser](../rpc-plugin-browser/README.en.md) / carrier-specific factories |
| Cooperative tasks in one event loop                                  | [rpc-plugin-coroutines](../rpc-plugin-coroutines/README.en.md) / `coroutinePlugin`    |
| Bounded capacity, queueing, and drain                                | [rpc-plugin-pool](../rpc-plugin-pool/README.en.md) / `poolPlugin` feature             |
| Queries, observation, and recording                                  | [rpc-plugin-devtools](../rpc-plugin-devtools/README.en.md) / `devtoolsPlugin` feature |

Shared features support equivalent aggregate and individual imports:

```ts
import {
  timeoutFeature,
  chunkFeature,
  authFeature,
  retryFeature,
  typegenFeature
} from '@migaia/rpc-host/features'
import timeout from '@migaia/rpc-host/features/timeout'

const deadline = timeoutFeature({ ms: 1500 })
const sameDefinition = timeout({ ms: 1500 })
```

Choose one spelling per installation, rather than installing two instances of the same definition. `typegenFeature({ out: { write(fileName, text) { console.log(fileName, text) } } })` reads accepted directories and method schemas; the application owns file I/O. Pass the actual authentication configuration to `authFeature(config)`; capability labels alone do not authorize calls.

## Deadlines, failures, and closure

Transport `connect: { timeoutMs }` bounds handshake preparation. Business-call `timeoutMs`, host `defaultTimeoutMs`, and timeout features are separate. A call override wins over host configuration, which wins over the feature default. `signal` supports cooperative cancellation. Expiry or disconnection does not prove that business code never executed; reconcile a non-idempotent result before retrying.

Error sources are functional domains: `rpc.endpoint` for calls and host admission, `rpc.remote` for managed remote calls, and `rpc.transport.*` for native carriers. Branch on `source` and `code`; retain native types, `cause`, and `errors` rather than matching messages. Missing/duplicate transports, unregistered definitions, duplicate feature/assembler definitions, and responsive same-name peers reject at their admission boundaries.

Transport and feature objects are genuine plugin-host definitions and also work with ordinary `PluginHost.use(...)`, retaining its existing installation, replacement, and cleanup owners. Transport authors use cold deployment and scope tools from `@migaia/rpc-host/plugin`. Applications start with `createRpcHost` and need no private files or lower-level factories.

See the [usage guide](./USEGUIDE.en.md) for calls, cancellation, and migration.
