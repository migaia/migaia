export { Computed, Effect, Signal, type IComputedConfig } from './reactive/index.js'

export { createRuntime, type Runtime } from './runtime/index.js'

export { defaultRuntime } from './runtime/default-runtime.js'
export {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType
} from './runtime/trace-constants.js'

// Error codes are public API (`docs/contracts/error-codes.md`). Callers must obtain the constants
// from the package entry to branch on codes without copying string values.
export { ReactiveErrorCode, type IReactiveErrorCode } from './error-code.js'
export { ReactiveErrorText, type IReactiveErrorText } from './error-text.js'
export { REACTIVE_SOURCE, type IReactiveError } from './errors.js'

export type {
  IDisposable,
  IDisposer,
  IComputedValue,
  IObservable,
  IObserver,
  IRuntime,
  IRuntimeOptions,
  ISignal,
  IRuntimeTraceEvent
} from './runtime/types.js'
