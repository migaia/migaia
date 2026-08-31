import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/lifecycle'
import { TrayErrorCode } from '../error-code.js'
import { createTrayError } from '../errors.js'
import type { IAdapter, IAdapterContext } from './typing.js'

/** Snapshots adapter invocation once and assimilates foreign thenables safely. */
export function defineAdapter<
  TArtifact,
  THost extends import('@migaia/plugin-host').PluginHost<any, any, any>,
  TPlugin extends import('../host/typing.js').ITrayPluginConstraint<THost>
>(adapter: IAdapter<TArtifact, THost, TPlugin>): IAdapter<TArtifact, THost, TPlugin> {
  if (!adapter || typeof adapter !== 'object' || typeof adapter.adapt !== 'function')
    throw createTrayError(TrayErrorCode.adapterContractInvalid)
  const adapt = adapter.adapt
  return Object.freeze({
    adapt: (artifact: TArtifact, context: IAdapterContext): TPlugin | PromiseLike<TPlugin> => {
      const result = adapt(artifact, context)
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed) throw probe.error
      return probe.kind === ThenableProbeKind.thenable
        ? assimilateCapturedThen<TPlugin>(probe.thenFn, result)
        : result
    }
  })
}
