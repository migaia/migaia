/** Devtools command names accepted by the store adapter. */
export const StoreDevtoolsCommand = {
  dispatch: 'DISPATCH',
  commit: 'COMMIT',
  jumpToState: 'JUMP_TO_STATE',
  jumpToAction: 'JUMP_TO_ACTION',
  rollback: 'ROLLBACK',
  reset: 'RESET'
} as const

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

export type IStoreDevtoolsCommand = (typeof StoreDevtoolsCommand)[keyof typeof StoreDevtoolsCommand]
