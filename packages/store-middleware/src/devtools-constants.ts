/** Stable Redux DevTools wire commands consumed by createReduxDevToolsAdapter and custom bridges. */
export const ReduxDevToolsCommand = {
  /** Outer message category whose payload contains a state or commit command. */
  dispatch: 'DISPATCH',
  /** Reinitialize the adapter from current state, without JSON parsing. */
  commit: 'COMMIT',
  /** Parse the supplied historical state and normalize to a jump command. */
  jumpToState: 'JUMP_TO_STATE',
  /** Parse an action's historical state and normalize to a jump command. */
  jumpToAction: 'JUMP_TO_ACTION',
  /** Parse rollback state and normalize to jump; this does not undo arbitrary effects. */
  rollback: 'ROLLBACK',
  /** Parse the supplied state and normalize to reset. */
  reset: 'RESET'
} as const

/** Accepted wire command vocabulary; middleware domain commands remain separately owned. */
export type IReduxDevToolsCommand = (typeof ReduxDevToolsCommand)[keyof typeof ReduxDevToolsCommand]
