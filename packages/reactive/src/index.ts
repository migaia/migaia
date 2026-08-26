export { Computed, Effect, Signal, type IComputedConfig } from './reactive/index.js'

export { createRuntime, type Runtime } from './runtime/index.js'

export { defaultRuntime } from './runtime/default-runtime.js'
export {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType
} from './runtime/trace-constants.js'

// 错误码是公开 API 的一部分（`docs/contracts/error-codes.md`）：调用方要能按 code 分支，
// 就必须从包入口拿得到常量，而不是自己抄一份字符串字面量。
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
