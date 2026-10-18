/** Dependency graph node kinds rendered by the devtools tree helpers. */
export const StoreDevtoolsNodeKind = {
  observable: 'observable',
  observer: 'observer'
} as const

/** Default labels used for anonymous reactive nodes and initial history snapshots. */
export const StoreDevtoolsLabel = {
  anonymousReactiveNode: 'AnonymousReactiveNode',
  initial: 'initial',
  stateChange: 'state change'
} as const
