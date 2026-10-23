/** Canonical host boundary messages. */
export const StorageErrorText = {
  /** Unique-index conflicts preserve the original public constraint diagnostic. */
  indexUniqueConflict: (indexName: string) =>
    `indexed record conflicts with unique index "${indexName}"`,
  /** Flat-wire decoding preserves the original bounded key-domain messages. */
  storageKeyDecodeLimitExceeded: 'storage key exceeds decode limits',
  /** Flat-wire tuples retain exactly their registered tag and payload slots. */
  storageKeyWireInvalid: 'invalid storage key wire',
  /** A decoded binary key cannot exceed the canonical contract budget. */
  storageKeyBinaryTooLarge: 'key too large',
  /** Unknown wire tags remain malformed data and never become logical keys. */
  storageKeyWireTagInvalid: 'invalid storage key wire tag',
  /** Ranges must be structural option objects before copying their bounds. */
  keyRangeObject: 'key range must be an object',
  /** Both inclusive/exclusive flags retain the existing boolean domain. */
  keyRangeFlags: 'key range open flags must be boolean',
  /** Invalid bounds preserve their original field label and validation cause. */
  keyRangeBound: (label: string) => `invalid ${label}`,
  /** Empty or reversed bounds reject before backend iteration. */
  keyRangeInvalid: 'invalid key range',
  /** Preserve the original final backend cleanup diagnostic when its neutral implementation moves. */
  operationCleanupFailed: '[storage-web] operation cleanup failed',
  /** Environment checks must be callable before their original installation resource is acquired. */
  invalidDetectCheck: 'storage environment check must be a function',
  /** Detection mode is a boolean captured before backend construction. */
  invalidAutoDetect: 'autoDetect must be a boolean',
  /** Constructor hooks must be a keyed listener record before installation starts. */
  invalidHooks: 'storage hooks must be an object',
  /** Hook listeners must be callable before acquiring a subscriber registration. */
  invalidHookHandler: 'storage hook handler must be a function',
  /**
   * Preserve the original fallback diagnostic text while the package source transfers to its
   * neutral owner.
   */
  defaultError: (code: string) => `[storage-web] ${code}`,
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
  /** Stable kind mismatch diagnostic; token identity remains the authority. */
  backendKindMismatch: 'storage backend kind does not match',
  /** Standard Schema construction requires an object descriptor. */
  standardSchemaObject: 'Standard Schema must be an object',
  /** Version, vendor and callback are captured before exposing a schema adapter. */
  standardSchemaDescriptor: 'Standard Schema must provide version 1, vendor, and validate',
  /** A validator must return its version-one result object. */
  standardSchemaResult: 'Standard Schema returned an invalid result',
  /** Validation issues must contain readable string messages. */
  standardSchemaIssuesInvalid: 'Standard Schema returned invalid issues',
  /** A successful Standard Schema result must own its value field. */
  standardSchemaMissingValue: 'Standard Schema result must contain value or issues',
  /** Binary identity codec refuses other input domains. */
  binaryCodecEncode: 'binaryCodec.encode expects a Uint8Array',
  /** Binary identity codec refuses other stored carriers. */
  binaryCodecDecode: 'binaryCodec.decode expects a Uint8Array',
  /** Binary fallback requires actual bytes from the original codec. */
  binaryCodecResult: 'binary codec must return a Uint8Array',
  /** Base64 fallback cannot decode a non-text storage carrier. */
  binaryFallbackInput: 'binary fallback expects a base64 string',
  /** Codec routing only accepts a complete storage capability snapshot. */
  codecCapabilities: 'capabilities must be a complete storage descriptor',
  /** Optional route diagnostics must be callable. */
  codecDiagnostic: 'onDiagnostic must be a function',
  /** Preserve the original final reporting diagnostic for a rejected route observer. */
  codecDiagnosticFailure: '[storage-web] operation reporter failed',
  /** Structured codec values cannot be converted to text without changing their domain. */
  structuredCodecUnsupported: (name: string) =>
    `codec "${name}" produces structured output but the backend only supports text`,
  /** Stable diagnostic records the real expansion of the explicit binary-to-text route. */
  codecBinaryFallback: (name: string) =>
    `[storage-web] codec "${name}" falls back to base64 on a text-only backend (+33% size)`
} as const
