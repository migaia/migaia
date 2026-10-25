/**
 * Owns one optional limits installation's shared provider leases and per-source governors.
 * Dispatch, physical activity and lifecycle hooks feed real completion into those owners; Session
 * retirement and scheduling are borrowed ports rather than a second connection lifecycle.
 */
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeObservationKind,
  rpcProbeEnvelopeFacts,
  rpcProbeEnvelopeKind
} from '@migaia/rpc-contract/interfaces'
import type {
  IRpcDispatchContext,
  IRpcDispatchOutcome,
  IRpcObservation,
  IRpcFlowContext,
  IRpcCarrierFrame,
  IRpcFrameNext
} from '@migaia/rpc-contract/interfaces'
import { RpcWireKind, RpcCallMode } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, RpcProviderRejectionReason } from '@migaia/rpc-contract/errors'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcError, createRpcConfigurationError } from '../../host/error-owner.js'
import { reportDiagnostic } from '../../host/report.js'
import { registerLocalErrorWireSummary } from '../../host/error-wire-metadata.js'
import { HostObservationKind } from '../../host/state-constants.js'
import type { IRpcFlowInstallation, IRpcFlowSetupContext } from '../../sdk/types.js'
import { ProviderAdmissionRegistry } from './provider-admission.js'
import { LimitsGovernor, type ILimitsGovernorPorts } from './governor.js'
import { LimitsLease } from './lease.js'
import type { IRpcLimitsOptions } from './types.js'

/** Optional limits own one shared business registry and each actual connection's original policy. */
export class RpcLimitsFlow {
  /** Cold policy holds configuration only, never a Session or provider facade. */
  readonly #options: IRpcLimitsOptions
  /** All namespaces admitted by this installation share the same original global lease owner. */
  readonly #admission: ProviderAdmissionRegistry
  /** Per-connection rate/idle facts follow actual carrier identity, not mutable public names. */
  readonly #connections = new Map<string, LimitsGovernor>()
  /** Native lifecycle and the existing scheduler remain explicit borrowed ports. */
  readonly #ports: ILimitsGovernorPorts
  /** The owning native installation cancels this exact policy before releasing its hooks. */
  /** The native installation lends the same readonly flow publication port. */
  readonly #publish: IRpcFlowSetupContext['observe']
  readonly #signal: IRpcFlowSetupContext['signal']
  /** Native installation publishes only complete fixed hooks and its one cleanup operation. */
  readonly value: IRpcFlowInstallation

  /** Validate/capture policy before any timer, physical observer or business lease exists. */
  constructor(options: IRpcLimitsOptions, context: IRpcFlowSetupContext) {
    for (const selected of [
      options.maxCallsPerMinute,
      options.maxPayloadBytes,
      options.maxConsecutiveTimeouts,
      options.idleTimeoutMs,
      options.violationLimit
    ])
      if (selected !== undefined && (!Number.isSafeInteger(selected) || selected < 1))
        throw createRpcConfigurationError(
          RpcCoreErrorText.providerAdmissionLimitsMustBePositiveSafeIntegers
        )
    this.#options = options
    this.#admission = new ProviderAdmissionRegistry(options.maxGlobal, options.maxPerPeer)
    this.#ports = {
      scheduler: options.scheduler ?? systemScheduler,
      report: (error) => reportDiagnostic(context.report, error),
      retire: context.retire,
      release: (carrierId, governor) => {
        if (this.#connections.get(carrierId) === governor) this.#connections.delete(carrierId)
      }
    }
    this.#signal = context.signal
    this.#publish = context.observe
    this.value = {
      hooks: {
        frame: { inbound: this.#inbound },
        dispatch: { inbound: this.#dispatch },
        observe: this.#observe
      },
      dispose: this.#close
    }
    this.#signal.addEventListener('abort', this.#close, { once: true })
    if (this.#signal.aborted) this.#close()
  }

  /** Dispatch admission is synchronous and atomic before any actual group member can start. */
  readonly #dispatch = (
    context: IRpcDispatchContext,
    next: () => Promise<IRpcDispatchOutcome>
  ): Promise<IRpcDispatchOutcome> => {
    if (this.#signal.aborted) return next()
    if (context.envelope.kind !== RpcWireKind.call && context.envelope.kind !== RpcWireKind.group)
      return next()
    /** Principal-shared outcomes never merge two actually acquired Sessions' concurrency capacity. */
    const peerKey = JSON.stringify([
      context.namespace,
      context.session!.authentication?.sessionId ?? context.session!.peerId
    ])
    /** Payload references live only during this synchronous quota admission. */
    const payloads =
      context.envelope.kind === RpcWireKind.group
        ? context.envelope.steps.map((step) => step.payload)
        : [context.envelope.payload]
    /** Original member keys are injective even when public ids contain delimiters. */
    const keys = payloads.map((_, index) =>
      JSON.stringify([context.carrierId, context.envelope.id, index])
    )
    /** The same actual connection owns both concurrency-refusal and runtime-governance effects. */
    const governor = this.#connection(context.carrierId)
    governor.bind(context.connectionSignal ?? context.signal)
    if (!this.#admission.acquireMany(keys, peerKey)) {
      governor.violate()
      this.#notify(context, peerKey)
      /** The existing public quota summary belongs to this exact minted refusal only. */
      const error = createRpcError(
        RpcCoreErrorCode.overloaded,
        RpcCoreErrorText.providerAdmissionLimitReached
      )
      registerLocalErrorWireSummary(
        error,
        RpcCoreErrorCode.overloaded,
        RpcCoreErrorText.providerFailed,
        { preserveSerializedError: true }
      )
      this.#publish?.({
        kind: RpcProbeObservationKind.event,
        namespace: context.namespace,
        carrierId: context.carrierId,
        peerId: context.session?.peerId,
        id: context.envelope.id,
        data: {
          ...rpcProbeEnvelopeFacts(context.envelope),
          stage: RpcProbeStage.message,
          direction: RpcProbeDirection.inbound,
          kind: rpcProbeEnvelopeKind(context.envelope),
          outcome: RpcProbeOutcome.rejected,
          error,
          rejection:
            context.envelope.kind === RpcWireKind.group
              ? RpcProviderRejectionReason.groupConcurrency
              : RpcProviderRejectionReason.concurrency
        }
      })
      throw error
    }
    /** Real completion releases the original leases even if a later hook rejects before next. */
    const lease = new LimitsLease(this.#admission, keys, governor, context.signal)
    void context.completion.then(lease.settle).catch(this.#ports.report)
    /** Rate credit is reserved once; actual original group progress later refunds unstarted members. */
    const window = governor.reserve(payloads)
    lease.begin(window, context.envelope.kind === RpcWireKind.group ? context.started : undefined)
    return next()
  }

  /** Physical activity refreshes the existing idle clock while preserving frame/write identity. */
  readonly #inbound = (
    frame: IRpcCarrierFrame,
    context: IRpcFlowContext,
    next: IRpcFrameNext
  ): Promise<void> => {
    this.#connections.get(context.carrierId)?.touch()
    return next(frame)
  }

  /** Only real public readiness starts idle; real retirement ends that exact governor. */
  readonly #observe = (event: IRpcObservation): void => {
    if (this.#signal.aborted || event.carrierId === undefined) return
    if (event.kind === HostObservationKind.peerReady) this.#connection(event.carrierId).ready()
    else if (event.kind === HostObservationKind.peerLeave)
      this.#connections.get(event.carrierId)?.close()
  }

  /** Connection-local policy allocates once and never owns an alternative Session or registry. */
  #connection(carrierId: string): LimitsGovernor {
    /** Exact carrier ids remain unique across namespace replacement and stale cleanup. */
    let governor = this.#connections.get(carrierId)
    if (!governor) {
      governor = new LimitsGovernor(carrierId, this.#options, this.#ports)
      this.#connections.set(carrierId, governor)
    }
    return governor
  }

  /** Frozen original refusal DTOs exclude business input; observers cannot change the response. */
  #notify(context: IRpcDispatchContext, peerKey: string): void {
    /** A plain lexical callback preserves the public observer's original undefined receiver. */
    const observer = this.#options.onRejected
    if (!observer) return
    try {
      void Promise.resolve(
        observer(
          Object.freeze({
            verifiedPeerKey: peerKey,
            controllerKey: JSON.stringify([context.carrierId, context.envelope.id]),
            method: context.envelope.task.method ?? RpcCallMode.group,
            reason:
              context.envelope.kind === RpcWireKind.group
                ? RpcProviderRejectionReason.groupConcurrency
                : RpcProviderRejectionReason.concurrency
          })
        )
      ).catch(this.#observerFailed)
    } catch (error) {
      this.#observerFailed(error)
    }
  }

  /** Observer failure retains the exact original cause under the existing local INTERNAL code. */
  readonly #observerFailed = (cause: unknown): void => {
    this.#ports.report(
      createRpcError(
        RpcCoreErrorCode.internal,
        RpcCoreErrorText.providerAdmissionObserverFailed,
        cause
      )
    )
  }

  /** Installation cleanup retires owned timers/listeners without fabricating business terminals. */
  readonly #close = (): void => {
    this.#signal.removeEventListener('abort', this.#close)
    for (const governor of this.#connections.values()) governor.close()
    this.#connections.clear()
    this.#admission.clear()
  }
}
