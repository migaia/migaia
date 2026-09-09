# @migaia/rpc-contract

Runtime-neutral semantic RPC descriptors, portable values, hostile-safe envelope normalization, and whole-message framing contracts.

The package has no dependency on transports, runtimes, codecs, workers, or Store. Format codecs live in `@migaia/serialize`.

## V1 semantic contract

```ts
import rpcV1, { normalizeRpcEnvelope, rpcProtocol } from '@migaia/rpc-contract/v1'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'

const envelope = rpcProtocol.normalize({ kind: 'request', id: '1', method: 'ping', data: null })
const sameProtocol = rpcV1.rpcProtocol === rpcProtocol
const sameFramer = messageFramer === messageFramerV1
const normalized = normalizeRpcEnvelope(envelope)
```

The frozen default `rpcV1` aggregates the named V1 exports. Root `rpcProtocolV1` and
`normalizeRpcEnvelope`, plus `messageFramerV1`, remain the same runtime identities for existing callers.
