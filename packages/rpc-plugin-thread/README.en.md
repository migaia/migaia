# `@migaia/rpc-plugin-thread`

Run RPC on real Node, Bun, or Deno Workers.

`rpc-contract` defines pure protocol rules and interfaces. `rpc-host` owns sessions, directories, providers, call settlement, and cancellation. This transport plugin acquires, supervises, and releases native Workers. Flow plugins such as auth, chunk, batch, and probe process message flow; features such as timeout, retry, and pool attach to their owning plugin.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

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
| `features`              | Complete timeout, retry, or pool feature instances                             |
| `expose`                | Select local Feature methods when installed on an ordinary PluginHost          |
| `report`                | Native diagnostic callback                                                     |

Call through `host.thread.request/notify/stream/group/send/dispatch`; use `host.thread.members` for member controls. One Host may install transports with distinct namespaces, which isolate their calls. Select the medium your application needs; using this package does not require another medium.

Use [rpc-plugin-browser](../rpc-plugin-browser/README.en.md) in browser pages and browser Workers, or [rpc-plugin-process](../rpc-plugin-process/README.en.md) for OS process isolation. See [pool](../rpc-plugin-pool/README.en.md) for scheduling several members of this same transport.

## Policies and lifetime

Calls accept `signal`, complete `timeoutFeature({ ms })` and `retryFeature({ attempts })` instances, or `false`. Selection precedence is per-call options, transport features, then link-policy plugin. An absent policy adds no automatic timeout or retry. Cancellation is cooperative and cannot preempt a synchronous loop.

The native Thread `spec.limits.callWallTimeMs` is a separate hard cap. Explicit `timeout: false` disables the optional business timeout without extending that cap. A complete timeout instance uses the actual launch spec and its original scheduler.

`notify` waits for physical write; `request` waits for the business result. Native supervision owns restart and replacement. A restored connection does not establish that work can safely be replayed. Native, call, and remote errors retain their own source/code/cause; transferred error graphs preserve name/message/stack and aggregate members.

The root exports `threadPlugin`, `isThreadChild`, public options, and error identity. Custom raw carriers use `@migaia/rpc-host/sdk`; readonly observation uses `@migaia/rpc-host/plugins/probe`. Ending a stream, cancelling a call, closing a namespace, closing the Host, and terminating a Worker are different operations. See the [usage guide](./USEGUIDE.en.md).
