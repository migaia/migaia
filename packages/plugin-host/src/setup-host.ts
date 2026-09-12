import {
  createAbortController,
  createLifecycleScope,
  createProvisionalScope,
  systemScheduler,
  snapshotScheduler,
  type ILifecycleScheduler,
  type IAbortSignal
} from '@migaia/lifecycle'
import { observeAbortSubscription } from '@migaia/lifecycle/abort'
import { resolveDisposer } from './disposal.js'
import { PluginHost } from './host-runtime.js'
import { readDefinedPluginDefinition } from './define-plugin.js'
import ERROR_TEXT, {
  createPluginHostTypeError,
  PluginHostError,
  tagPluginHostError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { asyncDisposeKey } from './symbols.js'
import type {
  IDefinedPluginConstraint,
  IHostSetupContext,
  IPluginConstraint,
  IPluginHostDisposalResult,
  IPluginHostOptions,
  IPluginHostView,
  IPluginResource,
  ISetupHostOptions,
  ISetupHostView,
  ISetupPluginHost
} from './typing.js'

/** Internal concrete Host used only to supply the resolved Core to canonical V2 registration. */
class SetupRuntime<TCore extends object, TValue> extends PluginHost<Record<string, never>, TValue> {
  #core: TCore | undefined
  #coreScope: ReturnType<typeof createLifecycleScope> | undefined

  /** Configures the canonical Host with the functional definition reader for setupHost. */
  constructor(options: IPluginHostOptions) {
    super(options, readDefinedPluginDefinition)
  }

  /** Installs resolved Core and its cleanup owner before the first plugin is admitted. */
  setCore(core: TCore, scope: ReturnType<typeof createLifecycleScope>): void {
    this.#core = core
    this.#coreScope = scope
  }

  protected override createPluginDomainCore(): Record<string, never> {
    return this.#core as unknown as Record<string, never>
  }

  /** Joins canonical Host disposal with Core cleanup, preserving plugin-before-Core order. */
  override async dispose(): Promise<IPluginHostDisposalResult> {
    const result = await super.dispose()
    const errors = this.#coreScope ? await this.#coreScope.dispose() : []
    if (errors.length === 0) return result
    return Object.freeze({
      ...result,
      cleanupComplete: false,
      cleanupErrors: Object.freeze([...result.cleanupErrors, ...errors])
    })
  }
}

/** Turns an external abort into a rejected setup operation while preserving its reason. */
const setupAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    try {
      return tagPluginHostError(reason, PluginHostErrorCode.hostSetupAborted)
    } catch {
      return new PluginHostError(
        PluginHostErrorCode.hostSetupAborted,
        ERROR_TEXT.HOST_SETUP_ABORTED,
        {
          cause: reason
        }
      )
    }
  }
  return new PluginHostError(PluginHostErrorCode.hostSetupAborted, ERROR_TEXT.HOST_SETUP_ABORTED, {
    cause: reason
  })
}

/** Package-private setup race owner; timing and abort registration remain lifecycle-compatible. */
type ISetupDeadlineAdapter = {
  readonly deadlineAt: number | undefined
  readonly scheduler: ILifecycleScheduler
  readonly signal: IAbortSignal
  race<T>(task: PromiseLike<T>, phase: string): Promise<T>
  close(): void
}

/** Creates one setup deadline/race adapter without introducing a second lifecycle authority. */
const createSetupDeadlineAdapter = (options: {
  readonly scheduler: ILifecycleScheduler
  readonly setupTimeoutMs: number | false
  readonly signal?: IAbortSignal
  readonly controller: ReturnType<typeof createAbortController>
}): ISetupDeadlineAdapter => {
  const startedAt = options.scheduler.now()
  const deadlineAt =
    options.setupTimeoutMs === false ? undefined : startedAt + options.setupTimeoutMs
  if (deadlineAt !== undefined && !Number.isFinite(deadlineAt))
    throw createPluginHostTypeError('setupTimeoutMs must be false or a non-negative finite number')

  /** First external terminal reason; later signals are deliberately observed but cannot replace it. */
  let terminalError: unknown
  /** Current phase rejection sink, installed only while one setup awaitable is active. */
  let rejectActive: ((error: unknown) => void) | undefined
  /** Abort-subscription cleanup retained until setup succeeds or rolls back. */
  let subscription: ReturnType<typeof observeAbortSubscription> | undefined
  const onFailure = (error: unknown): void => {
    if (terminalError === undefined) terminalError = error
  }
  const externalSignal = options.signal
  if (externalSignal !== undefined) {
    subscription = observeAbortSubscription(
      externalSignal,
      (reason) => {
        const error = setupAbortError(reason)
        if (terminalError === undefined) terminalError = error
        rejectActive?.(error)
      },
      onFailure
    )
  }

  /** Runs one setup phase against the shared absolute deadline and observes late settlement. */
  const race = async <T>(task: PromiseLike<T>, phase: string): Promise<T> => {
    const observedTask = Promise.resolve(task)
    void observedTask.catch(() => undefined)
    const remaining = deadlineAt === undefined ? undefined : deadlineAt - options.scheduler.now()
    if (terminalError !== undefined) return Promise.reject(terminalError)
    if (remaining !== undefined && remaining < 0)
      return Promise.reject(
        new PluginHostError(PluginHostErrorCode.hostSetupTimeout, ERROR_TEXT.HOST_SETUP_TIMEOUT, {
          detail: { deadlineAt, phase }
        })
      )
    return new Promise<T>((resolve, reject) => {
      /** Settled guard ensures first terminal reason and timer cancellation are idempotent. */
      let settled = false
      /** Timer handle returned by the canonical scheduler, if this phase has a deadline. */
      let timer: { cancel(): void } | undefined
      const settle = (outcome: () => void): void => {
        if (settled) return
        settled = true
        rejectActive = undefined
        try {
          timer?.cancel()
        } catch (error) {
          reject(error)
          return
        }
        outcome()
      }
      rejectActive = (error) => settle(() => reject(error))
      if (terminalError !== undefined) {
        settle(() => reject(terminalError))
        return
      }
      try {
        if (remaining !== undefined) {
          timer = options.scheduler.schedule(
            () => {
              const timeoutError = new PluginHostError(
                PluginHostErrorCode.hostSetupTimeout,
                ERROR_TEXT.HOST_SETUP_TIMEOUT,
                { detail: { deadlineAt, phase } }
              )
              if (terminalError === undefined) terminalError = timeoutError
              options.controller.abort(`setup timeout: ${phase}`)
              settle(() => reject(timeoutError))
            },
            Math.max(0, remaining)
          )
          if (settled) timer.cancel()
        }
        void observedTask.then(
          (value) => settle(() => resolve(value)),
          (error: unknown) => settle(() => reject(error))
        )
      } catch (error) {
        settle(() => reject(error))
      }
    })
  }
  return {
    deadlineAt,
    scheduler: options.scheduler,
    signal: options.controller.signal,
    race,
    close: () => subscription?.unsubscribe()
  }
}

/** Functional async Core setup with one atomic initial plugin batch and one disposal authority. */
export async function setupHost<
  TCore extends object,
  const TPlugins extends readonly IDefinedPluginConstraint<TCore, any>[],
  TValue = never
>(
  options: ISetupHostOptions<TCore, TPlugins, TValue>
): Promise<ISetupHostView<ISetupPluginHost<TCore, TValue>, TCore, TValue, TPlugins>>
export async function setupHost<TCore extends object>(
  options: ISetupHostOptions<TCore, readonly [], never>
): Promise<ISetupHostView<ISetupPluginHost<TCore, never>, TCore, never, readonly []>>
export async function setupHost(options: ISetupHostOptions<any, any, any>): Promise<any> {
  if (!options || typeof options !== 'object')
    throw createPluginHostTypeError('setup options must be an object')
  /** Captured caller-owned setup options; validation and construction must never reread input. */
  const setupOptions = {
    host: options.host,
    setupTimeoutMs: options.setupTimeoutMs,
    core: options.core,
    plugins: options.plugins,
    signal: options.signal
  }
  const hostOptions = setupOptions.host
  const setupTimeoutMs = setupOptions.setupTimeoutMs
  if (typeof setupTimeoutMs !== 'number' && setupTimeoutMs !== false)
    throw createPluginHostTypeError('setupTimeoutMs must be false or a non-negative finite number')
  if (
    typeof setupTimeoutMs === 'number' &&
    (!Number.isFinite(setupTimeoutMs) || setupTimeoutMs < 0)
  )
    throw createPluginHostTypeError('setupTimeoutMs must be false or a non-negative finite number')
  if (typeof setupOptions.core !== 'function')
    throw createPluginHostTypeError('core must be a function')
  const plugins = setupOptions.plugins === undefined ? [] : [...setupOptions.plugins]
  for (const plugin of plugins)
    if (!readDefinedPluginDefinition(plugin))
      throw createPluginHostTypeError('setupHost plugins must be created by definePlugin')

  const setupController = createAbortController()
  const externalSignal = setupOptions.signal as IAbortSignal | undefined
  /** Snapshot nested Host options once so construction cannot replay hostile accessors. */
  const hostOptionsSnapshot = { ...hostOptions }
  /** Resolve the captured scheduler once and share it with setup and canonical Host lifecycles. */
  const scheduler = snapshotScheduler(hostOptionsSnapshot.scheduler) ?? systemScheduler
  const resolvedHostOptions = { ...hostOptionsSnapshot, scheduler }
  const setupAdapter = createSetupDeadlineAdapter({
    scheduler,
    setupTimeoutMs,
    signal: externalSignal,
    controller: setupController
  })
  const deadlineAt = setupAdapter.deadlineAt
  const host = new SetupRuntime<object, unknown>({ ...resolvedHostOptions })
  const provisional = createProvisionalScope({ parentSignal: setupController.signal })
  const coreScope = createLifecycleScope({ errorPolicy: 'collect' })
  try {
    const context: IHostSetupContext = Object.freeze({
      signal: setupController.signal,
      deadlineAt,
      onDispose: (resource) => {
        const disposer = resolveDisposer(resource as IPluginResource)
        if (!disposer) throw createPluginHostTypeError('setup resource must provide a disposer')
        provisional.own(resource, { order: 0, force: () => Promise.resolve(disposer()) })
      }
    })
    let core: object
    try {
      core = await setupAdapter.race(
        Promise.resolve().then(() => setupOptions.core(context)),
        'core'
      )
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { readonly code?: unknown }).code
          : undefined
      if (
        code === PluginHostErrorCode.hostSetupTimeout ||
        code === PluginHostErrorCode.hostSetupAborted
      )
        throw error
      throw new PluginHostError(
        PluginHostErrorCode.hostCoreSetupFailed,
        ERROR_TEXT.HOST_CORE_SETUP_FAILED,
        { cause: error }
      )
    }
    if (core === null || typeof core !== 'object' || Array.isArray(core)) {
      throw tagPluginHostError(
        new TypeError(ERROR_TEXT.HOST_CORE_SETUP_FAILED),
        PluginHostErrorCode.hostCoreSetupFailed
      )
    }
    await provisional.commitTo(coreScope)
    host.setCore(core, coreScope)
    const view = (await setupAdapter.race(host.use(...plugins), 'plugins')) as IPluginHostView<
      any,
      any
    >
    const publicHost = host as unknown as ISetupPluginHost<object, unknown>
    const setupView = Object.create(null) as Record<PropertyKey, unknown>
    Object.defineProperties(setupView, {
      host: { value: publicHost, enumerable: true },
      extensions: { value: view.extensions, enumerable: true },
      config: { value: view.config, enumerable: true },
      getShared: { value: (key: PropertyKey) => view.getShared(key), enumerable: true },
      use: {
        value: (...next: readonly IPluginConstraint<any>[]) => view.use(...next),
        enumerable: true
      },
      unUse: { value: (name: string) => view.unUse(name), enumerable: true },
      dispose: { value: () => host.dispose(), enumerable: true },
      [asyncDisposeKey]: { value: () => host.dispose().then(() => undefined), enumerable: false }
    })
    return Object.freeze(setupView) as ISetupHostView<
      ISetupPluginHost<object, unknown>,
      object,
      unknown,
      readonly IPluginConstraint<any>[]
    >
  } catch (error) {
    setupController.abort(error)
    const cleanupErrors: unknown[] = []
    try {
      await provisional.rollback()
    } catch (rollbackError) {
      cleanupErrors.push(
        ...(rollbackError instanceof AggregateError ? rollbackError.errors : [rollbackError])
      )
    }
    try {
      const disposal = await host.dispose()
      cleanupErrors.push(...disposal.cleanupErrors)
    } catch (disposalError) {
      cleanupErrors.push(disposalError)
    }
    if (cleanupErrors.length > 0) {
      const rollbackFailure = new AggregateError(
        [error, ...cleanupErrors],
        ERROR_TEXT.HOST_SETUP_ROLLBACK_FAILED,
        { cause: error }
      )
      throw tagPluginHostError(rollbackFailure, PluginHostErrorCode.hostSetupRollbackFailed)
    }
    throw error
  } finally {
    setupAdapter.close()
  }
}
