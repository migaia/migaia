# Browser RPC guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Shared call rules](../rpc-host/USEGUIDE.en.md)

Applications supply actual native resources and normally select one transport per Host. The root owns identity, providers and closure; calls use the corresponding namespace. The examples below are only typechecked; real cross-page origins and authentication must be verified in a browser.

## Find by scenario

Jump to the section for what you want to do:

- [Dedicated Worker](#dedicated-worker)
- [Window and iframe](#window-and-iframe)
- [SharedWorker ports](#sharedworker-ports)
- [BroadcastChannel participants](#broadcastchannel-participants)
- [ServiceWorker target and receiver](#serviceworker-target-and-receiver)
- [Reliable RTCDataChannel](#reliable-rtcdatachannel)
- [WebTransport reliable bytes](#webtransport-reliable-bytes)
- [Features and intervention plugins](#features-and-intervention-plugins)
- [Responsibilities and current limits](#responsibilities-and-current-limits)

## Dedicated Worker

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
// Connect once when the page starts; every later call reuses this host
const host = await createRpcHost({
  plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
})

export function double(value: number) {
  return host.worker.request('double', value)
}

// When the Worker is no longer needed: close the host, then terminate the Worker you created
export async function stopWorker() {
  await host.close()
  worker.terminate()
}
```

See README for the Worker module with Worker globals. Calls use `host.worker` by default; `namespace` can rename it. Host close never calls worker.terminate; the creator eventually terminates the native Worker. Native Node/Bun/Deno threads use the thread plugin rather than this browser resource boundary.

## Window and iframe

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'

const frame = document.querySelector('iframe')!
// Connect once after the iframe loads; every later call reuses this host
const host = await createRpcHost({
  plugins: [
    windowPlugin({
      window: frame.contentWindow!,
      origin: 'https://child.example.com',
      receiver: window
    })
  ]
})

export function frameTitle() {
  return host.window.request('title')
}
```

The other side targets this page and provides `title`. Configure target Window separately from the local receiver. Origin is required; a wildcard additionally requires `allowUnsafeTargetOrigin: true`. Actual source filtering does not read a rejected source's business payload; a claimed identity cannot bypass it.

Window drops messages sent before the opposite listener is installed, so its carrier declares `startupMessagesMayBeLost: true`. The initiator with the smaller id resends its original hello once after receiving its first peer hello. The responder reuses the original candidate or session for repeated hellos from that peer. Other reliable carriers send no additional handshake frames.

## SharedWorker ports

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'

const shared = new SharedWorker(new URL('./shared.ts', import.meta.url), { type: 'module' })
// Each page connects once; all pages share one SharedWorker
const host = await createRpcHost({
  plugins: [sharedWorkerPlugin({ sharedWorker: shared })]
})

export function readSharedValue() {
  return host.sharedWorker.request('value')
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

const registration = await navigator.serviceWorker.ready
// Connect to the active Service Worker once when the page starts, then reuse it
const host = await createRpcHost({
  plugins: [
    serviceWorkerPlugin({
      serviceWorker: registration.active!,
      receiver: navigator.serviceWorker
    })
  ]
})

export function serviceWorkerVersion() {
  return host.serviceWorker.request('version')
}
```

`serviceWorker` is the send target; `receiver` owns local subscription, defaulting to navigator.serviceWorker on a page. A Worker uses `serviceWorkerPlugin({ clients: self })`, resolving actual event source.id through clients.get. The plugin does not register, update or unregister the Worker.

## Reliable RTCDataChannel

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'

// Call once after signaling has opened the channel; call the returned object as often as needed
export async function connectPeer(channel: RTCDataChannel) {
  const host = await createRpcHost({
    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]
  })
  return {
    echo: (text: string) => host.rtcDataChannel.request('echo', text),
    close: () => host.close()
  }
}
```

The application completes signaling and opens the channel first. Require ordered true and null maxRetransmits/maxPacketLifeTime. The plugin neither waits for WebRTC signaling nor accepts unreliable/partially reliable settings. Host owns only its RPC subscriptions and does not close the borrowed channel. This path uses JSON text without native transfer.

## WebTransport reliable bytes

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'

// Call once with the WebTransport session; call the returned object as often as needed
export async function connectSession(session: IWebTransportPluginOptions['session']) {
  const host = await createRpcHost({
    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]
  })
  return {
    echo: (text: string) => host.webTransport.request('echo', text),
    close: () => host.close()
  }
}
```

The plugin awaits the borrowed session's ready and creates one reliable bidirectional stream. The peer must implement the matching `migaia.rpc/2` byte carrier; an HTTP handler, arbitrary JSON text or datagrams are not that protocol. Host releases its reader/writer and locks without calling the borrowed session.close. Native backing transfer is unsupported.

## Features and intervention plugins

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { probe } from '@migaia/rpc-host/plugins/probe'

export async function observeFrame(target: Window, origin: string) {
  const observer = probe({
    stages: ['peer'],
    emit(view) {
      console.log(view.lifecycle)
    }
  })
  return createRpcHost({
    plugins: [
      observer,
      windowPlugin({ window: target, origin, features: { timeout: timeoutFeature({ ms: 1500 }) } })
    ]
  })
}
```

The caller closes the returned Host. Timeout/retry factories return native tokens for the transport's `features: { localName: feature }` record. Schema/auth/chunk/batch also assemble through a `defineFlowPlugin` `features` record or a transport record, with factories under `@migaia/rpc-host/features/*`; probe/typegen are host observer plugins under `@migaia/rpc-host/plugins/*`. `connect.timeoutMs` bounds handshake only; business calls use `timeout: { ms }` and `signal`. Cancellation does not prove remote non-execution.

Optional extensions such as outcome require their actual plugin. Automatic claim, identity scope and replay across reconnects remain incomplete. Do not restore root Host policy fields, deployment assemblers, manual profile/ACKs or casts of unsupported options.

## Responsibilities and current limits

Contract owns pure protocol/capability types/error contracts, Host owns calls/sessions, and Browser owns native sources/I/O. `/features/schema` performs business validation. Custom carrier authors use canonical carriers from `@migaia/rpc-host/sdk`, without another Host or codec.

Native origin/source checks do not establish completed auth verification/principal/session wiring. Host close/drain, restart downtime and parts of observer diagnostic compatibility retain known differences; this guide does not claim they are closed. Mixing transports usually adds routing/permission ambiguity; prefer separate Hosts.

Retain native types, `source/code/cause/errors` and stacks for browser and shared RPC errors. Do not rebuild errors to discard causes or infer business completion from successful sending. Applications release their Workers, ports, channels and sessions; Host releases only its own resources.
