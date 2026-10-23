# `@migaia/rpc-plugin-pool`

Use the existing bounded scheduler, FIFO, resize, and drain owners for a host's real process, thread, or cooperative-task members.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Why use it

- One logical peer, **pool**: each operation selects one member and executes once instead of broadcasting to all members.
- Busy members lead to a bounded FIFO. Queued cancellation removes only its entry, and overflow rejects before business code runs.
- Shrink retires idle members first; streams keep their slot until completion.
- Close seals admission, drains accepted operations, then closes members through their original ownership.

## Start here

This uses real Node 24 Workers. Save it as a standalone ESM TypeScript entry, or compile it to ESM first.

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread @migaia/rpc-plugin-pool
```

```ts doc-test=run
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

It prints `42`, `42`, and `2`. Each call executes once and returns a scalar. Three members have independent native lifetimes, while this host still constructs only one call endpoint.

## Targets and members

pool is a feature paired with a transport that can repeatedly open independent members: `processPlugin({ spawn / connect })`, `threadPlugin({ spawn })`, or `coroutinePlugin({ spawn })`. Listener and connectToParent modes reject with `POOL_TRANSPORT_UNSUPPORTED` before opening any member.

Only `pool` enters the public direct-target collection. Hidden members do not enter `host.peers` or the direct target list. `request / notify / stream / group / outcome` and `send('pool', ...)` all select once through the original scheduler. A whole group uses one member. outcome also selects one member; it is not an application-wide search across member result stores. Do not target hidden native member IDs.

## Controls and statistics

Keep the exact returned feature instance, then call `pool.controls(actualHost)` for that installation's original controls. The same definition can be installed on different hosts with isolated controls.

| API / option            | Behavior                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `size`                  | Required positive integer; installation waits for independent members to become ready               |
| `maxQueue`              | Default 256, nonnegative integer; 0 disables waiting                                                |
| `idleTimeoutMs`         | Omitted disables idle retirement; positive finite milliseconds, with later demand refilling members |
| `scheduler`             | Owns original idle timing, not native restart or call-deadline clocks                               |
| `controls.stats()`      | Frozen targetSize/memberCount/inFlight/queued/state snapshot                                        |
| `controls.resize(size)` | Ordered capacity changes, settling after occupied retirees are safe                                 |
| `controls.close()`      | Seals pool admission and drains; repeated calls share its original Promise                          |
| `host.describe()`       | Canonical host description includes pool statistics                                                 |

`inFlight` counts client-side slots, not remote provider or CPU concurrency. Streams are lazy: first next acquires a slot, released on completion, return, throw, or cancellation. host.close drains the logical pool before releasing members. Closing controls alone does not replace final host closure.

## Errors and lifetime

Pool-owned failures use `rpc.pool`: INVALID_OPTIONS, POOL_TRANSPORT_UNSUPPORTED, POOL_CLOSED, QUEUE_FULL, CALL_ABORTED, and CLOSE_FAILED. Original business/transport failures keep their source/code/cause; the pool does not automatically replay work.

Partial construction attempts all acquired-member cleanup while retaining the original primary; secondary cleanup failures remain traceable in its error graph or reports. Close attempts every member, retaining original errors/cause in cleanup aggregation, and stays terminal. See the [usage guide](./USEGUIDE.en.md) for queueing, cancellation, resize, and failures.
