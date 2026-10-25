/**
 * Own the one native plugin-host, global RPC identity, and composition of mandatory execution
 * owners.
 */
import { defineHost, getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import { observeAbortSubscription } from '@migaia/lifecycle/abort'
import {
  createAbortController,
  createLifecycleScope,
  type ILifecycleScope
} from '@migaia/lifecycle'
import type {
  IRpcAttemptFacts,
  IRpcCarrier,
  IRpcFlowContext,
  IRpcLocalSourceFacts,
  IRpcSessionHandle,
  IRpcSessionView,
  IRpcTransportDefinition,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import {
  RpcWireKind,
  RpcWireProfile,
  type IRpcDirectory,
  type IRpcEnvelope,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, tagRpcError } from '@migaia/rpc-contract/errors'
import { CallTable } from '../call/table.js'
import { callTarget } from '../call/target.js'
import type { ICallCommand, ICallLocalOptions, ICallTargetRef } from '../call/types.js'
import { ProviderDispatcher } from '../dispatch/dispatcher.js'
import type { ProviderRegistration } from '../dispatch/registration.js'
import type { IRpcProvide, IRpcProvideOptions } from '../dispatch/types.js'
import { createProviderCommitGate, exposedProvide } from '../dispatch/exposure.js'
import { FeatureScope } from '../feature/scope.js'
import { FlowRegistry } from '../flow/registry.js'
import { Forwarder } from '../forward/forwarder.js'
import { Namespace } from '../namespace/namespace.js'
import { SessionTable } from '../session/table.js'
import type { IRpcSessionScope, IRpcSessionWriteOptions } from '../session/types.js'
import { StreamChannel } from '../stream/channel.js'
import type { IRpcHostPlugin, IRpcTransportSetupContext } from '../sdk/types.js'
import { RpcFlowPipelines, type IRpcPipelineOwner } from '../sdk/flow-pipelines.js'
import type { IRpcDefinitionMetadata } from '../sdk/metadata.js'
import { readRpcDefinition } from '../sdk/metadata.js'
import { HostIdentity, defaultRpcId } from './identity.js'
import {
  createRpcAbortError,
  createRpcError,
  createRpcLifecycleError,
  rpcConstructionFailure,
  originalRpcInstallationFailure
} from './error-owner.js'
import { HostErrorText } from './error-text.js'
import { HostObservationKind, RpcProtocolEvent } from './state-constants.js'
import { deserializeHostWireError } from './error-wire-metadata.js'
import { rpcInstallationOwner } from './installation.js'
import type { IRpcHost, IRpcRuntimeOptions } from './public.js'
import { defaultRpcReporter, reportDiagnostic } from './report.js'
import { resolveAbortReason } from './abort-reason.js'

/** This family identifies actual RPC namespace publication inside native shared-slot admission. */
const namespaceFamily = Object.freeze({})
/** Native host method names cannot be shadowed by a transport's public namespace. */
const reservedNamespaces = new Set(['self', 'provide', 'close', 'use', 'dispose', 'unUse'])
/** One ordered boundary defines publication and forbids extensions replacing mandatory calls. */
const reservedMethods = new Set<PropertyKey>([
  'peers',
  'request',
  'notify',
  'send',
  'dispatch',
  'group',
  'stream',
  'close',
  Symbol.asyncDispose
])

/**
 * Native resources belong to one transport registration, independent from SessionTable's live
 * index.
 */
type ITransportRegistration = {
  name: string
  definitionName: string
  owner: Namespace
  resources: ILifecycleScope
  controller: ReturnType<typeof createAbortController>
  sessionScope: IRpcSessionScope
  provider: ProviderRegistration
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
  /** The genuine native owner lends execution authority separately from plugin registration. */
  #pipelineOwner: IRpcPipelineOwner | undefined
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
    configuredSelf = options.self !== undefined,
    pipelineOwner?: IRpcPipelineOwner
  ) {
    this.#identity = new HostIdentity(options.self, configuredSelf)
    this.#nodeId = nodeId
    this.#configuredReport = options.report
    this.#reporter = this.#configuredReport ?? defaultRpcReporter
    this.#externalSignal = options.signal
    this.#pipelineOwner = pipelineOwner
    this.#flow = new FlowRegistry(this.#report)
    this.#sessions = new SessionTable({
      flow: this.#flow,
      pipelines: () => this.#pipelineOwner!,
      self: () => this.#identity.directorySelf,
      directory: (namespace) => this.#directory(namespace),
      admitSourceFacts: (facts) => this.#identity.admit(facts),
      receive: this.#receive,
      rejected: this.#rejected,
      accepted: this.#accepted,
      updated: this.#updated,
      hidden: (carrierId) => this.#forwarder.retired(carrierId),
      retired: this.#retired,
      report: this.#report
    })
    /** Every business owner borrows the same real IO, identity, drain and readonly diagnostic ports. */
    const work = {
      features: this.#features,
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
      refreshTarget: this.#refreshTarget,
      attemptFacts: this.#attemptFacts
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
      throw createRpcAbortError(undefined, undefined, options.signal.reason)
    options.signal?.addEventListener('abort', this.#abort, { once: true })
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

  /** One native host commits the cold flow prefix before carriers can perform protected startup. */
  async open(plugins: readonly IRpcHostPlugin[]): Promise<IRpcHost> {
    /** Native publication supplies namespaces through its canonical extension slots. */
    const publicContext = { owner: this }
    /** The surface borrows this explicit owner; no root RPC invocation methods are exposed. */
    const native = defineHost({
      pipelines: RpcFlowPipelines,
      host: {
        identity: { name: this.self.name },
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      },
      surface: {
        get self() {
          return publicContext.owner.self
        },
        provide: this.provide,
        close: this.close,
        [Symbol.asyncDispose]: this.close
      },
      domainCore: () => ({ [rpcInstallationOwner]: this })
    })
    this.#native = native
    this.#pipelineOwner = native
    try {
      /** Candidate stages are invisible until native commit; no transport can negotiate before it. */
      await native.use(
        ...plugins.filter((plugin) => readRpcDefinition(plugin)?.kind !== 'transport')
      )
      await native.use(
        ...plugins.filter((plugin) => readRpcDefinition(plugin)?.kind === 'transport')
      )
      /**
       * Publish the complete cold batch after child sources have contributed their accepted
       * methods.
       */
      await this.#sessions.announceDirectory()
      return native as unknown as IRpcHost
    } catch (primary) {
      try {
        await this.close()
      } catch (cleanup) {
        throw await rpcConstructionFailure(primary, cleanup)
      }
      throw (await originalRpcInstallationFailure(primary)).error
    }
  }

  /** Actual SDK native hooks join this receiving owner; no second plugin-host is created here. */
  async install(core: IPluginHostCore, metadata: IRpcDefinitionMetadata): Promise<void> {
    this.#assertOpen()
    if (metadata.kind === 'transport') return this.#installTransport(core, metadata.definition)
    if (metadata.kind === 'policy') {
      core.onDispose(this.#features.setDefaults(metadata.definition.features))
      return
    }
    /** Reusable definitions construct complete flow behavior separately for each receiving host. */
    const installed = await metadata.prepare(core, this.#controller.signal, {
      signal: core.lifecycle.signal,
      report: this.#report,
      self: () => this.#identity.directorySelf,
      call: (namespace, command, local) => this.#namespace(namespace).invoke(command, local),
      observe: this.#flow.observe,
      retire: (carrierId, reason) => this.#sessions.detach(carrierId, reason)
    })
    this.#flow.register(core, metadata.definition, installed)
  }

  /** Global close seals admission, joins native origin drains, then retires physical work. */
  readonly close = (reason?: unknown): Promise<void> => {
    if (!this.#closing) {
      this.#reason =
        reason === undefined ? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed) : reason
      this.#closing = Promise.resolve().then(() => this.#release())
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

  /**
   * A normal origin retry may select a current replacement; held capabilities enforce their own
   * fence.
   */
  readonly #refreshTarget = (target: ICallTargetRef): ICallTargetRef | undefined => {
    const selection = target.source
      ? target.source.current(target.carrierId)
      : this.#sessions.get(target.namespace, target.name)
    return selection === undefined ? undefined : callTarget(selection)
  }

  /** Read actual accepted declarations and native generation authority before a feature can replay. */
  readonly #attemptFacts = (
    target: ICallTargetRef,
    command: ICallCommand,
    options: ICallLocalOptions
  ): IRpcAttemptFacts => {
    /** The accepted selection lends real native limits without trusting remote diagnostics. */
    const current =
      target.source?.current(target.carrierId) ?? this.#sessions.getById(target.carrierId)
    /** The compiled method Map supplies idempotency facts without a per-attempt directory scan. */
    const methods = current?.view.methods
    /** A group may repeat only when every admitted member explicitly declares idempotency. */
    const idempotent =
      command.mode === 'group'
        ? command.steps.length > 0 &&
          command.steps.every((step) => methods?.get(step.method)?.idempotent === true)
        : command.mode === 'request' && methods?.get(command.method)?.idempotent === true
    return {
      method: 'method' in command ? command.method : command.mode,
      idempotent,
      callTimeoutCap: current?.view.callTimeoutCap,
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      availability:
        command.mode === 'request' || command.mode === 'group'
          ? this.#sessions.availability(
              target.namespace,
              target.name,
              target.carrierId,
              target.source
            )
          : undefined
    }
  }

  /** Only accepted source facts can reach work owners; carrier representation never enters dispatch. */
  readonly #receive = (
    carrierId: string,
    view: IRpcSessionView,
    frame: IRpcSemanticFrame,
    source?: IRpcTargetSource
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
      void this.#providers.accept(context, frame, undefined, source).catch(this.#report)
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
    published = true
  ): void => {
    this.#forwarder.retired(carrierId)
    this.#calls.retire(carrierId, reason, physicalFailure)
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

  /**
   * The provider catalog is global; each carrier announces its namespace-local accepted sessions
   * separately.
   */
  #directory(namespace: string): IRpcDirectory {
    return {
      schemaVersion: 3,
      self: this.#identity.directorySelf,
      nodeId: this.#nodeId,
      methods: this.#forwarder.describe(
        this.#providers.describe(namespace),
        this.#sessions.forwardTargets(namespace)
      )
    }
  }

  /** Installation admits namespace names before a transport can acquire any physical resources. */
  async #installTransport(
    core: IPluginHostCore,
    definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>
  ): Promise<void> {
    if (
      typeof definition.namespace !== 'string' ||
      !definition.namespace ||
      reservedNamespaces.has(definition.namespace)
    )
      throw tagRpcError(
        new TypeError(HostErrorText.namespaceInvalid),
        RpcCoreErrorCode.invalidConfig
      )
    /** Native use rejects duplicate definition names; only its same-name replace can reach here. */
    const previous = this.#namespaces.get(definition.namespace)
    if (
      this.#pendingNamespaces.has(definition.namespace) ||
      (previous && previous.definitionName !== definition.name)
    )
      throw tagRpcError(
        new TypeError(HostErrorText.namespaceDuplicate),
        RpcCoreErrorCode.hostNamespaceDuplicate
      )
    /** Native Feature guards and the original commit gate stay with the actual receiving host. */
    const integration = getPluginRuntimeIntegration(core)
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
      handshakeTimeoutMs: definition.handshakeTimeoutMs,
      nameAdmissionTimeoutMs: definition.nameAdmissionTimeoutMs,
      signal: controller.signal
    })
    /**
     * Namespace projection owns selection and calls while this resource scope owns registration
     * cleanup.
     */
    const namespace = new Namespace({
      name: definition.namespace,
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
      definitionName: definition.name,
      owner: namespace,
      resources,
      controller,
      sessionScope,
      provider
    }
    this.#pendingNamespaces.set(definition.namespace, registration)
    core.onDispose(async () => {
      await this.#providers.settleFailedGate(gate)
      await namespace.close(this.#reason)
    })
    /**
     * Only call-feature instances are interpreted here; media/pool features remain with their
     * transport.
     */
    const commitFeatures = this.#features.prepare(definition.namespace, definition.features ?? [])
    this.#flow.start()
    /** Native slot admission is the only way this namespace becomes part of the public host. */
    /** The transport receives lifecycle/session operations and owns every concrete media algorithm. */
    const transport: IRpcTransportSetupContext = {
      owner: core,
      configuredReport: this.#configuredReport,
      namespace: definition.namespace,
      signal: controller.signal,
      self: () => this.#identity.directorySelf,
      lookup: (address) => this.#sessions.lookup(definition.namespace, address),
      attach: (carrier, facts) => this.#attach(registration, carrier, facts),
      openPrivateSession: (carrier, facts, source, changed) =>
        this.#sessions.openPrivateSession(
          definition.namespace,
          carrier,
          facts,
          source,
          changed,
          sessionScope
        ),
      attachOrigin: (binding) =>
        this.#sessions.attachOrigin(definition.namespace, binding, sessionScope),
      detach: (handle, reason) => this.#sessions.detach(handle, reason),
      ping: (handle, options) => this.#sessions.ping(handle, options),
      drain: (handle, reason) => this.#sessions.drain(handle, reason),
      report: this.#report
    }
    /**
     * Pending native disposal closes real sessions before joining the installation it cancels.
     * Global close's original reason takes precedence over native disposal's operation reason.
     */
    const preparing = observeAbortSubscription(
      core.operation.signal,
      (reason) => void namespace.close(this.#closing ? this.#reason : reason).catch(this.#report),
      this.#report
    )
    core.onDispose(preparing.unsubscribe)
    /** Native rollback already owns attached sessions when asynchronous acquisition begins. */
    const installed = await definition.open(transport)
    preparing.unsubscribe()
    resources.own(installed, { force: () => installed.dispose() })
    registration.surface = this.#surface(
      namespace,
      definition.namespace,
      installed.namespaceExtensions
    )
    /** Compose all methods before native publication; a published namespace is immutable. */
    const slot = integration.acquireSharedSlot(definition.namespace, namespaceFamily, () =>
      this.#sharedSurface(registration.surface!)
    )
    slot.register(namespace, () => {
      this.#namespaces.set(definition.namespace, registration)
      this.#pendingNamespaces.delete(definition.namespace)
      this.#publications.get(slot.facade)!.surface = registration.surface!
      provider.commit()
      commitFeatures()
      this.#sessions.commit(registration.sessionScope)
      this.#everCommittedTransport = true
      gate.open()
    })
  }

  /** Every physical attachment joins the original native installation's existing lifecycle scope. */
  #attach(
    context: ITransportRegistration,
    carrier: IRpcCarrier,
    facts?: IRpcLocalSourceFacts
  ): IRpcSessionHandle {
    if (context.controller.signal.aborted) throw context.controller.signal.reason
    if (facts === undefined) this.#identity.admit({})
    /**
     * SessionTable creates and owns the one physical Session; the scope borrows only its cleanup
     * handle.
     */
    const handle = this.#sessions.attach(context.name, carrier, facts, context.sessionScope)
    context.resources.own(handle, { force: () => handle.close(this.#reason) })
    void handle.closed.then(
      () => context.resources.release(handle),
      (error) => {
        context.resources.release(handle)
        this.#report(error)
      }
    )
    return handle
  }

  /**
   * Native namespace publication contains only approved public calls and installed extension
   * methods.
   */
  #surface(
    namespace: Namespace,
    name: string,
    transportExtensions?: object
  ): Record<PropertyKey, unknown> {
    /** This namespace object enforces the public boundary; it is never a per-session peer facade. */
    const surface: Record<PropertyKey, unknown> = {}
    for (const key of reservedMethods)
      surface[key] = key === Symbol.asyncDispose ? namespace.close : Reflect.get(namespace, key)
    for (const extension of this.#flow.namespaceExtensions(name)) this.#extend(surface, extension)
    if (transportExtensions)
      this.#extend(surface, transportExtensions as Readonly<Record<string, unknown>>)
    return Object.freeze(surface)
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

  /** Installed native contributions cannot override mandatory namespace methods or one another. */
  #extend(surface: object, extension: Readonly<Record<string, unknown>>): void {
    for (const key of Reflect.ownKeys(extension)) {
      if (reservedMethods.has(key) || Object.hasOwn(surface, key))
        throw tagRpcError(
          new TypeError(HostErrorText.namespaceDuplicate),
          RpcCoreErrorCode.invalidConfig
        )
      /** Snapshot descriptors without running extension accessors. */
      const descriptor = Object.getOwnPropertyDescriptor(extension, key)!
      if (!Object.hasOwn(descriptor, 'value'))
        throw tagRpcError(
          new TypeError(HostErrorText.pluginInvalid),
          RpcCoreErrorCode.invalidConfig
        )
      Object.defineProperty(surface, key, { ...descriptor, configurable: false, writable: false })
    }
  }

  /**
   * Namespace close cancels acquisition before releasing every registered physical handle in
   * reverse.
   */
  async #releaseNamespace(registration: ITransportRegistration, reason: unknown): Promise<void> {
    registration.controller.abort(reason)
    if (this.#namespaces.get(registration.name) === registration) {
      this.#features.unregister(registration.name)
      this.#namespaces.delete(registration.name)
    }
    if (this.#pendingNamespaces.get(registration.name) === registration)
      this.#pendingNamespaces.delete(registration.name)
    /** Scope disposal preserves exact resource errors and attempts all original reverse releases. */
    const errors = await registration.resources.dispose()
    if (this.#namespaces.size === 0 && !this.#everCommittedTransport)
      this.#flow.reopenBeforeStartup()
    if (errors.length) {
      /** The original cleanup aggregate stays observable separately from construction's primary. */
      const cleanup = new AggregateError(
        errors.map((entry) => entry.error),
        HostErrorText.cleanupFailed
      )
      this.#report(cleanup)
      throw errors.length === 1
        ? errors[0]!.error
        : createRpcLifecycleError(RpcCoreErrorText.endpointDisposed, cleanup)
    }
  }

  /**
   * Global close joins the same stream/native/session owners and preserves every original cleanup
   * error.
   */
  async #release(): Promise<void> {
    await this.#sessions.quiesceOrigins(this.#reason)
    this.#controller.abort(this.#reason)
    this.#calls.close(this.#reason)
    this.#providers.close(this.#reason)
    /** Collection is bounded by actual owners, never an invented global rollback transaction. */
    const failures: unknown[] = []
    /** Start stream retirement before IO closes, then join it after queued physical writes settle. */
    const streamClosing = this.#streams.close(this.#reason)
    /** Observe immediately while native release settles any writes that stream cleanup is awaiting. */
    const streamResult = streamClosing.catch((error: unknown) => {
      failures.push(error)
    })
    try {
      await this.#sessions.close(this.#reason)
    } catch (error) {
      failures.push(error)
    }
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
