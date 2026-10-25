# `@migaia/rpc-host`

`contract` defines protocol, interfaces, portable values, and errors. `host` owns RPC calls, sessions, handshake, providers, forwarding, and cancellation. Transport plugins own native connections, generations, codecs, framing, and transfer. Flow plugins and plugin-owned features implement their optional behavior.

A host can install multiple transports with calls isolated under `host.<ns>`. Mixing transport kinds in one host is not recommended; normally choose one kind per host.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

This creates two real hosts in one event loop. The parent installs its timeout feature on the coroutine plugin. The child receives the generation-local connect handle. It prints `42` and releases native resources in finally.

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { timeout } from '@migaia/rpc-host/features'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      features: [timeout({ ms: 1500 })],
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true })
            )
        } finally {
          await child.close()
        }
      }
    })
  ]
})
try {
  console.log(await host.coroutine.request('double', 21))
} finally {
  await host.close()
}
```

Coroutines do not provide Worker isolation. Choose the [process](../rpc-plugin-process/README.en.md), [thread](../rpc-plugin-thread/README.en.md), or [browser](../rpc-plugin-browser/README.en.md) transport for those native environments.

## Calls and ownership

| Entry                                                      | Completion                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `host.<ns>.request(method, payload?, options?)`            | Business result                                                                       |
| `host.<ns>.notify(method, payload?, options?)`             | Physical send, without business acknowledgement; `targetId` selects one direct target |
| `host.<ns>.stream(method, payload?, options?)`             | Lazy iterator; independent consumption for multiple targets                           |
| `host.<ns>.group(steps, options?)`                         | Ordered `{ method, payload }` steps per target, without a cross-target transaction    |
| `host.<ns>.send(targetId, method, payload?, options?)`     | Scalar result from one direct target                                                  |
| `host.<ns>.dispatch(targetId, method, payload?, options?)` | Synchronous `void`; asynchronous failures reach the reporter                          |
| `host.provide(definition)`                                 | Adds local methods; duplicate names reject                                            |
| `host.<ns>.peers`                                          | Accepted direct capabilities; held functions bind to the original generation          |
| `host.close()`                                             | Closes the host; repeated calls share the original Promise                            |

Untargeted calls select only within their namespace: zero targets return empty `fulfilled/rejected` maps, one returns a scalar, and multiple return maps indexed by instance identity. Stream iterators cancel independently. Root call methods such as `host.request` are removed.

`host.<ns>.send('b', 'c.render', value)` first reaches direct peer b, which reads its current directory and forwards to c. A held `host.<ns>.peers.c.render` does not retarget a later generation. Forwarding can cross namespaces and cannot extend an upstream deadline.

Configure each forwarding host with `forward: { maxHops: 3 }` in `createRpcHost`. The default is 3; integers 1–16 are supported and other values reject with `INVALID_CONFIG`. Each host checks its own forwarding ordinal; loops reject before the hop limit.

## Optional capabilities

Install flow plugins in the host's `plugins`; install features in their owning plugin's `features`.

```ts doc-test=check
import { timeout, retry } from '@migaia/rpc-host/features'
import { linkPolicy, limits, probe } from '@migaia/rpc-host/plugins'
import timeoutFromSubpath from '@migaia/rpc-host/features/timeout'

export const defaults = linkPolicy({ features: [timeout({ ms: 1500 }), retry({ attempts: 2 })] })
export const capacity = limits({ maxGlobal: 256, maxPerPeer: 64 })
export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const perCallDeadline = timeoutFromSubpath({ ms: 100 })
```

Aggregate and default subpath imports support tree-shaking. Other flow plugins are `auth`, `chunk`, `batch`, `idempotency`, `schema`, and `typegen`. Installing `limits` is recommended; omitting it enables no such quotas. `host.<ns>.outcome(key)` exists only with `idempotency` installed. `auth` independently owns request-ID replay retention; `maxReplayEntriesPerPeer` bounds retained identities per admitted peer, and `onRejected` receives replay-capacity refusal reasons.

[Pool](../rpc-plugin-pool/README.en.md) is the transport's `pool({ size })` feature. Members use one carrier kind and expose one logical peer. Pool owns member acquisition, scheduling, and closure; the transport contributes native `host.<ns>.members` controls.

## Deadlines, cancellation, and errors

`FeatureScope` alone selects call `options.timeout/retry`, then the transport's installed feature, then the link-policy default. Call values accept only complete feature instances or `false`, never numbers or configuration objects. `timeout: false` waits for the response without a feature timeout; an upstream remaining deadline still decreases. `retry: false` disables retry. Only the origin retries scalar calls and groups; streams never replay and use timeout only; forwarding does not restart the budget.

Every call kind supports `signal`, including cancellation propagated after a one-way physical send. Providers receive their own `context.signal`. Cancellation neither kills a process nor rolls back side effects.

Branch on `source/code`; preserve native classes, `stack`, `cause`, and `AggregateError.errors`. Timeout or disconnection does not prove that business work never executed. Reconcile uncertain non-idempotent work before retrying.

Plugin authors start at `@migaia/rpc-host/sdk`; observation lives under `/plugins/probe`. Old `/plugin`, `/probe`, endpoint, per-session Peer, and v1/JSON-RPC profile entries are removed. RPC packages can depend directly on `@migaia/rpc-contract`. Import only `/error-code` when only codes are needed, without retaining protocol or codec execution code.

## C6 public behavior changes

Unhandled provider exceptions use `INTERNAL` and retain the native exception in the error graph. Scalar calls reject with the restored remote Error directly, without an extra `RpcRemoteError`; callers must inspect the actual error's `source/code`. A coroutine provider receives the original abort reason through `context.signal.reason`, without an invented cancellation code. `stream.return(value)` returns the runtime's actual terminal result rather than echoing the caller's `value`.

Untargeted calls select the sessions accepted at call time. Functions saved from `peers` remain bound to their original generation and reject after departure rather than switching to a replacement. Immediate process startup failure has one `PROCESS_CHANNEL_CLOSED` boundary with native EPIPE reachable through its cause graph. A thread closure with no native error does not invent a message-port cause.

The old RPC scope rollback AggregateError shell and native host dispose translation have retired. Native host dispose returns its actual outcome; cleanup leaf identity, order, once-only release, and the shared completion Promise remain intact. `RpcRoot.close` has its own error contract and does not substitute for native dispose.

Idempotency fingerprints follow the object's own key order. Changing key order creates a different request; reuse of the same key conflicts with `CONTRACT_INVALID`. The store's string fingerprint ABI is unchanged.

An ordinary NativeHost retains its native dispose() cleanup summary and shared Promise instead of RPC disposal translation. Installation rollback borrows native cleanup entries without the former RPC resource-scope AggregateError shell. Original failure leaves, errors order, cause reachability and once-only disposal remain intact. RpcRoot.close() is a separate public close owner; NativeHost.dispose() is not a substitute. Native Feature descriptors are captured once per cold compilation while preserving the first selector validation and error order; later selectors do not repeat Proxy reflection.

auth() releases a completed request ID immediately only when the actual native owner proves exclusive source custody; other sources retain the bounded completed TTL. Active requests and streams remain held through actual business and iterator cleanup.

With sign/verify configured, auth exchanges and validates a fresh source challenge inside the existing signed handshake. Application callbacks must still sign and verify the complete input they receive. No public discovery or handshake option is added.

verifyCredentials may return { principalId: nonemptyString } to lend the authenticated principal to the current Session. Throwing or rejection still refuses authentication. Void, string, and other formerly ignored results do not grant a principal.
