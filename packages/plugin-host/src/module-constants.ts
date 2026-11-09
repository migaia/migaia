/** Canonical built-in module keys shared by admission, installation and subpath exports. */
export const HostModuleKey = {
  features: 'features',
  featureDependencies: 'feature-dependencies',
  enablement: 'enablement',
  activation: 'activation',
  namedPipelines: 'named-pipelines',
  pipelineSync: 'pipeline:sync',
  pipelineAsync: 'pipeline:async',
  pipelineGenerator: 'pipeline:generator',
  pipelineAsyncGenerator: 'pipeline:async-generator'
} as const
export type HostModuleKey = (typeof HostModuleKey)[keyof typeof HostModuleKey]
/** Stable user-facing module diagnostics; code and detail carry the precise missing authority. */
export const HostModuleText = {
  invalid: 'Host modules must contain registered module identities',
  duplicate: 'Host module key is installed more than once',
  missing: 'Host module is required by this configuration',
  /** Module requirements must form an acyclic graph; a cycle leaves no valid install order. */
  cycle: 'Host module requirements form a cycle',
  pipeline: 'Pipeline mode is not installed'
} as const

/** Core removal's public receipt vocabulary; dependency modules project richer plans to this shape. */
export const CoreRemovalProjection = { policy: 'reject', action: 'release' } as const
