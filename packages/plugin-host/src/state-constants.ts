/** Plugin-host lifecycle and pipeline modes. */
export const PluginHostStatus = {
  active: 'active',
  closing: 'closing',
  disposed: 'disposed'
} as const;

export const PluginHostPipelineMode = {
  sync: 'sync',
  async: 'async',
  generator: 'generator'
} as const;

/** Registration lifecycle used to guard plugin-owned resources. */
export const PluginHostRegistrationLifecycle = {
  idle: 'idle',
  install: 'install',
  dispose: 'dispose'
} as const;

/** Pipeline registration violations reported to the host diagnostic hook. */
export const PluginHostPipelineViolation = { late: 'late', duplicate: 'duplicate' } as const;

export type IPluginHostStatus = (typeof PluginHostStatus)[keyof typeof PluginHostStatus];
export type IPluginHostPipelineMode =
  (typeof PluginHostPipelineMode)[keyof typeof PluginHostPipelineMode];
export type IPluginHostRegistrationLifecycle =
  (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle];
export type IPluginHostPipelineViolation =
  (typeof PluginHostPipelineViolation)[keyof typeof PluginHostPipelineViolation];
