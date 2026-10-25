/**
 * Owns optional negotiated physical batching and its per-source busy-writer lanes. Frame hooks
 * validate and deliver original members through the existing flow continuation; semantic group
 * execution, Session identity and codec admission remain outside this plugin.
 */
import { RpcCarrierFrameKind as K } from '@migaia/rpc-contract/protocol'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { createRpcLifecycleError } from '../../host/error-owner.js'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { hostErrorWireMetadata } from '../../host/error-wire-metadata.js'
import type { IRpcFlowInstallation } from '../../sdk/types.js'
import { RpcFlowPoint, type IRpcFlowStage } from '../../sdk/flow-pipelines.js'
import { RpcBatchExtension } from './constants.js'
import { RpcBatchLane } from './lane.js'

/** Optional physical batching owns only ready-frame queues, never semantic group execution. */
export class RpcBatchFlow {
  /** One source has one busy-writer queue; equal semantic ids on another carrier stay independent. */
  readonly #lanes = new Map<string, RpcBatchLane>()
  /** Native setup cancellation owns this installation's exact cleanup receipt. */
  readonly #signal: IAbortSignal
  /** Final cleanup cannot recreate queues after their listeners have been released. */
  #closed = false
  /** The existing native installation receives only fixed hooks and truthful extension membership. */
  readonly value: IRpcFlowInstallation

  /** Required negotiation remains the existing Session decision, using this real implementation. */
  constructor(signal: IAbortSignal, required: boolean) {
    this.#signal = signal
    this.value = {
      extensions: [RpcBatchExtension],
      requiredExtensions: required ? [RpcBatchExtension] : [],
      stages: {
        [RpcFlowPoint.frameOutbound]: this.#outbound,
        [RpcFlowPoint.frameInbound]: this.#inbound
      },
      dispose: this.close
    }
    signal.addEventListener('abort', this.close, { once: true })
    if (signal.aborted) this.close()
  }

  /** Only an actually selected extension may retain ready frames behind physical backpressure. */
  readonly #outbound: IRpcFlowStage<'frameOutbound'> = (payload, next) => {
    const { context } = payload
    if (this.#closed)
      return Promise.reject(createRpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    if (!context.session?.extensions.has(RpcBatchExtension)) return next(payload)
    /** Carrier ids are host-local physical identities, not decoded route or provider addresses. */
    const id = context.carrierId
    /** An idle lane is removed immediately after its final original native write drains. */
    let lane = this.#lanes.get(id)
    if (!lane) {
      lane = new RpcBatchLane(context.connectionSignal ?? this.#signal, () => {
        this.#lanes.delete(id)
      })
      this.#lanes.set(id, lane)
    }
    return lane.send({ payload, next })
  }

  /** Validate shallow physical records once before independently delivering every original member. */
  readonly #inbound: IRpcFlowStage<'frameInbound'> = async (payload, next) => {
    const { frame, context } = payload
    if (frame.kind !== K.extension || frame.extension !== RpcBatchExtension) return next(payload)
    /** Encoded member data is opaque; admission does not repeat the semantic codec or validator. */
    const frames =
      frame.data && typeof frame.data === 'object'
        ? Object.getOwnPropertyDescriptor(frame.data, 'frames')?.value
        : undefined
    if (
      this.#closed ||
      !context.session?.extensions.has(RpcBatchExtension) ||
      frame.sidecars?.length ||
      !Array.isArray(frames) ||
      !frames.length
    )
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, hostErrorWireMetadata)
    for (let index = 0; index < frames.length; index++) {
      /** Own data descriptors reject holes/accessors without executing untrusted frame callbacks. */
      const member = Object.getOwnPropertyDescriptor(frames, index)?.value
      /** Empty original sidecar lists carry no native ownership and remain valid. */
      const sidecars =
        member && typeof member === 'object'
          ? Object.getOwnPropertyDescriptor(member, 'sidecars')?.value
          : undefined
      if (
        !member ||
        typeof member !== 'object' ||
        Object.getOwnPropertyDescriptor(member, 'kind')?.value !== K.message ||
        typeof Object.getOwnPropertyDescriptor(member, 'data')?.value !== 'string' ||
        (sidecars !== undefined && (!Array.isArray(sidecars) || sidecars.length > 0))
      )
        throw createContractError(
          RpcContractErrorCode.invalidFrame,
          undefined,
          hostErrorWireMetadata
        )
    }
    for (const member of frames as IRpcCarrierFrame[]) {
      if (context.signal.aborted) throw context.signal.reason
      try {
        /** Each observed failure belongs to this member; native multiple keeps later members live. */
        await next({ ...payload, frame: member })
      } catch (error) {
        context.report(error)
      }
    }
  }

  /** Closing rejects every pending member, revokes abort listeners and retains no source queues. */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#signal.removeEventListener('abort', this.close)
    /** The same original close reason is shared by all members rather than reminted per queue. */
    const reason = this.#signal.reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    for (const lane of this.#lanes.values()) lane.close(reason)
    this.#lanes.clear()
  }
}
