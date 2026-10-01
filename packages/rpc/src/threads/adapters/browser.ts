import {
  createWebThreadLauncher,
  createWebThreadChannelFactory,
  type IWebThreadLauncherOptions
} from './web.js'
import type { IThreadChannelOptions } from '../types.js'

/** Browser has no proven final-exit receipt; lifecycle capabilities stay unsupported. */
export function createBrowserThreadLauncher(options: IWebThreadLauncherOptions) {
  return createWebThreadLauncher(options)
}

/** Reuse borrowed EventTarget messaging with the caller's exact scheduler. */
export function createBrowserThreadChannelFactory(options: IThreadChannelOptions) {
  return createWebThreadChannelFactory(options)
}
export type { IWebThreadHandle, IWebThreadLauncherOptions } from './web.js'
