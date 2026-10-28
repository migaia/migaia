// Registration cores, the PluginHost assembly and the native authoring and execution ports of one storage host (see ./storage-host.ts).
import type { IStorageHookEmitter } from './hooks.ts'
import type { IStorageHooks } from './hook-types.ts'
import { createBackendRevisionPort } from './backends/revisions.ts'
import {
  registerBackendChangeController,
  registerBackendValueCommit,
  getBackendChangeController,
  type IBackendChangeController
} from './core/backend-registry.ts'
import { createBackendKeyLockPort } from './backends/key-locks.ts'
import { defineHost, type IHostHandle, type IPluginHostOptions } from '@migaia/plugin-host'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createStorageTypeError, StorageError } from './errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.ts'
import { forwardStorageExecution } from './execution.ts'
import type { IStorageBase } from '@migaia/storage-contract'
import type { IStoragePipelineInput, IStoragePluginCore } from './types.ts'
import type {
  IStorageRegistrationAssembly,
  IStorageInstallCore,
  IStorageNativeRegistrationContext,
  IStorageHostCore,
  IStoragePluginHost
} from './storage-host.ts'

/** Assemble native ports without creating another install or resource owner. */
function createStorageRegistrationCore(registration: IStorageRegistrationAssembly): object {
  /** Ports borrow the same original context and PluginHost. */
  const { context } = registration
  return {
    setStorageRegistrationCore: (core: IStorageInstallCore) => {
      registration.registrationCore = core
      context.setRegistrationCore(core)
    },
    getStore: context.storeCell.get,
    registerJournalRuntime: context.registerJournalRuntime,
    journal: context.getJournal(context.defaultOrgId),
    setStorageFeatureProjection: context.storeCell.setFeatureProjection,
    getStorageFeatureClientResolver: context.storeCell.getFeatureClientResolver,
    setStorageJournalBinding: (
      binding: import('./journal/types.ts').IStorageJournalBackendBinding
    ) => {
      /** Admission remains inside the original registration's installation window. */
      registration.registrationCore!.onDispose(context.storeCell.releaseJournalResources)
      context.storeCell.setJournalBinding(binding)
    },
    createTransactionApi: context.storeCell.createTransactionApi,
    getChainMethods: context.storeCell.getChainMethods,
    getOrgContext: context.getOrgContext,
    captureStorageExtension: (key: PropertyKey, value: unknown, receiver: object) => {
      /** The native descriptor reader captures each original source value exactly once. */
      context.storeCell.captureExtension(key, value, receiver)
      return context.storeCell.projectExtension(
        key,
        context.getOrgContext(context.defaultOrgId).callContext,
        context.assertCurrent
      )
    },
    getBackendId: () => context.id,
    defaultOrgId: context.defaultOrgId,
    getScheduler: () => context.scheduler,
    getStageBindings: context.getStageBindings,
    ...createStorageNativeAuthoringPorts(registration),
    ...createStorageExecutionPorts(registration)
  }
}
/** Own the native batch bridge while delegating lifecycle and pipelines to PluginHost. */
class StoragePluginHostAssembly {
  /** Storage registration context of each plugin in the active batch, keyed by native plugin name. */
  #nativeContexts: ReadonlyMap<string, IStorageNativeRegistrationContext> = new Map()
  /** The canonical managed host owns installation, resources and pipeline execution. */
  #host: IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []>
  /** Allocate only the batch bridge; PluginHost retains the full managed lifecycle. */
  constructor(options: IPluginHostOptions) {
    this.#host = defineHost<IStorageHostCore, IStoragePipelineInput>({
      host: options,
      domainCore: (request) => this.#createDomainCore(request.pluginName)
    })
  }
  /** Materialize native ports for the plugin named by PluginHost; other plugins get none. */
  #createDomainCore(pluginName: string): object {
    const context = this.#nativeContexts.get(pluginName)
    if (context === undefined) return {}
    return createStorageRegistrationCore({ context, host: this.#host, registrationCore: undefined })
  }
  /** Publish original managed host ports together with native batch configuration. */
  construct(): IStoragePluginHost {
    return {
      ...this.#host,
      setNativeContexts: (contexts) => {
        this.#nativeContexts = contexts
      }
    } as IStoragePluginHost
  }
}
/** Create the storage bridge around one canonical managed PluginHost. */
export function createStoragePluginHost(options: IPluginHostOptions): IStoragePluginHost {
  return new StoragePluginHostAssembly(options).construct()
}

/** Borrow native authoring ports from the original install and resource scope. */
function createStorageNativeAuthoringPorts(registration: IStorageRegistrationAssembly) {
  /** Native authoring retains the batch entry's original store cell. */
  const { context } = registration
  return {
    createKeyLockPort: (() => {
      /** Only original window admission is acquired; the physical backend owns final release. */
      registration.registrationCore!.onDispose(() => undefined)
      return createBackendKeyLockPort()
    }) satisfies IStoragePluginCore['createKeyLockPort'],
    createOrgAuthoringPort: (() => {
      /** Only this original installation can capture late child construction authority. */
      registration.registrationCore!.onDispose(context.storeCell.releaseOrgBindings)
      return {
        createChangeController: (options, factory) => {
          context.assertExecution()
          const controller = requireChangeControllerFactory(factory)(options)
          context.storeCell.retainOrgBinding(() => controller.dispose())
          return controller
        },
        createKeyLockPort: () => {
          context.assertExecution()
          return createBackendKeyLockPort()
        },
        createRevisionPort: () => {
          context.assertExecution()
          return createBackendRevisionPort()
        },
        registerChangeController: (store, controller) => {
          context.assertExecution()
          context.storeCell.retainOrgBinding(registerBackendChangeController(store, controller))
          /** Root observers retain all organizations through their original controller channel. */
          const root = getBackendChangeController(context.storeCell.get())
          if (root !== undefined && root !== controller && 'subscribe' in controller)
            context.storeCell.retainOrgBinding(
              (controller as IBackendChangeController).subscribe((change) =>
                root.publishExternal(change)
              )
            )
        },
        registerValueCommit: (store, commit) => {
          context.assertExecution()
          context.storeCell.retainOrgBinding(registerBackendValueCommit(store, commit))
        }
      } satisfies ReturnType<IStoragePluginCore['createOrgAuthoringPort']>
    }) satisfies IStoragePluginCore['createOrgAuthoringPort'],
    createRevisionPort: (() => {
      /** Window admission belongs to the original owner; physical backends retain the facts. */
      registration.registrationCore!.onDispose(() => undefined)
      return createBackendRevisionPort()
    }) satisfies IStoragePluginCore['createRevisionPort'],
    createChangeController: ((options, factory) => {
      /** Original resource admission owns partial-construction cleanup and the install window. */
      let controller: IBackendChangeController | undefined
      registration.registrationCore!.onDispose(() => controller?.dispose())
      controller = requireChangeControllerFactory(factory)(options)
      return controller
    }) satisfies IStoragePluginCore['createChangeController'],
    registerChangeController: ((store, controller) => {
      /** Exact registry release is attached to the same original registration scope. */
      let release: (() => void) | undefined
      registration.registrationCore!.onDispose(() => release?.())
      if (context.storeCell.get() !== store)
        throw createStorageTypeError(
          StorageHostErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid
        )
      release = registerBackendChangeController(store, controller)
    }) satisfies IStoragePluginCore['registerChangeController'],
    registerValueCommit: ((store, commit) => {
      /** The original installation window owns both admission and exact registration cleanup. */
      let release: (() => void) | undefined
      registration.registrationCore!.onDispose(() => release?.())
      if (context.storeCell.get() !== store)
        throw createStorageTypeError(
          StorageHostErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid
        )
      release = registerBackendValueCommit(store, commit)
    }) satisfies IStoragePluginCore['registerValueCommit'],
    registerOrgBinding: ((store, binding) => {
      /** The original window and exact store cell remain the only registration authority. */
      registration.registrationCore!.onDispose(context.storeCell.releaseOrgBindings)
      if (context.storeCell.get() !== store)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      context.storeCell.setOrgBinding(binding)
    }) satisfies IStoragePluginCore['registerOrgBinding'],
    registerFeatureClientResolver: ((store, resolver) => {
      /** Window admission precedes callbacks, reflection, or any native client acquisition. */
      registration.registrationCore!.onDispose(() => undefined)
      if (context.storeCell.get() !== store)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      context.storeCell.setFeatureClientResolver(resolver)
    }) satisfies IStoragePluginCore['registerFeatureClientResolver']
  }
}
/** Publish operation and installation ports through the canonical managed host. */
function createStorageExecutionPorts(registration: IStorageRegistrationAssembly) {
  /** Execution uses the original registration context and sole PluginHost pipeline. */
  const { context, host } = registration
  return {
    getChangeController: () => {
      context.assertCurrent()
      return getBackendChangeController(context.storeCell.get())
    },
    getPublishedBackend: context.getPublishedBackend,
    registerDetect: context.registerDetect,
    getStorageHooks: () =>
      ({
        on(name, handler) {
          /** Original resource admission owns the lifetime of this exact subscription handle. */
          const release = context.hooks.on(name, handler)
          try {
            registration.registrationCore!.onDispose(release)
          } catch (error) {
            release()
            throw error
          }
          return release
        }
      }) satisfies IStorageHooks,
    subscribeStorageHook: ((name, handler) =>
      context.hooks.on(name, handler)) satisfies IStorageHooks['on'],
    emit: ((name, payload) => context.emit(name, payload)) satisfies IStorageHookEmitter,
    setStorageKind: context.setKind,
    execution: forwardStorageExecution(
      host,
      context.assertExecution,
      () => ({
        backendId: context.id,
        backend: context.getKind()?.name ?? context.id,
        orgId: context.defaultOrgId
      }),
      context.observeExecution === undefined
        ? undefined
        : (describe, invoke) => context.observeExecution!(context.defaultOrgId, describe, invoke)
    ),
    runStorageInstall: context.runInstall,
    isStorageInstallExpired: context.isInstallExpired,
    registerStore: (store: IStorageBase) => {
      if (registration.registrationCore === undefined)
        throw new StorageError(
          StorageHostErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      context.registerStore(store, registration.registrationCore)
    }
  }
}

/** Missing notification assembly is rejected before acquiring a channel or lifecycle resource. */
function requireChangeControllerFactory(
  factory: import('./core/change-types.ts').IBackendChangeControllerFactory | undefined
): import('./core/change-types.ts').IBackendChangeControllerFactory {
  if (factory === undefined)
    throw new StorageError(
      StorageHostErrorCode.changeControllerNotAssembled,
      {},
      StorageErrorText.changeControllerNotAssembled
    )
  return factory
}
