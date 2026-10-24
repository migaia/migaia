import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '@migaia/rpc-host/plugin'
import type { IRemoteCallGuard } from '@migaia/rpc-host/plugin'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'

import { RpcProcessErrorText } from '../error-text.js'
import { MAX_LIQUIDATION_TOMBSTONES } from './constants.js'
import {
  createProcessDependentDiagnostic,
  liquidateProcessOwner,
  type IProcessDependentDiagnostic
} from './liquidation.js'
import { listenProcessRegistrations } from './rendezvous.js'
import { createProcessSessionManager, type IProcessSessionManager } from './session.js'
import { createProcessTerminalRegistration, type IProcessTerminalRegistration } from './terminal.js'
import type {
  IProcessRegistration,
  IProcessRegistrationListener,
  IProcessResilience,
  IProcessResilienceOptions,
  IProcessResilienceSnapshot,
  IProcessDependencyHostPort
} from './types.js'

/** Package-local session ownership lets both service facades reuse the same governor. */
const sessionManagers = new WeakMap<
  IProcessResilience,
  Readonly<{
    manager: IProcessSessionManager
    listenLiquidated(listener: (snapshot: IProcessResilienceSnapshot) => unknown): () => void
  }>
>()

/** Obtain the canonical quotas and store for a service-owned governor. */
export function processSessionManager(
  resilience: IProcessResilience
): IProcessSessionManager | undefined {
  return sessionManagers.get(resilience)?.manager
}

/** Passive observers subscribe to this genuine governor without becoming terminal handlers. */
export function listenProcessLiquidated(
  resilience: IProcessResilience,
  listener: (snapshot: IProcessResilienceSnapshot) => unknown
): (() => void) | undefined {
  return sessionManagers.get(resilience)?.listenLiquidated(listener)
}

/** One close outcome retains every independently failing listener or registration. */
function closeFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

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
  /**
   * The canonical session manager owns provider admission and idempotency policy for every accepted
   * session.
   */
  const manager = createProcessSessionManager(options)
  /** Normal registrations are removed at their own release, not kept as tombstones. */
  const registrations = new Map<string, IProcessTerminalRegistration>()
  /** A committed liquidation leaves only the newest bounded diagnostic snapshots. */
  const tombstones = new Map<
    string,
    Readonly<{ snapshot: IProcessResilienceSnapshot; time: number }>
  >()
  /** Each actually suspended dependant has its own diagnostic count and timer. */
  const dependents = new Map<string, IProcessDependentDiagnostic>()
  /** The owner closes only listeners it opened through this facade. */
  const listeners = new Set<IProcessRegistrationListener>()
  /** Subscribers observe terminal state without becoming its reporter. */
  const terminalSubscribers = new Set<
    (snapshot: IProcessResilienceSnapshot) => void | Promise<void>
  >()
  /** Only successful original liquidation commits notify this passive subscriber Set. */
  const liquidationSubscribers = new Set<(snapshot: IProcessResilienceSnapshot) => unknown>()
  /** Stable guard objects can be handed to remote before a registration is attached. */
  const guards = new Map<string, IRemoteCallGuard>()
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
  let closed = false
  /** The first close operation owns cleanup; later callers observe the same settlement. */
  const closePromise = undefined as Promise<void> | undefined

  return {
    manager,
    registrations,
    tombstones,
    dependents,
    listeners,
    terminalSubscribers,
    liquidationSubscribers,
    guards,
    closed,
    closePromise,
    options,
    resilience: undefined as unknown as IProcessResilience
  }
}

/** Own one service resilience governor; callbacks access only this explicit instance. */
class ProcessResilience {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processResilienceState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessResilience
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(options: IProcessResilienceOptions) {
    this.#state = processResilienceState(options)
    this.#state.resilience = Object.freeze({
      sessionOptions: this.#state.manager.sessionOptions,
      listenRegistrations: async (input): Promise<IProcessRegistrationListener> => {
        if (this.#state.closed)
          throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
            source: RPC_PROCESS_ERROR_SOURCE,
            code: RpcProcessErrorCode.channelClosed
          })
        const underlying = await listenProcessRegistrations(
          this.#state.manager,
          input,
          this.#report
        )
        if (this.#state.closed) {
          await underlying.close()
          throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
            source: RPC_PROCESS_ERROR_SOURCE,
            code: RpcProcessErrorCode.channelClosed
          })
        }
        let released: Promise<void> | undefined
        const owned: IProcessRegistrationListener = Object.freeze({
          address: underlying.address,
          close: () =>
            (released ??= underlying.close().finally(() => {
              this.#state.listeners.delete(owned)
            }))
        })
        this.#state.listeners.add(owned)
        return owned
      },
      attachRegistration: (name, binding, owner): IProcessRegistration => {
        if (
          this.#state.closed ||
          typeof name !== 'string' ||
          name.length === 0 ||
          this.#state.registrations.has(name)
        )
          throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
            attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
              source: RPC_PROCESS_ERROR_SOURCE,
              code: RpcProcessErrorCode.resilienceInvalidOption,
              ...(originalDetail ? { detail: originalDetail } : {})
            }))({
            field: 'registrationId'
          })
        if (
          !binding ||
          typeof binding.supervisor?.inspect !== 'function' ||
          typeof binding.supervisor?.restart !== 'function' ||
          typeof binding.supervisor?.onTerminal !== 'function' ||
          (binding.health !== 'ping' && binding.health !== 'custom' && binding.health !== 'none')
        )
          throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
            attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
              source: RPC_PROCESS_ERROR_SOURCE,
              code: RpcProcessErrorCode.resilienceInvalidOption,
              ...(originalDetail ? { detail: originalDetail } : {})
            }))({
            field: 'binding'
          })
        if (
          !owner ||
          (owner.kind === 'proxy-plugin' &&
            (owner.name !== name || typeof owner.host?.unUse !== 'function')) ||
          (owner.kind === 'standalone-host' && typeof owner.release !== 'function') ||
          (owner.kind !== 'proxy-plugin' && owner.kind !== 'standalone-host')
        )
          throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
            attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
              source: RPC_PROCESS_ERROR_SOURCE,
              code: RpcProcessErrorCode.resilienceInvalidOption,
              ...(originalDetail ? { detail: originalDetail } : {})
            }))({
            field: 'liquidation'
          })
        this.#state.tombstones.delete(name)
        this.#state.dependents.get(name)?.close()
        this.#state.dependents.delete(name)
        const current = createProcessTerminalRegistration({
          name,
          binding,
          scheduler: this.#state.manager.options.scheduler,
          report: this.#report,
          reportAtMs: this.#state.manager.options.reportAtMs,
          unhandledLimit: this.#state.manager.options.unhandledLimit,
          notify: this.#notify,
          liquidate: async () => {
            const result = await liquidateProcessOwner(
              owner,
              this.#state.manager.options.liquidation.cascade,
              this.#report
            )
            const currentSnapshot = current.snapshot()
            const retainedReason = liquidationReason(currentSnapshot?.reason, result.cleanupErrors)
            if (currentSnapshot)
              this.#recordTombstone({ ...currentSnapshot, reason: retainedReason })
            if (owner.kind !== 'proxy-plugin') return
            for (const step of result.affected) {
              if (step.name === name) continue
              if (step.action === 'suspend')
                this.#followAffected(step.name, retainedReason, owner.host)
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
          },
          onClose: () => {
            // A retired handle must never detach a later registration with the same name.
            if (this.#state.registrations.get(name) !== current) return
            this.#state.registrations.delete(name)
            this.#state.dependents.get(name)?.close()
            this.#state.dependents.delete(name)
          }
        })
        this.#state.registrations.set(name, current)
        return current.registration
      },
      callGuard: (name): IRemoteCallGuard => {
        let guard = this.#state.guards.get(name)
        if (!guard) {
          guard = Object.freeze({
            beforeDispatch: (input): void => {
              const tombstone = this.#state.tombstones.get(name)
              if (tombstone)
                throw ((
                  originalCause: unknown,
                  originalDetail: Readonly<Record<string, unknown>> | undefined
                ) =>
                  attachErrorIdentity(
                    new Error(
                      RpcProcessErrorText.liquidated,
                      originalCause === undefined ? undefined : { cause: originalCause }
                    ),
                    {
                      source: RPC_PROCESS_ERROR_SOURCE,
                      code: RpcProcessErrorCode.liquidated,
                      ...(originalDetail ? { detail: originalDetail } : {})
                    }
                  ))(tombstone.snapshot.reason, {
                  registrationId: name
                })
              const dependent = this.#state.dependents.get(name)
              if (dependent) {
                const suspended = dependent.snapshot()
                throw ((
                  originalCause: unknown,
                  originalDetail: Readonly<Record<string, unknown>> | undefined
                ) =>
                  attachErrorIdentity(
                    new Error(
                      RpcProcessErrorText.terminalCall,
                      originalCause === undefined ? undefined : { cause: originalCause }
                    ),
                    {
                      source: RPC_PROCESS_ERROR_SOURCE,
                      code: RpcProcessErrorCode.terminalCall,
                      ...(originalDetail ? { detail: originalDetail } : {})
                    }
                  ))(suspended.reason, {
                  registrationId: name
                })
              }
              this.#state.registrations.get(name)?.guard.beforeDispatch(input)
            }
          })
          this.#state.guards.set(name, guard)
        }
        return guard
      },
      inspect: (id): IProcessResilienceSnapshot | undefined => {
        return (
          this.#state.tombstones.get(id)?.snapshot ??
          this.#state.dependents.get(id)?.snapshot() ??
          this.#state.registrations.get(id)?.snapshot()
        )
      },
      onTerminal: (listener): (() => void) => {
        if (this.#state.closed)
          throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
            source: RPC_PROCESS_ERROR_SOURCE,
            code: RpcProcessErrorCode.channelClosed
          })
        this.#state.terminalSubscribers.add(listener)
        return () => this.#state.terminalSubscribers.delete(listener)
      },
      close: (): Promise<void> => {
        return (this.#state.closePromise ??= (async () => {
          this.#state.closed = true
          const outcomes = await Promise.allSettled([
            ...[...this.#state.listeners].map((listener) => listener.close()),
            ...[...this.#state.registrations.values()].map((current) =>
              current.registration.close()
            )
          ])
          this.#state.manager.close()
          for (const dependent of this.#state.dependents.values()) dependent.close()
          this.#state.dependents.clear()
          this.#state.tombstones.clear()
          this.#state.terminalSubscribers.clear()
          this.#state.liquidationSubscribers.clear()
          this.#state.guards.clear()
          const errors = outcomes.flatMap((outcome) =>
            outcome.status === 'rejected' ? [outcome.reason] : []
          )
          if (errors.length > 0) throw closeFailure(errors)
        })())
      }
    })
    sessionManagers.set(this.#state.resilience, {
      manager: this.#state.manager,
      listenLiquidated: (listener) => {
        if (this.#state.closed) return () => undefined
        this.#state.liquidationSubscribers.add(listener)
        return () => {
          this.#state.liquidationSubscribers.delete(listener)
        }
      }
    })
    this.value = this.#state.resilience
  }

  #report = (error: unknown): void => {
    try {
      this.#state.options.report(error)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }

  /** Tombstone publication is the same successful commit observed by passive subscribers. */
  #recordTombstone = (snapshot: IProcessResilienceSnapshot): void => {
    this.#state.tombstones.delete(snapshot.id)
    this.#state.tombstones.set(snapshot.id, {
      snapshot: Object.freeze({ ...snapshot, liquidated: true }),
      time: this.#state.manager.options.scheduler.now()
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
        Promise.resolve().then(() => listener(snapshot))
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
    const diagnostic = createProcessDependentDiagnostic({
      name,
      reason,
      scheduler: this.#state.manager.options.scheduler,
      reportAtMs: this.#state.manager.options.reportAtMs,
      unhandledLimit: this.#state.manager.options.unhandledLimit,
      report: this.#report,
      notify: this.#notify,
      liquidate: async () => {
        const result = await liquidateProcessOwner(
          { kind: 'proxy-plugin', name, host },
          this.#state.manager.options.liquidation.cascade,
          this.#report
        )
        const current = this.#state.dependents.get(name)?.snapshot()
        if (current)
          this.#recordTombstone({
            ...current,
            reason: liquidationReason(current.reason, result.cleanupErrors)
          })
        this.#state.dependents.get(name)?.close()
        this.#state.dependents.delete(name)
        for (const step of result.affected)
          if (step.name !== name && step.action === 'suspend')
            this.#followAffected(step.name, reason, host)
      }
    })
    this.#state.dependents.set(name, diagnostic)
  }
}

/** Construct the single owner for one service resilience governor. */
export function createProcessResilience(options: IProcessResilienceOptions): IProcessResilience {
  return new ProcessResilience(options).value
}
