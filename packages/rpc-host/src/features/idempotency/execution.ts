/** Own one existing store claim through actual dispatch completion; no second pending table exists. */
import { raceWithAbort } from '@migaia/utils/promise'
import type { IRpcCompletion, IRpcOutcome, IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { RpcCallMode } from '@migaia/rpc-contract/protocol'
import type { IRpcDispatchPayload, IRpcDispatchOutcome } from '@migaia/rpc-contract/interfaces'
import type { IRpcFlowStage } from '../../sdk/flow-pipelines.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError } from '../../host/error-owner.js'
import { resolveAbortReason } from '../../host/abort-reason.js'
import { deserializeHostWireError, hostErrorWireMetadata } from '../../host/error-wire-metadata.js'
import { RpcPortableCapture, hasRpcPortableBinary } from '../../sdk/wire/portable.js'
import { invocationFingerprint, type IIdempotentEnvelope } from './fingerprint.js'
import { RpcIdempotencyState as State } from './constants.js'
import type { IRpcIdempotencyClaim, IRpcIdempotencyOutcome, IRpcIdempotencyStore } from './store.js'

/** The invocation supplies its original signal, completion and provider continuation. */
type IIdempotencyExecution = Readonly<{
  payload: IRpcDispatchPayload
  envelope: IIdempotentEnvelope
  store: IRpcIdempotencyStore
  scope: string
  key: string
  next: Parameters<IRpcFlowStage<'dispatchInbound'>>[1]
}>

/** Original streams retain only final completion; yields never become an outcome buffer. */
async function* replayCompletion(completion: IRpcCompletion): AsyncGenerator<IRpcPortableValue> {
  if (!completion.ok) throw deserializeHostWireError(completion.error)
  return completion.result
}

/** One claimed execution seals canonical completion; pending observers only borrow the store. */
export class RpcIdempotencyExecution {
  /** All state belongs to this admitted invocation and its existing actual completion Promise. */
  readonly #input: IIdempotencyExecution
  /** The store's exact claim is released after settlement or snapshot failure, once only. */
  #claim: Extract<IRpcIdempotencyClaim, { status: 'claimed' }> | undefined

  /** No provider, waiter, cancellation controller or result registry is constructed here. */
  constructor(input: IIdempotencyExecution) {
    this.#input = input
  }

  /** Claim once, await an existing owner, or replay its actual sealed terminal without executing. */
  async run(): Promise<void> {
    /** Capture all business fields before a complete-backing digest can suspend. */
    const fingerprint = invocationFingerprint(this.#input.envelope)
    /** Ordinary fingerprints retain the original synchronous claim point. */
    const prepared = typeof fingerprint === 'string' ? fingerprint : await fingerprint
    while (true) {
      if (this.#input.payload.context.signal.aborted)
        throw resolveAbortReason(this.#input.payload.context.signal)
      /** Only the original bounded store owns correlation, body collision and waiter admission. */
      const claim = this.#input.store.claim(
        this.#input.scope,
        this.#input.key,
        performance.now(),
        prepared
      )
      if (claim.status === State.full)
        throw createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
      if (claim.status === State.done) {
        this.#input.payload.outcome.value = this.#replay(claim.outcome)
        return
      }
      if (claim.status === State.pending) {
        /** Existing utility cancellation withdraws this observer without cancelling the owner. */
        const outcome = await raceWithAbort(() => claim.outcome, {
          signals: [this.#input.payload.context.signal],
          report: this.#report,
          cleanupPolicy: 'report'
        })
        if (outcome !== undefined) {
          this.#input.payload.outcome.value = this.#replay(outcome)
          return
        }
        continue
      }
      this.#claim = claim
      void this.#input.payload.context.completion.then(this.#settle).catch(this.#report)
      /** Keyed replies retain owned result storage rather than detaching the original provider. */
      const next = this.#input.next
      await next(this.#input.payload)
      /** All native stages observe the same cell, including transfer ownership normalization. */
      const outcome = this.#input.payload.outcome.value
      if (outcome.kind === 'value' && outcome.transfer)
        this.#input.payload.outcome.value = { ...outcome, transfer: undefined }
      return
    }
  }

  /** Completion snapshots reuse the canonical walker and retain original native bytes independently. */
  readonly #settle = (completion: IRpcCompletion): void => {
    /** Clearing before user store callbacks prevents reentrant settlement from borrowing it twice. */
    const claim = this.#claim
    this.#claim = undefined
    if (!claim) return
    try {
      /** This is an output ownership snapshot, never an input retry backup or yield buffer. */
      const capture = new RpcPortableCapture(hostErrorWireMetadata)
      /** Mode and original generation remain descriptive retained facts, not a new live caller. */
      const outcome: IRpcOutcome = {
        mode: this.#input.envelope.task.mode as IRpcOutcome['mode'],
        targetGeneration: this.#input.envelope.task.targetGeneration,
        completion
      }
      /** Native leaves need their original independent completion copy before any physical transfer. */
      const snapshot = capture.normalize(outcome)
      claim.settle(
        {
          ok: true,
          data: hasRpcPortableBinary(snapshot)
            ? capture.normalize(structuredClone(snapshot))
            : snapshot
        },
        performance.now()
      )
    } finally {
      claim.release()
    }
  }

  /** Replay only actual store bodies; an unavailable tombstone never grants re-execution. */
  #replay(outcome: IRpcIdempotencyOutcome | 'unavailable'): IRpcDispatchOutcome {
    if (outcome === State.unavailable || !outcome.ok || outcome.data === undefined)
      throw createRpcError(
        RpcCoreErrorCode.idempotencyResultUnavailable,
        RpcCoreErrorText.idempotencyResultUnavailable
      )
    /** The unchanged store ABI retains the original complete protocol outcome in its data slot. */
    const saved = outcome.data as unknown as IRpcOutcome
    if (this.#input.envelope.task.mode === RpcCallMode.stream)
      return {
        kind: 'stream',
        value: replayCompletion(saved.completion),
        completion: saved.completion
      }
    if (!saved.completion.ok) throw deserializeHostWireError(saved.completion.error)
    return { kind: 'value', value: saved.completion.result as IRpcPortableValue }
  }

  /** The original report callback retains its receiver-independent public callable contract. */
  readonly #report = (error: unknown): void => {
    const report = this.#input.payload.context.report
    report(error)
  }
}
