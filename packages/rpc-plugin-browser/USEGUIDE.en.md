# Browser RPC guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Shared call rules](../rpc-host/USEGUIDE.en.md)

Applications supply actual native resources and normally select one transport per Host. The root owns identity, providers and closure; calls use the corresponding namespace. These complete modules are typechecked against public dist, not proof of native realms, authentication or full migration acceptance.

## Dedicated Worker

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function doubleInWorker(worker: Worker) {
  const host = await createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.worker.request('double', 21)
  } finally {
    await host.close()
  }
}
```

See README for the Worker module with Worker globals. Calls use `host.worker` by default; `namespace` can rename it. Host close never calls worker.terminate; the creator eventually terminates the native Worker. Native Node/Bun/Deno threads use the thread plugin rather than this browser resource boundary.

## Window and iframe

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'

export async function callFrame(target: Window, origin: string) {
  const host = await createRpcHost({
    plugins: [windowPlugin({ window: target, origin, receiver: window })]
  })
  try {
    return await host.window.request('title')
  } finally {
    await host.close()
  }
}
```

The other side targets this page and provides `title`. Configure target Window separately from the local receiver. Origin is required; a wildcard additionally requires `allowUnsafeTargetOrigin: true`. Actual source filtering does not read a rejected source's business payload; a claimed identity cannot bypass it.

Window drops messages sent before the opposite listener is installed, so its carrier declares `startupMessagesMayBeLost: true`. The initiator with the smaller id resends its original hello once after receiving its first peer hello. The responder reuses the original candidate or session for repeated hellos from that peer. Other reliable carriers send no additional handshake frames.

## SharedWorker ports

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function readSharedValue(worker: SharedWorker) {
  const host = await createRpcHost({
    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]
  })
  try {
    return await host.sharedWorker.request('value')
  } finally {
    await host.close()
  }
}
```

A page borrows sharedWorker.port; the Worker uses `sharedWorkerPlugin({ listen: self })`. These sources are exclusive. Native connect events supply each port for its own session. Host closure does not close borrowed ports or terminate the shared Worker.

## BroadcastChannel participants

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function listenOnChannel(channel: BroadcastChannel) {
  return createRpcHost({
    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],
    provide: { double: (value: number) => value * 2 }
  })
}
```

The caller eventually awaits host.close, then closes its own channel. Discovery/handshake determine RPC membership; native broadcasting does not admit every message as business. `host.broadcastChannel.request` uses the current set and `send` selects a direct peer. Neither an empty set nor reconnect downtime establishes business completion. The native API has no transfer list.

Even when the first broadcast join is lost before another participant exists, the later participant broadcasts its own join. The existing listener replies with a targeted join before sending semantic hello. Ordered delivery from that native sender installs the remote route first. This reuses existing discovery without another semantic-hello retry.

## ServiceWorker target and receiver

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function askServiceWorker(worker: ServiceWorker) {
  const host = await createRpcHost({
    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]
  })
  try {
    return await host.serviceWorker.request('version')
  } finally {
    await host.close()
  }
}
```

`serviceWorker` is the send target; `receiver` owns local subscription, defaulting to navigator.serviceWorker on a page. A Worker uses `serviceWorkerPlugin({ clients: self })`, resolving actual event source.id through clients.get. The plugin does not register, update or unregister the Worker.

## Reliable RTCDataChannel

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function callRtc(channel: RTCDataChannel) {
  const host = await createRpcHost({
    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]
  })
  try {
    return await host.rtcDataChannel.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

The application completes signaling and opens the channel first. Require ordered true and null maxRetransmits/maxPacketLifeTime. The plugin neither waits for WebRTC signaling nor accepts unreliable/partially reliable settings. Host owns only its RPC subscriptions and does not close the borrowed channel. This path uses JSON text without native transfer.

## WebTransport reliable bytes

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'

export async function callReliableSession(session: IWebTransportPluginOptions['session']) {
  const host = await createRpcHost({
    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.webTransport.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

The plugin awaits the borrowed session's ready and creates one reliable bidirectional stream. The peer must implement the matching `migaia.rpc/2` byte carrier; an HTTP handler, arbitrary JSON text or datagrams are not that protocol. Host releases its reader/writer and locks without calling the borrowed session.close. Native backing transfer is unsupported.

## Features and intervention plugins

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { probe } from '@migaia/rpc-host/plugins/probe'

export async function observeFrame(target: Window, origin: string) {
  const observer = probe({
    stages: ['peer'],
    emit(view) {
      console.log(view.lifecycle)
    }
  })
  return createRpcHost({
    plugins: [observer, windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] })]
  })
}
```

The caller closes the returned Host. Timeout/retry are complete transport-selected business features in that factory's `features`. Probe/schema/auth/chunk/batch/typegen are actual host intervention plugins under `@migaia/rpc-host/plugins/*`, installed before startup. `connect.timeoutMs` bounds handshake only; per-call timeoutMs and signal concern business work. Cancellation does not prove remote non-execution.

Optional extensions such as outcome require their actual plugin. Automatic claim, identity scope and replay across reconnects remain incomplete. Do not restore root Host policy fields, deployment assemblers, manual profile/ACKs or casts of unsupported options.

## Responsibilities and current limits

Contract owns pure protocol/capability types/error contracts, Host owns calls/sessions, and Browser owns native sources/I/O. `/plugins/schema` performs business validation. Custom carrier authors use canonical carriers from `@migaia/rpc-host/sdk`, without another Host or codec.

Native origin/source checks do not establish completed auth verification/principal/session wiring. Host close/drain, restart downtime and parts of observer diagnostic compatibility retain known differences; this guide does not claim they are closed. Mixing transports usually adds routing/permission ambiguity; prefer separate Hosts.

Retain native types, `source/code/cause/errors` and stacks for browser and shared RPC errors. Do not rebuild errors to discard causes or infer business completion from successful sending. Applications release their Workers, ports, channels and sessions; Host releases only its own resources.
