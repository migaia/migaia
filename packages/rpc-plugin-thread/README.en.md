# @migaia/rpc-plugin-thread

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

Move heavy computation into Worker threads (Node, Bun, Deno) and call it like a local function. This is a transport plugin for [`@migaia/rpc-host`](../rpc-host/README.en.md): the host handles calls, timeouts, cancellation and error restoration, and this package creates the Worker, restarts it under a policy when it crashes, and terminates it on shutdown.

## Problems you may have seen

- **One heavy computation stalls the whole service**: CPU-bound parsing or rendering runs on the main thread and every other request queues behind it. The cause is that computation and request handling share one thread.
- **After a Worker crashes, callers wait forever**: the Worker exits on an uncaught exception, and the Promises waiting on the main thread never settle. The cause is that nobody supervises the Worker's lifetime and settles pending calls.

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread
```

Save this as a standalone ESM TypeScript entry. Use Node 24 native TypeScript support, or compile it to ESM first. The child reloads the same entry; the guard prevents recursive spawning.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

type IWorkerApi = { double(value: number): number }

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const plugins = [threadPlugin({ spawn: true })] as const
  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
  try {
    console.log(await host.thread.request('double', 21))
  } finally {
    await host.close()
  }
}
```

One current direct Worker returns `42`. A separate child entry can use `spawn: new URL('./worker.js', import.meta.url)` and joins with `connectToParent: true` using its actual parent bootstrap.

## Sources and namespaces

| Option                  | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `spawn`                 | `true`, path/URL, an `entry` shorthand, or a full native `IThreadSpawn` recipe |
| `connectToParent: true` | Join the parent from a real child thread; mutually exclusive with `spawn`      |
| `name`                  | Native installation/registration name; defaults to `thread`                    |
| `namespace`             | Call namespace; defaults to `thread`                                           |
| `features`              | `{ localName: nativeFeature }` for timeout, retry, or pool                     |
| `expose`                | Select local Feature methods when installed on an ordinary PluginHost          |
| `report`                | Native diagnostic callback                                                     |

Call through `host.thread.request/notify/stream/group/send/dispatch`; use `host.thread.members` for member controls. One Host may install transports with distinct namespaces, which isolate their calls. Select the medium your application needs; using this package does not require another medium.

Use [rpc-plugin-browser](../rpc-plugin-browser/README.en.md) in browser pages and browser Workers, or [rpc-plugin-process](../rpc-plugin-process/README.en.md) for OS process isolation. See [pool](../rpc-plugin-pool/README.en.md) for scheduling several members of this same transport.

## Policies and lifetime

Calls accept `signal`, timeout `{ ms }`, retry `{ attempts }`, or `false`. Selection precedence is per-call options, transport features, then the default from a host-level flow plugin. An absent policy adds no automatic timeout or retry. Cancellation is cooperative and cannot preempt a synchronous loop.

The native Thread `spec.limits.callWallTimeMs` is a separate hard cap. Explicit `timeout: false` disables the optional business timeout without extending that cap. An independent timeout execution uses the actual launch spec and its original scheduler.

`notify` waits for physical write; `request` waits for the business result. Native supervision owns restart and replacement. A restored connection does not establish that work can safely be replayed. Native, call, and remote errors retain their own source/code/cause; transferred error graphs preserve name/message/stack and aggregate members.

The root exports `threadPlugin`, `isThreadChild`, public options, and error identity. Custom raw carriers use `@migaia/rpc-host/sdk`; readonly observation uses `@migaia/rpc-host/plugins/probe`. Ending a stream, cancelling a call, closing a namespace, closing the Host, and terminating a Worker are different operations. See the [usage guide](./USEGUIDE.en.md).
