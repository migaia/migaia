import type { IRuntimeProcessPluginOptions } from './operation.js'
import { createAdapterProcessPlugin } from './operation.js'
import type { IProcessPlugin, IProcessPluginOptions } from './types.js'
import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry
} from '@migaia/rpc-core/remote'
import { createRuntimePlugin } from '@migaia/rpc-core/remote'
import type { IProcessHandle } from '@migaia/supervision/process'
import { NativeProcessRuntimeLoader } from '../runtime-loader.js'

/**
 * Define an advanced process-backed plugin with an explicit deployment, endpoint factory and local
 * registration owner. Construction validates configuration; Host installation acquires the actual
 * generation. Spawn definitions support replace, while borrowed connect definitions reject it.
 */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>
): IProcessPlugin
/**
 * Define a symmetric Process plugin from the same source forms as createProcessPeer. Host owns the
 * shared process slot and its release; provide/expose retain Core's Feature admission and typing.
 * The definition itself does not start a process before installation.
 */
export function createProcessPlugin<
  TRemote = Record<never, never>,
  const TProvide extends import('@migaia/rpc-core/remote').IRuntimePeerProvide = Record<
    never,
    never
  >,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IRuntimeProcessPluginOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'process'>
/**
 * The native factory supplies only the runtime I/O it holds; Core owns the complete Plugin
 * operation.
 */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle> | IRuntimeProcessPluginOptions
): IProcessPlugin | ReturnType<typeof createRuntimePlugin> {
  return createAdapterProcessPlugin(options, new NativeProcessRuntimeLoader())
}

/** The moved custom-runtime factory retains the same canonical Process operation. */
export { createAdapterProcessPlugin } from './operation.js'
export type { IRuntimeProcessPluginOptions } from './operation.js'
