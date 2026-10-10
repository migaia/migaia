import { createThreadPlugin as createAdapterThreadPlugin } from '@migaia/rpc-core/adapter/threads'
import { threadRuntimeResource } from './runtime-resource.js'
import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry
} from '@migaia/rpc-core/remote'
import type { IThreadHandle } from '@migaia/supervision/threads'
import type { IRemotePluginDefinition } from '@migaia/rpc-core/remote'
import type { IThreadPluginOptions } from './types.js'
import { createRuntimePlugin, type IRuntimePluginOptions } from '@migaia/rpc-core/remote'
import type { IRuntimeThreadPeerOptions } from '@migaia/rpc-core/adapter/threads'

/** Symmetric Plugin options share the Peer source grammar and default to an empty Feature exposure. */
export type IRuntimeThreadPluginOptions = IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>

/** Combine one owned supervisor with remote's single Plugin assembly and retry owner. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle>
): IRemotePluginDefinition
/** Install a symmetric connection into the original canonical thread slot. */
export function createThreadPlugin<
  TRemote = Record<never, never>,
  const TProvide extends import('@migaia/rpc-core/remote').IRuntimePeerProvide = Record<
    never,
    never
  >,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IRuntimeThreadPluginOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'>
/** Native construction returns the complete Core-owned Plugin definition directly. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle> | IRuntimeThreadPluginOptions
): IRemotePluginDefinition | ReturnType<typeof createRuntimePlugin> {
  return createAdapterThreadPlugin(options as IRuntimeThreadPluginOptions, threadRuntimeResource)
}
