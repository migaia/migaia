# `@migaia/rpc-plugin-thread`

Run `createRpcHost` application methods on real Node, Bun, or Deno threads while retaining native Worker supervision, generations, and cleanup.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Why use it

- Both sides provide methods, call back, and stream results through the same connection.
- Deadlines, cooperative cancellation, admission, and error causes follow the existing call path.
- The original supervisor restores connections after crashes; held old-generation capabilities and uncertain results do not become new-generation results.
- Closing a host releases its owned Worker, keeping a terminate request distinct from actual native exit.

Use [rpc-plugin-browser](../rpc-plugin-browser/README.en.md) in browser pages and browser Workers. Choose [rpc-plugin-process](../rpc-plugin-process/README.en.md) for OS process isolation.

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread
```

Save this as a standalone ESM TypeScript entry for Node 24's native TypeScript support, or compile it to ESM with your toolchain. The child reloads the same entry; the guard prevents recursive spawning.

```ts doc-test=run
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

It prints `42`. An explicit entry can use `spawn: new URL('./worker.js', import.meta.url)`; that entry joins with `connectToParent: true` using its actual parent bootstrap.

## Sources and calls

| API / option                              | Purpose                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `threadPlugin({ spawn })`                 | Current entry, path/URL, short configuration, or full native supervision recipe |
| `threadPlugin({ connectToParent: true })` | Join the parent from an actual native child thread                              |
| `isThreadChild()`                         | Asynchronously inspect native child-thread identity                             |
| `connect: { timeoutMs }`                  | One shared budget for identity and capability preparation                       |
| `createRpcHost({ provide, self, ... })`   | Application providers and local identity rather than inferred Worker identity   |
| `host.request / notify / stream / send`   | The common host call interface                                                  |

Choose either spawn or connectToParent. This plugin does not accept browser Window/SharedWorker sources or fabricated parent data. Child identity comes from the launcher's real bootstrap. A host uses one call endpoint; [poolPlugin](../rpc-plugin-pool/README.en.md) can manage multiple hidden native thread members on that same host.

## Deadlines, errors, and recovery

Pass `signal` and `timeoutMs` to calls. Transport `connect.timeoutMs` separately bounds handshake preparation. Cancellation is cooperative and cannot stop an arbitrary synchronous loop; use original supervision controls when native termination is required. Unconfirmed business work may already have executed, so automatic recovery is not automatic safe replay.

Native thread errors use `rpc.transport.thread`; calls can use `rpc.endpoint` or `rpc.remote`. Serialization preserves source/code/name/message/stack/cause and aggregate members. Branch on identity, not message text.

Structured clone and ownership transfer are separate capabilities. RPC transfer additionally requires actual negotiated support and supported authentication; a native `postMessage` method alone is insufficient. Inspect the original error chain on rejection. Native usage samples refer to the selected Worker, never process RSS presented as thread memory.

## Native integration and lifetime

The root provides `threadPlugin`, `isThreadChild`, public options, and error identity. Package-owned launchers and channels remain internal. Applications select short spawn or a full native supervision recipe; custom raw carriers use the deployment SDK in `@migaia/rpc-host/plugin`.

Definitions also install on ordinary `PluginHost.use(...)`. Its thread outlet retains stop, restart, replacement, exit events, and generations. Close follows the existing native drain before releasing the owned Worker, without repeated terminate calls. See the [usage guide](./USEGUIDE.en.md).
