# `@migaia/rpc-browser`

Use function calls or raw messages over existing browser carriers, with explicit ownership of logical connections and native resources.

## You may have run into this

- Request IDs and response listeners keep multiplying because method calls and source checks are mixed into message handlers.
- A remote producer must finish collecting everything because a sequence is treated as one scalar response.
- A buffer suddenly has zero length after sending because cloning and explicit transfer were not distinguished.
- Later observers miss a message after one listener throws because the dispatch loop does not isolate callbacks.
- A supposedly private update reaches several participants because BroadcastChannel fan-out was overlooked.

## Why choose it

- **Call remote methods without another hand-written response protocol.** In connect mode, createBrowserPeer reuses Core's real handshake and method catalog, while request returns the result and native ports remain caller-owned, demonstrated in [Call a typed method and release only the logical connection](./USEGUIDE.en.md#call-a-typed-method-and-release-only-the-logical-connection).
- **Consume a remote generator without collecting the entire sequence first.** stream begins on first iteration over the negotiated connection, with separate entry points for scalar and iterative results, demonstrated in [Consume a remote async generator through the same Peer](./USEGUIDE.en.md#consume-a-remote-async-generator-through-the-same-peer).
- **Keep buffer transfer an explicit sending choice.** The SharedWorker transport forwards the transfer list to a real port, exposing both sender detachment and receiver bytes, demonstrated in [Transfer a byte buffer through a native message port](./USEGUIDE.en.md#transfer-a-byte-buffer-through-a-native-message-port).
- **Keep one business-listener failure from skipping other listeners.** The transport reports the original exception through onListenerError and continues delivering the same message to other subscribers, demonstrated in [Report one failing message listener without skipping the next](./USEGUIDE.en.md#report-one-failing-message-listener-without-skipping-the-next).
- **Make multi-party broadcast delivery visible.** BroadcastChannel transports subscribe independently to matching native channels, allowing several recipients to receive one send, demonstrated in [Deliver one broadcast to two channel participants](./USEGUIDE.en.md#deliver-one-broadcast-to-two-channel-participants).

## Start here

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const { port1, port2 } = new MessageChannel()
const sender = createSharedWorkerTransport(port1)
const receiver = createSharedWorkerTransport(port2)
const received = Promise.withResolvers<unknown>()
const stop = receiver.subscribe(({ data }) => received.resolve(data))
sender.send('hello')
console.log(await received.promise)
stop()
port1.close()
port2.close()
```

Output:

```text
hello
```

For function calls, see [typed methods](./USEGUIDE.en.md#call-a-typed-method-and-release-only-the-logical-connection); for fan-out, see [multiple participants](./USEGUIDE.en.md#deliver-one-broadcast-to-two-channel-participants).

## Pitfalls when writing it yourself

This native port version sends the same message. It is displayed only; manual cleanup must retain callback identity and distinguish registrations from port ownership.

```ts doc-test=check
import { MessageChannel } from 'node:worker_threads'

const { port1, port2 } = new MessageChannel()
const received = Promise.withResolvers<unknown>()
port2.on('message', (data: unknown) => received.resolve(data))
port1.postMessage('hello')
console.log(await received.promise)
port2.off('message', (data: unknown) => received.resolve(data)) // Pitfall: a new function cannot remove the original registration.
port1.close() // Pitfall: physical closure is tied to logical cleanup, preventing continued borrowing.
port2.close()
```

The quick start uses subscribe's independent disposer to release its message registration and leaves native close to the caller; use createBrowserPeer when you also need a handshake, catalog, and method results.

## A three-minute mental model

Choose function calls or raw messages before selecting the carrier. A Peer is Core's handshaken logical connection; a transport is the native message interface; borrowed means its creator retains physical-close ownership.

| Task / term                     | Tool                            | Meaning                                                                 |
| ------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| One business result / Peer      | createBrowserPeer → request     | Start both handshakes together and call catalog methods                 |
| A sequence / stream             | peer.stream → for await         | Consume items and return early when finished                            |
| An existing port / transport    | createSharedWorkerTransport     | Wrap the actual port and retain transfer choices                        |
| Multi-party updates / broadcast | createBroadcastChannelTransport | Deliver matching-channel messages to multiple participants              |
| Cleanup ownership / borrowed    | stop / close → native close     | Retire logical registrations, then let the owner close native resources |

## Typical scenarios

| Scenario                                                        | How to combine                                   | Details                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Call a typed method and release only the logical connection     | `connect.sharedWorker.port → request → close`    | [Complete example](./USEGUIDE.en.md#call-a-typed-method-and-release-only-the-logical-connection)     |
| Consume a remote async generator through the same Peer          | `provide(generator) → stream → for await`        | [Complete example](./USEGUIDE.en.md#consume-a-remote-async-generator-through-the-same-peer)          |
| Transfer a byte buffer through a native message port            | `send(buffer,{transfer}) → subscribe → stop`     | [Complete example](./USEGUIDE.en.md#transfer-a-byte-buffer-through-a-native-message-port)            |
| Report one failing message listener without skipping the next   | `onListenerError → subscribe → dispatch`         | [Complete example](./USEGUIDE.en.md#report-one-failing-message-listener-without-skipping-the-next)   |
| Deliver one broadcast to two channel participants               | `BroadcastChannel(name) → subscribe × 2 → send`  | [Complete example](./USEGUIDE.en.md#deliver-one-broadcast-to-two-channel-participants)               |
| Retire one subscription while leaving the native channel usable | `subscribe × 2 → stopOne → stopTwo → native I/O` | [Complete example](./USEGUIDE.en.md#retire-one-subscription-while-leaving-the-native-channel-usable) |

## Installation

```bash
pnpm add @migaia/rpc-browser @migaia/rpc-core
```

Node examples use built-in MessageChannel/BroadcastChannel and require no additional package. Browser carriers still require real application-owned windows, workers, RTC channels, or WebTransport sessions.

## Essential APIs

| API                                        | Purpose                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `createBrowserPeer(options)`               | Obtain a Core Peer over a supported one-to-one carrier   |
| `createWindowMessageTransport(options)`    | Wrap a selected outbound window and inbound receiver     |
| `createSharedWorkerTransport(port)`        | Wrap an actual messaging port directly                   |
| `createBroadcastChannelTransport(channel)` | Participate in matching-channel fan-out                  |
| `createServiceWorkerTransport(options)`    | Configure separate ServiceWorker send and receive owners |
| `createRtcDataChannelTransport(channel)`   | Wrap an established RTC physical string channel          |

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

The table uses `source` to identify browser errors. Import this package’s public APIs from `@migaia/rpc-browser`.

| Package code, source=`@migaia/rpc/browser` | Trigger and response                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| WINDOW_ORIGIN_REQUIRED                     | A Window Peer has no nonempty origin; provide the explicit destination origin               |
| RTC_CHANNEL_UNRELIABLE                     | A Peer channel is not ordered and reliable; use supported settings                          |
| LISTENER_ALREADY_BOUND                     | A SharedWorker scope already has a listener; close it first                                 |
| INVALID_PEER_SOURCE                        | Conflicting connect/listen or unsupported sources; choose one real source                   |
| MESSAGE_DECODE_FAILED                      | The Peer cannot decode RTC JSON; inspect physical input, with the original decoder on cause |

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
