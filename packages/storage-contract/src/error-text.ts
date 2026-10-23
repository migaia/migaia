/** Stable validation causes used by codec and synchronous-option admission boundaries. */
export const StorageContractErrorText = {
  /** Physical key readers admit only the original complete canonical ordered wire encoding. */
  orderedKeyInvalid: 'ordered storage key encoding is invalid',
  /** Blob inputs are captured before native object I/O or upload-reader ownership. */
  blobArgument: 'blob key, body or options are invalid',
  /** A returned object grants one stream-or-bytes right for its original resource lifetime. */
  blobConsumed: 'blob content has already been consumed or disposed',
  /** SQL templates, identifiers and pure fragment inputs are admitted before native execution. */
  sqlArgument: 'SQL fragment input is invalid',
  /** SPARQL accepts only real templates, validated RDF values and authentic fragments. */
  sparqlArgument: 'SPARQL fragment input is invalid',
  /** The shared lexer rejects empty/multiple statements and transaction-owned user commands. */
  sqlStatement: 'SQL must contain one permitted statement',
  /** Batch keys and duplicate policy are captured before native requests or mutations can start. */
  batchKeys: 'storage batch keys or options are invalid',
  /** Atomic batches cannot write the same canonical typed key more than once. */
  batchDuplicate: 'storage batch contains duplicate keys',
  /** Public byte ordering admits real selector bytes and retains callback/reflection causes. */
  keyByteOrder: 'storage byte ordering inputs are invalid',
  /** TTL deadlines accept finite nonnegative milliseconds, including zero and fractions. */
  ttlDuration: 'storage TTL duration must be finite and nonnegative',
  /** Counter deltas must remain exactly representable integers before the native operation starts. */
  counterIncrement: 'storage counter increment must be a safe integer',
  /** Counter text and arithmetic must preserve canonical decimal safe-integer values. */
  counterValue: 'storage counter value or result is not a canonical safe integer',
  /** Vector shape and finite values must be valid before a native collection call. */
  vectorArgument: 'storage vector collection, point, filter or search argument is invalid',
  /** RDF terms and ground quad positions must be portable before native writes or query binding. */
  rdfArgument: 'RDF term, literal annotation or ground quad is invalid',
  /**
   * Declarative query admission rejects malformed boolean, field, path and operator inputs before
   * reading candidates.
   */
  queryCondition: 'storage query condition is invalid',
  /** Query author descriptors and selection fields must be valid before a native cursor is opened. */
  queryArgument: 'storage query source or selection is invalid',
  /** Record limits are nonnegative safe integers so retained rows stay explicitly bounded. */
  queryLimit: 'storage query limit must be a nonnegative safe integer',
  /** Opaque comparator ordering requires an immediately declared bound before source execution. */
  queryComparatorLimit: 'storage query comparator requires an explicit limit',
  /** An explicitly required first row was absent after the original source finished cleanup. */
  queryEmptyResult: 'storage query has no result',
  /** Chunk callbacks require a positive finite allocation bound before cursor admission. */
  queryChunk: 'storage query chunk size must be a positive safe integer',
  /** Statistics accept present finite numbers and skip only null or undefined fields. */
  queryNumericField: 'storage query numeric field must contain a finite number',
  /**
   * User predicates, mappers and native cursor failures retain original identity and cleanup
   * traceability.
   */
  queryExecution: 'storage query execution failed',
  /** Strict execution identifies every client step before the backend is invoked. */
  queryNotPushable: (reasons: readonly string[]): string =>
    `storage query cannot be pushed: ${reasons.join('; ')}`,
  /** Client functions have no declarative translation and form a record prefix boundary. */
  queryFunction: 'JavaScript callback requires client execution',
  /** Vector callbacks inspect only original engine hits and never trigger replacement searches. */
  queryVectorFunction:
    'JavaScript payload predicate applies only to engine hits and may return fewer than topK',
  /** Native equality cannot promise JavaScript opaque object identity. */
  queryIdentity: 'object identity comparison requires client execution',
  /** Native admission explicitly lists each supported operation and field operator. */
  queryUnsupported: 'backend does not declare this operation or operator',
  /** A record operation following a client step cannot cross the longest safe native prefix. */
  queryPrefix: 'operation follows a client execution boundary',
  /** Offset pagination advances through every skipped source row rather than seeking a key. */
  querySkip: 'skip advances through rows with O(n) cost',
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
  /** Root membership alone does not authorize a capability on an original transaction view. */
  capabilityTransactionMissing: (capability: string, backend: string): string =>
    `backend ${backend} does not provide transaction capability ${capability}`,
  capabilityMissing: (capability: string, backend: string): string =>
    `backend ${backend} does not provide capability ${capability}`
} as const
