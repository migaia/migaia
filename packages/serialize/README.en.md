# `@migaia/serialize`

[中文](./README.md)

Separate format selection, value validation, framed encoding and parser cleanup from storage and transport code, with explicit paths for old archives, strict values and large arrays.

## You may have run into this

- A new format makes old archives unreadable because the old reader and saved format tag were discarded.
- Saving NaN turns it into null because native JSON conversion is being used as a business validation boundary.
- Three configuration exports disagree because each formatter validates and assembles its own data.
- Exporting configuration executes a getter because the code reads accessors before checking own data properties.
- A large export builds one complete string before any data can be consumed because encoding and consumption are not framed independently.

## Why choose it

- **New writes can coexist with old readers.** Replacing the sole parser loses an old format; registry writes through its first plugin and reads through the saved type’s parser. [Run the example](./USEGUIDE.en.md#write-a-new-format-while-retaining-an-explicit-old-reader).
- **Nonfinite numbers do not silently become null.** Native JSON makes that substitution; the versioned JSON codec’s portable profile rejects it explicitly. [Run the example](./USEGUIDE.en.md#reject-a-nonfinite-count-instead-of-saving-null).
- **Three text formats share one admission policy.** Handwritten formatting can change retained fields; emitOutput validates and projects plain data for JSON/YAML/TOML. [Run the example](./USEGUIDE.en.md#export-the-same-configuration-in-three-text-formats).
- **Configuration getters are rejected before reading.** Copying or stringify invokes accessors; emitOutput checks descriptors first, leaving the rejected getter’s read count at zero. [Run the example](./USEGUIDE.en.md#reject-an-accessor-without-evaluating-it).
- **Array slices arrive as independent encoded frames.** Whole-array encoding waits for a complete result; encodeStream produces slices with bounded in-flight requests for incremental receivers. [Run the example](./USEGUIDE.en.md#process-independent-array-slices-without-joining-json-documents).

## Start here

Register the JSON plugin, encode settings and read them through the same registry:

```ts doc-test=run
import { createSerializeRegistry, jsonPlugin, chunkToText } from '@migaia/serialize'

const registry = createSerializeRegistry([jsonPlugin()])
const chunk = await registry.encode({ theme: 'dark' })
const restored = (await registry.decode(chunk)) as { theme: string }
console.log('format:', registry.primaryType)
console.log('text:', chunkToText(chunk, new TextDecoder()))
console.log('theme:', restored.theme)
await registry.dispose()
```

Output:

```text
format: json
text: {"theme":"dark"}
theme: dark
```

For format migration, see [retaining an old reader](./USEGUIDE.en.md#write-a-new-format-while-retaining-an-explicit-old-reader); for large arrays, see [independent encoded frames](./USEGUIDE.en.md#process-independent-array-slices-without-joining-json-documents).

## Pitfalls when writing it yourself

A settings round trip is simple; evolving formats also need explicit reader selection and field policy. This example is displayed and type-checked only; it is not executed:

```ts doc-test=check
const saved = { chunk: JSON.stringify({ theme: 'dark', localCache: 'preview' }) } // Pitfall: no separate format tag identifies the reader.
const restored = JSON.parse(saved.chunk) as { theme: string } // Pitfall: the type assertion does not remove the runtime cache field.
console.log(JSON.stringify(restored))
```

Registry centralizes parser registration and selection, while a JSON replacer can remove localCache explicitly. Applications still save the format tag separately; chunks do not embed type automatically. Use the tagged entry when the encoded value itself must carry its codec identity. Native APIs suffice for a single ordinary JSON round trip.

## A three-minute mental model

| Problem                                                 | Tool                                        |
| ------------------------------------------------------- | ------------------------------------------- |
| Select plugin formats and own parser cleanup            | Registry with jsonPlugin or a custom parser |
| Enforce a cross-format data domain and version identity | Independent codec factories                 |
| Export complete JSON/YAML/TOML configuration text       | emitOutput                                  |
| Consume a large array incrementally                     | encodeStream / decodeStream                 |
| A destination truly needs one complete result           | collectStream                               |

A “chunk” pairs a representation label with a payload. A “parser” encodes, decodes and optionally disposes resources. A “plugin” binds a format type to a parser; the “registry” selects and owns them. “Portable” names the accepted cross-format value domain. “Backpressure” limits outstanding work. A “frame” is decoded independently rather than being an arbitrary substring of one document.

## Typical scenarios

| Scenario                                                        | Tools                     | Details                                                                                              |
| --------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Encode settings and read them back                              | `createSerializeRegistry` | [Complete example](./USEGUIDE.en.md#encode-settings-and-read-them-back)                              |
| Write a new format while retaining an explicit old reader       | `createSerializeRegistry` | [Complete example](./USEGUIDE.en.md#write-a-new-format-while-retaining-an-explicit-old-reader)       |
| Reject a nonfinite count instead of saving null                 | `defineJsonCodec`         | [Complete example](./USEGUIDE.en.md#reject-a-nonfinite-count-instead-of-saving-null)                 |
| Export the same configuration in three text formats             | `emitOutput`              | [Complete example](./USEGUIDE.en.md#export-the-same-configuration-in-three-text-formats)             |
| Reject an accessor without evaluating it                        | `emitOutput`              | [Complete example](./USEGUIDE.en.md#reject-an-accessor-without-evaluating-it)                        |
| Process independent array slices without joining JSON documents | `encodeStream`            | [Complete example](./USEGUIDE.en.md#process-independent-array-slices-without-joining-json-documents) |

## Installation

```bash
pnpm add @migaia/serialize
```

Runtime dependencies are @migaia/lifecycle and @migaia/utils. Optional peers for MessagePack, CBOR and Protobuf have separate installation sections below.

The encodeStream scenario below also requires a direct @migaia/utils dependency in the consuming project, because it explicitly imports that package’s scheduler entry.

```bash
pnpm add @migaia/utils
```

## Essential APIs

| API                                  | When to use it                                 |
| ------------------------------------ | ---------------------------------------------- |
| createSerializeRegistry / jsonPlugin | Own format selection and parser cleanup        |
| registry.encode / registry.decode    | Write the default format and read by type      |
| defineJsonCodec                      | Use versioned JSON with strict portable values |
| emitOutput                           | Produce complete JSON/YAML/TOML text           |
| encodeStream / decodeStream          | Process independently encoded array slices     |
| registry.close / registry.dispose    | Stop admission and finish cleanup              |

## Contract details

### Entry points and dependency boundaries

This package owns value representations, chunks, formats and codec lifecycles. Storage, Worker, HTTP and SSR hosts belong to consumers. The root combines core, plugins and registry, and adds format constants, emitOutput, createPortableWalker and codec-related types.

| Entry                                | Public surface                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| @migaia/serialize/core               | Chunk/parser/context/registry contracts, SerializeCodecError, error helpers, Base64 and stream tools with their types. |
| @migaia/serialize/plugins            | jsonParser, jsonPlugin and IJsonPluginOptions.                                                                         |
| @migaia/serialize/registry           | createSerializeRegistry, chunkToText, chunkToBytes and registry/context/parser/Encoding/cleanup types.                 |
| @migaia/serialize/codec              | ICodec, ICodecValue, CodecErrorText, portable factory/default helpers and normalizeCodecFailure.                       |
| @migaia/serialize/codecs/identity/v1 | The only public identityCodec entry, preserving runtime identity and concrete TypeScript types.                        |
| @migaia/serialize/codecs/json        | defineJsonCodec and IJsonCodecOptions, without loading binary-format runtimes.                                         |

Core statically reuses @migaia/lifecycle/abort as its cancellation owner. Packed consumers retain the necessary abort closure while unrelated lifecycle root, scope, scheduler, generation, quiescence and disposal modules can be removed. Core takes timers and Encoding capabilities through injection. It does not export the registry implementation, chunk-conversion helpers, JSON plugins or root format constants. Registry uses lifecycle scheduler/abort/scope/quiescence; byte algorithms and error identity come from @migaia/utils. Dependencies do not point back to Store, RPC or UI.

Import IAbortSignal from @migaia/utils/promise; serialize does not re-export it. The structural contract has aborted, optional reason, addEventListener and removeEventListener, without requiring DOM types. Native AbortSignal satisfies it. Root, codec and JSON codec consumers need none of the following optional peers.

### @migaia/serialize/codecs/protobuf

This entry provides defineProtobufCodec, IProtobufCodecOptions and IProtobufSchema. It requires optional peer @bufbuild/protobuf in the supported range ^2.14.0.

```bash
pnpm add @bufbuild/protobuf
```

Without that peer, Node import of this entry fails with ERR_MODULE_NOT_FOUND mentioning @bufbuild/protobuf. Other entries remain loadable.

### @migaia/serialize/codecs/message-pack

This entry provides defineMessagePackCodec and IMessagePackCodecOptions. It requires optional peer @msgpack/msgpack in the supported range ^3.1.3.

```bash
pnpm add @msgpack/msgpack
```

Without that peer, Node import of this entry fails with ERR_MODULE_NOT_FOUND mentioning @msgpack/msgpack. Other entries remain loadable.

### @migaia/serialize/codecs/cbor

This entry provides defineCBORCodec and ICborCodecOptions. It requires optional peer cbor-x in the supported range ^1.6.6.

```bash
pnpm add cbor-x
```

Without that peer, Node import of this entry fails with ERR_MODULE_NOT_FOUND mentioning cbor-x. Other entries remain loadable.

### Chunks, parsers and format constants

ISerializeChunk is a read-only pair: text carries a string, bytes carries Uint8Array, and value carries an already-completed unknown business value. Text and bytes have wire representations; value has no implicit text or byte form. ISerializeChunkKind is the union of those three labels.

ISerializeParser requires name, encode(value, context) and decode(chunk, context), with optional dispose(). Encode can return a chunk, a Promise of one chunk, a synchronous Iterable or an AsyncIterable. Decode returns a value or Promise. ISerializeOutput names that four-way encoding-output union. A synchronous parser can return directly without creating its own Promise. ISerializeContext contains the composed signal and diagnostic context string. The field is context rather than the old source name, keeping it distinct from error ownership. ISerializePlugin pairs type with parser.

registry.encode collects one parser output into one chunk. All-text chunks join as text. Once bytes appear, text is encoded and the output is assembled as bytes. A value chunk must be the only output: combining it with anything produces INVALID_CHUNK. Zero chunks produce ENCODE_FAILED. Incremental admission records actual chunkIndex and bytesConsumed and checks cancellation before consumption. Failed async iteration invokes iterator.return; secondary cleanup failures go to report without replacing the primary failure.

isChunkShape distinguishes a single chunk from a chunk container: it requires an array of length two whose first item is a string. It does not validate the label. Later validation distinguishes unknown labels, non-string text data and non-Uint8Array bytes. Boundary tuple fields are captured facts rather than values to reinterpret through repeated later reads.

Root constants and value unions use canonical domains: SerializeChunkKind/ISerializeChunkKind are text/bytes/value; SerializeOutput/ISerializeOutputFormat are text/structured/binary; SerializeTextFormat/ISerializeTextFormat are json/yaml/toml; SerializePhase/ISerializePhase are encode/decode; SerializeCleanupPolicy/ISerializeCleanupPolicy are throw/report; SerializeCleanupKind/ISerializeCleanupKind are cleanup-error/drain-timeout; SerializePluginType/ISerializePluginType are json. These labels neither emit instrumentation events nor introduce error codes.

### Registry creation and admission

createSerializeRegistry(plugins, options?) requires a nonempty plugin array. The first type becomes primaryType. Each type is an ASCII token of 1–64 characters, starting with a letter/digit and continuing with letters, digits, dots, underscores or hyphens. SERIALIZE_TYPE_PATTERN is /^[a-z0-9][a-z0-9._-]{0,63}$/i. assertSerializeType rejects invalid tokens with RangeError/INVALID_OPTION. HTML and archive-envelope writers still need correct escaping; token validation is not output escaping.

Types must be unique. Each parser needs callable encode/decode, and dispose must be callable when supplied. Empty lists and duplicate types produce RangeError/INVALID_OPTION; malformed structures produce TypeError/INVALID_OPTION. Plugin lists, fields and methods are admitted before ownership transfers. Later input mutation cannot replace captured behavior. Failed admission invokes neither parser work nor parser cleanup and creates no partially owned parser set to roll back. Options default to an empty object and must be an object or function when supplied.

| Registry option | Default and behavior                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scheduler       | systemScheduler from @migaia/utils/scheduler, fixed at creation. Requires callable now/schedule and finite now results.                                                                         |
| encoder         | Host TextEncoder. An injected capability must implement encode(string): Uint8Array; omission with no host implementation produces ENV_UNSUPPORTED.                                              |
| decoder         | Host TextDecoder. Injection requires decode(Uint8Array): string; omission without host support produces ENV_UNSUPPORTED. Captured and validated here, not automatically passed to JSON parsers. |
| cleanup         | { policy: 'throw' }, or { policy: 'report', report } with a callable reporter.                                                                                                                  |
| onDrainTimeout  | No-op observer when a deadline is already past, or expires with work pending; pendingCount can be zero.                                                                                         |
| report          | No-op observer for failures arriving after public settlement and secondary iterator cleanup failures.                                                                                           |

Option getters, scheduler operations and Encoding capability boundaries retain original causes rather than leaking unclassified property-access failures. scheduler.schedule(callback, delayMs) returns a task with cancel() and optional unref(). Core timer use does not read global timer functions.

### Registry operations and closing

primaryType is the first format. types lists registered types in order; has(type) checks membership. encode(value, options?) and decode(chunk, options?) return Promises. Operation type defaults to primaryType, context to anonymous and signal to omission. The parser receives a composition of caller and internal closing signals: the first observed cancellation wins. Unknown formats produce CODEC_NOT_FOUND with context fixed to registry. ISerializeRegistry names the returned interface and ISerializeRegistryOptions the construction options.

Decode first checks closing, then finds the requested format, then validates the chunk. The corresponding failure priority is REGISTRY_DISPOSED, CODEC_NOT_FOUND, INVALID_CHUNK. Closed-registry failures are tagged native Errors rather than necessarily SerializeCodecError instances. Even if a parser ignores signal, the framework rejects on cancellation and discards late output; that does not forcibly terminate synchronous computation or an external task.

close() is synchronous and idempotent: it denies new operations and aborts current ones without disposing parsers. dispose(options?) closes first, drains, then awaits each parser disposer. Sharing one parser under several types still disposes that instance once. Repeated dispose calls return the first Promise by identity.

The sole disposal option deadlineAt defaults to undefined. A supplied value must be a finite absolute time in the scheduler.now clock domain. The first admitted call fixes it; later calls cannot replace it. The deadline bounds draining, not parser cleanup. If the deadline is already past or expires while waiting, onDrainTimeout can receive { kind: 'drain-timeout', source, deadlineAt, pendingCount } before cleanup continues. pendingCount can be zero. A drain timeout is a diagnostic event rather than a new error code. ISerializeTimeoutDiagnostic describes it; ISerializeCleanupError describes cleanup-failure events.

Signal state is rechecked immediately after listener registration without depending on host event replay. An already-closing internal signal takes precedence at entry. Cancellation causes retain identity, and failing signal reads produce INVALID_OPTION. Public Promises can reject promptly while registry still tracks the underlying parser task; close itself does not wait.

With cleanup.policy throw, cleanup failure rejects disposal. If another primary failure already exists, secondary failures stay in errors, using AggregateError when necessary to retain all originals. Report policy emits { kind: 'cleanup-error', source, error } while allowing normal settlement. Diagnostic callback failures cannot rewrite an already-published result; report failures reach the shared utils host-error path. Detached task failures remain observed without rejoining a closed lifecycle. Omitting report retains the existing no-op policy.

### JSON plugins and chunk conversion

jsonParser(options?) returns a parser named json; jsonPlugin(options?) returns a plugin of type json. IJsonPluginOptions replacer, reviver and space default to omission and feed JSON.stringify, JSON.parse and indentation respectively. The optional byte decoder falls back to the host TextDecoder. Options default to an empty object. Native JSON semantics are distinct from strict portable codec validation.

Encode returns text and rejects when stringify returns undefined. Native encoding failures receive ENCODE_FAILED. Decode returns value payloads unchanged, parses text directly and decodes bytes before parsing. Missing decoding capability produces ENV_UNSUPPORTED; parse failures receive DECODE_FAILED. A standalone parser also provides error identity. Annotatable native errors retain instance, type and stack; conflicting or non-extensible errors are retained as the cause of a coded TypeError wrapper.

chunkToText(chunk, decoder) and chunkToBytes(chunk, encoder) require their Encoding argument. The former returns text unchanged or decodes bytes. The latter encodes text or returns a slice copy of bytes, without sharing the original array. Both reject value chunks with TypeError/INVALID_CHUNK. Conversion failures are tagged at the decode/encode boundary with their causes retained.

### Stream slicing, backpressure and collection

sliceByFrameBudget(items, options) is an async generator over a read-only array. Options and scheduler are required; core provides no default global timer. On resumption after yield, it observes the consumer’s slice-processing time, estimates a next size using targetMs / max(elapsed, 0.05), averages that estimate with the current size and clamps to minItems/maxItems. This is cooperative slicing rather than a frame-rate guarantee on every device. IFrameBudgetOptions names slicing options, IEncodeStreamOptions adds encoding settings, and ICollectStreamOptions names collection policy. A custom yieldTo owns its Promise and cancellation behavior; its wait is not guaranteed to abort promptly.

| Slicing option | Default and constraint                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------- |
| targetMs       | 8; finite and greater than zero.                                                               |
| minItems       | 64; safe integer of at least one.                                                              |
| maxItems       | 250000; safe integer no smaller than minItems.                                                 |
| initialItems   | 2048; safe integer of at least one, clamped to the configured bounds.                          |
| yieldTo        | scheduler.schedule(resolve, 0) when omitted; the default wait responds to signal cancellation. |
| signal         | Omitted; checked before proceeding to the next slice.                                          |
| scheduler      | Required: finite now results and scheduled tasks with cancel().                                |

encodeStream(registry, items, options) adds type (registry default format), context (stream) and maxInFlight (1, a positive safe integer) to those options. It calls registry.encode independently for each slice and yields in input order. maxInFlight bounds concurrent encoding requests. Adjacent JSON array slices are not one complete JSON document: decode frames separately and combine arrays in the application when that is the intended result.

decodeStream(registry, chunks, options?) accepts a synchronous or asynchronous chunk iterable. Options default to an empty object, type to the registry format, context to stream and signal to omission. It decodes and yields each frame without assembling the complete result. Stream encoding/decoding failures wrap ENCODE_FAILED/DECODE_FAILED with the outer frame index, bytesConsumed zero and the inner error on cause. That position differs from the parser’s internal chunk index.

Stream entry points capture options before acquiring an iterator, so admission failures are not mislabeled as iteration failures. Cancellation is rechecked across async boundaries. Early source/generator completion closes its owned iterator; secondary return failures are reported without replacing the primary failure. An early encodeStream break cancels operations it created and observes outstanding tasks without waiting forever for uncooperative parser code. Registry disposal still owns parser draining.

collectStream(chunks, encoder?, options?) is for consumers that actually need one complete result; it retains the whole output. Signal defaults to omission, empty defaults to text (returning ['text', ''] for an empty stream), the other empty policy is reject, and context defaults to stream. All-text data joins as text. A single byte chunk can return directly; multiple chunks with any bytes require an explicit encoder, even when all are bytes. Without it, ENV_UNSUPPORTED is raised; core does not read a global TextEncoder. Value chunks always produce INVALID_CHUNK. Malformed tuples retain chunkIndex and accumulated bytesConsumed, source iteration failures become ENCODE_FAILED, and abort preserves cancellation identity with iterator cleanup handled at its boundary.

### Base64 and byte-only text channels

bytesToBase64(Uint8Array) returns complete RFC 4648 Base64. base64ToBytes(string) requires canonical padding and valid unused trailing bits. Invalid input produces TypeError/INVALID_OPTION whose cause retains the original utils INVALID_ENCODING failure. This differs from unpadded base64url used by portable tags.

streamBase64Chunks(bytes) is a lazy synchronous Generator, yielding pieces without assembling one full string. Empty input yields none. Its internal block length is 32763 bytes, divisible by three so padding cannot corrupt an intermediate boundary; block size is not an option. Algorithms come from utils/bytes without constructing a whole binary string or using btoa/atob. Use bytesToBase64 when the destination requires one string, and keep bytes as bytes when the destination supports them. The 4/3 size expansion is a format property, not a performance measurement.

### Versioned codecs

`ICodec<TValue, TEncoded, TId, TVersion>` has read-only id, version, encodedType, encode and decode. Encode/decode are function properties preserving strict parameter variance. TId defaults to string and TVersion to number. encodedType is unknown/string/uint8array. A synchronous codec is a different contract from an asynchronous registry parser. identityCodec fixes id=identity, version=1 and encodedType=unknown; both functions preserve the exact value and concrete type. The old alias and unversioned identity entry are removed.

defineJsonCodec, defineMessagePackCodec and defineCBORCodec require a positive safe-integer options.version and return frozen codecs. IDs are json, message-pack and cbor; outputs are string, Uint8Array and Uint8Array respectively. All three use the same portable projection/validation. JSON, collections JSON, CBOR and MessagePack project fields in Object.keys enumeration order without comparison sorting; getters run once in that order. MessagePack uses no extensions. CBOR disables records and host extensions, converting decoded bigint integers to numbers only when they are exact safe integers; otherwise it rejects.

defineProtobufCodec requires version, schema and binding. schema.id matches /^[a-z][a-z0-9.-]*$/u and schema.version is a positive safe integer independent of codec.version. Binding must be a generated Buf DescMessage rather than custom encode/decode hooks. The returned schema identity is frozen, values use `MessageShape<TBinding>`, and encodedType is uint8array. Encode/decode validate genuine Uint8Array data and preserve original Buf failure causes. Factories provide no storage or network envelope.

ICodecValue’s static domain contains null, boolean, number, string, nested read-only arrays and records; finite numbers still require runtime checks. normalizeCodecFailure(error, code, message) preserves errors already owned by serialize and wraps other failures in TypeError with cause. CodecErrorText owns stable version, schema, encoding, decoding and portable-rejection diagnostics.

### Portable defaults and the reusable walker

toPortableValue(value, active?) is the legacy intermediate projection rather than a final assertion. It follows Object.keys property enumeration order and recursively produces mutable ordinary objects without freezing. Uint8Array becomes { $rpc: 'bytes', base64url }. Inherited, nonenumerable and symbol record fields are omitted. Getters may run. Repeated sibling references are copied independently, while cycles are checked on the active ancestor path. Projection can temporarily retain undefined/NaN; codecs reject them during final portable validation.

assertPortableValue(value, active?) returns void. asCodecValue(value) validates and returns the same object narrowed to ICodecValue. Neither copies nor freezes. The default decoded profile rejects nonfinite numbers, undefined, functions, symbols, bigint, Date/Map/Set, invalid arrays and native bytes. Recognized byte tags retain the existing character-set checks rather than a different protocol’s stricter canonical-bit policy. Default depth is unlimited. Legacy projections of ArrayBuffer/class objects are not general-purpose safe snapshots.

Import createPortableWalker from root or codec, create it once per module/owner and reuse it. walk(value, active?, initialDepth?, beforeNativeBinary?) returns { value, byteUpperBound, hasBinary }; walk.value uses the same recursion but returns only the value. Active is the caller’s ancestor Set, otherwise created as needed for the call, with no retained graph afterward. Initial depth defaults to zero; the root is depth zero and only depth greater than maxDepth fails. The optional native-binary guard belongs to that invocation rather than global registration.

| Strategy hook                                                                | Responsibility                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| scalar(value, context)                                                       | Required. Returns a primitive or { value, violation? }, preserving deferred-failure precedence.                                                        |
| binary(value, context)                                                       | Required. Returns inline base64url text, borrowed Uint8Array/ArrayBuffer, or undefined for container admission.                                        |
| nativeByteLength(value)                                                      | Required for native results; reads intrinsic lengths rather than caller-shadowed properties.                                                           |
| record(value, context)                                                       | Required. Returns { entries, output?, tag?, hasBinary?, validate? } or undefined. Entries may be captured or lazy; omitting output validates in place. |
| array(value, visit, context)                                                 | Optional. Returns the array or { value, length?, violation? }; defaults to map, with captured length avoiding another read.                            |
| arrayValue(value, ownedVisit, childDepth, ancestors, guard, bounds, context) | Mutually exclusive with array. Returns the raw projection through the provided traversal’s lexical ownership, without implementing another recursion.  |
| maxDepth                                                                     | Unlimited by default; the strategy chooses its budget.                                                                                                 |
| key(key, context)                                                            | Optional reserved-field check before visiting a child.                                                                                                 |
| write(output, key, child)                                                    | Optional. Default defineProperty keeps own `__proto__` data from changing the output prototype.                                                        |
| finish(value, hasNativeBinary)                                               | Optional container finalization such as freezing; native leaves are neither copied nor frozen and do not call finish.                                  |
| violation(reason, cause?)                                                    | Required. Throws a caller-owned coded native error retaining the original cause and stack.                                                             |

Context supplies reject, isAncestor, isUint8Array, bytesToBase64url, isCanonicalBase64url and optional beforeNativeBinary. Generic reasons include depth/cycle/access/ancestor; strategies own other reasons. Context is for synchronous hook use. Classified errors retain identity; application callback failures go through violation('access', original), and caller ancestor-Set failures retain their existing boundary.

byteUpperBound is a conservative JSON UTF-8 bound rather than an exact length: up to six escape bytes per UTF-16 unit, up to 32 per number, plus container punctuation and byte tags. Value, bound and hasBinary are fused in one traversal without rescanning the input. Strategies supply native lengths; this value is not a complete shared-backing/offset protocol budget.

IPortableBinaryResult is the unboxed union string/Uint8Array/ArrayBuffer. Borrowed native objects retain exact identity without copying/freezing. The second finish argument proves only native descendants; hasBinary also includes inline tags and grants no protocol permission. Reentrant getters restore outer accounting and active paths. Completed calls retain no caller graph, and the value-only array path does not add output-length observations.

Default JSON/MessagePack/CBOR remain inline-only with existing wire bytes and failure precedence: projection finishes before deferred validation fails, so a later getter failure can still take precedence. RPC’s null prototypes, freezing, parent-field capture, depth 64, canonical tags and protocol identities belong to rpc-contract strategies. Serialize embeds no consumer profile, manifest or native-negotiation owner.

### Safe text output

emitOutput(value, format?) synchronously returns complete text. Format defaults to json, with yaml/toml alternatives. JSON reuses jsonParser. YAML/TOML are output-only without third-party runtimes, and are not registry parsers.

Inputs contain finite numbers, strings, booleans, arrays and plain own-data records. JSON/YAML accept null. Descriptor admission rejects enumerable accessors without evaluating them, along with cycles, sparse arrays, named array properties, enumerable symbols, unsupported values and nonplain prototypes. No toJSON, replacer or business getter is invoked. Failure returns no partial string and diagnostics do not echo input.

TOML requires a record root and rejects null at every depth as well as unpaired surrogates. Keys/strings are quoted and nested collections retain their shapes. Negative zero becomes -0.0; unsafe integers use floating-point spelling instead of the TOML integer domain. Failures are tagged native TypeError/INVALID_OPTION with read failures retained as causes. These strict own-data rules differ from legacy portable projection.

### Error identity, positions and troubleshooting

SerializeCodecError(message, details) requires code, type, phase, chunkIndex and bytesConsumed, with optional context, source and cause. Source defaults to serialization and TCode to ISerializeErrorCode; consumers can reuse the class with their own code union/source. Phase is encode/decode and cause retains the original object. Codec failures and native construction/lifecycle failures use different carriers, so branch on (source, code) rather than instanceof alone.

| SerializeErrorCode member | Code and boundary                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| registryDisposed          | REGISTRY_DISPOSED: new work after close/dispose, tagged Error.                                                 |
| codecNotFound             | CODEC_NOT_FOUND: unregistered format, SerializeCodecError with context=registry.                               |
| encodeFailed              | ENCODE_FAILED: encoding, empty output or stream iteration failure, retaining cause.                            |
| decodeFailed              | DECODE_FAILED: parsing or frame decoding fails.                                                                |
| invalidChunk              | INVALID_CHUNK: invalid tuple/label/data, mixed value output or value-to-wire conversion.                       |
| aborted                   | ABORTED: cooperative cancellation; SerializeCodecError or tagged native error depending on the boundary.       |
| invalidOption             | INVALID_OPTION: invalid plugin, version, portable input, scheduler, stream option, Base64 or output admission. |
| envUnsupported            | ENV_UNSUPPORTED: required host capabilities such as Encoding are unavailable.                                  |
| tagMissing                | TAG_MISSING: raw input has no explicit untagged reader.                                                        |
| tagInvalid                | TAG_INVALID: reserved header is malformed; no fallback.                                                        |
| tagUnknown                | TAG_UNKNOWN: valid tag has no registered codec revision.                                                       |

tagSerializeError(error, code, context?) returns the original error with read-only source/code. Omitted context stays absent. Repeating the same identity is idempotent, with context filled only once. Identity conflicts delegate to utils and throw (foundation.utils, ERROR_IDENTITY_CONFLICT), retaining the original error on cause instead of silently overwriting ownership.

ISerializeTaggedError adds source/code/context to a native error type. ISerializeTypeError and ISerializeRangeError retain their native types; ISerializeLifecycleError also permits errors. createSerializeError, createSerializeTypeError and createSerializeRangeError create coded native Error/TypeError/RangeError. Code/message are required. Options default to omission and permit cause/context; the ordinary Error also permits a frozen errors snapshot. Codes are public API, and error factories never rewrite stack. Empty output reports zero progress. Malformed decode chunks report zero progress, while parser decode failures report that chunk’s byte count. Stream wrappers use outer frame positions without losing inner causes.

For value-to-wire or mixed-value failures, return to the business value rather than forcing a representation. For CODEC_NOT_FOUND inspect types and the saved type tag. REGISTRY_DISPOSED requires a new registry. Multi-chunk byte collection requires an explicit encoder. If exports still block, inspect initial slice size, bounds and yieldTo; slicing is not preemptive termination.

A complete workflow creates the registry, encodes independent frames into the real sink, decodes them individually at the receiver, reads old formats using saved type tags and writes the default primaryType. Apply UTF-8/Base64 only at an actual text boundary, then await dispose. A configured deadline limits draining only. Package scripts provide fmt, lint, typecheck, typecheck:test, test and a separate build; unverified historical measurements are not performance claims.

### Preserve Map and Set in JSON

Use the collection codec explicitly when values contain Map or Set. It shares the strict portable profile with JSON, adds recursive collections, projects enumerable class fields, and rejects nonfinite numbers, undefined, Date and cycles. Reserved $rpc records must have the exact bytes/map/set shape. Collection iteration preserves insertion order and uses intrinsic slots and iterators. Bytes remain bytes records after decoding; old collection tuples are ordinary data.

```ts
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'

const codec = defineCollectionsJsonCodec({ version: 1 })
const source = new Map([['roles', new Set(['read', 'write'])]])
const text = codec.encode(source)
console.log(text) // {"$rpc":"map","entries":[["roles",{"$rpc":"set","values":["read","write"]}]]}
console.log(codec.decode(text)) // Map { 'roles' => Set { 'read', 'write' } }
```

Format codecs and public toPortableValue both follow integer-index enumeration followed by string insertion order, including getter traversal. serialize does not sort keys; consumers own any required canonical ordering. RPC owned snapshots and ordinary object and byte JSON paths preserve each object's own key order. The existing private RPC snapshot owner still copies and computes the byte upper bound in one traversal, skipping already encoded binary subtrees.

### Carry a format tag in the encoded value

The first codec writes new values; every listed id/version can read its own tagged payload. An optional untagged codec only reads raw legacy values. Unknown tags fail with TAG_UNKNOWN; malformed reserved headers fail with TAG_INVALID and never fall back. A raw text value starting with mgt1: is interpreted as tagged input, even when it was produced by the untagged codec.

```ts
import { createTaggedCodec } from '@migaia/serialize/tagged'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const current = defineJsonCodec({ version: 2 })
const previous = defineJsonCodec({ version: 1 })
const tagged = createTaggedCodec({ codecs: [current, previous], untagged: previous })
console.log(tagged.encode({ count: 2 })) // mgt1:json@2;{"count":2}
console.log(tagged.decode('mgt1:json@1;{"count":1}')) // { count: 1 }
console.log(tagged.decode('{"count":1}')) // { count: 1 }
try {
  tagged.decode('mgt1:json@3;{"count":3}')
} catch (error) {
  console.log((error as Error & { code: string }).code) // TAG_UNKNOWN
}
```

String carriers prepend mgt1:<id>@<version>;. Byte carriers prepend 00 4d 47 54, framing byte 01, a two-byte big-endian UTF-8 tag length and the tag. Unknown carriers return a frozen object with own $migaia.codec and value fields; the inner value stays unfrozen. All codecs must declare the same carrier. The framing identity is tagged@1; it is separate from storage envelope versions. ICodecEncodedType, ITaggedCodecOptions, ITaggedEncoded, ITaggedValue and ITaggedCodec preserve carrier and business-value inference.
