import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { TrayErrorCode } from '../error-code.js'
import { createTrayError } from '../errors.js'
import type { IAdapter, IAdapterContext } from './typing.js'

/** Snapshots adapter invocation once and assimilates foreign thenables safely. */
export function defineAdapter<
  TArtifact,
  THost extends import('../host/typing.js').ITrayHostSource,
  const TPlugin extends import('../host/typing.js').ITrayPluginConstraint<THost>
>(adapter: IAdapter<TArtifact, THost, TPlugin>): IAdapter<TArtifact, THost, TPlugin> {
  if (!adapter || typeof adapter !== 'object')
    throw createTrayError(TrayErrorCode.adapterContractInvalid)
  /** The validated method is exactly the method retained for every invocation. */
  const adapt = adapter.adapt
  if (typeof adapt !== 'function') throw createTrayError(TrayErrorCode.adapterContractInvalid)
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
