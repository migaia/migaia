# Protocol toolkit usage

## Custom JSON-RPC byte carrier

```ts
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '@migaia/rpc-contract/framing/jsonrpc'

/** The application supplies actual byte writes and consumes decoded protocol messages. */
export function createCarrierProtocol(
  write: (frame: Uint8Array) => Promise<void>,
  receive: (message: unknown) => void
) {
  const decoder = createJsonRpcFrameDecoder()
  return {
    send: (message: unknown) => write(encodeJsonRpcFrame(message)),
    push: (chunk: Uint8Array) => {
      for (const message of decoder.push(chunk)) receive(message)
    },
    finish: () => decoder.finish(),
    close: () => decoder.close()
  }
}
```

The framer owns Content-Length, strict UTF-8 and JSON grammar. The carrier owns native reads, writes and closure. Malformed frames retain the existing `@migaia/rpc/bridge/jsonrpc` source and coded error chain; the carrier handles those failures at its existing I/O boundary. The toolkit also normalizes handshake data without exposing its diagnostic redaction helpers.

## Length-prefixed and complete-message carriers

`@migaia/rpc-contract/framing/stream` provides the four-byte network-order frame encoder and incremental decoder. `createRpcStreamFrameDecoderWithLimit` reads the carrier's live phase limit before allocating a frame. `createRpcBootstrapFrameReceiver` retains the first bootstrap payload and the original pre-activation queue behavior. `createRpcHandshakeFrameReceiver` owns strict text decoding and the single-control-frame grammar; `accept` returns business text, an actual protocol Error, or `undefined` for a retained handshake. Caller role getter exceptions remain thrown. The carrier decides its own terminal action and uses its original reason with `close`.

A carrier with complete string messages uses `processStringFramer` or `remoteProcessStringFramer` from `@migaia/rpc-contract/framing`. These preserve the carrier's message boundary and do not add chunk framing.

## Stream implementations

Normalize the received payload with `normalizeStreamPayload` from `@migaia/rpc-contract/stream`. The same entry checks the actual held protocol sequence, pending consumer credit and producer busy state. Pass the original payload and state references to `checkRpcStreamSequence`, `checkRpcStreamProgress`, `checkRpcStreamConsumerCredit` or `checkRpcStreamProducerCredit`; each returns the original coded Error or `undefined`. Read short-circuit order is retained. The implementation chooses its existing report, throw, cancellation and iterator cleanup action.

`checkRpcRuntimeStreamTransition` checks a real finish control against its actual start options. `checkRpcRuntimeStreamIntent` checks an already retained early-control discriminator. Neither record conveys native ownership or execution permission.

`inspectRpcPhysicalFrame(value, limit)` from `./framing` measures the actual encoded frame once. Its `bytes` can drive the original quota decision, and `splitBatch(actualMembers)` bisects an oversize batch without another sizing walk. An oversize singleton keeps the native Contract RangeError. `assertRpcNativeBinaryFrameSize` from `./binary/inspect` accounts for actual protected metadata, sidecar count and complete backing bytes with one canonical measurement.

## Binary protocol data

`normalizePortable` from `@migaia/rpc-contract/portable` snapshots the existing wire domain: ordinary records become frozen null-prototype copies, parent getters run once before child traversal, arrays retain their wire map semantics, and byte views become canonical unpadded base64url tags. `RPC_PORTABLE_MAX_DEPTH` stays 64. Contract's module-level wire and native strategies use Serialize's single canonical traversal; callers keep the existing API and error handling. Negotiated native handling and exact-reference binary proofs remain internal Contract responsibilities.

Use `prepareRpcBinary` from `@migaia/rpc-contract/binary`, or the same canonical name from `@migaia/rpc-contract/binary/lazy`, with a runtime envelope, selected storage, byte limit and actual whole-backing digest. Both return the canonical manifest, original native sidecars and backing byte total. The selected entry also exports `restoreRpcBinary`, which validates the manifest and native integrity before returning runtime protocol data. The light entry retains synchronous capture and the first native digest before loading the full codec; it introduces no second operation name.

For cold receive paths, import `normalizeRuntimeEnvelope` or `normalizeStreamPayload` from `@migaia/rpc-contract/runtime/lazy` and await the result. Scalar runtime messages do not load the full stream parser. The ordinary `./runtime` and `./stream` entries keep their existing synchronous contracts. Package-internal code imports its light implementation file directly.

For a capture point that precedes later preparation, call `captureRpcBinaryData` from `./binary/capture` and retain its opaque resource. Its `prepare()` completes the captured graph through the sole canonical codec; it exposes no mutable capture DTO or trusted/completion flags. Inline bytes are captured at construction; native storage deliberately retains the original backing identities.

A custom metadata codec can supply an actual `IRpcBinaryDataCodec` resource as the final prepare argument. `encode` produces its actual metadata representation. Optional `captureJsonData` receives canonical encoded roots and returns its actual JSON-ready value without walking those business roots again, and owns that codec representation's quota policy; `encodeInline` is its actual byte encoder. The prepare limit bounds binary backing allocation; a whole capture resource enforces its actual metadata representation quota. Encode-only resources retain exact metadata measurement. These data operations are responsible for accurate output, just as the supplied digest is responsible for actual SHA-256. They never establish Core transport trust, replay receipt or execution authority. Raw capture sinks and prehash/finish callbacks are internal.

## Advanced usage: Caller-held error metadata

```ts
import {
  serializeRpcError,
  deserializeRpcError,
  type IRpcErrorWireSummary
} from '@migaia/rpc-contract/errors'

/** The application owns these actual Error-reference resources and its diagnostic policy. */
export function projectFailure(error: Error, report: (failure: unknown) => void) {
  const summaries = new WeakMap<Error, IRpcErrorWireSummary>()
  const routes = new WeakMap<Error, readonly string[]>()
  const wire = serializeRpcError(
    error,
    { report: ({ error: failure }) => report(failure) },
    {
      summaries,
      routes
    }
  )
  return deserializeRpcError(wire, undefined, routes)
}
```

Populate summaries with the application's registered code and stable message for exact Error references. A summary normally projects only the original five error fields and omits cause/data/route; `preserveSerializedError: true` preserves that node's ordinary bounded chain. Original stack handling remains unchanged. Summary maps are read at the original summary selection point; route maps are read after the fixed error fields, so reentrant updates remain visible.

Restoration writes a validated route to the supplied actual route map at the original registration point and also keeps Contract's own generic roundtrip metadata. Neither API exposes metadata registrars. Classify a physical quota failure with `RPC_CONTRACT_SOURCE` and `RpcContractErrorCode.frameLimitExceeded`; no diagnostic text table is public.

## Public errors for protocol implementers and adapter authors

Protocol implementers use `@migaia/rpc-contract/errors` for the language-neutral error tree. Adapter authors use the ordinary Core error operations and family guards described in the Core USEGUIDE, so Core's private presentation and forwarding-route metadata remain available. Neither audience constructs Core-owned failures by copying identity fields.

The stable semantic sources keep their pre-split strings. Import the source and code table from the public owner and branch on both fields. Human-readable messages, `*ErrorText` and `*Diagnostic` tables are private presentation. Their removal is a breaking change of the renamed packages; message text is not a recovery or retry contract.

| Public owner | Source constant | Code table | Third-party use |
| --- | --- | --- | --- |
| `@migaia/rpc-contract` / `./errors` | `RPC_CONTRACT_SOURCE` (`@migaia/rpc/contract`) | `RpcContractErrorCode` | Reject an invalid envelope, frame, handshake or error tree with the matching protocol failure. |
| `@migaia/rpc-core` | `RPC_CORE_ERROR_SOURCE` (`@migaia/rpc/core`) | `RpcCoreErrorCode` | Classify Core operation failures; use the Core family guards across realms or module copies. |
| `@migaia/rpc-core/remote` | `RPC_REMOTE_ERROR_SOURCE` (`@migaia/rpc/remote`) | `RpcRemoteLayerErrorCode` | Reconcile a Remote closed generation or an unknown result before another business call. |
| `@migaia/rpc-process` | `RPC_PROCESS_ERROR_SOURCE` (`@migaia/rpc/process`) | `RpcProcessErrorCode` | Report native launch, connection and Process lifecycle failures. |
| `@migaia/rpc-threads` | `RPC_THREAD_ERROR_SOURCE` (`@migaia/rpc/threads`) | `RpcThreadErrorCode` | Report an unavailable native Worker resource sample without inventing a measurement. |
| `@migaia/rpc-bridge-jsonrpc` / `@migaia/rpc-contract/framing/jsonrpc` | `JSONRPC_BRIDGE_ERROR_SOURCE` (`@migaia/rpc/bridge/jsonrpc`) | `JsonRpcBridgeErrorCode` | Close or recreate the actual foreign-language connection after a framing, profile or handshake failure. |

`IRpcSerializedError` is the public schema: required `source`, `code`, `name`, `message`, and `stack`; optional `cause`, `errors`, portable `data`, bounded node `route`, and `truncated: true`. Import the matching language-neutral JSON schema from `@migaia/rpc-contract/schema/wire-error` with a JSON import attribute, or resolve that ordinary subpath to read the unchanged shipped artifact. `serializeRpcError` creates a bounded immutable tree and requires a `report` sink for failures it omits. `normalizeRpcSerializedError` validates received trees; `deserializeRpcError` preserves the transferred stack and native error family. `reachRpcError` traverses local causes and aggregate entries with identity deduplication. `RpcWireErrorField`, `RpcWireErrorViolation`, `RpcWireErrorUnknownFieldMode`, `RpcWireErrorFallback`, `RpcWireErrorLimit` and `RpcErrorReachLimit` let foreign implementations follow the same grammar, field order, fallback and limits. A restored diagnostic identity does not grant lifecycle, replay or retry rights.

`toJsonRpcError(wire, integerCode)` puts the validated tree under `RpcJsonRpcWireError.dataKey`. The foreign protocol owns that safe integer code.

`fromJsonRpcError` restores the extension, or represents an ordinary foreign JSON-RPC error using `RpcJsonRpcWireError.foreignSource` and the integer's string form.

These operations do not change JSON-RPC transport or cancellation behavior.

Third-party adapters attach their own source and codes through `@migaia/utils/error`. Keep those declarations with the adapter; never claim a Core source. Core retains the original object, or keeps it reachable as `cause`, along its existing failure path.

```ts
import { attachErrorIdentity } from '@migaia/utils/error'
import { serializeRpcError, toJsonRpcError } from '@migaia/rpc-contract/errors'

/** The application owns this adapter identity and its diagnostic wording. */
const ADAPTER_SOURCE = '@example/electron-carrier'
/** A failed native write is distinct from any Core timeout or terminal decision. */
const AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const
/** This adapter's message never quotes native payload bytes. */
const AdapterErrorText = { writeFailed: 'adapter write failed' } as const

/** Project the original native cause using this adapter's own registered identity. */
export function writeFailure(cause: unknown, report: (failure: unknown) => void) {
  const error = attachErrorIdentity(new Error(AdapterErrorText.writeFailed, { cause }), {
    source: ADAPTER_SOURCE,
    code: AdapterErrorCode.writeFailed
  })
  const wire = serializeRpcError(error, { report: ({ error: failure }) => report(failure) })
  return { error, wire, jsonrpc: toJsonRpcError(wire, -32000) }
}
```

`classifyRpcContractError(error)` additionally serves custom error projectors that must query the disclosure policy of an exact locally raised Contract error without reading any error properties. It reads only the private exact-reference registry and returns an immutable summary; foreign values and copied errors return `undefined`. The code table has no exact-reference policy, while serialization reads the fixed error fields and reports failed getters, so neither replaces this operation. The summary does not mint errors or confer operation authority. For Core/Remote failures, use Core's ordinary wire operations; public family guards are diagnostic classification rather than proof that Core minted an error.

```ts
import { classifyRpcContractError, normalizeRpcEnvelope } from '@migaia/rpc-contract'

try {
  normalizeRpcEnvelope({})
} catch (error) {
  const diagnostic = classifyRpcContractError(error)
  if (!diagnostic) throw error
  console.error(diagnostic.code, diagnostic.message)
}
```
