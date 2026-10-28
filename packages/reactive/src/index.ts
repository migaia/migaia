/** Application entry exposes runtime factories, narrow node views, and stable diagnostics. */
export { createRuntime } from './runtime/runtime.class.ts'
export { defaultRuntime } from './runtime/default-runtime.ts'
export { assertSingleRuntimeCopy } from './runtime/copy-check.ts'
export {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  ReactiveTraceReason
} from './runtime/trace-constants.ts'
export { ReactiveErrorCode, type IReactiveErrorCode } from './error-code.ts'
export { REACTIVE_SOURCE, type IReactiveError } from './errors.ts'
export type { IComputedConfig } from './reactive/computed.class.ts'
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
} from './runtime/types.ts'
