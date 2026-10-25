# Process plugin usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

A Host normally selects one transport kind. The root owns `self/provide/close`; calls live under a namespace, `process` by default. These complete TypeScript modules are checked against current public dist, not proof of native-environment or authentication acceptance.

## Bidirectional local connections

Both sides of a connection may provide methods. This Node/POSIX named-service example demonstrates calls without asserting completed service authentication.

```ts doc-test=check
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

const address = 'service-' + randomUUID()
const server = await createRpcHost({
  plugins: [processPlugin({ listen: address })],
  provide: { double: (value: number) => value * 2 }
})
try {
  const client = await createRpcHost({
    self: { name: 'client-a', instanceId: randomUUID() },
    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],
    provide: { clientValue: (value: string) => 'client:' + value }
  })
  try {
    console.log(await client.process.request('double', 21))
    console.log(await server.process.send('client-a', 'clientValue', 'ready'))
  } finally {
    await client.close()
  }
} finally {
  await server.close()
}
```

Untargeted `request` uses the current namespace's direct targets, retaining per-target results for several peers. `send(nameOrId, method, payload)` selects one current direct peer. A business stream owns its iterator/cancellation, not the entire native process. Empty-session calls during restart still differ from the old downtime error; an empty set does not indicate completed recovery.

## Complete feature instances and probe

Native capacities, FIFO and logging belong to Process. This installs one flow and lends it to queue/log. Timeout is a transport-selected business feature; probe is a host intervention plugin installed before transport startup.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { probe } from '@migaia/rpc-host/plugins/probe'

export async function openWorker(entry: URL) {
  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })
  const observer = probe({
    stages: ['peer'],
    emit(view) {
      console.error(view.lifecycle)
    }
  })
  return createRpcHost({
    plugins: [
      observer,
      processPlugin({
        spawn: entry,
        features: [
          flow,
          sendQueue({ flow }),
          ipcLog({
            report(record) {
              console.error(record)
            }
          }),
          timeout({ ms: 1500 })
        ]
      })
    ]
  })
}
```

The caller eventually awaits `host.close()`. A standalone `flowControl` is supported, and `sendQueue` may own a default flow. Supplying an explicit flow alongside duplicate capacity fields fails during cold configuration. These are not host-root configuration switches; the old `ipc.log` fallback field is removed. Logging alone does not enable throttling.

`/features/send-queue`, `/features/flow-control` and `/features/log` expose their corresponding factories. Cancellation and capacity use actual installed owners. Per-logical-call accounting with batch remains unverified. Capacity rejection retains `OVERLOADED`; actual physical I/O failure uses `TRANSPORT` with its original cause.

## Options and deadlines

`connect: { target, timeoutMs? }` selects an existing service; timeout-only connect also decorates spawn/listen/parent. Negotiation defaults to 10,000 ms; name admission then uses `connect.timeoutMs`, also 10,000 ms by default. `pending` carries the unspent negotiation time plus this one name-probe budget; only the first notice extends the deadline, and repeated notices never refresh it. `connectTimeoutMs` bounds named-local discovery. Business calls use a complete `timeout(...)` feature or `timeout: false`, with an optional `signal`; these deadlines remain independent.

Spawn accepts the main entry, a path/URL, short options or a complete native recipe. See README for self-spawn. Native `supervision` retains restart, health and stop policy; reconnection does not replay unconfirmed work. stdout belongs to stdio RPC; application logs use stderr.

Automatic verification/principal, session/scope across reconnects and parts of native auth wiring remain incomplete. A token, environment value, claimed identity or client ID is not admission proof. Select actual `/plugins/auth`, `/plugins/schema`, `/plugins/chunk`, `/plugins/batch` and `/plugins/typegen` when needed. These are neither Contract internals nor transport configuration fields. Flow plugins install before transport startup; adding them afterward rejects.

## Native members and ordinary PluginHost

Use `host.process.members` for queries and controls. `list/get` return safe native-source descriptions; `on/watch` observe actual events. `stop/kill/restart/replace` depend on genuine ownership. Connecting to an external service does not grant remote process control.

```ts doc-test=check
import { PluginHost } from '@migaia/plugin-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

export async function installAndRelease(entry: URL) {
  const owner = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 }
  })
  try {
    await owner.use(processPlugin({ name: 'worker', spawn: entry }))
  } finally {
    await owner.dispose()
  }
}
```

The same cold definition installs on the actual PluginHost without creating another Host. Ordinary `expose` names real installed Features through an explicit allowlist; calls still use the process namespace. Custom carriers use `@migaia/rpc-host/sdk`, without a retired assembler or endpoint-returning source.

## Closure and errors

Real supervisors stop owned children; borrowed services release only the local connection. Closing a listener grants no authority to terminate client processes. `close()` requests cleanup; do not assume every accepted operation drains successfully. Host close order versus original drain behavior remains unresolved.

Startup failures retain the actual channel-close, connection-failure or native `EPIPE` phase without promising two identical coded shells. Follow `cause/errors` rather than a fixed depth. `timeout: false` adds no Process business-call deadline; native startup, health and stop budgets remain separate.

Same-name admission diagnostics retain a failing oracle; a generic startup wrapper does not satisfy the original error contract. Use unique application identities rather than deriving remote identity from a registration name. Retain `source/code/cause/errors`, native types and stacks. An unknown result does not prove non-execution; recovery does not establish idempotent replay or persistent outcomes.

`@migaia/rpc-contract` owns pure data, types, errors and protocol admission. Actual plugins/features own business schema and policy, Process owns native resources, and Host owns call lifetime. Full migration acceptance remains pending.
