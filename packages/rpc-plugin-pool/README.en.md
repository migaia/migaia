# @migaia/rpc-plugin-pool

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

Group several Workers or child processes of one transport into a pool that callers see as one logical peer, `pool`. This package is a Feature installed on a transport plugin: it hands calls to idle members, queues them in a bounded first-in-first-out queue when every member is busy, scales the member count, and drains on shutdown.

## Problems you may have seen

- **One Worker is not enough, and several Workers mean distributing work by hand**: hand-written round-robin does not know which member is busy, so slow tasks pile up on one member. The cause is scheduling without regard to idleness.
- **Requests pile up without limit at peak**: when every member is busy, new requests queue in memory longer and longer. The cause is an unbounded queue.

## Start here

This uses real Node 24 Workers. Save a standalone ESM TypeScript entry, or compile it to ESM first. Only the parent installs pool; the child joins its actual parent.

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread @migaia/rpc-plugin-pool
```

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { pool } from '@migaia/rpc-plugin-pool'

type IWorkerApi = { double(value: number): number }

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const plugins = [
    threadPlugin({ spawn: true, features: { workers: pool({ size: 3, maxQueue: 32 }) } })
  ] as const
  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
  try {
    console.log(await host.thread.send('pool', 'double', 21))
    await host.thread.pool.resize(2)
    console.log(host.thread.pool.stats().targetSize)
  } finally {
    await host.close()
  }
}
```

It prints `42` and `2`. Each call selects one member and returns that operation's result, rather than broadcasting to three members.

## Installation and logical target

Place `pool({ size })` in `features` on `threadPlugin`, `processPlugin`, or `coroutinePlugin`. The source must repeatedly acquire independent members: thread/coroutine spawn or process spawn/connect. Listener and connectToParent sources reject with `POOL_TRANSPORT_UNSUPPORTED` before acquisition.

Calls and controls live under the transport namespace: `host.thread.send('pool', ...)`, `host.thread.pool`, and `host.thread.members`. Private members do not enter that namespace's business target directory. `members` provides real native diagnostics and administration. One Host may contain transports with distinct namespaces; each pool combines only one carrier kind.

`request/notify/stream/group` selects one member per operation. A whole group uses the same member. `outcome` requires the idempotency plugin; it selects one member rather than searching every member's result store.

## Options and controls

| API / option                    | Behavior                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `size`                          | Required positive integer; initial installation waits for target readiness    |
| `maxQueue`                      | Default 256, nonnegative integer; 0 provides no waiting slots                 |
| `idleTimeoutMs`                 | Omitted disables retirement; positive finite milliseconds, maximum 2147483647 |
| `scheduler`                     | Owns only pool idle timing                                                    |
| `host.thread.pool.stats()`      | Frozen targetSize/memberCount/inFlight/queued/state snapshot                  |
| `host.thread.pool.resize(size)` | Ordered target changes; occupied members retire after completion              |
| `host.thread.pool.close()`      | Seals new admission, waits for accepted operations, then closes members       |

`inFlight` measures client slots, not provider or CPU concurrency. A stream occupies a slot on its first `next()` and releases it when consumption finishes or iteration ends. Shrink prefers idle members.

Business and transport failures retain their own identity; pool does not replay work itself. Pool-owned failures use source `rpc.pool`; handle code/cause as described in the [usage guide](./USEGUIDE.en.md). Custom transports use `@migaia/rpc-host/sdk`; observation uses `@migaia/rpc-host/plugins/probe`.
