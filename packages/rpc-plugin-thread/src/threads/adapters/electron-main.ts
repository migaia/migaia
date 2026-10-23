import { createNodeThreadLauncher, createNodeThreadChannelFactory } from './node.js'
import type { IThreadChannelOptions } from '../types.js'

/**
 * Create the Electron-main worker_threads launcher, not an electron.utilityProcess launcher.
 * Construction is cold and reuses Node mechanics, but termination, exit-observation and heap-limit
 * capabilities remain unsupported for this host. A Node test result does not strengthen those
 * guarantees; use a best-effort policy only when its retained/abandoned-lease behavior is
 * acceptable.
 */
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

/**
 * Build the Electron-main channel factory using the required shared scheduler and optional local
 * capability restriction. It reuses Node channel opening and does not change the launcher's
 * unsupported native lifecycle declarations or transfer/authentication requirements.
 */
export function createElectronMainThreadChannelFactory(options: IThreadChannelOptions) {
  return createNodeThreadChannelFactory(options)
}
