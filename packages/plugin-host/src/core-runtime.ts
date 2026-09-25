import type { IAbortSignal, ILifecycleScope, IProvisionalScope } from '@migaia/lifecycle'
import type { IMiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { PluginHostCleanupRuntime } from './cleanup-runtime.js'
import { createPluginCore } from './core.js'
import { resolveDisposer } from './disposal.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IRegistration } from './registry.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IPluginHostCore, IPluginResource } from './typing.js'
import type { IHostCoreConstructionRequest } from './define-host.js'

type IPluginHostCoreRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /**
   * Builds one registration's domain core.
   *
   * The request carries who it is for: a functional host replaces the `protected` override with a
   * callback, and a callback with no arguments could not tell two registrations of one batch
   * apart.
   */
  readonly createDomainCore: (request: IHostCoreConstructionRequest) => TDomainCore
  readonly assertRegistrationValid: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly executionSignal: IAbortSignal
  readonly registerStage: (
    stage: Function,
    registration: IRegistration<TDomainCore, TValue>,
    kind: IMiddlewarePipelineMode
  ) => void
  readonly cleanupRuntime: PluginHostCleanupRuntime
}>

/** Owns the plugin-facing core facade and resource/stage admission boundaries. */
export class PluginHostCoreRuntime<TDomainCore extends object, TValue> {
  /** Narrow Host authority retained by every cached registration core. */
  readonly #port: IPluginHostCoreRuntimePort<TDomainCore, TValue>

  constructor(port: IPluginHostCoreRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Creates or returns the stable core facade for one exact registration generation. */
  create(
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): TDomainCore & IPluginHostCore<TValue> {
    if (registration.core) return registration.core
    registration.core = createPluginCore({
      registration,
      createDomainCore: () =>
        this.#port.createDomainCore({ pluginName: registration.name, batch: batch ?? this }),
      assertRegistrationValid: () => this.#port.assertRegistrationValid(registration),
      operation: () => {
        if (!registration.operation)
          throw new PluginHostError(
            PluginHostErrorCode.resourceOutsideInstall,
            ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
          )
        return {
          signal: registration.operation.signal,
          deadlineAt: registration.operationDeadlineAt
        }
      },
      lifecycle: () => ({
        signal: registration.lifecycleController?.signal ?? this.#port.executionSignal
      }),
      registerResource: (resource) => this.#registerResource(registration, resource),
      registerStage: (stage, kind) => this.#port.registerStage(stage, registration, kind)
    })
    return registration.core
  }

  /** Admits one disposer into the registration's provisional or committed lifecycle scope. */
  #registerResource(
    registration: IRegistration<TDomainCore, TValue>,
    resource: IPluginResource
  ): void {
    if (registration.lifecycle !== PluginHostRegistrationLifecycle.install)
      throw new PluginHostError(
        PluginHostErrorCode.resourceOutsideInstall,
        ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
      )
    let disposer: ReturnType<typeof resolveDisposer>
    try {
      disposer = resolveDisposer(resource)
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
    }
    if (!disposer) throw createPluginHostTypeError('plugin resource must provide a disposer')
    const owner: IProvisionalScope | ILifecycleScope =
      registration.provisional ?? registration.scope!
    const ownedResource = () => Promise.resolve(disposer())
    owner.own(
      ownedResource,
      this.#port.cleanupRuntime.createStepDescriptor(
        'resource disposer',
        disposer,
        registration.featurePending
      )
    )
    registration.resourceDisposers.push(
      Object.freeze({ resource: ownedResource, dispose: disposer })
    )
  }
}
