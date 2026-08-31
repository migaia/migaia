import {
  assimilateCapturedThen,
  createAbortController,
  createLifecycleScope,
  createProvisionalScope,
  type ILifecycleScheduler
} from '@migaia/lifecycle'
import { copyConfig, readPlainDataRecord } from './config.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { mountPluginExtensions } from './extension.js'
import { invokeCaptured } from './invocation.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IInstallEntry, IRegistration, ISharedEntry } from './registry.js'
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
        const { plugin, name } = entry
        failedName = name
        const registration: IRegistration<TDomainCore, TValue> = {
          name,
          plugin,
          config: copyConfig(plugin.config),
          extensions: [],
          pipelineDisposers: [],
          pipelineOwnerKey: {},
          resourceDisposers: [],
          shared: [],
          installed: false,
          lifecycle: PluginHostRegistrationLifecycle.install,
          lifecycleController: createAbortController(),
          scope: createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#port.scheduler })
        }
        installed.push(registration)
        try {
          this.#port.beginOperation(registration)
          registration.provisional = createProvisionalScope({
            parentSignal: registration.operation?.signal
          })
          this.#port.setHookRegistration(registration)
          const installResult = invokeCaptured(plugin.install, plugin.owner, [
            this.#port.createCore(registration, batch)
          ])
          if (
            installResult &&
            typeof installResult === 'object' &&
            Reflect.ownKeys(installResult).includes('then')
          )
            throw new PluginHostError(
              PluginHostErrorCode.extensionReserved,
              ERROR_TEXT.EXTENSION_RESERVED(registration.name, 'then')
            )
          const installThen =
            installResult &&
            (typeof installResult === 'object' || typeof installResult === 'function')
              ? (installResult as { then?: unknown }).then
              : undefined
          const installedValue = await this.#port.awaitOperation(
            typeof installThen === 'function'
              ? assimilateCapturedThen(installThen as (...args: unknown[]) => void, installResult)
              : installResult,
            registration
          )
          this.#port.assertOperationCurrent(registration)
          if (plugin.shared) {
            this.#port.setHookRegistration(registration)
            let sharedValue: unknown
            try {
              sharedValue = invokeCaptured(plugin.shared, plugin.owner, [
                this.#port.createCore(registration, batch)
              ])
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
          mountPluginExtensions(
            registration,
            installedValue,
            batch.extensionOwners,
            this.#port.diagnostic
          )
          if (!registration.scope || !registration.provisional)
            throw new PluginHostError(
              PluginHostErrorCode.resourceOutsideInstall,
              ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
            )
          await registration.provisional.commitTo(registration.scope)
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
      const failureDetail = Object.freeze({
        failedName,
        rollbackErrors: Object.freeze([...rollbackErrors])
      })
      throw new PluginHostError<IPluginInstallFailureDetail>(
        PluginHostErrorCode.pluginInstallFailed,
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, detail: failureDetail }
      )
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
        const { plugin, name } = entry
        failedName = name
        const registration: IRegistration<TDomainCore, TValue> = {
          name,
          plugin,
          config: copyConfig(plugin.config),
          extensions: [],
          pipelineDisposers: [],
          pipelineOwnerKey: {},
          resourceDisposers: [],
          shared: [],
          installed: false,
          lifecycle: PluginHostRegistrationLifecycle.install,
          lifecycleController: createAbortController(),
          scope: createLifecycleScope({ errorPolicy: 'collect', scheduler: this.#port.scheduler })
        }
        installed.push(registration)
        try {
          this.#port.beginOperation(registration)
          this.#port.setHookRegistration(registration)
          let installedValue: unknown
          try {
            installedValue = invokeCaptured(plugin.install, plugin.owner, [
              this.#port.createCore(registration, batch)
            ])
          } finally {
            this.#port.setHookRegistration(undefined)
          }
          const installedThen =
            installedValue &&
            (typeof installedValue === 'object' || typeof installedValue === 'function')
              ? (installedValue as { then?: unknown }).then
              : undefined
          if (typeof installedThen === 'function') {
            void assimilateCapturedThen(
              installedThen as (...args: unknown[]) => void,
              installedValue
            ).catch(() => undefined)
            throw createPluginHostTypeError(
              `plugin ${registration.name} returned an awaitable during synchronous installation`
            )
          }
          if (plugin.shared) {
            this.#port.setHookRegistration(registration)
            let sharedValue: unknown
            try {
              sharedValue = invokeCaptured(plugin.shared, plugin.owner, [
                this.#port.createCore(registration, batch)
              ])
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
          mountPluginExtensions(
            registration,
            installedValue,
            batch.extensionOwners,
            this.#port.diagnostic
          )
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
      const failureDetail: IPluginInstallFailureDetail = Object.freeze({
        failedName,
        rollbackErrors: publishedErrors,
        completion
      })
      throw new PluginHostError<IPluginInstallFailureDetail>(
        PluginHostErrorCode.pluginInstallFailed,
        `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(failedName)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause, detail: failureDetail }
      )
    } finally {
      this.#port.setActiveBatch(undefined)
    }
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
