import { defineFeature, definePlugin } from '@migaia/plugin-host'
import type {
  IPluginDependency,
  IPluginFeatureName,
  IPluginFeatureOutput
} from '@migaia/plugin-host'

/** Root imports must retain the provider's declared Feature names and outputs. */
const provider = definePlugin({
  name: 'root-provider',
  features: { value: defineFeature(() => ({ read: () => 42 })) },
  install: () => ({})
})

/** This positive assertion requires the public name helper to resolve built declarations. */
const featureName: IPluginFeatureName<typeof provider> = 'value'
/** This positive assertion requires the public output helper to preserve the Feature method. */
const output: IPluginFeatureOutput<typeof provider, typeof featureName> = { read: () => 42 }
/** The public reader's edge type is available through the same root entry. */
const dependency: IPluginDependency = { provider: provider.name, required: true }
/** Required references preserve the literal provider for Tray ready-closure typing. */
const requiredProvider: 'root-provider' = provider.getFeature('value').plugin
/** Optional references preserve the same literal provider without losing optional strength. */
const optionalProvider: 'root-provider' = provider.getFeature('value', { optional: true }).plugin

void output
void dependency
void requiredProvider
void optionalProvider
