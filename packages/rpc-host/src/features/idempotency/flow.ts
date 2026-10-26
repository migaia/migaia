/**
 * Owns installed keyed dispatch and outcome lookup over the original injectable store. Each actual
 * invocation borrows claim/completion rights from the same owner; namespace queries add no second
 * pending table, retry loop or result cache.
 */
import type {
  IRpcOutcome,
  IRpcOutcomeStore,
  IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import { RpcWireKind, RpcWireProfile } from '@migaia/rpc-contract/protocol'
import type { IRpcObservation } from '@migaia/rpc-contract/interfaces'
import type { IRpcFlowInstallation, IRpcFlowSetupContext } from '../../sdk/types.js'
import { RpcFlowPoint, type IRpcFlowStage } from '../../sdk/flow-pipelines.js'
import { createRpcLifecycleError, createRpcConfigurationError } from '../../host/error-owner.js'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcIdempotencyStore, type IRpcIdempotencyStore } from './store.js'
import { RpcIdempotencyState as State, RpcIdempotencyStoreFact as Fact } from './constants.js'
import type { IRpcIdempotencyOptions, IRpcOutcomeLookup } from './types.js'
import { RpcIdempotencyExecution } from './execution.js'
import { HostObservationKind } from '../../host/state-constants.js'
import { reportDiagnostic } from '../../host/report.js'

/** The actual plugin owns outcome lookup and the same original injectable claim/seal store. */
export class RpcIdempotencyFlow {
  /** Only one real store owns claim, expiry, byte pressure and read-only lookup state. */
  readonly #store: IRpcIdempotencyStore
  /** Actual setup ports originate namespace calls without exposing host work tables. */
  readonly #setup: IRpcFlowSetupContext
  /** The original scope callback receives admitted source/sender facts only. */
  readonly #options: IRpcIdempotencyOptions
  /** Only a newly created default memory store can report loss on a real native restart. */
  readonly #defaultMemory: boolean
  /** Index only carrier-owned scopes so retirement never removes principal or custom continuity. */
  readonly #carrierScopes = new Map<string, Set<string>>()
  /** Cleanup revokes late callbacks; external stores retain their independently owned lifetime. */
  #closed = false
  /** Existing dispatch hook and plugin-host namespace extension are the sole integration surface. */
  readonly value: IRpcFlowInstallation<Readonly<{ outcome: IRpcOutcomeLookup }>>

  /** Move original store policy into its actual optional owner, without creating another ledger. */
  constructor(options: IRpcIdempotencyOptions, setup: IRpcFlowSetupContext) {
    if (options.store !== undefined && typeof options.store?.claim !== 'function')
      throw createRpcConfigurationError(RpcCoreErrorText.idempotencyConfigInvalid)
    this.#options = options
    this.#setup = setup
    this.#defaultMemory = options.store === undefined
    this.#store = options.store ?? createRpcIdempotencyStore(options)
    this.value = {
      stages: { [RpcFlowPoint.dispatchInbound]: this.#dispatch },
      observe: this.#observe,
      namespaceExtensions: this.#namespace,
      dispose: this.close
    }
    setup.signal.addEventListener('abort', this.close, { once: true })
    if (setup.signal.aborted) this.close()
  }

  /** Actual lookup neither claims a key nor allocates a waiter or provider execution. */
  readonly #dispatch: IRpcFlowStage<'dispatchInbound'> = async (payload, next) => {
    const { context } = payload
    if (this.#closed) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (
      context.envelope.kind !== RpcWireKind.outcome &&
      context.envelope.kind !== RpcWireKind.call &&
      context.envelope.kind !== RpcWireKind.group
    )
      return next(payload)
    if (context.envelope.kind === RpcWireKind.outcome && context.envelope.operation !== 'lookup')
      return next(payload)
    /** Read the original admitted key once before any scope callback or body fingerprint work. */
    const key =
      context.envelope.kind === RpcWireKind.outcome
        ? undefined
        : context.envelope.options.idempotencyKey
    if (context.envelope.kind !== RpcWireKind.outcome && key === undefined) return next(payload)
    /** Existing logical-provider and admitted direct-source identity fence the store key domain. */
    const authentication = context.session?.authentication
    /** Stable principal identity shares retained outcomes across its independently held sessions. */
    const token = authentication?.principalId ?? context.carrierId
    /** A custom scope can outlive a connection and must not inherit carrier retirement. */
    const selected =
      (0, this.#options.scope)?.({
        token,
        senderId: context.envelope.route.senderId,
        ...(authentication === undefined ? {} : authentication)
      }) ?? token
    const scope = JSON.stringify([
      RpcWireProfile,
      context.envelope.task.targetGeneration.providerId,
      selected
    ])
    if (context.envelope.kind === RpcWireKind.call || context.envelope.kind === RpcWireKind.group) {
      if (!authentication && this.#options.scope === undefined && this.#store.releaseScope) {
        /** One carrier may contribute multiple admitted provider scopes, all retired together. */
        let scopes = this.#carrierScopes.get(context.carrierId)
        if (!scopes) this.#carrierScopes.set(context.carrierId, (scopes = new Set()))
        scopes.add(scope)
      }
      return new RpcIdempotencyExecution({
        payload,
        envelope: context.envelope,
        scope,
        key: key!,
        store: this.#store,
        next
      }).run()
    }
    /**
     * The monotonic host clock's original semantics are sufficient for read-only expiry
     * observation.
     */
    const lookup = this.#store.lookup?.(scope, context.envelope.idempotencyKey, performance.now())
    /** Only actual store facts describe continuity, independent from an absent key. */
    const retained = this.#store.readRuntimeFacts?.() ?? {
      kind: Fact.unavailable,
      continuity: Fact.unavailable
    }
    /** Real native restart identity is admitted by Dispatcher before entering this hook. */
    const store: IRpcOutcomeStore =
      this.#defaultMemory &&
      context.envelope.task.targetGeneration.kind === 'restart' &&
      context.envelope.task.targetGeneration.value > 0 &&
      retained.kind === Fact.memory
        ? { ...retained, continuity: Fact.lost }
        : retained
    /** Original runtime outcomes are retained inside the same generic store result-body slot. */
    const outcome =
      lookup?.state === State.done &&
      lookup.outcome !== State.unavailable &&
      lookup.outcome.ok &&
      lookup.outcome.data !== undefined
        ? (lookup.outcome.data as unknown as IRpcOutcome)
        : undefined
    payload.outcome.value = {
      kind: 'value',
      value: (outcome === undefined
        ? { state: lookup?.state === State.pending ? State.pending : State.unknown, store }
        : { state: State.done, store, outcome }) as unknown as IRpcPortableValue
    }
  }

  /** This exact plugin-host extension is published only in the installation's selected namespaces. */
  readonly #namespace = (namespace: string): Readonly<{ outcome: IRpcOutcomeLookup }> => ({
    outcome: (key, options) =>
      this.#setup.call(
        namespace,
        { mode: 'outcome', idempotencyKey: key },
        options
      ) as ReturnType<IRpcOutcomeLookup>
  })

  /** Native retirement already owns cancellation; this hook removes only carrier-local retention. */
  readonly #observe = (event: IRpcObservation): void => {
    if (event.kind === HostObservationKind.peerLeave && event.carrierId !== undefined)
      this.#releaseCarrier(event.carrierId)
  }

  /** Drop the carrier index before invoking store cleanup so reentrant retirement remains once. */
  #releaseCarrier(carrierId: string): void {
    /** Full scope keys preserve the provider domain without parsing or guessing a prefix. */
    const scopes = this.#carrierScopes.get(carrierId)
    if (!scopes) return
    this.#carrierScopes.delete(carrierId)
    for (const scope of scopes) {
      try {
        this.#store.releaseScope?.(scope)
      } catch (error) {
        reportDiagnostic(this.#setup.report, error)
      }
    }
  }

  /**
   * Rollback/final close removes the one setup listener without taking ownership of external
   * stores.
   */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#setup.signal.removeEventListener('abort', this.close)
    for (const carrierId of this.#carrierScopes.keys()) this.#releaseCarrier(carrierId)
  }
}
