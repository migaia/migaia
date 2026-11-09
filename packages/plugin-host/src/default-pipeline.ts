import type { IHostPipelineEntry } from './pipeline-module-types.ts'
import type { IPluginHostRuntimeContext } from './host-runtime-context.ts'
import type { IPipelinePorts } from './named-pipeline-types.ts'
import type { IPipelineConfig } from './host-options-types.ts'
import type { IRegistration } from './registry.ts'
import type { IInstallBatchContext } from './install-runtime.ts'
import { DEFAULT_PIPELINE_KEY } from './stage-lanes.ts'
import { isRegistrationRevoked } from './composition.ts'
import { PluginHostError } from './errors.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { HostModuleText, HostModuleKey } from './module-constants.ts'
/** Default execution and its depth counter remain canonical even when named lanes are installed. */
export class DefaultPipelineCollection<TDomainCore extends object, TValue> {
  /** No runner is allocated without an explicit selected and installed mode. */
  readonly #default: IHostPipelineEntry<TDomainCore, TValue> | undefined
  /** All lanes share one mutation guard, including subclass-owned named lanes. */
  #depth = 0
  /** Constructs the real runner provided by the installed mode, without importing it into core. */
  constructor(
    context: IPluginHostRuntimeContext<TDomainCore, TValue, any, any>,
    ports: IPipelinePorts<TValue>,
    options: IPipelineConfig | undefined
  ) {
    if (options?.mode === undefined) return
    if (!context.pipelineEntry || !context.pipelineModes.has(options.mode))
      throw new PluginHostError(
        PluginHostErrorCode.pipelineModeNotInstalled,
        HostModuleText.pipeline,
        { detail: { mode: options.mode } }
      )
    this.#default = new context.pipelineEntry(this, ports, DEFAULT_PIPELINE_KEY, options, true)
  }
  /** Missing default execution is rejected at the existing invocation boundary. */
  get default(): IHostPipelineEntry<TDomainCore, TValue> {
    if (!this.#default)
      throw new PluginHostError(
        PluginHostErrorCode.pipelineModeNotInstalled,
        HostModuleText.pipeline
      )
    return this.#default
  }
  /** Named collections include the same default if one was selected. */
  get selectedDefault(): IHostPipelineEntry<TDomainCore, TValue> | undefined {
    return this.#default
  }
  /** Mutations observe all currently executing lanes through this one counter. */
  get depth(): number {
    return this.#depth
  }
  /** Canonical execution enters once before calling a runner. */
  enter(): void {
    this.#depth += 1
  }
  /** Every runner finally releases exactly one execution entry. */
  leave(): void {
    this.#depth -= 1
  }
  /** Disposal seals only the lanes that were actually constructed. */
  keys(): readonly object[] {
    return this.#default ? [this.#default.key] : []
  }
  /** Exact registration revocation remains the native lifecycle authority. */
  isAvailable(registration: IRegistration<TDomainCore, TValue>): boolean {
    return !isRegistrationRevoked(registration)
  }
  /** Named lookup requires the named module; no second lookup implementation lives in core. */
  owner(
    _name: string,
    _request?: import('./define-host.ts').IHostCoreConstructionRequest
  ): IHostPipelineEntry<TDomainCore, TValue>['owner'] {
    throw new PluginHostError(PluginHostErrorCode.hostModuleMissing, HostModuleText.missing, {
      detail: { module: HostModuleKey.namedPipelines }
    })
  }
  /** Feature pipeline lookup uses the same missing-module contract. */
  registration(
    _name: string,
    _registration: IRegistration<TDomainCore, TValue>,
    _batch?: IInstallBatchContext<TDomainCore, TValue>,
    _feature?: string
  ): object {
    throw new PluginHostError(PluginHostErrorCode.hostModuleMissing, HostModuleText.missing, {
      detail: { module: HostModuleKey.namedPipelines }
    })
  }
}
