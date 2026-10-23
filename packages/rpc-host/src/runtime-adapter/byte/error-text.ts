/** Stable Core diagnostics for resource operations; caller metadata cannot establish identity. */
export const RuntimeAdapterErrorText = {
  /** Provider scopes consume exact constructed connections, rather than arbitrary channel copies. */
  connectionRequired: 'Runtime adapter operation requires a Core-constructed connection'
} as const
