# @migaia/web-rpc

Transport-neutral bidirectional RPC for browser and worker runtimes.

Use `createEndpoint()` with a contract, protocol, connect verifier, and transport. For shared
messaging transports, configure authentication and treat `senderId` as an untrusted wire value;
the verifier receives adapter-provided `peerId`, `origin`, and `source` metadata when available.
Anonymous BroadcastChannel groups are honest-peer routing only; same-origin participants can observe
and forge wire frames. Use the `authentication()` middleware for authenticity, never
`uniqueTargetId` as a credential.
For dedicated worker channels, pass the known remote `peerId` to the worker adapter explicitly;
the adapter never guesses it from the wire payload.
Browser MessagePort adapters are `owned` by default; pass `{ ownership: 'borrowed' }` when the caller
must retain responsibility for closing the underlying port.

Custom transports should declare `topology` as `exclusive`, `multiplexed`, or `broadcast`.
Multiplexed transports must provide source/peer identity or explicit identifier verification;
they are never treated as exclusive first-sender channels.

Chunking is bounded by concurrent-message, per-peer, chunk-count, chunk-size, message-size, buffer,
and assembly-timeout limits. Configure those limits through the `chunk()` middleware.

`dispose()` closes the endpoint after immediately settling pending requests and invalidating inbound
provider contexts. Middleware and transport cleanup errors are reported through hooks, do not stop
remaining cleanup, and cause `dispose()` to reject with a lifecycle error whose `cleanupErrors`
preserves the resource names.

Custom transport, middleware, verifier, provider, and pipeline callbacks are context-free; use
arrow functions or closures rather than relying on `this`. `createEndpoint()` also accepts
`construction.signal` and `construction.timeoutMs` for cancelling or bounding asynchronous setup.
Middleware install callbacks receive the construction signal and should observe it when setup is
abortable.

Completed request identities remain reserved for a bounded replay window, so replaying a completed
request cannot execute the provider again. Fan-out result records use a null prototype; use
`Object.hasOwn(result.fulfilled, targetId)` when checking attacker-controlled
target IDs such as `__proto__`.

Shared transports can expose multiple server receivers for one target. Automatic discovery exposes
immutable receiver metadata and pinning through `endpoint.discovery`; only `discoveryMode: 'manual'`
adds `endpoint.connect` query/register/unregister controls. Unpinned requests use first-success
settlement across active receivers; pinned receivers never silently fail over after unregistering.

See [USEGUIDE.md](./USEGUIDE.md) for adapter and lifecycle examples.

The WebTransport adapter keeps its datagram reader transport-owned. Listener removal only stops
RPC delivery; `close()` performs the reader cancellation, lock release, and writer cleanup.
