# `@migaia/rpc-plugin-process`

Provide real child processes, local service connections, and multi-session listeners to `createRpcHost`. Native process owners retain launch, authentication, recovery, and release.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Why use it

- One session supports requests in both directions, notifications, streams, and provider directories.
- `spawn` owns a child, `connect` owns only its session, and `listen` owns its listener and accepted sessions.
- Existing supervisors retain generations, restart, resource budgets, and exit observation. Reconnection does not make business replay safe.
- Explicit addresses can reach independent services implementing the same authentication and protocol. JSON-RPC uses reliable bytes and Content-Length framing.

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-process
```

This example uses a same-user named local service on Node/POSIX. Each host has one transport plugin; the server can still accept multiple independent clients.

```ts doc-test=run
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

const name = 'reader-' + randomUUID()
const server = await createRpcHost({
  plugins: [processPlugin({ listen: name })],
  provide: { double: (value: number) => value * 2 }
})
try {
  const client = await createRpcHost<{ double(value: number): number }>({
    plugins: [processPlugin({ connect: { target: name, timeoutMs: 1500 } })]
  })
  try {
    console.log(await client.request('double', 21))
  } finally {
    await client.close()
  }
} finally {
  await server.close()
}
```

It prints `42`. Closing a client withdraws its connection; the external service remains owned by its creator.

## Choose a source

`processPlugin(options)` requires exactly one source below. A timeout-only `connect: { timeoutMs }` can also decorate the other modes.

| Source                   | Configuration                                          | Ownership                                                                |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Launch a child           | `spawn: true`, entry path/URL, or launch configuration | The host stops its own child                                             |
| Existing service         | `connect: { target: nameOrAddress, timeoutMs? }`       | Releases only the session                                                |
| Independent clients      | `listen: nameOrListener`                               | Owns listener and accepted sessions                                      |
| Child joining its parent | `connectToParent: true`                                | Reads the actual stdin bootstrap, never an inferred environment identity |

For a self-spawned entry, branch on `await isProcessChild()`: the child uses `processPlugin({ connectToParent: true })`, the parent `processPlugin({ spawn: true })`. Place application `provide`, `self`, call defaults, and authentication on `createRpcHost`; ordinary plugin-host installations can retain those values in local plugin configuration.

Short launch options include entry, command/args, cwd, explicit env, wrap, native limits/permissions, and supervision. `wrap` rewrites the original command once per actual launch. An explicit command runs without a shell. Adapters do not grant isolation or termination capabilities missing from their native platform.

## Calls and recovery

Untargeted `host.request / notify / stream / group / outcome` use current direct targets. Use `host.send(clientName, method, payload)` for one target, or a notification's `targetId`. With providers on both sides, calls interleave on the same session. One client disconnecting does not retire other clients.

`connect.timeoutMs` bounds handshake preparation. Top-level `connectTimeoutMs` bounds named-local rendezvous; they are independent. Initial named-source discovery can wait for the service; initial explicit-address dialing does not use that rendezvous loop. The existing supervisor still owns recovery after an established session disconnects, including an explicit socket service restarting. In stdio mode stdout belongs to the RPC byte channel; send application logs to stderr.

Explicit socket/TCP addresses require matching credentials and protocol. Default credentials for same-user named endpoints depend on local OS isolation. JSON-RPC needs an actual contract or custom establish callback; an arbitrary JSON text service is not automatically compatible. Copying credentials, bootstrap shapes, or private handles does not grant trusted identity.

## Features and platform entries

| Entry                                                         | Purpose                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Root                                                          | `processPlugin`, `isProcessChild`, options, and error identity                                               |
| `/features`                                                   | `sendQueueFeature`, `ipcLogFeature`, and original flow-control constants/types configure existing IPC owners |
| `/adapters/node-child-process`, `/adapters/node-socket`       | Native Node process and socket                                                                               |
| `/adapters/bun-spawn`, `/adapters/bun-socket`                 | Native Bun launch and socket                                                                                 |
| `/adapters/deno-command`, `/adapters/deno-socket`             | Native Deno launch and socket                                                                                |
| `/adapters/electron-utility-process`, `/adapters/windows-job` | Electron utility processes and Windows Jobs                                                                  |

Install shared deadlines, authentication, chunking, retry, and type generation from [rpc-host/features](../rpc-host/README.en.md#choose-transport-and-features). Process-specific features override their matching IPC fields without creating another logging or sending queue.

## Errors and lifetime

Native process boundary failures use `rpc.transport.process`; host admission/calls can use `rpc.endpoint`, and managed uncertainty can use `rpc.remote`. Inspect source/code and original causes. Sending does not establish completion; reconcile uncertain non-idempotent work before retrying.

A responsive same-name client rejects a candidate with `HOST_PEER_NAME_DUPLICATE`. Closed or failed old sessions retire normally before the candidate is admitted, without adding a background heartbeat.

Definitions also install directly on ordinary `PluginHost`. Its process outlet retains stop, restart, kill, replace, generations, exits, and the original close Promise. Real installation owners perform cleanup; an external service is not an owned child. See the [usage guide](./USEGUIDE.en.md).
