# rpc-host usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

## Installation

Install `@migaia/rpc-host`, `@migaia/rpc-contract`, and the required transport plugin at the same version. The contract is an exact lockstep peer dependency shared from the application installation. Explicitly introduced duplicate copies are unsupported.

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

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

Callers cancel with `options.signal`; providers receive their own `context.signal`. The example deliberately waits for cancellation. Real tasks release their own resources in finally. Cancellation neither rolls back side effects nor automatically terminates a process. Use `request` for remote actions that need cancellation and completion acknowledgement.

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

## Install and remove transports after construction

The complete definition batch passed to `createRpcHost({ plugins })` either succeeds or rolls back together. After construction, each `host.use(...)` starts a separate native installation transaction. Failure rolls back only that batch's new resources; committed namespaces keep working. The returned value is the same public host. Assign it to a new variable to obtain the added namespaces in its static type.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { limits } from '@migaia/rpc-host/plugins'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

const host = await createRpcHost({ plugins: [limits({ maxGlobal: 256 })] })
try {
  const extended = await host.use(threadPlugin({ spawn: new URL('./worker.ts', import.meta.url) }))
  await extended.thread.notify('refresh')
  await extended.thread.close()
  await extended.unUse('thread')
} finally {
  await host.close()
}
```

A transport plugin's name is its namespace. Duplicate and reserved names reject before installation. Host Features that change message flow, such as auth and limits, must be configured in the construction `createRpcHost({ plugins })`; they are prepared once, and adding them later rejects with `INVALID_CONFIG`. Later transports borrow the same installations and shared quotas. Their own `features` install with the transport and override that capability only in its namespace. Readonly observer plugins, including warning subscriptions, may be installed later. `use` returns the same frozen native host; the added namespace appears only in the return type captured by `const extended = await host.use(...)`.

`unUse(name)` retains the native removal result `{ ok, affected, errors? }`. Without an active flow restriction, removal closes the transport's Sessions through the normal close path before deleting its pipeline group. Removing a selected host Feature or a transport that owns a local Feature while affected Sessions remain open rejects with `plugin.host / LIFECYCLE_MUTATION`. Shared Features are removed with their native wrapper registration; local Features are removed with their transport. Close affected namespace Sessions before cold removal, as the example does with `thread.close()`. Transports with no selected flow Feature and readonly observer plugins are exempt from this restriction. Capabilities can also be omitted after Host closure or reconstruction, without preserving their former guarantees.

Capabilities such as auth, chunk, and batch negotiate through the handshake and change the wire representation. Establishment is guaranteed only when both peers install them. One-sided installation provides no compatibility guarantee and is not proactively prohibited; applications must supply matching plugins or features when needed.

## Install RPC in an existing host

An existing `defineHost` owner obtains `domainCore` from `rpcHostPipelines(getHost, pipeline)`. Creating the helper calls neither callback and creates no host or resource. Installation reads the real owner and passes the current native construction request back to that owner's `pipeline(name, request)`. Each transport declares its own seven short pipeline names, created on installation and deleted on removal. There is no advance namespace list or `rpc.pipelines` output. Do not copy declarations or borrow another host's execution authority.

```ts doc-test=check
import { defineHost } from '@migaia/plugin-host'
import {
  rpcHostPipelines,
  rpcFlowPlugin,
  type IRpcFlowFeature,
  type IRpcFlowPlugin,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'

/** Capture lazy authority callbacks before the real host is assigned. */
const rpc = rpcHostPipelines(
  () => host,
  (name, request) => host.pipeline(name, request)
)
/** One native owner supplies both stage registration and execution. */
export const host = defineHost({
  domainCore: rpc.domainCore,
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})

/** Commit reusable flow definitions before opening any transport resource. */
export async function installRpc(
  features: readonly IRpcFlowFeature<object>[],
  observers: readonly IRpcFlowPlugin[],
  transports: readonly IRpcTransportPlugin[]
) {
  await host.use(...observers, rpcFlowPlugin(features))
  await host.use(...transports)
}
```

`rpcFlowPlugin(features)` wraps shared flow Features for an ordinary native host. The native registration owns their actual setup and cleanup; Features such as `auth()` cannot be passed directly to native `host.use` as plugins. Commit this wrapper and readonly observers before transports so the first handshake already has its complete policy.

A class owner also reads `this` lazily through the helper. `createPluginDomainCore` must forward the current construction request without exposing protected `pipeline`. Install plugins in the same order after construction finishes.

```ts doc-test=check
import { PluginHost, type IHostCoreConstructionRequest } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'

/** Retain the helper's domain-core construction port. */
type IRpcSetup = ReturnType<typeof rpcHostPipelines>
/** Native installation receives only this owner's declared RPC core. */
type IRpcCore = ReturnType<IRpcSetup['domainCore']>

export class NativeRpcHost extends PluginHost<IRpcCore, unknown, readonly []> {
  /** The setup lends this exact owner's protected pipeline without another executor. */
  readonly #rpc: IRpcSetup

  /** Register lazy callbacks before super without reading an unconstructed this. */
  constructor() {
    /** The callbacks are invoked only after construction by the actual native installation. */
    const rpc = rpcHostPipelines(
      () => this,
      (name, request) => this.pipeline(name, request)
    )
    super({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    this.#rpc = rpc
  }

  /** Each install borrows this exact constructed owner's pipeline execution authority. */
  protected override createPluginDomainCore(request: IHostCoreConstructionRequest): IRpcCore {
    return this.#rpc.domainCore(request)
  }
}
```

## Author flows and carriers

Each `defineFlowFeature` setup returns installation-local `stages`; install the feature through host `plugins` or one transport's `features`. The setup also returns a separate `observe` callback and optional `dispose`. Stages use SDK `RpcFlowPoint` keys with inferred payload types and forward through native `next(payload)`. Handshake, envelope and frame replacements belong in `handshake`, `prepared` and `frame`. Dispatch reads the same `payload.outcome.value` after forwarding, and writes that cell when short-circuiting.

Frame pipelines accept multiple submissions. The stage receives each `await next(payload)` failure and may catch, report and continue with another member. If it does not observe a failed Promise, the pipeline rejects after all started traversals settle; multiple unobserved failures are collected in submission order. Observation callbacks do not execute or advance stages.

A cancelled `batch` member submits no further downstream work. Its call settles with `CANCELLED` and the original reason on `cause`; other members complete normally. An inbound member failure reports only that member and does not prevent later members from being processed.

Builtin positions are fixed: outbound plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire; inbound reverses the direction. Array order does not change these positions. Third-party stages default to plaintext; SDK authors may select the supported `layer` explicitly.

`auth` protects each complete message before `chunk` splits it into physical frames. The receiver reassembles the message before restoring protection. Probe `protected` events describe the complete message; `frame` events retain actual `chunkIndex`, `chunkCount` and `members`. Physical batch membership is observed on its batch frame, while each logical message has one `envelope` observation.

A carrier may implement `reserveWrite(options)` by borrowing its existing flow-control owner and returning a receipt with `release()`. Session reserves once per logical write after encoding and releases when that frame pipeline actually settles. Chunk fragments share the same receipt; a batch retains each member's receipt and borrows a surviving member's receipt for its coalesced physical write. `write` still completes at actual physical acceptance, without counting fragments or batches as new logical calls. Receipts never enter wire data.

The same `auth`, `chunk`, `batch`, `idempotency`, `limits`, `errorMap`, and `schema` factories support host `plugins` and transport `features`; transport placement overrides only its namespace. Host `limits` shares quotas; transport `limits` owns separate quotas. `probe`, `typegen`, and Devtools are host-only. Remove the former `namespaces` scope option and place the feature on its transport.

## Authentication, signing, and duplicate requests

With the default `encodedType: 'any'` and no `encrypt`, `sign` receives the signing binding object, including nonce, counter, and an object payload. `verify` receives the same restored structure from its peer. Callbacks must sign and verify their complete input; the framework does not first convert it to text. Applications choose the representation for byte-oriented algorithms such as HMAC, and both peers must use the same choice.

```ts doc-test=check
import { createHmac } from 'node:crypto'
import { auth } from '@migaia/rpc-host/plugins'

/** Both peers use the same application-owned key and binding representation. */
function mac(value: unknown, key: string): string {
  return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
}

/** The application supplies its key; callbacks cover the entire replay binding. */
export function signedAuthentication(key: string) {
  return auth({
    sign: (value) => ({ value, mac: mac(value, key) }),
    verify: (envelope) => {
      const signed = envelope as { value: unknown; mac: string }
      if (signed.mac !== mac(signed.value, key)) throw new Error('signature mismatch')
      return signed.value
    }
  })
}
```

Explicit `'string'`, `'uint8array'`, or `encrypt` uses prefixed text or its UTF-8 bytes instead. The entire binding is encoded once, with its payload still an object; inbound processing parses that text layer once. Encryption still precedes signing, and inbound verification precedes decryption. The supported native object path is unchanged. Callbacks that assumed text by default must normalize it themselves with `JSON.stringify` or select `encodedType: 'string'`. Nonces, the signed counter window, and their replay checks are unchanged.

Auth always deduplicates an in-flight request ID until actual business and stream cleanup completes. `retain` controls release after completion:

| `retain`                              | Release after completion                                         | Boundary                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `false` (default)                     | Immediately                                                      | Holds only in-flight identities, without accumulating completed requests                               |
| `'window'`                            | When the original signed counter falls outside the 64-bit window | Requires signing or rejects with `INVALID_CONFIG`; window advancement does not release active requests |
| Positive safe integer in milliseconds | After the configured duration                                    | Invalid numbers reject with `INVALID_CONFIG`; numeric mode has capacity limits                         |

Set a default with `auth({ retain })` or override it in a transport connection's `connect: { retain }`. Only an omitted connection value falls back, so connection-level `false` also overrides the host setting. Set `retain: 310_000` explicitly for the former 310-second behavior.

`maxReplayEntriesPerPeer` defaults to `1024`, must be a positive safe integer, and bounds active and retained identities only in numeric mode. Full capacity rejects with `OVERLOADED`; `false` and `'window'` are not subject to that numeric capacity limit. `onRejected` receives frozen `replayLedgerFull` or `groupReplayFull` notices, and callback failures still report their original errors and causes. Duplicates are silently dropped without another execution or terminal response. Install `idempotency()` to replay a completed result to a retrying caller.

## Map errors sent to the peer

When a verifier or credential resolver throws or rejects, auth retains the original error on the local error's `cause`. Use `errorMap(map)` to control what a peer learns, such as replacing credential details with a public message. Local thrown errors, `report`, warnings, and readonly observation plugins still receive the original errors, regardless of installation order. Install it in host `plugins` or transport `features`; transport placement overrides host placement.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { errorMap, type IRpcErrorMap } from '@migaia/rpc-host/plugins'

/** Decide what remote callers may learn while preserving local diagnostic causes. */
const redact: IRpcErrorMap = (error) =>
  new Error(
    error instanceof Error && /credential/i.test(error.message)
      ? 'request rejected'
      : 'request failed'
  )

export const host = await createRpcHost({ plugins: [errorMap(redact)] })
```

`map(error, context)` must synchronously return an `Error`, portable value, or `undefined`. That result becomes the error sent to the peer; the original cause chain is not appended automatically. If the callback throws or its result cannot be serialized, the mapping failure is reported and the original error is sent under the rules used without a mapper. Returning a Promise/thenable reports `INVALID_CONFIG` and immediately uses those original rules without waiting, so it cannot block later messages in the same Session. A late Promise rejection is still reported separately.

Without `errorMap`, handshake refusals hide details from unauthenticated peers by default; other errors preserve the complete cause chain. Crossing a process or thread reconstructs objects and does not preserve `===` with the sender's original error. Configure mapping to hide information from peers while keeping local logs and causes available for diagnosis.

When a connection or Auth installation closes during verification, inbound processing ends as cancellation instead of reporting an authentication failure. The original cancellation reason is retained, and genuine verification failures are still reported. Callers executing Auth SDK stages directly receive the existing `UtilsAbortError` with its original `cause` after installation closure, rather than `AUTHENTICATION_FAILED`.

## Binary integrity and transfer

When the carrier supports native binary, an ArrayBuffer explicitly listed in `transfer` always transfers natively and the original buffer detaches on actual handoff; signing also calculates and verifies SHA-256. Only buffers without an explicit transfer follow the size rule when signed: at most 1125 bytes are copied into signed content, leaving the original usable and requiring no digest; larger buffers travel as native binary with digest verification. Without signing, binary digests are not calculated. The 1125-byte threshold is an internal SDK choice, not a public option.

Size and digest apply to the entire ArrayBuffer. A small visible Uint8Array slice does not shrink its underlying buffer. Views sharing a buffer still share one buffer at the receiver and retain their offsets and lengths.

`transfer` hands over ownership, uses only buffers explicitly authorized by the caller, and requires a carrier that supports that handoff; unsupported transfers still reject under the existing capability rules. Ordinary callers need not handle a binary manifest. Carrier authors can find the wire format in the [contract guide](../rpc-contract/USEGUIDE.en.md#carriers-binary-and-stage-order).

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

A `notify` Promise means physical sending completed, without business acknowledgement. An ordinary `notify` with no `cancel: 'before-start'`, no `orderKey`, and no forwarding removes its caller-signal listener after sending; later aborts send no remote cancellation. `dispatch(target, method, payload, options)` returns `void` synchronously and reports failures. Each target executes its own ordered group; there is no cross-target transaction.

Install the `idempotency()` flow Feature to add `host.<ns>.outcome(key)` for retained results. Omitting it enables no store for retaining and querying results by idempotency key. Auth request-ID deduplication is independent; see the [authentication section](#authentication-signing-and-duplicate-requests) for its three retention modes. Installing `limits()` is recommended; omitting it enables no corresponding concurrency, rate, or payload quotas.

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

## Warnings and child names

A warning is a frozen `{ code, message, data }` record. It is not an error, does not enter `report`, and does not stop construction or calls. Each record goes first to `createRpcHost({ onWarning })`, then to host-level SDK plugins whose setup returns `onWarning`, in registration order. Every recipient receives the same record. With no recipient, `console.warn` runs once. A recipient's throw or asynchronous rejection reports the original failure while later recipients still receive the warning.

```ts doc-test=check
import { createRpcHost, type IRpcWarning } from '@migaia/rpc-host'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'

/** Subscribe through the native host registration lifetime. */
const warnings = defineFlowPlugin({
  name: 'application-warnings',
  setup: () => ({
    onWarning: (warning: IRpcWarning) => console.log(warning.code, warning.data)
  })
})

export const host = await createRpcHost({
  onWarning: (warning) => console.log(warning.message),
  plugins: [warnings]
})
```

Readonly warning subscriptions may be installed later; native removal or rollback removes them. Only a host-level `defineFlowPlugin` can subscribe. Placing it in transport `features`, or returning `onWarning` from `defineFlowFeature`, rejects with `INVALID_CONFIG`.

A launched child with actual native parent facts (process, thread, coroutine, dedicated worker, or pool member) prefers the parent-supplied name and instanceId. Without a parent name, an explicit child `self.name` remains; without either name, the default follows the parent's instanceId. Address the name returned in the child's handshake. Overriding an explicit child name or instanceId does not fail construction; it emits one `RpcWarningCode.selfIgnored` (`SELF_IGNORED`) warning. `warning.data` includes only the overridden items: `parentName`/`ignoredName` for a name conflict and `parentInstanceId`/`ignoredInstanceId` for an identity conflict. An instanceId-only conflict also warns. Conflicting sets of parent startup facts still reject with `INVALID_CONFIG`.

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

`remote.host.use`, `remote.host.unUse` and `remote.host.inspect` are removed. RPC no longer provides a protocol for managing a remote host's plugins; local native host installation and disposal keep their own contracts.

Aggregate and individual default subpaths support tree-shaking. Import codes from `@migaia/rpc-contract/error-code` and error classes/contracts from `/errors`. Transport authors supply native carriers and codecs; Host owns handshake, Sessions, pending calls, and provider execution.

## Close and retain errors

`host.close()` and `host[Symbol.asyncDispose]()` share the original close Promise. `host.<ns>.close()` closes only that namespace. Original owners release owned native resources, while borrowed resources retain their native ownership policy.

Public close settles pending calls with `ENDPOINT_DISPOSED` and closes the actual carrier. Carrier `close` settles its own queued writes, so a held native write also rejects; it does not force an arbitrary business Promise to finish. An existing `defineHost` or class owner's `dispose()` retains its native cleanup summary and shared Promise without another RPC cleanup shell.

Branch on `source/code`; preserve native classes, stack, cause, and errors. Timeout, cancellation, or an unknown result is not proof that work never executed. Native controls live under transport-owned `host.<ns>.members`; Pool controls live under feature-owned `host.<ns>.pool`. These controls do not replace RPC calls.

Promise-returning calls such as `send` and `request` reject invalid `idempotencyKey` values, rejected transfer admission, or a closed namespace, preserving each entry's existing `source/code` and `cause`; invalid keys still use `CONTRACT_INVALID`. Handle failures with `await` or `Promise.catch`. `dispatch` still returns `void` and reports failures, while `stream` and `streamTo` still return lazy async iterators.

## Public behavior and migration

Unhandled provider exceptions use `INTERNAL` and retain the native exception in the error graph. Scalar calls reject with the restored remote Error directly, without an extra `RpcRemoteError`; callers must inspect the actual error's `source/code`. A coroutine provider receives the original abort reason through `context.signal.reason`, without an invented cancellation code. `stream.return(value)` returns the runtime's actual terminal result rather than echoing the caller's `value`.

Untargeted calls select the sessions accepted at call time. Functions saved from `peers` remain bound to their original generation and reject after departure rather than switching to a replacement. Immediate process startup failure has one `PROCESS_CHANNEL_CLOSED` boundary with native EPIPE reachable through its cause graph. A thread closure with no native error does not invent a message-port cause.

An independently constructed native host retains its native `dispose()` cleanup summary and shared Promise without an additional RPC cleanup shell. Original failure leaves, errors order, cause reachability and once-only disposal remain intact. The `host.close()` returned by `createRpcHost` retains its own public close semantics.

Idempotency fingerprints follow the object's own key order. Changing key order creates a different request; reuse of the same key conflicts with `CONTRACT_INVALID`. The store's string fingerprint ABI is unchanged.

Native Feature descriptors are captured once per cold compilation while preserving the first selector validation and error order; later selectors do not repeat Proxy reflection.

Auth passes an object to sign/verify by default. Normalize it explicitly or select `encodedType: 'string'` for callbacks requiring text. Completed request IDs release immediately by default; set `retain: 310_000` for the former duration. Local verifier/resolver errors retain their original causes; use synchronous `errorMap` for remote redaction.

With sign/verify configured, auth exchanges and validates a fresh source challenge inside the existing signed handshake. Application callbacks must still sign and verify the complete input they receive. No public discovery or handshake option is added.

verifyCredentials may return { principalId: nonemptyString } to lend the authenticated principal to the current Session. Throwing or rejection still refuses authentication. Void, string, and other formerly ignored results do not grant a principal.

The six former `/features/{auth,batch,chunk,idempotency,limits,schema}` entries are removed; import their factories from `/plugins/*` or `/plugins`. `rpcHostPipelines` removes its third argument and `pipelines` output; pass the construction request to `domainCore(request)`. Transports declare their own pipelines. The following unused error codes are removed without replacement: `HOST_ASSEMBLER_DUPLICATE`, `HOST_FEATURE_DUPLICATE`, `PROVIDER_GENERATION_RETIRED`, `MIDDLEWARE_DUPLICATED`, `MIDDLEWARE_MISSING`, `PROVIDER_NOT_SETTLED`, `TARGET_NOT_IDENTIFIABLE`.

Overridden identity fields in `onWarning` are under `data`, including only the name or instanceId items that actually conflict. Small signed buffers may be inline only without explicit `transfer`; explicit transfer still hands over and detaches the original buffer. Carrier implementations must adopt the [current manifest format](../rpc-contract/USEGUIDE.en.md#carriers-binary-and-stage-order).
