import { createAdapterProcessPlugin } from '@migaia/rpc-core/adapter/process'
import type {
  IProcessPlugin,
  IProcessPluginOptions,
  IRuntimeProcessPluginOptions
} from '@migaia/rpc-core/adapter/process'
import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry
} from '@migaia/rpc-core/remote'
import { createRuntimePlugin } from '@migaia/rpc-core/remote'
import type { IProcessHandle } from '@migaia/supervision/process'
import { NativeProcessRuntimeLoader } from '../runtime-loader.js'

/** The original advanced declaration is retained only for the serial C7 consumer migration. */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>
): IProcessPlugin
/** Adds one symmetric connection to the canonical process slot. */
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
