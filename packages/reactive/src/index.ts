/** Application entry exposes runtime factories, narrow node views, and stable diagnostics. */
export { createRuntime } from './runtime/runtime.class.js'
export { defaultRuntime } from './runtime/default-runtime.js'
export { assertSingleRuntimeCopy } from './runtime/copy-check.js'
export {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  ReactiveTraceReason
} from './runtime/trace-constants.js'
export { ReactiveErrorCode, type IReactiveErrorCode } from './error-code.js'
export { REACTIVE_SOURCE, type IReactiveError } from './errors.js'
export type { IComputedConfig } from './reactive/computed.class.js'
export type {
  IReactiveSignal,
  IReactiveComputed,
  IReactiveEffect,
  IReactiveNodeOptions,
  IDisposable,
  IDisposer,
  IRuntime,
  IRuntimeOptions,
  ISchedulerStrategy,
  IFlushResult,
  IRuntimeTraceEvent,
  IRuntimeErrorContext
} from './runtime/types.js'
