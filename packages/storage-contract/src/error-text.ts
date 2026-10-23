/** Stable validation causes used by codec and synchronous-option admission boundaries. */
export const StorageContractErrorText = {
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
/** Stable cause text for a collection codec that cannot represent an undefined root. */
export const COLLECTIONS_CODEC_UNDEFINED_ROOT = 'collection codec cannot encode an undefined root'

/** Stable cause text for collection codec callers that provide a non-text payload. */
export const COLLECTIONS_CODEC_STRING_PAYLOAD = 'collection codec expects a string payload'
