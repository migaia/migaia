/** Owns stable Host surface and reflection vocabulary; stores no runtime or lifecycle state. */
export const HostSurfaceKey = {
  /** Reserved immutable identity on class and functional Host surfaces. */
  identity: 'identity',
  /** Native installation callable borrowed by domain composition. */
  use: 'use',
  /** Native dependency-aware removal callable borrowed by domain composition. */
  unUse: 'unUse',
  /** Getter name retained by frozen functional handles. */
  revision: 'revision',
  /** Selected execution mode getter on both Host entries. */
  pipelineMode: 'pipelineMode',
  /** Stable configuration facade getter on both Host entries. */
  config: 'config',
  /** Stable enablement facade getter on both Host entries. */
  plugin: 'plugin'
} as const
/** Constructor and callable reflection keys used when materializing the original API shape. */
export const HostReflection = {
  /** Native function property whose descriptor remains configurable. */
  name: 'name',
  /** Historical public constructor name retained independently of internal class names. */
  constructorName: 'PluginHost'
} as const
/** Stable error-option labels shared by Host admission and timeout diagnostics. */
export const HostTimeoutOptionKey = {
  /** Per-mutation execution budget, separate from queue admission. */
  mutation: 'mutationTimeoutMs',
  /** In-flight pipeline lease drain budget. */
  pipelineDrain: 'pipelineDrainTimeoutMs',
  /** Optional FIFO queue admission deadline. */
  queueAdmission: 'queueAdmissionTimeoutMs',
  /** Diagnostic-only queue wait threshold. */
  queueDiagnostic: 'queueAdmissionDiagnosticMs',
  /** Cleanup budget for one disposer invocation. */
  disposeStep: 'disposeStepTimeoutMs'
} as const
/** Accessor reflection names are observable through the frozen public handle's own descriptors. */
export function hostAccessorName(key: string): string {
  return `get ${key}`
}
