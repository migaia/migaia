import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import type { IAdapter, IAdapterContext } from './typing.ts'

/**
 * Captures the adapt method once and returns a frozen reusable contract. Each invocation converts
 * once and assimilates foreign thenables without taking artifact, Host or scope ownership. Invalid
 * shapes throw ADAPTER_CONTRACT_INVALID; conversion failures reach the caller, or are classified by
 * loadIntoHost when used in its transaction.
 */
export function defineAdapter<
  TArtifact,
  THost extends import('../host/typing.ts').ITrayHostSource,
  const TPlugin extends import('../host/typing.ts').ITrayPluginConstraint<THost>
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
