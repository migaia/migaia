/**
 * Stable config diagnostic reasons; all config and ConfigOwner error construction consumes this
 * owner.
 */
export const ConfigReason = {
  /** Rejects re-owning an identity with different normalized ownership metadata. */
  ownershipMetadataDiffers: 'ownership metadata differs',
  /** Explains config root or patch admission to callers of owned-config primitives. */
  plainRecordRequired: 'plain record required',
  /** Root and patch symbols cannot cross the config string-key admission boundary. */
  symbolKeyUnsupported: 'symbol key is not supported',
  /** Readonly and patch/path reads require canonical runtime ownership metadata. */
  valueNotOwned: 'value is not owned',
  /** A patch cannot reinterpret its existing base under another input profile. */
  profileDiffers: 'profile differs from base',
  /** Patch admission permits only budgets at least as strict as its owned base. */
  patchLimitsCannotWiden: 'patch limits cannot widen base limits',
  /** Graph and patch admission reject prototype-polluting property names. */
  dangerousKey: 'dangerous key',
  /** Owned graph cloning copies data descriptors and never invokes an accessor. */
  accessorUnsupported: 'accessor unsupported',
  /** Every supplied combine source must have canonical ownership metadata. */
  sourceNotOwned: 'source is not owned',
  /** Combination rejects source graphs that use incompatible admission profiles. */
  sourceProfilesDiffer: 'sources use different profiles',
  /** Budgets must be positive safe integers within the package default ceilings. */
  invalidLimit: 'invalid limit',
  /** Config paths must remain within the documented path-length budget. */
  invalidLength: 'invalid length',
  /** Config and owner path admission share this stable malformed-segment reason. */
  invalidSegment: 'invalid segment',
  /** Graph key counting identifies maxKeys exhaustion while copying descriptors. */
  graphKeys: 'graph keys',
  /** Map and Set entry counting identifies maxKeys exhaustion. */
  graphEntries: 'graph entries',
  /** Graph traversal identifies depth-budget exhaustion without changing error text. */
  graphDepth: 'graph depth',
  /** Graph traversal identifies identity-count exhaustion. */
  graphNodes: 'graph nodes',
  /** Callable cloning is admitted only by the rich-runtime profile. */
  functionRequiresRichRuntime: 'function requires richRuntime',
  /** Constructable inputs must expose their data-valued prototype descriptor. */
  callablePrototypeRequired: 'callable prototype required',
  /** Callable copying rejects accessors and fixed unsupported own descriptors. */
  callablePropertyUnsupported: 'callable property unsupported',
  /** Conflict resolvers cannot publish asynchronous decisions into a synchronous merge. */
  resolverSynchronous: 'resolver must be synchronous',
  /** Conflict resolution accepts only the four documented decision kinds. */
  resolverDecisionInvalid: 'resolver decision is invalid',
  /** All readonly mutation attempts use the canonical native TypeError construction path. */
  readonlyMutation: 'readonly mutation',
  /** Owner reads and writes reject missing or empty path arguments. */
  pathListRequired: 'non-empty string or segment list required',
  /** Owner array traversal accepts canonical numeric index segments only. */
  arrayIndexRequired: 'array index required',
  /** Path rebuilding cannot descend into an existing non-container leaf. */
  recordOrArrayRequired: 'record or array required',
  /** JSON projection retains its fixed depth ceiling and diagnostic wording. */
  jsonTooDeep: 'graph is too deep for JSON',
  /** JSON projection rejects runtime-only values instead of silently losing data. */
  notJsonSerializable: 'value is not JSON serializable',
  /** JSON source parsing rejects non-string inputs before reading parser options. */
  parseTextRequired: 'text must be a string',
  /** Parser failures without a readable reason use this stable fallback. */
  invalidJson: 'invalid JSON',
  /** Environment loading validates its flat variable record before reading policies. */
  envRecordRequired: 'a record of strings',
  /** Environment nesting separators must be non-empty strings. */
  nonEmptyStringRequired: 'a non-empty string',
  /** ConfigOwner.merge requires an initial source to determine ownership. */
  atLeastOneSource: 'at least one source',
  /** ConfigOwner.select accepts only an owned record subtree. */
  recordRequired: 'record required'
} as const

/** Environment conflicts name the original supplied variable after deterministic key admission. */
export function environmentConflictReason(name: string): string {
  return `environment key ${name}`
}
