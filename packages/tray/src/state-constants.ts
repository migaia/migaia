/** Static entry categories admitted by Tray; Capability Graph itself permits other domain kinds. */
export const TrayEntryKind = {
  /** Plain data label used by static admission and entry diagnostics. */
  value: 'value',
  /** Derived-data label; dependency execution still belongs to Capability Graph. */
  computed: 'computed',
  /** Resource label; the returned release descriptor still owns its lifetime. */
  resource: 'resource',
  /** Service label for externally consumed capabilities without a second lifecycle. */
  service: 'service'
} as const
export type TrayEntryKind = keyof typeof TrayEntryKind

/** Managed Host and Runtime share this shutdown contract without duplicating its literals. */
export const TrayShutdownMode = {
  /** Permits logical shutdown while the existing physical-completion owner continues. */
  bounded: 'bounded',
  /** Waits for the existing physical cleanup before the shutdown operation resolves. */
  'strict-drain': 'strict-drain'
} as const
export type TrayShutdownMode = keyof typeof TrayShutdownMode

/**
 * Runtime lifecycle values are shared by admission checks, disposal and the public state
 * projection.
 */
export const RuntimeState = {
  /** Accepts callbacks while the borrowed managed Host remains available. */
  active: 'active',
  /** Rejects new callbacks while existing generation leases settle under the selected policy. */
  closing: 'closing',
  /** Runtime disposal observation has ended; bounded callbacks may still hold their original leases. */
  terminal: 'terminal'
} as const
export type RuntimeState = keyof typeof RuntimeState
