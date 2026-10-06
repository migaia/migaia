import type { IAbortSignal } from '@migaia/lifecycle'
import type { IPluginRemoval } from '@migaia/plugin-host'
import { defaultRpcId } from '../../core/internal/id.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { normalizeRemoteContract } from '../../remote/contract.js'
import { createRemoteGenerationHolder, createRemoteRegistration } from '../../remote/proxy.js'
import { assembleRemotePluginDefinition } from '../../remote/internal/assemble-plugin.js'
import type {
  IProcessDependencyHostPort,
  IProcessResilience,
  IProcessSessionLease
} from '../resilience/types.js'
import { reportSafely } from '../plugin/binding.js'
import { createAdoptedProcessBinding } from './adopted-binding.js'
import { hostCleanupFailure, invalidHostOption } from './error.js'
import type { IProcessServeEndpointFactory } from '../plugin/types.js'
import type { IProcessHostRegistrations } from './types.js'

/** Adoption consumes only verified authority and an endpoint, independently of ordinary ingress. */
export type IProcessHostAdoptionOptions = Readonly<{
  endpointFactory: IProcessServeEndpointFactory
  report(error: unknown): void
  registrations: Pick<IProcessHostRegistrations, 'resolveRegistration'>
}>

/** One adopted plugin can be removed without closing any other target Host or connection. */
export type IAdoptedHostRegistration = Readonly<{ close(): Promise<void> }>

/** Prevalidate the trusted descriptor before installation and transfer one prepared remote owner. */
export async function adoptHostRegistration(
  candidate: IProcessSessionLease & Readonly<{ signal: IAbortSignal }>,
  options: IProcessHostAdoptionOptions,
  resilience: IProcessResilience,
  adopted: Set<IAdoptedHostRegistration>
): Promise<'adopt' | 'reject'> {
  /** Authority is selected only from the verifier's principal, never channel.peerId. */
  const approval = options.registrations.resolveRegistration(candidate.identity.principalId)
  if (!approval) return 'reject'
  /** Contract normalization preserves remote's original validation codes and causes. */
  const contract = normalizeRemoteContract(approval.contract)
  if (approval.name !== contract.plugin) invalidHostOption('registrations.resolveRegistration')
  if (candidate.signal.aborted) throw resolveAbortReason(candidate.signal)
  /** Names may repeat on separate target Hosts, but governance IDs may never collide. */
  const id = defaultRpcId()
  /** Adopt only the authenticated channel; never acquire an external process handle. */
  const binding = createAdoptedProcessBinding(candidate, options.report)
  /** Committed liquidation retains its tombstone rather than recursively closing its registration. */
  let liquidating = false
  /** Target installation commits ownership only after the already validated holder is accepted. */
  let installed = false
  /** Normal release shares diagnostics cleanup across unUse, EOF and explicit service close. */
  let cleanup: Promise<void> | undefined
  /** Repeated close operations share one cleanup outcome across cancellation races. */
  let closing: Promise<void> | undefined
  /** Adapt only this root name to its unique registration identity; dependency names stay actual. */
  const owner: IProcessDependencyHostPort = {
    unUse: (async (_name: string, removal: { policy: 'suspend' | 'cascade'; dryRun?: boolean }) => {
      if (removal.dryRun)
        return approval.targetHost.unUse(approval.name, { ...removal, dryRun: true })
      liquidating = true
      try {
        const result = await approval.targetHost.unUse(approval.name, { ...removal, dryRun: false })
        return {
          ...result,
          affected: {
            ...result.affected,
            steps: result.affected.steps.map((step) =>
              step.name === approval.name ? { ...step, name: id } : step
            )
          }
        }
      } finally {
        liquidating = false
      }
    }) as IProcessDependencyHostPort['unUse']
  }
  /** Attach the unique governance identity before remote preparation can publish. */
  const registration = resilience.attachRegistration(
    id,
    {
      ownership: 'connection-borrowed',
      health: binding.health,
      supervisor: binding.registrationSupervisor
    },
    { kind: 'proxy-plugin', name: id, host: owner }
  )
  /** One canonical registration performs both pre-install describe and installed proxy dispatch. */
  const remoteOptions = {
    name: approval.name,
    contract,
    host: approval.targetHost.plugin,
    binding,
    report: options.report,
    callGuard: resilience.callGuard(id),
    endpointFactory: async (
      channel: Parameters<typeof options.endpointFactory>[0],
      signal: IAbortSignal
    ) => {
      const endpoint = await options.endpointFactory(channel, signal, {
        identity: candidate.identity,
        ...resilience.sessionOptions(candidate.identity)
      })
      try {
        return binding.bindEndpoint(channel, endpoint)
      } catch (error) {
        try {
          await endpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(options.report, cleanupError)
        }
        throw error
      }
    }
  }
  /** The same remote resource owner survives prevalidation and committed PluginHost setup. */
  const holder = createRemoteGenerationHolder(
    createRemoteRegistration(remoteOptions),
    options.report
  )
  /** The release callback is lifecycle bookkeeping; remote's disposer alone owns endpoint/channel. */
  const released = (): Promise<void> => {
    candidate.signal.removeEventListener('abort', onLost)
    adopted.delete(owned)
    if (liquidating) return Promise.resolve()
    return (cleanup ??= registration.close())
  }
  /** EOF removal uses suspend so genuine dependants can recover after a new approved registration. */
  const owned: IAdoptedHostRegistration = {
    close: () =>
      (closing ??= (async () => {
        candidate.signal.removeEventListener('abort', onLost)
        /** Both cleanup failures stay reachable without replacing the first one. */
        const errors: unknown[] = []
        try {
          if (installed) {
            const result: IPluginRemoval = await approval.targetHost.unUse(approval.name, {
              policy: 'suspend'
            })
            if (!result.ok) for (const error of result.errors) reportSafely(options.report, error)
          } else await holder.release()
        } catch (error) {
          errors.push(error)
        }
        try {
          await released()
        } catch (error) {
          errors.push(error)
        }
        if (errors.length) throw hostCleanupFailure(errors)
      })())
  }
  /** I16 closes the physical channel once; Host handles only its committed plugin removal. */
  const onLost = (): void => {
    if (installed) void owned.close().catch((error) => reportSafely(options.report, error))
  }
  candidate.signal.addEventListener('abort', onLost, { once: true })
  try {
    await holder.prepareInitial(candidate.signal, true)
    if (candidate.signal.aborted) throw resolveAbortReason(candidate.signal)
    const definition = assembleRemotePluginDefinition(remoteOptions, undefined, {
      preparedHolder: holder,
      onReleased: released
    })
    await approval.targetHost.use(definition)
    installed = true
    if (candidate.signal.aborted) {
      await owned.close()
      return 'reject'
    }
    binding.adopt()
    adopted.add(owned)
    return 'adopt'
  } catch (error) {
    try {
      await owned.close()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    throw error
  }
}
