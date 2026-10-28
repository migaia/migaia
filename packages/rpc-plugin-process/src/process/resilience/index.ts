/**
 * Owns native registration diagnostics, shared connection capacity and committed dependency
 * liquidation. Original supervisors retain restart policy and actual native execution.
 */
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '@migaia/rpc-host/sdk'
import {
  RPC_PROCESS_ERROR_SOURCE as ERROR_SOURCE,
  RpcProcessErrorCode
} from '@migaia/rpc-contract/error-code'

import { RpcProcessErrorText } from '../error-text.ts'
import { createProcessError, createProcessCleanupError } from '../error.ts'
import { MAX_LIQUIDATION_TOMBSTONES } from './constants.ts'
import {
  createProcessDependentDiagnostic,
  liquidateProcessOwner,
  type IProcessDependentDiagnostic
} from './liquidation.ts'
import { ProcessConnectionCapacity } from '../plugin/serve/admission.ts'
import { normalizeProcessResilienceOptions } from './options.ts'
import { createProcessTerminalRegistration, type IProcessTerminalRegistration } from './terminal.ts'
import type {
  IProcessLiquidationOwner,
  IProcessResilience,
  IProcessResilienceOptions,
  IProcessResilienceSnapshot,
  IProcessDependencyHostPort
} from './types.ts'

/** Keep the terminal primary and committed cleanup failures reachable from inspect. */
function liquidationReason(primary: unknown, cleanupErrors: readonly unknown[]): unknown {
  if (cleanupErrors.length === 0) return primary
  return attachErrorIdentity(
    new AggregateError(
      [...(primary === undefined ? [] : [primary]), ...cleanupErrors],
      RpcProcessErrorText.liquidated
    ),
    { source: ERROR_SOURCE, code: RpcProcessErrorCode.liquidated }
  )
}

/**
 * Own bounded session admission and terminal diagnostics while borrowing registered supervisors.
 * Invalid capacities/policies reject synchronously before I/O. Closing releases listeners and
 * diagnostic registrations through one shared Promise, retaining cleanup failures in an aggregate;
 * it does not dispose the borrowed supervisors or forcibly close previously adopted leases.
 */
/** Allocate one service resilience governor before installing behavior callbacks. */
function processResilienceState(options: IProcessResilienceOptions) {
  /** The original native diagnostic options are normalized independently from provider governance. */
  const normalized = normalizeProcessResilienceOptions(options)
  /** Physical capacity is the exact native admission owner shared with actual serve sessions. */
  const connections = new ProcessConnectionCapacity(normalized.maxConnections)
  /** Normal registrations are removed at their own release, not kept as tombstones. */
  const registrations = new Map<string, IProcessTerminalRegistration>()
  /** A committed liquidation leaves only the newest bounded diagnostic snapshots. */
  const tombstones = new Map<
    string,
    Readonly<{ snapshot: IProcessResilienceSnapshot; time: number }>
  >()
  /** Each actually suspended dependant has its own diagnostic count and timer. */
  const dependents = new Map<string, IProcessDependentDiagnostic>()
  /** Subscribers observe terminal state without becoming its reporter. */
  const terminalSubscribers = new Set<
    (snapshot: IProcessResilienceSnapshot) => void | Promise<void>
  >()
  /** Only successful original liquidation commits notify this passive subscriber Set. */
  const liquidationSubscribers = new Set<(snapshot: IProcessResilienceSnapshot) => unknown>()
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
  let closed = false
  /** The first close operation owns cleanup; later callers observe the same settlement. */
  const closePromise = undefined as Promise<void> | undefined

  return {
    connections,
    registrations,
    tombstones,
    dependents,
    terminalSubscribers,
    liquidationSubscribers,
    closed,
    closePromise,
    options: normalized,
    resilience: undefined as unknown as IProcessResilience
  }
}

/** One original terminal registration lends its actual liquidation and stale-removal facts. */
type IProcessRegistrationOperation = {
  readonly name: string
  readonly owner: IProcessLiquidationOwner
  current?: IProcessTerminalRegistration
}

/** A suspended dependent borrows only the original committed-plan owner and reason. */
type IProcessDependentOperation = Readonly<{
  name: string
  reason: unknown
  host: IProcessDependencyHostPort
}>

/** Preserve the original microtask admission and asynchronous subscriber rejection settlement. */
function notifyProcessTerminal(
  listener: (snapshot: IProcessResilienceSnapshot) => void | Promise<void>,
  snapshot: IProcessResilienceSnapshot
): Promise<void> {
  return Promise.resolve().then(() => listener(snapshot))
}

/** Own one service resilience governor; callbacks access only this explicit instance. */
class ProcessResilience {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processResilienceState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessResilience
  /** Initialize storage before publishing the same owner's genuine methods. */
  constructor(options: IProcessResilienceOptions) {
    this.#state = processResilienceState(options)
    this.#state.resilience = Object.freeze({
      connections: this.#state.connections,
      options: { drainMs: this.#state.options.drainMs },
      attachRegistration: this.#attachRegistration,
      assertAvailable: this.#assertAvailable,
      inspect: this.#inspect,
      onTerminal: this.#onTerminal,
      onLiquidated: this.#onLiquidated,
      close: this.#close
    })
    this.value = this.#state.resilience
  }

  /** Admit one original registration before acquiring its terminal subscription. */
  readonly #attachRegistration: IProcessResilience['attachRegistration'] = (
    name,
    binding,
    owner
  ) => {
    if (
      this.#state.closed ||
      typeof name !== 'string' ||
      name.length === 0 ||
      this.#state.registrations.has(name)
    )
      throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
        field: 'registrationId'
      })
    if (
      !binding ||
      typeof binding.supervisor?.inspect !== 'function' ||
      typeof binding.supervisor?.restart !== 'function' ||
      typeof binding.supervisor?.onTerminal !== 'function' ||
      (binding.health !== 'ping' && binding.health !== 'custom' && binding.health !== 'none')
    )
      throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
        field: 'binding'
      })
    if (
      !owner ||
      (owner.kind === 'proxy-plugin' &&
        (owner.name !== name || typeof owner.host?.unUse !== 'function')) ||
      (owner.kind === 'standalone-host' && typeof owner.release !== 'function') ||
      (owner.kind !== 'proxy-plugin' && owner.kind !== 'standalone-host')
    )
      throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
        field: 'liquidation'
      })
    this.#state.tombstones.delete(name)
    this.#state.dependents.get(name)?.close()
    this.#state.dependents.delete(name)
    /** The two original callbacks borrow this one registration's identity and release owner. */
    const operation: IProcessRegistrationOperation = { name, owner }
    /** The canonical terminal owner acquires its original supervisor subscription once. */
    const current = createProcessTerminalRegistration({
      name,
      binding,
      scheduler: this.#state.options.scheduler,
      report: this.#report,
      reportAtMs: this.#state.options.reportAtMs,
      unhandledLimit: this.#state.options.unhandledLimit,
      notify: this.#notify,
      liquidate: () => this.#liquidateRegistration(operation),
      onClose: () => this.#registrationClosed(operation)
    })
    operation.current = current
    this.#state.registrations.set(name, current)
    return current.registration
  }

  /** A retired handle cannot remove a later registration published under the same name. */
  #registrationClosed(operation: IProcessRegistrationOperation): void {
    if (this.#state.registrations.get(operation.name) !== operation.current) return
    this.#state.registrations.delete(operation.name)
    this.#state.dependents.get(operation.name)?.close()
    this.#state.dependents.delete(operation.name)
  }

  /** Commit only this registration's original liquidation plan and retain its primary reason. */
  async #liquidateRegistration(operation: IProcessRegistrationOperation): Promise<void> {
    /** The original owner retains its distinct standalone or native PluginHost release semantics. */
    const owner = operation.owner
    /** Only the committed removal result determines affected dependent diagnostics. */
    const result = await liquidateProcessOwner(
      owner,
      this.#state.options.liquidation.cascade,
      this.#report
    )
    /** Terminal delivery resumes only after the original registration has been published. */
    const currentSnapshot = operation.current!.snapshot()
    /** Cleanup failures remain after the same original terminal primary in diagnostics. */
    const retainedReason = liquidationReason(currentSnapshot?.reason, result.cleanupErrors)
    if (currentSnapshot) this.#recordTombstone({ ...currentSnapshot, reason: retainedReason })
    if (owner.kind !== 'proxy-plugin') return
    for (const step of result.affected) {
      if (step.name === operation.name) continue
      if (step.action === 'suspend') this.#followAffected(step.name, retainedReason, owner.host)
      else if (step.action === 'release') {
        await this.#state.registrations.get(step.name)?.registration.close()
        this.#recordTombstone({
          id: step.name,
          state: 'terminal',
          health: 'none',
          unhandled: 0,
          liquidated: true,
          reason: retainedReason
        })
      }
    }
  }

  /** Keep native availability assertions at their original local diagnostic boundary. */
  readonly #assertAvailable: IProcessResilience['assertAvailable'] = (name) => {
    /** Committed tombstones retain the original liquidation reason. */
    const tombstone = this.#state.tombstones.get(name)
    if (tombstone)
      throw createProcessError(RpcProcessErrorCode.liquidated, tombstone.snapshot.reason, {
        registrationId: name
      })
    /** A suspended dependent retains its own original snapshot and terminal-call identity. */
    const dependent = this.#state.dependents.get(name)
    if (dependent) {
      /** Sampling does not select another registration or mutate diagnostic policy. */
      const suspended = dependent.snapshot()
      throw createProcessError(RpcProcessErrorCode.terminalCall, suspended.reason, {
        registrationId: name
      })
    }
    this.#state.registrations.get(name)?.assertAvailable()
  }

  /** Inspect the same tombstone, dependent or actual registration in original precedence order. */
  readonly #inspect: IProcessResilience['inspect'] = (id) =>
    this.#state.tombstones.get(id)?.snapshot ??
    this.#state.dependents.get(id)?.snapshot() ??
    this.#state.registrations.get(id)?.snapshot()

  /** Only live governors accept terminal observers; removal deletes this exact callback. */
  readonly #onTerminal: IProcessResilience['onTerminal'] = (listener) => {
    if (this.#state.closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
    this.#state.terminalSubscribers.add(listener)
    return () => this.#state.terminalSubscribers.delete(listener)
  }

  /** Passive liquidation observers retain the original closed-owner no-op subscription. */
  readonly #onLiquidated: IProcessResilience['onLiquidated'] = (listener) => {
    if (this.#state.closed) return () => undefined
    this.#state.liquidationSubscribers.add(listener)
    return () => {
      this.#state.liquidationSubscribers.delete(listener)
    }
  }

  /** Repeated close calls return the original cached cleanup Promise without a wrapper Promise. */
  readonly #close = (): Promise<void> => (this.#state.closePromise ??= this.#release())

  /** Set the original synchronous closed fence before joining the same registration cleanups. */
  async #release(): Promise<void> {
    this.#state.closed = true
    /** Each original registration starts closing in insertion order before the first await. */
    const outcomes = await Promise.allSettled(
      Array.from(this.#state.registrations.values(), (current) => current.registration.close())
    )
    /** Failed borrowed unsubscribe must not retain its closed registration in this governor. */
    this.#state.registrations.clear()
    this.#state.connections.close()
    for (const dependent of this.#state.dependents.values()) dependent.close()
    this.#state.dependents.clear()
    this.#state.tombstones.clear()
    this.#state.terminalSubscribers.clear()
    this.#state.liquidationSubscribers.clear()
    /** All original cleanup rejections retain their original settlement order and identities. */
    const errors = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : []
    )
    if (errors.length > 0) throw createProcessCleanupError(errors)
  }

  /** Application reporter failures retain the original asynchronous host-rethrow boundary. */
  #report = (error: unknown): void => {
    try {
      ;(0, this.#state.options.report)(error)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }

  /** Tombstone publication is the same successful commit observed by passive subscribers. */
  #recordTombstone = (snapshot: IProcessResilienceSnapshot): void => {
    this.#state.tombstones.delete(snapshot.id)
    this.#state.tombstones.set(snapshot.id, {
      snapshot: Object.freeze({ ...snapshot, liquidated: true }),
      time: this.#state.options.scheduler.now()
    })
    while (this.#state.tombstones.size > MAX_LIQUIDATION_TOMBSTONES) {
      const oldest = this.#state.tombstones.keys().next().value
      if (oldest !== undefined) this.#state.tombstones.delete(oldest)
    }
    const committed = this.#state.tombstones.get(snapshot.id)!.snapshot
    for (const listener of Array.from(this.#state.liquidationSubscribers)) {
      try {
        const result = listener(committed)
        observeThenableRejection(result, inspectThenable(result), this.#report)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  #notify = async (snapshot: IProcessResilienceSnapshot): Promise<boolean> => {
    const outcomes = await Promise.allSettled(
      [...this.#state.terminalSubscribers].map((listener) =>
        notifyProcessTerminal(listener, snapshot)
      )
    )
    let handled = false
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') handled = true
      else this.#report(outcome.reason)
    }
    return handled
  }

  /** Dependants come only from the mutation's actual committed plan. */
  #followAffected = (name: string, reason: unknown, host: IProcessDependencyHostPort): void => {
    if (this.#state.dependents.has(name) || this.#state.tombstones.has(name)) return
    /** A dependent's original liquidation callback borrows only this explicit operation record. */
    const operation = { name, reason, host }
    /** The canonical dependent owner remains the sole diagnostic clock for this suspended name. */
    const diagnostic = createProcessDependentDiagnostic({
      name,
      reason,
      scheduler: this.#state.options.scheduler,
      reportAtMs: this.#state.options.reportAtMs,
      unhandledLimit: this.#state.options.unhandledLimit,
      report: this.#report,
      notify: this.#notify,
      liquidate: () => this.#liquidateDependent(operation)
    })
    this.#state.dependents.set(name, diagnostic)
  }

  /** Retain the same committed-dependent cleanup and follow only actually suspended successors. */
  async #liquidateDependent(operation: IProcessDependentOperation): Promise<void> {
    /** The original actual Host still owns removal, dependency policy and committed plan. */
    const result = await liquidateProcessOwner(
      { kind: 'proxy-plugin', name: operation.name, host: operation.host },
      this.#state.options.liquidation.cascade,
      this.#report
    )
    /** Read this same dependent after removal; never substitute another selected resource. */
    const current = this.#state.dependents.get(operation.name)?.snapshot()
    if (current)
      this.#recordTombstone({
        ...current,
        reason: liquidationReason(current.reason, result.cleanupErrors)
      })
    this.#state.dependents.get(operation.name)?.close()
    this.#state.dependents.delete(operation.name)
    for (const step of result.affected)
      if (step.name !== operation.name && step.action === 'suspend')
        this.#followAffected(step.name, operation.reason, operation.host)
  }
}

/** Construct the single owner for one service resilience governor. */
export function createProcessResilience(options: IProcessResilienceOptions): IProcessResilience {
  return new ProcessResilience(options).value
}
