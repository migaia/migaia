/** Middleware trace event types. */
export const MiddlewareEventType = {
  action: 'action',
  state: 'state',
  error: 'error'
} as const;

/** Devtools state commands normalized by the middleware adapter. */
export const MiddlewareCommandType = {
  commit: 'commit',
  jump: 'jump',
  reset: 'reset'
} as const;

/** Action trace phases shared by middleware hosts and adapters. */
export const MiddlewareEventPhase = { start: 'start', end: 'end', error: 'error' } as const;

export type IMiddlewareEventType = (typeof MiddlewareEventType)[keyof typeof MiddlewareEventType];
export type IMiddlewareCommandType =
  (typeof MiddlewareCommandType)[keyof typeof MiddlewareCommandType];
export type IMiddlewareEventPhase =
  (typeof MiddlewareEventPhase)[keyof typeof MiddlewareEventPhase];
