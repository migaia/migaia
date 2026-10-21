# `@migaia/rpc-browser` usage guide

These complete examples use native Node ports and channels through the public APIs. They demonstrate real message delivery and Core handshakes without claiming browser origin checks or native worker realms.

## Find a scenario

| Scenario                                                        | API                               | Details                                                                              |
| --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| Call a typed method and release only the logical connection     | `createBrowserPeer`               | [Complete example](#call-a-typed-method-and-release-only-the-logical-connection)     |
| Consume a remote async generator through the same Peer          | `createBrowserPeer`               | [Complete example](#consume-a-remote-async-generator-through-the-same-peer)          |
| Transfer a byte buffer through a native message port            | `createSharedWorkerTransport`     | [Complete example](#transfer-a-byte-buffer-through-a-native-message-port)            |
| Report one failing message listener without skipping the next   | `createSharedWorkerTransport`     | [Complete example](#report-one-failing-message-listener-without-skipping-the-next)   |
| Deliver one broadcast to two channel participants               | `createBroadcastChannelTransport` | [Complete example](#deliver-one-broadcast-to-two-channel-participants)               |
| Retire one subscription while leaving the native channel usable | `createBroadcastChannelTransport` | [Complete example](#retire-one-subscription-while-leaving-the-native-channel-usable) |

## Running the examples

```bash
pnpm add @migaia/rpc-browser @migaia/rpc-core
```

Run each example as a separate Node 24 TypeScript module. node:worker_threads supplies real MessageChannel ports; native BroadcastChannel and crypto.randomUUID supply the broadcast path. withResolvers is a local completion gate, not a fake transport. No browser, signaling server, or external network is required. Both logical subscriptions and native resources are explicitly released.

## Call a typed method and release only the logical connection

A caller needs a method result across an existing port, while the application must keep owning that physical port.

Hand-written request identifiers and response listeners add another protocol, and closing a borrowed port during cleanup can disrupt its owner.

createBrowserPeer completes the real Core handshake over each native MessagePort; request returns the remote result and close retires only the logical connection.

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createBrowserPeer } from '@migaia/rpc-browser'

type ICounterApi = { double(value: number): number }
const { port1, port2 } = new MessageChannel()
const [client, service] = await Promise.all([
  createBrowserPeer<ICounterApi>({ connect: { sharedWorker: { port: port1 } } }),
  createBrowserPeer({
    connect: { sharedWorker: { port: port2 } },
    provide: { double: (value: number) => value * 2 }
  })
])
try {
  console.log(await client.request('double', 21))
  const closing = client.close()
  console.log(closing === client.close())
  await closing
  await service.close()
  const delivered = Promise.withResolvers<unknown>()
  port2.once('message', (data: unknown) => delivered.resolve(data))
  port1.postMessage('still-open')
  console.log(await delivered.promise)
} finally {
  await Promise.all([client.close(), service.close()])
  port1.close()
  port2.close()
}
```

Output:

```text
42
true
still-open
```

The output is 42, true, then still-open: the remote method runs, repeated close returns one Promise, and raw delivery still works after both Peers close.

Node's MessageChannel supplies the real port operations accepted by connect.sharedWorker.port. This proves that port path, not a browser SharedWorker realm or Window origin checks; the caller closes both ports.

### Example parameters

connect.sharedWorker.port is a real Node MessageChannel port satisfying the public shape, not a fabricated SharedWorker. Methods default to none; service.provide.double takes and returns a number, and TRemote supplies only static business typing. Promise.all starts both handshakes together. Omitted defaultTimeoutMs is 30000 ms. close shares its Promise without closing the port; withResolvers and the native once listener only demonstrate continued native delivery.

## Consume a remote async generator through the same Peer

A remote task produces several values, but a single request result cannot represent that sequence.

Collecting everything remotely delays consumption, while treating a generator as a normal method loses its iteration protocol.

Declare the generator in the remote API and call stream; each next operation uses the same negotiated port connection.

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createBrowserPeer } from '@migaia/rpc-browser'

type ISequenceApi = { values(start: number): AsyncIterableIterator<number> }
const { port1, port2 } = new MessageChannel()
const [client, service] = await Promise.all([
  createBrowserPeer<ISequenceApi>({ connect: { sharedWorker: { port: port1 } } }),
  createBrowserPeer({
    connect: { sharedWorker: { port: port2 } },
    provide: {
      async *values(start: number) {
        yield start
        yield start + 1
      }
    }
  })
])
try {
  const values: number[] = []
  for await (const value of client.stream('values', 3)) values.push(value)
  console.log(values.join(','))
} finally {
  await Promise.all([client.close(), service.close()])
  port1.close()
  port2.close()
}
```

Output:

```text
3,4
```

The output is 3,4 after consuming the real remote generator to completion over the native port pair.

stream is lazy and starts on first iteration; request is for scalar results. This example does not prove browser signaling, reconnection, or cross-window authorization, and both ports remain caller-owned.

### Example parameters

provide.values is an async generator matching ISequenceApi. Its start payload is 3 and it yields 3,4. client.stream receives a method name and payload; without call options it inherits the 30000 ms default. for await consumes the sequence, and finally closes both logical connections and native ports. No Worker realm or browser authorization is simulated.

## Transfer a byte buffer through a native message port

An application deliberately transfers a buffer and must know which side owns its bytes after sending.

Ordinary structured cloning keeps a copy, whereas a transfer list detaches the sender's buffer; hiding that choice makes later buffer access misleading.

Pass the actual buffer in send(message, { transfer }); the adapter forwards the list to the native port without inventing ownership rules.

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const { port1, port2 } = new MessageChannel()
const sender = createSharedWorkerTransport(port1)
const receiver = createSharedWorkerTransport(port2)
const received = Promise.withResolvers<unknown>()
const stop = receiver.subscribe(({ data }) => received.resolve(data))
try {
  const bytes = new Uint8Array([7, 8])
  sender.send(bytes.buffer, { transfer: [bytes.buffer] })
  console.log(bytes.byteLength)
  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))
} finally {
  stop()
  port1.close()
  port2.close()
}
```

Output:

```text
0
7,8
```

The output is 0 then 7,8: the sender's byte view is detached and the receiver gets the original byte values.

The transfer option defaults to undefined, which uses native cloning instead. This is raw transport I/O, not an RPC payload contract; the caller unsubscribes and closes both native ports.

### Example parameters

createSharedWorkerTransport takes only the real port. receiver.subscribe reads data from its message record. send's transfer option defaults to undefined; this example explicitly transfers bytes.buffer instead of cloning it. The initial Uint8Array is [7,8], and detachment changes its byteLength to 0. stop only unsubscribes; physical ports close separately.

## Report one failing message listener without skipping the next

One observer throws while another observer still needs the incoming message.

Calling listeners in one unguarded loop makes the first exception interrupt delivery and can hide which observer failed.

Register onListenerError alongside subscribe; the transport reports that exception through its listener-error channel and continues dispatching the same native message.

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const { port1, port2 } = new MessageChannel()
const sender = createSharedWorkerTransport(port1)
const receiver = createSharedWorkerTransport(port2)
const failureText = 'message observer failed'
const failure = new Error(failureText)
const reports: unknown[] = []
const stopErrors = receiver.onListenerError?.((error) => {
  reports.push(error)
})
const stopFirst = receiver.subscribe(() => {
  throw failure
})
const received = Promise.withResolvers<unknown>()
const stopSecond = receiver.subscribe(({ data }) => received.resolve(data))
try {
  sender.send('delivered')
  console.log(await received.promise)
  console.log(reports.length, reports[0] === failure)
} finally {
  stopFirst()
  stopSecond()
  stopErrors?.()
  port1.close()
  port2.close()
}
```

Output:

```text
delivered
1 true
```

The output is delivered then 1 true: the second subscriber receives the message and the error observer sees the exact original exception once.

This isolates business-listener failure, not a failed physical port. Without an error observer, listener failures remain in the transport's failure channel; cleanup may surface retained failures.

### Example parameters

Optional onListenerError registration returns a disposer. reports retains the error identity; failure is this example's sole business-observer exception. The two subscribers receive in registration order: the first throws the original error and the second resolves actual data. An error observer handles the failure before cleanup. finally releases registrations and ports.

## Deliver one broadcast to two channel participants

Several participants need the same update instead of selecting one exclusive remote endpoint.

Treating a shared channel as a private peer hides its fan-out: every other eligible participant can receive the payload.

Create a transport for each native BroadcastChannel with the same name; one send reaches both subscribed receivers in this Node example.

```ts doc-test=run
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const name = crypto.randomUUID()
const channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))
const [sender, first, second] = channels.map(createBroadcastChannelTransport)
const one = Promise.withResolvers<unknown>()
const two = Promise.withResolvers<unknown>()
const stopOne = first.subscribe(({ data }) => one.resolve(data))
const stopTwo = second.subscribe(({ data }) => two.resolve(data))
try {
  sender.send(7)
  console.log((await Promise.all([one.promise, two.promise])).join(','))
} finally {
  stopOne()
  stopTwo()
  for (const channel of channels) channel.close()
}
```

Output:

```text
7,7
```

The output is 7,7: both native channel participants receive the same update through their own transport subscriptions.

This proves Node's native channel delivery, not browser origin or storage-partition admission. BroadcastChannel is not a createBrowserPeer source; Endpoint IDs select logical recipients without making broadcast private.

### Example parameters

A random UUID channel name avoids collisions with other runs. Three real BroadcastChannel instances share that name, with no extra adapter options. Each receiver subscribes independently. Promise.all retains registration order without assuming arrival order across participants. One send carries 7, then the application closes every channel.

## Retire one subscription while leaving the native channel usable

One view leaves a shared channel while another view must keep receiving updates.

A global cleanup that removes all listeners or closes the channel cuts off consumers that did not release their own subscriptions.

Keep the disposer returned by each subscribe call; releasing one subscriber leaves the other active, and releasing both still leaves the caller-owned channel open.

```ts doc-test=run
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const name = crypto.randomUUID()
const outbound = new BroadcastChannel(name)
const inbound = new BroadcastChannel(name)
const sender = createBroadcastChannelTransport(outbound)
const receiver = createBroadcastChannelTransport(inbound)
let retiredCalls = 0
const stopFirst = receiver.subscribe(() => {
  retiredCalls += 1
})
const received = Promise.withResolvers<unknown>()
const stopSecond = receiver.subscribe(({ data }) => received.resolve(data))
try {
  stopFirst()
  stopFirst()
  sender.send('first')
  console.log(retiredCalls, await received.promise)
  stopSecond()
  const native = Promise.withResolvers<unknown>()
  inbound.addEventListener('message', ({ data }) => native.resolve(data), { once: true })
  sender.send('native')
  console.log(await native.promise)
} finally {
  stopFirst()
  stopSecond()
  outbound.close()
  inbound.close()
}
```

Output:

```text
0 first
native
```

The output is 0 first then native: the retired subscriber is not called, the remaining subscriber receives the first message, and raw channel delivery still works after final unsubscribe.

Disposers are idempotent after successful removal. They release only this transport's registrations; the application must still close its BroadcastChannel instances.

### Example parameters

The two subscribers share this transport's native message listener. Repeating stopFirst demonstrates idempotence after successful removal without affecting stopSecond. After both retire, a native once:true listener still receives through the same channel. The application ultimately closes both channels; the broadcast never becomes an exclusive peer.

## Contract details

### Ownership, entries, and carrier selection

The root exports createBrowserPeer, its public option/source types, RpcBrowserErrorCode, RPC_BROWSER_ERROR_SOURCE, and IRpcBrowserErrorCode. Core owns handshakes, method catalogs, calls, cancellation, and error transfer. This package selects a browser carrier and retains its existing message path. The root loads the selected adapter lazily; that is a loading mechanism, not an unmeasured size or speed guarantee.

| Entry / carrier        | Runtime Peer                                              | Direct Endpoint transport                                   |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| Root / window          | connect.window with an explicit origin                    | adapters/window: createWindowMessageTransport               |
| shared-worker          | Page connect.sharedWorker; worker listen                  | adapters/shared-worker: createSharedWorkerTransport         |
| rtc-data-channel       | connect.rtcDataChannel, ordered and reliable              | adapters/rtc-data-channel: createRtcDataChannelTransport    |
| broadcast-channel      | Unsupported: broadcasting has no fixed peer               | adapters/broadcast-channel: createBroadcastChannelTransport |
| service-worker         | Unsupported: idle termination loses in-memory connections | adapters/service-worker: createServiceWorkerTransport       |
| web-transport datagram | Unsupported: datagrams may be lost or reordered           | adapters/web-transport: createWebTransportDatagramTransport |

Dedicated Worker and general MessagePort transports belong to rpc-core's adapters/web-worker and adapters/message-port. Use rpc-threads when the library should create and supervise a Worker, or rpc-process for process communication. There is no createBrowserPlugin, spawn, signaling service, automatic reconnection supervisor, extra Host slot, or source-verification bypass. The Node MessageChannel examples use real ports satisfying the public sharedWorker.port shape; they do not prove browser SharedWorker creation, cross-origin authorization, RTC signaling, or WebTransport networking.

Install @migaia/rpc-browser and its @migaia/rpc-core peer dependency explicitly. The dependency range is not a runtime equality check between package versions. Publishing retains dist, schema, the root entry, and six adapter subentries. Internal browser files are not additional public paths.

### Runtime Peer options and methods

`createBrowserPeer<TRemote>(options)` returns Core's original dynamic or typed Peer. TRemote describes method names, inputs, results, and streams; it grants neither source trust nor execution authority. Choose exactly one connect or listen source. Supply a real carrier rather than a claimed handshaken, trusted, or owned state.

| Option                                 | Values, defaults, and effect                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| connect                                | Exactly one of window, sharedWorker, or rtcDataChannel; no default                                                                                                |
| listen                                 | A real SharedWorker connect scope, mutually exclusive with connect; no default                                                                                    |
| provide                                | No application methods by default; explicit functions or nested own-data method groups, including async generators; configuration getters are not executed        |
| self                                   | Defaults to name browser and a Core-generated instanceId; descriptive identity does not authorize execution                                                       |
| defaultTimeoutMs                       | 30000 ms by default; a positive finite number, including fractions; inherited by request/stream                                                                   |
| signal                                 | Absent by default; cancels an unfinished connection handshake; listener mode continues observing it and closes the listener and its logical Peers on cancellation |
| report                                 | Background failures go to console.error through the original owner by default; it does not replace errors returned directly by an operation                       |
| providerLimits                         | Core provider admission defaults to global=256 and perPeer=64                                                                                                     |
| probe                                  | Absent by default; one Core probe or an array of probes; observation does not alter protocol or source rules                                                      |
| authentication, contract               | Optional Core authentication and explicit advanced method modes/schema/idempotency; no extra configuration by default                                             |
| keyFactory, retryPort, endpointFactory | Existing advanced Core extension points; the browser layer adds no independent default implementation contract                                                    |

| Method                            | Resulting behavior                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| request(method,payload?,options?) | Await one remote scalar result; business failures, cancellation, and deadlines reject                            |
| notify(method,payload?,options?)  | Await local sending only, without proving provider completion                                                    |
| stream(method,payload?,options?)  | Lazy async iteration; the first next starts sending and early return signals producer cleanup                    |
| group(steps,options?)             | Execute requests sequentially; stop remaining steps after failure without rolling back completed work            |
| outcome(idempotencyKey)           | Query a declared idempotent call's outcome; a missing outcome does not prove the call never ran                  |
| describe(options?)                | Read local identity, admitted connections, and catalog, including Core's text projections                        |
| on('ready',listener)              | Observe future ready events; a resolved connecting factory already establishes the initial handshake and catalog |
| close() / Symbol.asyncDispose     | Share terminal cleanup, release local subscriptions, and leave borrowed native carriers open                     |

Business functions receive payload and Core context; simple return values require no context.success. Start both connecting factories together instead of awaiting one handshake before starting the other. A call's options.signal controls its cancellation. Per-call timeoutMs retains Core's number / false and zero-budget rules; factory defaultTimeoutMs accepts neither false nor 0. Providing streams does not turn an unreliable carrier into a reliable one, and retry does not automatically establish exactly-once business execution.

### Window: a specific window and origin

The Peer source is {window,origin,receiver?,allowUnsafeTargetOrigin?}. window is an application-owned iframe.contentWindow, window.parent, window.opener, or window.open result. origin is required and nonempty; it has no same-origin default. receiver defaults to the current global object when addEventListener is available; a non-Window host must supply the receiver explicitly. origin='*' requires allowUnsafeTargetOrigin===true; omission is undefined, and the selected window identity is still checked.

Direct createWindowMessageTransport({target,receiver?,targetOrigin?,allowUnsafeTargetOrigin?}) requires target. receiver uses the same default, while targetOrigin defaults to the current location.origin and fails with INVALID_CONFIG when unavailable. That compatibility default does not apply to the Peer's origin. Sending invokes target.postMessage(message,targetOrigin,transfer); transfer defaults to undefined and keeps native structured-clone and transfer semantics.

sourceProof accepts only source===target with a matching origin; the explicit wildcard relaxes only the origin match. The Peer bridge uses it before ACK capture and business handling. Endpoint users pass the same transport to connect. Raw transport.subscribe still receives rejected-source records, so direct subscribers must filter them rather than treating event delivery as verification. Listeners attach to receiver, which may differ from the outbound target.

Navigation, unloading, and silent page closure provide no universal reliable remote-close notification. A new page needs a new Peer; an old catalog cannot identify that page. Pending calls normally rely on their configured deadline, while local pagehide can proactively close the Peer.

### SharedWorker: one connection per real port

A page passes connect:{sharedWorker}. sharedWorker only needs a real port, so a native SharedWorker or {port} is accepted. The port requires postMessage/addEventListener/removeEventListener; start is optional. createSharedWorkerTransport(port) has no other options and has exclusive topology. Sends retain transfer lists. The first business subscription calls start and installs shared message/messageerror listeners; the last unsubscribe removes them. The creator still closes the port.

A worker passes its real listen scope, whose addEventListener/removeEventListener handle 'connect' events with real ports arrays. Each port has an independent handshake, catalog, and pending calls. Only one listener may bind a scope at a time; a second fails with LISTENER_ALREADY_BOUND until the first closes. Resolving a listen factory means acceptance is installed, not that a client has handshaken.

Listener close first stops acceptance, then cleans admitted Peers and resources still opening, preserving one cleanup Promise. Do not assume a unique request target when zero or several clients are connected. signal cancellation joins that same cleanup. Without report, the original owner reports failures that cannot be returned from a native callback. Borrowed scopes and ports are never terminated. A remote silent port.close normally becomes visible through Core deadlines; messageerror uses the carrier error channel.

### BroadcastChannel and Service Worker

createBroadcastChannelTransport(channel) takes a real BroadcastChannel and no extra options. It has topology=broadcast and ownership=borrowed, with no transfer list. Matching channel names broadcast to other same-origin contexts rather than an exclusive peer or an authorization boundary for sensitive data. Use unique Endpoint ids/targetIds to select logical providers. Removing the final business subscription only detaches the native message listener; it does not call channel.close.

createServiceWorkerTransport requires target and receiver. In a page, send to a real ServiceWorker and receive through navigator.serviceWorker. In a worker, send to a real Client obtained from clients.get and receive through self. Optional peerId defaults to target.id. The transport is multiplexed and borrowed, preserves send transfer lists, and neither creates registrations nor keeps background processes alive.

Service Worker sourceProof accepts target itself or a source whose id===peerId. A verified cross-realm Client wrapper is normalized to the configured target. Unverified sources still reach raw subscribers unchanged; connect performs admission. A hostile id read reports TRANSPORT with its cause and does not manufacture a trusted source. The application owns reconnection and persistent business state after idle termination.

### RTCDataChannel and WebTransport

A Peer requires ordered===true, maxRetransmits===null, and maxPacketLifeTime===null. Unordered or partially reliable channels fail with RTC_CHANNEL_UNRELIABLE. The application establishes SDP/ICE signaling and the connection first; the Peer neither creates nor closes the native channel. Lower-level createRtcDataChannelTransport(channel) checks the public operations and readyState: open is usable, closed constructs an already-terminal transport, and other states fail with INVALID_CONFIG. The lower adapter does not repeat reliability checks, which does not expand the Peer's supported carrier contract.

RTC transport has topology=exclusive, ownership=borrowed, and encodedType='string'. Non-string sends use JSON.stringify. Raw subscribers receive physical data; the Peer bridge subsequently JSON.parse decodes it, reporting MESSAGE_DECODE_FAILED with the original decoder cause. closing/close/error terminates the transport, removes message/terminal listeners, and reports TRANSPORT. Later error observers can see the terminal reason. The application retains channel.close and RTCPeerConnection ownership.

createWebTransportDatagramTransport({readable,writable}) receives real datagram streams and has topology=exclusive, ownership=owned, encodedType='uint8array'. Construction acquires the writer; the first subscription starts the reader. Business unsubscribe does not stop the reader. Sending requires Uint8Array, otherwise TypeError/INVALID_CONFIG. A bytes codec alone is insufficient for an Endpoint: the default framer may output unknown values and native binary framing may output fragment objects, which this carrier rejects. This package supplies no ready-made compatible Endpoint/framer recipe. send returns a rejection-classifying Promise and does not preserve writer.write Promise identity.

EOF or read failure terminates the datagram transport. close shares one Promise, cancels and joins the reader, attempts writer closure and lock release, and preserves cleanup failures. It owns those stream ports, not the external WebTransport session; the application still calls session.close. Datagram loss, reordering, and MTU limits exclude Runtime Peer support. A deadline can end waiting but cannot recover lost messages.

### Endpoint composition, lifetime, and errors

An adapter returns IRpcTransport for createEndpoint({id,transport,middlewares:[connect({transport})]}), optionally with targetIds. Endpoint.send(target,method,data,options?) requires data; pass null when there is no payload. Providers use context.data / context.success / context.failed. For business versions or protocol frames, configure contract({version}) / protocol() consistently at both ends. Core already configures the Runtime protocol for Peer; do not treat duplicate low-level middleware configuration as a Peer requirement.

Window, SharedWorker, ServiceWorker, BroadcastChannel, and RTC borrow their native carriers. Endpoint.dispose and Peer.close release subscriptions while the creator retains physical close ownership. WebTransport releases only its acquired reader/writer. Normal unsubscribe is idempotent. Native remover failure may throw while retaining the registration, allowing the original disposer to retry; cleanup is not guaranteed to be infallible.

| Package code, source=@migaia/rpc/browser | Trigger and response                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| WINDOW_ORIGIN_REQUIRED                   | A Window Peer has no nonempty origin; provide the explicit destination origin               |
| RTC_CHANNEL_UNRELIABLE                   | A Peer channel is not ordered and reliable; use supported settings                          |
| LISTENER_ALREADY_BOUND                   | A SharedWorker scope already has a listener; close it first                                 |
| INVALID_PEER_SOURCE                      | Conflicting connect/listen or unsupported sources; choose one real source                   |
| MESSAGE_DECODE_FAILED                    | The Peer cannot decode RTC JSON; inspect physical input, with the original decoder on cause |

Browser admission errors retain TypeError and cause. Core/Remote own handshake, catalog, business call, cancellation, timeout, and wire errors; existing transport configuration failures use Core INVALID_CONFIG. Native send failures in BroadcastChannel, SharedWorker, and ServiceWorker, plus WebTransport read/write rejections, use the existing Core TRANSPORT boundary: complete foreign I/O identity is retained, attachable unclassified Error/DOMException values are classified in place, and non-attachable failures remain reachable through cause. Window and RTC raw sends delegate directly to native sending, and RTC may also throw from JSON.stringify; this classification therefore does not apply to every raw send. Listener failures and RTC terminal events retain their original error chains through their respective report channels. Remote diagnostic source/code is not local control authority.

For persistent timeouts, check simultaneous startup, explicit origin, the real source window, catalog, and target; Endpoint users should also inspect middleware and provide. Without an effective waiting limit, silent disconnection is not guaranteed to be detected promptly.

### Physical observation and data boundaries

All six transports support observe(probe). Peer passes its probe to Core and forwards observation through the existing raw port.observe. There is one current observation slot: a new registration replaces the old one, and an older disposer cannot clear a successor even when both reuse one probe object. RTC termination and WebTransport closure release observers. Probe failures use the original listener/report channel with TRANSPORT and cause, without changing business delivery or sourceProof.

Each physical send and source-verified receive emits synchronously once. carrier is window/shared-worker/service-worker/broadcast-channel/rtc-data-channel/web-transport. Rejected-source payloads are not exposed to the probe. detail is reused, so consume it immediately or copy values: unknown origin is an empty string, transfers is the send-list length or -1 on receive, and rejectedSource counts rejections since the preceding valid receive, appearing only on the next valid receive.

Capture is off by default. Only direct byte backing/view sizes are known; strings and containers have sizeBytes=-1. With probe.capturing=true, ordinary content retains its original reference. When a direct byte payload's backing buffer is actually transferred, those bytes are copied before native detachment. Nested transferables are not traversed or cloned and may detach after transfer; capture does not execute payload getters. Window/Worker/Broadcast use platform structured cloning, RTC uses physical JSON strings, and WebTransport uses bytes. Runtime payloads still obey Core's public portable-value contract.

### Development commands

The package retains these scripts; listing them does not claim this documentation edit ran them independently:

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
pnpm run typecheck:e2e
pnpm run test:e2e
```

test retains the package's existing coverage configuration. Browser e2e and Node examples prove behavior in different environments. Node examples do not replace native browser source checks, worker lifecycle, RTC signaling, or WebTransport server verification.
