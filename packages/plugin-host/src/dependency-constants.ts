/** Controls how a committed but not yet activated lazy provider is treated during validation. */
export const PluginInactiveProviderPolicy = {
  /** The caller activates such providers before installation, so validation admits them. */
  admit: 'admit',
  /** No activation step follows, so an inactive required provider rejects the batch. */
  reject: 'reject'
} as const

export type PluginInactiveProviderPolicy = keyof typeof PluginInactiveProviderPolicy
