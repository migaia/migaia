import {
  assimilateCapturedThen,
  createAbortController,
  createPendingTracker,
  createLifecycleScope,
  createProvisionalScope,
  probeThenable
} from '@migaia/lifecycle'
import { observeAbortSubscription, type IAbortSignal } from '@migaia/lifecycle/abort'
import type { IScheduler } from '@migaia/utils/scheduler'
import { copyConfig, readPlainDataRecord } from './config.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { mountPluginExtensions, isSharedExtensionSlot } from './extension.js'
import { invokeCaptured } from './invocation.js'
import { reportDiagnostic, reportTerminalFailure } from './diagnostic-report.js'
import { compileFeatures, instantiateFeatures, snapshotFeatureExpose } from './feature-runtime.js'
import { validateInstallBatch } from './dependency-runtime.js'
import { resolveDisposer } from './disposal.js'
import type { IPluginSetupAttempt, IPluginSetupPort } from './setup-runtime.js'
import { isFeatureReference } from './define-feature.js'
import type { PluginHostState } from './host-state.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type {
  IExtensionOwner,
  ISharedExtensionContribution,
  IInstallEntry,
  IPluginDescriptor,
  IRegistration
} from './registry.js'
import type {
  IPluginHostCore,
  IPluginInstallFailureDetail,
  IPluginHostDiagnostic,
  IPluginResource,
  IPluginSetupContext
} from './typing.js'

/** Candidate registries held privately until one install batch reaches its commit point. */
export type IInstallBatchContext<TDomainCore extends object, TValue> = {
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  readonly extensionOwners: Map<PropertyKey, IExtensionOwner<TDomainCore, TValue>>
  /** Pending shared receipts become visible only at the existing synchronous commit. */
  readonly sharedContributions: ISharedExtensionContribution<TDomainCore, TValue>[]
  /** Committed generations whose extension slots are released only when this batch publishes. */
  readonly releasedOwners: Set<IRegistration<TDomainCore, TValue>>
  committed: boolean
}

type IPluginHostInstallRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly scheduler: IScheduler
  readonly executionSignal: IAbortSignal
  readonly setSetupPending: (registration: IRegistration<TDomainCore, TValue> | undefined) => void
  /** Shared host state owning dependency facts and committed registration status. */
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly snapshotBatch: () => IInstallBatchContext<TDomainCore, TValue>
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

/** Reports a rejection only when it arrives after timeout or Host disposal won the attempt. */
const reportLateSettlement = (
  pending: Promise<unknown>,
  primary: unknown,
  signal: IAbortSignal,
  name: string,
  diagnostic: IPluginHostDiagnostic
): void => {
  void pending.then(undefined, (error: unknown) => {
    if (error === primary || error === signal.reason) return
    reportDiagnostic(
      diagnostic,
      ERROR_TEXT.SETUP_LATE_REJECTION(name),
      PluginHostErrorCode.pluginInstallFailed,
      error
    )
  })
}

/** Releases an orphaned resource immediately while keeping cleanup failure diagnostic only. */
const releaseLateResource = (
  resource: IPluginResource,
  name: string,
  diagnostic: IPluginHostDiagnostic
): void => {
  let disposer: ReturnType<typeof resolveDisposer>
  try {
    disposer = resolveDisposer(resource)
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
  }
  if (!disposer) throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_RESOURCE_DISPOSER)
  /** One reporter handles synchronous and asynchronous late disposer failures. */
  const report = (error: unknown): void =>
    reportDiagnostic(
      diagnostic,
      ERROR_TEXT.SETUP_LATE_RELEASE_FAILED(name),
      PluginHostErrorCode.pluginDisposeFailed,
      error
    )
  try {
    void Promise.resolve(disposer()).catch(report)
  } catch (error) {
    report(error)
  }
}

/** Creates the narrow setup context with a signal private to this installation attempt. */
const createSetupContext = (
  registration: IRegistration<any, any>,
  core: IPluginHostCore<any>,
  attempt: IPluginSetupAttempt,
  port: IPluginSetupPort
): IPluginSetupContext => {
  const operation = Object.freeze({
    signal: attempt.controller.signal,
    deadlineAt: registration.operationDeadlineAt,
    now: () => port.scheduler.now()
  })
  return Object.freeze({
    config: core.config,
    operation,
    get lifecycle() {
      return core.lifecycle
    },
    onDispose: (resource: IPluginResource): void => {
      if (attempt.open && registration.provisional) return core.onDispose(resource)
      releaseLateResource(resource, registration.name, port.diagnostic)
      throw new PluginHostError(
        PluginHostErrorCode.resourceOutsideInstall,
        ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
      )
    }
  })
}

/** Closes setup resource admission before rollback or after installation commits. */
const closeSetupAttempt = (registration: IRegistration<any, any>): void => {
  if (registration.setupAttempt) registration.setupAttempt.open = false
}

/** Runs setup under the install operation and preserves timeout and disposal error identity. */
async function runPluginSetup(
  registration: IRegistration<any, any>,
  port: IPluginSetupPort
): Promise<unknown> {
  const core = port.createCore(registration)
  const attempt: IPluginSetupAttempt = { open: true, controller: createAbortController() }
  registration.setupAttempt = attempt
  const context = createSetupContext(registration, core, attempt, port)
  const onObservationFailure = (error: unknown): void => {
    reportDiagnostic(
      port.diagnostic,
      ERROR_TEXT.INVALID_OPTION,
      PluginHostErrorCode.invalidOption,
      error
    )
  }
  const disposeSubscription = observeAbortSubscription(
    port.executionSignal,
    (reason) => attempt.controller.abort(reason),
    onObservationFailure
  )
  port.setSetupPending(registration)
  /** Subscription for the attempt's abort race, removed when setup settles. */
  let attemptSubscription: ReturnType<typeof observeAbortSubscription> | undefined
  try {
    const pending = Promise.resolve(
      invokeCaptured(registration.plugin.setup!, registration.plugin.owner, [context])
    )
    /** Identifies a rejection produced by setup itself before the deadline or disposal won. */
    let ownRejection: { readonly error: unknown } | undefined
    const tracked = pending.then(undefined, (error: unknown) => {
      ownRejection = { error }
      throw error
    })
    const abandoned = new Promise<never>((_resolve, reject) => {
      attemptSubscription = observeAbortSubscription(
        attempt.controller.signal,
        (reason) => reject(reason),
        onObservationFailure
      )
    })
    let output: unknown
    try {
      output = await port.awaitOperation(Promise.race([tracked, abandoned]), registration)
    } catch (error) {
      if (ownRejection && ownRejection.error === error) throw error
      const code = error instanceof PluginHostError ? error.code : undefined
      if (code === PluginHostErrorCode.mutationExecutionTimeout) attempt.controller.abort(error)
      if (
        code === PluginHostErrorCode.mutationExecutionTimeout ||
        code === PluginHostErrorCode.hostDisposing
      )
        reportLateSettlement(
          pending,
          error,
          attempt.controller.signal,
          registration.name,
          port.diagnostic
        )
      throw error
    }
    port.assertOperationCurrent(registration)
    return output
  } finally {
    port.setSetupPending(undefined)
    attemptSubscription?.unsubscribe()
    disposeSubscription.unsubscribe()
  }
}

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
      registration.lifecycle = PluginHostRegistrationLifecycle.install
      try {
        this.#beginInstall(registration, true)
        if (registration.plugin.setup)
          registration.setupOutput = await runPluginSetup(registration, this.#setupPort(batch))
        const installResult = this.#startInstall(registration, batch)
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
        closeSetupAttempt(registration)
      } catch (error) {
        closeSetupAttempt(registration)
        if (registration.provisional) await registration.provisional.rollback()
        registration.provisional = undefined
        for (const detach of [...registration.pipelineDisposers].reverse()) detach()
        registration.pipelineDisposers = []
        registration.stageEntries = []
        for (const { key } of registration.extensions)
          if (batch.extensionOwners.get(key) === registration) batch.extensionOwners.delete(key)
        registration.extensions = []
        registration.installed = false
        registration.activated = false
        throw error
      } finally {
        this.#port.setHookRegistration(undefined)
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
          this.#beginInstall(registration, true)
          if (registration.plugin.setup)
            registration.setupOutput = await runPluginSetup(registration, this.#setupPort(batch))
          const installResult = this.#startInstall(registration, batch)
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
          closeSetupAttempt(registration)
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
    }
  }

  /** Runs constructor-time installation without allowing an awaitable extension to escape. */
  installBatchSync(entries: readonly IInstallEntry<TDomainCore, TValue>[]): void {
    const installed: IRegistration<TDomainCore, TValue>[] = []
    const { order: ordered, installSet } = this.#validateBatch(entries)
    for (const entry of ordered)
      if (installSet.has(entry.name) && entry.plugin.setup)
        throw this.#port.decorateError(
          new PluginHostError(
            PluginHostErrorCode.setupRequiresAsyncInstall,
            ERROR_TEXT.SETUP_REQUIRES_ASYNC_INSTALL(entry.name)
          )
        )
    const batch = this.#port.snapshotBatch()
    let failedName = entries[0]?.name ?? 'unknown'
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
            this.#beginInstall(registration, false)
            installedValue = this.#startInstall(registration, batch)
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
      stageEntries: [],
      pipelineOwnerKey: {},
      resourceDisposers: [],
      installed: false,
      activated: false,
      enabled: true,
      suspended: false,
      stale: false,
      lifecycle: PluginHostRegistrationLifecycle.install,
      lifecycleController: createAbortController(),
      scope: createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#port.scheduler }),
      featureExposeValid: true,
      featurePending: createPendingTracker()
    }
  }

  /** Opens operation, provisional owner, and hook guard before optional setup. */
  #beginInstall(registration: IRegistration<TDomainCore, TValue>, provisional: boolean): void {
    this.#port.beginOperation(registration)
    if (provisional)
      registration.provisional = createProvisionalScope({
        parentSignal: registration.operation?.signal
      })
    this.#port.setHookRegistration(registration)
  }

  /** Builds features from setup output and invokes the install hook. */
  #startInstall(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): unknown {
    return this.#invokeInstall(registration, this.#initializeFeatureCore(registration, batch))
  }

  /** Binds setup to the same batch, generation, scheduler, and diagnostic authority as install. */
  #setupPort(batch: IInstallBatchContext<TDomainCore, TValue>): IPluginSetupPort {
    return {
      createCore: (registration) => this.#port.createCore(registration, batch),
      executionSignal: this.#port.executionSignal,
      scheduler: this.#port.scheduler,
      setSetupPending: this.#port.setSetupPending,
      awaitOperation: this.#port.awaitOperation,
      assertOperationCurrent: this.#port.assertOperationCurrent,
      diagnostic: this.#port.diagnostic
    }
  }

  /** Commits extension preparation after each path resolves its install result. */
  #prepareInstallResult(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    installedValue: unknown
  ): void {
    const extensions = this.#mergeDescriptorExpose(registration, installedValue)
    mountPluginExtensions(
      registration,
      extensions,
      {
        has: (key) => {
          if (batch.extensionOwners.has(key)) return true
          const committed = this.#port.state.extensionOwners.get(key)
          return (
            committed !== undefined &&
            (isSharedExtensionSlot(committed) || !batch.releasedOwners.has(committed))
          )
        },
        set: (key, owner) => {
          batch.extensionOwners.set(key, owner)
        }
      },
      this.#port.diagnostic
    )
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
        ? invokeCaptured(
            registration.plugin.featureExpose,
            registration.plugin.owner,
            registration.plugin.setup ? [core, registration.setupOutput] : [core]
          )
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
        const provider =
          batch.registrations.get(reference.plugin) ??
          this.#port.state.registrations.get(reference.plugin)
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
      : invokeCaptured(
          registration.plugin.install,
          registration.plugin.owner,
          registration.plugin.setup ? [core, registration.setupOutput] : [core]
        )
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
