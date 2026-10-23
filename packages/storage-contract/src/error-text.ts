/** Stable validation causes used by codec and synchronous-option admission boundaries. */
export const StorageContractErrorText = {
  /**
   * Confirmed lock diagnostics expose declared identity and holder without inventing a remote
   * owner.
   */
  lockFailure: (code: string, keys: string, holder: string): string =>
    `[storage-contract] ${code}: keys=${keys}; holder=${holder}`,
  /**
   * Invalid policy results retain a typed cause while the public code identifies the decision
   * boundary.
   */
  concurrencyDecision: 'concurrency policy returned an invalid decision',
  /** Organization identity is exact lowercase UUID syntax; outer hosts own defaults and generation. */
  orgId: 'orgId must be a canonical lowercase UUID',
  /** Unwrapping requires one complete physical envelope from the requested organization. */
  orgKeyEnvelope: 'organization key must contain the exact marker, orgId, and logical key',
  /** Locks must identify a supported physical channel and a valid independently owned key. */
  lockArgument: 'lock key must identify a supported channel and valid key',
  /** Policy definitions and options must be valid before any backend or decision callback runs. */
  concurrencyArgument: 'concurrency policy or options are invalid',
  /** A backend owner, genuine fresh view and callable registration callbacks are required. */
  transactionArgument: 'transaction owner, scope or callback is invalid',
  /** Expired data views reject through the backend normalizer after releasing resource references. */
  transactionInactive: 'transaction scope is no longer active',
  /** Cleanup aggregation preserves the primary failure before all resource-release failures. */
  transactionCleanup: 'transaction resource cleanup failed',
  /** Callback admission rejects before allocating backend transaction resources. */
  transactionCallback: 'transaction callback must be a function',
  /** Transaction writes use the shared conflict/replace domain without root operation contexts. */
  transactionWriteOptions: 'transaction write options contain an invalid conflictPolicy',
  /** Value-codec adaptation captures valid metadata and both conversion functions before use. */
  valueCodecDescriptor:
    'value codec must declare id, positive safe version, encodedType, encode, and decode',
  /** Encoding failures retain the exact source codec error on the contract wrapper cause. */
  valueCodecEncode: 'value codec encoding failed',
  /** Decoding failures retain the exact source codec error on the contract wrapper cause. */
  valueCodecDecode: 'value codec decoding failed',
  /** SnapshotCodec requires the structural four-field descriptor, including class instances. */
  codecDescriptor: 'codec must declare name, output, encode, and decode',
  /** SnapshotSyncWriteOptions accepts undefined or a non-array object. */
  syncWriteObject: 'sync write options must be an object',
  /** Synchronous writes cannot wait for cancellation or a deadline. */
  syncWriteContext: 'sync writes do not support signal or timeoutMs',
  /** Both context validators admit only the canonical conflict-policy domain. */
  conflictPolicy: 'conflictPolicy must be conflict or replace',
  /** Envelope admission requires a plain object with own, valid version and state properties. */
  envelopeInvalid: 'archive must contain a non-negative safe version and a non-null state',
  /** Migration construction accepts a version plus either steps or a reset callback. */
  migrationOptions: 'migration options must contain a valid version and either steps or reset',
  /** Step values must be callable before any archive is read. */
  migrationStep: 'migration steps must be functions',
  /** Numeric target versions are canonical and contiguous through the current version. */
  migrationGap: 'migration step versions must form a continuous canonical integer range',
  /** A rejected archive must not be processed or written by code outside its supported range. */
  versionUnsupported: 'archive version is outside the supported migration range',
  /** Migration failures retain the original error and the exact failed version transition. */
  migrationFailed: 'migration step failed',
  /** The synchronous recovery path cannot wait for migration results. */
  migrationSyncThenable: 'synchronous migration steps must not return thenables',
  /** Invalid capability descriptors and provider resources fail before installation side effects. */
  capabilityArgument: 'capability token, implementation or provider base is invalid',
  /** Missing token diagnostics identify backend and capability without granting authority by name. */
  capabilityMissing: (capability: string, backend: string): string =>
    `backend ${backend} does not provide capability ${capability}`
} as const
