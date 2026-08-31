import { createAbortController, createProvisionalScope, systemScheduler } from '@migaia/lifecycle'
import { TrayErrorCode } from '../error-code.js'
import { attachTrayError, createTrayError } from '../errors.js'
import { registerArtifactCustody } from '../host/internal-capability.js'
import { defineAdapter } from '../adapter/define-adapter.js'
import { defineLoader } from './define-loader.js'
import type { ILoadIntoHostOptions, ILoadedArtifact, ILoaderContext } from './typing.js'

/** Executes one atomic load/adapt/managed-mutation transaction with exact artifact custody. */
export async function loadIntoHost<
  TSource,
  TArtifact,
  THost extends import('@migaia/plugin-host').PluginHost<any, any, any>,
  TPlugin extends import('../host/typing.js').ITrayPluginConstraint<THost>
>(options: ILoadIntoHostOptions<TSource, TArtifact, THost, TPlugin>): Promise<unknown> {
  if (!options || typeof options !== 'object')
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  const timeoutMs = options.timeoutMs
  if (
    timeoutMs !== false &&
    (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  if (options.mutation !== 'use' && options.mutation !== 'replace')
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  const controller = createAbortController()
  const scope = createProvisionalScope({ parentSignal: options.signal })
  const forwardScopeAbort = (): void => controller.abort(scope.signal.reason)
  scope.signal.addEventListener('abort', forwardScopeAbort, { once: true })
  if (scope.signal.aborted) forwardScopeAbort()
  const deadlineAt = timeoutMs === false ? undefined : systemScheduler.now() + timeoutMs
  const timeoutTask =
    timeoutMs === false ? undefined : systemScheduler.schedule(() => controller.abort(), timeoutMs)
  const report = (error: unknown): void => {
    try {
      options.report?.(error)
    } catch {
      // Reporter failures cannot replace the transaction result.
    }
  }
  const context: ILoaderContext = Object.freeze({
    signal: controller.signal,
    deadlineAt,
    report
  })
  let artifact: ILoadedArtifact<TArtifact>
  let phase: 'loader' | 'adapter' | 'mutation' = 'loader'
  try {
    const loaded = await defineLoader(options.loader).load(options.source, context)
    if (!loaded || typeof loaded !== 'object')
      throw createTrayError(TrayErrorCode.loaderContractInvalid)
    const value = loaded.value
    const release = loaded.release
    if (!release || typeof release !== 'object' || typeof release.force !== 'function')
      throw createTrayError(TrayErrorCode.loaderContractInvalid)
    artifact = Object.freeze({ value, release })
    scope.own(artifact.value, artifact.release)
    phase = 'adapter'
    const plugin = await defineAdapter<TArtifact, THost, TPlugin>(options.adapter).adapt(
      artifact.value,
      {
        signal: controller.signal,
        deadlineAt
      }
    )
    if (!plugin || typeof plugin !== 'object')
      throw createTrayError(TrayErrorCode.adapterContractInvalid)
    registerArtifactCustody(plugin as object, {
      scope,
      rollback: () => scope.rollback()
    })
    phase = 'mutation'
    const result =
      options.mutation === 'replace'
        ? await options.host.replace(plugin)
        : await options.host.use(plugin)
    if (!(result && typeof result === 'object' && 'committed' in result)) {
      await scope.rollback()
      throw createTrayError(TrayErrorCode.loaderContractInvalid)
    }
    if (!(result as { readonly committed: boolean }).committed) await scope.rollback()
    return result
  } catch (error) {
    timeoutTask?.cancel()
    try {
      await scope.rollback()
    } catch (cleanupError) {
      report(cleanupError)
    }
    const code =
      phase === 'loader'
        ? TrayErrorCode.loaderExecutionFailed
        : phase === 'adapter'
          ? TrayErrorCode.adapterExecutionFailed
          : TrayErrorCode.invalidEntry
    throw attachTrayError(error instanceof Error ? error : createTrayError(code, error), code)
  }
}
