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

Use `prepareRpcBinary` from `@migaia/rpc-contract/binary`, or `prepareRpcBinaryLazy` from `./binary/lazy`, with a runtime envelope, selected storage, byte limit and actual whole-backing digest. Both return the canonical manifest, original native sidecars and backing byte total. `restoreRpcBinary` and its lazy counterpart validate the manifest and native integrity before returning runtime protocol data.

For a capture point that precedes later preparation, call `captureRpcBinaryData` from `./binary/capture` and retain its opaque resource. Its `prepare()` completes the captured graph through the sole canonical codec; it exposes no mutable capture DTO or trusted/completion flags. Inline bytes are captured at construction; native storage deliberately retains the original backing identities.

A custom metadata codec can supply an actual `IRpcBinaryDataCodec` resource as the final prepare argument. `encode` produces its actual metadata representation. Optional `captureJsonData` receives canonical encoded roots and returns its actual JSON-ready value without walking those business roots again, and owns that codec representation's quota policy; `encodeInline` is its actual byte encoder. The prepare limit bounds binary backing allocation; a whole capture resource enforces its actual metadata representation quota. Encode-only resources retain exact metadata measurement. These data operations are responsible for accurate output, just as the supplied digest is responsible for actual SHA-256. They never establish Core transport trust, replay receipt or execution authority. Raw capture sinks and prehash/finish callbacks are internal.

## Caller-held error metadata

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

Restoration writes a validated route to the supplied actual route map at the original registration point and also keeps Contract's own generic roundtrip metadata. Neither API exposes metadata registrars. `RpcContractErrorDiagnostic.frameLimitExceeded` is immutable source/code/message data for failure classification, not an error factory.

## Protocol error classification

`classifyRpcContractError(error)` classifies only the exact error raised by this Contract instance. Protocol implementers and diagnostic UIs can use its immutable code/text policy to present a controlled violation without traversing a hostile local cause. It reads no error getters; foreign values and copied errors return `undefined`. It grants no transport, replay or codec authority. `serializeRpcError` applies the same policy to Contract errors. For errors owned by Core/Remote, use the ordinary Core error operations so their private redaction and forwarding routes remain available.

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
