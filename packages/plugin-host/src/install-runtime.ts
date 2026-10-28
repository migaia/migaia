/** Owns atomic installation and activation; delegates setup, feature construction and cleanup. */
import { reverseItems } from './cleanup-runtime.ts'
import type { PluginHostRemovalRuntime } from './removal-runtime.ts'
import type { PluginHostOperationRuntime } from './operation-runtime.ts'

import { assimilateCapturedThen } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { createLifecycleScope, createProvisionalScope } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { copyConfig } from './config.ts'
import ERROR_TEXT, {
  identifyPluginHostCallbackFailure,
  PluginHostError,
  tagPluginHostError,
  PluginHostInternalText
} from './error-text.ts'
import { PluginHostInstallText } from './install-constants.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { reportDiagnostic } from './diagnostic-report.ts'
import { validateInstallBatch } from './dependency-runtime.ts'
import { PluginHostSetupAttempt, closeSetupAttempt } from './setup-runtime.ts'
import { PluginHostSyncRollbackRuntime } from './install-rollback-runtime.ts'
import { PluginHostInstallFeatureRuntime } from './install-feature-runtime.ts'
import type { PluginHostState } from './host-state.ts'
import { PluginHostRegistrationLifecycle } from './state-constants.ts'
import type {
  IExtensionOwner,
  ISharedExtensionContribution,
  IInstallEntry,
  IRegistration
} from './registry.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'
import type { IPluginInstallFailureDetail, IPluginHostDiagnostic } from './host-options-types.ts'

/** Candidate registries held privately until one install batch reaches its commit point. */
export type IInstallBatchContext<TDomainCore extends object, TValue> = {
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  readonly extensionOwners: Map<PropertyKey, IExtensionOwner<TDomainCore, TValue>>
  /** Pending shared receipts become visible only at the existing synchronous commit. */
  readonly sharedContributions: Set<ISharedExtensionContribution<TDomainCore, TValue>>
  /** Committed generations whose extension slots are released only when this batch publishes. */
  readonly releasedOwners: Set<IRegistration<TDomainCore, TValue>>
  committed: boolean
}

export type IPluginHostInstallRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Host-owned synchronous invocation boundary; preserves the hook's exact returned value. */
  readonly invokeHook: <T>(invoke: () => T) => T
  readonly scheduler: IScheduler
  readonly executionSignal: INativeAbortSignal
  readonly setSetupPending: (registration: IRegistration<TDomainCore, TValue> | undefined) => void
  /** Shared host state owning dependency facts and committed registration status. */
  readonly state: PluginHostState<TDomainCore, TValue>
  /** Features borrow the same exact native pipeline registration scope. */
  readonly pipeline: (
    name: string,
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    feature: string
  ) => object
  readonly createCore: (
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => TDomainCore & IPluginHostCore<TValue>
  readonly setHookRegistration: (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ) => void
  readonly publish: (
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => void
  readonly closeRegistrationSync: (
    registration: IRegistration<TDomainCore, TValue>,
    rollbackErrors: unknown[]
  ) => void
  readonly diagnostic: IPluginHostDiagnostic
  /** Attributes a Host boundary error before its structured detail is frozen. */
  readonly decorateError: <TError extends PluginHostError>(error: TError) => TError
  /** Shared generation owner; method calls retain the original instance receiver. */
  readonly operations: Pick<PluginHostOperationRuntime, 'begin' | 'await' | 'assertCurrent'>
  /** Existing removal owner performs cleanup; the Host adds no forwarding layer. */
  readonly removal: PluginHostRemovalRuntime<TDomainCore, TValue>
}>

/** Owns asynchronous candidate installation, publication, and rollback semantics. */
export class PluginHostInstallRuntime<TDomainCore extends object, TValue> {
  /** Narrow Host authority required by the install transaction. */
  readonly #port: IPluginHostInstallRuntimePort<TDomainCore, TValue>

  /** Registration-local feature construction and result admission use the same Host port. */
  readonly #features: PluginHostInstallFeatureRuntime<TDomainCore, TValue>

  /** Retains installation authority without constructing a closure-based component. */
  constructor(port: IPluginHostInstallRuntimePort<TDomainCore, TValue>) {
    this.#port = port
    this.#features = new PluginHostInstallFeatureRuntime(port)
  }

  /** Creates empty candidate tables owned solely by this installation transaction. */
  #createBatch(): IInstallBatchContext<TDomainCore, TValue> {
    return {
      registrations: new Map(),
      extensionOwners: new Map(),
      sharedContributions: new Set(),
      releasedOwners: new Set(),
      committed: false
    }
  }

  /** Activates one already-published lazy registration without changing its public identity. */
  activate(registration: IRegistration<TDomainCore, TValue>): Promise<void> {
    if (registration.activated) return Promise.resolve()
    if (registration.activationPromise) return registration.activationPromise
    /** One transaction Promise remains stored until the attempt's existing finally path clears it. */
    const activation = this.#activateRegistration(registration)
    registration.activationPromise = activation
    return activation
  }

  /** Executes one lazy activation under its original transaction, cleanup and finally boundaries. */
  async #activateRegistration(registration: IRegistration<TDomainCore, TValue>): Promise<void> {
    /** Unpublished candidate tables remain owned by this exact transaction. */
    const batch = this.#createBatch()
    batch.registrations.set(registration.name, registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.install
    try {
      this.#beginInstall(registration, true)
      if (registration.plugin.setup)
        registration.setupOutput = await new PluginHostSetupAttempt(
          registration,
          this.#port,
          batch
        ).run()
      /** Raw install output is inspected before Promise assimilation can observe its then property. */
      const installResult = this.#features.start(registration, batch)
      if (this.#hasOwnThen(installResult)) throw this.#installResultThenable(registration.name)
      /** Capture the then property once so user getters cannot change between reads. */
      const installThen = this.#readThen(installResult)
      /**
       * Resolved extension data is admitted only after the current generation still owns the
       * operation.
       */
      const installedValue = await this.#port.operations.await(
        typeof installThen === 'function'
          ? assimilateCapturedThen(installThen as (...args: unknown[]) => void, installResult)
          : installResult,
        registration
      )
      this.#port.operations.assertCurrent(registration)
      this.#features.prepare(registration, batch, installedValue)
      await registration.provisional!.commitTo(registration.scope!)
      registration.provisional = undefined
      registration.installed = true
      registration.activated = true
      this.#port.publish([registration], batch)
      closeSetupAttempt(registration)
    } catch (error) {
      closeSetupAttempt(registration)
      /** The removal owner handles both provisional leftovers and any committed scope prefix. */
      const { cleanupErrors: rollbackErrors } =
        await this.#port.removal.resetRegistration(registration)
      this.reportRollbackFailure(registration.name, rollbackErrors)
      /** Preserve the original primary; immutable failures retain it in the existing wrapper chain. */
      const primary = attachSecondaryErrors(error, rollbackErrors)
      throw primary === error
        ? error
        : this.#installFailure(registration.name, primary, {
            failedName: registration.name,
            rollbackErrors: Object.freeze([...rollbackErrors])
          })
    } finally {
      this.#port.setHookRegistration(undefined)
      registration.lifecycle = PluginHostRegistrationLifecycle.idle
      registration.activationPromise = undefined
    }
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
    /** Constructed prefix determines reverse rollback if a later candidate fails. */
    const installed: IRegistration<TDomainCore, TValue>[] = []
    // Dependency validation runs before the transaction: its codes are thrown as-is, not wrapped.
    const { order: ordered, installSet } = this.#validateBatch(entries)
    /** Unpublished candidate tables remain owned by this exact transaction. */
    const batch = this.#createBatch()
    prepareBatch?.(batch)
    /** The last attempted plugin identifies the original failure and rollback diagnostics. */
    let failedName = entries[0]?.name ?? PluginHostInstallText.unknownName
    try {
      for (const entry of ordered) {
        failedName = entry.name
        /** The new generation is tracked before user setup or install can acquire resources. */
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
            registration.setupOutput = await new PluginHostSetupAttempt(
              registration,
              this.#port,
              batch
            ).run()
          /**
           * Raw install output is inspected before Promise assimilation can observe its then
           * property.
           */
          const installResult = this.#features.start(registration, batch)
          if (this.#hasOwnThen(installResult)) throw this.#installResultThenable(registration.name)
          /** Capture the then property once so user getters cannot change between reads. */
          const installThen = this.#readThen(installResult)
          /**
           * Resolved extension data is admitted only after the current generation still owns the
           * operation.
           */
          const installedValue = await this.#port.operations.await(
            typeof installThen === 'function'
              ? assimilateCapturedThen(installThen as (...args: unknown[]) => void, installResult)
              : installResult,
            registration
          )
          this.#port.operations.assertCurrent(registration)
          this.#features.prepare(registration, batch, installedValue)
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
      /**
       * Secondary cleanup failures accumulate in reverse registration order without replacing the
       * primary.
       */
      const rollbackErrors: unknown[] = []
      for (const registration of reverseItems(installed))
        rollbackErrors.push(...(await this.#port.removal.rollbackRegistration(registration)))
      this.reportRollbackFailure(failedName, rollbackErrors)
      throw this.#installFailure(failedName, error, {
        failedName,
        rollbackErrors: Object.freeze([...rollbackErrors])
      })
    }
  }

  /** Runs constructor-time installation without allowing an awaitable extension to escape. */
  installBatchSync(entries: readonly IInstallEntry<TDomainCore, TValue>[]): void {
    /** Constructed prefix determines reverse rollback if a later candidate fails. */
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
    /** Unpublished candidate tables remain owned by this exact transaction. */
    const batch = this.#createBatch()
    /** The last attempted plugin identifies the original failure and rollback diagnostics. */
    let failedName = entries[0]?.name ?? PluginHostInstallText.unknownName
    try {
      for (const entry of ordered) {
        failedName = entry.name
        /** The new generation is tracked before user setup or install can acquire resources. */
        const registration = this.#createRegistration(entry)
        installed.push(registration)
        batch.registrations.set(registration.name, registration)
        if (!installSet.has(registration.name)) {
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
          continue
        }
        try {
          /**
           * Resolved extension data is admitted only after the current generation still owns the
           * operation.
           */
          let installedValue: unknown
          try {
            this.#beginInstall(registration, false)
            installedValue = this.#features.start(registration, batch)
          } finally {
            this.#port.setHookRegistration(undefined)
          }
          if (installedValue instanceof Promise || this.#hasOwnThen(installedValue)) {
            /** Capture a prohibited thenable once so its rejection remains observable. */
            const installedThen = this.#readThen(installedValue)
            if (typeof installedThen === 'function')
              void assimilateCapturedThen(
                installedThen as (...args: unknown[]) => void,
                installedValue
              ).catch((error: unknown) => {
                reportDiagnostic(
                  this.#port.diagnostic,
                  ERROR_TEXT.PLUGIN_INSTALL_FAILED(registration.name),
                  PluginHostErrorCode.pluginInstallFailed,
                  identifyPluginHostCallbackFailure(error)
                )
              })
            throw this.#installResultThenable(registration.name)
          }
          this.#features.prepare(registration, batch, installedValue)
          registration.installed = true
          registration.activated = true
        } finally {
          registration.lifecycle = PluginHostRegistrationLifecycle.idle
        }
      }
      this.#port.publish(installed, batch)
    } catch (cause) {
      /**
       * Secondary cleanup failures accumulate in reverse registration order without replacing the
       * primary.
       */
      const rollbackErrors: unknown[] = []
      for (const registration of reverseItems(installed))
        this.#port.closeRegistrationSync(registration, rollbackErrors)
      /** Synchronous failure publishes a frozen snapshot before late physical cleanup continues. */
      const publishedErrors = Object.freeze([...rollbackErrors])
      /** Late cleanup keeps the published detail immutable while collecting final ordered errors. */
      const completion = new PluginHostSyncRollbackRuntime(
        installed,
        this.#port.removal,
        this,
        failedName,
        publishedErrors
      ).complete()
      /**
       * One detail object preserves immutable synchronous fields and the existing completion
       * Promise.
       */
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
      stageEntries: new Map(),
      segments: new Map(),
      pipelineOwnerKey: {},
      installed: false,
      activated: false,
      enabled: true,
      suspended: false,
      stale: false,
      lifecycle: PluginHostRegistrationLifecycle.install,
      featureExposeValid: true
    }
  }

  /** Opens operation, provisional owner, and hook guard before optional setup. */
  #beginInstall(registration: IRegistration<TDomainCore, TValue>, provisional: boolean): void {
    // Cold lazy records own no resources. A failed attempt leaves a closed scope behind only
    // until reset clears it; the next attempt gets a fresh owner and a fresh batch-bound core.
    registration.scope ??= createLifecycleScope({
      errorPolicy: 'collect',
      scheduler: this.#port.scheduler,
      get deadlineAt() {
        return registration.cleanupDeadlineAt
      }
    })
    registration.featureExposeValid = true
    this.#port.operations.begin(registration)
    if (provisional)
      registration.provisional = createProvisionalScope({
        parentSignal: registration.operation?.signal
      })
    this.#port.setHookRegistration(registration)
  }

  /** Detects an own then key before async assimilation can turn an extension result into a promise. */
  #hasOwnThen(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    for (const key of Reflect.ownKeys(value)) if (key === 'then') return true
    return false
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
    /** Establishes the primary cause before optional display conversion can invoke user code. */
    const error = new PluginHostError(
      PluginHostErrorCode.pluginInstallFailed,
      ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName),
      { cause, detail }
    )
    try {
      /** Ordinary failures keep their original message; hostile conversions remain secondary. */
      const reason = cause instanceof Error ? cause.message : String(cause)
      error.message = PluginHostInternalText.PLUGIN_INSTALL_FAILURE_DETAIL(failedName, reason)
    } catch (conversionFailure) {
      error.cause = tagPluginHostError(
        new AggregateError([cause, conversionFailure], error.message),
        PluginHostErrorCode.pluginInstallFailed
      )
    }
    this.#port.decorateError(error)
    Object.freeze(detail)
    return error
  }

  /** Diagnostics are observational and can never alter transaction control flow. */
  reportRollbackFailure(failedName: string, rollbackErrors: readonly unknown[]): void {
    if (rollbackErrors.length === 0) return

    reportDiagnostic(
      this.#port.diagnostic,
      PluginHostInternalText.PLUGIN_ROLLBACK_FAILURE_DETAIL(failedName, rollbackErrors),
      PluginHostErrorCode.pluginInstallRollbackFailed,
      new AggregateError(rollbackErrors, ERROR_TEXT.PLUGIN_ROLLBACK_FAILED(failedName))
    )
  }
}
