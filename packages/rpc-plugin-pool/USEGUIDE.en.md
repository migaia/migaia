# Pool usage guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Host calls](../rpc-host/USEGUIDE.en.md)

Contract defines pure protocol rules and interfaces. Host owns sessions, providers, and call settlement; transports acquire and supervise real native resources. Flow plugins provide auth, chunk, batch, and probe at message hooks. The complete `pool` transport feature owns only same-carrier member scheduling, FIFO, resize, and drain. Timeout/retry features own their respective call policies.

## Install on the transport

The parent example uses three real Thread members. A Host may install transports in distinct namespaces; this example installs only `thread`, and the pool does not mix carrier kinds.

```ts doc-test=check
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { pool, RPC_POOL_PEER_ID } from '@migaia/rpc-plugin-pool'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'

type IWorkerApi = { work(value: number): number; values(end: number): AsyncIterable<number> }

const plugins = [
  threadPlugin({
    spawn: new URL('./worker.js', import.meta.url),
    features: {
      workers: pool({ size: 3, maxQueue: 32 }),
      timeout: timeoutFeature({ ms: 1500 }),
      retry: retryFeature({ attempts: 2 })
    }
  })
] as const

type IPoolHost = IRpcHost<IWorkerApi, typeof plugins>

export function open() {
  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })
}

export function work(host: IPoolHost, signal: AbortSignal) {
  return host.thread.send(RPC_POOL_PEER_ID, 'work', 21, {
    signal,
    timeout: { ms: 1000 },
    retry: false
  })
}

export async function firstValue(host: IPoolHost) {
  const stream = host.thread.peers.pool.values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}

export async function shrink(host: IPoolHost) {
  await host.thread.pool.resize(1)
  return { stats: host.thread.pool.stats(), members: await host.thread.members.list() }
}

export async function closeIdlePool(host: IPoolHost) {
  await host.thread.pool.close()
  await host.close()
}
```

The corresponding `worker.js` is a separate child entry. Only the parent installs pool; the child joins its actual parent.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: {
    work: (value: number) => value * 2,
    values: async function* (end: number) {
      for (let value = 0; value < end; value += 1) yield value
    }
  }
})
```

The factory is `pool(options)`. Controls are published on that installation's `host.thread.pool` and `host.thread.members`, rather than queried from the factory object. `features` uses `{ name: feature }` for native pool, timeout, and retry tokens; per-call timeout/retry accepts policy options or `false`.

## One logical target

The business directory exposes only `pool` (exported as `RPC_POOL_PEER_ID`), without direct targets for private members. `host.thread.send('pool', ...)` reserves one member; untargeted request/notify/stream/group also selects once. `members` administers actual native resources, rather than providing a business shortcut to hidden members.

A whole group stays on one member. `outcome` requires the idempotency plugin and also selects one member, without searching every member's store. Pool itself adds no deduplication, idempotency guarantee, or business retry.

A source must repeatedly acquire independent members: Thread/Coroutine spawn, Process spawn or connect. Listener/connectToParent sources reject before native acquisition; pool does not clone one parent connection into several members. Custom native deployment uses `@migaia/rpc-host/sdk`.

## Capacity, queues, and cancellation

| Option          | Rule                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `size`          | Required positive integer; initial installation waits for target readiness |
| `maxQueue`      | Default 256; nonnegative integer; 0 disables queueing                      |
| `idleTimeoutMs` | Omitted disables it; positive finite milliseconds, at most 2147483647      |
| `scheduler`     | Owns idle retirement timing only, not native supervision or call deadlines |

Each member lends one client slot at a time. Busy operations enter bounded FIFO; a full queue rejects with QUEUE_FULL. `signal` cancels a waiting entry. After start, cancellation follows the original call path and does not establish that remote effects never occurred.

Stats is a new frozen snapshot: targetSize, memberCount, inFlight, queued, state. `queued` counts waiting entries without an assigned member. `inFlight` counts client slots, not provider or CPU concurrency. memberCount includes retirees still being cleaned up, so it need not equal targetSize at every instant.

## Streams, resize, and drain

A stream acquires its slot on the first `next()`. Completion, early return, or settled throw/cancellation releases it. An application-held unfinished stream can prevent that slot from draining. Ending a stream does not close the entire pool.

`resize` serializes target changes in call order. Shrink prefers idle members and waits for occupied members to finish. Expansion acquires only missing members; failure preserves the primary and restores the old target while still open. Idle retirement leaves targetSize unchanged, and later demand refills it.

Explicit `host.thread.pool.close()` stops new admission, waits for accepted work and member acquisition, then attempts member cleanup. Repeated calls share the close Promise. Pool adds no drain timeout. Finish held work and streams, explicitly await pool closure, then finish Host cleanup; `closeIdlePool` shows this order when no work is held.

## Errors and observation

Pool-owned source is `rpc.pool`: INVALID_OPTIONS, POOL_TRANSPORT_UNSUPPORTED, POOL_CLOSED, QUEUE_FULL, CALL_ABORTED, CLOSE_FAILED. Business/native errors retain their owner's source/code/cause; pool does not replay them automatically.

Partial construction cleans up acquired members while preserving the original primary. Secondary cleanup failures remain reachable through the error graph or reports. Member cleanup failures from the final closing phase retain original errors and the first cause in a CLOSE_FAILED AggregateError, and a closed pool does not reopen. Open-phase failures already delivered through resize rejection or idle-retirement reporting are not retained and thrown again by the final close. Use `@migaia/rpc-host/plugins/probe` for readonly observation instead of another diagnostics or message parser inside pool.
