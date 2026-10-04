import {
  definePlugin,
  getPluginRuntimeIntegration,
  type IDefinedPluginConstraint,
  type IPluginRuntimeFeatureSnapshot
} from '@migaia/plugin-host'
import { defaultRpcId } from '../../core/internal/id.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { RpcCoreErrorCode, RpcError } from '../../core/errors.js'
import {
  createRuntimeOutlet,
  type IRuntimeOutlet,
  type IRuntimePluginConnection
} from './outlet.js'
import {
  RuntimeApiErrorText,
  RuntimePluginFamily,
  RuntimePluginKey,
  RuntimePluginExpose
} from './constants.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  type IRuntimePeerOptions,
  type IRuntimePeer,
  type IRuntimePeerMethod,
  type IRuntimePeerProvide,
  type IRuntimePeerSource
} from './peer.js'
import { createRemoteHostControl, type IRemoteHostControlOptions } from '../serve-host.js'
import { createRemoteLayerError } from '../error.js'
import { RpcRemoteLayerErrorCode } from '../error-code.js'
import { RemoteMethodName } from '../constants.js'
import { registerRuntimeControlMethods, type IRuntimeMethodEntry } from './catalog.js'
import { RuntimeApiMode } from './constants.js'
import { withRuntimePreparationContext } from './launch-context.js'
import { readManagedRuntimeRegistration } from './managed-peer.js'

/** Platform factories share this application contract while retaining their original source owner. */
export type IRuntimePluginOptions<
  TSpawn = IRuntimePeerSource,
  TConnect = IRuntimePeerSource,
  TListen = IRuntimePeerSource
> = Omit<IRuntimePeerOptions, 'provide' | 'spawn' | 'connect' | 'listen'> &
  Readonly<{
    spawn?: TSpawn
    connect?: TConnect
    listen?: TListen
    name: string
    expose?: readonly string[]
    /** Existing Host-control configuration is used only when host is explicitly exposed. */
    host?: IRemoteHostControlOptions['host']
    catalog?: IRemoteHostControlOptions['catalog']
    resolvePlugin?: IRemoteHostControlOptions['resolvePlugin']
  }>

/** A guarded cold closure retains the actual output and never substitutes a later same-name Feature. */
function exposedMethod(
  snapshot: IPluginRuntimeFeatureSnapshot,
  feature: string,
  receiver: object,
  method: (...args: unknown[]) => unknown
): IRuntimePeerMethod {
  return (payload, context) => {
    snapshot.assertCurrent(feature)
    return Reflect.apply(method, receiver, [payload, context])
  }
}

/** Compile only explicitly exposed real Feature methods, flattening away their local Feature name. */
function exposedProvide(
  expose: readonly string[],
  read: (name: string) => IPluginRuntimeFeatureSnapshot
): IRuntimePeerProvide {
  /** One group per Plugin gives the stable plugin.method public namespace. */
  const provide: Record<string, IRuntimePeerProvide> = Object.create(null)
  for (const name of expose) {
    /** Both connection permission and output identity come from the original managed Host. */
    const snapshot = read(name)
    /** Repeated method names across Features reject before any source or resource is acquired. */
    const group: Record<string, IRuntimePeerMethod> = Object.create(null)
    for (const [feature, output] of Object.entries(snapshot.outputs)) {
      /** Descriptor inspection never evaluates an application getter while building authority. */
      const descriptors = Object.getOwnPropertyDescriptors(output)
      for (const key of Reflect.ownKeys(descriptors)) {
        /** Symbol/accessor paths cannot silently enter the public callable directory. */
        const descriptor = descriptors[key as string]
        if (
          typeof key !== 'string' ||
          !descriptor ||
          !descriptor.enumerable ||
          !('value' in descriptor)
        )
          throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
        if (typeof descriptor.value !== 'function') continue
        if (Object.hasOwn(group, key))
          throw new RpcError(
            RpcCoreErrorCode.capabilityConflict,
            RuntimeApiErrorText.featureConflict
          )
        group[key] = exposedMethod(snapshot, feature, output, descriptor.value)
      }
    }
    provide[name] = Object.freeze(group)
  }
  return Object.freeze(provide)
}

/**
 * Install one true managed connection through the original install batch and resource scope. Its
 * shared slot remains unpublished until the same commit that publishes this registration.
 */
export function createRuntimePlugin<TSpawn, TConnect, TListen>(
  options: IRuntimePluginOptions<TSpawn, TConnect, TListen>,
  kind: keyof typeof RuntimePluginFamily,
  createPeer: (options: IRuntimePeerOptions) => Promise<IRuntimePeer> = createRuntimePeer
): IDefinedPluginConstraint<Record<string, never>, never, Record<string, never>> {
  /** Registration name is copied before installation; caller mutation cannot change publication. */
  const name = options.name
  if (typeof name !== 'string' || !name || !Object.hasOwn(RuntimePluginFamily, kind))
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.pluginNameInvalid)
  /** The whitelist is snapshotted before physical source effects, and defaults to empty. */
  const input = options.expose ?? []
  if (
    !Array.isArray(input) ||
    input.some((value) => typeof value !== 'string' || !value) ||
    new Set(input).size !== input.length
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.exposeInvalid)
  /** The immutable whitelist owns only names, never caller-owned objects or Host fields. */
  const expose = Object.freeze([...input])
  /** Platform source selection and safe identity continue through the same public Peer factory. */
  const peerOptions: IRuntimePeerOptions = Object.freeze({
    self: options.self,
    // Only the selected platform factory interprets its original deployment grammar.
    spawn: options.spawn as IRuntimePeerSource | undefined,
    connect: options.connect as IRuntimePeerSource | undefined,
    listen: options.listen as IRuntimePeerSource | undefined,
    providerLimits: options.providerLimits,
    contract: options.contract,
    keyFactory: options.keyFactory,
    retryPort: options.retryPort,
    report: options.report
  })
  return definePlugin({
    name,
    install: async (core) => {
      /** The actual core is the only provenance accepted by the original integration owner. */
      const integration = getPluginRuntimeIntegration(core)
      /** Validate Feature permissions and collisions before acquiring the physical source. */
      const provide = exposedProvide(
        expose.filter((target) => target !== RuntimePluginExpose.host),
        (target) => integration.readFeatureOutputs(target)
      )
      /**
       * One original Host-control owner remains shared across this registration's native
       * generations.
       */
      let controls: readonly IRuntimeMethodEntry[] | undefined
      if (expose.includes(RuntimePluginExpose.host)) {
        if (!options.host || !options.catalog || typeof options.resolvePlugin !== 'function')
          throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.hostControlInvalid)
        if (!integration.matchesHost(options.host))
          throw createRemoteLayerError(RpcRemoteLayerErrorCode.hostNotAdopted)
        /**
         * Resolver, install coalescing and adopter records remain in the original Host-control
         * owner.
         */
        const control = createRemoteHostControl({
          host: options.host,
          catalog: options.catalog,
          resolvePlugin: options.resolvePlugin,
          report: options.report
        })
        /**
         * Reserved scalar routes preserve original request/one-way registration, without stream
         * aliases.
         */
        controls = [
          [RemoteMethodName.hostUse, control.use],
          [RemoteMethodName.hostUnUse, control.unUse],
          [RemoteMethodName.hostInspect, control.inspect]
        ].map(([name, operation]) =>
          Object.freeze({
            name: name as string,
            receiver: control,
            supportedModes: Object.freeze([RuntimeApiMode.request, RuntimeApiMode.notify]),
            method: (payload: unknown) => {
              integration.assertCurrent()
              return (operation as (data: unknown) => unknown)(payload)
            }
          })
        )
        registerRuntimeControlMethods(provide, controls)
      }
      /** Later same-family installs reuse this facade while retaining separate endpoint owners. */
      const slot = integration.acquireSharedSlot<IRuntimeOutlet>(
        RuntimePluginKey[kind],
        RuntimePluginFamily[kind],
        createRuntimeOutlet
      )
      /**
       * Automatic bootstrap retains its trusted identity; explicit sources use the original id
       * owner.
       */
      const preparationOptions = {
        ...peerOptions,
        self:
          peerOptions.self ??
          (peerOptions.spawn || peerOptions.connect || peerOptions.listen
            ? Object.freeze({ name, instanceId: defaultRpcId() })
            : undefined),
        provide
      }
      /** Original scope owns native cleanup before any launcher or cold channel preparation. */
      const peer = await withRuntimePreparationContext(
        preparationOptions,
        {
          initialSignal: core.operation.signal,
          lifecycleSignal: core.lifecycle.signal,
          own: (dispose) => core.onDispose(dispose),
          readProvide: () => {
            /** Each generation captures exact current outputs; old providers keep their old guards. */
            const current = exposedProvide(
              expose.filter((target) => target !== RuntimePluginExpose.host),
              (target) => integration.readFeatureOutputs(target)
            )
            if (controls) registerRuntimeControlMethods(current, controls)
            return current
          }
        },
        () => createPeer(preparationOptions)
      )
      /** Managed native resources were already registered before startup; callbacks transfer here. */
      const registration = readManagedRuntimeRegistration(peer)
      try {
        if (!registration) core.onDispose(() => peer.close())
      } catch (error) {
        // A late prepared Peer belongs to this attempt even after the original Host scope closed.
        try {
          await peer.close()
        } catch (cleanup) {
          try {
            options.report(cleanup)
          } catch (reporterError) {
            hostRethrowReporter(reporterError, IpcReporterContext)
          }
        }
        throw error
      }
      /** Accepted remote metadata is read from the genuine Peer, without reflecting local describe. */
      /** Each actual prepared generation publishes an exact receipt through the canonical slot. */
      const publish = (prepared: IRuntimePeer, generation?: number): void => {
        const accepted = readRuntimePeerConnection(prepared)
        const connection: IRuntimePluginConnection = Object.freeze({
          name,
          instanceId: accepted.peerId,
          identity: accepted.description?.self,
          description: accepted.description,
          peer,
          report: accepted.report
        })
        const withdraw = slot.contribute(connection, connection.instanceId)
        if (registration && generation !== undefined)
          registration.events.onLeave(generation, withdraw)
      }
      publish(peer, registration?.events.current().generation)
      if (registration) core.onDispose(registration.onReady(publish))
      return {}
    }
  })
}
