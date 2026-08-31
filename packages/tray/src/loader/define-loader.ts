import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/lifecycle'
import { TrayErrorCode } from '../error-code.js'
import { createTrayError } from '../errors.js'
import type { ILoadedArtifact, ILoader, ILoaderContext } from './typing.js'

/** Snapshots loader invocation once and assimilates foreign thenables safely. */
export function defineLoader<TSource, TArtifact>(
  loader: ILoader<TSource, TArtifact>
): ILoader<TSource, TArtifact> {
  if (!loader || typeof loader !== 'object' || typeof loader.load !== 'function')
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  const load = loader.load
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
