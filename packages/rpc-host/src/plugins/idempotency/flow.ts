/**
 * Owns installed keyed dispatch and outcome lookup over the original injectable store. Each actual
 * invocation borrows claim/completion rights from the same owner; namespace queries add no second
 * pending table, retry loop or result cache.
 */
import type { IRpcDispatchContext, IRpcDispatchOutcome } from '@migaia/rpc-contract/interfaces'
import type {
  IRpcOutcome,
  IRpcOutcomeStore,
  IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import { RpcWireKind, RpcWireProfile } from '@migaia/rpc-contract/protocol'
import type { IRpcFlowInstallation, IRpcFlowSetupContext } from '../../sdk/types.js'
import { createRpcLifecycleError } from '../../host/error-owner.js'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcIdempotencyStore, type IRpcIdempotencyStore } from './store.js'
import { RpcIdempotencyState as State, RpcIdempotencyStoreFact as Fact } from './constants.js'
import type { IRpcIdempotencyOptions, IRpcOutcomeLookup } from './types.js'
import { RpcIdempotencyExecution } from './execution.js'

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
  /** Cleanup revokes late callbacks; external stores retain their independently owned lifetime. */
  #closed = false
  /** Existing dispatch hook and plugin-host namespace extension are the sole integration surface. */
  readonly value: IRpcFlowInstallation<Readonly<{ outcome: IRpcOutcomeLookup }>>

  /** Move original store policy into its actual optional owner, without creating another ledger. */
  constructor(options: IRpcIdempotencyOptions, setup: IRpcFlowSetupContext) {
    this.#options = options
    this.#setup = setup
    this.#defaultMemory = options.store === undefined
    this.#store = options.store ?? createRpcIdempotencyStore(options)
    this.value = {
      hooks: { dispatch: { inbound: this.#dispatch } },
      namespaceExtensions: this.#namespace,
      dispose: this.close
    }
    setup.signal.addEventListener('abort', this.close, { once: true })
    if (setup.signal.aborted) this.close()
  }

  /** Actual lookup neither claims a key nor allocates a waiter or provider execution. */
  readonly #dispatch = async (
    context: IRpcDispatchContext,
    next: () => Promise<IRpcDispatchOutcome>
  ): Promise<IRpcDispatchOutcome> => {
    if (this.#closed) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (
      context.envelope.kind !== RpcWireKind.outcome &&
      context.envelope.kind !== RpcWireKind.call &&
      context.envelope.kind !== RpcWireKind.group
    )
      return next()
    if (context.envelope.kind === RpcWireKind.outcome && context.envelope.operation !== 'lookup')
      return next()
    /** Read the original admitted key once before any scope callback or body fingerprint work. */
    const key =
      context.envelope.kind === RpcWireKind.outcome
        ? undefined
        : context.envelope.options.idempotencyKey
    if (context.envelope.kind !== RpcWireKind.outcome && key === undefined) return next()
    /** Existing logical-provider and admitted direct-source identity fence the store key domain. */
    const authentication = context.session?.authentication
    /** Stable principal identity shares retained outcomes across its independently held sessions. */
    const token = authentication?.principalId ?? context.carrierId
    const scope = JSON.stringify([
      RpcWireProfile,
      context.envelope.task.targetGeneration.providerId,
      this.#options.scope?.({
        token,
        senderId: context.envelope.route.senderId,
        ...(authentication === undefined ? {} : authentication)
      }) ?? token
    ])
    if (context.envelope.kind === RpcWireKind.call || context.envelope.kind === RpcWireKind.group) {
      return new RpcIdempotencyExecution({
        context,
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
    return {
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

  /**
   * Rollback/final close removes the one setup listener without taking ownership of external
   * stores.
   */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#setup.signal.removeEventListener('abort', this.close)
  }
}
