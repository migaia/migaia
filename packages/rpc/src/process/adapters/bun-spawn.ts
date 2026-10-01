/** Bun's Node-compatible process streams preserve the same backpressured channel contract. */
export {
  createNodeProcessLauncher as createBunProcessLauncher,
  openProcessStdioChannel
} from './node-child-process.js'
export type { INodeProcessHandle as IBunProcessHandle } from './node-child-process.js'
