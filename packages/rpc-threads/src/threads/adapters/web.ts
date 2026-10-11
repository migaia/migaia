import {
  createAdapterWebThreadLauncher,
  createAdapterWebThreadChannelFactory
} from '../web-launcher.js'
import type { IThreadChannelOptions } from '../types.js'
import type { IWebThreadLauncherOptions } from '../web-launcher.js'
export type {
  IWebThreadHandle,
  IWebThreadWorker,
  IWebThreadLauncherOptions
} from '../web-launcher.js'

/** Create the complete Worker execution resource with this runtime's actual constructor. */
export function createWebThreadLauncher(options: IWebThreadLauncherOptions) {
  return createAdapterWebThreadLauncher(options)
}

/** Open prepared execution through its original complete channel operation. */
export function createWebThreadChannelFactory(options: IThreadChannelOptions) {
  return createAdapterWebThreadChannelFactory(options)
}
