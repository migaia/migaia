import { createNodeThreadLauncher, createNodeThreadChannelFactory } from './node.js'
import type { IThreadChannelOptions } from '../types.js'

/** Reuse Node mechanics without treating Node evidence as an Electron actual-exit proof. */
export function createElectronMainThreadLauncher() {
  return {
    ...createNodeThreadLauncher(),
    capabilities: {
      termination: 'unsupported',
      'exit-observation': 'unsupported',
      'heap-limit': 'unsupported'
    } as const
  }
}

/** Electron main uses worker_threads, never electron.utilityProcess. */
export function createElectronMainThreadChannelFactory(options: IThreadChannelOptions) {
  return createNodeThreadChannelFactory(options)
}
export type { INodeThreadHandle } from './node.js'
