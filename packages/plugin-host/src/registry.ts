import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginDisposer,
  IPluginHostCore
} from './typing.js'
import type {
  IAbortController,
  IGenerationRequest,
  ILifecycleScope,
  IProvisionalScope
} from '@migaia/lifecycle'
import { PluginHostRegistrationLifecycle } from './state-constants.js'

export type IPluginDefinition<TCore> = {
  readonly owner: IPluginConstraint<TCore>
  readonly name: string
  readonly config: IPluginConfig
  readonly install: IPluginConstraint<TCore>['install']
  readonly update?: IPluginConstraint<TCore>['update']
  readonly onEnable?: IPluginConstraint<TCore>['onEnable']
  readonly onDisable?: IPluginConstraint<TCore>['onDisable']
  readonly dispose?: IPluginConstraint<TCore>['dispose']
  readonly shared?: IPluginConstraint<TCore>['shared']
  /** Symbol disposer captured with the plugin admission snapshot; never re-probe owner at cleanup. */
  readonly disposer?: IPluginDisposer
  readonly features: Readonly<Record<string, object>>
  readonly featureExpose?: object | ((core: TCore) => object)
  /** New function-form definitions create this descriptor once for each registration. */
  readonly descriptorFactory?: (core: TCore) => IPluginDescriptor
}

/** Registration-local hooks returned by the synchronous descriptor factory. */
export type IPluginDescriptor<
  TExtension extends Record<string, unknown> = Record<string, never>,
  TPublic extends object = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TShared extends object = Record<never, never>
> = Readonly<{
  readonly install?: () => TExtension | PromiseLike<TExtension>
  readonly expose?: () => TPublic & (TPublic extends PromiseLike<unknown> ? never : unknown)
  readonly featureExpose?: () => TExpose & (TExpose extends PromiseLike<unknown> ? never : unknown)
  readonly shared?: () => TShared & (TShared extends PromiseLike<unknown> ? never : unknown)
}>

export type IRegistration<TDomainCore extends object, TValue> = {
  readonly name: string
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  config: IPluginConfig
  extensions: IExtensionOwnership[]
  pipelineDisposers: IPluginDisposer[]
  /** Exact generation lease key; replacement generations never share a physical drain fence. */
  readonly pipelineOwnerKey: object
  /** Captured resource/disposer pairs used by composition's strict physical cleanup chain. */
  resourceDisposers: Array<
    Readonly<{ readonly resource: unknown; readonly dispose: IPluginDisposer }>
  >
  shared: PropertyKey[]
  installed: boolean
  /** Orthogonal reachability state; disabling never changes lifecycle or releases resources. */
  enabled: boolean
  lifecycle: (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle]
  lifecycleController?: IAbortController
  operation?: IGenerationRequest
  operationDeadlineAt?: number
  provisional?: IProvisionalScope
  scope?: ILifecycleScope
  core?: TDomainCore & IPluginHostCore<TValue>
  featureOutputs?: Readonly<Record<string, object>>
  featureExpose?: object
  featureExposeValid?: boolean
  featurePending?: import('@migaia/lifecycle').IPendingTracker
  /** Captured function-form descriptor; it is never shared across registrations. */
  descriptor?: IPluginDescriptor
}

export type IExtensionOwnership = {
  readonly key: PropertyKey
  readonly descriptor: PropertyDescriptor
}

export type IInstallEntry<TDomainCore extends object, TValue> = {
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  readonly name: string
}

export type ISharedEntry<TDomainCore extends object, TValue> = {
  readonly owner: IRegistration<TDomainCore, TValue>
  readonly value: unknown
}
