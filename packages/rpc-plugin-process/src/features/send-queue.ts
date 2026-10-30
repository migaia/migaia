/**
 * Serializes original physical writes with the Utils concurrency limiter and one shared
 * flow-admission owner. Queued cancellation and close do not create a second RPC execution queue.
 */
import { createConcurrencyLimiter } from '@migaia/utils/promise'
import { defineFeature, type IFeature } from '@migaia/plugin-host'
import { registerRpcNativeFeature } from '@migaia/rpc-host/sdk'
import type { IRpcWriteAdmission } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorText, RpcLifecycleError, tagRpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  flowControlFeature,
  type IIpcFlowControlOptions,
  type IRpcFlowControlFeature,
  type IIpcFlowControlExecution,
  type IpcFlowControl
} from './flow-control.ts'
import { ProcessFeatureName } from './text.ts'
import type {
  IProcessFeatureContext,
  IIpcSendFacts,
  IIpcSendAdmission,
  IIpcWrite,
  IIpcBatchGuard
} from './metadata.ts'

/** Explicit shared flow excludes a second capacity policy on this same native connection. */
export type ISendQueueOptions = IIpcFlowControlOptions & Readonly<{ flow?: IRpcFlowControlFeature }>
/** One installed queue serializes original writes and borrows exactly one lane-admission owner. */
export class IpcSendQueue {
  /** The original utils implementation owns FIFO, pending cancellation and close rejection. */
  readonly #limiter
  /** Admission, watermarks and logs belong only to this shared flow instance. */
  readonly flow: IpcFlowControl
  /** A locally created default flow follows this installation's lifetime. */
  readonly #ownedFlow: boolean
  /** Only logical members still waiting for their actual coalesced physical flush can be removed. */
  readonly #queuedCancellations = new Set<(reason: unknown) => void>()
  /** Local close is independent from a borrowed flow's lifetime. */
  #closed = false
  /** Original close reason rejects queued work without replacing its identity. */
  #closeReason: unknown

  /** Native installation supplies the exact same feature/value receipt when flow is shared. */
  constructor(
    feature: IRpcFlowControlFeature,
    execution: IIpcFlowControlExecution,
    context: IProcessFeatureContext
  ) {
    if (context.flow && context.flow.feature !== feature)
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.ipcGateDuplicated),
        RpcCoreErrorCode.invalidConfig
      )
    this.#ownedFlow = context.flow === undefined
    this.flow = context.flow?.value ?? execution.install(context).value
    this.#limiter = createConcurrencyLimiter({
      concurrency: 1,
      report: (error) => this.flow.reportFailure(error)
    })
  }
  /** Reserve one logical message while lending the original queue's pending-member close guard. */
  reserveWrite(facts: IIpcSendFacts): IRpcWriteAdmission {
    if (this.#closed) throw new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    /** A borrowed shared flow can remain open while its synchronous observer closes this queue. */
    const admission = this.flow.reserveWrite(facts, this.#guard)
    if (this.#closed) {
      admission.release()
      throw this.#closeReason
    }
    return admission
  }
  /** Count each logical envelope once, then lend actual FIFO execution to its one shared flow. */
  readonly run = (
    facts: IIpcSendFacts,
    write: IIpcWrite,
    admission?: IIpcSendAdmission
  ): Promise<void> => {
    if (this.#closed)
      return Promise.reject(new RpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    return this.flow.run(
      facts,
      admission?.coalesced ? () => write(this.#guard) : write,
      admission,
      admission?.coalesced
        ? undefined
        : (invoke) =>
            this.#limiter.run(invoke, admission?.signal ? { signal: admission.signal } : undefined)
    )
  }
  /** The physical batch producer retains only cancellation of its still-queued original member. */
  readonly #guard: IIpcBatchGuard = (cancelQueued) => {
    if (this.#closed) throw this.#closeReason
    if (!cancelQueued) return undefined
    this.#queuedCancellations.add(cancelQueued)
    return () => {
      this.#queuedCancellations.delete(cancelQueued)
    }
  }
  /** Observers subscribe to the shared flow, never a second queue-owned event source. */
  readonly onEvent: IpcFlowControl['onEvent'] = (listener) => this.flow.onEvent(listener)
  /**
   * Close admission synchronously before cancelling original queued members and releasing owned
   * flow.
   */
  readonly close = (reason?: unknown): void => {
    if (this.#closed) return
    this.#closed = true
    this.#closeReason = reason ?? new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    this.#limiter.close(this.#closeReason)
    for (const cancel of this.#queuedCancellations) cancel(this.#closeReason)
    this.#queuedCancellations.clear()
    if (this.#ownedFlow) this.flow.close(this.#closeReason)
  }
  /** Both FIFO and coalesced writes must leave their original shared capacity before drain settles. */
  readonly whenIdle = (): Promise<void> => this.flow.whenIdle()
}

/** Native Feature output lends its exact dependency to each concrete connection's FIFO owner. */
class IpcSendQueueExecution {
  /** Definition identity prevents an unrelated explicit flow from replacing the dependency. */
  readonly #feature: IRpcFlowControlFeature
  /** The native dependency graph constructs this same cold flow output once per registration. */
  readonly #flow: IIpcFlowControlExecution

  /** Borrow the native flow output without opening a connection or queue. */
  constructor(feature: IRpcFlowControlFeature, flow: IIpcFlowControlExecution) {
    this.#feature = feature
    this.#flow = flow
  }

  /** The carrier owns the returned queue and supplies an already-installed explicit flow if any. */
  install(context: IProcessFeatureContext) {
    /** The connection retains its exact FIFO and one shared lane-admission instance. */
    const value = new IpcSendQueue(this.#feature, this.#flow, context)
    return { value, dispose: value.close }
  }
}

/** Native carriers consume this output through the actual plugin registration's feature aliases. */
export type IIpcSendQueueExecution = Pick<IpcSendQueueExecution, 'install'>

/** An opaque queue Feature declares its exact flow dependency and keeps controls in its output. */
export function sendQueueFeature(
  options: ISendQueueOptions = {}
): IFeature<
  Record<never, never>,
  IIpcSendQueueExecution,
  Readonly<{ flow: IRpcFlowControlFeature }>
> {
  if (
    options.flow &&
    (options.maxPendingData !== undefined || options.maxPendingControl !== undefined)
  )
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcGateDuplicated),
      RpcCoreErrorCode.invalidConfig
    )
  /** One exact cold definition is installed once by the concrete native process source. */
  const flow = options.flow ?? flowControlFeature(options)
  /** Native dependency injection retains identity even when the same flow also has a caller alias. */
  const feature = defineFeature({
    dependencies: { flow },
    install: (_core, dependencies) => new IpcSendQueueExecution(flow, dependencies.flow)
  })
  registerRpcNativeFeature(feature, { role: ProcessFeatureName.sendQueue })
  return feature
}
export default sendQueueFeature
