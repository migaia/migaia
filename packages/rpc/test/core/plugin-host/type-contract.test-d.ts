import { expectTypeOf } from 'vitest'
import { RpcPortName } from '../../../src/core/internal/plugin-shared-keys.js'
import type {
  IRpcAuthenticationPort,
  IRpcProtocolPort
} from '../../../src/core/internal/plugin-shared-keys.js'
import type { IRpcPluginCore } from '../../../src/core/internal/plugin-contract.js'

declare const hostCore: IRpcPluginCore
const protocol = hostCore.getPort(RpcPortName.protocol)

expectTypeOf(protocol).toEqualTypeOf<IRpcProtocolPort | undefined>()
// @ts-expect-error Shared ports are intentionally non-interchangeable.
const wrongPort: IRpcAuthenticationPort | undefined = protocol
void wrongPort
