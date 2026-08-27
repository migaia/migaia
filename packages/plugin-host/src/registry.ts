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
  readonly dispose?: IPluginConstraint<TCore>['dispose']
  readonly shared?: IPluginConstraint<TCore>['shared']
  /** Symbol disposer captured with the plugin admission snapshot; never re-probe owner at cleanup. */
  readonly disposer?: IPluginDisposer
}

export type IRegistration<TDomainCore extends object, TValue> = {
  readonly name: string
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  config: IPluginConfig
  extensions: IExtensionOwnership[]
  pipelineDisposers: IPluginDisposer[]
  shared: PropertyKey[]
  installed: boolean
  lifecycle: (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle]
  lifecycleController?: IAbortController
  operation?: IGenerationRequest
  operationDeadlineAt?: number
  provisional?: IProvisionalScope
  scope?: ILifecycleScope
  core?: TDomainCore & IPluginHostCore<TValue>
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
