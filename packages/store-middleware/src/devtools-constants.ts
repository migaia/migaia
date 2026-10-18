/** Stable Redux DevTools wire commands consumed by createReduxDevToolsAdapter and custom bridges. */
export const ReduxDevToolsCommand = {
  dispatch: 'DISPATCH',
  commit: 'COMMIT',
  jumpToState: 'JUMP_TO_STATE',
  jumpToAction: 'JUMP_TO_ACTION',
  rollback: 'ROLLBACK',
  reset: 'RESET'
} as const

/** Accepted wire command vocabulary; middleware domain commands remain separately owned. */
export type IReduxDevToolsCommand = (typeof ReduxDevToolsCommand)[keyof typeof ReduxDevToolsCommand]
