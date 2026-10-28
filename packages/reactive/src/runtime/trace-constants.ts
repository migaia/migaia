/** Owns stable graph roles, trace discriminants and diagnostic phases; emission belongs to Runtime. */

/** Stable graph roles are shared by diagnostic descriptors and ownership-error node labels. */
export const ReactiveNodeKind = {
  /** A source publishes values and admits downstream subscriptions. */
  observable: 'observable',
  /** A consumer records dependencies and receives scheduled invalidation. */
  observer: 'observer',
  /** A derived node combines source and observer roles under one diagnostic identity. */
  computed: 'computed'
} as const

/** Runtime role keys match their stable descriptor values without introducing a second domain. */
export type ReactiveNodeKind = keyof typeof ReactiveNodeKind

/** Stable trace event discriminants emitted by the reactive runtime. */
export const ReactiveTraceType = {
  observableChange: 'observable-change',
  dependency: 'dependency',
  observerRun: 'observer-run',
  action: 'action'
} as const

/** Lifecycle phases used by dependency, observer, and action trace events. */
export const ReactiveTracePhase = {
  start: 'start',
  end: 'end',
  error: 'error',
  connect: 'connect',
  disconnect: 'disconnect'
} as const

/** Diagnostic phases used when the reactive runtime reports failures from host callbacks. */
export const ReactiveErrorPhase = {
  asyncFlush: 'async-flush',
  /** Reports a hostile action-error cause getter during batch flush failure reconciliation. */
  causeRead: 'cause-read',
  dependencyDisconnect: 'dependency-disconnect',
  lifecycleHook: 'lifecycle-hook',
  ssrResource: 'ssr-resource',
  subscriptionListener: 'subscription-listener',
  traceListener: 'trace-listener'
} as const

/** Internal dependency-frame kinds used to distinguish committed tracking from render capture. */
export const ReactiveDependencyKind = {
  observer: 'observer',
  capture: 'capture'
} as const

/** Stable reasons attached to observable and dependency trace events. */
export const ReactiveTraceReason = {
  set: 'set',
  notify: 'notify',
  retrack: 'retrack',
  invalidate: 'invalidate',
  dispose: 'dispose'
} as const

export type IReactiveTraceType = (typeof ReactiveTraceType)[keyof typeof ReactiveTraceType]
export type IReactiveTracePhase = (typeof ReactiveTracePhase)[keyof typeof ReactiveTracePhase]
export type IReactiveTraceReason = (typeof ReactiveTraceReason)[keyof typeof ReactiveTraceReason]
export type IReactiveErrorPhase = (typeof ReactiveErrorPhase)[keyof typeof ReactiveErrorPhase]
export type IReactiveDependencyKind =
  (typeof ReactiveDependencyKind)[keyof typeof ReactiveDependencyKind]
