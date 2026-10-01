import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRemoteCallGuard } from '../../remote/types.js'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import { listenProcessRegistrations } from './rendezvous.js'
import { createProcessSessionManager } from './session.js'
import { createProcessTerminalRegistration, type IProcessTerminalRegistration } from './terminal.js'
import type {
  IProcessRegistration,
  IProcessRegistrationListener,
  IProcessResilience,
  IProcessResilienceOptions,
  IProcessResilienceSnapshot,
  IProcessLiquidationOwner
} from './types.js'

/** One close outcome retains every independently failing listener or registration. */
function closeFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

/** Own bounded sessions and one terminal diagnostic clock per registered supervisor. */
export function createProcessResilience(options: IProcessResilienceOptions): IProcessResilience {
  const manager = createProcessSessionManager(options)
  /** Normal registrations are removed at their own release, not kept as tombstones. */
  const registrations = new Map<string, IProcessTerminalRegistration>()
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

  /** Only a committed local owner may liquidate its own registration. */
  const liquidate = async (owner: IProcessLiquidationOwner): Promise<void> => {
    if (owner.kind === 'standalone-host') {
      await owner.release()
      return
    }
    const outcome = await owner.host.unUse(owner.name, {
      policy: manager.options.liquidation.cascade ? 'cascade' : 'suspend'
    })
    if (!outcome.ok) for (const error of outcome.errors) report(error)
  }

  return Object.freeze({
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
      const current = createProcessTerminalRegistration({
        name,
        binding,
        scheduler: manager.options.scheduler,
        report,
        reportAtMs: manager.options.reportAtMs,
        unhandledLimit: manager.options.unhandledLimit,
        async notify(snapshot) {
          const outcomes = await Promise.allSettled(
            [...terminalSubscribers].map((listener) =>
              Promise.resolve().then(() => listener(snapshot))
            )
          )
          let handled = false
          for (const outcome of outcomes) {
            if (outcome.status === 'fulfilled') handled = true
            else report(outcome.reason)
          }
          return handled
        },
        liquidate: () => liquidate(owner),
        onClose: () => registrations.delete(name)
      })
      registrations.set(name, current)
      return current.registration
    },
    callGuard(name): IRemoteCallGuard {
      let guard = guards.get(name)
      if (!guard) {
        guard = Object.freeze({
          beforeDispatch(input): void {
            registrations.get(name)?.guard.beforeDispatch(input)
          }
        })
        guards.set(name, guard)
      }
      return guard
    },
    inspect(id): IProcessResilienceSnapshot | undefined {
      return registrations.get(id)?.snapshot()
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
        terminalSubscribers.clear()
        guards.clear()
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === 'rejected' ? [outcome.reason] : []
        )
        if (errors.length > 0) throw closeFailure(errors)
      })())
    }
  })
}
