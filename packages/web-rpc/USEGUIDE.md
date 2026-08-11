# Usage guide

```ts
const endpoint = await createEndpoint({
  id: 'client',
  transport,
  middlewares: [
    contract({ version: '1' }),
    protocol(),
    connect({
      transport,
      identifier: ({ senderId, origin, source }) => allow(senderId, origin, source)
    }),
    chunk({ chunkSize: 16_384, maxMessageBytes: 4 * 1024 * 1024 })
  ]
});
```

For `createWindowMessageTransport`, same-origin usage may omit `receiver` and `targetOrigin`; they
default to the current window and `window.location.origin`. Cross-origin usage must pass an
explicit `targetOrigin`. Wildcard delivery is rejected unless `{ allowUnsafeTargetOrigin: true }`
is also passed; that opt-in only affects outbound origin filtering, while the adapter still
preserves and verifies `source` for inbound messages.

Window `postMessage` cannot reliably observe that a remote window or iframe was closed. Use a
finite operation deadline (the default) or an explicit host lifecycle signal when the peer may
disappear; `timeoutMs: false` intentionally permits an indefinite wait and does not imply remote
close detection.

Dedicated worker and other exclusive channels bind the first logical sender observed on that
adapter connection; the adapter cannot infer a peer ID from a generic `Worker`/`MessagePort`.

`createBrowserMessagePortTransport(port)` is `owned` by default and closes the supplied port during
transport cleanup. When the caller retains ownership, pass `{ ownership: 'borrowed' }`; cleanup then
removes the adapter listeners without closing the underlying port.

Custom transports should declare `topology: 'exclusive'`, `'multiplexed'`, or `'broadcast'`.
Multiplexed transports must provide peer/source identity or use explicit identifier verification;
they must not rely on exclusive first-sender binding. Broadcast transports use the documented
anonymous-group semantics unless a verified unique target identity is configured.

Anonymous BroadcastChannel is an honest-peer routing mode, not an authenticity boundary: a same-origin
participant can observe task IDs and wire payloads and may forge discovery or business frames. Do not
use `uniqueTargetId` as a credential. Configure the `authentication()` middleware when forged response,
variation, or discovery rejection is a security requirement; authentication protects each final frame,
including chunk and control frames.

`ping()` resolves `false` on timeout, transport failure, or disposal. Requests and pings are settled
at most once. A response with an unknown or mismatched task identity is ignored and emits
`response.unmatched` without consuming the legitimate pending request.

Transport errors are diagnostic notifications unless the adapter also exposes `closed: true`.
Only a proven terminal transition closes endpoint admission and rejects later transport work;
events such as `messageerror` must not be treated as terminal without platform-level proof.
Adapters that cannot observe a remote close must rely on the operation deadline or an explicit
host lifecycle signal rather than claiming immediate terminal detection.

`dispose()` always completes endpoint state cleanup before resolving or rejecting. If a middleware,
subscription, receiver announcement, or owned transport release fails, it rejects with a lifecycle
error containing `cleanupErrors`; each entry retains its resource name, while later cleanup steps
still run.

All public failures are `WebRpcError` values and can be dispatched by `error.code`. Construction
uses `MIDDLEWARE_DUPLICATED`, `MIDDLEWARE_MISSING`, or `INVALID_CONFIG`; protocol, contract,
payload, and chunk failures use their corresponding `PROTOCOL_*`, `CONTRACT_*`, `PAYLOAD_*`, and
`CHUNK_*` codes. Do not branch on localized messages or runtime-specific error classes.

The endpoint rejects inbound chunk frames unless connect verification is installed and successful.
Partial assemblies are bounded and expire automatically. Hook events include `receive.failure`,
`authentication.rejected`, `response.unmatched`, `transport.failure`, and
`middleware.dispose.failure`.

Chunking is best-effort delivery; the endpoint does not emit chunk acknowledgements or expose a
reliable chunk retry state machine. Use request timeout/retry at the RPC layer when delivery
confirmation is required.

Connect uses base identity verification by default and ignores `identifier` unless
`useBaseIdVerifyOnly: false` is explicitly set. In that mode `identifier` is required and runs only
after the adapter-provided peer metadata passes the base check. A source object alone is not a base
identity; configure a matching `peerId` or `origin`, or explicitly use `identifier` mode.

Fan-out result records use tagged keys: anonymous deliveries use
`JSON.stringify(['target', targetId])`, while receiver deliveries use
`JSON.stringify(['receiver', targetId, receiverId])`.

Every `ping`, `pong`, and `abort` variation carries a task ID; malformed variations without one are
discarded before routing or hook emission.

`hooks` is always present on the endpoint; `ping` and abort behavior require their corresponding
middleware/feature and throw a contract error when unavailable.

Custom transport, middleware `install`, verifier, provider, and pipeline callbacks are invoked as
context-free functions. Do not depend on `this`; prefer arrow functions or closures. The runtime
snapshots the callback before invocation and deliberately does not use `bind`, `call`, or `apply`.

Factory construction may be cancelled with `construction.signal` or bounded with
`construction.timeoutMs`. Cancellation rejects construction and still observes cleanup for
middleware that has already installed. Middleware `install` receives the same construction
`signal` and should stop its own pending work when it aborts. An async middleware or unique-target
factory should not be assumed to receive a receiver-bound `this` context.

Request and dispatch task IDs are not reusable during the replay window. A completed request frame
is treated as a duplicate and does not run the provider again. Retry policy callbacks are cancelled
by the request signal or endpoint disposal; an async policy that never settles cannot keep `send()`
alive after either signal fires.

`sendAll()` and `pingAll()` return null-prototype records because target IDs and receiver IDs are
untrusted strings. Anonymous broadcast groups use the target ID as their result key; identified
receivers use a canonical JSON tuple key `[targetId, receiverId]`, preventing equal receiver IDs
under different targets from overwriting one another.
The fan-out methods perform the endpoint active check before taking their peer snapshot, so a
disposed endpoint rejects consistently even when it has no known peers.

Receiver discovery is automatic by default. The first `send`, `dispatch`, or `ping` to an unknown
target starts a lazy query and transparently caches its response; endpoint IDs are also the only
IDs they accept, so there is no separate target registration API in automatic mode.
`endpoint.discovery` exposes a remote-DNS snapshot for debugging and pinning, but never includes
the current endpoint itself. Set `discoveryMode: 'manual'` in connect configuration to install the
manual `endpoint.connect` query/accept/reject/register/unregister/ping controls; automatic and
manual discovery are mutually exclusive. Manual `ping()` performs only a ping/pong probe: it does
not discover, register, or alter the persistent DNS snapshot; use `query()` followed by explicit
`register()` when a receiver should become routable. Undecided inbound manual queries expire after
a bounded interval and do not permanently consume the pending-query budget.

Receiver announcements and lease controls are not part of the runtime. DNS entries are created only
by authenticated discovery responses; manual unregister changes the requester's local snapshot and
does not send an ownership-changing announcement to a remote endpoint.

Without a pin, a request or ping may be delivered to every active receiver for the target and the
first valid response settles the operation, whether it succeeds or fails. `sendAll()` and `pingAll()` preserve one result
per receiver when discovery metadata is available. Receiver lifecycle events include
`connect.receiver-registered`, `connect.server-unregistered`, `connect.receiver-pinned`,
`connect.receiver-unpinned`, `connect.pinned-receiver-lost`, and
`connect.multiple-receivers`. That hook exposes `requesterId` and a frozen `receiverIds` snapshot;
the console diagnostic includes the same ids and pin/unregister guidance. Receiver announcements
are discovery metadata only; normal connect verification still authenticates RPC traffic.

The WebTransport datagram adapter owns one persistent reader for the transport lifetime.
Unsubscribing the last RPC listener does not cancel the underlying reader; `close()` cancels and
awaits the read loop, releases the reader lock, and closes the writer. A second `close()` shares
the first close promise.
