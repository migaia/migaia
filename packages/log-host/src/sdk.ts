export { defineLogFeature } from './feature-metadata.ts'
export { defineLogPlugin } from './log-plugin.ts'
export { defineOutputPlugin } from './output.ts'
export { projectLogEntry } from './projection.ts'
export { LogEntryDataKey, LogFailureSource } from './state-constants.ts'
export type {
  IErrorInfo,
  ILogEntry,
  IRawEntryInput,
  ILogFailure,
  IShutdownReason,
  ILogContext,
  ILogPluginCore,
  ILogPlugin,
  IDefinedLogPlugin,
  ILogOutputFeatureRecord,
  IEnabledLogFeatures,
  ILogPluginConstraint,
  IPluginExtensions,
  ILogFeatureDefinition,
  ILogFeature,
  ILogFeatureRecord,
  ILogFormat,
  ILogControlExtensions,
  ILogProjectedEntry,
  ILogOutputRecord
} from './typing.ts'
