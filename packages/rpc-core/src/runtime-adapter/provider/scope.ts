import type {
  IRpcIdempotencyConfig,
  IRpcProviderLimits,
  IRpcIdempotencyStore
} from '../../core/index.js'
import { createRpcIdempotencyStore } from '../../core/index.js'
import { retainRuntimeIdempotencyScope } from '../../core/internal/provider.js'
import {
  createProviderAdmissionScope,
  type IProviderAdmissionScope
} from '../../core/features/provider.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { tagRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import type { IRemoteChannel } from '../../remote/index.js'
import { runtimeConnectionPrincipal } from '../byte/connection-identity.js'
import { RuntimeAdapterErrorText } from '../byte/error-text.js'

/** One constructed scope owns its existing shared store and generic provider admission resource. */
export type IRuntimeProviderScope = Readonly<{
  admission: IProviderAdmissionScope
  session(
    channel: IRemoteChannel,
    limits: IRpcProviderLimits
  ): Readonly<{
    idempotency: IRpcIdempotencyConfig
    limits: IRpcProviderLimits
  }>
  close(): void
}>

/** Derive stable principal keys only from Core-constructed, authenticated connection identities. */
export function createRuntimeProviderScope(
  inputStore?: IRpcIdempotencyStore
): IRuntimeProviderScope {
  /** Callers may select the existing store without asserting principal or provider provenance. */
  const store = inputStore ?? createRpcIdempotencyStore()
  /** This random registration prefix isolates the same principal held by separate service owners. */
  const scopePrefix = defaultRpcId()
  /** All actual sessions share this canonical admission owner instead of parallel per-socket queues. */
  const admission = createProviderAdmissionScope()
  return Object.freeze({
    admission,
    session(channel, limits) {
      /** No field on public channel/identity metadata can replace exact constructor membership. */
      const principalId = runtimeConnectionPrincipal(channel)
      if (principalId === undefined)
        throw tagRpcError(
          new TypeError(RuntimeAdapterErrorText.connectionRequired),
          RpcCoreErrorCode.invalidConfig
        )
      return Object.freeze({
        idempotency: Object.freeze({
          store,
          scope: retainRuntimeIdempotencyScope(() => `${scopePrefix}:${principalId}`, principalId)
        }),
        limits
      })
    },
    close() {
      admission.clear()
    }
  })
}
