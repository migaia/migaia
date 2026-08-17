/** Container lifecycle states shared by every lifecycle scope implementation. */
export const LifecycleState = {
  open: 'open',
  closing: 'closing',
  terminal: 'terminal'
} as const;

/** Loading states for lifecycle units. */
export const LifecycleUnitState = {
  idle: 'idle',
  loading: 'loading',
  loaded: 'loaded',
  failed: 'failed'
} as const;

/** Error handling policies supported by disposal transactions. */
export const LifecycleErrorPolicy = {
  throw: 'throw',
  collect: 'collect',
  report: 'report',
  firstError: 'firstError'
} as const;

/** Internal thenable probe outcomes; getter failures remain distinct from plain values. */
export const ThenableProbeKind = {
  notThenable: 'not-thenable',
  thenable: 'thenable',
  failed: 'failed',
  promise: 'promise'
} as const;

/** Disposal transaction planning modes. */
export const DisposeTransactionKind = { order: 'order', plan: 'plan' } as const;

/** Settlement states of provisional ownership scopes. */
export const ProvisionalScopeState = {
  pending: 'pending',
  committed: 'committed',
  rolledBack: 'rolledback'
} as const;

export type ILifecycleStateValue = (typeof LifecycleState)[keyof typeof LifecycleState];
export type ILifecycleUnitStateValue = (typeof LifecycleUnitState)[keyof typeof LifecycleUnitState];
export type ILifecycleErrorPolicy =
  (typeof LifecycleErrorPolicy)[keyof typeof LifecycleErrorPolicy];
export type IThenableProbeKind = (typeof ThenableProbeKind)[keyof typeof ThenableProbeKind];
export type IDisposeTransactionKind =
  (typeof DisposeTransactionKind)[keyof typeof DisposeTransactionKind];
export type IProvisionalScopeState =
  (typeof ProvisionalScopeState)[keyof typeof ProvisionalScopeState];
