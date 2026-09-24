import { expectTypeOf } from 'vitest'
import { WebRpcPortName } from '../../src/internal/plugin-shared-keys.js'
import type {
  IWebRpcAuthenticationPort,
  IWebRpcProtocolPort
} from '../../src/internal/plugin-shared-keys.js'
import type { IWebRpcPluginCore } from '../../src/internal/plugin-contract.js'

declare const hostCore: IWebRpcPluginCore
const protocol = hostCore.getPort(WebRpcPortName.protocol)

expectTypeOf(protocol).toEqualTypeOf<IWebRpcProtocolPort | undefined>()
// @ts-expect-error Shared ports are intentionally non-interchangeable.
const wrongPort: IWebRpcAuthenticationPort | undefined = protocol
void wrongPort
