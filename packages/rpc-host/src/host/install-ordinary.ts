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
export async function installOrdinaryRpcTransport(
  core: IPluginHostCore,
  definition: IRpcTransportPluginDefinition
): Promise<Record<never, never>> {
  /** Forged cores cannot acquire runtime slots or observe another Host's Feature outputs. */
  const integration = getPluginRuntimeIntegration(core)
  /** The token is checked before an actual source can be invoked. */
  const deployment = readAdapterDeployment(definition.deployment)
  if (!deployment)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, HostErrorText.deploymentInvalid)
  /** Original physical families retain the existing process/thread publication location. */
  const key = deployment.runtimeKey ?? RuntimePluginKey.process
  /** Native slot admission remains the sole owner of pending candidates and committed visibility. */
  const slot = integration.acquireSharedSlot<IRuntimeOutlet>(
    key,
    deployment.runtimeFamily ?? ordinaryRuntimeFamily,
    (shared) =>
      createRuntimeOutlet(
        shared,
        {
          name: integration.identity.name,
          instanceId: integration.identity.id
        },
        key
      )
  )
  /** One install gate keeps explicitly exposed local methods behind the original commit boundary. */
  const gate = createCommitGate(core.lifecycle.signal)
  /** Forward entries remain original canonical catalog entries, never wrapper calls to another host. */
  const forwards = new Map<string, IRuntimeForwardMethodEntry>()
  /** Local output availability is read through native Host guards on every invocation. */
  const provide = exposedProvide(
    definition.expose ?? [],
    (name) => integration.readFeatureOutputs(name),
    (target) => resolveRuntimePluginConnection(integration, target),
    forwards,
    integration.nodeId,
    gate
  )
  registerRuntimePluginMethods(provide, [
    ...compileRuntimeMethods(deployment.runtimeOptions?.provide),
    ...forwards.values()
  ])
  /** Read exact registered objects before the native source observes transport feature settings. */
  const features = readOrdinaryRpcFeatures(core)
  /** Explicit deployment-local configuration retains its ordinary Host behavior. */
  const options: IRpcHostOptions = {
    ...deployment.runtimeOptions,
    plugins: features.map((feature) => feature.plugin),
    self: deployment.runtimeOptions?.self ?? {
      name: integration.identity.name,
      instanceId: integration.identity.id
    },
    provide,
    report: deployment.runtimeOptions?.report,
    signal: core.lifecycle.signal
  }
  /**
   * Fixed feature configuration is captured for this installation without hot-reconfiguring live
   * peers.
   */
  /** The existing outlet owns lifecycle observation; this record is published only on native commit. */
  const events = readRuntimeOutletEvents(slot.facade)
  /** A pending native reservation cannot publish its ready event before its registration commits. */
  let record: IRuntimePluginRegistration | undefined
  /** The published genuine facade lends its original holder; no native execution is synthesized. */
  let managedPeer: IRuntimePeer | undefined
  /** Each canonical session contributes one exact withdraw receipt owned by its source retirement. */
  const publish = (connection: IRuntimePluginConnection): (() => void) => {
    /** Only the original managed factory can supply native generation and command authority. */
    const holder = readManagedRuntimeHolder(connection.peer)
    if (holder) managedPeer = connection.peer
    /** Registration name and remote self identity remain distinct fields. */
    const registered = Object.freeze({ ...connection, name: definition.name })
    /** Native shared-slot publication automatically stages this receipt until successful commit. */
    const withdraw = slot.contribute(registered, registered.instanceId)
    if (record && slot.registered().includes(record))
      events.publish(
        runtimeReadyEvent(
          definition.name,
          connection.peer,
          holder?.registration.events.current().generation
        ),
        connection.report
      )
    return withdraw
  }
  /** This creates the one host endpoint over raw sources, never a complete Peer used as a source. */
  const runtime = createRuntimeHost(
    options,
    definition,
    features.map((feature) => feature.definition),
    integration.nodeId,
    publish,
    deployment.runtimeOptions?.self === undefined
  )
  core.onDispose(() => runtime.close())
  /** Shared provider reservations reuse the original cross-transport Host admission owner. */
  const admission = acquireRuntimeProviderAdmission(integration)
  for (const feature of features)
    await feature.setup(runtime.featureContext((dispose) => core.onDispose(dispose)))
  await withRuntimePreparationContext(
    options,
    {
      host: integration,
      ...admission,
      initialSignal: core.operation.signal,
      lifecycleSignal: core.lifecycle.signal,
      own: (dispose) => core.onDispose(dispose),
      readProvide: () => provide
    },
    () => runtime.start()
  )
  /** Original readiness coalescing remains with the same holder used by native event observation. */
  const holder = managedPeer && readManagedRuntimeHolder(managedPeer)
  /** Borrowed connect bindings deliberately retain no execution authority. */
  const registration = holder?.registration
  record = Object.freeze({
    name: definition.name,
    peer: managedPeer ?? { describe: runtime.host.describe },
    execution: registration?.execution,
    prepareReplacement: readManagedRuntimeReplacement(managedPeer),
    whenReady: holder ? () => holder.prepareRebind(core.lifecycle.signal) : undefined,
    instanceIds: () =>
      registration
        ? registration.runtimeInstanceIds()
        : (slot.values() as readonly IRuntimePluginConnection[])
            .filter((connection) => connection.name === definition.name)
            .map((connection) => connection.instanceId)
  })
  slot.register(record, () => {
    gate.open()
    for (const connection of slot.values() as readonly IRuntimePluginConnection[])
      if (connection.name === definition.name)
        events.publish(
          runtimeReadyEvent(
            definition.name,
            connection.peer,
            registration?.events.current().generation
          ),
          connection.report
        )
  })
  /** Logical owner close settles idle watches only after the original shared slot becomes empty. */
  const closeEvents = (): void => {
    if (slot.registered().length === 0) events.close()
  }
  core.lifecycle.signal.addEventListener('abort', closeEvents, { once: true })
  core.onDispose(() => core.lifecycle.signal.removeEventListener('abort', closeEvents))
  if (registration)
    core.onDispose(
      registration.supervisor.subscribe((event) => {
        if (!slot.registered().includes(record!)) return
        /** The original projector preserves native exit, restart and degradation classification. */
        const observation = runtimeSupervisorEvent(
          definition.name,
          registration,
          event,
          options.report ?? defaultRpcReporter
        )
        if (observation) events.publish(observation, options.report ?? defaultRpcReporter)
      })
    )
  return {}
}
