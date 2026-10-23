# RPC pool guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Shared call rules](../rpc-host/USEGUIDE.en.md)

poolPlugin is a feature installed with one transport that can repeatedly open independent members. The original scheduler owns capacity, bounded FIFO, leases, resizing, and draining. Native process, thread, or cooperative owners continue supervising members.

## Start with three real threads

Save this as an independent ESM TypeScript entry using a supporting Node toolchain. Parent and child use the same file, but only the parent installs the pool.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { poolPlugin } from '@migaia/rpc-plugin-pool'

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const pool = poolPlugin({ size: 3, maxQueue: 32 })
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [threadPlugin({ spawn: true }), pool]
  })
  try {
    console.log(await host.request('double', 21))
    console.log(await host.send('pool', 'double', 21))
    await pool.controls(host).resize(2)
    console.log(pool.controls(host).stats().targetSize)
  } finally {
    await host.close()
  }
}
```

Output is 42, 42, then 2. Each call executes exactly once and returns a scalar. This host has one call endpoint; all three members retain real native lifetimes and supervised leases.

## One logical target

The only public target is pool, also exported as RPC_POOL_PEER_ID. Hidden members do not appear in direct targets or host.peers. Do not address them by native IDs.

Untargeted request, notify, stream, group, and outcome each make one scheduling choice. send('pool', method, payload) also returns a scalar, without a broadcast array. A group runs entirely on one member. outcome selects one member rather than searching every member's result store.

Supported sources include spawned process/thread/coroutine members and process connect sources that can establish independent connections repeatedly. listen and connectToParent reject with POOL_TRANSPORT_UNSUPPORTED before any member opens; neither is an independent member factory.

## Capacity and queueing

| Option        | Rule                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| size          | Required positive integer; installation waits for the target member count          |
| maxQueue      | Default 256, nonnegative integer; 0 provides no waiting slots                      |
| idleTimeoutMs | Omit to disable idle retirement; otherwise finite, positive, at most 2147483647 ms |
| scheduler     | Owns existing idle timers, not native supervision or call deadlines                |

Each member lends one client slot at a time. Busy operations enter the bounded FIFO. queued counts accepted entries without a member; inFlight counts occupied client slots, not provider or CPU concurrency. A full queue rejects before business execution rather than silently expanding.

A call signal can cancel a waiting entry. Cancellation after business starts follows original call semantics and does not prove absence of remote side effects. Original call owners retain deadline and connection preparation behavior; there is no separate pool timeout mechanism.

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

export async function cancellableWork(
  host: IRpcHost<{ work(value: number): number }>,
  signal: AbortSignal
) {
  return await host.send('pool', 'work', 21, { signal, timeoutMs: 1000 })
}
```

## Stream slot ownership

Streams are lazy: first next acquires a member. Completion, return, throw, or settled cancellation releases the slot. An unstarted iterator occupies no member. A partially consumed stream that is neither continued nor returned prevents that slot from draining.

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

export async function firstPoolValue(
  host: IRpcHost<{ pool: { values(end: number): AsyncIterable<number> } }>
) {
  const stream = host.peers.pool.values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}
```

Returning a stream releases that call and its slot, not the whole pool. Shrinking does not interrupt a stream that already occupies a slot.

## Bind controls to the actual host

Retain the object returned by const pool = poolPlugin(...), then use pool.controls(actualHost). Installations of that object are isolated by actual host identity. Do not pass a plain object, another host's proxy, or a copied plugin.

```ts doc-test=check
import type { IRpcPoolControls } from '@migaia/rpc-plugin-pool'

export async function shrink(controls: IRpcPoolControls) {
  await controls.resize(1)
  const snapshot = controls.stats()
  return { target: snapshot.targetSize, busy: snapshot.inFlight, waiting: snapshot.queued }
}
```

stats returns a new frozen snapshot containing targetSize, memberCount, inFlight, queued, and state. memberCount includes retiring/closing members still retained for cleanup; it need not immediately equal targetSize. The safe host.describe result includes pool statistics.

resize processes changes in call order, retiring idle members before waiting for busy ones. Expansion opens only missing members. Failure preserves the primary error and restores the old target. Idle retirement keeps targetSize; later demand replenishes members through the original factory.

## Drain and failures

controls.close synchronously stops new admission, drains previously accepted operations and acquisitions, then closes members. Repeated calls share one Promise. There is no additional pool drain timeout. Let active streams finish or return them; close does not consume an unlimited business stream for you.

host.close drains the logical pool before releasing hidden members. controls.close alone closes the pool, so the application must still close its host and release other features and resources.

Partial construction attempts cleanup of every opened member and preserves the input-order primary error. Later cleanup errors do not replace it and remain reachable through errors/cause or reporting. close attempts every member; CLOSE_FAILED AggregateError retains original failures. A terminal pool does not reopen.

The pool source is rpc.pool: INVALID_OPTIONS, POOL_TRANSPORT_UNSUPPORTED, POOL_CLOSED, QUEUE_FULL, CALL_ABORTED, and CLOSE_FAILED. Business and native transport failures retain their owning identities. The pool does not replay calls automatically. Use the host's original retry policy only with an explicit business idempotency decision.
