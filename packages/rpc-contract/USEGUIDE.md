# Usage

```ts
import { rpcProtocolV1 } from '@migaia/rpc-contract'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import rpcV1, { rpcProtocol } from '@migaia/rpc-contract/v1'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
```

`rpcProtocolV1.normalize()` validates untrusted semantic envelopes. The versioned `rpcV1` default is a frozen
aggregate of `rpcProtocol` and `normalizeRpcEnvelope`; its named `rpcProtocol` is the same V1 identity.
`messageFramer` is the modern V1 whole-message identity framer, while retained `messageFramerV1` is the same object.
Fixed `createStringFramer` and `createBinaryFramer` entries validate their selected carriers and do not place chunk metadata in semantic messages.
# V1 semantic contract

```ts
import rpcV1, { rpcProtocol } from '@migaia/rpc-contract/v1'

const protocol = rpcProtocol
const sameProtocol = rpcV1.rpcProtocol === protocol
```

Root exports remain available with their existing V1 identities.
