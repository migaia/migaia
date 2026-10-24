import { getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import { createRpcError } from '../core/errors.js'
import { RpcCoreErrorCode } from '../core/error-code.js'
import { defaultRpcReporter } from '../core/default-reporter.js'
import { createRuntimeHost } from './runtime.js'
import { readOrdinaryRpcFeatures } from './install-port.js'
import { HostErrorText } from './error-text.js'
import type { IRpcTransportPluginDefinition } from '../plugin/types.js'
import type { IRpcHostOptions } from './types.js'
import { readAdapterDeployment } from '../runtime-adapter/deployment.js'
import {
  createCommitGate,
  exposedProvide,
  acquireRuntimeProviderAdmission,
  resolveRuntimePluginConnection
} from '../remote/runtime-api/plugin.js'
import {
  compileRuntimeMethods,
  registerRuntimePluginMethods,
  type IRuntimeForwardMethodEntry
} from '../remote/runtime-api/catalog.js'
import {
  createRuntimeOutlet,
  readRuntimeOutletEvents,
  type IRuntimeOutlet,
  type IRuntimePluginConnection,
  type IRuntimePluginRegistration
} from '../remote/runtime-api/outlet.js'
import { RuntimePluginKey } from '../remote/runtime-api/constants.js'
import { runtimeReadyEvent, runtimeSupervisorEvent } from '../remote/runtime-api/events.js'
import {
  readManagedRuntimeHolder,
  readManagedRuntimeReplacement
} from '../remote/runtime-api/managed-peer.js'
import type { IRuntimePeer } from '../remote/runtime-api/peer.js'
import { withRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'

/** Native package writers without a specialized family share the one ordinary RPC outlet family. */
const ordinaryRuntimeFamily = Object.freeze({})

/**
 * Install into the original native Host reservation, preserving its slot and replacement
 * transaction.
 */
/** Own one ordinary native transport installation through its actual shared-slot transaction. */
class OrdinaryRpcTransportInstallation {
  /** The genuine installation core remains the sole native lifecycle/mutation authority. */
  #core: IPluginHostCore
  /** The cold definition retains original exposure and native source policy. */
  #definition: IRpcTransportPluginDefinition
  /** Host integration owns shared slots, output guards and the native node identity. */
  #integration: ReturnType<typeof getPluginRuntimeIntegration>
  /** Only the original privately registered deployment may acquire a physical source. */
  #deployment: NonNullable<ReturnType<typeof readAdapterDeployment>>
  /** Pending/committed publication and replacement remain owned by the native Host slot. */
  #slot: import('@migaia/plugin-host').IPluginRuntimeSharedSlot<IRuntimeOutlet>
  /** Exposed Feature calls wait on this original installation's commit boundary. */
  #gate: ReturnType<typeof createCommitGate>
  /** Original compiled methods retain their native output guards and forwarding entries. */
  #provide: ReturnType<typeof exposedProvide>
  /** Exactly registered Features are read before the native source observes configuration. */
  #features: ReturnType<typeof readOrdinaryRpcFeatures>
  /** One actual runtime configuration retains its private preparation provenance. */
  #options: IRpcHostOptions
  /** The existing shared outlet alone owns lifecycle subscriptions. */
  #events: ReturnType<typeof readRuntimeOutletEvents>
  /** A pending reservation cannot publish ready events before its native registration commits. */
  #record: IRuntimePluginRegistration | undefined
  /** Only a genuinely managed prepared Peer lends original execution/generation commands. */
  #managedPeer: IRuntimePeer | undefined
  /** One actual Host endpoint owns the installed native sources and final resource close. */
  #runtime: ReturnType<typeof createRuntimeHost>
  /** The original managed registration is selected once after genuine startup readiness. */
  #registration: import('../remote/proxy.js').IRemoteRuntimeRegistration | undefined

  /** Admit genuine Host/deployment ports and capture cold configuration before native startup. */
  constructor(core: IPluginHostCore, definition: IRpcTransportPluginDefinition) {
    this.#core = core
    this.#definition = definition
    this.#integration = getPluginRuntimeIntegration(this.#core)
    /** Admission checks the original token before retaining a usable deployment. */
    const deployment = readAdapterDeployment(this.#definition.deployment)
    if (!deployment)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, HostErrorText.deploymentInvalid)
    this.#deployment = deployment
    const key = this.#deployment.runtimeKey ?? RuntimePluginKey.process
    this.#slot = this.#integration.acquireSharedSlot<IRuntimeOutlet>(
      key,
      this.#deployment.runtimeFamily ?? ordinaryRuntimeFamily,
      (shared) =>
        createRuntimeOutlet(
          shared,
          {
            name: this.#integration.identity.name,
            instanceId: this.#integration.identity.id
          },
          key
        )
    )
    this.#gate = createCommitGate(this.#core.lifecycle.signal)
    const forwards = new Map<string, IRuntimeForwardMethodEntry>()
    this.#provide = exposedProvide(
      this.#definition.expose ?? [],
      (name) => this.#integration.readFeatureOutputs(name),
      (target) => resolveRuntimePluginConnection(this.#integration, target),
      forwards,
      this.#integration.nodeId,
      this.#gate
    )
    registerRuntimePluginMethods(this.#provide, [
      ...compileRuntimeMethods(this.#deployment.runtimeOptions?.provide),
      ...forwards.values()
    ])
    this.#features = readOrdinaryRpcFeatures(this.#core)
    this.#options = {
      ...this.#deployment.runtimeOptions,
      plugins: this.#features.map((feature) => feature.plugin),
      self: this.#deployment.runtimeOptions?.self ?? {
        name: this.#integration.identity.name,
        instanceId: this.#integration.identity.id
      },
      provide: this.#provide,
      report: this.#deployment.runtimeOptions?.report,
      signal: this.#core.lifecycle.signal
    }
    this.#events = readRuntimeOutletEvents(this.#slot.facade)
    this.#runtime = createRuntimeHost(
      this.#options,
      this.#definition,
      this.#features.map((feature) => feature.definition),
      this.#integration.nodeId,
      this.#publish,
      this.#deployment.runtimeOptions?.self === undefined
    )
    core.onDispose(() => this.#runtime.close())
  }

  /** Each canonical session contributes its exact native withdrawal receipt. */
  #publish = (connection: IRuntimePluginConnection): (() => void) => {
    /** Only the original managed factory can supply native generation and command authority. */
    const holder = readManagedRuntimeHolder(connection.peer)
    if (holder) this.#managedPeer = connection.peer
    /** Registration name and remote self identity remain distinct fields. */
    const registered = Object.freeze({ ...connection, name: this.#definition.name })
    /** Native shared-slot publication automatically stages this receipt until successful commit. */
    const withdraw = this.#slot.contribute(registered, registered.instanceId)
    if (this.#record && this.#slot.registered().includes(this.#record))
      this.#events.publish(
        runtimeReadyEvent(
          this.#definition.name,
          connection.peer,
          holder?.registration.events.current().generation
        ),
        connection.report
      )
    return withdraw
  }

  /** Start through the existing native Feature and Host provider admission owners. */
  async install(): Promise<Record<never, never>> {
    const admission = acquireRuntimeProviderAdmission(this.#integration)
    for (const feature of this.#features)
      await feature.setup(this.#runtime.featureContext((dispose) => this.#core.onDispose(dispose)))
    await withRuntimePreparationContext(
      this.#options,
      {
        host: this.#integration,
        ...admission,
        initialSignal: this.#core.operation.signal,
        lifecycleSignal: this.#core.lifecycle.signal,
        own: (dispose) => this.#core.onDispose(dispose),
        readProvide: () => this.#provide
      },
      () => this.#runtime.start()
    )
    this.#register()
    return {}
  }

  /** Preserve native readiness coalescing and only then register the original slot receipt. */
  #register(): void {
    const holder = this.#managedPeer && readManagedRuntimeHolder(this.#managedPeer)
    this.#registration = holder?.registration
    this.#record = Object.freeze({
      name: this.#definition.name,
      peer: this.#managedPeer ?? { describe: this.#runtime.host.describe },
      execution: this.#registration?.execution,
      prepareReplacement: readManagedRuntimeReplacement(this.#managedPeer),
      whenReady: holder ? () => holder.prepareRebind(this.#core.lifecycle.signal) : undefined,
      instanceIds: () =>
        this.#registration
          ? this.#registration.runtimeInstanceIds()
          : (this.#slot.values() as readonly IRuntimePluginConnection[])
              .filter((connection) => connection.name === this.#definition.name)
              .map((connection) => connection.instanceId)
    })
    this.#slot.register(this.#record, () => {
      this.#gate.open()
      for (const connection of this.#slot.values() as readonly IRuntimePluginConnection[])
        if (connection.name === this.#definition.name)
          this.#events.publish(
            runtimeReadyEvent(
              this.#definition.name,
              connection.peer,
              this.#registration?.events.current().generation
            ),
            connection.report
          )
    })
    this.#core.lifecycle.signal.addEventListener('abort', this.#closeEvents, { once: true })
    this.#core.onDispose(() =>
      this.#core.lifecycle.signal.removeEventListener('abort', this.#closeEvents)
    )
    if (this.#registration)
      this.#core.onDispose(
        this.#registration.supervisor.subscribe((event) => {
          if (!this.#slot.registered().includes(this.#record!)) return
          /** The original projector preserves native exit, restart and degradation classification. */
          const observation = runtimeSupervisorEvent(
            this.#definition.name,
            this.#registration!,
            event,
            this.#options.report ?? defaultRpcReporter
          )
          if (observation)
            this.#events.publish(observation, this.#options.report ?? defaultRpcReporter)
        })
      )
  }

  /** Idle watchers settle only when the original shared slot has become empty. */
  #closeEvents = (): void => {
    if (this.#slot.registered().length === 0) this.#events.close()
  }
}

/** Install into the original native Host reservation without another publication transaction. */
export async function installOrdinaryRpcTransport(
  core: IPluginHostCore,
  definition: IRpcTransportPluginDefinition
): Promise<Record<never, never>> {
  return new OrdinaryRpcTransportInstallation(core, definition).install()
}
