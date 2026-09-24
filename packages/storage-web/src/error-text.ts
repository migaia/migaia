/** Stable diagnostic text for an IndexedDB sidecar row without an authoritative record. */
export const StorageErrorText = Object.freeze({
  /** Standard Schema issue arrays must contain object entries with string messages. */
  standardSchemaIssuesInvalid: 'Standard Schema returned invalid issues',
  /** Namespace codecs must encode a physical key as a string. */
  namespaceCodecEncodeInvalid: 'namespace codec encode must return a string',
  /** Namespace codecs may decode only a string key or an absent foreign namespace. */
  namespaceCodecDecodeInvalid: 'namespace codec decode must return string or undefined',
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
  /** Entity ordering extensions must return a finite comparable number. */
  entityComparatorInvalid: 'entity orderBy comparator must return a number',
  /** Encoded storage keys are bounded to the contract depth and node limits. */
  storageKeyDecodeLimitExceeded: 'storage key exceeds decode limits',
  /** Encoded storage keys must use the canonical two-slot wire tuple. */
  storageKeyWireInvalid: 'invalid storage key wire',
  /** Encoded binary storage keys must remain within the public key-size limit. */
  storageKeyBinaryTooLarge: 'key too large',
  /** Encoded storage keys must use one of the registered wire tags. */
  storageKeyWireTagInvalid: 'invalid storage key wire tag',
  /** Stable text for rejecting malformed backend identifiers before host mutation. */
  backendIdInvalid: 'storage backend id is invalid',
  /** Stable text for duplicate backend registration or install-batch identifiers. */
  backendDuplicate: 'storage backend is already installed',
  /** Stable text for a valid backend identifier absent from the host registry. */
  backendNotInstalled: 'storage backend is not installed',
  /** Stable text for backend plugin/store contract rejection. */
  backendPluginInvalid: 'storage backend plugin is invalid',
  /** Stable text for backend factory, preparation, or PluginHost install failure. */
  backendInstallFailed: 'storage backend installation failed',
  /** Stable text for rejecting host mutation while another batch is installing. */
  storageHostBusy: 'storage host is busy installing plugins',
  /** Stable text for host operations after seal or terminal disposal. */
  storageHostDisposed: 'storage host is disposed',
  /** Stable text for aggregate host cleanup failure. */
  storageHostDisposeFailed: 'storage host failed to dispose',
  /** Stable text for aggregate live-query cleanup failure. */
  liveQueryDisposeFailed: 'live query failed to dispose',
  /** Stable text for malformed reactive feature/provider/adapter descriptors. */
  reactiveFeatureInvalid: 'reactive feature is invalid',
  /** Stable text for rejected reactive feature topology. */
  reactiveTopologyInvalid: 'reactive feature topology is invalid',
  /** Stable text for live-query service lookup before service installation. */
  reactiveServiceNotInstalled: 'reactive live-query service is not installed',
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
  indexOrphan: 'indexed record index contains orphan sidecar row',
  indexQueryInvalidated: 'native record index query invalidated by a concurrent mutation',
  liveQueryDisposed: 'live query is disposed; create a new live query',
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
