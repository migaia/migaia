export type { IDimFn, IPaintFn } from './typing.js'

export { Logger } from './log.js'
export { LoggerErrorCode, type ILoggerErrorCode } from './error-code.js'
export { LOGGER_SOURCE } from './errors.js'
export { LoggerStatus, type ILoggerStatus } from './state-constants.js'
export {
  LoggerLevel,
  LoggerColorMode,
  LoggerReasoningPhase,
  type ILoggerLevel,
  type ILoggerColorMode,
  type ILoggerReasoningPhase
} from './plugin-constants.js'
export {
  getLoggerRuntimeManager,
  setLoggerRuntimeManager,
  type ILoggerProcess,
  type ILoggerRuntimeManager
} from './runtime-manager.js'
export type {
  IErrorInfo,
  IFlusher,
  IOff,
  ILogDispatchOptions,
  ILogEntry,
  ILoggerCore,
  ILoggerDomainCore,
  ILogFailure,
  ILogFailureHook,
  ILogFilter,
  ILogHookFn,
  ILoggerPlugin,
  ILoggerConfig,
  ILoggerPluginConfig,
  ILoggerPluginCore,
  ILoggerContext,
  ILoggerEnv,
  ILoggerOptions,
  IPipelineStage,
  IRawEntryInput,
  IShutdownHandler,
  IShutdownReason,
  ISink,
  IStaticLoggerCtor
} from './typing.js'
