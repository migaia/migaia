/**
 * Declares the installed idempotency options and namespace outcome-lookup callable boundary. Scope
 * selection receives admitted dispatch facts; the store owns claims and retention rather than these
 * declarations or the namespace query itself.
 */
import type { IRpcCallOptions } from '../../namespace/types.js'
import type { IRpcOutcomeLookupResult } from '@migaia/rpc-contract/protocol'
import type { IRpcFanoutResult } from '../../namespace/types.js'
import type { IRpcIdempotencyStore, IRpcIdempotencyStoreOptions } from './store.js'

/** Existing store capacities and scope callback move from host policy to this actual plugin. */
export type IRpcIdempotencyOptions = IRpcIdempotencyStoreOptions &
  Readonly<{
    namespaces?: readonly string[]
    store?: IRpcIdempotencyStore
    scope?(
      identity: Readonly<{
        token: string
        senderId: string
        /** Present only when the actual handshake verifier returned this authenticated identity. */
        principalId?: string
        /** Real native Session identity remains distinct from stable principal identity. */
        sessionId?: string
      }>
    ): string
  }>
/** Namespace lookup originates a normal outcome command through the existing host call port. */
export type IRpcOutcomeLookup = (
  idempotencyKey: string,
  options?: IRpcCallOptions
) => Promise<IRpcOutcomeLookupResult | IRpcFanoutResult<IRpcOutcomeLookupResult>>
