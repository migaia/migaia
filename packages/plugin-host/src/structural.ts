/** Structural-only package entry; exposes canonical V2 Host without functional factory imports. */
export {
  PluginHost,
  PluginHostDisposalNodeKind,
  readPluginHostDisposalProvenance
} from './host-runtime.js'
export { PluginHostErrorCode } from './error-code.js'
export { PluginHostError, default as ERROR_TEXT } from './error-text.js'
export { asyncDisposeKey, disposeKey } from './symbols.js'
export type { IPluginHostDisposalNodeKind, IPluginHostDisposalProvenance } from './host-runtime.js'
export type { IPluginConstraint, IPluginHostOptions, IPluginHostCore } from './typing.js'
