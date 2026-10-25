/** Stable RPC runtime error diagnostics retained across the responsibility migration. */
/** Automatic provide descriptor errors are stable, non-reflecting configuration diagnostics. */
export const RuntimeApiErrorText = {
  /** Factory admission rejects this value before bootstrap or physical resource acquisition. */
  defaultTimeoutInvalid: 'Runtime defaultTimeoutMs must be a positive finite number',
  /** A foreign origin without a negotiated node cannot safely begin a native forwarding route. */
  forwardOriginUnavailable: 'RPC forwarding origin node is unavailable',
  /** Descriptor compilation cannot read accessors or accept non-own/reserved callable paths. */
  provideInvalid: 'Runtime provide must contain valid own data methods or groups',
  /** A Peer chooses one explicit source, or the platform's verified automatic bootstrap. */
  sourceInvalid: 'Runtime Peer requires exactly one connection source',
  /** Safe identity is projected from explicit configuration or the verified platform bootstrap. */
  identityInvalid: 'Runtime Peer identity is invalid',
  /** A remote directory must satisfy the negotiated versioned application schema. */
  descriptionInvalid: 'Runtime method description is invalid',
  /** Whitelist admission refuses unknown methods without reflecting arbitrary input text. */
  methodUnavailable: 'Runtime method is not provided by this peer',
  /** Only scalar result normalization, never handler failures, opts in to this payload summary. */
  resultInvalid: 'Runtime request result must be portable',
  /** Host reporting preserves PAYLOAD_INVALID when bounded error-data projection must degrade. */
  errorDataInvalid: 'RPC error data could not be serialized',
  /** Only a successfully prepared package Peer carries its accepted directory receipt. */
  peerInvalid: 'Runtime Peer is not prepared by the canonical owner',
  /** Plugin registration labels are validated before any source is opened. */
  pluginNameInvalid: 'Runtime plugin name must be a non-empty string',
  /** Exposure is a copied unique whitelist of existing managed Feature providers. */
  exposeInvalid: 'Runtime plugin expose must contain unique plugin names',
  /** Directory construction never invokes an accessor or imports arbitrary Host members. */
  featureInvalid: 'Runtime plugin exposure requires own enumerable data methods',
  /** Two Features cannot silently select a winner for the same plugin.method route. */
  featureConflict: 'Runtime plugin features contain conflicting method names',
  /** Routing takes only a logical name or library instance id, never an OS pid. */
  targetInvalid: 'Runtime outlet target must be a non-empty string',
  /** Exact contribution retirement cannot select a same-name successor through an old handle. */
  targetUnknown: 'Runtime outlet target is not a live connection',
  /** Canonical indexes preserve all matches and reject ambiguity instead of selecting one. */
  targetAmbiguous: 'Runtime outlet target identifies multiple connections',
  /** Passive subscriptions admit only the declared lifecycle events and actual callbacks. */
  eventInvalid: 'Runtime event subscription is invalid',
  /** Native mutations require an original spawn/create lease, never a local channel ownership claim. */
  controlBorrowed: 'Runtime target does not own native execution',
  /** Invalid grace or platform signal is rejected before command queue admission. */
  stopInvalid: 'Runtime stop configuration is invalid',
  /** Filters use only canonical states, source kinds and one explicit name discriminator. */
  filterInvalid: 'Runtime query filter is invalid',
  /** Host controls require the original catalog, synchronous resolver and this exact managed Host. */
  hostControlInvalid: 'Runtime host exposure requires its managed Host catalog and resolver',
  /** Replacement preserves the old unit unless the new coroutine task is callable. */
  coroutineReplaceInvalid: 'Runtime coroutine replacement requires a task function'
} as const
