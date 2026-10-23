/** Stable diagnostic text shared by backend, entity, Host and reactive boundaries. */
export const StorageErrorText = Object.freeze({
  /** Native batch keys are a finite caller-provided array captured before issuing requests. */
  storageBatchKeysInvalid: 'storage batch keys must be an array',
  /** Native batch writes capture one key/value entry for every requested position. */
  storageBatchEntriesInvalid: 'storage batch entries must be an array',
  /** Duplicate canonical keys are rejected before a native batch makes partial progress. */
  storageBatchDuplicateKey: 'storage batch contains duplicate keys',
  /** An optional IndexedDB holder label is configuration, never lock or transaction authority. */
  indexedDbOwnerInvalid: 'IndexedDB owner must be an object with an optional string label',
  /** Feature schema declarations are accepted only before the original IndexedDB opener runs. */
  indexedDbSchemaDeclarationInvalid:
    'IndexedDB Feature object stores must be declared before opening',
  /** The native transaction must remain abortable until the backend chooses its terminal state. */
  indexedDbTransactionEndedEarly: 'IndexedDB transaction ended before the commit decision',
  /** The native text channel accepts strings rather than portable records. */
  storageValueInvalid: 'storage value must be a string',
  /** The native binary channel accepts a detached copy of actual byte views. */
  storageBytesInvalid: 'bytes value must be a Uint8Array',
  /** Namespace codecs must encode a physical key as a string. */
  namespaceCodecEncodeInvalid: 'namespace codec encode must return a string',
  /** Namespace codecs may decode only a string key or an absent foreign namespace. */
  namespaceCodecDecodeInvalid: 'namespace codec decode must return string or undefined',
  /** Typed namespace support requires both directions so cleanup can identify every written key. */
  namespaceTypedCodecInvalid:
    'typed namespace codec must provide callable encode and decode methods',
  /** Original namespace codec admission requires both callable string-key methods. */
  namespaceCodecInvalid: 'namespace codec must provide callable encode and decode methods',
  /** Physical string-key encoding preserves the original namespace/key argument boundary. */
  namespaceKeyInvalid: 'namespace and key must be strings',
  /** Physical-key decoding preserves the original string-only argument boundary. */
  namespacePhysicalKeyInvalid: 'namespace and physicalKey must be strings',
  /** Injected Web Storage values must implement the complete Storage surface. */
  webStorageInjectionInvalid: 'web storage injection must implement the Storage surface',
  /** Live Web Storage length must remain a usable enumeration bound. */
  webStorageLengthInvalid: 'web storage length must remain a non-negative safe integer',
  /** Live Web Storage enumeration must return a string key for every visible index. */
  webStorageKeyInvalid: 'web storage key enumeration must return one unique string per index',
  /** Live Web Storage enumeration must not repeat the same physical key. */
  webStorageKeyDuplicate: 'web storage key enumeration returned a duplicate physical key',
  /** IndexedDB coordination hints must contain decodable storage keys. */
  indexedDbChangeHintKeyInvalid: 'invalid IndexedDB change hint key',
  /** IndexedDB upgrade events require the transaction supplied by the platform. */
  indexedDbUpgradeTransactionMissing: 'IndexedDB upgrade event is missing its transaction',
  /** A cookie document must keep exposing its string cookie property after admission. */
  cookieDocumentBecameInvalid: 'cookie document must continue exposing a string cookie property',
  /** Stable text for aggregate live-query cleanup failure. */
  liveQueryDisposeFailed: 'live query failed to dispose',
  /** Stable text for malformed reactive feature/provider/adapter descriptors. */
  reactiveFeatureInvalid: 'reactive feature is invalid',
  /** Stable text for backend reactive adapter lookup failure. */
  reactiveAdapterNotInstalled: 'reactive backend adapter is not installed',
  /** Stable text for recoverable adapter event, poll, or authoritative-read failure. */
  reactiveAdapterFailed: 'reactive backend adapter failed',
  /** Stable text for aggregate reactive adapter/service cleanup failure. */
  reactiveAdapterDisposeFailed: 'reactive backend adapter failed to dispose',
  /** Stable text for a live-query callback failure retained under EXTENSION_FAILED. */
  liveQueryFailed: 'live query extension failed',
  /** Stable text for aggregate direct backend cleanup failure. */
  backendDisposeFailed: 'storage backend failed to dispose',
  /** An index sidecar row has no authoritative record; repair or rebuild the index. */
  indexOrphan: 'indexed record index contains orphan sidecar row',
  /** A paged native query crossed a mutation epoch and must restart. */
  indexQueryInvalidated: 'native record index query invalidated by a concurrent mutation',
  /** A terminal query cannot refresh; create a new query handle. */
  liveQueryDisposed: 'live query is disposed; create a new live query',
  /** A backfill handle lost its original owner/checkpoint; reacquire through a repository operation. */
  indexBackfillStale: 'indexed record backfill handle is stale; retry the query',
  /** Stable cause text for rejecting bounded backfill projection work before sidecar writes. */
  indexBackfillProjectionTooLarge: 'indexed record backfill projection exceeds its fixed limit',
  /** Stable cause text for rejecting decoded backfill work before issuing a partial batch. */
  indexBackfillDecodedTooLarge: 'indexed record backfill decoded payload exceeds its fixed limit'
} as const)

/** Build the stable aggregate text used when backfill and failed-readiness persistence both fail. */
export const indexBackfillFailureText = (entityName: string): string =>
  `entity "${entityName}" index backfill and failure persistence both failed`

/** Stable public text for a logical unique-index collision. */
export const indexUniqueConflictText = (indexName: string): string =>
  `indexed record conflicts with unique index "${indexName}"`
