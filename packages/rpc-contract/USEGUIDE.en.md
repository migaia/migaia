# `@migaia/rpc-contract` usage guide

[简体中文](./USEGUIDE.md) · [Overview and quick start](./README.en.md)

| Find a scenario                                                                                                               | Entry                | Behavior to confirm                                |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| [Capture data before the caller changes it](#capture-data-before-the-caller-changes-it)                                       | `normalizePortable`  | Records and bytes become an owned snapshot         |
| [Reject values that cannot preserve their meaning on the wire](#reject-values-that-cannot-preserve-their-meaning-on-the-wire) | `normalizePortable`  | Nonfinite numbers and cycles fail explicitly       |
| [Preserve native error classes and remote cause stacks](#preserve-native-error-classes-and-remote-cause-stacks)               | `serializeRpcError`  | Native classes, codes, and original stacks survive |
| [Report unreadable error fields without losing the wire error](#report-unreadable-error-fields-without-losing-the-wire-error) | `serializeRpcError`  | Unreadable fields retain a local failure report    |
| [Keep equal message identifiers from different peers separate](#keep-equal-message-identifiers-from-different-peers-separate) | `createStringFramer` | Sources separate equal message identifiers         |
| [Reject out-of-order chunks and close partial assemblies](#reject-out-of-order-chunks-and-close-partial-assemblies)           | `createStringFramer` | Ordering rejection and terminal assembly cleanup   |

Each independent example matches its website case and opens no connection. Install the package first:

```bash
pnpm add @migaia/rpc-contract
```

## Capture data before the caller changes it

An adapter validates a payload, then the caller changes its nested object or byte array before encoding. The message should keep the values admitted at the validation boundary.

Keeping the original object lets later mutations change what is sent. A shallow spread still shares nested records and bytes, so it does not establish a stable payload snapshot.

normalizePortable creates a frozen portable snapshot. The default wire profile copies records and converts Uint8Array bytes into a canonical unpadded Base64URL tag; it does not send a request.

normalizePortable requires value. Here profile/name and bytes are business data rather than RPC endpoint fields. Omitting depth/active starts at depth 0 with this traversal’s ancestor set. The Uint8Array’s visible bytes become an unpadded base64url tag instead of retaining the original array identity.

```ts doc-test=run
import { normalizePortable } from '@migaia/rpc-contract/portable'

const source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }
const snapshot = normalizePortable(source)
source.profile.name = 'Grace'
source.bytes[0] = 99
console.log(JSON.stringify(snapshot))
console.log(Object.isFrozen(snapshot))
```

Output:

```text
{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}
true
```

Prints `{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}` and `true`. Later source mutations do not change the captured name or the encoded bytes.

Ordinary records become frozen null-prototype snapshots. This default profile produces a bytes tag, not a restored Uint8Array; negotiated native-binary paths have a separate contract. Getters on ordinary wire records are read once and can execute user code.

## Reject values that cannot preserve their meaning on the wire

A nonfinite measurement can be silently saved as null, while a cyclic payload cannot form a finite wire tree. Both should be rejected before an adapter commits to sending the message.

JSON.stringify changes NaN to null inside a record. Checking only the top-level object misses invalid descendants and cycles that appear deeper in the payload.

normalizePortable walks the supported value tree and rejects invalid descendants. Compare the JSON result with the categorized TypeError, then submit a separate cyclic object through the same public entry.

Both calls require value: a record containing NaN, then a self-reference. No advanced options are passed. The default domain accepts only finite numbers, with root depth 0 and maximum depth 64. Invalid data throws TypeError with INVALID_ENVELOPE.

```ts doc-test=run
import { normalizePortable } from '@migaia/rpc-contract/portable'

console.log(JSON.stringify({ total: Number.NaN }))
try {
  normalizePortable({ total: Number.NaN })
} catch (error) {
  console.log('nonfinite:', error instanceof TypeError, (error as { code: string }).code)
}
const cycle: { self?: unknown } = {}
cycle.self = cycle
try {
  normalizePortable(cycle)
} catch (error) {
  console.log('cycle:', error instanceof TypeError, (error as { code: string }).code)
}
```

Output:

```text
{"total":null}
nonfinite: true INVALID_ENVELOPE
cycle: true INVALID_ENVELOPE
```

Prints `{"total":null}`, `nonfinite: true INVALID_ENVELOPE`, then `cycle: true INVALID_ENVELOPE`. Validation neither substitutes a finite value nor accepts a recursive reference.

The default domain includes null, booleans, finite numbers, strings, arrays, plain records and portable bytes. Its maximum depth is 64 with root depth 0; Date, Map, Set, functions and unsupported primitive values are not admitted.

## Preserve native error classes and remote cause stacks

A remote operation fails with a TypeError caused by a RangeError. The receiver needs both semantic codes and the original stacks to understand which operation failed and why.

Sending only error.message drops the cause tree, native classes and stacks. Creating a fresh local error from that text assigns a receiving-side stack that hides the original failure location.

serializeRpcError projects a bounded coded tree, and deserializeRpcError validates it before restoring native classes. Supply the required report callback to retain any fields that cannot be read or normalized.

serializeRpcError requires value and options. options.report is a required synchronous callback; here it collects failure records without an implicit reporter. source/code supplies semantic identity and cause carries the original reason. deserializeRpcError options may be omitted; unknown fields default to reject.

```ts doc-test=run
import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'

const original = new RangeError('limit exceeded')
Object.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })
const primary = new TypeError('request failed', { cause: original })
Object.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })
const reports: unknown[] = []
const wire = serializeRpcError(primary, {
  report: (failure) => {
    reports.push(failure)
  }
})
const restored = deserializeRpcError(wire)
console.log(restored instanceof TypeError, restored.cause instanceof RangeError)
console.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)
console.log(
  (restored as Error & { code: string }).code,
  (restored.cause as Error & { code: string }).code,
  reports.length
)
```

Output:

```text
true true
true true
REQUEST LIMIT 0
```

Prints `true true`, `true true`, then `REQUEST LIMIT 0`. Both native classes and stack strings survive the round trip, both semantic codes remain present, and no field failures are reported.

Restoration creates new Error objects, so cross-boundary object identity is not preserved. The tree is bounded and can carry cause, AggregateError errors and a truncation marker; no connection or request is executed by these functions.

## Report unreadable error fields without losing the wire error

A diagnostic serializer encounters an Error whose message getter throws. Losing the whole diagnostic would hide both the original operation and the new field-read failure.

Direct property reads while building a JSON object let the getter exception escape the logging path. Ignoring that exception instead removes evidence that a field was omitted.

serializeRpcError captures supported fields and routes omitted read failures to report. Save the fixture stack before installing its hostile message getter, then collect each report record for inspection.

Each report entry contains pointer, field, and error. The error here is the original message-getter failure. No metadata argument supplies custom summaries or routes. Object.defineProperty builds a local failure fixture rather than configuring the normalizer.

```ts doc-test=run
import { serializeRpcError, type IRpcWireErrorFailure } from '@migaia/rpc-contract/errors'

const original = new TypeError('message access failed')
const failure = new Error('unreadable message')
void failure.stack
Object.defineProperty(failure, 'message', {
  get: () => {
    throw original
  }
})
const reports: IRpcWireErrorFailure[] = []
const wire = serializeRpcError(failure, {
  report: (entry) => {
    reports.push(entry)
  }
})
console.log(wire.name, wire.code)
console.log(reports.length, reports[0]?.field, reports[0]?.error === original)
```

Output:

```text
Error UNKNOWN
1 message true
```

Prints `Error UNKNOWN` and `1 message true`. A wire error is still returned, and the report identifies the unreadable message field with the exact original TypeError.

report is required and receives pointer, field and the original failure synchronously. These records are local diagnostic evidence, not extra wire fields. Untagged errors use the unknown source/code fallback; unreadable fields follow the bounded serializer policy.

## Keep equal message identifiers from different peers separate

Two peers each send a fragmented message named job. Their chunks can interleave, but completing one message must not concatenate bytes from the other peer.

A buffer map keyed only by messageId merges unrelated senders. Even ordered chunks then produce a plausible but incorrect combined value, or consume another sender assembly state.

createStringFramer retains assemblies by source and messageId together. Set chunkBytes to 2, interleave the two first fragments, then finish each source separately and close the framer.

Options are optional and default to empty. Here chunkBytes changes from 16384 to 2; string units are UTF-16 code units. context.source and context.messageId are required without defaults. Both origins reuse job. frame/accept require a value and context; close has an optional reason.

```ts doc-test=run
import { createStringFramer } from '@migaia/rpc-contract/framing'

const framer = createStringFramer({ chunkBytes: 2 })
const a = { source: 'peer-a', messageId: 'job' }
const b = { source: 'peer-b', messageId: 'job' }
const first = framer.frame('abcd', a)
const second = framer.frame('wxyz', b)
console.log(framer.accept(first[0]!, a).status, framer.accept(second[0]!, b).status)
const completedA = framer.accept(first[1]!, a)
const completedB = framer.accept(second[1]!, b)
console.log(completedA.status === 'complete' ? completedA.value : completedA.status)
console.log(completedB.status === 'complete' ? completedB.value : completedB.status)
framer.close()
```

Output:

```text
pending pending
abcd
wxyz
```

Prints `pending pending`, `abcd`, then `wxyz`. Both partial assemblies coexist despite sharing job as messageId, and each complete result contains only its own source data.

The caller owns trusted source attribution and message correlation; frame data does not authenticate a peer. This string profile counts UTF-16 code units despite the chunkBytes option name, requires ordered delivery, and releases retained timers through close().

## Reject out-of-order chunks and close partial assemblies

A receiver sees the second fragment before the first, then shuts down after receiving only a prefix. It needs an explicit rejection result and a way to release the unfinished assembly.

Joining whichever fragments arrive produces reordered payloads. Keeping the prefix after shutdown leaves assembly buffers and timeout ownership alive beyond the receiver lifetime.

createStringFramer.accept returns pending, complete or rejected. Submit the out-of-order fragment, start a valid prefix, then call close() before another accept to observe the terminal ingress boundary.

The example uses chunkBytes: 2 and required source/messageId. accept returns pending, complete/value, or rejected/error without reordering fragments. close(reason?) defaults reason to undefined, releases retained state, and rejects further ingress. Other limits retain the defaults below.

```ts doc-test=run
import { createStringFramer } from '@migaia/rpc-contract/framing'

const framer = createStringFramer({ chunkBytes: 2 })
const context = { source: 'peer-a', messageId: 'job' }
const frames = framer.frame('abcd', context)
const early = framer.accept(frames[1]!, context)
console.log(
  early.status,
  early.status === 'rejected' ? (early.error as Error & { code: string }).code : ''
)
console.log(framer.accept(frames[0]!, context).status)
framer.close()
const closed = framer.accept(frames[1]!, context)
console.log(
  closed.status,
  closed.status === 'rejected' ? (closed.error as Error & { code: string }).code : ''
)
```

Output:

```text
rejected INVALID_FRAME
pending
rejected INVALID_FRAME
```

Prints `rejected INVALID_FRAME`, `pending`, then `rejected INVALID_FRAME`. The early second fragment is refused; after a valid prefix, close() prevents further acceptance.

Invalid incoming fragments return categorized rejections, while invalid construction limits throw. close() clears assemblies and timers; this framer does not reorder or retry delivery, and frame-size, chunk-count and concurrency limits still apply.

## Contract details

### Responsibilities, dependencies, and entries

This package defines RPC wire data and provides construction, validation, normalization, and framing. It opens no connection, executes no remote method, owns no Endpoint, and binds to neither Node nor DOM/Worker APIs. Stateful framers own bounded assembly buffers and expiry timers only. Runtime dependencies are `@migaia/serialize` and `@migaia/utils`, without peer dependencies.

Application code normally calls `createRpcHost` from `@migaia/rpc-host` with a transport plugin. Independent-language peers, adapter authors, and error-boundary consumers use contract entries directly. `@migaia/rpc-plugin-process` reuses Content-Length framing and error conversion; serialize owns the underlying portable traversal and error-chain implementation. Contract checkers remain independent of Host, plugins, and native I/O.

| Public entry                                        | Purpose                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@migaia/rpc-contract`                              | Common constants, V1 envelopes, handshake, portable values, and error tools           |
| `./wire`                                            | Wire constants/types plus pure operations such as measurePortableStreamValue          |
| `./portable`                                        | Wire-portable normalization and its depth constant                                    |
| `./errors`                                          | Error projection, restoration, validation, JSON-RPC mapping, and local classification |
| `./v1`, `./framing/v1`                              | Protocol 1.x envelopes and message framing                                            |
| `./framing`                                         | String/binary fragmentation, assembly, and physical frame inspection                  |
| `./framing/stream`                                  | Four-byte network-order length prefixes and bootstrap/handshake receivers             |
| `./framing/jsonrpc`                                 | Content-Length byte framing and bridge error codes                                    |
| `./remote`                                          | Pure remote contract/catalog/control checkers, shape reasons, and method-schema types |
| `./runtime`, `./runtime/metadata`, `./runtime/lazy` | Runtime envelopes, call headers, generations/steps, and lazy loading                  |
| `./stream`                                          | Stream payload, sequence, progress, credit, and control-state checks                  |
| `./binary/lazy`, `./binary/inspect`                 | Lazy binary preparation/restoration, manifests, integrity, and size                   |
| `./schema/wire-error`                               | Published wire-error JSON Schema                                                      |

These are the root and 16 subentries; the schema entry is a JSON file. Do not import internals. V1 uses named rpcProtocol and normalizeRpcEnvelope exports without a default aggregate; the root calls its protocol object rpcProtocolV1. createReassembler and IRpcReassembler were removed: use the original framer.accept/close or Pick their method types. Complete-string carriers use remoteProcessStringFramer. The bare processStringFramer is internal, without a compatibility alias.

### Pure remote and runtime shape checks

`@migaia/rpc-contract/remote` exports `checkRemoteContract(value)`, `checkRemoteHostCatalog(value)`, and `checkRemoteControlShape(definition, value)`. `@migaia/rpc-contract/runtime` exports `checkRuntimeDescription(value)`. Each returns `IRpcShapeCheck<T>`: `{ ok: true, value }` is the normalized snapshot, while `{ ok: false, reason, path, cause? }` is a bounded diagnostic. `RpcShapeReason` defines the reason vocabulary. These functions do not construct Host errors or establish a connection; Host's throwing wrappers retain their own native class, source, code, text, and original cause.

Method declarations and runtime directory entries may carry optional `input`, `output`, and `yield` schema data (`IRpcMethodSchema`). The supported JSON Schema subset is `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `$defs`, and local `#/$defs/...` references. Unknown keywords and external references are rejected; schemas are portable data, not executable validators or remote fetch instructions. Payload execution remains with the Host/provider owner.

The package ships [remote-contract.schema.json](./schema/remote-contract.schema.json) and [runtime-description.schema.json](./schema/runtime-description.schema.json), alongside runtime-api and wire schemas. The `./remote` entry exposes the checker types; these two schema files are shipped artifacts, not extra package-export aliases. Schema validation does not replace bounded normalizers or native source qualification.

### Constants, descriptors, and wire vocabulary

RpcProtocol supplies the identity migaia.rpc and current major/minor 1.1. RpcCodecId maintains codec labels such as json. RpcCapability maintains versioned names such as ping@1, batch@1, stream@1, runtime-api@1, group@1, and transfer@1. Independent implementations must use the same wire values.

RpcPeerRuntime has keys such as node, bun, deno, electron, python, rust, go, and java. A valid runtime string such as browser does not imply a browser constant key exists. RpcEnvelopeKind, RpcRouteField/Key/Profile/Type, RpcWireLimit, RpcStreamLimit, and RpcWireErrorLimit own envelope, route, and budget vocabulary. Route fields include timeoutMs, idempotencyKey, and trace. RpcRuntime* defines runtime-call data. Import RpcBinaryTag from wire; binary entries expose profile/storage/native-kind domains.

createDescriptor(id, version) returns a frozen exact identity. Both arguments are required without defaults; version must be a positive safe integer. Invalid descriptors retain TypeError with INVALID_DESCRIPTOR. A descriptor does not establish a connection or register a service.

### Portable snapshots and binary domains

Ordinary normalizePortable(value, depth?, active?) uses the wire domain. Value is required, depth defaults to 0, and an omitted active set is created for ancestors rather than global deduplication. RPC_PORTABLE_MAX_DEPTH is 64. Repeated objects in separate branches receive separate copies; only an ancestor back-edge is a cycle.

| Input                                                                                                          | Default wire result                                                               |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| null, booleans, strings, finite numbers including -0                                                           | Preserve the value                                                                |
| Ordinary or null-prototype records                                                                             | Frozen null-prototype copies; each enumerable own string-keyed field is read once |
| Arrays                                                                                                         | Normalize elements                                                                |
| Genuine Uint8Array                                                                                             | `{ $rpc: 'bytes', base64url }` with canonical unpadded base64url                  |
| ArrayBuffer, Date, Map, Set, class instances, functions, symbols, bigint, undefined, nonfinite numbers, cycles | Reject, normally as TypeError / INVALID_ENVELOPE                                  |

Undefined property values also fail. The reserved $rpc marker is accepted only for a complete valid bytes tag. Invalid alphabets, padding, or noncanonical trailing bits are not valid tags. Byte admission checks genuine internal slots, allowing other realms and legitimate Uint8Array subclasses without trusting forged toStringTag values or DataViews.

Ordinary wire traversal can execute record getters, capturing them once. This differs from strict runtime own-data validation below. Reflection/getter failures preserve their cause. The advanced native-guard overload invokes its guard without a receiver at native binary admission and preserves the thrown object; application callers rarely need to manage active or this guard.

A separate overload serves negotiated runtime native-binary data. It can retain ArrayBuffer/Uint8Array identities and uses strict own-data descriptors. This does not widen the default wire normalizer's return domain. ArrayBuffer transmission belongs to the binary profile, not ordinary portable input.

### Handshake offers and peer text

createRpcHello(offer) returns JSON text to send. acceptRpcHandshake(localOffer, hello) negotiates and returns an accepted agreement or a rejected reply/error. completeRpcHandshake(localOffer, reply) confirms the result. normalizeRpcHandshake(text) validates received handshake text. None of these functions sends data or authenticates a peer.

An offer requires peer, versions, codecs, and capabilities. peer.id/runtime describes the local participant; each version has major/minor. Codecs must include json and preserve preference order. Capabilities are unique versioned names; an empty list proposes no optional capabilities. Optional auth carries portable credentials for upper-layer validation, not proof that authentication succeeded. Agreement.peer always describes the other side.

Negotiation selects the highest shared major, the lower shared minor, the first common codec in initiator order, and the capability intersection in initiator order. An incompatible version or codec yields ok false and a reject reply from the responder. The initiator receives HANDSHAKE_REJECTED, potentially with HANDSHAKE_INCOMPATIBLE on cause. Invalid UTF-8, JSON, fields, or selections produce HANDSHAKE_INVALID rather than an automatic downgrade.

Public handshake causes may be bounded frozen redaction summaries. Credential-bearing raw text, objects, and engine JSON excerpts are not unconditionally retained. A verified clean native decoder/getter failure can still retain its exact identity. Classify by source/code rather than depending on raw input echoes.

### Byte-stream framing

The native prefix and JSON-RPC Content-Length formats are different and cannot be mixed.

| Format                                            | Operations and failure model                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Four-byte unsigned network-order length + payload | encodeRpcStreamFrame; createRpcStreamFrameDecoder delivers onFrame and reports its first protocol failure through onError before termination |
| ASCII Content-Length header + UTF-8 JSON          | encodeJsonRpcFrame; createJsonRpcFrameDecoder.push returns complete values, while invalid push/finish operations throw bridge errors         |

The native encoder requires a nonempty Uint8Array payload. RPC_STREAM_MAX_FRAME_BYTES is 16 MiB. Empty or invalid payloads produce INVALID_FRAME; oversize produces FRAME_LIMIT_EXCEEDED. Decoder options require both onFrame(frame) and onError(error), without defaults. push accepts arbitrary splits and copies input into its owned frame storage, allowing the caller to reuse chunks. finish checks partial EOF and terminates this decoder; close discards state. Calling close/finish from onFrame stops remaining delivery from the current chunk.

createRpcStreamFrameDecoderWithLimit(options, maxFrameBytes) reads the current limit before each allocation, supporting smaller handshake budgets. Both callbacks and the limit function are caller-supplied. Bootstrap and handshake receivers process the first frame and queue later data before activation, without owning a connection.

Content-Length uses actual UTF-8 byte length rather than JavaScript string length. Its decoder has no constructor arguments; push may return no messages or several, and bufferedBytes reports retained bytes. JsonRpcLimit has headerBytes 1024, bodyBytes 16 MiB, and handshakeMs 10000. Malformed/duplicate/missing headers, invalid UTF-8/JSON, or partial EOF produce JSONRPC_FRAME_INVALID. Here finish only checks leftovers and **does not close the decoder**. close clears it and makes later push calls return an empty array. Do not apply native-prefix onError/termination semantics to this decoder.

### Message framers and assembly ownership

createStringFramer(options?) and createBinaryFramer(options?) provide a descriptor, encoded-type labels, frame(value, context), accept(frame, context), and close(reason?). Context requires source and messageId. The carrier supplies source to separate equal message identifiers from different origins. frame returns physical frames. accept returns pending, complete/value, or rejected/error; categorized rejection results are not all thrown exceptions.

Options default to an empty object. Numeric fields must be positive safe integers.

| Field                   | Default   |
| ----------------------- | --------- |
| chunkBytes              | 16384     |
| maxMessageBytes         | 16777216  |
| maxChunks               | 4096      |
| maxBufferedBytes        | 67108864  |
| maxConcurrentMessages   | 256       |
| assemblyTimeoutMs       | 30000     |
| now / schedule / cancel | undefined |

chunkBytes cannot exceed maxMessageBytes, which cannot exceed maxBufferedBytes. Callers can supply schedule(callback, delayMs) and cancel(handle); otherwise available host setTimeout/clearTimeout are used. The package does not invent timer support when the host lacks it.

The now field is retained but does not drive assembly expiry; changing a fake now alone does not advance the timer. The framer owns its timers and should be closed by its owner. Complete messages and fragments both enforce maxMessageBytes. String limits use UTF-16 code units despite byte-oriented option names; binary limits use byteLength. Inspect encoded physical UTF-8 size separately with inspectRpcPhysicalFrame(value, limit).

Fragments must satisfy first-chunk, order, count, and total-length rules. Late, duplicate, expired, or oversized input is rejected. Assemblies use the source/messageId pair rather than ambiguous delimiter concatenation. The caller handles result dispatch; the framer sends no network data and does not authenticate source.

Timers are detached before cancellation, so reentrant close does not cancel twice. Unclassified schedule/warn failures receive CALLBACK_FAILED. Cancel failures reach available host reportError or utils' host exception queue, preserving the cleanup primary and reporter secondary without replacing a completed frame result. Physical inspection measures actual encoded frames; splitBatch divides splittable batches in half, while an oversized single message fails with RangeError.

remoteProcessStringFramer preserves existing complete-string carrier boundaries without fragmentation. Nonstring input retains TypeError with INVALID_FRAME.

### Runtime, streams, and Decoded trust

normalizeRuntimeEnvelope validates live received runtime records through own data properties, rejecting accessors without invoking them. Runtime request/notify/stream/group vocabulary belongs to runtime. createRuntimeCallEnvelope in runtime/metadata constructs outbound call headers; normalizeRuntimeGeneration and normalizeRuntimeSteps validate generations and group steps. Steps must form a nonempty dense own-data array; there is no separate fixed step-count limit, and physical byte budgets remain independent.

normalizeRuntimeEnvelopeDecoded and restoreRpcBinaryDecoded are for fresh output of this package's codec that no other code has touched. They preserve data grammar, first-error behavior, and frozen metadata while omitting full descriptor checks, so hand-built getters can execute. Ordinary prototype checks still apply: structuredClone preserving Date/Map does not make them records. Use strict variants for uncertain input. Decoded is not a public trust flag. In runtime/lazy, scalar paths may return synchronously and stream paths may return a Promise; callers support both.

normalizeStreamPayload validates payloads. checkRpcStreamSequence/Progress/ConsumerCredit/ProducerCredit check consecutive sequence, progress, consumer credit, and producer busy state. Success returns undefined; protocol failure returns a coded Error for the caller to report, terminate, or cancel. Do not assume it was thrown. checkRpcRuntimeStreamTransition/Intent compares termination or early control against start options. These helpers do not schedule producers, transmit data, or replay delivered items.

### Binary capture, manifests, restoration, and budgets

prepareRpcBinary(envelope, storage, limit?, digest?, codec?) creates manifests, native sidecars, and totals. restoreRpcBinary validates manifests/integrity before restoring data. Its Decoded variant has the preceding trust restriction. The binary/lazy entry captures data before loading the full codec and computes its first digest when the native branch requires one.

Native storage charges the complete backing ArrayBuffer. Inline storage charges offset + visibleLength, copies visible bytes only, and preserves a zero prefix. Limit does not unconditionally cover every manifest metadata field. The native + encode-only codec prehash branch separately checks the full physical frame. Inline and other codec paths leave physical frame limits to that codec or the caller.

The digest parameter is optional, but native storage requires a caller-supplied real SHA-256 over each complete backing; inline storage needs no digest. An omitted limit defaults to 16 MiB, and restoration sidecars default to an empty array []. The optional final codec handles metadata. binary/inspect helpers such as assertRpcNativeBinaryFrameSize charge complete backings, read native binary, and classify integrity failures. They do not choose a transport or release remote resources.

### Error trees, native classes, and JSON-RPC mapping

serializeRpcError(value, options, metadata?) requires value and options.report. The callback receives { pointer, field, error } for omitted property-read or normalization failures; its count is not a complete truncation count. The bounded tree has source/code/name/message/stack and optional cause/errors/data/route/truncated. Unclassified thrown values use unknown/UNKNOWN. Cross-realm native names and sender stacks survive projection. deserializeRpcError validates before restoring Error, RangeError, TypeError, and other supported classes, retaining sender stack text.

RpcWireErrorLimit is maxNesting 48, maxEmbeddingDepth 16, maxNodes 1024, maxStringBytes 65536, and maxBytes 1048576. Budget/text truncation can cut content and mark truncated without reporting every cut. Cyclic edges are removed. reachRpcError(value, { report }) walks cause, errors, and cleanup failures with reference deduplication; RpcErrorReachLimit.maxObjects is 4096.

normalizeRpcSerializedError(value, options?) defaults options to an empty object. unknownFields is reject by default or ignore; onUnknownField is optional without a callback default. deserializeRpcError(value, options?, routes?) uses those rules; routes can expose a caller-owned WeakMap set capability to retain admitted route diagnostics. Serialization reads its fixed fields rather than arbitrary own properties. An unreadable field can be reported while preserving the root and marking truncation.

Optional metadata.summaries and metadata.routes are WeakMap get capabilities keyed by Error references. Summaries supply an outward code/message while hiding internal causes; preserveSerializedError: true retains existing descendants. Routes are bounded diagnostics without control authority.

toJsonRpcError(wire, code) stores the tree in error.data.migaiaWireError. The caller selects the integer JSON-RPC code; it is not automatically the wire string code. fromJsonRpcError also accepts ordinary errors without that extension, using foreignSource jsonrpc-2.0 and the integer code as a string. RpcJsonRpcWireError.dataKey owns the extension name. Independent adapters use their own source/code. They can install utils directly and use attachErrorIdentity to retain native errors rather than impersonating official RPC sources.

classifyRpcContractError recognizes only exact local references issued by this package and returns their outward code/message. Copies or deserialized remote errors return undefined. Remote source/code is diagnostic identity, not proof of local origin or authority to retry/control an operation.

schema/wire-error is a structural starting point, not the complete bounded normalizer. Independent implementations also enforce x-migaia-limits, canonical base64url, and surrogate rules. Schema additionalProperties does not match default normalizer rejection. A native peer in another language also needs prefix framing, handshake, and runtime envelopes. The JSON-RPC bridge needs its four extension methods, owned by the rpc-plugin-process protocol layer rather than a connection implementation here.

### Error identity and maintenance

Contract errors retain the semantic source `rpc.contract`, exported as `RPC_CONTRACT_SOURCE`, and use RpcContractErrorCode for the code.

| Code                   | Native type and trigger                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| CALLBACK_FAILED        | Error by default; native callbacks retain their class and original identity/cause |
| INVALID_DESCRIPTOR     | TypeError; invalid descriptor identity/configuration                              |
| INVALID_ENVELOPE       | TypeError; invalid envelope or portable value                                     |
| INVALID_STREAM         | TypeError; invalid stream field, sequence, credit, or value                       |
| INVALID_FRAME          | RangeError; invalid frame grammar, empty payload, or physical batch               |
| FRAME_LIMIT_EXCEEDED   | RangeError; physical or assembly budget exceeded                                  |
| FRAME_ASSEMBLY_EXPIRED | RangeError; incomplete fragments expired                                          |
| INVALID_WIRE_ERROR     | TypeError; invalid error tree, potentially with pointer/violation/cause           |
| HANDSHAKE_INVALID      | TypeError; invalid encoding, JSON, or handshake fields                            |
| HANDSHAKE_INCOMPATIBLE | Error; incompatible version, codec, or required capability                        |
| HANDSHAKE_REJECTED     | Error; remote rejection, with controlled cause                                    |

Shape errors retain native classes. Mutable callback errors are tagged in place without stack rewriting; immutable/non-Error values stay on cause. Complete upstream source/code identities retain their owner. Fatal UTF-8 decoder errors remain on HANDSHAKE_INVALID/INVALID_FRAME causes.

The bridge source is `rpc.contract.jsonrpc`, exported as JSONRPC_BRIDGE_ERROR_SOURCE. JsonRpcBridgeErrorCode contains JSONRPC_FRAME_INVALID, JSONRPC_EXTENSION_MISSING, JSONRPC_PROFILE_INVALID, JSONRPC_UNSUPPORTED_MODE, and JSONRPC_HANDSHAKE_TIMEOUT for framing, extensions, profile, mode, and handshake timing. Do not classify bridge errors as the contract source.

Other layers use `rpc.endpoint` (RPC_CORE_ERROR_SOURCE / RpcCoreErrorCode), `rpc.remote` (RPC_REMOTE_ERROR_SOURCE / RpcRemoteLayerErrorCode), `rpc.transport.process` (RPC_PROCESS_ERROR_SOURCE / RpcProcessErrorCode), and `rpc.transport.thread` (RPC_THREAD_ERROR_SOURCE / RpcThreadErrorCode). Branch on source/code; message is presentation text rather than retry policy.

```bash
pnpm --filter @migaia/rpc-contract run fmt
pnpm --filter @migaia/rpc-contract run lint
pnpm --filter @migaia/rpc-contract run typecheck
pnpm --filter @migaia/rpc-contract run typecheck:test
pnpm --filter @migaia/rpc-contract run test
```

The existing test script includes coverage. Results require actual execution. Independent implementations should follow published constants, schemas, and normalizer boundaries; use an upper RPC package when only calling a peer is needed.
