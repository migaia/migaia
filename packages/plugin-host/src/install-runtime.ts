import {
  assimilateCapturedThen,
  createAbortController,
  createPendingTracker,
  createLifecycleScope,
  createProvisionalScope,
  containAsyncRejection,
  probeThenable,
  type ILifecycleScheduler
} from '@migaia/lifecycle'
import { copyConfig, readPlainDataRecord } from './config.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { mountPluginExtensions } from './extension.js'
import { invokeCaptured } from './invocation.js'
import { compileFeatures, instantiateFeatures, snapshotFeatureExpose } from './feature-runtime.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IInstallEntry, IPluginDescriptor, IRegistration, ISharedEntry } from './registry.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginHostCore,
  IPluginHostErrorCode,
  IPluginInstallFailureDetail,
  ISyncPipelineStage
} from './typing.js'

/** Candidate registries held privately until one install batch reaches its commit point. */
export type IInstallBatchContext<TDomainCore extends object, TValue> = {
  readonly shared: Map<PropertyKey, ISharedEntry<TDomainCore, TValue>>
  readonly extensionOwners: Map<PropertyKey, IRegistration<TDomainCore, TValue>>
  readonly syncStages: ISyncPipelineStage<TValue>[]
  readonly asyncStages: IAsyncPipelineStage<TValue>[]
  readonly generatorStages: IGeneratorPipelineStage<TValue>[]
  readonly asyncGeneratorStages: IAsyncGeneratorPipelineStage<TValue>[]
  committed: boolean
}

export type IPluginHostInstallRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly scheduler: ILifecycleScheduler
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
  readonly diagnostic: (message: string, code?: IPluginHostErrorCode) => void
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

  /** Installs one candidate batch and optionally publishes it at the final synchronous point. */
  async installBatch(
    entries: readonly IInstallEntry<TDomainCore, TValue>[],
    publish = true
  ): Promise<{
    readonly installed: readonly IRegistration<TDomainCore, TValue>[]
    readonly batch: IInstallBatchContext<TDomainCore, TValue>
  }> {
    const installed: IRegistration<TDomainCore, TValue>[] = []
    const batch = this.#port.snapshotBatch()
    let failedName = entries[0]?.name ?? 'unknown'
    this.#port.setActiveBatch(batch)
    try {
      for (const entry of entries) {
        failedName = entry.name
        const registration = this.#createRegistration(entry)
        installed.push(registration)
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
    const batch = this.#port.snapshotBatch()
    let failedName = entries[0]?.name ?? 'unknown'
    this.#port.setActiveBatch(batch)
    try {
      for (const entry of entries) {
        failedName = entry.name
        const registration = this.#createRegistration(entry)
        installed.push(registration)
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

  /** Allocates one registration shape shared by asynchronous and synchronous install transactions. */
  #createRegistration(
    entry: IInstallEntry<TDomainCore, TValue>
  ): IRegistration<TDomainCore, TValue> {
    const { name, plugin } = entry
    return {
      name,
      plugin,
      config: copyConfig(plugin.config),
      extensions: [],
      pipelineDisposers: [],
      pipelineOwnerKey: {},
      resourceDisposers: [],
      shared: [],
      installed: false,
      enabled: true,
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

  /** Commits common shared and extension preparation after each path resolves its install result. */
  #prepareInstallResult(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    installedValue: unknown
  ): void {
    const extensions = this.#mergeDescriptorExpose(registration, installedValue)
    if (this.#sharedHook(registration)) {
      this.#port.setHookRegistration(registration)
      let sharedValue: unknown
      try {
        sharedValue = this.#invokeShared(registration, batch)
      } finally {
        this.#port.setHookRegistration(undefined)
      }
      const shared = readPlainDataRecord(sharedValue, 'plugin shared', false)
      for (const key of Reflect.ownKeys(shared)) {
        if (batch.shared.has(key))
          throw new PluginHostError(
            PluginHostErrorCode.sharedDuplicate,
            ERROR_TEXT.SHARED_DUPLICATE(key)
          )
        batch.shared.set(key, { owner: registration, value: shared[key] })
        registration.shared.push(key)
      }
    }
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
      (error) => this.#port.diagnostic(String(error), PluginHostErrorCode.pluginInstallFailed)
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
      if (
        typeof key !== 'string' ||
        !['install', 'expose', 'featureExpose', 'shared'].includes(key)
      )
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

  /** Selects descriptor shared output without exposing it to Feature factories. */
  #sharedHook(registration: IRegistration<TDomainCore, TValue>): unknown {
    return registration.descriptor?.shared ?? registration.plugin.shared
  }

  /** Invokes shared through its owning descriptor or legacy Plugin core. */
  #invokeShared(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): unknown {
    const shared = registration.descriptor?.shared
      ? registration.descriptor.shared()
      : invokeCaptured(registration.plugin.shared!, registration.plugin.owner, [
          this.#port.createCore(registration, batch)
        ])
    this.#rejectThenable(shared, ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    return shared
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
    try {
      containAsyncRejection(
        this.#port.diagnostic(String(error), PluginHostErrorCode.pluginInstallFailed),
        () => undefined
      )
    } catch {}
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
    try {
      this.#port.diagnostic(
        `${ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName)}: ${detail}`,
        PluginHostErrorCode.pluginInstallRollbackFailed
      )
    } catch {
      // Diagnostics must never alter control flow.
    }
  }
}
