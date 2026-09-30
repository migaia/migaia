import type { IRpcPortableValue } from '../contract/types.js'
import { RemoteMethodName } from './constants.js'
import { normalizeRemoteHostCatalog, type IRemoteHostCatalog } from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { createRemoteGenerationHolder, createRemoteRegistration } from './proxy.js'
import type { IRemoteProxyOptions } from './types.js'

/** Host control permits only policies whose effects can be reflected in inspect. */
export type IRemoteHostRemovalOptions = Readonly<{
  policy?: 'reject' | 'suspend'
  dryRun?: boolean
}>

/** One remote Host connection shares the plugin proxy generation and ready gate. */
export type IRemoteHostHandle = Readonly<{
  ready(): Promise<void>
  use(
    name: string,
    config?: IRpcPortableValue
  ): Promise<Readonly<Record<string, Readonly<Record<string, (...args: unknown[]) => unknown>>>>>
  unUse(name: string, options?: IRemoteHostRemovalOptions): Promise<IRpcPortableValue>
  inspect(): Promise<IRpcPortableValue>
  release(): Promise<void>
}>

/** A Host catalog selects the same channel, endpoint, and retry ports as Plugin mode. */
export type IRemoteHostOptions<TUnit, TSpec> = Omit<IRemoteProxyOptions<TUnit, TSpec>, 'contract'> &
  Readonly<{ catalog: IRemoteHostCatalog }>

/** Creates a remote Host whose control frames never carry plugin definitions. */
export function createRemoteHost<TUnit, TSpec>(
  options: IRemoteHostOptions<TUnit, TSpec>
): IRemoteHostHandle {
  const catalog = normalizeRemoteHostCatalog(options.catalog)
  const registration = createRemoteRegistration({ ...options, contract: catalog }, 'host')
  const holder = createRemoteGenerationHolder(registration, options.report)
  /** One abort signal belongs to this Host handle's initial preparation and replacements. */
  const lifecycle = new AbortController()
  /** The last described generation determines the next ready promise's threshold. */
  let lastReadyGeneration = 0
  /** Initial preparation runs at most once, even if first operation is use. */
  let initialPromise: Promise<void> | undefined
  /** Ready promise is stable within one active or unavailable generation. */
  let readyPromise: Promise<void> | undefined
  /** Rebind work is serialized across supervisor state observations. */
  let rebinding = false
  /** Release settles once and prevents later channel publication. */
  let releasePromise: Promise<void> | undefined
  const scheduleRebind = (): void => {
    if (releasePromise || rebinding || registration.events.current().active) return
    if (options.binding.supervisor.state !== 'ready') return
    rebinding = true
    void holder
      .prepareRebind(lifecycle.signal)
      .then((generation) => {
        lastReadyGeneration = generation
      })
      .catch(options.report)
      .finally(() => {
        rebinding = false
      })
  }
  const unsubscribe = options.binding.supervisor.subscribe((event) => {
    if (event.type === 'exit' || event.type === 'switched') {
      readyPromise = undefined
      scheduleRebind()
    }
    if (event.type === 'state' && event.to === 'ready') scheduleRebind()
  })
  const ensureInitial = (): Promise<void> =>
    (initialPromise ??= holder.prepareInitial(lifecycle.signal).then((generation) => {
      lastReadyGeneration = generation
    }))
  const ready = (): Promise<void> => {
    if (releasePromise)
      return Promise.reject(createRemoteLayerError(RpcRemoteLayerErrorCode.closed))
    if (readyPromise) return readyPromise
    readyPromise = !initialPromise
      ? ensureInitial()
      : registration.events.current().active
        ? Promise.resolve()
        : registration.events.whenReady(lastReadyGeneration).then(() => undefined)
    return readyPromise
  }
  return Object.freeze({
    ready,
    use: async (name: string, config?: IRpcPortableValue) => {
      await ensureInitial()
      const params = config === undefined ? [name] : [name, config]
      await registration.invokeControl(
        RemoteMethodName.hostUse,
        params,
        'hostUseParams',
        'hostUseResult'
      )
      return registration.featureProxies(name)
    },
    unUse: async (name: string, removal?: IRemoteHostRemovalOptions) => {
      await ensureInitial()
      return registration.invokeControl(
        RemoteMethodName.hostUnUse,
        removal === undefined ? [name] : [name, removal],
        'hostUnUseParams',
        'hostUnUseResult'
      )
    },
    inspect: async () => {
      await ensureInitial()
      return registration.invokeControl(
        RemoteMethodName.hostInspect,
        [],
        'hostInspectParams',
        'hostInspectResult'
      )
    },
    release: () => {
      if (releasePromise) return releasePromise
      lifecycle.abort()
      unsubscribe()
      releasePromise = holder.release()
      return releasePromise
    }
  })
}
