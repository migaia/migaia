/** Stable validation causes used by codec and synchronous-option admission boundaries. */
export const StorageContractErrorText = {
  /** SnapshotCodec requires the structural four-field descriptor, including class instances. */
  codecDescriptor: 'codec must declare name, output, encode, and decode',
  /** SnapshotSyncWriteOptions accepts undefined or a non-array object. */
  syncWriteObject: 'sync write options must be an object',
  /** Synchronous writes cannot wait for cancellation or a deadline. */
  syncWriteContext: 'sync writes do not support signal or timeoutMs',
  /** Both context validators admit only the canonical conflict-policy domain. */
  conflictPolicy: 'conflictPolicy must be conflict or replace'
} as const
/** Stable cause text for a collection codec that cannot represent an undefined root. */
export const COLLECTIONS_CODEC_UNDEFINED_ROOT = 'collection codec cannot encode an undefined root'

/** Stable cause text for collection codec callers that provide a non-text payload. */
export const COLLECTIONS_CODEC_STRING_PAYLOAD = 'collection codec expects a string payload'
