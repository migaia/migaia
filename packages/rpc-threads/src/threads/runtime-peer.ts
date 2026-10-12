import {
  createThreadSupervisor,
  type IThreadHandle,
  type IThreadSupervisorOptions,
  type IThreadSpec
} from '@migaia/supervision/threads'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  createAdapterBindingDrain,
  createAdapterId
} from '@migaia/rpc-core/adapter/internal-advanced'
import type { IRemoteBinding, IRemoteRetryPort } from '@migaia/rpc-core/remote'
import { portableThreadSpec } from './error.js'
import { createAdapterSourceConfigurationError } from '@migaia/rpc-core/adapter/internal-advanced'
import {
  type IRuntimePeerOptions,
  type IRuntimePeer,
  type IRuntimePeerSource
} from '@migaia/rpc-core/remote'
import type { IThreadChannelFactory } from './types.js'
import { captureThreadTask, type IThreadAdapterTask } from './adapter.js'

/** Existing thread deployment owns its original supervisor, budget, launcher and channel factory. */
export type IRuntimeThreadSpawn<THandle extends IThreadHandle = IThreadHandle> = Readonly<{
  spec: IThreadSpec
  launcher: IThreadSupervisorOptions<THandle>['launcher']
  budget: IThreadSupervisorOptions<THandle>['budget']
  scheduler: IScheduler
  channelFactory: IThreadChannelFactory<THandle>
  report(error: unknown): void
  health?: IThreadSupervisorOptions<THandle>['health']
  supervisor?: Partial<
    Pick<
      IThreadSupervisorOptions<THandle>,
      'id' | 'ready' | 'startupTimeoutMs' | 'restart' | 'terminalPolicy' | 'stop' | 'isolation'
    >
  >
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
}>

/** Entry-only deployment fills the existing source's launcher, budget and channel defaults. */
export type IRuntimeThreadShortSpawn<THandle extends IThreadHandle = IThreadHandle> = Readonly<{
  entry: true | string | URL
  /** Explicit module URL or URL string changes only relative entry resolution. */
  base?: string | URL
  name?: IThreadSpec['name']
  data?: IThreadSpec['data']
  limits?: IThreadSpec['limits']
}> &
  Partial<Omit<IRuntimeThreadSpawn<THandle>, 'spec'>>

/**
 * Source callbacks remain only for the serial migration; deployed sources use original platform
 * specs.
 */
export type IRuntimeThreadPeerOptions<THandle extends IThreadHandle = IThreadHandle> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'report'
> &
  Readonly<{
    report?: (error: unknown) => void
    spawn?:
      | IRuntimePeerSource
      | IRuntimeThreadSpawn<THandle>
      | IRuntimeThreadShortSpawn<THandle>
      | true
      | string
      | URL
  }>

/** Construct real owned execution through the same binding and remote generation owner. */
export function createThreadSourcePeer<THandle extends IThreadHandle>(
  options: IRuntimeThreadPeerOptions<THandle>,
  expanded?: IRuntimeThreadSpawn<THandle>,
  task?: IThreadAdapterTask
): Promise<IRuntimePeer> {
  /** The opaque Core operation performs the original early timeout admission exactly once. */
  const captured = task ?? captureThreadTask(options)
  /** Native bindings share the SDK task's sole original Host preparation. */
  const preparation = captured.preparation
  if (
    (!expanded && (!options.spawn || typeof options.spawn !== 'object')) ||
    options.connect ||
    options.listen
  )
    throw createAdapterSourceConfigurationError()
  /** Original source reads remain the managed options fallback after binding selection. */
  const source = expanded ?? (options.spawn as IRuntimeThreadSpawn<THandle>)
  /** Local address is output from Core's original preparation rather than a peer claim. */
  const self = preparation.context.self
  /** Snapshot binding inputs in the original order before constructing its lifecycle owners. */
  const sourceOptions = { ...source, launcher: preparation.launcher(source.launcher) }
  /** Portable admission precedes construction of the canonical lifecycle owner. */
  const spec = portableThreadSpec(sourceOptions.spec)
  /** Business drain and native stop retain the original endpoint and request ownership. */
  const drain = createAdapterBindingDrain(sourceOptions.scheduler, sourceOptions.report)
  /** The original prepared launcher preserves context, actual lease and caller-selected policy. */
  const supervisor = createThreadSupervisor({
    ...sourceOptions.supervisor,
    id: sourceOptions.supervisor?.id ?? createAdapterId(),
    launcher: sourceOptions.launcher,
    spec,
    budget: sourceOptions.budget,
    scheduler: sourceOptions.scheduler,
    report: sourceOptions.report,
    health: sourceOptions.health,
    stop: {
      ...sourceOptions.supervisor?.stop,
      beforeTerminate: async (unit, signal, remainingMs) => {
        await drain.drainCurrent({ drainMs: remainingMs() })
        if (!signal.aborted)
          await sourceOptions.supervisor?.stop?.beforeTerminate?.(unit, signal, remainingMs)
      }
    }
  })
  /** Runtime source owns the only Thread binding; remote still owns generation and retry. */
  const binding: IRemoteBinding<THandle, IThreadSpec> &
    Readonly<{ bindEndpoint: typeof drain.wrap; drainCurrent: typeof drain.drainCurrent }> = {
    ownership: 'owned',
    bindEndpoint: drain.wrap,
    trackRequest: drain.trackCurrent,
    drainCurrent: drain.drainCurrent,
    supervisor,
    scheduler: sourceOptions.scheduler,
    openChannel: (handle, signal) => sourceOptions.channelFactory.open(handle, signal)
  }
  return captured.managed(
    {
      self,
      provide: options.provide,
      providerLimits: options.providerLimits,
      defaultTimeoutMs: options.defaultTimeoutMs,
      report: options.report ?? source.report,
      contract: options.contract,
      keyFactory: options.keyFactory ?? source.keyFactory,
      retryPort: options.retryPort ?? source.retryPort,
      endpointFactory: options.endpointFactory,
      authentication: options.authentication,
      callDeadlineCapMs: source.spec.limits?.callWallTimeMs
    },
    binding,
    binding.supervisor
  )
}
