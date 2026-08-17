/** Stable trace event discriminants emitted by the reactive runtime. */
export const ReactiveTraceType = {
  observableChange: 'observable-change',
  dependency: 'dependency',
  observerRun: 'observer-run',
  action: 'action'
} as const;

/** Lifecycle phases used by dependency, observer, and action trace events. */
export const ReactiveTracePhase = {
  start: 'start',
  end: 'end',
  error: 'error',
  connect: 'connect',
  disconnect: 'disconnect'
} as const;

/** Diagnostic phases used when the reactive runtime reports failures from host callbacks. */
export const ReactiveErrorPhase = {
  asyncFlush: 'async-flush',
  dependencyDisconnect: 'dependency-disconnect',
  lifecycleHook: 'lifecycle-hook',
  ssrResource: 'ssr-resource',
  subscriptionListener: 'subscription-listener',
  traceListener: 'trace-listener'
} as const;

/** Internal dependency-frame kinds used to distinguish committed tracking from render capture. */
export const ReactiveDependencyKind = {
  observer: 'observer',
  capture: 'capture'
} as const;

/** Stable reasons attached to observable and dependency trace events. */
export const ReactiveTraceReason = {
  set: 'set',
  notify: 'notify',
  retrack: 'retrack',
  invalidate: 'invalidate',
  dispose: 'dispose'
} as const;

export type IReactiveTraceType = (typeof ReactiveTraceType)[keyof typeof ReactiveTraceType];
export type IReactiveTracePhase = (typeof ReactiveTracePhase)[keyof typeof ReactiveTracePhase];
export type IReactiveTraceReason = (typeof ReactiveTraceReason)[keyof typeof ReactiveTraceReason];
export type IReactiveErrorPhase = (typeof ReactiveErrorPhase)[keyof typeof ReactiveErrorPhase];
export type IReactiveDependencyKind =
  (typeof ReactiveDependencyKind)[keyof typeof ReactiveDependencyKind];
