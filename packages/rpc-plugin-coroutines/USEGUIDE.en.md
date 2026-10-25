# Coroutine usage guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md)

Contract defines pure protocol rules and interfaces. Host owns sessions and call lifetime; the Coroutine transport owns real tasks/MessageChannels and native supervision integration. Flow plugins provide auth, chunk, batch, and probe; complete features provide timeout, retry, and pool. A Host may install transports in distinct namespaces; this guide uses only `coroutine`.

## Tasks and exact connection handles

The README contains a complete parent/child example. Declare an `ICoroutineUserTask` and receive signal, heartbeat, and connect from the current task context. Signal owns task lifetime, heartbeat reports liveness, and connect goes only to this child Host's `connectToParent`. Keep the task alive and close its child Host when exiting.

`connectToParent` takes `ICoroutineConnect`, not `true`. It identifies the original real port and source facts rather than serializable configuration. Spawn and connectToParent are mutually exclusive; only spawn accepts native supervisor options. Tasks share an event loop and memory without CPU, permission, or process isolation.

## Calls, policies, streams, and replacement

This retains the actual plugin tuple type. The supplied task must provide echo and values; target is a name or instance ID in the current business directory. Install `@migaia/rpc-plugin-pool` when using the pooled helper.

```ts doc-test=check
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { timeout, retry } from '@migaia/rpc-host/features'
import { pool } from '@migaia/rpc-plugin-pool'

type IWorkerApi = { echo(value: string): string; values(end: number): AsyncIterable<number> }

function taskPlugins(task: ICoroutineUserTask) {
  return [
    coroutinePlugin({
      spawn: task,
      features: [timeout({ ms: 1000 }), retry({ attempts: 2 })],
      supervisor: { startupTimeoutMs: 1500 }
    })
  ] as const
}

type ITaskHost = IRpcHost<IWorkerApi, ReturnType<typeof taskPlugins>>

export function open(task: ICoroutineUserTask) {
  const plugins = taskPlugins(task)
  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })
}

export function call(host: ITaskHost, target: string, signal: AbortSignal) {
  return host.coroutine.send(target, 'echo', 'hello', {
    signal,
    timeout: timeout({ ms: 500 }),
    retry: false
  })
}

export async function firstValue(host: ITaskHost, target: string) {
  const stream = host.coroutine.peers[target].values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}

export function replace(host: ITaskHost, target: string, task: ICoroutineUserTask) {
  return host.coroutine.members.replace(target, { task })
}

export function pooled(task: ICoroutineUserTask) {
  return coroutinePlugin({ spawn: task, features: [pool({ size: 3 })] })
}
```

`host.coroutine.request/notify/stream/group/send/dispatch` uses common namespace semantics. Notify waits only for actual write; request/send waits for business results. Target notify with `{ targetId }`. Untargeted calls use the current direct set, retaining independent outcomes for several ordinary direct targets.

Policy precedence is per-call options, transport features, then link-policy plugin. Per-call timeout/retry takes a complete instance or false. The example selects a 500 ms timeout and disables retry for that call. An absent policy adds no implicit timeout or retry loop. supervisor.startupTimeoutMs is the native task startup budget, separate from business timeout.

Read generation-bound streams through `host.coroutine.peers[target]`. Finish them or call return on early exit; this ends that stream rather than the task generation. Read the current directory again after restart; an old method does not silently point at a new task.

The call owner and native supervisor separately handle call and task signals. Providers should cooperatively inspect context.signal. Remote reasons are serialized; preserve each boundary's actual source/code/cause. A synchronous loop blocks both business deadlines and supervision callbacks.

## Native controls and pool

`host.coroutine.members` provides list/get/stop/kill/restart/replace/on/watch. Select an actual registered name or current instance ID. Replacement spec is `{ task: nextTask }`; the original transaction handles old/new generations. Cooperative stop is not preemption, and a control result does not establish that arbitrary synchronous code can be interrupted.

Install `pool(...)` in transport.features. Every member is a separate real task; only logical target pool enters the directory, and each operation selects one member. Use the same namespace.members for resource administration, without treating private native IDs as direct business targets. See the [Pool guide](../rpc-plugin-pool/USEGUIDE.en.md).

## Observation, errors, and closure

Devtools is a flow plugin in Host plugins; its collector remains caller-owned. Custom deployment uses `@migaia/rpc-host/sdk`; probes use `@migaia/rpc-host/plugins/probe`. Neither requires reading private ports or constructing another handshake.

Invalid sources retain TypeError with rpc.transport.coroutine/COROUTINE_SOURCE_INVALID. Calls, handshakes, supervision, and cleanup keep their respective error graphs. Cancelling work, ending a stream, closing a Host, and ending a task are distinct responsibilities. Finish held work/streams, close the Host, and let the task respond to its original stop signal.
