import { expectTypeOf } from 'vitest'
import { WebRpcSharedKey } from '../../src/internal/plugin-shared-keys.js'
import type {
  IWebRpcAuthenticationPort,
  IWebRpcProtocolPort
} from '../../src/internal/plugin-shared-keys.js'
import type { IWebRpcPluginHostCore } from '../../src/internal/plugin-contract.js'

declare const hostCore: IWebRpcPluginHostCore
const protocol = hostCore.getShared(WebRpcSharedKey.protocol)

expectTypeOf(protocol).toEqualTypeOf<IWebRpcProtocolPort | undefined>()
// @ts-expect-error Shared ports are intentionally non-interchangeable.
const wrongPort: IWebRpcAuthenticationPort | undefined = protocol
void wrongPort
