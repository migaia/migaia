/** Keep removed aliases and private authentication helpers outside the published Host root. */
// @ts-expect-error nonce generation is owned by the internal authentication module.
import { createAuthenticationNonce } from '@migaia/rpc-host'
// @ts-expect-error use the canonical IRpcError contract.
import type { IRpcPublicError } from '@migaia/rpc-host'
// @ts-expect-error Carrier platform values belong to the contract interfaces, outside the Host root.
import type { IRpcPlatform } from '@migaia/rpc-host'
// @ts-expect-error Carrier topology values belong to the contract interfaces, outside the Host root.
import type { IRpcTransportTopology } from '@migaia/rpc-host'

/** Using every negative import prevents unused-binding diagnostics from masking its export check. */
type IRemovedBindings = [IRpcPublicError, IRpcPlatform, IRpcTransportTopology]
/** Compile-only consumption, without invoking or recreating any retired operation. */
declare const removed: IRemovedBindings
void removed
void createAuthenticationNonce
