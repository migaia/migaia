# Process plugin usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

Choose a process source, then install the actual processPlugin on createRpcHost. The host owns providers, calls, and unified closure; native owners retain launch, sockets, authentication, supervision, and drain.

## Execute in a real child and close it

Save this as a standalone ESM entry. Node 24 can run TypeScript directly; other toolchains compile first. A self-spawned entry checks isProcessChild before parent work, with explicit connectToParent on the child to prevent recursive spawning.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'

if (await isProcessChild()) {
  await createRpcHost({
    plugins: [processPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.request('double', 21))
  } finally {
    await host.close()
  }
}
```

The parent prints 42. spawn:true selects the actual main entry; a path/URL selects another entry. Short options also support command/args, cwd, env, wrap, limits, permissions, and supervision. Explicit commands run without a shell; wrap transforms the original command once per launch. stdout belongs to stdio RPC; application logs use stderr.

## Bidirectional sessions and multiple clients

This Node/POSIX same-user named-service example interleaves methods in both directions on one session:

```ts doc-test=check
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

const address = 'service-' + randomUUID()
const server = await createRpcHost<{ clientValue(value: string): string }>({
  plugins: [processPlugin({ listen: address })],
  provide: { double: (value: number) => value * 2 }
})
try {
  const client = await createRpcHost<{ double(value: number): number }>({
    self: { name: 'client-a', instanceId: randomUUID() },
    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],
    provide: { clientValue: (value: string) => 'client:' + value }
  })
  try {
    const values = await Promise.all([
      client.request('double', 21),
      server.send('client-a', 'clientValue', 'ready')
    ])
    console.log(values)
  } finally {
    await client.close()
  }
} finally {
  await server.close()
}
```

After a separate client-b joins, server.request('clientValue',value) broadcasts and retains fulfilled/rejected per target identity. send('client-a',...) selects only that current direct client. Streams have independent target iterators. Closing a client releases its session, not the service or other clients; server.close releases its listener and sessions.

## Credentials, addresses, and preparation budgets

Use connect:{target:nameOrAddress,timeoutMs?}, with target inside connect. spawn/listen/connectToParent can also carry timeout-only connect settings. connect.timeoutMs bounds real handshake preparation; top-level connectTimeoutMs bounds named-local rendezvous. Initial explicit-address dialing does not use the rendezvous loop. The original supervisor still owns established-session recovery, including an explicit socket service restarting.

Same-user named endpoints retain original OS isolation and credentials. Explicit socket/TCP services need matching token, protocol, and service policies. Environment values or fabricated bootstrap objects do not establish trusted source identity. connectToParent reads actual stdin bootstrap only in a genuine child, before constructing the one call endpoint.

wire:'jsonrpc' uses Content-Length byte framing and needs an actual contract or establish callback. Foreign services must implement matching protocol, authentication, capabilities, and descriptions; printing arbitrary JSON is insufficient.

## Existing IPC features and business deadlines

```ts doc-test=check
import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'
import timeoutFeature from '@migaia/rpc-host/features/timeout'

export const features = [
  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),
  ipcLogFeature({
    report: (record) => {
      console.log(record)
    }
  }),
  timeoutFeature({ ms: 1500 })
]
```

Spread features into host.plugins alongside exactly one processPlugin. sendQueueFeature configures existing maxPendingData/maxPendingControl; ipcLogFeature supplies the original log sink. Omitted fields retain original configuration. The flow-control entry exports existing lane/event values and types, not another factory. Each definition installs at most once per host.

Calls accept signal, timeoutMs, and idempotencyKey. Business deadlines are independent of handshake and rendezvous. Cancellation is cooperative; disconnection does not prove that work never executed. Declare actual idempotency and check storage/identity scope before using retry. Reconnection under the same authenticated principal can reuse the original scope/store; different principals stay isolated.

## Install on an existing PluginHost

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

This installs a genuine definition instead of returning another complete call object as a source. The process outlet retains stop/restart/kill/replace, native exit, notices, and generations. name is local installation identity, separate from remote self.name. Services and tray retain their original outlet controls rather than bypassing replacement or leases.

## Closure, failures, and platforms

Existing drain handles accepted requests/providers/streams before releasing a listener or owned child. Closing cannot publish a late unaccepted candidate, and cleanup failure cannot replace the primary. Native/cause/errors remain traceable. A borrowed service releases only this session, not its process. Repeated closure shares the original Promise; a terminate request is not native exit.

Responsive same-name sessions reject a candidate with HOST_PEER_NAME_DUPLICATE. A dead session or failed/expired original ping retires normally before admission, without a background heartbeat. Missing business targets use TARGET_UNKNOWN; reconcile uncertain work before retrying.

Native errors use rpc.transport.process; host/call and managed failures can retain rpc.endpoint/rpc.remote. Branch on source/code rather than text and preserve native TypeError/AbortError and the whole cause chain. Node/Bun/Deno, Electron utility process, and Windows Job behavior depends on real adapter capabilities; permissions/limits do not invent native isolation.
