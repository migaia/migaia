/** Plugin-host lifecycle and pipeline modes. */
export const PluginHostStatus = {
  active: 'active',
  closing: 'closing',
  disposed: 'disposed'
} as const

/** Registration lifecycle used to guard plugin-owned resources. */
export const PluginHostRegistrationLifecycle = {
  idle: 'idle',
  install: 'install',
  dispose: 'dispose'
} as const

export type IPluginHostStatus = (typeof PluginHostStatus)[keyof typeof PluginHostStatus]
export type IPluginHostRegistrationLifecycle =
  (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle]
