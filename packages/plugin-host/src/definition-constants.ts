/**
 * Owns definition admission vocabulary; core and descriptor capability keys retain their existing
 * owners.
 */
import { PluginCoreKey } from './core-constants.ts'
import { PluginHostDescriptorHook } from './install-constants.ts'

/** Stable own-data keys shared by raw admission and trusted functional definitions. */
export const PluginDefinitionKey = {
  /** Nonempty plugin identity used by duplicate admission and dependency references. */
  name: 'name',
  /** Definition configuration uses the same canonical capability name as the plugin core. */
  config: PluginCoreKey.config,
  /** Installation and descriptor execution share the existing install hook spelling. */
  install: PluginHostDescriptorHook.install,
  /** Optional asynchronous preparation is captured before the install hook runs. */
  setup: 'setup',
  /** Configuration update hook is captured once with its original definition receiver. */
  update: 'update',
  /** Availability notification hook for a generation that becomes enabled. */
  onEnable: 'onEnable',
  /** Availability notification hook for a generation that becomes disabled. */
  onDisable: 'onDisable',
  /** Direct dependent hook receives a provider's replacement Feature outputs. */
  onDependencyReplaced: 'onDependencyReplaced',
  /** Definition activation policy selects eager or explicit lazy installation. */
  activation: 'activation',
  /** Named physical disposal hook supplements resources owned by lifecycle scope. */
  dispose: 'dispose',
  /** Pre-release hook is admitted as own data before pipeline retirement. */
  beforeRelease: 'beforeRelease',
  /** Retired shared-definition input remains explicitly rejected during admission. */
  shared: 'shared',
  /** Named pipeline declarations are captured without running plugin code. */
  pipelines: 'pipelines',
  /** Feature roots use the existing plugin-core capability key. */
  features: PluginCoreKey.features,
  /** Feature-only expose methods use the existing plugin-core capability key. */
  featureExpose: PluginCoreKey.featureExpose,
  /** Trusted definitions expose a non-enumerable Feature-reference factory under this key. */
  getFeature: 'getFeature'
} as const

/** Stable definition labels preserve existing diagnostic wording and name admission semantics. */
export const PluginDefinitionText = {
  /** Config admission uses this label in the existing native validation error text. */
  configRecord: 'plugin config',
  /** Dotted names are reserved for dependency/config paths and remain invalid plugin identities. */
  nameSeparator: '.'
} as const
