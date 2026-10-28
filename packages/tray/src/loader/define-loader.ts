import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import type { ILoadedArtifact, ILoader, ILoaderContext } from './typing.ts'

/**
 * Captures the load method once and returns a frozen reusable contract. Each call executes that
 * method once and assimilates foreign thenables; this helper neither acquires custody nor releases
 * artifacts. Invalid shapes throw LOADER_CONTRACT_INVALID. loadIntoHost owns result validation,
 * execution-error classification and transaction cleanup when this loader is used there.
 */
export function defineLoader<TSource, TArtifact>(
  loader: ILoader<TSource, TArtifact>
): ILoader<TSource, TArtifact> {
  if (!loader || typeof loader !== 'object')
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  /** The validated method is exactly the method retained for every invocation. */
  const load = loader.load
  if (typeof load !== 'function') throw createTrayError(TrayErrorCode.loaderContractInvalid)
  return Object.freeze({
    load: (
      source: TSource,
      context: ILoaderContext
    ): ILoadedArtifact<TArtifact> | PromiseLike<ILoadedArtifact<TArtifact>> => {
      const result = load(source, context)
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed) throw probe.error
      return probe.kind === ThenableProbeKind.thenable
        ? assimilateCapturedThen(probe.thenFn, result)
        : result
    }
  }) as ILoader<TSource, TArtifact>
}
