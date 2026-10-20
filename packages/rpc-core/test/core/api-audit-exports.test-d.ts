// @ts-expect-error nonce generation is owned by the internal authentication module.
import { createAuthenticationNonce } from '../../dist/core/index.js'
// @ts-expect-error use the canonical IRpcError contract.
import type { IRpcPublicError } from '../../dist/core/index.js'
// @ts-expect-error use IRpcPlatformValue from the canonical constant/type owner.
import type { IRpcPlatform } from '../../dist/core/index.js'
// @ts-expect-error use IRpcTransportTopologyValue from the canonical constant/type owner.
import type { IRpcTransportTopology } from '../../dist/core/index.js'
// @ts-expect-error middleware inference is private to the endpoint factories.
import type { IFactoryDiscoveryMode } from '../../dist/core/index.js'
// @ts-expect-error middleware inference is private to the endpoint factories.
import type { IFactoryPingCapability } from '../../dist/core/index.js'
// @ts-expect-error fluent return inference is private to the endpoint factories.
import type { IRecursiveProvideSurface } from '../../dist/core/composed.js'
// @ts-expect-error root projection is private to the endpoint factories.
import type { IRpcRootProjection } from '../../dist/core/composed.js'
// @ts-expect-error disposal projection is private to the endpoint factories.
import type { IRpcKernelSurface } from '../../dist/core/composed.js'

/** Using every negative import prevents unused-binding diagnostics from masking its export check. */
type IRemovedBindings = [
  IRpcPublicError,
  IRpcPlatform,
  IRpcTransportTopology,
  IFactoryDiscoveryMode<[]>,
  IFactoryPingCapability<[]>,
  IRecursiveProvideSurface<Record<never, never>>,
  IRpcRootProjection<Record<never, never>>,
  IRpcKernelSurface
]
/** Compile-only consumption, without invoking or recreating any retired operation. */
declare const removed: IRemovedBindings
void removed
void createAuthenticationNonce
