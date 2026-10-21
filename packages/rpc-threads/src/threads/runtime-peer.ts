import type { IUrlLike } from '@migaia/utils'
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
import type {
  IRemoteBinding,
  IRemoteRetryPort,
  IRemoteChannel,
  IRemoteServeEndpoint
} from '@migaia/rpc-core/remote'
import { invalidThreadConfig, portableThreadSpec } from './error.js'
import { ThreadErrorText } from './error-text.js'
import { RpcCapability } from '@migaia/rpc-contract'
import {
  createAdapterTransportError,
  readAdapterAbortReason
} from '@migaia/rpc-core/adapter/internal-advanced'
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
  /** Complete Worker specification; portable data is admitted before supervisor/native construction. */
  spec: IThreadSpec
  /** Caller-selected execution owner and its actual capability guarantees. */
  launcher: IThreadSupervisorOptions<THandle>['launcher']
  /** Borrowed simultaneous-Worker budget; actual exit, not merely terminate(), releases a lease. */
  budget: IThreadSupervisorOptions<THandle>['budget']
  /** Required clock shared by supervision, drain, and the channel factory. */
  scheduler: IScheduler
  /** Open the original handle's channel; do not install a competing native message reader. */
  channelFactory: IThreadChannelFactory<THandle>
  /** Required diagnostic sink for this source; top-level Peer report may override call reporting. */
  report(error: unknown): void
  /** Custom health policy; omission adds ping only when native exit observation is not enforced. */
  health?: IThreadSupervisorOptions<THandle>['health']
  /** Optional supervisor policy; full sources retain supervision's required isolation default. */
  supervisor?: Partial<
    Pick<
      IThreadSupervisorOptions<THandle>,
      'id' | 'ready' | 'startupTimeoutMs' | 'restart' | 'terminalPolicy' | 'stop' | 'isolation'
    >
  >
  /** Optional remote idempotency-key factory; top-level Peer keyFactory takes precedence. */
  keyFactory?: () => string
  /** Optional Core retry owner; top-level Peer retryPort takes precedence. */
  retryPort?: IRemoteRetryPort
}>

/** Entry-only deployment fills the existing source's launcher, budget and channel defaults. */
export type IRuntimeThreadShortSpawn<THandle extends IThreadHandle = IThreadHandle> = Readonly<{
  /** True reexecutes the real main entry; URLs are exact and relative paths use the main entry/base. */
  entry: true | IUrlLike
  /** Explicit module URL or URL string changes only relative entry resolution. */
  base?: IUrlLike
  /** Optional Worker name; omission leaves the native name unset and uses a launch fingerprint. */
  name?: IThreadSpec['name']
  /** Optional portable initialization data, normalized before native Worker construction. */
  data?: IThreadSpec['data']
  /** Optional heap/call limits; enforcement remains subject to the selected launcher's capabilities. */
  limits?: IThreadSpec['limits']
}> &
  Partial<Omit<IRuntimeThreadSpawn<THandle>, 'spec'>>

/**
 * Choose an owned spawn or an existing Core connect/listen callback; library-launched children may
 * omit the source for automatic bootstrap discovery. Short spawn selects a one-Worker budget,
 * systemScheduler and best-effort isolation. Full sources supply their own required dependencies.
 * Core retains provide/authentication/deadline and source-exclusivity admission.
 */
export type IRuntimeThreadPeerOptions<THandle extends IThreadHandle = IThreadHandle> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'report'
> &
  Readonly<{
    /** Optional diagnostics sink; ordinary root construction defaults to Core's defaultRpcReporter. */
    report?: (error: unknown) => void
    /** Owned Worker source: callback, full deployment, short object, true, or an entry URL/path. */
    spawn?:
      | IRuntimePeerSource
      | IRuntimeThreadSpawn<THandle>
      | IRuntimeThreadShortSpawn<THandle>
      | true
      | IUrlLike
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
  /** Only units lacking enforced exit observation need the default RPC liveness probe. */
  const defaultHealth =
    sourceOptions.health === undefined &&
    sourceOptions.launcher.capabilities['exit-observation'] !== 'enforced'
  /** The actual opened channel identifies its exact supervisor handle across replacement. */
  const channels = new WeakMap<IRemoteChannel, THandle>()
  /** A health check uses only the genuine endpoint installed for the same admitted handle. */
  const readyEndpoints = new WeakMap<
    THandle,
    Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }>
  >()
  /** The original prepared launcher preserves context, actual lease and caller-selected policy. */
  const supervisor = createThreadSupervisor({
    ...sourceOptions.supervisor,
    id: sourceOptions.supervisor?.id ?? createAdapterId(),
    launcher: sourceOptions.launcher,
    spec,
    budget: sourceOptions.budget,
    scheduler: sourceOptions.scheduler,
    report: sourceOptions.report,
    health:
      sourceOptions.health ??
      (defaultHealth
        ? {
            async check(unit, signal) {
              /**
               * Startup remains governed by the original preparation deadline until binding
               * completes.
               */
              const ready = readyEndpoints.get(unit)
              if (!ready) return
              if (
                await ready.endpoint.endpoint.ping(ready.channel.peerId, undefined, {
                  timeoutMs: false,
                  signal
                })
              )
                return
              if (signal.aborted) throw readAdapterAbortReason(signal)
              throw createAdapterTransportError(ThreadErrorText.healthPingFailed)
            }
          }
        : undefined),
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
    bindEndpoint(channel, endpoint) {
      if (defaultHealth) {
        if (
          !channel.agreement.capabilities.includes(RpcCapability.ping) ||
          typeof endpoint.endpoint.ping !== 'function'
        )
          invalidThreadConfig('health', ThreadErrorText.healthPingUnavailable)
        readyEndpoints.set(channels.get(channel)!, { channel, endpoint })
      }
      return drain.wrap(channel, endpoint)
    },
    trackRequest: drain.trackCurrent,
    drainCurrent: drain.drainCurrent,
    supervisor,
    scheduler: sourceOptions.scheduler,
    openChannel(handle, signal) {
      /** Existing observed-exit and custom-health paths retain the original factory Promise. */
      const opening = sourceOptions.channelFactory.open(handle, signal)
      if (!defaultHealth) return opening
      return opening.then((channel) => {
        channels.set(channel, handle)
        return channel
      })
    }
  }
  return captured.managed(
    {
      self,
      provide: options.provide,
      probe: options.probe,
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
