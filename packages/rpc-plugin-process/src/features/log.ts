/**
 * Installs one native backlog/stderr observer and the caller-owned IPC sink. Subscription
 * retirement and reporter-failure isolation stay with this per-installation log owner.
 */
import { hostRethrowReporter } from '@migaia/utils/promise'
import { defineFeature, type IFeature } from '@migaia/plugin-host'
import { registerRpcNativeFeature } from '@migaia/rpc-host/sdk'
import { IpcReporterContext, ProcessFeatureName } from './text.ts'
import type { IProcessFeatureContext } from './metadata.ts'
import type { IIpcLogRecord, IpcFlowControl } from './flow-control.ts'

/** The exact cold sink is captured before native installation and later caller mutation. */
export type IIpcLogOptions = Readonly<{ report(record: IIpcLogRecord): void | Promise<void> }>
/** Concrete process installation supplies the original shared event source and failure reporter. */
export type IIpcLogContext = IProcessFeatureContext &
  Readonly<{
    gate?: Pick<IpcFlowControl, 'onEvent'>
    onReportError(error: unknown, record: IIpcLogRecord): void | Promise<void>
  }>
/** One observer owns one exact event subscription and explicit stderr intake, without acquiring IO. */
class IpcLog {
  /** Sink behavior belongs to this actual native installation. */
  readonly #options: IIpcLogOptions
  /** Reporter and gate are borrowed from the same genuine physical owner. */
  readonly #context: IIpcLogContext
  /** Only the current attachment may remove the original event subscription. */
  #release: (() => void) | undefined
  /** The native process owns activating and disposing this complete observational surface. */
  readonly value

  /** Cold installation acquires exactly the same subscription as the old native Feature path. */
  constructor(options: IIpcLogOptions, context: IIpcLogContext) {
    this.#options = options
    this.#context = context
    this.value = Object.freeze({ activate: this.activate, recordStderr: this.#publish })
    this.activate()
  }
  /** Preserve the original terminal path when the selected error reporter itself throws or rejects. */
  #reportError(error: unknown, record: IIpcLogRecord): void {
    try {
      void Promise.resolve((0, this.#context.onReportError)(error, record)).catch((failure) =>
        hostRethrowReporter(failure, IpcReporterContext)
      )
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /** Sink failure cannot change queue capacity, physical write settlement or the original error. */
  readonly #publish = (record: IIpcLogRecord): void => {
    try {
      void Promise.resolve((0, this.#options.report)(record)).catch((error) =>
        this.#reportError(error, record)
      )
    } catch (error) {
      this.#reportError(error, record)
    }
  }
  /** Repeated activation shares one exact remover; a retained old receipt cannot remove a new one. */
  readonly activate = (): (() => void) => {
    if (this.#release) return this.#release
    /** Subscribe once to the same gate used by native admission. */
    const unsubscribe = this.#context.gate?.onEvent(this.#publish) ?? (() => undefined)
    /** This activation retains its exact remover and the borrowed unbound unsubscribe operation. */
    const subscription: { unsubscribe: () => void; remove?: () => void } = { unsubscribe }
    /** Identity check retains the original reactivation and cleanup behavior. */
    const remove = (): void => {
      if (this.#release !== subscription.remove) return
      this.#release = undefined
      /** Preserve the original direct call's undefined receiver after releasing the stale fence. */
      const unsubscribe = subscription.unsubscribe
      unsubscribe()
    }
    subscription.remove = remove
    this.#release = remove
    return remove
  }
  /** Exact removal runs before the concrete process owner closes its original physical resource. */
  readonly close = (): void => {
    this.#release?.()
  }
}
/** Native Feature output opens observers only when the concrete carrier supplies its real gate. */
class IpcLogExecution {
  /** The original captured sink is shared by resources from this native Feature installation. */
  readonly #options: IIpcLogOptions

  /** Capture the sink without subscribing to stderr or flow events. */
  constructor(options: IIpcLogOptions) {
    this.#options = options
  }

  /** The connection owns this observer and retires it before closing the physical resource. */
  install(context: IIpcLogContext) {
    /** Live subscriptions belong only to this actual physical installation. */
    const logging = new IpcLog(this.#options, context)
    return { value: logging.value, dispose: logging.close }
  }
}

/** Stderr and carrier owners borrow this native output without a second public constructor. */
export type IIpcLogExecution = Pick<IpcLogExecution, 'install'>

/** Opaque native identity keeps log controls solely on the actual installation output. */
export function ipcLogFeature(
  options: IIpcLogOptions
): IFeature<Record<never, never>, IIpcLogExecution> {
  /** Later mutation cannot replace the actual selected native sink. */
  const captured = Object.freeze({ report: options.report })
  /** The same sink enters each independently installed native output. */
  const feature = defineFeature(() => new IpcLogExecution(captured))
  registerRpcNativeFeature(feature, { role: ProcessFeatureName.log })
  return feature
}
export default ipcLogFeature
