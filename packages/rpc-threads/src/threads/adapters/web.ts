import {
  createAdapterWebThreadLauncher,
  createAdapterWebThreadChannelFactory
} from '@migaia/rpc-core/adapter/threads'
import type { IThreadChannelOptions } from '../types.js'
import type { IWebThreadLauncherOptions } from '@migaia/rpc-core/adapter/threads'
export type {
  IWebThreadHandle,
  IWebThreadWorker,
  IWebThreadLauncherOptions
} from '@migaia/rpc-core/adapter/threads'

/** Create the complete Worker execution resource with this runtime's actual constructor. */
export function createWebThreadLauncher(options: IWebThreadLauncherOptions) {
  return createAdapterWebThreadLauncher(options)
}

/** Open prepared execution through its original complete channel operation. */
export function createWebThreadChannelFactory(options: IThreadChannelOptions) {
  return createAdapterWebThreadChannelFactory(options)
}
