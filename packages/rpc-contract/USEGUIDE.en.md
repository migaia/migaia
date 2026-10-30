# `@migaia/rpc-contract` protocol and usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

Contract owns data, interfaces, and pure shape checks. Host owns RPC sessions and call execution. Transport plugins own carriers, codecs, framing, and transfer; flow plugins and their features own optional state and policies. Normally choose one transport kind per host rather than mixing kinds.

## Version and input boundary

Every semantic message uses profile `migaia.rpc/2`. The only protocol version is `{ major: 2, minor: 0 }`, without legacy v1 or JSON-RPC fallback. Decode through the actual carrier, then check shapes with `/protocol` normalizers. A TypeScript assertion on received data is not admission.

Protocol normalizers first require a non-array object, then read known fields directly and check their types, ranges, and kind. Missing or invalid known fields retain their public error codes, with a pointer to the first invalid field. Admission retains the original object, ignores unknown fields, and does not inspect prototypes, getters, or non-enumerable properties. Business portability rules remain unchanged; the schema plugin owns method-schema execution.

## Handshake and directory

`kind: 'handshake'` selects three records through `step`:

| Step     | Fields                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `hello`  | `versions`, `codecs`, `extensions`, optional `requiredExtensions`, `peer`, `directory`, optional `auth` |
| `accept` | Selected `major/minor`, `codec`, `extensions`, `peer`, `directory`, optional `auth`                     |
| `reject` | Complete flat `error`                                                                                   |

Hello offers actual supported versions/codecs; common bootstrap uses JSON. Accept must select from the actual offer. Missing required extensions reject, while missing optional extensions enable no implementation. Extension names follow `<name>@<positive-version>`. Peer/directory claims do not authenticate a caller; the installed auth plugin owns that decision.

Both sides send one hello; the smaller instance ID is the initiator. The responder admits the remote name and identity, writes accept, and retains that reserved session. The initiator validates the agreement and completes local admission, then confirms with the same accept shape carrying its original offer identity, directory, credentials, and the identical version, codec, and extensions. The initiator publishes ready after writing confirmation; the responder publishes its original reserved session after receiving confirmation. A normal exchange contains two hellos and two accepts. Admission failure sends reject before an unconfirmed connection can report ready. Business frames follow confirmation on the same ordered carrier.

A directory is `{ schemaVersion: 3, self: { name, instanceId, generation }, methods, nodeId? }`. Methods contain `name`, `supportedModes`, `modeSource`, and optional `idempotent/forwardedVia/input/output/yield`. Directory frames update existing accepted sessions without retaining another describe RPC.

## Calls, routes, and generations

This constructs and checks a semantic message without connecting or sending a call.

```ts doc-test=check
import { normalizeRpcFrame, RpcWireProfile, type IRpcEnvelope } from '@migaia/rpc-contract/protocol'

export const call: IRpcEnvelope = {
  profile: RpcWireProfile,
  kind: 'call',
  id: 'call-1',
  route: {
    applicationVersion: '1',
    senderId: 'caller',
    receiverId: 'provider',
    targetId: 'provider',
    sentAt: 0,
    remainingMs: 1000
  },
  task: {
    mode: 'request',
    callerId: 'caller',
    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },
    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },
    method: 'math.add'
  },
  options: {},
  payload: [20, 22]
}
export const admitted = normalizeRpcFrame(call)
```

Operational frames share `id`, `route`, and `task`, with optional negotiated extension data. Route contains `applicationVersion/senderId/receiverId/targetId/sentAt` and optional `forwardRoute/trace/remainingMs`. Task contains `mode/callerId/callerGeneration/targetGeneration`, with `method` identifying the called method. A generation is `{ kind: 'restart' | 'session', value, providerId }`.

A string ID alone cannot replace strict task/generation admission. Results, errors, cancellations, and stream events must correlate with the original selected task. A same-name successor cannot settle an old call.

| Kind      | Specific data                                                            |
| --------- | ------------------------------------------------------------------------ |
| `call`    | `options` and optional `payload`; request/notify/stream mode             |
| `group`   | `options` and ordered `steps: [{method,payload?}]`                       |
| `result`  | Optional `result`; omit actual undefined                                 |
| `error`   | Flat `error` graph                                                       |
| `cancel`  | Optional flat `reason` graph                                             |
| `stream`  | `stream: {event,seq,value?,error?,reason?}`                              |
| `outcome` | Lookup contains `idempotencyKey`; result contains `state/store/outcome?` |

Wire options contain only `orderKey/cancel/idempotencyKey`, never local signals, timeout/retry instances, or transfer authority. `route.remainingMs` is the remaining relative budget and forwarding may only reduce it. FeatureScope selects a complete call override or false, then the transport feature, then the link default. Only the origin retries.

Notifications also have IDs. After physical sending, cancel frames propagate to the original provider signal without waiting for business acknowledgement or creating one-way receipts.

## Streams, groups, and controls

Stream events are open/pull/item/end/fail/cancelled/finish-without-items. Host StreamChannel owns sequences and credits. Contract checkers return shape errors without sending, scheduling iterators, or allocating another stream.

Semantic byte measurement applies only to stream value slots bounded by `maxItemValueBytes`. Each item is measured once by the sender and once by the receiver: the existing codec walk performs the measurement when present; otherwise `measurePortableStreamValue` does. Requests, notifications, and ordinary results do not perform this measurement.

Groups execute in order, with a `not-executed` suffix after the first failure. Step outcomes are `success/result?` or `failure/error`. The batch plugin owns physical batching independently. Idempotency executes outcome lookup; contract defines pending/unknown/done and store-continuity data only.

Control frames contain `id/route/operation/reason?`; operation is ping/pong/drain/close, without a business task. Directory frames contain id/route and a complete directory, without creating a provider call.

## Carriers, binary, and stage order

Outbound: `prepare → envelope.outbound → encode → frame.outbound → write`. Inbound: `frame.inbound → decode → envelope.inbound → restore`. Auth admits prepared binary metadata before the carrier restores business values. Chunk/batch operate on encoded outer frames.

Ordinary carrier frames are `{kind:'message',data,sidecars?}`; extension frames are `{kind:'extension',extension,data,sidecars?}`. The common JSON byte carrier uses a four-byte unsigned big-endian length followed by UTF-8 JSON. Length excludes the header; nonempty payloads are limited to16MiB. Readers support arbitrary chunk boundaries and reject partial-frame EOF. Stateful decoders/codecs belong to the Host SDK or transport, not contract exports.

`IRpcCarrier` may implement `setInboundFrameLimit?(maxFrameBytes: number): void`. After handshake admission and before sending accept, Session supplies `maxFrameBytes`. Byte carriers start at 64 KiB, then enforce the current limit while checking lengths and parsing JSON, including extension frames. Oversized input is rejected before allocating the complete payload or parsing JSON; Session needs no dependency on a concrete carrier.

A carrier may declare `startupMessagesMayBeLost: true` when native delivery drops messages before the opposite listener starts. Upon its first peer hello, the initiator resends the original offer once, adding at most one frame. The responder reuses its reserved or accepted session for repeated hellos from that peer, without creating another candidate or repeating authentication. Window uses this fact. BroadcastChannel reuses its existing targeted join to install the remote route before semantic hello; other reliable carriers retain their original frame count. No periodic retry or separate handshake state table is added.

Binary manifests retain `profile: 'migaia.rpc.portable-binary/1'`, `storage: 'inline' | 'native'`, the original `envelope`, and a logical `backings` array. This versions a binary representation rather than another RPC grammar. `storage: 'inline'` keeps visible bytes inline, with empty `backings` and physical sidecars. Each row under `storage: 'native'` describes one complete backing:

| Field        | Rule                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `byteLength` | Complete backing length in bytes, rather than one view's visible length                                                                              |
| `data`       | Optional; when this own field exists, its value must be unpadded canonical base64url of the complete backing, decoding to exactly `byteLength` bytes |
| `sha256`     | Used only without `data`; optional, but when present must be a 64-character lowercase hexadecimal digest                                             |

A row with `data` creates one backing during restoration, consumes no physical sidecar, and does not read that row's `sha256`. A row without `data` consumes the next physical sidecar, checking its complete length and unique backing identity. Extra or missing sidecars reject. Binary value tags still reference logical backing indices, preserving shared backing aliases, offsets, and lengths when inline and native rows are mixed. A field present with `undefined` is not an omitted field.

Pure protocol validation checks manifest shape; peer fields cannot select integrity policy or grant transfer authority. When the receiver's local codec context has `transferRequiresIntegrity: true`, native sidecar rows require a valid digest and verify SHA-256 over the complete backing. Otherwise no digest is calculated. With a signature covering the manifest, Host currently snapshots complete backings of at most 1125 bytes inline only when they are not explicitly listed in the caller's `transfer`; other backings remain native sidecars with digests. This threshold is an internal SDK choice, not a manifest field or public option. Unsigned native rows may contain only `{ byteLength }`.

Codec prepare borrows the caller's authorized transfer list. Explicitly listed backings remain native sidecars regardless of size, and the original buffer detaches on actual handoff. Final transfer remains intersected with actual native sidecars; a manifest grants no additional authority. Older receivers that require `sha256` on every native row or assume one physical sidecar per row must adopt this format. Global inline storage encoding is unchanged.

## Portable values and snapshots

Default `normalizePortable(value)` has maximum depth64 and copies/freezes records and arrays. Uint8Array becomes an unpadded canonical base64url bytes tag. The default domain rejects ArrayBuffer, undefined, nonfinite numbers, cycles, functions, symbols, bigint, and unsupported objects. Nested array/record descendants follow the same rules.

Default wire traversal reads own enumerable string fields and may execute each getter once. `normalizeRpcPortable` uses the strict own-data negotiated-native domain and may retain genuine ArrayBuffer/Uint8Array values. Native retention alone grants no transfer permission; the actual carrier must enforce capability, budget, and integrity checks.

## Error graphs and native classes

Wire errors are `{root,nodes}`. Every node requires source/code/name/message/stack. Cause is a node index and errors is an ordered index list; data/route/truncated are optional. Indices represent shared/cyclic edges. Receivers validate references, nodes, and aggregate budgets.

The limit is 1024 nodes; a 1025-node input is rejected with the existing `TypeError` / `INVALID_WIRE_ERROR`. Flat graph edges do not use the old 64-level error-tree rule. Restoration first creates one error object per node, then connects references iteratively. Repeated references keep `===` within the restored graph, and cycles refer back to those same restored objects; this does not promise `===` with objects in the sending process.

```ts doc-test=run
import assert from 'node:assert/strict'
import { serializeRpcWireError, deserializeRpcWireError } from '@migaia/rpc-contract/protocol'

const cause = new RangeError('sample limit')
const primary = new TypeError('sample operation', { cause })
const reports: unknown[] = []
const wire = serializeRpcWireError(primary, { report: (failure) => reports.push(failure) })
const restored = deserializeRpcWireError(wire)
assert(restored instanceof TypeError)
assert(restored.cause instanceof RangeError)
assert.equal(restored.stack, primary.stack)
assert.equal((restored.cause as Error).stack, cause.stack)
assert.equal(reports.length, 0)
console.log('native error graph preserved')
```

Cross-realm restoration creates new error objects and cannot preserve cross-process `===`. Supported native classes and sender stacks survive. `serializeRpcWireError` requires report; unreadable/projected fields remain locally observable. Budget truncation marks truncated without promising one report per text cut.

Standalone tree utilities `serializeRpcError/deserializeRpcError/normalizeRpcSerializedError/reachRpcError` remain under `/errors` for pure diagnostic boundaries. The business protocol uses only flat graphs. Received source/code are diagnostic identity, not local control authority; peer-selected codes cannot determine local resource ownership.

## Schemas and bounds

Use published `schema/protocol.schema.json` and `schema/wire-error.schema.json` as structural starting points. Pure normalizers also check known fields, graph edges, canonical bytes, and applicable aggregate budgets. Schema validation does not admit sessions, native sources, or lifetimes. Foreign implementation vectors live in rpc-integration's core-profile vectors and independent-peer tests.

RpcWireLimit fixes identifiers at128 characters, traces256, idempotency keys128, relative duration2147483647ms, handshake65536bytes, and at most8versions/16codecs/64extensions. Directories contain at most4096methods. Public constants/normalizers define stream/error/portable bounds.

Old `/v1`, `/runtime`, `/framing`, `/binary`, `/remote`, JSON-RPC bridge conversion, and Content-Length profiles are removed. Applications use Host, carrier authors use its SDK, and contract contains no independent connection or policy executor.

`RpcWireLimit.maxForwardHops` is 16. `forwardRoute` and serialized error routes accept at most `RpcWireLimit.maxForwardRouteNodes` (17) node IDs, including the origin. A host’s default forwarding ceiling remains 3; protocol capacity does not override its local policy.

An existing native host supplies `domainCore(request)` through Host SDK `rpcHostPipelines(getHost, pipeline)`, forwarding the same native construction request to its own `pipeline(name, request)`. Each transport plugin declares seven short pipeline names, created on installation and deleted on removal. The helper no longer takes a namespace list or returns declarations. Ordinary native hosts install shared flow Features through `rpcFeaturesPlugin({ features })` before transports; see the [Host guide](../rpc-host/USEGUIDE.en.md#install-rpc-in-an-existing-host). Builtin outbound order is plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire; inbound reverses the direction. Transport feature placement overrides that capability only within its namespace; it does not create a second executor.
