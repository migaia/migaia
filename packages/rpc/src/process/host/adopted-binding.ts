import { resolveAbortReason } from '../../core/internal/async-control.js'
import { RpcCapability } from '../../contract/wire-constants.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../remote/types.js'
import {
  checkNativePing,
  createProcessConnectionSupervisor,
  registrationSupervisor,
  requirePingEndpoint,
  reportSafely,
  type IProcessConnectionUnit,
  type IProcessPluginBinding
} from '../plugin/binding.js'
import { createProcessBindingDrain } from '../resilience/drain.js'
import {
  DEFAULT_HEALTH_FAILURE_THRESHOLD,
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS
} from '../resilience/constants.js'
import type { IProcessSessionLease } from '../resilience/types.js'
import type { IAbortSignal } from '@migaia/lifecycle'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'

/** Adoption changes only channel ownership; local supervision never gains an external PID. */
export type IAdoptedProcessBinding = IProcessPluginBinding<IProcessConnectionUnit, string> &
  Readonly<{ adopt(): void }>

/** Consume one already established channel with PP2's canonical close-only supervision profile. */
export function createAdoptedProcessBinding(
  candidate: IProcessSessionLease & Readonly<{ signal: IAbortSignal }>,
  report: (error: unknown) => void
): IAdoptedProcessBinding {
  /** Until the callback returns adopt, I16 alone owns physical rollback and its connection lease. */
  let adopted = false
  /** A closed adopted channel can never be dialed, established or manually restarted again. */
  let closed = false
  /** Remote and supervisor disposal share one local session exit. */
  let closing: Promise<void> | undefined
  /** Resolve the one local unit exit from either physical loss or explicit retirement. */
  let settleExit!: (exit: Readonly<{ reason: unknown }>) => void
  /** Only the live endpoint may satisfy a native health probe. */
  let ready: Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }> | undefined
  /** The local unit budget is separate from I16's one physical connection admission lease. */
  const exited = new Promise<Readonly<{ reason: unknown }>>((resolve) => {
    settleExit = resolve
  })
  /** Candidate cancellation is propagated without creating a second handshake or cancel owner. */
  const lost = (): void => {
    closed = true
    settleExit({ reason: resolveAbortReason(candidate.signal) })
  }
  candidate.signal.addEventListener('abort', lost, { once: true })
  if (candidate.signal.aborted) lost()
  /** Pre-adoption close releases local preparation; after adoption it also returns the I16 lease. */
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      closed = true
      candidate.signal.removeEventListener('abort', lost)
      try {
        if (adopted) await candidate.close()
      } finally {
        settleExit({ reason: undefined })
      }
    })())
  /** The physical channel's disposer enforces the transfer boundary for remote rollback. */
  const channel: IRemoteChannel = { ...candidate.channel, close }
  /** Identity comes from the authenticated session, never from a newly invented routing peer. */
  const unit: IProcessConnectionUnit = {
    identity: { fingerprint: candidate.identity.sessionId },
    exited,
    close
  }
  /** Use the established channel clock for all supervision and drain work. */
  const scheduler = channel.scheduler
  /** Native negotiated ping selects the existing health check rather than a new protocol. */
  const health = channel.agreement.capabilities.includes(RpcCapability.ping) ? 'ping' : 'none'
  /** One generation drain accounts for endpoint work and logical request settlement. */
  const drain = createProcessBindingDrain(scheduler, (error) => reportSafely(report, error))
  /** The canonical supervisor owns readiness, health and close-only unit retirement. */
  const supervisor = createProcessConnectionSupervisor(
    candidate.identity.connectionId,
    scheduler,
    report,
    {
      capabilities: {},
      async launch(_address, context) {
        if (closed || candidate.signal.aborted || context.signal.aborted)
          throw createProcessError(RpcProcessErrorCode.channelClosed)
        return unit
      }
    },
    {
      restart: { mode: 'on-failure', maxRestarts: 0 },
      ...(health === 'ping'
        ? {
            health: {
              check: (_unit: IProcessConnectionUnit, signal: IAbortSignal) =>
                checkNativePing(ready, signal),
              intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
              timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
              failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
            }
          }
        : {})
    }
  )
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    health,
    registrationSupervisor: registrationSupervisor(supervisor),
    trackRequest: drain.trackCurrent,
    drainCurrent: (options) =>
      supervisor.state === 'ready' ? drain.drainCurrent(options) : Promise.resolve(),
    bindEndpoint(next, endpoint) {
      if (health === 'ping') requirePingEndpoint(next, endpoint)
      const tracked = drain.wrap(next, endpoint)
      ready = { channel: next, endpoint: tracked }
      return tracked
    },
    async openChannel(_unit, signal) {
      if (candidate.signal.aborted) throw resolveAbortReason(candidate.signal)
      if (signal.aborted) throw resolveAbortReason(signal)
      if (closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
      return channel
    },
    adopt() {
      if (closed || candidate.signal.aborted)
        throw createProcessError(RpcProcessErrorCode.channelClosed)
      adopted = true
    }
  }
}
