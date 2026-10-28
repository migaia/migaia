/**
 * Owns one load/adapt/mutation transaction; lifecycle retains rollback and committed generation
 * custody.
 */
import { createAbortController, createProvisionalScope } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import { TrayErrorCode } from '../error-code.ts'
import { attachTrayError, createTrayError } from '../errors.ts'
import { registerArtifactCustody } from '../host/internal-capability.ts'
import { defineAdapter } from '../adapter/define-adapter.ts'
import { defineLoader } from './define-loader.ts'
import type {
  ILoadIntoHostOptions,
  ILoadIntoHostResult,
  ILoadedArtifact,
  ILoaderContext
} from './typing.ts'
import type {
  ITrayHostTypeInfo,
  ITrayHostSourceOf,
  ITrayHostReadyPlugins,
  ITrayPluginAdmission,
  ITrayPluginConstraint
} from '../host/typing.ts'

/** Caller cancellation and diagnostics are borrowed only during this admission transaction. */
type ILoaderTransactionOptions = Readonly<{
  readonly signal?: IAbortSignal
  readonly report?: (error: unknown) => void
}>

/** Owns admission callbacks and their removal without adding an async wrapper to loadIntoHost. */
class LoaderTransaction {
  /** Original options preserve the signal and report getter reads at their existing call sites. */
  readonly #options: ILoaderTransactionOptions
  /** Admission cancellation ends with the transaction rather than the committed generation. */
  readonly #controller = createAbortController()
  /** The canonical provisional scope owns artifact rollback and later generation custody. */
  readonly #scope = createProvisionalScope({ parentSignal: this.#controller.signal })
  /** Deadline is captured after forwarding an already-aborted caller, preserving original order. */
  readonly #deadlineAt: number | undefined
  /** The single admission timer is cancelled when the public async transaction finishes. */
  readonly #timeoutTask: ReturnType<typeof systemScheduler.schedule> | undefined
  /** Original frozen loader context retains one signal, deadline and reporter. */
  readonly #context: ILoaderContext

  /** Bridge admission cancellation before creating the original frozen loader context. */
  constructor(options: ILoaderTransactionOptions, timeoutMs: number | false) {
    this.#options = options
    options.signal?.addEventListener('abort', this.#forwardCallerAbort, { once: true })
    if (options.signal?.aborted) this.#forwardCallerAbort()
    this.#deadlineAt = timeoutMs === false ? undefined : systemScheduler.now() + timeoutMs
    this.#timeoutTask =
      timeoutMs === false
        ? undefined
        : systemScheduler.schedule(() => this.#controller.abort(), timeoutMs)
    this.#context = Object.freeze({
      signal: this.#scope.signal,
      deadlineAt: this.#deadlineAt,
      report: this.report
    })
  }

  /** Forward only caller cancellation received while admission still owns the listener. */
  #forwardCallerAbort = (): void => this.#controller.abort(this.#options.signal?.reason)

  /** Secondary diagnostics cannot replace the transaction's original result or primary error. */
  report = (error: unknown): void => {
    try {
      this.#options.report?.(error)
    } catch {
      // Reporter failures cannot replace the transaction result.
    }
  }

  /** Borrow the existing scope for artifact ownership and exact-generation custody transfer. */
  get scope(): ReturnType<typeof createProvisionalScope> {
    return this.#scope
  }

  /** Return the same frozen context for the single Loader invocation. */
  get context(): ILoaderContext {
    return this.#context
  }

  /** Share the captured deadline with Adapter without reading caller timeout options again. */
  get deadlineAt(): number | undefined {
    return this.#deadlineAt
  }

  /** End admission cancellation while leaving the scope with its canonical custody owner. */
  close(): void {
    this.#timeoutTask?.cancel()
    this.#options.signal?.removeEventListener('abort', this.#forwardCallerAbort)
  }
}

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
  /** Snapshot the required timeout once before any cancellation resource is created. */
  const timeoutMs = options.timeoutMs
  if (
    timeoutMs !== false &&
    (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  if (options.mutation !== 'use' && options.mutation !== 'replace')
    throw createTrayError(TrayErrorCode.loaderContractInvalid)
  /** Named admission owner replaces function-local listener and reporter closures. */
  const transaction = new LoaderTransaction(options, timeoutMs)
  /** The scope continues to own rollback and is handed to the exact committed generation. */
  const scope = transaction.scope
  /** Adapter receives the same deadline that was already supplied to Loader. */
  const deadlineAt = transaction.deadlineAt
  /** Valid Loader output is retained until the Adapter has consumed its exact value. */
  let artifact: ILoadedArtifact<TArtifact>
  /** Phase only selects fallback error classification; foreign classified errors remain intact. */
  let phase: 'loader' | 'adapter' | 'mutation' = 'loader'
  try {
    /** The original await remains the sole Loader completion boundary. */
    const loaded = await defineLoader(options.loader).load(options.source, transaction.context)
    if (!loaded || typeof loaded !== 'object')
      throw createTrayError(TrayErrorCode.loaderContractInvalid)
    /** Read the result value once before admitting its release descriptor. */
    const value = loaded.value
    /** The exact release object transfers to the lifecycle owner without wrapping. */
    const release = loaded.release
    if (!release || typeof release !== 'object' || typeof release.force !== 'function')
      throw createTrayError(TrayErrorCode.loaderContractInvalid)
    artifact = Object.freeze({ value, release })
    scope.own(artifact.value, artifact.release)
    phase = 'adapter'
    /** Adapter conversion keeps its original await and exact plugin descriptor identity. */
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
    /** The committed bit, rather than success or readiness, decides custody. */
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
      transaction.report(cleanupError)
    }
    /** Preserve phase-specific fallback classification without changing any error text. */
    const code =
      phase === 'loader'
        ? TrayErrorCode.loaderExecutionFailed
        : phase === 'adapter'
          ? TrayErrorCode.adapterExecutionFailed
          : TrayErrorCode.invalidEntry
    throw attachTrayError(error instanceof Error ? error : createTrayError(code, error), code)
  } finally {
    transaction.close()
  }
}
