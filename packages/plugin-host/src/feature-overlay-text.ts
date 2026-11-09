/** Stable diagnostics and the private native shared-slot label belong to the overlay contract. */
export const FeatureOverlayText = {
  /** Duplicate singular providers fail during native install before anything is published. */
  conflict: 'Host feature contributions contain a duplicate singular role',
  /** Repeatable providers reserve aliases atomically within their fixed consumer role. */
  aliasConflict: 'Host feature contributions contain a duplicate alias within a repeatable role',
  /** One owner holds at most one contribution and one consumer per overlay, so removal is exact. */
  duplicateOwner: 'Host feature owner already contributes to this overlay',
  /** A fresh private symbol per overlay keeps its native publication facade unaddressable by name. */
  slot: 'FeatureOverlay'
} as const
