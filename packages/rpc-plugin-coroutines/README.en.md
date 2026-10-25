# `@migaia/rpc-plugin-coroutines`

Run RPC between real cooperative tasks on the same event loop.

Contract defines pure protocol rules and interfaces. Host owns sessions, directories, providers, call settlement, and cancellation. This transport plugin acquires and supervises tasks over real MessageChannels. Flow plugins such as auth, chunk, batch, and probe process messages; complete timeout, retry, and pool features attach to their owning plugin.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

The runtime needs native MessageChannel. Each task receives the exact connection handle for its child Host and stays alive until its task signal is cancelled.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'

async function untilStopped(signal: AbortSignal): Promise<void> {
  let complete!: () => void
  const stopped = new Promise<void>((resolve) => {
    complete = resolve
  })
  signal.addEventListener('abort', complete, { once: true })
  if (signal.aborted) complete()
  try {
    await stopped
  } finally {
    signal.removeEventListener('abort', complete)
  }
}

const task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {
  const child = await createRpcHost({
    plugins: [coroutinePlugin({ connectToParent: connect })],
    provide: { double: (value: number) => value * 2 }
  })
  heartbeat()
  try {
    await untilStopped(signal)
  } finally {
    await child.close()
  }
}

type IWorkerApi = { double(value: number): number }
const plugins = [coroutinePlugin({ spawn: task })] as const
const parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
try {
  console.log(await parent.coroutine.request('double', 21))
} finally {
  await parent.close()
}
```

One current direct task returns `42`. Task settlement ends that generation's real ports, so do not return immediately after constructing the child Host.

## Sources, namespaces, and controls

| API / option                     | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `spawn: task`                    | Create a supervised cooperative task                                            |
| `connectToParent: connect`       | Use this task's exact opaque handle, not a boolean                              |
| `name` / `namespace`             | Native registration name and call namespace; default `coroutine`                |
| `features`                       | Complete timeout, retry, or pool features                                       |
| `supervisor`                     | Original restart/terminalPolicy/startupTimeoutMs/stop/budget/heartbeat policies |
| `context.signal` / `heartbeat()` | Whole-generation stop signal and native liveness report                         |
| `host.coroutine.members`         | Actual member list/get/stop/kill/restart/replace/on/watch                       |

Calls live under `host.coroutine.*`. A Host may install transports in distinct namespaces; using this package needs no additional medium. Cooperative tasks provide no process or Worker isolation and cannot preempt a synchronous loop on their shared event loop.

Choose exactly one of spawn and connectToParent. A handle belongs to the actual current task; do not copy, fabricate, or reuse it across generations. Provider context.signal belongs to one business call rather than the task's lifetime.

## Policies and composition

Call options use complete `timeout({ ms })` and `retry({ attempts })` instances, or `false`. Precedence is per-call, transport feature, then link-policy plugin. No selected policy means no automatic policy. Business timeout does not configure native startup or stop budgets.

For several same-carrier tasks, use `coroutinePlugin({ spawn: task, features: [pool({ size: 3 })] })` with [rpc-plugin-pool](../rpc-plugin-pool/README.en.md). Flow plugins go in Host `plugins`; [Devtools](../rpc-plugin-devtools/README.en.md) observes messages through the canonical probe implementation.

Custom deployment uses `@migaia/rpc-host/sdk`; readonly observation uses `@migaia/rpc-host/plugins/probe`. Invalid sources retain TypeError, `rpc.transport.coroutine`, and COROUTINE_SOURCE_INVALID. Business, handshake, and supervision errors keep their own source/code/cause. See the [usage guide](./USEGUIDE.en.md) for streams, cancellation, and replacement.
