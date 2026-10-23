# `@migaia/rpc-plugin-coroutines`

Run supervised cooperative tasks in one event loop with `createRpcHost`, using a real MessageChannel for application calls.

[中文](./README.md) · [Guide](./USEGUIDE.en.md)

## Why use it

- Keep the same bidirectional requests, notifications, streams, deadlines, and error semantics.
- Each task generation gets an independent connection handle; the original supervisor owns budget, generations, stop, restart, and replacement.
- Tasks receive the original `signal` and `heartbeat()` without another task scheduler or retry loop.
- No OS process or Worker is started. Choose [process](../rpc-plugin-process/README.en.md) or [thread](../rpc-plugin-thread/README.en.md) transport when isolation is required.

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

The host runtime must provide native MessageChannel. The same task pattern works on Node, Bun, Deno, and browsers with that capability:

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const parent = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal, heartbeat }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
        })
        heartbeat()
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        } finally {
          await child.close()
        }
      }
    })
  ]
})
try {
  console.log(await parent.request('double', 21))
} finally {
  await parent.close()
}
```

It prints `42`. Keep the task running until its signal is cancelled: settling the task function closes its generation's native ports.

## Sources and lifetime

| Configuration / capability                              | Meaning                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `coroutinePlugin({ spawn: task })`                      | Starts a real cooperative task owned by this host                                                 |
| `coroutinePlugin({ connectToParent: context.connect })` | Joins from the child using its exact generation-local opaque handle                               |
| `context.signal`                                        | Original supervision stop signal; user work must cooperate                                        |
| `context.heartbeat()`                                   | Reports liveness to the existing supervisor when its policy enables checks                        |
| `supervisor`                                            | Optional original restart, terminalPolicy, startupTimeoutMs, stop, budget, and heartbeat policies |
| `connect: { timeoutMs }`                                | One budget for this generation's identity/capability handshake                                    |

spawn and connectToParent are mutually exclusive. Here `connectToParent` **is not true**. Do not reuse a handle in another generation, copy it, or fabricate one. The child does not reinterpret the parent's identity; both sides confirm their directories through the original handshake.

Task cancellation differs from call cancellation: `context.signal` controls task lifetime, while a provider call context.signal belongs to that call. Cooperative tasks cannot forcibly interrupt synchronous loops and provide no separate CPU, memory, or permission isolation. Close follows existing drain and supervision; tasks ignoring the signal retain the original stop/late-settlement behavior.

## Combine with host and pool

Both sides can configure `provide`, `self`, and common features on `createRpcHost`. A single connection returns scalar request results; broadcasting follows [host](../rpc-host/README.en.md) rules. With [poolPlugin](../rpc-plugin-pool/README.en.md), each private member is an independent real task, exposed only through the logical pool target.

Definitions also install on ordinary `PluginHost`. Its coroutine outlet retains stop/restart/replace controls. Replacement supplies `{ task: nextTask }` to the original transaction rather than implementing another close-and-respawn sequence in application code.

## Types and errors

Public types are `ICoroutinePluginOptions`, `ICoroutineConnect`, `ICoroutineUserTask`, `ICoroutineTaskContext`, `ICoroutineReplaceSpec`, and `ICoroutineSupervisorPolicy`, plus the error-code type. The handle does not expose its physical port.

Source admission preserves TypeError with source=`rpc.transport.coroutine`, code=`COROUTINE_SOURCE_INVALID`. Call and supervision failures retain their original owner's identity and cause instead of becoming source errors. Branch on source/code; cleanup aggregates keep original objects reachable through errors/cause. See the [host documentation](../rpc-host/README.en.md) for shared call semantics.
