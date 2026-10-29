export { defineLogFeature } from './feature-metadata.ts'
export { defineLogPlugin } from './log-plugin.ts'
export { defineOutputPlugin } from './output.ts'
export { projectLogEntry } from './projection.ts'
export { LogEntryDataKey } from './state-constants.ts'
export type {
  IErrorInfo,
  ILogEntry,
  IRawEntryInput,
  ILogFailure,
  IShutdownReason,
  ILogContext,
  ILogPluginCore,
  ILogPlugin,
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
