import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '../../core/typing.js'
import type { IRpcIdempotencyStore } from '../../core/idempotency-store.js'
import { createRpcIdempotencyStore } from '../../core/idempotency-store.js'
import { retainRuntimeIdempotencyScope } from '../../core/internal/provider.js'
import {
  createProviderAdmissionScope,
  type IProviderAdmissionScope
} from '../../core/internal/provider-admission.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { tagRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import type { IRemoteChannel } from '../../remote/types.js'
import { runtimeConnectionPrincipal } from '../byte/connection-identity.js'
import { RuntimeAdapterErrorText } from '../byte/error-text.js'

/** One constructed scope owns its existing shared store and generic provider admission resource. */
export type IRuntimeProviderScope = Readonly<{
  /** Ordinary generated address output; signing never reads caller-provided namespace data. */
  namespace: string
  /** Original shared provider quota resource for sessions of this owner. */
  admission: IProviderAdmissionScope
  /**
   * Derive deduplication scope only from this actual authenticated channel and retain its selected
   * limits.
   */
  session(
    channel: IRemoteChannel,
    limits: IRpcProviderLimits
  ): Readonly<{
    idempotency: IRpcIdempotencyConfig
    limits: IRpcProviderLimits
  }>
  /** Clear the shared admission registry; callers close their peers before retiring the scope. */
  close(): void
}>

/** Only the exact factory result exposes the held scope to Core's listener/session constructor. */
const scopes = new WeakMap<object, IRuntimeProviderScope>()

/** Internal session construction never trusts a copied public scope or caller callback table. */
export function readRuntimeProviderScope(scope: IRuntimeProviderScope) {
  return scopes.get(scope)
}

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
  /** Core retains its genuine operation identity independently of public structural shape. */
  const scope: IRuntimeProviderScope = Object.freeze({
    namespace: scopePrefix,
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
  scopes.set(scope, scope)
  return scope
}
