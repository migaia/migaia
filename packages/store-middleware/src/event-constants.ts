/** Middleware trace event types. */
export const MiddlewareEventType = {
  /** Synchronous action scope start/end/error notifications. */
  action: 'action',
  /** Producer-supplied before/after state notification. */
  state: 'state',
  /** Standalone diagnostic event, distinct from an action's error phase. */
  error: 'error'
} as const

/** Devtools state commands normalized by the middleware adapter. */
export const MiddlewareCommandType = {
  /** Reinitialize DevTools with current state without applying replacement state. */
  commit: 'commit',
  /** Apply the supplied historical state through a host action. */
  jump: 'jump',
  /** Apply the supplied reset state through a host action. */
  reset: 'reset'
} as const

/** Action trace phases shared by middleware hosts and adapters. */
export const MiddlewareEventPhase = {
  /** The synchronous action callback has not run yet. */
  start: 'start',
  /** The callback returned; any returned Promise may still be pending. */
  end: 'end',
  /** The synchronous callback threw. */
  error: 'error'
} as const

/** Public event-category values for narrowing middleware events. */
export type IMiddlewareEventType = (typeof MiddlewareEventType)[keyof typeof MiddlewareEventType]
/** Public normalized DevTools command values. */
export type IMiddlewareCommandType =
  (typeof MiddlewareCommandType)[keyof typeof MiddlewareCommandType]
/** Public action-phase values; arbitrary standalone error phases use string instead. */
export type IMiddlewareEventPhase = (typeof MiddlewareEventPhase)[keyof typeof MiddlewareEventPhase]
