import type { IThreadHandle } from '@migaia/supervision/threads'
import { prepareAdapterPeer, createAdapterSourceConfigurationError } from '@migaia/rpc-core/adapter'
import {
  RuntimePluginKey,
  type IRuntimePeerOptions,
  type IRuntimePeer,
  type IRuntimePeerSource
} from '@migaia/rpc-core/remote'
import { createThreadBinding } from './binding.js'
import type { IThreadCommonOptions } from './types.js'

/** Existing thread deployment owns its original supervisor, budget, launcher and channel factory. */
export type IRuntimeThreadSpawn<THandle extends IThreadHandle = IThreadHandle> = Omit<
  IThreadCommonOptions<THandle>,
  'endpointFactory'
>

/**
 * Source callbacks remain only for the serial migration; deployed sources use original platform
 * specs.
 */
export type IRuntimeThreadPeerOptions<THandle extends IThreadHandle = IThreadHandle> = Omit<
  IRuntimePeerOptions,
  'spawn'
> &
  Readonly<{ spawn?: IRuntimePeerSource | IRuntimeThreadSpawn<THandle> }>

/** Construct real owned execution through the same binding and remote generation owner. */
export function createThreadSourcePeer<THandle extends IThreadHandle>(
  options: IRuntimeThreadPeerOptions<THandle>
): Promise<IRuntimePeer> {
  /** The opaque Core operation performs the original early timeout admission exactly once. */
  const preparation = prepareAdapterPeer(options, RuntimePluginKey.thread)
  if (!options.spawn || typeof options.spawn !== 'object' || options.connect || options.listen)
    throw createAdapterSourceConfigurationError()
  /** The caller's source object is snapshotted before the original binding can start. */
  const source = options.spawn
  /** Local address is output from Core's original preparation rather than a peer claim. */
  const self = preparation.context.self
  /**
   * Wrapping launch preserves the original context, actual lease and caller-selected
   * implementation.
   */
  const binding = createThreadBinding({
    ...source,
    launcher: preparation.launcher(source.launcher)
  })
  return preparation.managed(
    {
      self,
      provide: options.provide,
      providerLimits: options.providerLimits,
      defaultTimeoutMs: options.defaultTimeoutMs,
      report: options.report,
      contract: options.contract,
      keyFactory: options.keyFactory ?? source.keyFactory,
      retryPort: options.retryPort ?? source.retryPort,
      endpointFactory: options.endpointFactory,
      callDeadlineCapMs: source.spec.limits?.callWallTimeMs
    },
    binding,
    binding.supervisor
  )
}
