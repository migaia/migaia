# `@migaia/rpc-contract`

[简体中文](./README.md)

Give RPC values, messages, handshakes, fragments, and error trees a shared data boundary, so independent carriers and languages follow the same wire rules.

## You may have run into this

- Validated payloads still change because original references or shallow copies retain nested records and bytes.
- NaN becomes null before sending because JSON conversion is mistaken for value validation.
- A receiver gets only an error message because native classes, semantic codes, and cause stacks were dropped.
- An error getter destroys the diagnostic because field-read failures have no separate reporting path.
- Equal message identifiers mix data from different peers because assembly state has no source dimension.

## Why choose it

- **Capture a payload at validation time.** A shallow copy aliases nested records and bytes, while normalizePortable copies records and encodes bytes so later mutations cannot change its snapshot [Runnable proof](./USEGUIDE.en.md#capture-data-before-the-caller-changes-it).
- **Reject invalid numbers instead of replacing their meaning.** JSON changes NaN to null, while portable traversal checks descendants and explicitly rejects nonfinite numbers and cycles [Runnable proof](./USEGUIDE.en.md#reject-values-that-cannot-preserve-their-meaning-on-the-wire).
- **Keep the original error chain recognizable across boundaries.** Sending only message drops classes and stacks, while the error tools retain semantic codes, native classes, and sender cause stacks [Runnable proof](./USEGUIDE.en.md#preserve-native-error-classes-and-remote-cause-stacks).
- **Retain evidence for unreadable error fields.** A direct property read can break logging, while serializeRpcError gives the original read failure to required report and continues its bounded tree [Runnable proof](./USEGUIDE.en.md#report-unreadable-error-fields-without-losing-the-wire-error).
- **Separate equal message identifiers by source.** A map keyed only by messageId can merge peers, while the framer owns assembly state for each source/message pair [Runnable proof](./USEGUIDE.en.md#keep-equal-message-identifiers-from-different-peers-separate).

## Start here

Capture a payload, then change its caller-owned source. This performs local normalization without sending a request. Value is required; omitted depth/active starts at depth 0 with this traversal’s ancestor set.

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

For silently changed values, see [explicit value rejection](./USEGUIDE.en.md#reject-values-that-cannot-preserve-their-meaning-on-the-wire). For remote errors reduced to text, see [native classes and cause stacks](./USEGUIDE.en.md#preserve-native-error-classes-and-remote-cause-stacks).

## Pitfalls when writing it yourself

Native JSON can encode values, but it does not establish this protocol’s value domain or snapshot boundary. This illustration is type-checked only and is not run:

```ts doc-test=check
const source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }
const snapshot = { ...source } // Pitfall: shallow copying still shares profile and the byte array.
const text = JSON.stringify({ ...snapshot, total: Number.NaN }) // Pitfall: NaN becomes null instead of failing validation.
const received = JSON.parse(text) as typeof source // Pitfall: a type assertion validates neither records nor binary meaning.
void received
```

normalizePortable captures and validates under shared rules before later encoding or transport. Native JSON remains sufficient for a local document when its conversion semantics are intended.

## A three-minute mental model

| Problem                                               | Tool                                    |
| ----------------------------------------------------- | --------------------------------------- |
| Capture values another language can represent         | normalizePortable                       |
| Transfer and inspect original error causes            | serializeRpcError / deserializeRpcError |
| Negotiate versions, codecs, and capabilities          | handshake entry                         |
| A carrier delivers discrete string/binary messages    | Message framers in framing              |
| A carrier delivers arbitrary byte chunks              | framing/stream or framing/jsonrpc       |
| Validate runtime, stream control, or binary manifests | runtime / stream / binary entries       |

Portable is the value domain the protocol can represent. An envelope adds kind and route metadata around a payload. A framer defines message boundaries and assembles fragments. Source is the origin identifier supplied by a carrier. A codec converts data to an encoded value. A sidecar carries native binary beside a manifest. These tools are not a connection, authenticator, or request executor.

## Typical scenarios

| Scenario                                                     | Compose with         | Details                                                                                           |
| ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| Capture data before the caller changes it                    | `normalizePortable`  | [Complete example](./USEGUIDE.en.md#capture-data-before-the-caller-changes-it)                    |
| Reject values that cannot preserve their meaning on the wire | `normalizePortable`  | [Complete example](./USEGUIDE.en.md#reject-values-that-cannot-preserve-their-meaning-on-the-wire) |
| Preserve native error classes and remote cause stacks        | `serializeRpcError`  | [Complete example](./USEGUIDE.en.md#preserve-native-error-classes-and-remote-cause-stacks)        |
| Report unreadable error fields without losing the wire error | `serializeRpcError`  | [Complete example](./USEGUIDE.en.md#report-unreadable-error-fields-without-losing-the-wire-error) |
| Keep equal message identifiers from different peers separate | `createStringFramer` | [Complete example](./USEGUIDE.en.md#keep-equal-message-identifiers-from-different-peers-separate) |
| Reject out-of-order chunks and close partial assemblies      | `createStringFramer` | [Complete example](./USEGUIDE.en.md#reject-out-of-order-chunks-and-close-partial-assemblies)      |

## Installation

```bash
pnpm add @migaia/rpc-contract
```

Runtime dependencies are serialize and utils, without peers. The scenarios use only public entries and require no connection, server, or I/O. Directly install another package in the consuming project when importing its independent API.

## Essential APIs

| API                                                        | When to use it                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| normalizePortable                                          | Capture and validate default wire business values          |
| serializeRpcError / deserializeRpcError                    | Preserve error chains and native classes across boundaries |
| createRpcHello / acceptRpcHandshake / completeRpcHandshake | Produce and confirm handshake negotiation                  |
| createStringFramer / createBinaryFramer                    | Fragment and assemble discrete carrier messages            |
| createRpcStreamFrameDecoder / createJsonRpcFrameDecoder    | Handle the corresponding byte-stream boundaries            |
| normalizeRuntimeEnvelope / normalizeStreamPayload          | Validate runtime envelopes or stream payloads              |

## Contract details

### Responsibilities, dependencies, and entries

This package defines RPC wire data and provides construction, validation, normalization, and framing. It opens no connection, executes no remote method, owns no Endpoint, and binds to neither Node nor DOM/Worker APIs. Stateful framers own bounded assembly buffers and expiry timers only. Runtime dependencies are `@migaia/serialize` and `@migaia/utils`, without peer dependencies.

Ordinary TypeScript callers usually use it through rpc-core, where this package is a peer dependency. Independent-language peers, carrier adapters, and cross-boundary error handling are its direct consumers. rpc-process reuses Content-Length framing and error conversion; serialize owns the underlying portable traversal and error-chain implementation.

| Public entry                                                        | Purpose                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@migaia/rpc-contract`                                              | Common constants, V1 envelopes, handshake, portable values, and error tools           |
| `./wire`                                                            | Wire constants/types plus pure operations such as measurePortableStreamValue          |
| `./portable`                                                        | Wire-portable normalization and its depth constant                                    |
| `./errors`                                                          | Error projection, restoration, validation, JSON-RPC mapping, and local classification |
| `./handshake`                                                       | Hello/accept/reject construction, negotiation, and validation                         |
| `./v1`, `./framing/v1`                                              | Protocol 1.x envelopes and message framing                                            |
| `./framing`                                                         | String/binary fragmentation, assembly, and physical frame inspection                  |
| `./framing/stream`                                                  | Four-byte network-order length prefixes and bootstrap/handshake receivers             |
| `./framing/jsonrpc`                                                 | Content-Length byte framing and bridge error codes                                    |
| `./runtime`, `./runtime/metadata`, `./runtime/lazy`                 | Runtime envelopes, call headers, generations/steps, and lazy loading                  |
| `./stream`                                                          | Stream payload, sequence, progress, credit, and control-state checks                  |
| `./binary`, `./binary/lazy`, `./binary/capture`, `./binary/inspect` | Binary capture, preparation, restoration, manifests, integrity, and size              |
| `./schema/wire-error`                                               | Published wire-error JSON Schema                                                      |

These are the root and 18 subentries; the schema entry is a JSON file. Do not import internals. V1 uses named rpcProtocol and normalizeRpcEnvelope exports without a default aggregate; the root calls its protocol object rpcProtocolV1. createReassembler and IRpcReassembler were removed: use the original framer.accept/close or Pick their method types. Complete-string carriers use remoteProcessStringFramer. The bare processStringFramer is internal, without a compatibility alias.

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

prepareRpcBinary(envelope, storage, limit?, digest?, codec?) creates manifests, native sidecars, and totals. restoreRpcBinary validates manifests/integrity before restoring data. Its Decoded variant has the preceding trust restriction. captureRpcBinaryData captures synchronously for later prepare. The lazy entry captures data before loading the full codec and computes its first digest when the native branch requires one.

Native storage charges the complete backing ArrayBuffer. Inline storage charges offset + visibleLength, copies visible bytes only, and preserves a zero prefix. Limit does not unconditionally cover every manifest metadata field. The native + encode-only codec prehash branch separately checks the full physical frame. Inline and other codec paths leave physical frame limits to that codec or the caller.

The digest parameter is optional, but native storage requires a caller-supplied real SHA-256 over each complete backing; inline storage needs no digest. An omitted limit defaults to 16 MiB, and restoration sidecars default to an empty array []. The optional final codec handles metadata. binary/inspect helpers such as assertRpcNativeBinaryFrameSize charge complete backings, read native binary, and classify integrity failures. They do not choose a transport or release remote resources.

### Error trees, native classes, and JSON-RPC mapping

serializeRpcError(value, options, metadata?) requires value and options.report. The callback receives { pointer, field, error } for omitted property-read or normalization failures; its count is not a complete truncation count. The bounded tree has source/code/name/message/stack and optional cause/errors/data/route/truncated. Unclassified thrown values use unknown/UNKNOWN. Cross-realm native names and sender stacks survive projection. deserializeRpcError validates before restoring Error, RangeError, TypeError, and other supported classes, retaining sender stack text.

RpcWireErrorLimit is maxNesting 48, maxEmbeddingDepth 16, maxNodes 1024, maxStringBytes 65536, and maxBytes 1048576. Budget/text truncation can cut content and mark truncated without reporting every cut. Cyclic edges are removed. reachRpcError(value, { report }) walks cause, errors, and cleanup failures with reference deduplication; RpcErrorReachLimit.maxObjects is 4096.

normalizeRpcSerializedError(value, options?) defaults options to an empty object. unknownFields is reject by default or ignore; onUnknownField is optional without a callback default. deserializeRpcError(value, options?, routes?) uses those rules; routes can expose a caller-owned WeakMap set capability to retain admitted route diagnostics. Serialization reads its fixed fields rather than arbitrary own properties. An unreadable field can be reported while preserving the root and marking truncation.

Optional metadata.summaries and metadata.routes are WeakMap get capabilities keyed by Error references. Summaries supply an outward code/message while hiding internal causes; preserveSerializedError: true retains existing descendants. Routes are bounded diagnostics without control authority.

toJsonRpcError(wire, code) stores the tree in error.data.migaiaWireError. The caller selects the integer JSON-RPC code; it is not automatically the wire string code. fromJsonRpcError also accepts ordinary errors without that extension, using foreignSource jsonrpc-2.0 and the integer code as a string. RpcJsonRpcWireError.dataKey owns the extension name. Independent adapters use their own source/code. They can install utils directly and use attachErrorIdentity to retain native errors rather than impersonating official RPC sources.

classifyRpcContractError recognizes only exact local references issued by this package and returns their outward code/message. Copies or deserialized remote errors return undefined. Remote source/code is diagnostic identity, not proof of local origin or authority to retry/control an operation.

schema/wire-error is a structural starting point, not the complete bounded normalizer. Independent implementations also enforce x-migaia-limits, canonical base64url, and surrogate rules. Schema additionalProperties does not match default normalizer rejection. A native peer in another language also needs prefix framing, handshake, and runtime envelopes. The JSON-RPC bridge needs its four extension methods, owned by the rpc-process protocol layer rather than a connection implementation here.

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
