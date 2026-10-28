/** Stable internal managed-Host protocol values; public type declarations preserve their literals. */

/** Canonical mutation names consumed by mutation results, events and Runtime delegation. */
export const ManagedHostOperation = {
  /** Registers one admitted Graph definition. */
  use: 'use',
  /** Removes one admitted Graph definition. */
  unUse: 'unUse',
  /** Replaces the exact same-name definition generation. */
  replace: 'replace'
} as const
/** Mutation keys identify the canonical operation domain without duplicating runtime values. */
export type ManagedHostOperation = keyof typeof ManagedHostOperation

/** Event names preserve the existing managed observer protocol without duplicating operation text. */
export const ManagedHostEvent = {
  /** Successful registration operation observation. */
  use: ManagedHostOperation.use,
  /** Successful removal operation observation. */
  unUse: ManagedHostOperation.unUse,
  /** Successful replacement operation observation. */
  replace: ManagedHostOperation.replace,
  /** Settled registration lifecycle alias. */
  registered: 'registered',
  /** Settled removal lifecycle alias. */
  removed: 'removed',
  /** Settled replacement lifecycle alias. */
  replaced: 'replaced',
  /** Failure after entering Graph mutation admission. */
  mutationFailed: 'mutationFailed',
  /** Synchronous admission closure after the shared disposal Promise exists. */
  disposing: 'disposing',
  /** Logical disposal observation, independent of continuing physical cleanup. */
  disposed: 'disposed'
} as const
/** Event keys identify the managed observer domain shared by Host and Runtime. */
export type ManagedHostEvent = keyof typeof ManagedHostEvent

/** Disposal provenance distinguishes owned publication from escaped concrete-Host mutation. */
export const ManagedHostTermination = {
  /** Normal managed disposal, including the existing caught-failure result. */
  managed: 'managed',
  /** Disposal after the concrete Host revision escaped the managed publication receipt. */
  externalHost: 'external-host'
} as const
/** Provenance keys distinguish the two canonical disposal paths. */
export type ManagedHostTermination = keyof typeof ManagedHostTermination

/** Creation rollback preserves the existing two observable phase values. */
export const HostCreationPhase = {
  /** A Graph had been constructed before startup failed. */
  setup: 'setup',
  /** Failure preceded Graph construction. */
  factory: 'factory'
} as const
/** Phase keys retain the canonical creation rollback domain. */
export type HostCreationPhase = keyof typeof HostCreationPhase

/** Error-detail key shared by collision detection and the original enumerable property write. */
export const HostCreationDetailKey = 'detail'
/** Managed Graph node kind identifies plugins without adding another static entry category. */
export const ManagedHostGraphKind = 'plugin'
