/**
 * Own the one native plugin-host, global RPC identity, and composition of mandatory execution
 * owners.
 */
import { getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import {
  createAbortController,
  createLifecycleScope,
  type ILifecycleScope
} from '@migaia/lifecycle'
import type {
  IRpcFlowContext,
  IRpcSessionView,
  IRpcTransportDefinition,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import {
  RpcWireKind,
  RpcWireProfile,
  type IRpcEnvelope,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, tagRpcError } from '@migaia/rpc-contract/errors'
import { CallTable } from '../call/table.ts'
import { ProviderDispatcher } from '../dispatch/dispatcher.ts'
import type { ProviderRegistration } from '../dispatch/registration.ts'
import type { IRpcProvide, IRpcProvideOptions, IProviderCommitGate } from '../dispatch/types.ts'
import { createProviderCommitGate, exposedProvide } from '../dispatch/exposure.ts'
import { FeatureScope } from '../feature/scope.ts'
import { FlowRegistry, type IRpcFlowGroup } from '../flow/registry.ts'
import { Forwarder } from '../forward/forwarder.ts'
import { Namespace } from '../namespace/namespace.ts'
import { SessionTable } from '../session/table.ts'
import type { IRpcSessionScope, IRpcSessionWriteOptions } from '../session/types.ts'
import { StreamChannel } from '../stream/channel.ts'
import type { IRpcTransportSetupContext } from '../sdk/types.ts'
import {
  rpcPipelineOwner,
  type IRpcPipelineOwner,
  type IRpcNativePipelineCore
} from '../sdk/flow-pipelines.ts'
import type { RpcFlowProgram, RpcTransportFlowProgram } from '../sdk/flow-program.ts'
import type { IRpcDefinitionMetadata, IRpcSharedFlows } from '../sdk/metadata.ts'
import { readRpcFeature, RpcDefinitionKind } from '../sdk/metadata.ts'
import { HostIdentity, defaultRpcId } from './identity.ts'
import { createRpcAbortError, createRpcError, createRpcLifecycleError } from './error-owner.ts'
import { HostErrorText } from './error-text.ts'
import { HostObservationKind, RpcProtocolEvent } from './state-constants.ts'
import { deserializeHostWireError } from './error-wire-metadata.ts'
import { ownRpcTransportClose, RpcHostInstallation } from './installation.ts'
import type { IRpcHost, IRpcRuntimeOptions } from './public.ts'
import { defaultRpcReporter, reportDiagnostic } from './report.ts'
import { resolveAbortReason } from './abort-reason.ts'

/** This family identifies actual RPC namespace publication inside native shared-slot admission. */
const namespaceFamily = Object.freeze({})
/**
 * Native resources belong to one transport registration, independent from SessionTable's live
 * index.
 */
type ITransportRegistration = {
  name: string
  owner: Namespace
  resources: ILifecycleScope
  controller: ReturnType<typeof createAbortController>
  sessionScope: IRpcSessionScope
  provider: ProviderRegistration
  /** Exact native registration keeps candidate and committed flow facts separate. */
  flow: IRpcFlowGroup
  /** Sessions borrow this registration's short-name execution port through native grace. */
  pipelines: IRpcPipelineOwner
  surface?: Record<PropertyKey, unknown>
}
/** Only these native lifetime operations are borrowed by the RPC close owner. */
type INativeHost = Readonly<{
  dispose(): Promise<Readonly<{ cleanupErrors: readonly unknown[] }>>
}>

/** Compose mandatory RPC owners once; optional algorithms arrive only through installed definitions. */
export class RpcHost {
  /** Public/native identity is captured once and reconciled before every first source handshake. */
  readonly #identity: HostIdentity
  /** A single private forwarding node is shared across every transport namespace. */
  readonly #nodeId: string
  /** This scope propagates global close and the user's external cancellation to all host work. */
  readonly #controller = createAbortController()
  /** Uncorrelated errors use the caller's one selected reporter. */
  readonly #reporter: (error: unknown) => void
  /** Original optional reporter identity distinguishes explicit notices from default coalescing. */
  readonly #configuredReport: IRpcRuntimeOptions['report']
  /**
   * A genuine native host is created only by open; ordinary installations borrow their existing
   * host.
   */
  #native: INativeHost | undefined
  /** Native installation and public use/unUse composition remain with the installation owner. */
  readonly #installation: RpcHostInstallation
  /** The genuine native owner lends execution authority separately from plugin registration. */
  readonly #pipelineOwner: IRpcPipelineOwner
  /** Each unique namespace owns its registration resources and public method projection. */
  readonly #namespaces = new Map<string, ITransportRegistration>()
  /** Candidate registrations reserve names without replacing the currently committed namespace. */
  readonly #pendingNamespaces = new Map<string, ITransportRegistration>()
  /** Each native shared facade retains its last committed surface for held lifecycle operations. */
  readonly #publications = new WeakMap<object, { surface: Record<PropertyKey, unknown> }>()
  /** Fixed flow composition has no concrete optional implementations. */
  readonly #flow: FlowRegistry
  /** Call feature precedence is compiled once per namespace. */
  readonly #features = new FeatureScope()
  /** The only physical/accepted session registry. */
  readonly #sessions: SessionTable
  /** The only scalar/one-way pending and cancellation owner. */
  readonly #calls: CallTable
  /** The only stream credit, producer and consumer owner. */
  readonly #streams: StreamChannel
  /** The only direct-directory forwarding owner. */
  readonly #forwarder: Forwarder
  /** The only local provider catalog and actual business execution owner. */
  readonly #providers: ProviderDispatcher
  /** Only failed first startup may reopen cold hooks; committed traffic permanently fixes order. */
  #everCommittedTransport = false
  /** The external signal receipt is removed at global close. */
  readonly #externalSignal: IRpcRuntimeOptions['signal']
  /** Every close caller observes this exact global completion Promise. */
  #closing: Promise<void> | undefined
  /** All outstanding work borrows one original terminal error instead of receiving new wrappers. */
  #reason: unknown

  /** Construct mandatory owners without opening any native carrier or installing a policy. */
  constructor(
    options: IRpcRuntimeOptions,
    nodeId = defaultRpcId().replace(/-/gu, ''),
    configuredSelf = options.self !== undefined
  ) {
    this.#nodeId = nodeId
    this.#configuredReport = options.report
    this.#reporter = this.#configuredReport ?? defaultRpcReporter
    this.#externalSignal = options.signal
    this.#pipelineOwner = {
      pipeline: (point, namespace) =>
        this.#namespaces.get(namespace)!.pipelines.pipeline(point, namespace)
    }
    this.#flow = new FlowRegistry(
      this.#report,
      (namespace) => this.#namespaces.get(namespace)?.flow,
      options.onWarning
    )
    this.#identity = new HostIdentity(options.self, configuredSelf, this.#flow.dispatchWarning)
    this.#sessions = new SessionTable({
      flow: this.#flow,
      pipelines: () => this.#pipelineOwner!,
      self: () => this.#identity.directorySelf,
      directory: (namespace, previous) =>
        this.#forwarder.directory(
          this.#identity.directorySelf,
          this.#nodeId,
          this.#providers.describe(namespace),
          this.#sessions.forwardTargets(namespace),
          previous
        ),
      admitSourceFacts: (facts) => this.#identity.admit(facts),
      receive: this.#receive,
      rejected: this.#rejected,
      accepted: this.#accepted,
      updated: this.#updated,
      hidden: (carrierId) => this.#forwarder.retired(carrierId),
      retired: this.#retired,
      keepalive: options.keepalive,
      report: this.#report
    })
    /** Every business owner borrows the same real IO, identity, drain and readonly diagnostic ports. */
    const work = {
      features: this.#features,
      canKeepalive: (id: string, source?: IRpcTargetSource) =>
        source ? source.canKeepalive?.(id) === true : this.#sessions.canKeepalive(id),
      assertTransfer: (id: string, options?: object) => this.#sessions.assertTransfer(id, options),
      self: this.#callSelf,
      observe: this.#flow.observe,
      send: (
        id: string,
        frame: IRpcEnvelope,
        write?: IRpcSessionWriteOptions,
        source?: IRpcTargetSource
      ) => (source ? source.send(id, frame, write) : this.#sessions.send(id, frame, write)),
      track: <T>(carrierId: string, promise: Promise<T>) =>
        this.#sessions.track(carrierId, promise),
      report: this.#report
    }
    this.#calls = new CallTable({
      ...work,
      sessions: this.#sessions
    })
    this.#streams = new StreamChannel({
      ...work,
      prepare: (target, command, local) => this.#calls.prepare(target, command, local)
    })
    this.#forwarder = new Forwarder({
      maxHops: options.forward?.maxHops,
      observation: this.#flow,
      nodeId: () => this.#nodeId,
      resolve: (namespace, name) => this.#sessions.resolveForward(namespace, name),
      current: (id) => this.#sessions.getById(id),
      sourceNodeId: (id) => this.#sessions.nodeId(id),
      call: (target, command, local) => this.#calls.invoke(target, command, local),
      stream: (target, method, payload, local) => this.#streams.open(target, method, payload, local)
    })
    this.#providers = new ProviderDispatcher({
      ...work,
      calls: this.#calls,
      pipelines: () => this.#pipelineOwner!,
      notify: async (namespace, input, signal, excludePeerId) =>
        this.#namespace(namespace).notifyFrom(input, signal, excludePeerId),
      forward: this.#forwarder,
      streams: this.#streams
    })
    if (options.provide !== undefined)
      this.#providers.provide(options.provide, { contract: options.contract })
    if (options.signal?.aborted)
      throw createRpcAbortError(undefined, undefined, resolveAbortReason(options.signal))
    options.signal?.addEventListener('abort', this.#abort, { once: true })
    this.#installation = new RpcHostInstallation({
      owner: this,
      self: () => this.self,
      provide: this.provide,
      close: this.close,
      assertOpen: () => this.#assertOpen(),
      announceDirectory: () => this.#sessions.announceDirectory(),
      setNative: (native) => {
        this.#native = native
      }
    })
  }

  /** Public identity belongs to this host, never to a projected session facade. */
  get self() {
    return this.#identity.self
  }

  /** Ordinary native installations can replace a fully retired RPC owner without reviving it. */
  get closed(): boolean {
    return this.#closing !== undefined
  }

  /** Register global provider methods through the one descriptor-order compiler. */
  readonly provide = (input: IRpcProvide, options?: IRpcProvideOptions): void => {
    this.#assertOpen()
    this.#providers.provide(input, options)
    void this.#sessions.announceDirectory().catch(this.#report)
  }

  /** Native startup and later install transactions share the same explicit installation owner. */
  open(program: RpcFlowProgram): Promise<IRpcHost> {
    return this.#installation.open(program)
  }

  /** Actual SDK native hooks join this receiving owner; no second plugin-host is created here. */
  async install(core: IPluginHostCore, metadata: IRpcDefinitionMetadata): Promise<void> {
    this.#assertOpen()
    if (metadata.kind === RpcDefinitionKind.transport)
      return this.#installTransport(core, metadata.definition, metadata.flows)
    if (metadata.kind === RpcDefinitionKind.source)
      return this.#namespace(metadata.namespace).installSource(core, metadata.definition)
    if (metadata.kind === RpcDefinitionKind.policy) {
      this.#flow.registerControls(core, (core as IRpcTransportSetupContext['owner']).features)
      core.onDispose(
        this.#features.setDefaults(
          metadata.definition.features,
          (core as IRpcTransportSetupContext['owner']).features
        )
      )
      return
    }
    if (metadata.kind === RpcDefinitionKind.feature)
      throw tagRpcError(
        new TypeError(HostErrorText.flowFeatureRequired),
        RpcCoreErrorCode.invalidConfig
      )
    /** Setup borrows the same Host lifetime and real work owners for every optional registration. */
    const context = this.#flowSetupContext(core)
    if (metadata.kind === RpcDefinitionKind.features) {
      if (
        Object.values(metadata.features).some(
          (feature) => readRpcFeature(feature)?.category === 'call'
        )
      )
        core.onDispose(
          this.#features.setDefaults(
            metadata.features,
            (core as IRpcTransportSetupContext['owner']).features
          )
        )
      /** The original shared setup lends only its selected group relationship to native removal. */
      const shared = await metadata.prepare(core, this.#controller.signal, context)
      this.#flow.registerShared(core, shared)
      getPluginRuntimeIntegration(core).allowRemovalWhen(
        () => this.closed || !this.#sharedFlowsInUse(shared)
      )
      return
    }
    /**
     * Readonly observers retain their native registration rather than becoming information-flow
     * Features.
     */
    if (metadata.kind !== RpcDefinitionKind.flow)
      throw tagRpcError(new TypeError(HostErrorText.pluginInvalid), RpcCoreErrorCode.invalidConfig)
    const installed = await metadata.prepare(core, this.#controller.signal, context)
    this.#flow.register(core, installed)
  }

  /** Flow setup borrows stable Root work ports while native cores retain resource ownership. */
  #flowSetupContext(core: IPluginHostCore): import('../sdk/types.ts').IRpcFlowSetupContext {
    return {
      signal: core.lifecycle.signal,
      report: this.#report,
      self: () => this.#identity.directorySelf,
      call: (namespace, command, local) => this.#namespace(namespace).invoke(command, local),
      observe: this.#flow.observe,
      retire: (carrierId, reason, kind) => this.#sessions.detach(carrierId, reason, kind)
    }
  }

  /** Only committed namespace groups can keep this exact shared wrapper in active communication. */
  #sharedFlowsInUse(shared: IRpcSharedFlows): boolean {
    for (const registration of this.#namespaces.values())
      if (
        registration.flow.usesShared(shared) &&
        this.#sessions.hasOpenSessions(registration.sessionScope)
      )
        return true
    return false
  }

  /** Global close seals admission, joins native origin drains, then retires physical work. */
  readonly close = (reason?: unknown): Promise<void> => {
    if (!this.#closing) {
      this.#reason =
        reason === undefined ? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed) : reason
      this.#closing = Promise.resolve().then(() => this.#release())
      /** Pending acquisition has no accepted grace and observes the original cancellation now. */
      for (const entry of this.#pendingNamespaces.values()) entry.controller.abort(this.#reason)
      this.#calls.seal(this.#reason)
      this.#streams.seal()
      this.#providers.seal()
      this.#externalSignal?.removeEventListener('abort', this.#abort)
    }
    return this.#closing
  }

  /** One external abort uses the same global close owner and observes cleanup failures. */
  readonly #abort = (): void => {
    void this.close(resolveAbortReason(this.#externalSignal!)).catch(this.#report)
  }

  /** Report secondary failures without replacing the original correlated failure. */
  readonly #report = (error: unknown): void => reportDiagnostic(this.#reporter, error)

  /** Task identity is copied from the global owner immediately before each originating attempt. */
  readonly #callSelf = () => ({
    instanceId: this.self.instanceId,
    generation: this.#identity.directorySelf.generation,
    applicationVersion: RpcWireProfile
  })

  /** Only accepted source facts can reach work owners; carrier representation never enters dispatch. */
  readonly #receive = (
    carrierId: string,
    view: IRpcSessionView,
    frame: IRpcSemanticFrame,
    source?: IRpcTargetSource,
    sourceGate?: IProviderCommitGate
  ): void => {
    if (frame.kind === RpcWireKind.handshake || frame.kind === RpcWireKind.directory) return
    if (frame.kind === RpcWireKind.control) {
      if (frame.operation === 'drain')
        this.#flow.observe({
          kind: RpcProtocolEvent.peerClosing,
          namespace: view.namespace,
          peerId: view.peerId,
          data: {
            name: RpcProtocolEvent.peerClosing,
            requesterId: frame.route.senderId,
            durationMs: frame.route.remainingMs
          }
        })
      return
    }
    if (this.#streams.accept(carrierId, frame)) return
    if (this.#calls.accept(carrierId, frame)) return
    /** Provider execution borrows accepted facts, not a mutable Session object. */
    const context = this.#flowContext(carrierId, view)
    if (
      frame.kind === RpcWireKind.call ||
      frame.kind === RpcWireKind.group ||
      frame.kind === RpcWireKind.cancel ||
      frame.kind === RpcWireKind.outcome
    )
      void this.#providers.accept(context, frame, undefined, source, sourceGate).catch(this.#report)
    else if (frame.kind === RpcWireKind.error) this.#report(deserializeHostWireError(frame.error))
    else
      this.#report(createRpcError(RpcCoreErrorCode.contractInvalid, HostErrorText.replyUnclaimed))
  }

  /** Correlated hook failures settle their original operation while unrelated sessions stay live. */
  readonly #rejected = (
    carrierId: string,
    view: IRpcSessionView,
    envelope: IRpcEnvelope,
    error: unknown,
    source?: IRpcTargetSource
  ): void => {
    if (
      this.#calls.reject(carrierId, envelope, error) ||
      this.#streams.reject(carrierId, envelope, error)
    )
      return
    if (envelope.kind === RpcWireKind.call || envelope.kind === RpcWireKind.group)
      void this.#providers
        .accept(this.#flowContext(carrierId, view), envelope, { error }, source)
        .catch(this.#report)
    else this.#report(error)
  }

  /** Work and correlated failures borrow identical accepted identity and host cancellation facts. */
  #flowContext(carrierId: string, view: IRpcSessionView): IRpcFlowContext {
    return {
      namespace: view.namespace,
      carrierId,
      session: view,
      direction: 'inbound',
      exclusive: view.isExclusive?.() ?? false,
      signal: this.#controller.signal,
      report: this.#report
    }
  }

  /** Accepted capability construction happens once after the actual handshake write completes. */
  readonly #accepted = (carrierId: string, view: IRpcSessionView): void => {
    this.#updated(carrierId, view)
    this.#flow.observe({
      kind: HostObservationKind.peerReady,
      carrierId,
      namespace: view.namespace,
      peerId: view.peerId,
      data: view
    })
  }

  /** A directory update refreshes capabilities without fabricating another accepted handshake. */
  readonly #updated = (carrierId: string, view: IRpcSessionView): void => {
    this.#forwarder.accepted({ carrierId, view })
    this.#namespaces.get(view.namespace)?.owner.accepted({ carrierId, view })
  }

  /** One retirement reason is lent to every work owner before the public capability is withdrawn. */
  readonly #retired = (
    carrierId: string,
    view: IRpcSessionView | undefined,
    reason: unknown,
    physicalFailure = false,
    published = true,
    _source?: IRpcTargetSource,
    native = false
  ): void => {
    this.#forwarder.retired(carrierId)
    this.#calls.retire(
      carrierId,
      reason,
      physicalFailure,
      native ? view?.generation.value : undefined
    )
    this.#providers.retire(carrierId, reason)
    void this.#streams.retire(carrierId, reason, physicalFailure).catch(this.#report)
    if (!published) return
    if (view) this.#namespaces.get(view.namespace)?.owner.retired(carrierId, view)
    this.#flow.observe({
      kind: HostObservationKind.peerLeave,
      carrierId,
      namespace: view?.namespace,
      peerId: view?.peerId,
      data: reason
    })
  }

  /** Installation admits namespace names before a transport can acquire any physical resources. */
  async #installTransport(
    core: IPluginHostCore,
    definition: IRpcTransportDefinition<
      import('@migaia/plugin-host').IFeatureRecord,
      object,
      IRpcTransportSetupContext
    >,
    flows: RpcTransportFlowProgram
  ): Promise<void> {
    this.#sessions.admitNamespace(definition.namespace, this.#pendingNamespaces)
    /** Native use rejects duplicate definition names; only its same-name replace can reach here. */
    const previous = this.#namespaces.get(definition.namespace)
    /** Native Feature guards and the original commit gate stay with the actual receiving host. */
    const integration = getPluginRuntimeIntegration(core)
    /** This transport borrows only its own authentic native construction request. */
    const pipelines = Reflect.get(core, rpcPipelineOwner) as
      | IRpcNativePipelineCore[typeof rpcPipelineOwner]
      | undefined
    if (!pipelines || !integration.matchesHost(pipelines.host))
      throw tagRpcError(
        new TypeError(HostErrorText.nativePipelinesRequired),
        RpcCoreErrorCode.invalidConfig
      )
    /** Local setup and short-name stages belong to this exact native install registration. */
    const flow = await this.#flow.prepareTransport(
      core,
      flows,
      this.#controller.signal,
      this.#flowSetupContext(core)
    )
    /** A native batch may expose accepted methods before its shared namespace publication commits. */
    const gate = createProviderCommitGate(core.lifecycle.signal)
    const provider = this.#providers.prepare(
      exposedProvide(
        this.#native ? [] : (definition.expose ?? []),
        (name) => integration.readFeatureOutputs(name),
        gate,
        {
          resolve: (name) => this.#sessions.resolveForward(definition.namespace, name),
          hold: (selection, method) => this.#forwarder.hold(selection, method)
        }
      ),
      { namespace: definition.namespace },
      previous?.provider
    )
    core.onDispose(provider.dispose)
    /**
     * One registered scope can accept later restarted/accepted sessions without using an expired
     * core.
     */
    const resources = createLifecycleScope({ errorPolicy: 'collect' })
    /** Namespace shutdown reaches transport-owned acquisition and queued work. */
    const controller = createAbortController()
    /** The original registration lends its one staged identity index to every actual attachment. */
    const sessionScope = this.#sessions.stage(definition.namespace, {
      connect: definition.connect,
      handshakeTimeoutMs: definition.handshakeTimeoutMs,
      nameAdmissionTimeoutMs: definition.nameAdmissionTimeoutMs,
      signal: controller.signal,
      gate,
      pipelines: () => pipelines,
      flow
    })
    /** Removing a local information-flow Feature means removing its owning native transport unit. */
    if (flow.local)
      integration.allowRemovalWhen(
        () => this.closed || !this.#sessions.hasOpenSessions(sessionScope)
      )
    /**
     * Namespace projection owns selection and calls while this resource scope owns registration
     * cleanup.
     */
    const namespace = new Namespace({
      name: definition.namespace,
      closingWrites: definition.closingWrites === true,
      sessionScope,
      resources,
      configuredReport: this.#configuredReport,
      settleFailedGate: (gate) => this.#providers.settleFailedGate(gate),
      assertOpen: () => this.#assertOpen(),
      sessions: this.#sessions,
      calls: this.#calls,
      stream: (target, method, payload, local, admission) =>
        this.#streams.open(target, method, payload, local, admission),
      hold: (selection, method) => this.#forwarder.hold(selection, method),
      close: (reason) => this.#releaseNamespace(registration, reason),
      report: this.#report
    })
    const registration: ITransportRegistration = {
      name: definition.namespace,
      owner: namespace,
      resources,
      controller,
      sessionScope,
      provider,
      flow,
      pipelines
    }
    this.#pendingNamespaces.set(definition.namespace, registration)
    /** Native pre-release or its failed-install fallback joins held terminals before retiring IO. */
    const close = async (): Promise<void> => {
      await this.#providers.settleFailedGate(gate)
      await namespace.close(this.#reason)
    }
    ownRpcTransportClose(core, close)
    /**
     * Only call-feature instances are interpreted here; media/pool features remain with their
     * transport.
     */
    const commitFeatures = this.#features.prepare(
      definition.namespace,
      definition.features ?? {},
      (core as IRpcTransportSetupContext['owner']).features
    )
    this.#flow.start()
    /** Native slot admission is the only way this namespace becomes part of the public host. */
    /** The transport receives lifecycle/session operations and owns every concrete media algorithm. */
    const transport: IRpcTransportSetupContext = {
      owner: core as IRpcTransportSetupContext['owner'],
      configuredReport: this.#configuredReport,
      ...this.#sessions.context(sessionScope, resources, () => this.#reason)
    }
    /** Namespace owns the same native acquisition path for original and appended sources. */
    const installed = await namespace.openTransport(
      core,
      definition,
      transport,
      resources,
      (reason) => namespace.close(this.#closing ? this.#reason : reason)
    )
    registration.surface = namespace.surface(
      [
        ...flow.namespaceExtensions(definition.namespace),
        { features: this.#flow.controls(flows.controls(core)) }
      ],
      installed.namespaceExtensions
    )
    /** Compose all methods before native publication; a published namespace is immutable. */
    const slot = integration.acquireSharedSlot(definition.namespace, namespaceFamily, () =>
      this.#sharedSurface(registration.surface!)
    )
    /** One original commit receipt retains the native publication's existing ownership inputs. */
    const commit = { registration, slot, provider, commitFeatures, gate }
    slot.register(namespace, () => {
      this.#namespaces.set(definition.namespace, commit.registration)
      this.#pendingNamespaces.delete(definition.namespace)
      this.#publications.get(commit.slot.facade)!.surface = commit.registration.surface!
      commit.provider.commit()
      commit.commitFeatures()
      commit.gate.open()
      this.#sessions.commit(commit.registration.sessionScope)
      this.#everCommittedTransport = true
    })
  }

  /** Native shared slots publish one stable facade while replacement swaps only its committed value. */
  #sharedSurface(surface: Record<PropertyKey, unknown>): Record<PropertyKey, unknown> {
    /** The facade owns its last committed target; failed candidates cannot change this cell. */
    const publication = { surface }
    /** Dynamic own-data reads retain original method receivers and exact held callable identity. */
    const facade = new Proxy(Object.create(null), {
      get: (_target, key) => Reflect.get(publication.surface, key),
      ownKeys: () => Reflect.ownKeys(publication.surface),
      getOwnPropertyDescriptor: (_target, key) => {
        const descriptor = Object.getOwnPropertyDescriptor(publication.surface, key)
        return descriptor && { ...descriptor, configurable: true }
      },
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false
    })
    this.#publications.set(facade, publication)
    return facade
  }

  /**
   * Namespace close cancels acquisition before releasing every registered physical handle in
   * reverse.
   */
  async #releaseNamespace(registration: ITransportRegistration, reason: unknown): Promise<void> {
    /** Public Sessions finish their own grace while the transport and its native hooks remain live. */
    const sessionFailures: unknown[] = []
    try {
      await this.#sessions.closeScope(registration.sessionScope, reason)
    } catch (error) {
      sessionFailures.push(error)
    }
    registration.controller.abort(reason)
    if (this.#namespaces.get(registration.name) === registration) {
      this.#features.unregister(registration.name)
      this.#namespaces.delete(registration.name)
    }
    if (this.#pendingNamespaces.get(registration.name) === registration)
      this.#pendingNamespaces.delete(registration.name)
    /** Scope disposal preserves exact resource errors and attempts all original reverse releases. */
    const errors = await registration.resources.dispose()
    this.#sessions.releaseScope(registration.sessionScope)
    if (this.#namespaces.size === 0 && !this.#everCommittedTransport)
      this.#flow.reopenBeforeStartup()
    if (errors.length || sessionFailures.length) {
      /** Every original close or scope failure remains reachable in its observed order. */
      const failures = [...sessionFailures, ...errors.map((entry) => entry.error)]
      throw failures.length === 1
        ? failures[0]
        : createRpcLifecycleError(
            RpcCoreErrorText.endpointDisposed,
            new AggregateError(failures, HostErrorText.cleanupFailed)
          )
    }
  }

  /**
   * Global close joins the same stream/native/session owners and preserves every original cleanup
   * error.
   */
  async #release(): Promise<void> {
    await this.#sessions.quiesce(this.#reason)
    /** Collection is bounded by actual owners, never an invented global rollback transaction. */
    const failures: unknown[] = []
    try {
      await this.#sessions.close(this.#reason)
    } catch (error) {
      failures.push(error)
    }
    /** Session grace is complete; pending replies can no longer arrive on the retired carriers. */
    this.#controller.abort(this.#reason)
    this.#calls.close(this.#reason)
    this.#providers.close(this.#reason)
    /** Stream retirement joins its original pending owners after Session has settled physical IO. */
    const streamResult = this.#streams.close(this.#reason).catch((error: unknown) => {
      failures.push(error)
    })
    if (this.#native) {
      try {
        failures.push(...(await this.#native.dispose()).cleanupErrors)
      } catch (error) {
        failures.push(error)
      }
    }
    await streamResult
    this.#forwarder.close()
    this.#features.close()
    this.#flow.close()
    if (failures.length)
      throw createRpcLifecycleError(
        RpcCoreErrorText.endpointDisposed,
        new AggregateError(failures, HostErrorText.cleanupFailed),
        failures.map((error) => ({ resource: HostErrorText.cleanupFailed, error }))
      )
  }

  /**
   * A namespace is selected by its explicit native key, never through arbitrary public host
   * properties.
   */
  #namespace(name: string): Namespace {
    this.#assertOpen()
    /** The installed namespace's owner remains unique for its native registration. */
    const registration = this.#namespaces.get(name)
    if (!registration)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, HostErrorText.namespaceInvalid)
    return registration.owner
  }

  /** Closing rejects new work with the same original terminal identity used by pending calls. */
  #assertOpen(): void {
    if (this.#closing) throw this.#reason
  }
}
