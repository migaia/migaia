import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginDisposer,
  IPluginHostCore
} from './typing.js';
import { PluginHostRegistrationLifecycle } from './state-constants.js';

export type IPluginDefinition<TCore> = {
  readonly owner: IPluginConstraint<TCore>;
  readonly name: string;
  readonly config: IPluginConfig;
  readonly install: IPluginConstraint<TCore>['install'];
  readonly update?: IPluginConstraint<TCore>['update'];
  readonly dispose?: IPluginConstraint<TCore>['dispose'];
  readonly shared?: IPluginConstraint<TCore>['shared'];
};

export type IRegistration<TDomainCore extends object, TValue> = {
  readonly name: string;
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>;
  config: IPluginConfig;
  extensions: IExtensionOwnership[];
  pipelineDisposers: IPluginDisposer[];
  disposers: IPluginDisposer[];
  shared: PropertyKey[];
  installed: boolean;
  lifecycle: (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle];
  core?: TDomainCore & IPluginHostCore<TValue>;
};

export type IExtensionOwnership = {
  readonly key: PropertyKey;
  readonly descriptor: PropertyDescriptor;
};

export type IInstallEntry<TDomainCore extends object, TValue> = {
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>;
  readonly name: string;
};

export type ISharedEntry<TDomainCore extends object, TValue> = {
  readonly owner: IRegistration<TDomainCore, TValue>;
  readonly value: unknown;
};
