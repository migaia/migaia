import { createProcessResilience } from '../resilience/index.js'
import type { IProcessRegistration } from '../resilience/types.js'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import type { IPluginBeforeReleaseContext } from '@migaia/plugin-host'
import { ReplaceStrategy } from '@migaia/supervision'
import { SUPERVISION_SOURCE, SupervisionErrorCode, SupervisionErrorText } from '@migaia/supervision'
import { attachErrorIdentity } from '@migaia/utils/error'
import { normalizeRemoteContract } from '../../remote/contract.js'
import { assembleRemotePluginDefinition } from '../../remote/internal/assemble-plugin.js'
import type { IRemoteEndpointFactory } from '../../remote/types.js'
import {
  createConnectProcessBinding,
  createSpawnProcessBinding,
  invalidOption,
  reportSafely,
  type IProcessPluginBinding,
  validateSpawnProcessPluginDeployment
} from './binding.js'
import type {
  IProcessConnectionHandle,
  IProcessPlugin,
  IProcessPluginOptions,
  IProcessPluginReplaceResult
} from './types.js'

/** Keep failed endpoint admission inside the generation's rollback boundary. */
function processEndpointFactory<TUnit extends object, TSpec>(
  binding: IProcessPluginBinding<TUnit, TSpec>,
  factory: IRemoteEndpointFactory,
  report: (error: unknown) => void
): IRemoteEndpointFactory {
  return async (channel, signal) => {
    const endpoint = await factory(channel, signal)
    try {
      return binding.bindEndpoint(channel, endpoint)
    } catch (error) {
      try {
        await endpoint.endpoint.dispose()
      } catch (cleanupError) {
        reportSafely(report, cleanupError)
      }
      throw error
    }
  }
}

/** A retired definition has the same terminal identity as its disposed supervisor. */
function staleDefinition(): never {
  throw attachErrorIdentity(new Error(SupervisionErrorText.scopeTerminal), {
    source: SUPERVISION_SOURCE,
    code: SupervisionErrorCode.scopeTerminal
  })
}

/** Adds one supervised process deployment to remote's single trusted PluginHost assembly. */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>
): IProcessPlugin {
  const contract = normalizeRemoteContract(options.contract)
  if (options.name !== contract.plugin) invalidOption('name')
  if (
    options.registrationOwner?.name !== options.name ||
    typeof options.registrationOwner.host?.unUse !== 'function'
  )
    invalidOption('registrationOwner')
  /** One governor lives across supervisor generations, rather than per endpoint. */
  const binding: IProcessPluginBinding<
    IProcessHandle | IProcessConnectionHandle,
    IProcessSpec | string
  > = (
    options.deployment.kind === 'spawn'
      ? createSpawnProcessBinding(options.deployment, options.report)
      : createConnectProcessBinding(options.deployment, options.report)
  ) as IProcessPluginBinding<IProcessHandle | IProcessConnectionHandle, IProcessSpec | string>
  /** Borrowed governance is never closed by this definition. */
  const resilience =
    options.resilience ??
    createProcessResilience({
      scheduler: binding.scheduler,
      report: options.report
    })
  /** Liquidation releases the Plugin through its real local Host, retaining the tombstone. */
  let liquidating = false
  /** Candidate preparation has no installed registration; installation owns terminal diagnostics. */
  let registration: IProcessRegistration | undefined
  const attachRegistration = (): void => {
    registration = resilience.attachRegistration(
      options.name,
      {
        ownership: options.deployment.kind === 'spawn' ? 'spawn-owned' : 'connection-borrowed',
        health: binding.health,
        supervisor: binding.registrationSupervisor
      },
      {
        kind: 'proxy-plugin',
        name: options.name,
        host: {
          unUse: (async (
            name: string,
            removal: { policy: 'suspend' | 'cascade'; dryRun?: boolean }
          ) => {
            if (removal.dryRun)
              return options.registrationOwner.host.unUse(name, { ...removal, dryRun: true })
            liquidating = true
            try {
              return await options.registrationOwner.host.unUse(name, { ...removal, dryRun: false })
            } finally {
              liquidating = false
            }
          }) as typeof options.registrationOwner.host.unUse
        }
      }
    )
  }
  /** Normal release awaits diagnostics cleanup; committed liquidation retains its tombstone. */
  const releaseRegistration = async (): Promise<void> => {
    if (liquidating) return
    await registration?.close()
    if (!options.resilience) await resilience.close()
  }
  if (options.deployment.kind === 'spawn') {
    const deployment = options.deployment

    /** Only Host installation makes this exact definition eligible for replacement. */
    let installed = false
    /** Admission stays synchronous; the selected owner performs the actual replacement. */
    const replace: IProcessPlugin['replace'] = (
      replacement = {}
    ): Promise<IProcessPluginReplaceResult> => {
      if (!installed) staleDefinition()
      const strategy = replacement.strategy ?? ReplaceStrategy.stopThenStart
      if (
        strategy !== ReplaceStrategy.stopThenStart &&
        strategy !== ReplaceStrategy.startThenSwitch
      )
        invalidOption('strategy')
      if (replacement.spec)
        validateSpawnProcessPluginDeployment(
          { ...deployment, supervision: { ...deployment.supervision, spec: replacement.spec } },
          'spec'
        )
      if (strategy === ReplaceStrategy.stopThenStart)
        return binding.supervisor
          .replace({ strategy, spec: replacement.spec })
          .then((outcome) => ({ strategy, outcome }))
      if (typeof options.host.replace !== 'function') invalidOption('host.replace')
      /**
       * Candidate construction reuses supervision spec validation before touching the caller's
       * pool.
       */
      const candidate = createProcessPlugin({
        ...options,
        deployment: {
          ...deployment,
          supervision: {
            ...deployment.supervision,
            spec: replacement.spec ?? deployment.supervision.spec,
            prewarm: undefined
          }
        }
      })
      deployment.supervision.prewarm?.invalidate()
      return options.host
        .replace(options.name, candidate)
        .then(() => ({ strategy, plugin: candidate }))
    }
    return assembleRemotePluginDefinition(
      {
        name: options.name,
        contract,
        host: options.host,
        binding,
        endpointFactory: processEndpointFactory(binding, options.endpointFactory, options.report),
        report: options.report,
        callDeadlineCapMs: deployment.supervision.spec.limits?.callWallTimeMs,
        keyFactory: options.keyFactory,
        retryPort: options.retryPort,
        callGuard: resilience.callGuard(options.name)
      },
      {
        replace,
        beforeRelease: (context: IPluginBeforeReleaseContext) =>
          binding.drainCurrent({ hostRemainingMs: context.remainingMs() })
      },
      {
        onInstalled: () => {
          attachRegistration()
          installed = true
        },
        onReleased: () => {
          installed = false
          return releaseRegistration()
        }
      }
    )
  }

  /** A borrowed external process has no whole-process replacement command. */
  const replace: IProcessPlugin['replace'] = (): Promise<IProcessPluginReplaceResult> =>
    invalidOption('deployment.kind')
  return assembleRemotePluginDefinition(
    {
      name: options.name,
      contract,
      host: options.host,
      binding,
      endpointFactory: processEndpointFactory(binding, options.endpointFactory, options.report),
      report: options.report,
      keyFactory: options.keyFactory,
      retryPort: options.retryPort,
      callGuard: resilience.callGuard(options.name)
    },
    {
      replace,
      beforeRelease: (context: IPluginBeforeReleaseContext) =>
        binding.drainCurrent({ hostRemainingMs: context.remainingMs() })
    },
    { onInstalled: attachRegistration, onReleased: releaseRegistration }
  )
}
