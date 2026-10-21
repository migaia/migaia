import { createAbortController, createProvisionalScope } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
import { TrayErrorCode } from '../error-code.js'
import { attachTrayError, createTrayError } from '../errors.js'
import { registerArtifactCustody } from '../host/internal-capability.js'
import { defineAdapter } from '../adapter/define-adapter.js'
import { defineLoader } from './define-loader.js'
import type {
  ILoadIntoHostOptions,
  ILoadIntoHostResult,
  ILoadedArtifact,
  ILoaderContext
} from './typing.js'
import type {
  ITrayHostTypeInfo,
  ITrayHostSourceOf,
  ITrayHostReadyPlugins,
  ITrayPluginAdmission,
  ITrayPluginConstraint
} from '../host/typing.js'

/**
 * Loads and adapts an artifact into an existing managed Host. Before commit the provisional scope
 * owns rollback; a committed definition owns release even when it is blocked or the result is not
 * ok. Returns the mutation observation and typed view. Execution failures retain their original
 * identity or cause; secondary rollback failures are reported. The required timeout and optional
 * caller signal only request cooperative cancellation, and their bridge ends when this call ends.
 */
export async function loadIntoHost<
  TSource,
  TArtifact,
  THost extends ITrayHostTypeInfo,
  const TPlugin extends ITrayPluginConstraint<ITrayHostSourceOf<THost>>,
  TMutation extends 'use' | 'replace'
>(
  options: ILoadIntoHostOptions<
    TSource,
    TArtifact,
    ITrayHostSourceOf<THost>,
    TPlugin,
    THost,
    TMutation
  >
): Promise<ILoadIntoHostResult<THost, TPlugin, TMutation>> {
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
  /** Admission cancellation ends with this transaction; the scope keeps generation custody. */
  const scope = createProvisionalScope({ parentSignal: controller.signal })
  /** Forward only the caller cancellation received while admission is still pending. */
  const forwardCallerAbort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', forwardCallerAbort, { once: true })
  if (options.signal?.aborted) forwardCallerAbort()
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
    signal: scope.signal,
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
    const plugin = await defineAdapter<
      TArtifact,
      ITrayHostSourceOf<THost>,
      TPlugin &
        ITrayPluginAdmission<
          ITrayHostSourceOf<THost>,
          readonly [TPlugin],
          ITrayHostReadyPlugins<THost>
        >[0]
    >(options.adapter).adapt(artifact.value, {
      signal: scope.signal,
      deadlineAt
    })
    if (!plugin || typeof plugin !== 'object')
      throw createTrayError(TrayErrorCode.adapterContractInvalid)
    registerArtifactCustody(plugin as object, {
      scope,
      rollback: () => scope.rollback()
    })
    phase = 'mutation'
    const result =
      options.mutation === 'replace'
        ? await options.host.replace<TPlugin>(plugin)
        : await options.host.use<TPlugin>(plugin)
    if (!(result && typeof result === 'object' && 'committed' in result)) {
      await scope.rollback()
      throw createTrayError(TrayErrorCode.loaderContractInvalid)
    }
    if (!(result as { readonly committed: boolean }).committed) await scope.rollback()
    return result as ILoadIntoHostResult<THost, TPlugin, TMutation>
  } catch (error) {
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
  } finally {
    timeoutTask?.cancel()
    options.signal?.removeEventListener('abort', forwardCallerAbort)
  }
}
