import {
  assimilateCapturedThen,
  createAbortController,
  createPendingTracker,
  createLifecycleScope,
  createProvisionalScope,
  probeThenable,
  type ILifecycleScheduler
} from '@migaia/lifecycle'
import { copyConfig, readPlainDataRecord } from './config.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { mountPluginExtensions } from './extension.js'
import { invokeCaptured } from './invocation.js'
import { reportDiagnostic, reportTerminalFailure } from './diagnostic-report.js'
import { compileFeatures, instantiateFeatures, snapshotFeatureExpose } from './feature-runtime.js'
import { validateInstallBatch } from './dependency-runtime.js'
import { isFeatureReference } from './define-feature.js'
import type { PluginHostState } from './host-state.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IInstallEntry, IPluginDescriptor, IRegistration } from './registry.js'
import type { IMiddlewarePipelineMode, IMiddlewarePipelineStage } from '@migaia/middleware-pipeline'
import type {
  IPluginHostCore,
  IPluginInstallFailureDetail,
  IPluginHostDiagnostic
} from './typing.js'

/** Candidate registries held privately until one install batch reaches its commit point. */
export type IInstallBatchContext<TDomainCore extends object, TValue> = {
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  readonly extensionOwners: Map<PropertyKey, IRegistration<TDomainCore, TValue>>
  readonly stages: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[]
  committed: boolean
}

export type IPluginHostInstallRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly scheduler: ILifecycleScheduler
  /** Shared host state owning dependency facts and committed registration status. */
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly snapshotBatch: () => IInstallBatchContext<TDomainCore, TValue>
  readonly setActiveBatch: (batch: IInstallBatchContext<TDomainCore, TValue> | undefined) => void
  readonly beginOperation: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly createCore: (
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => TDomainCore & IPluginHostCore<TValue>
  readonly awaitOperation: <T>(
    result: T | PromiseLike<T>,
    registration: IRegistration<TDomainCore, TValue>
  ) => Promise<T>
  readonly assertOperationCurrent: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly setHookRegistration: (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ) => void
  readonly publish: (
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => void
  readonly disposeRegistration: (
    registration: IRegistration<TDomainCore, TValue>,
    preserveErrorIdentity: boolean
  ) => Promise<unknown[]>
  readonly closeRegistrationSync: (
    registration: IRegistration<TDomainCore, TValue>,
    rollbackErrors: unknown[]
  ) => void
  readonly diagnostic: IPluginHostDiagnostic
  /** Attributes a Host boundary error before its structured detail is frozen. */
  readonly decorateError: <TError extends PluginHostError>(error: TError) => TError
}>

/** Owns asynchronous candidate installation, publication, and rollback semantics. */
export class PluginHostInstallRuntime<TDomainCore extends object, TValue> {
  /** Narrow Host authority required by the install transaction. */
  readonly #port: IPluginHostInstallRuntimePort<TDomainCore, TValue>

  constructor(port: IPluginHostInstallRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Activates one already-published lazy registration without changing its public identity. */
  activate(registration: IRegistration<TDomainCore, TValue>): Promise<void> {
    if (registration.activated) return Promise.resolve()
    if (registration.activationPromise) return registration.activationPromise
    const activation = (async (): Promise<void> => {
      const batch = this.#port.snapshotBatch()
      batch.registrations.set(registration.name, registration)
      this.#port.setActiveBatch(batch)
      registration.lifecycle = PluginHostRegistrationLifecycle.install
      try {
        const installResult = this.#startInstall(registration, batch, true)
        if (this.#hasOwnThen(installResult)) throw this.#installResultThenable(registration.name)
        const installThen = this.#readThen(installResult)
        const installedValue = await this.#port.awaitOperation(
          typeof installThen === 'function'
            ? assimilateCapturedThen(installThen as (...args: unknown[]) => void, installResult)
            : installResult,
          registration
        )
        this.#port.assertOperationCurrent(registration)
        this.#prepareInstallResult(registration, batch, installedValue)
        await registration.provisional!.commitTo(registration.scope!)
        registration.provisional = undefined
        registration.installed = true
        registration.activated = true
        this.#port.publish([registration], batch)
      } catch (error) {
        if (registration.provisional) await registration.provisional.rollback()
        registration.provisional = undefined
        registration.installed = false
        registration.activated = false
        throw error
      } finally {
        this.#port.setHookRegistration(undefined)
        this.#port.setActiveBatch(undefined)
        registration.lifecycle = PluginHostRegistrationLifecycle.idle
        registration.activationPromise = undefined
      }
    })()
    registration.activationPromise = activation
    return activation
  }

  /** Installs one candidate batch and optionally publishes it at the final synchronous point. */
  async installBatch(
    entries: readonly IInstallEntry<TDomainCore, TValue>[],
    publish = true,
    prepareBatch?: (batch: IInstallBatchContext<TDomainCore, TValue>) => void
  ): Promise<{
    readonly installed: readonly IRegistration<TDomainCore, TValue>[]
    readonly batch: IInstallBatchContext<TDomainCore, TValue>
  }> {
    const installed: IRegistration<TDomainCore, TValue>[] = []
    // Dependency validation runs before the transaction: its codes are thrown as-is, not wrapped.
    const { order: ordered, installSet } = this.#validateBatch(entries)
    const batch = this.#port.snapshotBatch()
    prepareBatch?.(batch)
    let failedName = entries[0]?.name ?? 'unknown'
    this.#port.setActiveBatch(batch)
    try {
      for (const entry of ordered) {
        failedName = entry.name
        const registration = this.#createRegistration(entry)
        installed.push(registration)
        batch.registrations.set(registration.name, registration)
        if (!installSet.has(registration.name)) {
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
          continue
        }
        try {
          const installResult = this.#startInstall(registration, batch, true)
          if (this.#hasOwnThen(installResult)) throw this.#installResultThenable(registration.name)
          const installThen = this.#readThen(installResult)
          const installedValue = await this.#port.awaitOperation(
            typeof installThen === 'function'
              ? assimilateCapturedThen(installThen as (...args: unknown[]) => void, installResult)
              : installResult,
            registration
          )
          this.#port.assertOperationCurrent(registration)
          this.#prepareInstallResult(registration, batch, installedValue)
          await registration.provisional!.commitTo(registration.scope!)
          registration.provisional = undefined
          registration.installed = true
          registration.activated = true
        } finally {
          this.#port.setHookRegistration(undefined)
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
        }
      }
      if (publish) this.#port.publish(installed, batch)
      return { installed: Object.freeze([...installed]), batch }
    } catch (error) {
      const rollbackErrors: unknown[] = []
      for (const registration of [...installed].reverse())
        rollbackErrors.push(...(await this.#port.disposeRegistration(registration, true)))
      this.#reportRollbackFailure(failedName, rollbackErrors)
      throw this.#installFailure(failedName, error, {
        failedName,
        rollbackErrors: Object.freeze([...rollbackErrors])
      })
    } finally {
      this.#port.setActiveBatch(undefined)
    }
  }

  /** Runs constructor-time installation without allowing an awaitable extension to escape. */
  installBatchSync(entries: readonly IInstallEntry<TDomainCore, TValue>[]): void {
    const installed: IRegistration<TDomainCore, TValue>[] = []
    const { order: ordered, installSet } = this.#validateBatch(entries)
    const batch = this.#port.snapshotBatch()
    let failedName = entries[0]?.name ?? 'unknown'
    this.#port.setActiveBatch(batch)
    try {
      for (const entry of ordered) {
        failedName = entry.name
        const registration = this.#createRegistration(entry)
        installed.push(registration)
        batch.registrations.set(registration.name, registration)
        if (!installSet.has(registration.name)) {
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
          continue
        }
        try {
          let installedValue: unknown
          try {
            installedValue = this.#startInstall(registration, batch, false)
          } finally {
            this.#port.setHookRegistration(undefined)
          }
          if (installedValue instanceof Promise || this.#hasOwnThen(installedValue)) {
            const installedThen = this.#readThen(installedValue)
            if (typeof installedThen === 'function')
              void assimilateCapturedThen(
                installedThen as (...args: unknown[]) => void,
                installedValue
              ).catch(() => undefined)
            throw this.#installResultThenable(registration.name)
          }
          this.#prepareInstallResult(registration, batch, installedValue)
          registration.installed = true
          registration.activated = true
        } finally {
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
        }
      }
      this.#port.publish(installed, batch)
    } catch (cause) {
      const rollbackErrors: unknown[] = []
      for (const registration of [...installed].reverse())
        this.#port.closeRegistrationSync(registration, rollbackErrors)
      const publishedErrors = Object.freeze([...rollbackErrors])
      const completion = this.#rollbackDisposersAsync(installed, failedName).then(
        (lateErrors) =>
          Object.freeze({
            failedName,
            rollbackErrors: Object.freeze([...publishedErrors, ...lateErrors])
          }),
        (error) => {
          this.#reportRollbackFailure(failedName, [error])
          return Object.freeze({
            failedName,
            rollbackErrors: Object.freeze([...publishedErrors, error])
          })
        }
      )
      const failureDetail = {
        failedName,
        rollbackErrors: publishedErrors,
        completion
      }
      throw this.#installFailure(failedName, cause, failureDetail)
    } finally {
      this.#port.setActiveBatch(undefined)
    }
  }

  /**
   * Validates dependency prerequisites and orders one batch. Committed lazy providers must already
   * be active here: the async Host path activates them before calling in, and the synchronous path
   * cannot await an activation.
   */
  #validateBatch(entries: readonly IInstallEntry<TDomainCore, TValue>[]): Readonly<{
    readonly order: readonly IInstallEntry<TDomainCore, TValue>[]
    readonly installSet: ReadonlySet<string>
    readonly activationOrder: readonly string[]
  }> {
    try {
      return validateInstallBatch(entries, this.#port.state)
    } catch (error) {
      throw error instanceof PluginHostError ? this.#port.decorateError(error) : error
    }
  }

  /** Allocates one registration shape shared by asynchronous and synchronous install transactions. */
  #createRegistration(
    entry: IInstallEntry<TDomainCore, TValue>
  ): IRegistration<TDomainCore, TValue> {
    const { name, plugin } = entry
    return {
      name,
      plugin,
      config: copyConfig(entry.config ?? plugin.config),
      extensions: [],
      pipelineDisposers: [],
      pipelineOwnerKey: {},
      resourceDisposers: [],
      installed: false,
      activated: false,
      enabled: true,
      suspended: false,
      restartPending: false,
      lifecycle: PluginHostRegistrationLifecycle.install,
      lifecycleController: createAbortController(),
      scope: createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#port.scheduler }),
      featureExposeValid: true,
      featurePending: createPendingTracker()
    }
  }

  /** Begins one owned install invocation only after its registration is rollback-visible. */
  #startInstall(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    provisional: boolean
  ): unknown {
    this.#port.beginOperation(registration)
    if (provisional)
      registration.provisional = createProvisionalScope({
        parentSignal: registration.operation?.signal
      })
    this.#port.setHookRegistration(registration)
    return this.#invokeInstall(registration, this.#initializeFeatureCore(registration, batch))
  }

  /** Commits extension preparation after each path resolves its install result. */
  #prepareInstallResult(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    installedValue: unknown
  ): void {
    const extensions = this.#mergeDescriptorExpose(registration, installedValue)
    mountPluginExtensions(registration, extensions, batch.extensionOwners, this.#port.diagnostic)
  }

  /** Detects an own then key before async assimilation can turn an extension result into a promise. */
  #hasOwnThen(value: unknown): boolean {
    return !!value && typeof value === 'object' && Reflect.ownKeys(value).includes('then')
  }

  /** Reads a captured then once without assimilating the extension result early. */
  #readThen(value: unknown): unknown {
    return value && (typeof value === 'object' || typeof value === 'function')
      ? (value as { then?: unknown }).then
      : undefined
  }

  /** Creates the one declared semantic failure for thenable install results in both public paths. */
  #installResultThenable(name: string): PluginHostError {
    return new PluginHostError(
      PluginHostErrorCode.installResultThenable,
      ERROR_TEXT.INSTALL_RESULT_THENABLE(name)
    )
  }

  /** Wraps either install path without replacing the primary cause or detail ownership. */
  #installFailure(
    failedName: string,
    cause: unknown,
    detail: IPluginInstallFailureDetail
  ): PluginHostError<IPluginInstallFailureDetail> {
    const error = this.#port.decorateError(
      new PluginHostError(
        PluginHostErrorCode.pluginInstallFailed,
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause, detail }
      )
    )
    Object.freeze(detail)
    return error
  }

  /** Initializes the one registration-local Feature surface shared by async and sync installation. */
  #initializeFeatureCore(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): TDomainCore & IPluginHostCore<TValue> {
    const core = this.#port.createCore(registration, batch) as Record<PropertyKey, unknown>
    const featurePlan = compileFeatures(registration.plugin.features)
    const rejectEarlyFeatureRead = (): never => {
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_CORE_PENDING)
    }
    Object.defineProperties(core, {
      featureExpose: { configurable: true, get: rejectEarlyFeatureRead },
      features: { configurable: true, get: rejectEarlyFeatureRead }
    })
    registration.descriptor = registration.plugin.descriptorFactory
      ? this.#snapshotDescriptor(
          registration,
          invokeCaptured(registration.plugin.descriptorFactory, registration.plugin.owner, [core])
        )
      : undefined
    const expose = registration.descriptor?.featureExpose
      ? registration.descriptor.featureExpose()
      : typeof registration.plugin.featureExpose === 'function'
        ? invokeCaptured(registration.plugin.featureExpose, registration.plugin.owner, [core])
        : (registration.plugin.featureExpose ?? {})
    this.#rejectThenable(expose, ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_OUTPUT)
    if (!expose || typeof expose !== 'object')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_OUTPUT)
    registration.featureExpose = snapshotFeatureExpose(
      expose,
      () => registration.featureExposeValid === true
    )
    registration.featureOutputs = instantiateFeatures(
      registration.plugin.features,
      registration.featureExpose,
      featurePlan,
      (error) =>
        this.#port.diagnostic(
          error instanceof Error ? error.message : String(error),
          PluginHostErrorCode.pluginInstallFailed,
          error
        ),
      (reference) => {
        if (!isFeatureReference(reference)) return undefined
        const provider = batch.registrations.get(reference.plugin)
        if (!provider) return undefined
        if (!provider.enabled)
          throw new PluginHostError(
            PluginHostErrorCode.prerequisiteDisabled,
            ERROR_TEXT.PREREQUISITE_DISABLED(reference.feature, reference.plugin)
          )
        if (!provider.activated) {
          if (reference.optional) return undefined
          throw new PluginHostError(
            PluginHostErrorCode.pluginNotActivated,
            ERROR_TEXT.PLUGIN_NOT_ACTIVATED(reference.plugin)
          )
        }
        return provider.featureOutputs?.[reference.feature]
      },
      (failure) => reportTerminalFailure(failure, this.#port.diagnostic)
    )
    Object.defineProperty(core, 'featureExpose', {
      value: registration.featureExpose,
      enumerable: true
    })
    Object.defineProperty(core, 'features', {
      value: registration.featureOutputs,
      enumerable: true
    })
    return core as TDomainCore & IPluginHostCore<TValue>
  }

  /** Rejects descriptor getters and unknown hooks without executing a returned capability. */
  #snapshotDescriptor(
    registration: IRegistration<TDomainCore, TValue>,
    value: unknown
  ): IPluginDescriptor {
    if (!value || typeof value !== 'object')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    this.#rejectThenable(value, ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    const descriptor: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !['install', 'expose', 'featureExpose'].includes(key))
        throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK)
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (!property || !('value' in property) || typeof property.value !== 'function')
        throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK_DATA)
      descriptor[key] = property.value
    }
    return Object.freeze(descriptor) as IPluginDescriptor
  }

  /** Invokes the descriptor install hook after Feature outputs become ready. */
  #invokeInstall(
    registration: IRegistration<TDomainCore, TValue>,
    core: TDomainCore & IPluginHostCore<TValue>
  ): unknown {
    const hook = registration.descriptor?.install
    return hook
      ? hook()
      : invokeCaptured(registration.plugin.install, registration.plugin.owner, [core])
  }

  /** Merges descriptor install/expose outputs only after rejecting their own-key collision. */
  #mergeDescriptorExpose(
    registration: IRegistration<TDomainCore, TValue>,
    installValue: unknown
  ): unknown {
    const expose = registration.descriptor?.expose?.()
    if (expose === undefined) return installValue
    this.#rejectThenable(expose, ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    const install = readPlainDataRecord(installValue, 'plugin install', false)
    const publicSurface = readPlainDataRecord(expose, 'plugin expose', false)
    const merged: Record<PropertyKey, unknown> = {}
    for (const key of Reflect.ownKeys(install))
      Object.defineProperty(merged, key, Object.getOwnPropertyDescriptor(install, key)!)
    for (const key of Reflect.ownKeys(publicSurface)) {
      if (Object.hasOwn(install, key))
        throw new PluginHostError(
          PluginHostErrorCode.extensionDuplicate,
          ERROR_TEXT.EXTENSION_DUPLICATE(registration.name, key)
        )
      Object.defineProperty(merged, key, Object.getOwnPropertyDescriptor(publicSurface, key)!)
    }
    return merged
  }

  /** Rejects hook thenables immediately while reporting any late rejection through host diagnostics. */
  #rejectThenable(value: unknown, text: string): void {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
    const thenable = probeThenable(value)
    if (thenable?.kind === 'failed') {
      const error = createPluginHostTypeError(text)
      Object.defineProperty(error, 'cause', { value: thenable.error })
      this.#reportThenableRejection(thenable.error)
      throw error
    }
    if (thenable?.kind === 'thenable') {
      const rejection = createPluginHostTypeError(text)
      void assimilateCapturedThen(thenable.thenFn, value).catch((error) => {
        try {
          Object.defineProperty(rejection, 'cause', { value: error })
        } catch (attachFailure) {
          this.#reportThenableRejection(ERROR_TEXT.CAUSE_ATTACH_FAILED(String(attachFailure)))
        }
        this.#reportThenableRejection(error)
      })
      throw rejection
    }
  }

  /** Reports a late hook rejection without allowing diagnostics to replace its original cause. */
  #reportThenableRejection(error: unknown): void {
    reportDiagnostic(
      this.#port.diagnostic,
      error instanceof Error ? error.message : String(error),
      PluginHostErrorCode.pluginInstallFailed,
      error
    )
  }

  /** Reports rollback failures without replacing the original installation error. */
  reportRollbackFailure(failedName: string, rollbackErrors: readonly unknown[]): void {
    this.#reportRollbackFailure(failedName, rollbackErrors)
  }

  /** Runs late synchronous-install rollback sequentially to preserve error order. */
  #rollbackDisposersAsync(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    failedName: string
  ): Promise<readonly unknown[]> {
    let rollback: Promise<readonly unknown[]> = Promise.resolve([])
    for (const registration of [...installed].reverse())
      rollback = rollback.then((previousErrors) =>
        this.#port.disposeRegistration(registration, true).then((errors) => {
          this.#reportRollbackFailure(failedName, errors)
          return [...previousErrors, ...errors]
        })
      )
    return rollback
  }

  /** Diagnostics are observational and can never alter transaction control flow. */
  #reportRollbackFailure(failedName: string, rollbackErrors: readonly unknown[]): void {
    if (rollbackErrors.length === 0) return
    const detail = rollbackErrors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join('; ')
    reportDiagnostic(
      this.#port.diagnostic,
      `${ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName)}: ${detail}`,
      PluginHostErrorCode.pluginInstallRollbackFailed,
      new AggregateError(rollbackErrors, ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName))
    )
  }
}
