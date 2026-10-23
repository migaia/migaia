# Browser RPC guide

[中文](./USEGUIDE.md) · [Overview](./README.en.md) · [Shared call rules](../rpc-host/USEGUIDE.en.md)

Create one `createRpcHost`, install one browser transport plugin, and add optional features. Your application supplies the native carrier. The plugin borrows it while the host owns its sessions, subscriptions, and calls.

## Dedicated Worker

Both page and Worker must run the compatible RPC protocol. This page helper borrows an existing Worker. Close the host before its creator eventually terminates the Worker.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function doubleInWorker(worker: Worker) {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.request('double', 21)
  } finally {
    await host.close()
  }
}
```

The Worker module uses `dedicatedWorkerPlugin({ worker: self })` and supplies `provide: { double: (value: number) => value * 2 }` to its own `createRpcHost`. Compile that file with Worker globals rather than casting a page Window into a Worker.

`host.close()` never calls `worker.terminate()`. Applications can reuse their native Worker and remain responsible for its eventual termination. This package owns browser Workers; [thread plugin](../rpc-plugin-thread/USEGUIDE.en.md) handles native Node, Bun, and Deno threads.

## Window and iframe

Configure the sending target separately from the local receiver. `origin` must be nonempty. Using `'*'` additionally requires `allowUnsafeTargetOrigin: true`. The carrier also checks the real `event.source`, so another iframe cannot supply this session's messages.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'

export async function callFrame(target: Window, origin: string) {
  const host = await createRpcHost<{ title(): string }>({
    plugins: [windowPlugin({ window: target, origin, receiver: window })]
  })
  try {
    return await host.request('title')
  } finally {
    await host.close()
  }
}
```

The other side targets this page and provides `title`. A claimed identity in a message never bypasses origin or source checks.

## SharedWorker ports

Pages use `sharedWorkerPlugin({ sharedWorker })`. The Worker uses `sharedWorkerPlugin({ listen: self })`. These sources are mutually exclusive. The listener accepts real MessagePorts from native connect events; ports handshake independently while the host retains one call endpoint.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function readSharedValue(worker: SharedWorker) {
  const host = await createRpcHost<{ value(): number }>({
    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]
  })
  try {
    return await host.request('value')
  } finally {
    await host.close()
  }
}
```

One departing session does not close other ports. Closing the host removes its subscriptions and logical sessions; it neither closes borrowed ports nor terminates the shared Worker. Native resources remain their creator's responsibility.

## BroadcastChannel participants

Pass a real `BroadcastChannel` to `broadcastChannelPlugin({ channel })` on each participant. Existing discovery and join/leave handshakes establish distinct sources. The channel name is not a peer identity, and native broadcast is not the accepted RPC target set.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function listenOnChannel(channel: BroadcastChannel) {
  const host = await createRpcHost({
    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],
    provide: { double: (value: number) => value * 2 }
  })
  return host
}
```

The caller eventually awaits host.close, then closes the channel according to its own ownership. With no current peers, untargeted calls follow the host's empty-set behavior. With several ready peers, broadcasts return per-target results. Default identity uses a unique instance ID; explicit duplicate names still use host arbitration. Direct calls can use a current name or peer ID. BroadcastChannel has no transfer list.

## ServiceWorker target and receiver

A page uses `serviceWorkerPlugin({ serviceWorker, receiver? })`. The actual worker is the send target; the default receiving surface is `navigator.serviceWorker`. A Worker uses `serviceWorkerPlugin({ clients: self })`. These sources are mutually exclusive.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function askServiceWorker(worker: ServiceWorker) {
  const host = await createRpcHost<{ version(): string }>({
    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]
  })
  try {
    return await host.request('version')
  } finally {
    await host.close()
  }
}
```

The worker resolves native event.source.id with clients.get(id) before accepting that Client's handshake. A client ID claimed inside the payload grants no source authority. One Client leaving does not close the others. This plugin does not register, update, or unregister the ServiceWorker.

## Reliable RTCDataChannel

`rtcDataChannelPlugin({ rtcDataChannel })` accepts an existing reliable ordered channel: ordered is true and maxRetransmits/maxPacketLifeTime are both null. Unreliable or partially reliable settings fail before business execution. Applications own WebRTC negotiation, connection establishment, and final channel.close; the host owns its RPC subscriptions.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function callRtc(channel: RTCDataChannel) {
  const host = await createRpcHost<{ echo(value: string): string }>({
    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]
  })
  try {
    return await host.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

## WebTransport reliable bytes

`webTransportPlugin({ session })` borrows an existing session, awaits ready, and creates exactly one reliable bidirectional stream. The server must implement the compatible reliable byte RPC protocol. An ordinary HTTP handler or datagram service is not that counterpart.

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'

export async function callReliableSession(session: IWebTransportPluginOptions['session']) {
  const host = await createRpcHost<{ echo(value: string): string }>({
    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

Closing the host cancels its reader, aborts its writer, and releases stream locks. It does not call the borrowed session.close. Handshake failure, cancellation, and normal close share that ownership. This transport uses no datagrams and does not equate closing its stream with closing the entire session.

## Calls, cancellation, and errors

Every carrier uses the same host request/notify/stream/group/outcome operations. Both sides can provide methods. Untargeted multi-peer calls broadcast; send(targetId, method, payload) selects only a current direct peer. Completing or returning an RPC stream releases that call, not the borrowed carrier.

connect.timeoutMs bounds identity and capability negotiation. Per-call timeoutMs and signal bound business work. Business cannot enter a provider before the handshake. Native structured clone alone does not authorize backing transfer: actual session capabilities, authentication, and payload ownership determine eligibility.

Source/carrier errors use rpc.transport.browser. Shared RPC and handshake errors retain rpc.endpoint, rpc.remote, and their original cause graphs. Match source/code rather than message alone, and preserve native error types, stacks, and causes.

An ordinary PluginHost can install the same transport definition; name/expose control its registration and exposed methods. Carrier authors can use this package's eight /adapters/* entries and the host /plugin SDK's safe raw deployment tools. Applications need no separate endpoint factory.
