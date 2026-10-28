/**
 * Owns cached registration cores and explicit install-bound contexts; lifecycle scopes retain
 * resource ownership.
 */
import type { INativeAbortSignal } from '@migaia/utils/promise'
import {
  createAbortController,
  type ILifecycleScope,
  type IProvisionalScope
} from '@migaia/lifecycle'
import type { IMiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { PluginHostCleanupRuntime } from './cleanup-runtime.ts'
import {
  PluginCoreSurface,
  type IPluginRuntimeIntegration,
  type IPluginCoreContext
} from './core.ts'
import { resolveDisposer } from './disposal.ts'
import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import type { IInstallBatchContext } from './install-runtime.ts'
import type { IRegistration } from './registry.ts'
import { PluginHostRegistrationLifecycle } from './state-constants.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'
import type { IPluginResource } from './plugin-lifecycle-types.ts'
import type { IHostCoreConstructionRequest } from './define-host.ts'

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
  readonly executionSignal: INativeAbortSignal
  readonly registerStage: (
    stage: Function,
    registration: IRegistration<TDomainCore, TValue>,
    kind: IMiddlewarePipelineMode
  ) => void
  /** Named registration remains scoped to the genuine native install generation. */
  readonly preparePipelines: (
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ) => void
  readonly pipeline: (
    name: string,
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>,
    feature?: string
  ) => object
  readonly cleanupRuntime: PluginHostCleanupRuntime
  /** The original Host constructs install-scoped authority without exposing its mutable runtime. */
  readonly runtimeIntegration: (
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ) => IPluginRuntimeIntegration
}>

/** Owns the plugin-facing core facade and resource/stage admission boundaries. */
export class PluginHostCoreRuntime<TDomainCore extends object, TValue> {
  /** Narrow Host authority retained by every cached registration core. */
  readonly #port: IPluginHostCoreRuntimePort<TDomainCore, TValue>

  /** Retains the Host collaboration port without constructing any registration core eagerly. */
  constructor(port: IPluginHostCoreRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Creates or returns the stable core facade for one exact registration generation. */
  create(
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): TDomainCore & IPluginHostCore<TValue> {
    if (registration.scope) this.#port.preparePipelines(registration, batch)
    if (registration.core) return registration.core
    // Config updates can expose a cold lazy core before its first installation attempt.
    registration.lifecycleController ??= createAbortController()
    registration.core = new PluginCoreSurface(
      new PluginRegistrationCoreContext(this.#port, registration, batch, this)
    ).facade
    return registration.core
  }
}

/** Binds one cached core to its original batch without a closure-built callback bundle. */
class PluginRegistrationCoreContext<
  TDomainCore extends object,
  TValue
> implements IPluginCoreContext<TDomainCore, TValue> {
  /** Original Host collaboration authority; this context never reads another runtime's state. */
  readonly #port: IPluginHostCoreRuntimePort<TDomainCore, TValue>
  /** Exact registration generation whose core and resources this context represents. */
  readonly registration: IRegistration<TDomainCore, TValue>
  /** Original candidate batch; a later lazy retry receives a new context with a fresh core. */
  readonly #batch: IInstallBatchContext<TDomainCore, TValue> | undefined
  /** Original core-runtime identity retained for cold calls without an installation batch. */
  readonly #runtime: object

  /** Captures explicit registration and batch state; it does not execute domain code. */
  constructor(
    port: IPluginHostCoreRuntimePort<TDomainCore, TValue>,
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue> | undefined,
    runtime: object
  ) {
    this.#port = port
    this.registration = registration
    this.#batch = batch
    this.#runtime = runtime
  }

  /** Requests the domain core using exactly the previous registration name and batch identity. */
  createDomainCore(): TDomainCore {
    return this.#port.createDomainCore({
      pluginName: this.registration.name,
      batch: this.#batch ?? this.#runtime
    })
  }

  /** Keeps current-registration admission with the original Host owner. */
  assertRegistrationValid(): void {
    this.#port.assertRegistrationValid(this.registration)
  }

  /** Resolves the current hook operation on every access; cold/outside-install reads still fail. */
  operation(): import('./plugin-lifecycle-types.ts').IPluginOperationContext {
    if (!this.registration.operation)
      throw new PluginHostError(
        PluginHostErrorCode.resourceOutsideInstall,
        ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
      )
    return {
      signal: this.registration.operation.signal,
      deadlineAt: this.registration.operationDeadlineAt
    }
  }

  /** Uses the registration signal, falling back to the same Host execution signal as before. */
  lifecycle(): import('./plugin-lifecycle-types.ts').IPluginRegistrationContext {
    return { signal: this.registration.lifecycleController?.signal ?? this.#port.executionSignal }
  }

  /** Delegates registration to the Host's canonical default-pipeline admission. */
  registerStage(stage: Function, kind: IMiddlewarePipelineMode): void {
    this.#port.registerStage(stage, this.registration, kind)
  }

  /** Resolves named registration authority through the original candidate batch. */
  pipeline(name: string): object {
    return this.#port.pipeline(name, this.registration, this.#batch)
  }

  /** Creates the same trusted integration port for this original registration/batch pair. */
  runtimeIntegration(): IPluginRuntimeIntegration {
    return this.#port.runtimeIntegration(this.registration, this.#batch)
  }

  /** Admits one disposer into the registration's provisional or committed lifecycle scope. */
  registerResource(resource: IPluginResource): void {
    /** The same exact registration guards acquisition and chooses the resource's existing owner. */
    const registration = this.registration
    if (registration.lifecycle !== PluginHostRegistrationLifecycle.install)
      throw new PluginHostError(
        PluginHostErrorCode.resourceOutsideInstall,
        ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
      )
    /** Admission captures the selected disposer once and preserves its native error cause. */
    let disposer: ReturnType<typeof resolveDisposer>
    try {
      disposer = resolveDisposer(resource)
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
    }
    if (!disposer) throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_RESOURCE_DISPOSER)
    /** Installation owns provisionally until the existing lifecycle scope commits. */
    const owner: IProvisionalScope | ILifecycleScope =
      registration.provisional ?? registration.scope!
    owner.own(
      disposer,
      this.#port.cleanupRuntime.createStepDescriptor(
        PluginHostInternalText.RESOURCE_DISPOSER_PHASE,
        disposer,
        registration
      )
    )
  }
}
