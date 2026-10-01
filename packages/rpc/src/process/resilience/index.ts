import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRemoteCallGuard } from '../../remote/types.js'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
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
const sessionManagers = new WeakMap<IProcessResilience, IProcessSessionManager>()

/** Obtain the canonical quotas and store for a service-owned governor. */
export function processSessionManager(
  resilience: IProcessResilience
): IProcessSessionManager | undefined {
  const manager = sessionManagers.get(resilience)
  return manager
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

/** Own bounded sessions and one terminal diagnostic clock per registered supervisor. */
export function createProcessResilience(options: IProcessResilienceOptions): IProcessResilience {
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
  /** Stable guard objects can be handed to remote before a registration is attached. */
  const guards = new Map<string, IRemoteCallGuard>()
  let closed = false
  let closePromise: Promise<void> | undefined

  const report = (error: unknown): void => {
    try {
      options.report(error)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }

  const recordTombstone = (snapshot: IProcessResilienceSnapshot): void => {
    tombstones.delete(snapshot.id)
    tombstones.set(snapshot.id, {
      snapshot: Object.freeze({ ...snapshot, liquidated: true }),
      time: manager.options.scheduler.now()
    })
    while (tombstones.size > MAX_LIQUIDATION_TOMBSTONES) {
      const oldest = tombstones.keys().next().value
      if (oldest !== undefined) tombstones.delete(oldest)
    }
  }

  const notify = async (snapshot: IProcessResilienceSnapshot): Promise<boolean> => {
    const outcomes = await Promise.allSettled(
      [...terminalSubscribers].map((listener) => Promise.resolve().then(() => listener(snapshot)))
    )
    let handled = false
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') handled = true
      else report(outcome.reason)
    }
    return handled
  }

  /** Dependants come only from the mutation's actual committed plan. */
  const followAffected = (
    name: string,
    reason: unknown,
    host: IProcessDependencyHostPort
  ): void => {
    if (dependents.has(name) || tombstones.has(name)) return
    const diagnostic = createProcessDependentDiagnostic({
      name,
      reason,
      scheduler: manager.options.scheduler,
      reportAtMs: manager.options.reportAtMs,
      unhandledLimit: manager.options.unhandledLimit,
      report,
      notify,
      async liquidate() {
        const result = await liquidateProcessOwner(
          { kind: 'proxy-plugin', name, host },
          manager.options.liquidation.cascade,
          report
        )
        const current = dependents.get(name)?.snapshot()
        if (current)
          recordTombstone({
            ...current,
            reason: liquidationReason(current.reason, result.cleanupErrors)
          })
        dependents.get(name)?.close()
        dependents.delete(name)
        for (const step of result.affected)
          if (step.name !== name && step.action === 'suspend')
            followAffected(step.name, reason, host)
      }
    })
    dependents.set(name, diagnostic)
  }

  const resilience: IProcessResilience = Object.freeze({
    sessionOptions: manager.sessionOptions,
    async listenRegistrations(input): Promise<IProcessRegistrationListener> {
      if (closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
      const underlying = await listenProcessRegistrations(manager, input, report)
      if (closed) {
        await underlying.close()
        throw createProcessError(RpcProcessErrorCode.channelClosed)
      }
      let released: Promise<void> | undefined
      const owned: IProcessRegistrationListener = Object.freeze({
        address: underlying.address,
        close: () =>
          (released ??= underlying.close().finally(() => {
            listeners.delete(owned)
          }))
      })
      listeners.add(owned)
      return owned
    },
    attachRegistration(name, binding, owner): IProcessRegistration {
      if (closed || typeof name !== 'string' || name.length === 0 || registrations.has(name))
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
      tombstones.delete(name)
      dependents.get(name)?.close()
      dependents.delete(name)
      const current = createProcessTerminalRegistration({
        name,
        binding,
        scheduler: manager.options.scheduler,
        report,
        reportAtMs: manager.options.reportAtMs,
        unhandledLimit: manager.options.unhandledLimit,
        notify,
        async liquidate() {
          const result = await liquidateProcessOwner(
            owner,
            manager.options.liquidation.cascade,
            report
          )
          const currentSnapshot = current.snapshot()
          const retainedReason = liquidationReason(currentSnapshot?.reason, result.cleanupErrors)
          if (currentSnapshot) recordTombstone({ ...currentSnapshot, reason: retainedReason })
          if (owner.kind !== 'proxy-plugin') return
          for (const step of result.affected) {
            if (step.name === name) continue
            if (step.action === 'suspend') followAffected(step.name, retainedReason, owner.host)
            else if (step.action === 'release') {
              await registrations.get(step.name)?.registration.close()
              recordTombstone({
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
          registrations.delete(name)
          dependents.get(name)?.close()
          dependents.delete(name)
        }
      })
      registrations.set(name, current)
      return current.registration
    },
    callGuard(name): IRemoteCallGuard {
      let guard = guards.get(name)
      if (!guard) {
        guard = Object.freeze({
          beforeDispatch(input): void {
            const tombstone = tombstones.get(name)
            if (tombstone)
              throw createProcessError(RpcProcessErrorCode.liquidated, tombstone.snapshot.reason, {
                registrationId: name
              })
            const dependent = dependents.get(name)
            if (dependent) {
              const suspended = dependent.snapshot()
              throw createProcessError(RpcProcessErrorCode.terminalCall, suspended.reason, {
                registrationId: name
              })
            }
            registrations.get(name)?.guard.beforeDispatch(input)
          }
        })
        guards.set(name, guard)
      }
      return guard
    },
    inspect(id): IProcessResilienceSnapshot | undefined {
      return (
        tombstones.get(id)?.snapshot ??
        dependents.get(id)?.snapshot() ??
        registrations.get(id)?.snapshot()
      )
    },
    onTerminal(listener): () => void {
      if (closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
      terminalSubscribers.add(listener)
      return () => terminalSubscribers.delete(listener)
    },
    close(): Promise<void> {
      return (closePromise ??= (async () => {
        closed = true
        const outcomes = await Promise.allSettled([
          ...[...listeners].map((listener) => listener.close()),
          ...[...registrations.values()].map((current) => current.registration.close())
        ])
        manager.close()
        for (const dependent of dependents.values()) dependent.close()
        dependents.clear()
        tombstones.clear()
        terminalSubscribers.clear()
        guards.clear()
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === 'rejected' ? [outcome.reason] : []
        )
        if (errors.length > 0) throw closeFailure(errors)
      })())
    }
  })
  sessionManagers.set(resilience, manager)
  return resilience
}
