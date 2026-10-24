import type { IUrlLike } from '@migaia/utils'
import {
  createThreadSupervisor,
  type IThreadHandle,
  type IThreadSupervisorOptions,
  type IThreadSpec
} from '@migaia/supervision/threads'
import type { IScheduler } from '@migaia/utils/scheduler'
import { createAdapterBindingDrain, createAdapterId } from '@migaia/rpc-host/plugin'
import type {
  IRemoteBinding,
  IRemoteRetryPort,
  IRemoteChannel,
  IRemoteServeEndpoint,
  IAdapterPeerPreparation
} from '@migaia/rpc-host/plugin'
import { invalidThreadConfig, portableThreadSpec } from './error.js'
import { ThreadErrorText } from './error-text.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { createAdapterTransportError, readAdapterAbortReason } from '@migaia/rpc-host/plugin'
import { type IRuntimePeerOptions, type IRuntimePeerSource } from '@migaia/rpc-host/plugin'
import type { IThreadChannelFactory } from './types.js'

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

/**
 * Open only native supervision/channel recipes; both assemblies retain this same sole lifecycle
 * owner.
 */
/**
 * Allocate one native thread source binding and its health/drain lookups before installing behavior
 * callbacks.
 */
function threadSourceBindingState<THandle extends IThreadHandle>(
  source: IRuntimeThreadSpawn<THandle>,
  prepareLauncher: IAdapterPeerPreparation['launcher'],
  connectTimeoutMs?: number
) {
  /** Snapshot binding inputs in the original order before constructing its lifecycle owners. */
  const sourceOptions = { ...source, launcher: prepareLauncher(source.launcher) }
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

  return {
    sourceOptions,
    spec,
    drain,
    defaultHealth,
    channels,
    readyEndpoints,
    source,
    prepareLauncher,
    connectTimeoutMs
  }
}

/**
 * Own one native thread source binding and its health/drain lookups; callbacks access only this
 * explicit instance.
 */
class ThreadSourceBinding<THandle extends IThreadHandle> {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof threadSourceBindingState<THandle>>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRemoteBinding<THandle, IThreadSpec> &
    Readonly<{
      bindEndpoint: ReturnType<typeof createAdapterBindingDrain>['wrap']
      drainCurrent: ReturnType<typeof createAdapterBindingDrain>['drainCurrent']
    }>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
    source: IRuntimeThreadSpawn<THandle>,
    prepareLauncher: IAdapterPeerPreparation['launcher'],
    connectTimeoutMs?: number
  ) {
    this.#state = threadSourceBindingState(source, prepareLauncher, connectTimeoutMs)
    /** The original prepared launcher preserves context, actual lease and caller-selected policy. */
    const supervisor = createThreadSupervisor({
      ...this.#state.sourceOptions.supervisor,
      id: this.#state.sourceOptions.supervisor?.id ?? createAdapterId(),
      launcher: this.#state.sourceOptions.launcher,
      spec: this.#state.spec,
      budget: this.#state.sourceOptions.budget,
      scheduler: this.#state.sourceOptions.scheduler,
      report: this.#state.sourceOptions.report,
      health:
        this.#state.sourceOptions.health ??
        (this.#state.defaultHealth
          ? {
              check: async (unit, signal) => {
                /**
                 * Startup remains governed by the original preparation deadline until binding
                 * completes.
                 */
                const ready = this.#state.readyEndpoints.get(unit)
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
        ...this.#state.sourceOptions.supervisor?.stop,
        beforeTerminate: async (unit, signal, remainingMs) => {
          await this.#state.drain.drainCurrent({ drainMs: remainingMs() })
          if (!signal.aborted)
            await this.#state.sourceOptions.supervisor?.stop?.beforeTerminate?.(
              unit,
              signal,
              remainingMs
            )
        }
      }
    })
    /** Runtime source owns the only Thread binding; remote still owns generation and retry. */
    const binding: ReturnType<typeof createThreadSourceBinding<THandle>> = {
      ownership: 'owned',
      bindEndpoint: (channel, endpoint, onExecution) => {
        if (this.#state.defaultHealth) {
          if (
            !channel.agreement.capabilities.includes(RpcCapability.ping) ||
            typeof endpoint.endpoint.ping !== 'function'
          )
            invalidThreadConfig('health', ThreadErrorText.healthPingUnavailable)
          this.#state.readyEndpoints.set(this.#state.channels.get(channel)!, { channel, endpoint })
        }
        return this.#state.drain.wrap(channel, endpoint, onExecution)
      },
      trackRequest: this.#state.drain.trackCurrent,
      drainCurrent: this.#state.drain.drainCurrent,
      supervisor,
      scheduler: this.#state.sourceOptions.scheduler,
      openChannel: (handle, signal) => {
        /** Existing observed-exit and custom-health paths retain the original factory Promise. */
        const opening =
          this.#state.connectTimeoutMs === undefined
            ? this.#state.sourceOptions.channelFactory.open(handle, signal)
            : this.#state.sourceOptions.channelFactory.open(
                handle,
                signal,
                this.#state.connectTimeoutMs
              )
        if (!this.#state.defaultHealth) return opening
        return opening.then((channel) => {
          this.#state.channels.set(channel, handle)
          return channel
        })
      }
    }
    this.value = binding
  }
}

/** Construct the single owner for one native thread source binding and its health/drain lookups. */
export function createThreadSourceBinding<THandle extends IThreadHandle>(
  source: IRuntimeThreadSpawn<THandle>,
  prepareLauncher: IAdapterPeerPreparation['launcher'],
  connectTimeoutMs?: number
): IRemoteBinding<THandle, IThreadSpec> &
  Readonly<{
    bindEndpoint: ReturnType<typeof createAdapterBindingDrain>['wrap']
    drainCurrent: ReturnType<typeof createAdapterBindingDrain>['drainCurrent']
  }> {
  return new ThreadSourceBinding<THandle>(source, prepareLauncher, connectTimeoutMs).value
}
