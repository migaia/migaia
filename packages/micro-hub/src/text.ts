/**
 * Capability kinds a hub can be built from. Each capability plugin declares one kind, contracts
 * need kinds by section, and `PLUGIN_MISSING` messages name them, so the values are public text.
 */
export const MicroCapability = {
  events: 'events',
  state: 'state',
  persist: 'persist',
  resource: 'resource'
} as const

/** Key union of {@link MicroCapability}. */
export type MicroCapability = keyof typeof MicroCapability

/**
 * Marker kinds stored on `event()`, `request()`, `keyed()` and `resource()` values inside a
 * contract spec. The hub reads them to decide how a member is wired.
 */
export const ContractMarker = {
  event: 'event',
  request: 'request',
  keyed: 'keyed',
  resource: 'resource'
} as const

/** Key union of {@link ContractMarker}. */
export type ContractMarker = keyof typeof ContractMarker

/**
 * Plugin-host plugin name prefix for connected apps. plugin-host forbids `.` in names, so the
 * separator is `:`; capability plugins use the `micro-` prefix and never collide with apps.
 */
export const APP_PLUGIN_PREFIX = 'app:'

/** Plugin-host plugin name prefix for capability plugins (`micro-events`, `micro-state`, ...). */
export const CAPABILITY_PLUGIN_PREFIX = 'micro-'

/**
 * Extension key under which a capability plugin publishes its driver. plugin-host requires
 * extension keys to be unique across the host, so the key embeds the capability kind.
 */
export const capabilityExtensionKey = (kind: MicroCapability): string => `${kind}Driver`

/** Section names a contract spec may contain; also used in `INVALID_OPTION` messages. */
export const ContractSection = {
  state: 'state',
  computed: 'computed',
  commands: 'commands',
  events: 'events',
  requests: 'requests',
  resources: 'resources'
} as const

/** Key union of {@link ContractSection}. */
export type ContractSection = keyof typeof ContractSection

/** Name kinds validated by `assertName`; they appear in `INVALID_OPTION` messages. */
export const NameKind = {
  app: 'app',
  contract: 'contract'
} as const

/** Key union of {@link NameKind}. */
export type NameKind = keyof typeof NameKind
