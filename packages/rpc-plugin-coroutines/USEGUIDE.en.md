# Cooperative task RPC guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Shared call rules](../rpc-host/USEGUIDE.en.md)

coroutinePlugin connects a real cooperative task on the same event loop to createRpcHost. Native MessageChannel carries calls; the original supervisor owns generations, budgets, stopping, and replacement. Tasks have no process or Worker isolation and cannot preempt a synchronous infinite loop.

## Parent task and child host

The runtime must provide native MessageChannel. The parent supplies a task; the child uses the exact connect handle from that invocation. This example includes both sides' cleanup:

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const parent = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      connect: { timeoutMs: 1500 },
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

Expected output is 42. Do not return immediately after constructing the child: task settlement ends that generation's native connection. Parent host.close follows the original drain and supervised stop path. The task observes signal, closes its child, and exits.

## Exact connection handle

spawn and connectToParent are mutually exclusive. Here connectToParent is an opaque ICoroutineConnect handle, **not true**. Do not reuse the process/thread boolean form, copy the handle, fabricate one, or carry it into another generation. It identifies the task's actual port and reporter; it is not serializable configuration.

The task receives signal, heartbeat, and connect. signal bounds task lifetime. heartbeat reports liveness to the original configured policy. connect belongs only to this child connection. A heartbeat neither completes business work nor runs a task loop for you.

Declare a task independently from its transport configuration:

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'

export const task: ICoroutineUserTask = async ({ connect, signal }) => {
  const child = await createRpcHost({
    plugins: [coroutinePlugin({ connectToParent: connect })],
    provide: { echo: (value: string) => value }
  })
  try {
    if (!signal.aborted)
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
  } finally {
    await child.close()
  }
}
```

Pass task to coroutinePlugin({ spawn: task }) and eventually close the resulting parent host.

## Cancellation, streams, and errors

Task signal and a provider call's context.signal have different scopes. The first ends a task generation; the second cancels that call. Long asynchronous work should observe the call signal cooperatively. A synchronous CPU loop blocks the same event loop, including deadline and supervisor callbacks.

Streams use the shared host AsyncIterable API. Consumers that stop early return the stream, releasing its original call resources without stopping the task. This helper consumes an explicit stream method on the current direct worker:

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

export async function firstValue(
  host: IRpcHost<{ worker: { values(end: number): AsyncIterable<number> } }>
) {
  const stream = host.peers.worker.values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}
```

A request with one direct peer returns a scalar. See the host guide for multiple peers. Both the task and parent can provide methods over the same real session.

Source admission preserves native TypeError with source rpc.transport.coroutine and code COROUTINE_SOURCE_INVALID. Business, handshake, and supervisor errors keep their owning source/code/cause rather than becoming source errors. The message boundary preserves native names, messages, stacks, and complete cause chains.

## Supervision and replacement

supervisor configures only the original restart, terminalPolicy, startupTimeoutMs, stop, budget, and heartbeat policies. connect.timeoutMs bounds identity/capability negotiation for a generation. It is separate from task stop budgets and per-call timeoutMs.

```ts doc-test=check
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'

export function taskPlugins(task: ICoroutineUserTask) {
  return [
    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),
    retryFeature(),
    timeoutFeature({ ms: 1000 })
  ]
}
```

Retry uses the original call policy; it does not make every non-idempotent operation safe to replay. The supervisor chooses the next generation. Held old-generation capabilities do not retarget automatically. Tasks that ignore cancellation retain original stop, reap, and late-settlement behavior. A control result does not prove forced termination of same-thread code.

The same transport definition installs in an ordinary PluginHost. Its coroutine outlet retains stop/restart/replace. Replacement takes { task: nextTask }, typed as ICoroutineReplaceSpec. Let the original replacement transaction manage generations instead of writing a separate close-old/start-new sequence.

## Pool and devtools

With poolPlugin({ size }), every hidden member is an independent real task. Only the logical pool target is public; each operation selects one member instead of broadcasting to every task. See the [pool guide](../rpc-plugin-pool/USEGUIDE.en.md).

Install devtoolsPlugin() to observe the original message/carrier path. host.close removes that host's observation; the application still owns the collector's final close. Tasks share memory, so applications remain responsible for closure state and concurrent side effects.

Public types are ICoroutinePluginOptions, ICoroutineConnect, ICoroutineUserTask, ICoroutineTaskContext, ICoroutineReplaceSpec, and ICoroutineSupervisorPolicy. They describe tasks and policies without exposing ports, registries, or internal constructors.
