/**
 * Stable diagnostics owned by `@migaia/micro-hub`. Every thrown message comes from here so tests
 * and documentation can rely on one wording; factories take the names that make a message
 * actionable.
 */
export const MicroHubErrorText = {
  /** Paired with `HUB_ALREADY_CREATED`; tells the caller which API child apps should use. */
  hubAlreadyCreated:
    '[micro-hub] a hub already exists in this realm; child apps call getMicroHub(), or dispose the existing hub first',
  /** Paired with `HUB_NOT_CREATED`; names the load-order fix. */
  hubNotCreated:
    '[micro-hub] no hub exists yet; call createMicroHub() in the shell before any app connects',
  /** Paired with `APP_ALREADY_CONNECTED`. */
  appAlreadyConnected: (name: string): string =>
    `[micro-hub] app "${name}" is already connected; disconnect it before connecting again`,
  /** Paired with `APP_DISCONNECTED`. */
  appDisconnected: (name: string): string => `[micro-hub] app "${name}" is disconnected`,
  /** Paired with `PLUGIN_MISSING` when a contract section needs an absent capability. */
  pluginMissing: (capability: string, contract: string): string =>
    `[micro-hub] contract "${contract}" needs the "${capability}" plugin; add it to createMicroHub({ plugins })`,
  /** Paired with `PLUGIN_MISSING` when a capability plugin depends on another one. */
  pluginRequires: (capability: string, required: string): string =>
    `[micro-hub] the "${capability}" plugin requires the "${required}" plugin`,
  /** Paired with `CONTRACT_VERSION_MISMATCH`. */
  contractVersionMismatch: (contract: string, registered: number, given: number): string =>
    `[micro-hub] contract "${contract}" is registered with version ${registered}, got ${given}`,
  /** Paired with `CONTRACT_OWNED`. */
  contractOwned: (contract: string, owner: string): string =>
    `[micro-hub] contract "${contract}" is already owned by app "${owner}"`,
  /** Paired with `WRITE_DENIED`. */
  writeDenied: (contract: string, app: string): string =>
    `[micro-hub] app "${app}" may not run commands of contract "${contract}"; add it to writers`,
  /** Paired with `EMIT_DENIED`. */
  emitDenied: (contract: string, app: string): string =>
    `[micro-hub] only the owner may emit events of contract "${contract}"; app "${app}" is not the owner`,
  /** Paired with `COMMAND_ASYNC`. */
  commandAsync: (contract: string, command: string): string =>
    `[micro-hub] command "${contract}.${command}" returned a thenable; commands must be synchronous`,
  /** Paired with `HANDLER_DUPLICATED`. */
  handlerDuplicated: (contract: string, member: string): string =>
    `[micro-hub] "${contract}.${member}" already has a provider`,
  /** Paired with `OWNER_ABSENT`. */
  ownerAbsent: (contract: string, member: string): string =>
    `[micro-hub] "${contract}.${member}" has no owner handler; pass waitForOwner to wait for it`,
  /** Paired with `OWNER_TIMEOUT`. */
  ownerTimeout: (contract: string, member: string, ms: number): string =>
    `[micro-hub] no owner handler for "${contract}.${member}" within ${ms} ms`,
  /** Paired with `OWNER_GONE`. */
  ownerGone: (contract: string, member: string): string =>
    `[micro-hub] the owner of "${contract}" disconnected while "${member}" was in flight`,
  /** Paired with `INVALID_OPTION` for names. */
  invalidName: (kind: string, name: unknown): string =>
    `[micro-hub] ${kind} name must be a non-empty string without ".", got ${String(name)}`,
  /** Paired with `INVALID_OPTION` for contract versions. */
  invalidVersion: (contract: string): string =>
    `[micro-hub] contract "${contract}" version must be a positive integer`,
  /** Paired with `INVALID_OPTION` for an unknown member or patch field. */
  unknownMember: (contract: string, member: string): string =>
    `[micro-hub] contract "${contract}" has no member "${member}"`,
  /** Paired with `INVALID_OPTION` for an invalid section entry. */
  invalidSection: (contract: string, section: string, member: string): string =>
    `[micro-hub] contract "${contract}" ${section}.${member} has an invalid shape`
} as const
