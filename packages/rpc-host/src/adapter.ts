/** Task-level adapter authors provide actual raw I/O; Core retains protocol and resource owners. */
export { defineMessageAdapter, defineByteAdapter } from './runtime-adapter/definition.js'
export type {
  IMessageAdapterOptions,
  IMessageAdapterPort,
  IMessageAdapterLaunch,
  IByteAdapterOptions,
  IAdapterDefinition,
  IAdapterDeploymentOptions
} from './runtime-adapter/definition-types.js'
