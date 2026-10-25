# Thread usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

Contract defines pure protocol rules and interfaces. Host owns sessions, directories, providers, and call lifetime. The Thread transport acquires and supervises real Workers. Flow plugins provide auth, chunk, batch, and probe at fixed message hooks; features provide their owning plugin's timeout, retry, or pool. A Host may install several transports in distinct namespaces; this guide needs only Thread.

## Explicit parent and child entries

The parent uses a real `worker.js` and installs complete policies in transport `features`. When declaring remote methods, retain `typeof plugins` as well, so namespaces and member controls retain their types.

```ts doc-test=check
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { timeout, retry } from '@migaia/rpc-host/features'

type IWorkerApi = {
  values(end: number): AsyncIterable<number>
  wait(value: number): number
  bytes(value: Uint8Array<ArrayBuffer>): number
}

const plugins = [
  threadPlugin({
    name: 'worker',
    spawn: new URL('./worker.js', import.meta.url),
    features: [timeout({ ms: 1500 }), retry({ attempts: 2 })]
  })
] as const

type IThreadHost = IRpcHost<IWorkerApi, typeof plugins>

export function open() {
  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })
}

export async function firstValue(host: IThreadHost) {
  const stream = host.thread.peers.worker.values(3)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}

export function work(host: IThreadHost, signal: AbortSignal) {
  return host.thread.send('worker', 'wait', 21, {
    signal,
    timeout: timeout({ ms: 500 }),
    retry: false
  })
}

export function sendBytes(host: IThreadHost, bytes: Uint8Array<ArrayBuffer>) {
  return host.thread.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })
}

export async function inspectAndRestart(host: IThreadHost) {
  const before = await host.thread.members.get('worker')
  await host.thread.members.restart('worker')
  return before
}
```

The child entry for `worker.js` follows. Compile it to ESM, or select the actual `.ts` entry in a runtime supporting native TypeScript. Relative strings resolve from the actual main entry; shorthand `{ entry, base }` selects an explicit base.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: {
    values: async function* (end: number) {
      for (let value = 0; value < end; value += 1) yield value
    },
    wait: (value: number) => value,
    bytes: (value: Uint8Array) => value.byteLength
  }
})
```

Choose exactly one of `spawn` and `connectToParent`. Shorthand accepts `entry/name/data/limits` and caller-selected native launcher, budget, and scheduler. Full `IThreadSpawn` retains the chosen supervision recipe. `name` is the registration name; `namespace` determines `host.<ns>`. Real bootstrap supplies child identity and generation; explicit `self` must agree with that source.

## Calls and policies

Untargeted `host.thread.request` uses current direct targets. `send(nameOrId, method, payload, options)` selects one target. `notify` selects with `{ targetId }` and waits only for actual physical write, without provider completion or ACK. With several ordinary direct targets, untargeted calls retain independent per-target results.

`timeout` and `retry` accept complete feature instances or `false`. Precedence is per-call, installed transport policy, then link-policy plugin. The example chooses a 500 ms call timeout and disables retry for that call. No selected policy means no automatic policy. Native startup, health, stop, and business deadlines keep their respective owners; business timeout does not configure those clocks.

Thread `spec.limits.callWallTimeMs` surrounds the whole originating call, including retry/backoff. The native registration retains its initially admitted spec's cap across restart and replacement. A shorter business timeout may end the call earlier; `timeout: false` cannot disable the native cap. Without a native cap, `timeout: false` adds no deadline.

`signal` cooperatively cancels business work through provider context.signal. It neither preempts synchronous loops nor terminates a Worker. Native supervisor policy owns restart; retry decides replay only under supported generation and business-declaration conditions. Unconfirmed work may already have run, so connection recovery is not authorization to replay it.

## Streams, transfer, and observation

The example obtains a generation-bound stream through current `host.thread.peers.worker`. Finish it or call `return()` on early exit. An old held capability cannot silently become a new-generation capability; read the current directory again after replacement.

Pass the original ArrayBuffer to `transfer`, without substituting another backing. Successful native handoff may move ownership; omit transfer for ordinary copying. Authentication is installed as a separate auth flow plugin. Use combinations supported by the actual carrier; a native `postMessage` method does not establish additional authentication or capability guarantees.

Custom carriers use `@migaia/rpc-host/sdk`; readonly carrier/flow observation uses `@migaia/rpc-host/plugins/probe`. Resource queries report actual native samples. Threads share a process PID, so process RSS is not reported as one thread's memory.

A native `messageerror` reports that diagnostic once without closing a valid connection. Failed diagnostic conversion first reports its original cause. Readonly probe callback failures retain `TRANSPORT` and the original cause without blocking native delivery. An intentional restart/replacement without a native error does not fabricate a TRANSPORT cause; REMOTE_CLOSED retains its generation detail.

An untargeted namespace call made during restart selects the currently accepted set, using ordinary fanout results for an empty set. A previously held function remains bound to its original generation and rejects with `TARGET_UNKNOWN` after departure instead of moving to the successor Worker.

## Member management and closure

`host.thread.members` provides `list/get/stop/kill/restart/replace/on/watch`. Queries accept current instance identity or registered name. Stop/restart/replace require a genuinely managed source; borrowed sources do not acquire a supervisor. Event and query identity comes from the original registration and actual accepted session.

Call completion, stream completion, namespace.close, Host.close, and native kill are distinct operations. Finish application-held streams and work before closing the Host; native resources are released through their actual ownership. Errors may use `rpc.transport.thread`, `rpc.endpoint`, or `rpc.remote`. Inspect code/cause and the retained error graph instead of matching message text.
