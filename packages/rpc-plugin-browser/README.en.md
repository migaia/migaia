# `@migaia/rpc-plugin-browser`

Connect real browser carriers to `createRpcHost`: Window, Dedicated/Shared/Service Workers, BroadcastChannel, reliable RTCDataChannel, and WebTransport.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Why use it

- Every carrier uses the host's bidirectional calls, directory, deadlines, cancellation, and error representation.
- Window binds the actual sender and explicit origin; ServiceWorker separates the sending target from the receiving owner.
- SharedWorker, BroadcastChannel, and ServiceWorker accept independent sessions while each host still uses one call endpoint.
- Workers, ports, channels, and sessions stay application-owned; closing RPC does not terminate borrowed resources.

## Start here

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-browser
```

Create an actual module Worker in the page. `worker.js` is the compiled address of the separate Worker entry below.

```ts
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
try {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.request('double', 21))
  } finally {
    await host.close()
  }
} finally {
  worker.terminate()
}
```

Compile this separate `worker.ts` entry with Worker globals and module settings:

```ts
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

await createRpcHost({
  plugins: [dedicatedWorkerPlugin({ worker: self })],
  provide: { double: (value: number) => value * 2 }
})
```

The page prints `42`. Both sides need a compatible RPC protocol. The application owns the Worker address, construction, and final termination.

## Seven carriers

| Factory                  | Actual source                                             | Behavior                                                                                                                      |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `windowPlugin`           | `{ window, origin, receiver? }`                           | Window/iframe peer; origin is required, and `'*'` also requires `allowUnsafeTargetOrigin: true`                               |
| `dedicatedWorkerPlugin`  | `{ worker }`                                              | A page Worker or worker-side `self`, using the original EventTarget carrier                                                   |
| `sharedWorkerPlugin`     | `{ sharedWorker }` **or** `{ listen: self }`              | The page borrows sharedWorker.port; the worker accepts ports from native connect events                                       |
| `broadcastChannelPlugin` | `{ channel }`                                             | Borrows a real BroadcastChannel and discovers/handshakes each participant                                                     |
| `serviceWorkerPlugin`    | `{ serviceWorker, receiver? }` **or** `{ clients: self }` | The page targets a real worker, receiving through navigator.serviceWorker by default; worker-side sessions use real Client.id |
| `rtcDataChannelPlugin`   | `{ rtcDataChannel }`                                      | Requires ordered=true and null maxRetransmits/maxPacketLifeTime                                                               |
| `webTransportPlugin`     | `{ session }`                                             | Awaits existing session.ready and creates one reliable bidirectional byte stream; no datagrams                                |

Common options are `name`, `expose`, and `connect: { timeoutMs }`. SharedWorker and ServiceWorker source alternatives are mutually exclusive. Ordinary objects or client IDs claimed inside payloads do not establish accepted source identity.

## Targets, sources, and calls

Both sides of a session can `provide` and use `request`, `notify`, `stream`, `group`, and `outcome`. With multiple peers, untargeted calls broadcast using the [host result rules](../rpc-host/README.en.md#calls-and-targets); `send(nameOrId, method, payload)` selects a current direct peer.

BroadcastChannel participants must finish discovery and handshake; the channel name is not a peer identity. ServiceWorker's `serviceWorker` is the sending target, while `receiver` owns message subscription. Its worker-side source resolves the native Client from the real event source/Client.id before RPC handshake. Window checks both origin and actual event.source. `connect.timeoutMs` bounds preparation; business methods do not run before acceptance.

WebTransport's server must implement the same reliable byte RPC protocol. The plugin owns only its created stream: close releases reader/writer resources and locks without calling the borrowed session's close. Unreliable datagram RPC is not supported.

## Ownership, errors, and extension

`await host.close()` withdraws the host's receivers and logical sessions. The application still owns Workers, MessagePorts, BroadcastChannels, RTCDataChannels, and WebTransport sessions it created. Closing a SharedWorker listener does not terminate the shared Worker, and retiring one session does not close others.

Native structured clone does not automatically permit RPC ownership transfer. Transfer depends on actual session capabilities and authentication. BroadcastChannel has no transfer list. Failures retain original causes; clone support does not promise arbitrary lossless JavaScript graph transfer.

Browser source/carrier errors use `rpc.transport.browser`; general handshake/call errors can use `rpc.endpoint` or `rpc.remote`. Inspect source/code/cause. Missing sources, missing Window origins, and unreliable RTC settings reject at their original admission boundary.

The root exports seven plugins, options, and error identity. `/adapters/window`, `shared-worker`, `service-worker`, `broadcast-channel`, `web-transport`, `rtc-data-channel`, `message-port`, and `web-worker` remain author entries for explicit lower-level carrier work. Applications install the matching plugin directly on a host. See the [usage guide](./USEGUIDE.en.md).
