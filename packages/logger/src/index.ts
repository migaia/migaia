export type { IDimFn, IPaintFn } from './typing';

export { Logger } from './log';
export {
  getLoggerRuntimeManager,
  setLoggerRuntimeManager,
  type ILoggerProcess,
  type ILoggerRuntimeManager
} from './runtime-manager';
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
} from './typing';
