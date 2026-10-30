import { definePlugin, type IFeatureOutputs, type IPluginConfig } from '@migaia/plugin-host'
import type {
  ILogControlExtensions,
  ILogEntry,
  ILogFeatureRecord,
  ILogPlugin,
  ILogPluginCore
} from './typing.ts'
import { featureScope, installedFeatureScope } from './feature-metadata.ts'
import {
  featureControlExtensions,
  composeFeatureExtensions,
  LogPolicyInstallation
} from './feature-policy.ts'

/** Ordinary carrier input declares native features and optional application extensions. */
type ILogPluginDefinition<
  N extends string,
  F extends ILogFeatureRecord,
  O extends Record<string, unknown>,
  C extends IPluginConfig
> = {
  name: N
  features?: F
  config?: C
  install?(core: ILogPluginCore & { readonly features: IFeatureOutputs<F> }): O
}

/** Definition-local lookup selects lifecycle callbacks without owning feature or scope identity. */
class LogPluginDefinition<
  N extends string,
  F extends ILogFeatureRecord,
  O extends Record<string, unknown>,
  C extends IPluginConfig
> {
  /** Captured immutable definition options are reused across independent native installations. */
  readonly #definition: ILogPluginDefinition<N, F, O, C>
  /** Root aliases retain the exact native feature identities. */
  readonly features: F

  /** Validate only the declaring scope before any resource-owning native installation begins. */
  constructor(definition: ILogPluginDefinition<N, F, O, C>) {
    featureScope(definition.features)
    this.features = Object.freeze({ ...definition.features }) as F
    this.#definition = { ...definition, features: this.features }
  }

  /** Native core.features supplies every runtime instance used by log policies and controls. */
  install(
    core: ILogPluginCore & { readonly features: IFeatureOutputs<F> }
  ): O & ILogControlExtensions<N, F> {
    /** One installation prepares host-wide policy in the log-owned scope. */
    const installation = new LogPolicyInstallation(core, {
      name: this.#definition.name,
      output: false,
      features: installedFeatureScope(this.features, core.features)
    })
    /** Application extensions install before the prepared log scope becomes visible. */
    const extensions = this.#definition.install?.(core) ?? ({} as O)
    /** Native admission still receives invalid results unchanged; valid data keeps its descriptors. */
    const combined = composeFeatureExtensions(
      this.#definition.name,
      extensions,
      featureControlExtensions(this.#definition.name, this.features, core.features)
    )
    installation.commit()
    return combined
  }
}

/** Assemble host-wide log policy with the same native plugin/feature primitives as output plugins. */
export function defineLogPlugin<
  const N extends string,
  const F extends ILogFeatureRecord = Record<never, never>,
  O extends Record<string, unknown> = Record<never, never>,
  C extends IPluginConfig = IPluginConfig
>(definition: ILogPluginDefinition<N, F, O, C>): ILogPlugin<O & ILogControlExtensions<N, F>, C, F> {
  /** This owner holds only definition data and lifecycle callback dispatch. */
  const owner = new LogPluginDefinition(definition)
  return definePlugin<
    ILogPluginCore,
    O & ILogControlExtensions<N, F>,
    ILogEntry,
    C,
    Record<never, never>,
    N,
    ILogFeatureRecord
  >({
    name: definition.name,
    features: owner.features as ILogFeatureRecord,
    config: definition.config,
    install: (core) =>
      owner.install(core as ILogPluginCore & { readonly features: IFeatureOutputs<F> })
  }) as ILogPlugin<O & ILogControlExtensions<N, F>, C, F>
}
