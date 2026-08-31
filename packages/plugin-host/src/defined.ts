/** Functional-only package entry; static imports keep structural adapters out of this graph. */
export { definePlugin } from './define-plugin.js'
export { setupHost } from './setup-host.js'
export { PluginHostErrorCode } from './error-code.js'
export { PluginHostError, default as ERROR_TEXT } from './error-text.js'
export { asyncDisposeKey, disposeKey } from './symbols.js'
export type {
  IDefinedPluginConstraint,
  IHostSetupContext,
  ISetupHostOptions,
  ISetupHostView,
  ISetupPluginHost
} from './typing.js'
