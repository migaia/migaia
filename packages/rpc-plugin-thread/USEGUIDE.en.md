# Thread plugin usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

This package supplies transport for actual Node, Bun, and Deno threads. Browser Workers, SharedWorkers, and page ports use the [browser guide](../rpc-plugin-browser/USEGUIDE.en.md), not server guards guessing browser sources.

## Start with a real Worker

Save as a standalone ESM entry. Node 24 runs TypeScript directly; other toolchains compile first. The parent explicitly spawns and the child joins through actual bootstrap:

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.request('double', 21))
  } finally {
    await host.close()
  }
}
```

The parent prints 42. An explicit entry can use spawn:new URL('./worker.js',import.meta.url). Providers can yield generators, and either side can call back on the same session. self is application handshake identity, not a claim derived from native ports or environment strings. Omission retains independent launcher/bootstrap identity.

## Streams, early return, and cancellation

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkerApi = {
  worker: { values(end: number): AsyncIterable<number>; wait(value: number): number }
}
export async function consume(host: IRpcHost<IWorkerApi>) {
  const stream = host.peers.worker.values(3)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}
export async function cancel(host: IRpcHost<IWorkerApi>) {
  const controller = new AbortController()
  const pending = host.send('worker', 'wait', 1, { signal: controller.signal, timeoutMs: 1500 })
  controller.abort()
  return await pending
}
```

The helper declares the current direct worker. next/return/throw belong to the original iterator; early return ends that business stream rather than the Worker. A call signal is distinct from task/Worker lifetime. Providers must observe context.signal; cancellation cannot preempt a synchronous loop.

notify waits only for physical sending; request waits for business results. Untargeted calls with multiple direct peers follow host broadcasting. Use send(nameOrId,method,payload) for a scalar. Held peers.worker methods stay bound to their original generation and reject after restart; read the current directory for new capabilities.

## Crash recovery and reconciliation

```ts doc-test=check
import { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'

export const recoveryFeatures = [retryFeature(), timeoutFeature({ ms: 1500 })]
```

Install these in host.plugins. The original supervisor decides whether and when to restart. retryFeature uses existing generations, declarations, idempotency, and deadlines to decide whether a request can retry; it adds no restarter. Unconfirmed work can produce REMOTE_RESULT_UNKNOWN. Without that policy, original transport failures keep their identity. Connection recovery never justifies blindly replaying non-idempotent work.

connect.timeoutMs is one identity/capability preparation budget; call timeoutMs bounds that business wait. Startup timeout, stop, budget, heap, and permission enforcement remain native-source/supervisor responsibilities. A closed host does not revive; create a new owner for new work.

## Clone and ownership transfer

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkerApi = { worker: { bytes(value: Uint8Array): number } }
export async function sendOwnedBytes(host: IRpcHost<IWorkerApi>, bytes: Uint8Array<ArrayBuffer>) {
  return await host.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })
}
```

This helper succeeds only with an actual native carrier, bilateral capabilities, and supported authentication. Unauthenticated RPC transfer rejects at original admission; a native postMessage method is not authorization. Omit transfer for normal copying. On failure inspect whether the original buffer remains owned locally rather than assuming detach or business completion.

## Native errors and usage observation

rpc.transport.thread identifies native boundaries; rpc.endpoint/rpc.remote retain call and managed failures. The standard cross-Worker error representation keeps source/code/name/message/stack/cause and aggregate members, not arbitrary custom class prototypes. Branch on identity rather than text.

Usage sampling addresses the selected actual Worker isolate. Heap/CPU fields exist only when native APIs support them. Threads share a process PID; parent RSS is not thread memory. A pending sample across replacement remains bound to the original generation instead of selecting its successor.

## Host integration and closure

Ordinary PluginHost installation retains the thread outlet's stop/restart/replace, ready/exit, and generation owners. name is installation identity, distinct from remote self.name. Use the host's existing controls rather than rebuilding supervision or using a complete legacy call object as source.

host.close follows original drain before releasing the owned Worker. Termination is requested at most once; exited settles only after native exit. Late old-generation results do not reopen a closed connection. Cancelling a call, returning a stream, closing a host, and killing a Worker have different owners.

The root exposes threadPlugin/isThreadChild, options, and errors. /adapters/node and /adapters/electron-main support authors needing native launcher/channel integration. Short options cover ordinary applications; browsers use browser plugins.
