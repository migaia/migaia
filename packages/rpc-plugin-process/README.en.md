# `@migaia/rpc-plugin-process`

Connect real child processes, local connections and listeners to RPC. Process owns native launch, byte/message I/O, supervision and resource release; Host owns sessions, method directories and calls.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-process
```

Save this self-spawn example as a standalone ESM entry. Node 24 can execute TypeScript directly; compile for other environments as required. Parent calls use `host.process`; the child checks its role before spawning anything.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'

if (await isProcessChild()) {
  await createRpcHost({
    plugins: [processPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const host = await createRpcHost({
    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.process.request('double', 21))
  } finally {
    await host.close()
  }
}
```

The child provides `double`; after a compatible peer completes the handshake, the parent receives `42`. In stdio mode stdout belongs to the protocol; child application logs use stderr. This demonstrates calls, not external-service authentication configuration.

## Sources and ownership

`processPlugin(options)` selects exactly one source. The default namespace is `process`; `namespace` can change it.

| Source               | Configuration                                       | Ownership                                           |
| -------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Child process        | `spawn: true`, entry path/URL or full native recipe | Owns the launched child                             |
| Existing service     | `connect: { target: nameOrAddress, timeoutMs? }`    | Owns the local connection, not the external process |
| Listener             | `listen: nameOrListener`                            | Owns listener and accepted local sessions           |
| Child joining parent | `connectToParent: true`                             | Uses actual native bootstrap and parent I/O         |

Handshake negotiation and name admission have separate deadlines, each defaulting to 10,000 ms. A timeout-only `connect: { timeoutMs }` also sets name admission for the other sources. A waiting peer follows the remaining budget in `pending`; repeated notices never refresh it. Worst-case waiting approaches the sum of both phases. Short options include `entry`, `command/args`, `cwd`, explicit environment, `wrap`, native limits and `supervision`. Actual limits depend on the runtime; configuration does not grant native isolation.

Prefer one transport kind per Host; it may have many sessions. If different transports must share a Host, use distinct namespaces and explicit routing and permissions. They are not a homogeneous member pool.

## Current API

Runtime root exports are `processPlugin`, `isProcessChild`, `RpcProcessErrorCode` and `RPC_PROCESS_ERROR_SOURCE`, alongside option/native-source types. `name` is local registration identity, `namespace` selects the call surface, and `expose` is an ordinary PluginHost's explicit local Feature allowlist.

Use `host.process.request/notify/stream/group` and targeted `host.process.send`. The root retains `self`, `provide` and `close`, without those call methods. Native member queries, controls and events live under `host.process.members`: `list/get/stop/kill/restart/replace/on/watch`. Borrowing a connection does not authorize terminating its external process.

`/features` exports complete-instance factories `sendQueue`, `flowControl` and `ipcLog`; pass instances to `processPlugin({ features })`. `sendQueue({ flow })` can borrow that same flow instance without another capacity policy. Business timeout/retry are also selected through transport `features`. Host intervention plugins use `@migaia/rpc-host/plugins/*` and install before transports.

## Protocol and extension ownership

The sole profile is `migaia.rpc/2`. `@migaia/rpc-contract/protocol` provides pure protocol data and admission; `/interfaces` provides capability types, and `/errors` plus `/error-code` provide error contracts. Contract performs no I/O, business schema validation or supervision. `/plugins/schema` owns business validation. Custom carrier authors use `@migaia/rpc-host/sdk` and canonical carriers rather than returning another Host or endpoint.

## Current boundaries

A native token/bootstrap does not establish completed automatic verification, principal identity or authenticated scope across reconnects; these boundaries have unresolved items. Do not infer trusted identity or safe business replay. Host close versus accepted-work drain, untargeted errors during restart downtime and same-name admission diagnostics retain known behavioral differences. IPC capacity rejection retains `OVERLOADED`; actual physical I/O failure retains `TRANSPORT` with its original cause. Admission failure does not mean a write happened.

A startup channel may directly report `PROCESS_CHANNEL_CLOSED` at the actual close phase. Native failures such as `EPIPE` remain reachable without requiring two nested wrappers carrying the same code. Business `timeout: false` disables the selected business deadline and adds no Process call cap.

Inspect `source/code/cause` and retain native causes. Full migration acceptance remains pending; these differences are not implementation guarantees. See the [usage guide](./USEGUIDE.en.md).
