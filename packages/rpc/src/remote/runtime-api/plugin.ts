import { runtimeUnavailable, runtimeErrorIdentity } from './overview.js'
import {
  definePlugin,
  PluginHostError,
  PluginHostErrorCode,
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
  readRuntimeOutletConnection,
  readRuntimeOutletEvents,
  type IRuntimeOutlet,
  type IRuntimePluginConnection
} from './outlet.js'
import {
  RuntimeApiErrorText,
  RuntimePluginFamily,
  RuntimePluginKey,
  RuntimePluginExpose,
  RuntimeEventName,
  RuntimeQueryClock,
  RuntimeQueryReason
} from './constants.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  readRuntimePeerSessions,
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
import {
  compileRuntimeMethods,
  registerRuntimePluginMethods,
  type IRuntimeForwardMethodEntry,
  type IRuntimeMethodEntry
} from './catalog.js'
import { RuntimeApiMode } from './constants.js'
import { withRuntimePreparationContext } from './launch-context.js'
import { readManagedRuntimeRegistration } from './managed-peer.js'
import { createProviderAdmissionScope } from '../../core/internal/provider-admission.js'
import { attachProviderPreflight } from '../../core/internal/provider.js'

/** A private extension uses the original atomic shared-slot owner across both adapter families. */
const providerAdmissionSlot = Symbol('runtime-provider-admission')

/** Platform factories share this application contract while retaining their original source owner. */
export type IRuntimePluginOptions<
  TSpawn = IRuntimePeerSource,
  TConnect = IRuntimePeerSource,
  TListen = IRuntimePeerSource
> = Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'> &
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

/** A cold method whitelist resolves current Feature availability through the original Host owner. */
function exposedMethod(
  snapshot: IPluginRuntimeFeatureSnapshot,
  feature: string,
  key: string
): IRuntimePeerMethod {
  /** Both whole-group admission and invocation consult the same live Host permission owner. */
  const current = () => {
    /** Replacement may change output identity; no physical generation preparation reads it. */
    const receiver = snapshot.readCurrent(feature)
    /** Only a current enumerable data method can satisfy the already compiled whitelist. */
    const descriptor = Object.getOwnPropertyDescriptor(receiver, key)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    )
      throw new RpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    return { receiver, method: descriptor.value }
  }
  return attachProviderPreflight(
    (payload, context) => {
      /** A lifecycle change after admission still obeys the original invocation-time guard. */
      const { receiver, method } = current()
      return Reflect.apply(method, receiver, [payload, context])
    },
    () => {
      current()
    }
  )
}

/** Compile only explicitly exposed real Feature methods, flattening away their local Feature name. */
function exposedProvide(
  expose: readonly string[],
  read: (name: string) => IPluginRuntimeFeatureSnapshot,
  resolve: (name: string) => IRuntimePluginConnection | undefined,
  forwards: Map<string, IRuntimeForwardMethodEntry>,
  nodeId: string
): IRuntimePeerProvide {
  /** One group per Plugin gives the stable plugin.method public namespace. */
  const provide: Record<string, IRuntimePeerProvide> = Object.create(null)
  /** Overlapping whole/single entries share one cold inventory and one callable per Feature path. */
  const snapshots = new Map<string, IPluginRuntimeFeatureSnapshot>()
  /** Same-name methods from different Features remain an actual ambiguity, rather than a union. */
  const owners = new Map<string, string>()
  for (const path of expose) {
    /** The first segment owns the Plugin; a local single-method entry selects the remaining name. */
    const separator = path.indexOf('.')
    /** A whole Plugin has no method selector; forwarding may later contain further remote segments. */
    const name = separator < 0 ? path : path.slice(0, separator)
    /** Local method spelling is checked against descriptors, never a mutable property lookup. */
    const selectedMethod = separator < 0 ? undefined : path.slice(separator + 1)
    /** A genuine ready connection contributes its accepted remote catalog, never Feature reflection. */
    const connection = resolve(name)
    if (connection) {
      /** An explicit miss is a configuration failure before acquiring the exposing source. */
      const methods =
        connection.description?.methods.filter(
          (entry) => selectedMethod === undefined || selectedMethod === entry.name
        ) ?? []
      if (selectedMethod !== undefined && methods.length === 0)
        throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
      for (const entry of methods) {
        /** A whole-plus-method union owns exactly one entry and retains no prepared Peer. */
        const fullName = `${name}.${entry.name}`
        forwards.set(
          fullName,
          Object.freeze({
            kind: 'forward',
            name: fullName,
            method: entry.name,
            forwardedVia: name,
            nodeId,
            supportedModes: entry.supportedModes,
            slot: () => {
              /** The receiving registration's original Feature guard still owns call admission. */
              try {
                read(name)
              } catch (cause) {
                /** An uninstalled connection is an unavailable target, retaining its Host cause. */
                if (
                  cause instanceof PluginHostError &&
                  cause.code === PluginHostErrorCode.pluginNotInstalled
                )
                  throw new RpcError(
                    RpcCoreErrorCode.targetUnknown,
                    RuntimeApiErrorText.targetUnknown,
                    cause
                  )
                throw cause
              }
              const current = resolve(name)
              if (!current)
                throw new RpcError(
                  RpcCoreErrorCode.targetUnknown,
                  RuntimeApiErrorText.targetUnknown
                )
              return current
            }
          })
        )
      }
      continue
    }
    /** Both connection permission and output identity come from the original managed Host. */
    const snapshot = snapshots.get(name) ?? read(name)
    snapshots.set(name, snapshot)
    /** Repeated method names across Features reject before any source or resource is acquired. */
    const group = (provide[name] ?? Object.create(null)) as Record<string, IRuntimePeerMethod>
    /** An explicit missing method rejects configuration rather than silently reducing the whitelist. */
    let found = selectedMethod === undefined
    for (const [feature, output] of Object.entries(snapshot.outputs)) {
      /** Descriptor inspection never evaluates an application getter while building authority. */
      const descriptors = Object.getOwnPropertyDescriptors(output)
      for (const key of Reflect.ownKeys(descriptors)) {
        if (selectedMethod !== undefined && key !== selectedMethod) continue
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
        /** A same-Feature overlap is a union; a distinct Feature remains an ambiguous public method. */
        const fullName = `${name}.${key}`
        if (owners.has(fullName) && owners.get(fullName) !== feature)
          throw new RpcError(
            RpcCoreErrorCode.capabilityConflict,
            RuntimeApiErrorText.featureConflict
          )
        found = true
        if (!Object.hasOwn(group, key)) group[key] = exposedMethod(snapshot, feature, key)
        owners.set(fullName, feature)
      }
    }
    if (!found)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
    provide[name] = group
  }
  for (const group of Object.values(provide)) Object.freeze(group)
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
  /** Own methods share the Peer descriptor builder and compile before source effects. */
  const ownMethods = compileRuntimeMethods(options.provide)
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
    endpointFactory: options.endpointFactory,
    report: options.report
  })
  return definePlugin({
    name,
    install: async (core) => {
      /** The actual core is the only provenance accepted by the original integration owner. */
      const integration = getPluginRuntimeIntegration(core)
      /**
       * Original committed slot indexes select a connection across the two physical adapter
       * families.
       */
      const resolve = (target: string): IRuntimePluginConnection | undefined => {
        for (const key of Object.values(RuntimePluginKey)) {
          const current = readRuntimeOutletConnection(integration.readSharedExtension(key), target)
          if (current === null)
            throw new RpcError(
              RpcCoreErrorCode.capabilityConflict,
              RuntimeApiErrorText.targetAmbiguous
            )
          if (current) return current
        }
        return undefined
      }
      /** This cold union compiles into the existing method table and owns no live connection state. */
      const forwards = new Map<string, IRuntimeForwardMethodEntry>()
      /** Validate Feature permissions and collisions before acquiring the physical source. */
      const provide = exposedProvide(
        expose.filter((target) => target !== RuntimePluginExpose.host),
        (target) => integration.readFeatureOutputs(target),
        resolve,
        forwards,
        integration.nodeId
      )
      /** Reserved Host operations are additional canonical entries, not an authority bypass. */
      let controls: readonly IRuntimeMethodEntry[] = []
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
            reserved: true,
            supportedModes: Object.freeze([RuntimeApiMode.request, RuntimeApiMode.notify]),
            method: (payload: unknown) => {
              integration.assertCurrent()
              return (operation as (data: unknown) => unknown)(payload)
            }
          })
        )
      }
      registerRuntimePluginMethods(provide, [...ownMethods, ...controls, ...forwards.values()])
      /** Later same-family installs reuse this facade while retaining separate endpoint owners. */
      const slot = integration.acquireSharedSlot<IRuntimeOutlet>(
        RuntimePluginKey[kind],
        RuntimePluginFamily[kind],
        (shared) =>
          createRuntimeOutlet(
            shared,
            Object.freeze({ name: integration.identity.name, instanceId: integration.identity.id }),
            kind
          )
      )
      /** This private cold reference owns no connections, callable catalog or additional quota map. */
      const admission = integration.acquireSharedSlot(
        providerAdmissionSlot,
        RuntimePluginFamily,
        createProviderAdmissionScope
      )
      /**
       * Policy metadata belongs to this original reservation, so failed candidates never publish
       * it.
       */
      const admissionPolicy: { maxGlobal?: number; maxPerPeer?: number } = {}
      admission.register(admissionPolicy, () =>
        admission.facade.constrain(admissionPolicy.maxGlobal, admissionPolicy.maxPerPeer)
      )
      /**
       * Cold source preparation reads the actual original commit index rather than a readiness
       * flag.
       */
      const providerAdmission = Object.freeze({
        prepare: (
          maxGlobal: number | undefined,
          maxPerPeer: number | undefined,
          maxIngress: number | undefined
        ) => {
          if (maxGlobal !== undefined)
            admissionPolicy.maxGlobal = Math.min(admissionPolicy.maxGlobal ?? maxGlobal, maxGlobal)
          if (maxPerPeer !== undefined)
            admissionPolicy.maxPerPeer = Math.min(
              admissionPolicy.maxPerPeer ?? maxPerPeer,
              maxPerPeer
            )
          return admission.facade.prepare(
            maxGlobal,
            maxPerPeer,
            maxIngress,
            admission.registered().includes(admissionPolicy)
          )
        }
      })
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
      /** Each genuine prepared session contributes one exact receipt through this original slot. */
      /** Actual listener commits can publish ready after this registration becomes visible. */
      let publishReady: ((prepared: IRuntimePeer, generation?: number) => void) | undefined
      const publishPeer = (
        prepared: IRuntimePeer,
        routedPeer: IRuntimePeer = prepared,
        generation?: number
      ): (() => void) => {
        const accepted = readRuntimePeerConnection(prepared)
        const connection: IRuntimePluginConnection = Object.freeze({
          name,
          instanceId: accepted.peerId,
          identity: accepted.description?.self,
          description: accepted.description,
          peer: routedPeer,
          report: accepted.report
        })
        const withdraw = slot.contribute(connection, connection.instanceId)
        publishReady?.(prepared, generation)
        return withdraw
      }
      /** Original scope owns native cleanup before any launcher or cold channel preparation. */
      const peer = await withRuntimePreparationContext(
        preparationOptions,
        {
          selfDefaulted: peerOptions.self === undefined,
          nodeId: integration.nodeId,
          providerAdmission,
          initialSignal: core.operation.signal,
          lifecycleSignal: core.lifecycle.signal,
          own: (dispose) => core.onDispose(dispose),
          // Native preparation owns the frozen whitelist; business availability is checked on calls.
          readProvide: () => provide,
          publishPeer
        },
        () => createPeer(preparationOptions)
      )
      /** Managed native resources were already registered before startup; callbacks transfer here. */
      const registration = readManagedRuntimeRegistration(peer)
      /** Listener provenance denotes original early scope ownership, even with no ready sessions. */
      const listenerSource = readRuntimePeerSessions(peer) !== undefined
      try {
        if (!registration && !listenerSource) core.onDispose(() => peer.close())
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
      /** Metadata and event lifetime remain scoped to this original committed reservation. */
      const record = Object.freeze({
        name,
        peer,
        execution: registration?.execution,
        instanceIds: (): readonly string[] =>
          registration
            ? registration.runtimeInstanceIds()
            : (readRuntimePeerSessions(peer) ?? [peer]).map(
                (current) => readRuntimePeerConnection(current).peerId
              )
      })
      /** The same actual shared facade owns every passive listener and watch. */
      const events = readRuntimeOutletEvents(slot.facade)
      /** Initial accepted readiness is published only after its original Host reservation commits. */
      const ready = (prepared: IRuntimePeer, generation?: number): void => {
        if (!slot.registered().includes(record)) return
        const accepted = readRuntimePeerConnection(prepared)
        events.publish(
          Object.freeze({
            type: RuntimeEventName.ready,
            name,
            instanceId: accepted.peerId,
            generation: generation ?? runtimeUnavailable(RuntimeQueryReason.owner),
            timestamp: accepted.channel.scheduler.now(),
            clock: RuntimeQueryClock.scheduler
          }),
          accepted.report
        )
      }
      publishReady = ready
      slot.register(record, () => {
        if (listenerSource) {
          for (const session of readRuntimePeerSessions(peer)!) ready(session)
        } else if (!registration || registration.events.current().active)
          ready(peer, registration?.events.current().generation)
      })
      /** Logical owner close settles idle watch reads even if no native exit can be observed. */
      const closeEvents = (): void => {
        if (slot.registered().length === 0) events.close()
      }
      core.lifecycle.signal.addEventListener('abort', closeEvents, { once: true })
      core.onDispose(() => core.lifecycle.signal.removeEventListener('abort', closeEvents))
      if (registration)
        core.onDispose(
          registration.supervisor.subscribe((event) => {
            if (!slot.registered().includes(record)) return
            if (
              event.type !== RuntimeEventName.exit &&
              event.type !== RuntimeEventName.restart &&
              event.type !== RuntimeEventName.degraded
            )
              return
            events.publish(
              Object.freeze({
                type: event.type,
                name,
                generation: event.generation,
                instanceId: registration.runtimeInstanceId(event.generation),
                timestamp: event.observedAt ?? runtimeUnavailable(RuntimeQueryReason.owner),
                clock: RuntimeQueryClock.scheduler,
                ...(event.type === RuntimeEventName.exit
                  ? {
                      reason: event.reason,
                      code: event.status?.code ?? runtimeUnavailable(RuntimeQueryReason.native),
                      signal: event.status?.signal ?? runtimeUnavailable(RuntimeQueryReason.native),
                      ...(event.error === undefined
                        ? {}
                        : { error: runtimeErrorIdentity(event.error, options.report) })
                    }
                  : event.type === RuntimeEventName.restart
                    ? { count: event.count }
                    : { degraded: Object.freeze([...event.degraded]) })
              }),
              options.report
            )
          })
        )
      /** Accepted remote metadata is read from the genuine Peer, without reflecting local describe. */
      /** Each actual prepared generation publishes an exact receipt through the canonical slot. */
      const publish = (prepared: IRuntimePeer, generation?: number): void => {
        const withdraw = publishPeer(prepared, peer, generation)
        if (registration && generation !== undefined)
          registration.events.onLeave(generation, withdraw)
      }
      if (!listenerSource) publish(peer, registration?.events.current().generation)
      if (registration) core.onDispose(registration.onReady(publish))
      return {}
    }
  })
}
