# `@migaia/rpc-plugin-browser`

Connect actual Windows, Workers, BroadcastChannels, reliable RTCDataChannels or WebTransport to RPC. Applications create native objects; Browser owns native sources/I/O, and Host owns sessions, directories and calls.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-browser
```

This page borrows a module Worker and calls the default `worker` namespace. The actual `worker.ts` entry calls `startWorker(self)` from the Worker module below, then compiles to `worker.js`.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
try {
  const host = await createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.worker.request('double', 21))
  } finally {
    await host.close()
  }
} finally {
  worker.terminate()
}
```

The separate Worker module accepts the actual native source. Compile the real `worker.ts` entry with Worker globals and call `startWorker(self)`:

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin, type IWorkerPluginOptions } from '@migaia/rpc-plugin-browser'

/** Borrow the actual Worker global; the application keeps its native lifetime. */
export function startWorker(worker: IWorkerPluginOptions['worker']) {
  return createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker })],
    provide: { double: (value: number) => value * 2 }
  })
}
```

After the Worker provides `double`, the compatible page call can receive `42`. Applications own the address, creation, deployment and eventual termination. These examples receive public-dist typechecking, not cross-realm runtime acceptance.

## Seven factories and default namespaces

| Factory                  | Source options                                        | Default namespace  |
| ------------------------ | ----------------------------------------------------- | ------------------ |
| `windowPlugin`           | `{ window, origin, receiver? }`                       | `window`           |
| `dedicatedWorkerPlugin`  | `{ worker }`                                          | `worker`           |
| `sharedWorkerPlugin`     | `{ sharedWorker }` or `{ listen: self }`              | `sharedWorker`     |
| `broadcastChannelPlugin` | `{ channel }`                                         | `broadcastChannel` |
| `serviceWorkerPlugin`    | `{ serviceWorker, receiver? }` or `{ clients: self }` | `serviceWorker`    |
| `rtcDataChannelPlugin`   | `{ rtcDataChannel }`                                  | `rtcDataChannel`   |
| `webTransportPlugin`     | `{ session }`                                         | `webTransport`     |

Common options include `name`, `namespace`, `expose`, `connect: { timeoutMs }` and complete business `features`. SharedWorker/ServiceWorker source alternatives are exclusive. Root exports are these factories, their option types, `RpcBrowserErrorCode` and `RPC_BROWSER_ERROR_SOURCE`.

Prefer one transport kind per Host rather than mixed media. Several ports or participants may belong to that one kind. If mixing is necessary, define namespaces, routing and permissions explicitly; heterogeneous media are not a homogeneous member pool.

## Calls and sources

The root owns `self/provide/close`; actual namespaces such as `host.worker` or `host.window` expose `request/notify/stream/group`. `send(nameOrId, method, payload)` selects one current direct peer. Untargeted calls use that namespace's current direct set. Extensions such as `outcome` require their corresponding plugin.

Window binds actual `event.source` and an explicit origin; `'*'` also needs `allowUnsafeTargetOrigin: true`. ServiceWorker admission uses native sources and Client lookup, never a client ID claimed in payload. BroadcastChannel names are not peer identities; discovery and protocol handshake are still required.

## Ownership and protocol

Host closure withdraws its subscriptions/sessions without terminating borrowed Workers, MessagePorts, BroadcastChannels, RTCDataChannels or WebTransport sessions. WebTransport owns only its created reliable bidirectional stream, reader/writer and locks; it uses no datagrams. Applications release their own native objects.

The only profile is `migaia.rpc/2`. `@migaia/rpc-contract/protocol` provides pure protocol data/admission, `/interfaces` capability types, and `/errors` plus `/error-code` error contracts. Contract performs no business schema execution, I/O or policy. Custom carriers use canonical carriers from `@migaia/rpc-host/sdk`. Actual `/plugins/*` provide business validation and other intervention, rather than hidden transport switches.

Native structured clone and explicit ownership transfer are separate capabilities. BroadcastChannel, RTC and WebTransport do not expose the native transfer required by these plugins. Window/Worker transfer still depends on actual media and installed policies.

## Current boundaries

Native source filtering does not establish an authenticated principal or session/scope across reconnects. Automatic auth/source freshness, parts of outcome/idempotency and observer diagnostic compatibility remain unresolved. Neither a channel name nor a native source automatically supplies those guarantees. Generic Host close/drain and restart downtime differences are not browser guarantees either.

Failures may originate from `rpc.transport.browser` or shared RPC owners. Retain `source/code/cause/errors` and native stacks; text or one code alone does not establish execution outcome. Full migration acceptance remains pending. See the [usage guide](./USEGUIDE.en.md).
