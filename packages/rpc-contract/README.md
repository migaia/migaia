# @migaia/rpc-contract

Runtime-neutral RPC protocol toolkit. It depends only on Utils and the existing Serialize package. It creates protocol data and framing resources; the runtime packages own native I/O, authentication, replay, execution and lifecycle rights.

| Entry | Ordinary capability |
| --- | --- |
| `@migaia/rpc-contract` / `./v1` | Descriptors, protocol 1.1 envelopes, portable data, coded error wire trees |
| `./wire` / `./portable` | Stable wire domains and portable-data normalization |
| `./runtime`, `./runtime/lazy`, `./runtime/metadata` | Runtime envelopes, selectors and generation/step metadata |
| `./handshake` | Hello, accept, completion and handshake normalization |
| `./stream` | Stream payload grammar and actual held sequence/credit validation |
| `./framing`, `./framing/v1` | Message framing, reassembly, ingress binding and physical batch accounting |
| `./framing/stream` | Incremental length-prefixed decoding and protocol receive resources |
| `./framing/jsonrpc` | Content-Length encoding/decoding and stable JSON-RPC source/code identities |
| `./binary`, `./binary/capture`, `./binary/lazy`, `./binary/inspect` | Binary capture, prepare, restore, integrity and full native backing accounting |
| `./errors` | Error serialization/restoration with caller-held presentation and route maps |

For a custom byte carrier, feed its actual chunks to `createJsonRpcFrameDecoder()` or `createRpcStreamFrameDecoder()`. For a carrier that already delivers complete strings, use `processStringFramer` or `remoteProcessStringFramer`. The latter checks unknown inputs and preserves the canonical native error identity.

Binary preparation snapshots business data synchronously, retains original native backing identities, and completes through the original codec. The light `./binary/lazy` entry exports the same `prepareRpcBinary` and `restoreRpcBinary` names and keeps the first native digest ahead of cold codec loading. `./runtime/lazy` likewise exports the canonical normalizer names. `captureRpcBinaryData` holds captured data in an opaque resource and exposes only its complete `prepare()` operation. A held `IRpcBinaryDataCodec` provides ordinary encoding and optional JSON-data capture; raw prehash, finish and registration callbacks are internal.

Protocol error source names remain stable semantic identities across the physical package split. Error factories, execution proofs and metadata writers are private. Caller-held maps select wire presentation for exact Error references; copying wire fields does not grant runtime rights.

See [USEGUIDE](./USEGUIDE.md) for custom carrier and error-resource examples. Package and consumer gates are controlled by the split implementation task; this documentation does not claim they have passed.

Public source/code tables and wire-error operations support protocol implementers and adapter authors. Human-readable diagnostic tables are private; `normalizeRuntimePortable` and `hasRpcPortableBinary` remain internal pending Serialize phase B. `classifyRpcContractError` queries an actual local violation's disclosure policy without reading error getters; copied or foreign errors have no classification. Contract errors use the protocol serializer, while Core/Remote error redaction and routes use the ordinary Core error operations. See USEGUIDE for the source table, wire schema and third-party adapter example.
