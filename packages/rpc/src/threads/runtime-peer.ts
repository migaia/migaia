import type { IThreadHandle } from '@migaia/supervision/threads'
import { defaultRpcId } from '../core/internal/id.js'
import { RpcError, RpcCoreErrorCode } from '../core/errors.js'
import {
  RuntimeApiErrorText,
  RuntimePluginKey,
  RuntimeSourceKind,
  RuntimeConnectionDirection
} from '../remote/runtime-api/constants.js'
import { createManagedRuntimePeer } from '../remote/runtime-api/managed-peer.js'
import {
  prepareRuntimePeerSourceContext,
  type IRuntimePeerOptions,
  type IRuntimePeerSource
} from '../remote/runtime-api/peer.js'
import {
  withRuntimeLaunchContext,
  readRuntimePreparationContext
} from '../remote/runtime-api/launch-context.js'
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
) {
  if (!options.spawn || typeof options.spawn !== 'object' || options.connect || options.listen)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  /** The caller's source object is snapshotted before the original binding can start. */
  const source = options.spawn
  /** This local identity cannot be supplied by the remote child or its business directory. */
  const self = options.self ?? { name: RuntimePluginKey.thread, instanceId: defaultRpcId() }
  /**
   * The exact compiled offer is passed through private launch metadata, never a platform field in
   * core.
   */
  const context = prepareRuntimePeerSourceContext(self)
  /**
   * Wrapping launch preserves the original context, actual lease and caller-selected
   * implementation.
   */
  const binding = createThreadBinding({
    ...source,
    launcher: {
      ...source.launcher,
      launch: (spec, request) =>
        withRuntimeLaunchContext(request, context, () => source.launcher.launch(spec, request))
    }
  })
  return createManagedRuntimePeer(
    {
      self,
      provide: options.provide,
      providerLimits: options.providerLimits,
      report: options.report,
      contract: options.contract,
      keyFactory: options.keyFactory ?? source.keyFactory,
      retryPort: options.retryPort ?? source.retryPort,
      endpointFactory: options.endpointFactory,
      callDeadlineCapMs: source.spec.limits?.callWallTimeMs
    },
    binding,
    undefined,
    readRuntimePreparationContext(options),
    undefined,
    { kind: RuntimeSourceKind.spawn, direction: RuntimeConnectionDirection.spawned }
  )
}
