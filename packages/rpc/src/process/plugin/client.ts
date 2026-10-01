import type { IProcessHandle } from '@migaia/supervision/process'
import type { IPluginBeforeReleaseContext } from '@migaia/plugin-host'
import { ReplaceStrategy } from '@migaia/supervision'
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
import type { IProcessPlugin, IProcessPluginOptions, IProcessPluginReplaceResult } from './types.js'

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
  if (options.deployment.kind === 'spawn') {
    const deployment = options.deployment
    const binding = createSpawnProcessBinding(deployment, options.report)
    /** Admission stays synchronous; the selected owner performs the actual replacement. */
    const replace: IProcessPlugin['replace'] = (
      replacement = {}
    ): Promise<IProcessPluginReplaceResult> => {
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
        retryPort: options.retryPort
      },
      {
        replace,
        beforeRelease: (context: IPluginBeforeReleaseContext) =>
          binding.drainCurrent({ hostRemainingMs: context.remainingMs() })
      }
    )
  }
  const binding = createConnectProcessBinding(options.deployment, options.report)
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
      retryPort: options.retryPort
    },
    {
      replace,
      beforeRelease: (context: IPluginBeforeReleaseContext) =>
        binding.drainCurrent({ hostRemainingMs: context.remainingMs() })
    }
  )
}
