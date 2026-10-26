# rpc-host usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

Contract defines protocol, interfaces, portable values, and errors. Host owns RPC sessions, handshake, calls, providers, forwarding, cancellation, and deadline propagation. Transport plugins own native connections, generations, and codecs. Flow plugins and plugin-owned features implement optional capabilities.

A host supports multiple transport namespaces, but normally choose one transport kind; mixing kinds is not recommended. Calls live under `host.<ns>.*`; provider registration and whole-host closure remain on the root. See the [README](./README.en.md#start-here) for a complete runnable coroutine connection.

`createRpcHost` first commits flow plugins, link-policy plugins and their features on the same native host, then installs transports and their features. Stages such as auth are visible before the first handshake. Both installations share one lifecycle owner, which also rolls back and cleans up the committed prefix if transport installation fails.

## Register functions and generators

`provide` accepts nested function objects. Return values become business results and exceptions retain their error chain. Duplicate method names reject. Later registrations publish through the existing session directory update.

If reflection or compilation of provider registration throws, the public entry rejects with `INVALID_CONFIG` and retains that exact original exception on `cause`. Stable diagnostic text does not invoke the thrown value's string conversion or manufacture another conversion failure.

```ts doc-test=check
import type { IRpcHost, IRpcContext } from '@migaia/rpc-host'

export function exposeWork(host: IRpcHost) {
  host.provide({
    double: (value: number) => value * 2,
    values: async function* (end: number) {
      for (let value = 0; value < end; value++) yield value
    },
    wait: (_value: unknown, context: IRpcContext) => {
      if (context.signal.aborted) throw context.signal.reason
      return new Promise<void>((_resolve, reject) =>
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true
        })
      )
    }
  })
}
```

Callers cancel with `options.signal`; providers receive their own `context.signal`. The example deliberately waits for cancellation. Real tasks release their own resources in finally. Cancellation neither rolls back side effects nor automatically terminates a process. A one-way call can still propagate cancellation after physical sending completes.

## Select targets and consume streams

A declaration can describe one capability or map direct names to several capabilities. The namespace selects a transport; names and instance IDs select targets within it.

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkers = {
  worker: {
    double(value: number): number
    values(end: number): AsyncIterable<number>
  }
}

export async function useWorker(host: IRpcHost<IWorkers>) {
  const answer: number = await host.thread.send('worker', 'double', 21)
  const values: number[] = []
  for await (const value of host.thread.streamTo('worker', 'values', 3)) values.push(value)
  return { answer, values }
}
```

Untargeted `request/notify/group` broadcasts within that namespace: zero targets return empty `fulfilled/rejected` maps, one returns a scalar, and multiple retain independent successes and failures. Multi-target `stream` returns iterators indexed by instance identity, each with independent backpressure and cancellation.

`streamTo(targetId, method, payload?, options?)` selects one direct target and always returns one lazy iterator. The target is the first argument, as with `send`. Replace `stream(method, payload, { targetId })` with this form; options retain only the existing call policies, signal, transfer, and other call settings.

A stream starts at the first `next()`. `return()` ends consumption and waits for corresponding cleanup. `throw(reason)` preserves the caller's thrown reason. Held capabilities remain bound to their original connection after it retires; they cannot target a same-name successor.

## Install complete policies

This example creates cold definitions only. Pass `policy` and `transport` to `createRpcHost({ plugins: [...] })`, and install the corresponding child source in the worker entry.

```ts doc-test=check
import { timeout, retry } from '@migaia/rpc-host/features'
import { linkPolicy } from '@migaia/rpc-host/plugins'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

export const policy = linkPolicy({ features: [timeout({ ms: 3000 }), retry({ attempts: 2 })] })
export const transport = threadPlugin({
  spawn: new URL('./worker.ts', import.meta.url),
  features: [timeout({ ms: 1500 })]
})

export const callOptions = { timeout: timeout({ ms: 100 }), retry: false } as const
```

Selection has one order: complete per-call instance or `false`, then the transport plugin's feature, then the link-policy default. Pass `callOptions` to `host.thread.request(method, payload, callOptions)` to override one call. Numeric `{ timeout: 100 }`, `timeoutMs`, and `defaultTimeoutMs` are removed.

`timeout: false` waits for the response without a feature timeout; an upstream remaining deadline still decreases. `retry: false` disables retry. Downstream hops receive only the remaining budget and cannot extend it. Only the origin retries scalar calls and groups; streams never replay and use timeout only. Timeout or disconnection does not prove that business work never executed; reconcile uncertain non-idempotent work first. Transport handshake preparation deadlines are separate from the business timeout feature.

A call whose remaining deadline has expired before provider entry rejects with `DEADLINE_EXCEEDED` without executing the provider. `before-start` cancellation keeps its existing semantics.

## Install RPC in an existing host

An existing `defineHost` owner uses `rpcHostPipelines(getHost, pipeline)` to obtain both pipeline declarations and `domainCore`. Creating the helper calls neither callback and creates no host or resource. At installation, `domainCore` reads the real owner and borrows its pipeline execution authority. Do not copy seven declarations or supply another host's execution authority.

```ts doc-test=check
import { defineHost } from '@migaia/plugin-host'
import {
  rpcHostPipelines,
  type IRpcFlowPlugin,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'

/** Capture lazy authority callbacks before the real host is assigned. */
const rpc = rpcHostPipelines(
  () => host,
  (name) => host.pipeline(name)
)
/** One native owner supplies both stage registration and execution. */
export const host = defineHost({
  ...rpc,
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})

/** Commit reusable flow definitions before opening any transport resource. */
export async function installRpc(
  flows: readonly IRpcFlowPlugin[],
  transports: readonly IRpcTransportPlugin[]
) {
  await host.use(...flows)
  await host.use(...transports)
}
```

A class owner also reads `this` lazily through the helper. Pass its declarations to `super`, then supply the same setup from `createPluginDomainCore` without exposing protected `pipeline`. Install plugins in the same order after construction finishes.

```ts doc-test=check
import { PluginHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'

/** Keep the helper's declaration and domain-core axes together. */
type IRpcSetup = ReturnType<typeof rpcHostPipelines>
/** Native installation receives only this owner's declared RPC core. */
type IRpcCore = ReturnType<IRpcSetup['domainCore']>

export class NativeRpcHost extends PluginHost<
  IRpcCore,
  unknown,
  readonly [],
  IRpcSetup['pipelines']
> {
  /** The setup lends this exact owner's protected pipeline without another executor. */
  readonly #rpc: IRpcSetup

  /** Register lazy callbacks before super without reading an unconstructed this. */
  constructor() {
    /** The same setup supplies declarations now and authority only after construction. */
    const rpc = rpcHostPipelines(
      () => this,
      (name) => this.pipeline(name)
    )
    super({
      pipelines: rpc.pipelines,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    this.#rpc = rpc
  }

  /** Each install borrows this exact constructed owner's pipeline execution authority. */
  protected override createPluginDomainCore(): IRpcCore {
    return this.#rpc.domainCore()
  }
}
```

## Author flows and carriers

Each `defineFlowPlugin` setup returns installation-local `stages`, a separate `observe` callback and optional `dispose`. Stages use SDK `RpcFlowPoint` keys with inferred payload types and forward through native `next(payload)`. Handshake, envelope and frame replacements belong in `handshake`, `prepared` and `frame`. Dispatch reads the same `payload.outcome.value` after forwarding, and writes that cell when short-circuiting.

Frame pipelines accept multiple submissions. The stage receives each `await next(payload)` failure and may catch, report and continue with another member. If it does not observe a failed Promise, the pipeline rejects after all started traversals settle; multiple unobserved failures are collected in submission order. Observation callbacks do not execute or advance stages.

A cancelled `batch` member submits no further downstream work. Its call settles with `CANCELLED` and the original reason on `cause`; other members complete normally. An inbound member failure reports only that member and does not prevent later members from being processed.

A carrier may implement `reserveWrite(options)` by borrowing its existing flow-control owner and returning a receipt with `release()`. Session reserves once per logical write after encoding and releases when that frame pipeline actually settles. Chunk fragments share the same receipt; a batch retains each member's receipt and borrows a surviving member's receipt for its coalesced physical write. `write` still completes at actual physical acceptance, without counting fragments or batches as new logical calls. Receipts never enter wire data.

## Notifications, groups, and retained outcomes

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IApi = { update(value: number): number }
export async function sendUpdates(host: IRpcHost<IApi>) {
  await host.thread.notify('update', 1, { targetId: 'worker' })
  return host.thread.group([
    { method: 'update', payload: 2 },
    { method: 'update', payload: 3 }
  ])
}
```

A `notify` Promise means physical sending completed, without business acknowledgement. `dispatch(target, method, payload, options)` returns `void` synchronously and reports failures. Each target executes its own ordered group; there is no cross-target transaction.

Install the `idempotency()` flow plugin to add `host.<ns>.outcome(key)` for retained results. Omitting it enables no store for retaining and querying results by idempotency key. `auth()` separately owns request-ID deduplication: active identities remain held through actual business and stream cleanup, then completed identities are released immediately only for a source the actual native owner proves exclusive; other sources follow the bounded TTL policy. A duplicate executes no provider and sends no additional terminal. `auth.maxReplayEntriesPerPeer` defaults to `1024` and must be a positive safe integer; full capacity refuses with `OVERLOADED`, while `auth.onRejected` receives a frozen `replayLedgerFull` or `groupReplayFull` notice. Callback failure is reported with the existing `INTERNAL` error and original cause. Installing `limits()` is recommended; omitting it enables no corresponding concurrency, rate, or payload quotas.

## Forward and hold capabilities

`host.process.send('b', 'c.render', value)` reaches b first. b reads its current directory and forwards through its own c session, including across carriers. A host can also publish an explicit held capability:

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type INext = { c: { render(value: string): string } }
export function publishHeldRender(host: IRpcHost<INext>) {
  host.provide({ render: host.thread.peers.c.render })
}
```

Held functions do not follow replacements. Retired targets reject; missing methods, loops, and excessive hops reject at their admission boundaries. Forwarding creates no second endpoint or per-session Peer facade.

Set `createRpcHost({ forward: { maxHops: 3 }, plugins: [...] })` on each forwarding host. Omission defaults to 3; only integers 1–16 are admitted. Each host compares the incoming forwarding ordinal with its own ceiling. Loop refusal takes priority over `FORWARD_HOP_LIMIT`.

The probe stage `forward` emits `received`, `sent` at physical handoff, or `rejected` with `loop`, `hop-limit`, `target-unknown`, or `method-unavailable`. `hop` is 1 at the first forwarding host; `maxHops` is that host’s ceiling. `route` is borrowed until the callback returns: copy it before retaining an event. The final target’s inbound message event carries the traversed `hop` and `route`. Without probe or Devtools, Forwarder skips event construction.

## Observe and generate types

Install the `probe` flow plugin on the same host. Type generation consumes accepted directories. Event views are valid only during `emit`; copy required fields before retaining them.

```ts doc-test=check
import { probe, typegen } from '@migaia/rpc-host/plugins'

export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const declarations = typegen({
  out: { write: (fileName, text) => console.log(fileName, text) }
})
```

Include both definitions alongside the transport in `plugins`. The application owns `typegen.out.write`, including any file I/O; failures reach the reporter. Host closure or plugin removal releases the corresponding subscriptions.

## Migrate entries

| Retired usage                                         | Replacement                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Root `host.request/send/notify/stream/dispatch/group` | The corresponding `host.<ns>` call                                      |
| `@migaia/rpc-host/plugin`                             | `@migaia/rpc-host/sdk`                                                  |
| `/probe` plus `defineFeaturePlugin`                   | `probe` / `defineProbe` from `/plugins/probe`                           |
| `authFeature/chunkFeature/typegenFeature`             | `auth/chunk/typegen` from `/plugins`                                    |
| Root `defaultTimeoutMs` or numeric call timeout       | Plugin `features` and complete timeout instances                        |
| `poolPlugin` or pool assembler                        | Transport `features: [pool({ size })]`                                  |
| Endpoint, RuntimePeer, v1, JSON-RPC profile           | One Host call owner and one new protocol, without compatibility entries |
| Root `outcome` or idempotency store                   | Install `/plugins/idempotency`; query its namespace extension           |

Aggregate and individual default subpaths support tree-shaking. Import codes from `@migaia/rpc-contract/error-code` and error classes/contracts from `/errors`. Transport authors supply native carriers and codecs; Host owns handshake, Sessions, pending calls, and provider execution.

## Close and retain errors

`host.close()` and `host[Symbol.asyncDispose]()` share the original close Promise. `host.<ns>.close()` closes only that namespace. Original owners release owned native resources, while borrowed resources retain their native ownership policy.

Public close settles pending calls with `ENDPOINT_DISPOSED` and closes the actual carrier. Carrier `close` settles its own queued writes, so a held native write also rejects; it does not force an arbitrary business Promise to finish. An existing `defineHost` or class owner's `dispose()` retains its native cleanup summary and shared Promise without another RPC cleanup shell.

Branch on `source/code`; preserve native classes, stack, cause, and errors. Timeout, cancellation, or an unknown result is not proof that work never executed. Native controls live under transport-owned `host.<ns>.members`; Pool controls live under feature-owned `host.<ns>.pool`. These controls do not replace RPC calls.

## Public behavior and migration

Unhandled provider exceptions use `INTERNAL` and retain the native exception in the error graph. Scalar calls reject with the restored remote Error directly, without an extra `RpcRemoteError`; callers must inspect the actual error's `source/code`. A coroutine provider receives the original abort reason through `context.signal.reason`, without an invented cancellation code. `stream.return(value)` returns the runtime's actual terminal result rather than echoing the caller's `value`.

Untargeted calls select the sessions accepted at call time. Functions saved from `peers` remain bound to their original generation and reject after departure rather than switching to a replacement. Immediate process startup failure has one `PROCESS_CHANNEL_CLOSED` boundary with native EPIPE reachable through its cause graph. A thread closure with no native error does not invent a message-port cause.

An independently constructed native host retains its native `dispose()` cleanup summary and shared Promise without an additional RPC cleanup shell. Original failure leaves, errors order, cause reachability and once-only disposal remain intact. The `host.close()` returned by `createRpcHost` retains its own public close semantics.

Idempotency fingerprints follow the object's own key order. Changing key order creates a different request; reuse of the same key conflicts with `CONTRACT_INVALID`. The store's string fingerprint ABI is unchanged.

Native Feature descriptors are captured once per cold compilation while preserving the first selector validation and error order; later selectors do not repeat Proxy reflection.

auth() releases a completed request ID immediately only when the actual native owner proves exclusive source custody; other sources retain the bounded completed TTL. Active requests and streams remain held through actual business and iterator cleanup.

With sign/verify configured, auth exchanges and validates a fresh source challenge inside the existing signed handshake. Application callbacks must still sign and verify the complete input they receive. No public discovery or handshake option is added.

verifyCredentials may return { principalId: nonemptyString } to lend the authenticated principal to the current Session. Throwing or rejection still refuses authentication. Void, string, and other formerly ignored results do not grant a principal.
