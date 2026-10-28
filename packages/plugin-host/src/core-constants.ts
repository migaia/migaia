/**
 * Owns stable plugin-core capability keys; no lifecycle, validation or publication state is stored
 * here.
 */
export const PluginCoreKey = {
  /** Registration-local immutable configuration capability; core and setup readers share this key. */
  config: 'config',
  /** Current hook attempt cancellation and deadline; it is a getter on the install core. */
  operation: 'operation',
  /** Registration lifetime signal, separate from each operation attempt. */
  lifecycle: 'lifecycle',
  /** Install-owned resource admission; domain cores cannot replace this capability. */
  onDispose: 'onDispose',
  /** Default synchronous stage registration and fluent core return. */
  usePipeline: 'usePipeline',
  /** Default asynchronous stage registration under the selected runner. */
  useAsyncPipeline: 'useAsyncPipeline',
  /** Default generator stage registration under the canonical generator protocol. */
  useGeneratorPipeline: 'useGeneratorPipeline',
  /** Default async-generator registration; it retains native stage ownership. */
  useAsyncGeneratorPipeline: 'useAsyncGeneratorPipeline',
  /** Named stage-registration lookup, without execution authority on a plugin core. */
  pipeline: 'pipeline',
  /** Ready selected Feature outputs injected only after native construction succeeds. */
  features: 'features',
  /** Explicit guarded expose methods passed to the selected Feature factories. */
  featureExpose: 'featureExpose'
} as const

/** Finite core-key vocabulary; all values are fixed by the public core contract. */
export type PluginCoreKey = keyof typeof PluginCoreKey
