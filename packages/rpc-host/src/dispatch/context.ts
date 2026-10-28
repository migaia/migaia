/** One business context preserves receiver-free helpers, expiry and elapsed-budget getters. */
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import type { IRpcEnvelope, IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import type { IRpcFlowContext } from '@migaia/rpc-contract/interfaces'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { createRpcContractError } from '../host/error-owner.ts'
import type { IRpcContext, IRpcProviderResult, IProviderDispatcherOptions } from './types.ts'
import type { ICallTargetRef } from '../call/types.ts'

/** Existing provider transfer snapshots have a fixed public admission boundary. */
const maxProviderTransferItems = 64

/** Only the exact minted record can settle its original context; copies carry business data. */
const providerResults = new WeakMap<object, object>()

/** Explicit settlement authority belongs only to results minted by this exact context. */
export class ProviderContext {
  /** Root ports supply addressing and diagnostics without a mutable endpoint facade. */
  readonly #ports: IProviderDispatcherOptions
  /** The actual invocation owns the stable native cancellation signal. */
  readonly #signal: INativeAbortSignal
  /** A context becomes expired at its own real business terminal. */
  #active = true
  /** Minted results retain an empty task identity, never the context's host/resource graph. */
  #resultToken: object | undefined
  /** One absolute deadline prevents repeated getters from resetting the received budget. */
  readonly #deadline: number | undefined
  /** Monotonic time is injected by the owning host. */
  readonly #now: () => number
  /** Namespace selection is host-local and cannot be supplied by an incoming payload. */
  readonly #namespace: string
  /** Default notifications omit the original caller, including through a forwarded request. */
  readonly #senderId: string
  /** A private pool caller can receive explicit replies without becoming a public Table member. */
  readonly #replyTarget: ICallTargetRef | undefined
  /** Public shape and key order retain the established provider context contract. */
  readonly value: IRpcContext

  /** Build a single step context over the invocation's original signal and inherited deadline. */
  constructor(
    ports: IProviderDispatcherOptions,
    namespace: string,
    envelope: IRpcEnvelope,
    data: IRpcPortableValue | undefined,
    signal: INativeAbortSignal,
    deadline?: number,
    replyTarget?: ICallTargetRef,
    source?: IRpcFlowContext
  ) {
    this.#ports = ports
    this.#replyTarget = replyTarget
    this.#namespace = namespace
    this.#senderId = envelope.route.senderId
    this.#signal = signal
    this.#deadline = deadline
    this.#now = ports.now ?? (() => performance.now())
    this.value = {
      localEndpointId: ports.self().instanceId,
      connectionId: source?.carrierId,
      sessionId: source?.session?.authentication?.sessionId ?? source?.carrierId,
      principalId: source?.session?.authentication?.principalId,
      data,
      senderId: envelope.route.senderId,
      route: envelope.route.forwardRoute,
      callerGeneration: envelope.task.callerGeneration,
      targetGeneration: envelope.task.targetGeneration,
      timeoutMs: undefined,
      signal,
      trace: envelope.route.trace,
      success: (value, options) => this.success(value, options),
      failed: (message, code) => this.failed(message, code),
      dispatchTo: (input) => this.dispatch(input)
    }
    Object.defineProperty(this.value, 'timeoutMs', {
      configurable: true,
      enumerable: true,
      get: () => this.remaining()
    })
  }

  /** Floor the original deadline exactly as the previous provider executor did. */
  remaining(): number | undefined {
    return this.#deadline === undefined
      ? undefined
      : Math.max(0, Math.floor(this.#deadline - this.#now()))
  }

  /** Expire helpers only after the original business method/iterator actually finishes. */
  finish(): void {
    this.#active = false
  }

  /** Read private result provenance without inspecting caller-controlled fields or proxies. */
  owns(value: unknown): value is IRpcProviderResult {
    return (
      typeof value === 'object' &&
      value !== null &&
      this.#resultToken !== undefined &&
      providerResults.get(value) === this.#resultToken
    )
  }

  /** The weak result receipt carries no strong reference back to this invocation's resources. */
  #brand<T extends IRpcProviderResult>(value: T): T {
    providerResults.set(value, (this.#resultToken ??= {}))
    return value
  }

  /** Preserve the original unfrozen late-settlement failure instead of throwing a new error. */
  #expired(): IRpcProviderResult {
    /** Expired results retain the same fields while granting no active invocation authority. */
    const result = {
      ok: false as const,
      message: RpcCoreErrorText.providerContextExpired,
      code: RpcCoreErrorCode.contextExpired
    }
    return this.#brand(result)
  }

  /** Snapshot transfer metadata once; business data remains under the normal result projector. */
  success(
    data?: unknown,
    options?: Readonly<{ transfer?: readonly unknown[] }>
  ): IRpcProviderResult {
    if (!this.#active || this.#signal.aborted) return this.#expired()
    /** Provider-controlled metadata is captured once before creating the immutable public result. */
    const transfer = options?.transfer
    if (
      transfer !== undefined &&
      (!Array.isArray(transfer) || transfer.length > maxProviderTransferItems)
    )
      throw createRpcContractError(RpcCoreErrorText.providerTransferMustBeABoundedArray)
    /** Exact owner-created records retain their original data and frozen transfer snapshot. */
    const result = Object.freeze({
      ok: true as const,
      data,
      transfer: transfer === undefined ? undefined : Object.freeze(Array.from(transfer))
    })
    return this.#brand(result)
  }

  /** Validate failure metadata at the existing helper boundary without replacing its native cause. */
  failed(message: string, code: string): IRpcProviderResult {
    if (!this.#active || this.#signal.aborted) return this.#expired()
    if (typeof message !== 'string' || typeof code !== 'string')
      throw createRpcContractError(RpcCoreErrorText.providerFailureMessageAndCodeMustBeStrings)
    /** The immutable result belongs to this context, never a copy supplied by business code. */
    const result = Object.freeze({ ok: false as const, message, code })
    return this.#brand(result)
  }

  /** Existing fire-and-forget context notifications report failures through the owning host. */
  dispatch(input: Readonly<{ id?: string; method: string; data: unknown }>): void {
    if (!this.#active || this.#signal.aborted) return
    if (input.id !== undefined && (typeof input.id !== 'string' || input.id.length === 0))
      throw createRpcContractError(RpcCoreErrorText.dispatchTargetIdMustBeANonEmptyString)
    try {
      if (this.#replyTarget && input.id === this.#senderId) {
        void this.#ports.calls
          .invoke(
            this.#replyTarget,
            { mode: 'notify', method: input.method, payload: input.data as IRpcPortableValue },
            { signal: this.#signal, origin: false }
          )
          .catch(this.#ports.report)
        return
      }
      void this.#ports
        .notify(this.#namespace, input, this.#signal, this.#senderId)
        .catch(this.#ports.report)
    } catch (error) {
      this.#ports.report(error)
    }
  }
}
