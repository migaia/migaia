/** Own accepted identity/name indexes; Session owns the actual carrier and codec lifecycle. */
import { deferred, type IDeferred, type IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import type { ILifecycleScope } from '@migaia/lifecycle'
import type {
  IRpcCarrier,
  IRpcAuthenticationRetain,
  IRpcConnectionContext,
  IRpcTransportDefinition,
  IRpcLocalSourceFacts,
  IRpcNativeGeneration,
  IRpcPingOptions,
  IRpcSessionHandle,
  IRpcSessionView,
  IRpcAttachedSession,
  IRpcSessionSelection,
  IRpcTargetSource,
  IRpcPrivateSession,
  IRpcOriginBinding,
  IRpcOriginHandle,
  IRpcTransportContext,
  RpcSessionRetirement
} from '@migaia/rpc-contract/interfaces'
import type { IRpcDirectory, IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  RpcCoreErrorText,
  tagRpcError,
  identifyRpcBoundaryFailure
} from '@migaia/rpc-contract/errors'
import {
  createRpcError,
  createRpcConfigurationError,
  createRpcLifecycleError
} from '../host/error-owner.js'
import { HostErrorText } from '../host/error-text.js'
import { Session } from './session.js'
import { SessionText } from './text.js'
import type { IRpcPipelineOwner } from '../sdk/flow-pipelines.js'
import type { IProviderCommitGate } from '../dispatch/types.js'
import { SessionDrain } from './drain.js'
import { OriginSession } from './origin.js'
import { createSessionView } from './view.js'
import { isRpcCarrierAdmissionFailure } from '../sdk/carrier/admission.js'
import {
  SessionAvailability,
  publishSessionReadiness,
  closeSessionReadiness,
  type ISessionAvailabilityIndex
} from './availability.js'
import type {
  IRpcSessionOptions,
  IRpcSessionFlow,
  IRpcSessionScope,
  IRpcSessionTableOptions,
  IRpcSessionWriteOptions,
  IRpcClosingHandler,
  IRpcPeerClosedHandler
} from './types.js'

/** Namespace admission protects the Host's lifecycle methods before transport setup begins. */
const reservedNamespaces = new Set(['self', 'provide', 'close', 'use', 'dispose', 'unUse'])

/** One namespace has independent direct instance and display-name domains. */
type INamespaceIndex = ISessionAvailabilityIndex & {
  peers: Map<string, IRpcSessionSelection>
  names: Map<string, IRpcSessionSelection>
  probing: Map<string, string>
  /** Unpublished peer ids remain reserved while their original accept write is still pending. */
  pendingPeers: Map<string, string>
  /** One native departure per accepted name retains its exact original admission failure. */
  departed: Map<string, Readonly<{ carrierId: string; reason: unknown }>>
}

/** Native callbacks retain their original scope index after a successor becomes canonical. */
type ISessionAttachment = {
  carrierId: string
  namespace: string
  index: INamespaceIndex
  published: boolean
  /** Only the original native registration may update its later terminal departure fact. */
  native?: boolean
  /** The actual accepted name remains attached to this handle after live publication retires. */
  name?: string
  /** The actual source lends its complete native wall feature without a second host timer. */
  callTimeoutCap?: IRpcSessionView['callTimeoutCap']
  /** The exact native query remains live when Root reconstructs admitted dispatch context. */
  isExclusive?: IRpcSessionView['isExclusive']
  /** Physical attachments join their original registration's lifecycle membership. */
  scope?: IStagedSessions
}

/** One staged native registration retains its original physical lifetimes and event handlers. */
type IStagedSessions = Readonly<{
  namespace: string
  index: INamespaceIndex
  signal?: IAbortSignal
  /** Exact transport registration owns both execution authority and negotiation facts. */
  pipelines?: () => IRpcPipelineOwner
  flow?: IRpcSessionFlow
  gate?: IProviderCommitGate
  parent?: IStagedSessions
  handshakeTimeoutMs?: number
  nameAdmissionTimeoutMs?: number
  /** Appended sources inherit this local default without retaining any connection credentials. */
  retain?: IRpcAuthenticationRetain
  sessions: Set<Session>
  closing: Set<IRpcClosingHandler>
  peerClosed: Set<IRpcPeerClosedHandler>
}>

/** Full and appended registration scopes use the same native signal and connect policy fields. */
type ISessionScopeOptions = Pick<IRpcSessionTableOptions, 'handshakeTimeoutMs'> & {
  signal?: IAbortSignal
  nameAdmissionTimeoutMs?: number
  connect?: IRpcTransportDefinition['connect']
  parent?: IRpcSessionScope
  /** Appended sources inherit these same native transport-owned collaborators. */
  pipelines?: () => IRpcPipelineOwner
  flow?: IRpcSessionFlow
  gate?: IProviderCommitGate
}

/** Existing resource ownership and exact scope identity supply native context methods. */
type ISessionTransportPorts = Readonly<{
  table: SessionTable
  scope: IRpcSessionScope
  staged: IStagedSessions
  resources: ILifecycleScope
  closeReason(): unknown
  self: IRpcTransportContext['self']
  report: IRpcTransportContext['report']
}>

/** Native transport callbacks borrow the one SessionTable and original installation resource scope. */
class SessionTransportContext implements IRpcTransportContext {
  /**
   * Explicit original scope/resource references prevent context callbacks from owning another
   * index.
   */
  readonly #ports: ISessionTransportPorts
  /** The cold registration supplies this fixed native namespace. */
  readonly namespace: string
  /** Acquisition cancellation remains the original native registration signal. */
  readonly signal: IAbortSignal
  /** Identity remains borrowed from the one Host owner. */
  readonly self: IRpcTransportContext['self']
  /** Native diagnostics keep the original selected reporter. */
  readonly report: IRpcTransportContext['report']

  /** Capture only original collaborators; constructing this context acquires no physical resource. */
  constructor(ports: ISessionTransportPorts) {
    this.#ports = ports
    this.namespace = ports.staged.namespace
    this.signal = ports.staged.signal!
    this.self = ports.self
    this.report = ports.report
  }
  /** Read canonical accepted identity without a native-side peer directory. */
  readonly lookup: IRpcTransportContext['lookup'] = (address) =>
    this.#ports.table.lookup(this.namespace, address)
  /** Direct native resources retain their original scope-owned handle and release receipt. */
  readonly attach: IRpcTransportContext['attach'] = (carrier, facts, connection) => {
    if (this.signal.aborted) throw this.signal.reason
    /** Empty source facts still let the original Host reconcile its default identity before hello. */
    const handle = this.#ports.table.attach(
      this.namespace,
      carrier,
      facts ?? {},
      this.#ports.scope,
      connection
    )
    this.#ports.resources.own(handle, { force: () => handle.close(this.#ports.closeReason()) })
    void handle.closed.finally(() => this.#ports.resources.release(handle)).catch(this.report)
    return handle
  }
  /** The original SDK candidate remains the sole owner of each private pool Session. */
  readonly openPrivateSession: IRpcTransportContext['openPrivateSession'] = (
    carrier,
    facts,
    source,
    changed,
    connection
  ) =>
    this.#ports.table.openPrivateSession(
      this.namespace,
      carrier,
      facts,
      source,
      changed,
      this.#ports.scope,
      connection
    )
  /** Logical origin publication borrows the existing staged index without acquiring media. */
  readonly attachOrigin: IRpcTransportContext['attachOrigin'] = (binding) =>
    this.#ports.table.attachOrigin(this.namespace, binding, this.#ports.scope)
  /** All native cleanup continues through the exact original Session handle. */
  readonly detach: IRpcTransportContext['detach'] = (handle, reason) =>
    this.#ports.table.detach(handle, reason)
  /** Original Session control exchanges remain the only native health mechanism. */
  readonly ping: IRpcTransportContext['ping'] = (handle, options) =>
    this.#ports.table.ping(handle, options)
  /** Existing business drain retains its original decreasing native grace. */
  readonly drain: IRpcTransportContext['drain'] = (handle, remainingMs) =>
    this.#ports.table.drain(handle, remainingMs)
}

/** One accepted entry contains descriptive selection and private attachment ownership. */
type IAdmittedSession = Readonly<{
  selection: IRpcSessionSelection
  attachment: ISessionAttachment
}>

/** Physical and logical entries share control ownership, while only Session has media. */
type ISessionResource = Pick<
  Session,
  'close' | 'send' | 'assertTransfer' | 'ping' | 'drain' | 'announceDirectory'
> &
  Readonly<{ handle: IRpcSessionHandle }>

/** The unique host table publishes no mutable Session or business request facade. */
export class SessionTable {
  /** Immutable narrow collaborators are shared with each physical connection. */
  readonly #options: IRpcSessionTableOptions
  /** Pending and accepted carriers have the same exact physical identity owner. */
  readonly #sessions = new Map<string, ISessionResource>()
  /** A lifecycle handle resolves directly without scanning physical sessions. */
  readonly #handles = new WeakMap<
    IRpcSessionHandle,
    Readonly<{ carrierId: string; session: ISessionResource; attachment?: ISessionAttachment }>
  >()
  /** Accepted namespace indexes support both instance and name lookup in constant time. */
  readonly #namespaces = new Map<string, INamespaceIndex>()
  /** Opaque registration tokens identify private indexes without duplicating physical Sessions. */
  readonly #scopes = new WeakMap<IRpcSessionScope, IStagedSessions>()
  /** Global name membership is maintained incrementally for unique cross-namespace forwarding. */
  readonly #globalNames = new Map<string, Map<string, IRpcSessionSelection>>()
  /** Carrier membership also owns the current immutable accepted view. */
  readonly #accepted = new Map<string, IAdmittedSession>()
  /** Accepted identities are reserved before their reply write and published only after it settles. */
  readonly #reserved = new Map<string, IRpcSessionSelection>()
  /** Only a genuine transport attachment can lend native generation observations to call features. */
  readonly #nativeGenerations = new Map<string, IRpcNativeGeneration>()
  /** One original business-drain owner tracks actual work independently of publication scope. */
  readonly #draining: SessionDrain
  /** Closing all namespaces joins one original Promise, including rejected physical cleanup. */
  #closing: IDeferred<void> | undefined
  /** Every Session receives the same immutable normalized keepalive policy. */
  readonly #keepalive: Readonly<{ maxBytes: number; timeoutMs: number }>

  /** Capture host authority before any physical source can subscribe or send hello. */
  constructor(options: IRpcSessionTableOptions) {
    /** Validate close budgets before any source, Session or lifecycle timer can be acquired. */
    const keepalive = {
      maxBytes: options.keepalive?.maxBytes ?? 65536,
      timeoutMs: options.keepalive?.timeoutMs ?? 1000
    }
    for (const value of [keepalive.maxBytes, keepalive.timeoutMs])
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1)
        throw createRpcConfigurationError(RpcCoreErrorText.keepaliveInvalid)
    this.#keepalive = Object.freeze(keepalive)
    this.#options = options
    this.#draining = new SessionDrain({
      scheduler: options.scheduler ?? systemScheduler,
      report: options.report
    })
  }

  /**
   * Reject invalid names before flow setup, borrowing the original pending map without retaining
   * it.
   */
  admitNamespace(namespace: string, pending: ReadonlyMap<string, unknown>): void {
    if (typeof namespace !== 'string' || !namespace || reservedNamespaces.has(namespace))
      throw tagRpcError(
        new TypeError(HostErrorText.namespaceInvalid),
        RpcCoreErrorCode.invalidConfig
      )
    if (pending.has(namespace))
      throw tagRpcError(
        new TypeError(HostErrorText.namespaceDuplicate),
        RpcCoreErrorCode.hostNamespaceDuplicate
      )
  }

  /** Prepare a namespace candidate without publishing peers, global names or readiness events. */
  stage(namespace: string, options?: ISessionScopeOptions): IRpcSessionScope {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    /** Validate cold native connect policy before a transport acquires any physical source. */
    const handshakeTimeoutMs = options?.handshakeTimeoutMs
    for (const timeout of [handshakeTimeoutMs, options?.nameAdmissionTimeoutMs])
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0))
        throw tagRpcError(
          new TypeError(HostErrorText.connectTimeoutInvalid),
          RpcCoreErrorCode.invalidConfig
        )
    /** Only token identity crosses the native registration boundary. */
    const scope = Object.freeze({})
    /** Appended sources borrow canonical identity indexes and retain their own resource scope. */
    const parent = options?.parent === undefined ? undefined : this.#scopes.get(options.parent)!
    /** Only omission inherits; false and invalid runtime values remain Auth's explicit inputs. */
    const retain = options?.connect?.retain
    this.#scopes.set(scope, {
      namespace,
      index: parent?.index ?? this.#newIndex(options?.signal),
      signal: options?.signal,
      pipelines: options?.pipelines ?? parent?.pipelines,
      flow: options?.flow ?? parent?.flow,
      parent,
      gate: options?.gate,
      handshakeTimeoutMs,
      nameAdmissionTimeoutMs: options?.nameAdmissionTimeoutMs,
      retain: retain === undefined ? parent?.retain : retain,
      sessions: new Set(),
      closing: new Set(),
      peerClosed: new Set()
    })
    return scope
  }

  /** A source joins one cold namespace without allocating another identity index or replacing it. */
  stageAppend(
    parent: IRpcSessionScope,
    options: ISessionScopeOptions,
    gate: IProviderCommitGate
  ): IRpcSessionScope {
    return this.stage(this.#scopes.get(parent)!.namespace, { ...options, parent, gate })
  }

  /** Native source commit publishes only that registration's original reserved physical peers. */
  commitAppend(scope: IRpcSessionScope): void {
    /** One append transaction announces only after all of its actual public views are installed. */
    if (this.#publishPrepared(this.#scopes.get(scope)!))
      void this.announceDirectory().catch(this.#options.report)
  }

  /** Original scope members retain accepted reservations until their native commit gate opens. */
  #publishPrepared(staged: IStagedSessions): boolean {
    /** Public aliases are announced by the caller after every original reservation is processed. */
    let published = false
    for (const session of staged.sessions) {
      /** Existing handle identity supplies the attachment without another candidate index. */
      const input = this.#handles.get(session.handle)!.attachment
      /** Private pool Sessions join lifetime membership without publishing a direct attachment. */
      if (!input) continue
      /** Directory arbitration may still be in flight; only the accepted current view can publish. */
      const pending = this.#reserved.get(input.carrierId)
      if (pending && pending.view === session.current()?.view) {
        this.#publish(input, pending.view, false)
        published ||= input.published
      }
    }
    return published
  }

  /** Move only transport context wiring into the existing scope and Session owners. */
  context(
    scope: IRpcSessionScope,
    resources: ILifecycleScope,
    closeReason: () => unknown
  ): IRpcTransportContext {
    return new SessionTransportContext({
      table: this,
      scope,
      staged: this.#scopes.get(scope)!,
      resources,
      closeReason,
      self: this.#options.self,
      report: this.#options.report
    })
  }

  /** Closing listeners belong to the actual native registration, including same-name replacement. */
  onClosing(scope: IRpcSessionScope, handler: IRpcClosingHandler): () => void {
    /** Exact set identity prevents a stale remover from affecting a successor registration. */
    const handlers = this.#scopes.get(scope)!.closing
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  /** Remote departure listeners share that same original scope rather than a namespace-name index. */
  onPeerClosed(scope: IRpcSessionScope, handler: IRpcPeerClosedHandler): () => void {
    /** Registration lifetime alone determines which native departure events can reach this set. */
    const handlers = this.#scopes.get(scope)!.peerClosed
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  /** Native disposal finishes private closing hooks before this exact registration drops listeners. */
  releaseScope(scope: IRpcSessionScope): void {
    /** Root invokes this only after the original native resource scope has fully disposed. */
    const staged = this.#scopes.get(scope)
    if (!staged) return
    staged.closing.clear()
    staged.peerClosed.clear()
    this.#scopes.delete(scope)
  }

  /** Actual direct and private Session lifetimes determine whether selected Features remain in use. */
  hasOpenSessions(scope: IRpcSessionScope): boolean {
    return (this.#scopes.get(scope)?.sessions.size ?? 0) !== 0
  }

  /** Only the actual closing Session can grant bounded keepalive admission. */
  canKeepalive(carrierId: string): boolean {
    /** Logical origins select their private native media before querying this physical fact. */
    const session = this.#sessions.get(carrierId)
    return session instanceof Session && session.canKeepalive()
  }

  /** Native commit atomically swaps the canonical alias before announcing candidate readiness. */
  commit(scope: IRpcSessionScope): void {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    /** Only stage-created native tokens reach this internal commit operation. */
    const staged = this.#scopes.get(scope)!
    this.#publishPrepared(staged)
    /** Repeated same native commit cannot fabricate another accepted notification. */
    const previous = this.#namespaces.get(staged.namespace)
    if (previous === staged.index) return
    /** Old route publication ends at commit while its exact physical work remains addressable. */
    const hidden = previous ? [...previous.peers.values()] : []
    for (const selection of hidden) this.#unpublish(selection)
    this.#namespaces.set(staged.namespace, staged.index)
    /** Build every lookup before callbacks can observe any part of the committed namespace. */
    const selections = [...staged.index.peers.values()]
    for (const selection of selections) {
      this.#publishName(selection)
      this.#accepted.get(selection.carrierId)!.attachment.published = true
    }
    for (const selection of hidden) this.#options.hidden?.(selection.carrierId, selection.view)
    for (const selection of selections)
      if (
        !this.#closing &&
        this.#namespaces.get(staged.namespace) === staged.index &&
        this.#accepted.get(selection.carrierId)?.selection === selection
      ) {
        this.#options.accepted?.(selection.carrierId, selection.view)
        publishSessionReadiness(staged.index, selection.view.name)
      }
  }

  /** Bind native source facts once, then let the real Session subscribe before starting hello. */
  attach(
    namespace: string,
    carrier: IRpcCarrier,
    facts?: IRpcLocalSourceFacts,
    scope?: IRpcSessionScope,
    connection?: IRpcConnectionContext
  ): IRpcSessionHandle {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (this.#sessions.has(carrier.id))
      throw createRpcConfigurationError(RpcCoreErrorText.uuidConflict(carrier.id))
    /** Explicit attachment ownership survives namespace replacement without a Session facade. */
    const input: ISessionAttachment = {
      carrierId: carrier.id,
      namespace,
      index: scope === undefined ? this.#index(namespace) : this.#scopes.get(scope)!.index,
      published: false,
      callTimeoutCap: facts?.callTimeoutCap,
      isExclusive: facts?.isExclusive,
      scope: scope === undefined ? undefined : this.#scopes.get(scope)
    }
    /** Native resources receive only this Session's lifecycle handle. */
    const session = this.#createSession(namespace, carrier, facts, scope, {
      connection,
      admit: (directory, codec, extensions, authentication) =>
        this.#admit(input, directory, codec, extensions, authentication),
      publish: (view) => this.#publish(input, view),
      retire: (view, error, physicalFailure, closeFrame) =>
        this.#retire(input, view, error, physicalFailure, closeFrame)
    })
    this.#sessions.set(input.carrierId, session)
    this.#joinMembership(input.scope, session)
    if (facts?.nativeGeneration)
      this.#nativeGenerations.set(input.carrierId, facts.nativeGeneration)
    input.native = facts?.nativeGeneration !== undefined
    this.#handles.set(session.handle, { carrierId: input.carrierId, session, attachment: input })
    session.start()
    return session.handle
  }

  /** Construct exactly the same physical owner without adding any private member identity index. */
  openPrivateSession(
    namespace: string,
    carrier: IRpcCarrier,
    facts: IRpcLocalSourceFacts | undefined,
    source: IRpcTargetSource,
    changed?: () => void,
    scope?: IRpcSessionScope,
    connection?: IRpcConnectionContext
  ): IRpcPrivateSession {
    /** Private retirement borrows original inputs, including the native carrier's live id read. */
    const input = {
      carrier,
      source,
      changed,
      native: facts?.nativeGeneration !== undefined,
      scope: scope === undefined ? undefined : this.#scopes.get(scope)
    }
    const session = this.#createSession(namespace, carrier, facts, scope, {
      connection,
      source,
      changed,
      admit: async (directory, codec, extensions, authentication) =>
        createSessionView(
          namespace,
          directory,
          codec,
          extensions,
          authentication,
          facts?.callTimeoutCap,
          facts?.isExclusive
        ),
      publish: () => undefined,
      retire: (view, error, physicalFailure, closeFrame) => {
        this.#draining.retire(input.carrier.id)
        this.#options.retired?.(
          input.carrier.id,
          view,
          error,
          physicalFailure,
          false,
          input.source,
          input.native
        )
        if ((physicalFailure || closeFrame) && view)
          this.#notifyPeerClosed(input.scope, view, error, closeFrame)
        input.changed?.()
      }
    })
    /** Weak handle lookup retains the same physical owner without entering public identity indexes. */
    this.#handles.set(session.handle, { carrierId: carrier.id, session })
    this.#joinMembership(input.scope, session)
    session.start()
    return session.handle
  }

  /** Native composition publishes one logical entry without creating a codec or a handshake. */
  attachOrigin(
    namespace: string,
    binding: IRpcOriginBinding,
    scope?: IRpcSessionScope
  ): IRpcOriginHandle {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (this.#sessions.has(binding.id))
      throw createRpcConfigurationError(RpcCoreErrorText.uuidConflict(binding.id))
    const input: ISessionAttachment = {
      carrierId: binding.id,
      namespace,
      index: scope === undefined ? this.#index(namespace) : this.#scopes.get(scope)!.index,
      published: false
    }
    const session = new OriginSession(
      binding,
      (view) => {
        if (!this.#sessions.has(binding.id)) return
        const selection = Object.freeze({
          carrierId: binding.id,
          view,
          source: binding.source,
          origin: binding.origin
        })
        this.#reserved.set(binding.id, selection)
        this.#publish(input, view)
      },
      (error) => {
        if (this.#sessions.has(binding.id)) this.#retire(input, undefined, error)
      },
      this.#options.report
    )
    this.#sessions.set(binding.id, session)
    this.#handles.set(session.handle, { carrierId: binding.id, session })
    session.handle.update(binding.view)
    return session.handle
  }

  /** Every physical path shares configuration, clocks, provenance and original business drain. */
  #createSession(
    namespace: string,
    carrier: IRpcCarrier,
    facts: IRpcLocalSourceFacts | undefined,
    scope: IRpcSessionScope | undefined,
    callbacks: Pick<
      IRpcSessionOptions,
      'admit' | 'publish' | 'retire' | 'source' | 'changed' | 'connection'
    >
  ): Session {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (facts) this.#options.admitSourceFacts?.(facts)
    /** Direct and private physical sessions share one ingress/gate and lifecycle notification path. */
    const staged = scope === undefined ? undefined : this.#scopes.get(scope)
    /** Exact physical overrides win; invalid runtime values must reach Auth validation unchanged. */
    const retain = callbacks.connection?.retain
    /**
     * Adding a scope default preserves the original credentials and authentication value
     * identities.
     */
    const connection =
      retain === undefined && staged?.retain !== undefined
        ? { ...callbacks.connection, retain: staged.retain }
        : callbacks.connection
    /** Capture only accepted routing ports; never retain the callback object's native credentials. */
    const ingress = { owner: this, id: carrier.id, source: callbacks.source, scope: staged }
    /** Late native completions retain this physical owner's lifetime, including private media. */
    const session = new Session({
      ...callbacks,
      connection,
      receive: (view, frame) =>
        ingress.owner.#options.receive(
          ingress.id,
          view,
          frame,
          ingress.source,
          ingress.scope?.gate
        ),
      rejected:
        this.#options.rejected === undefined && ingress.source === undefined
          ? undefined
          : (view, frame, error) =>
              ingress.owner.#options.rejected?.(ingress.id, view, frame, error, ingress.source),
      closing: (view, reason) => ingress.owner.#notifyClosing(ingress.scope, view, reason),
      namespace,
      carrier,
      keepalive: this.#keepalive,
      expectedPeerId: facts?.expectedPeerId,
      sessionId: facts?.sessionId,
      isExclusive: facts?.isExclusive,
      flow: staged?.flow ?? this.#options.flow,
      pipelines: staged?.pipelines ?? this.#options.pipelines,
      self: this.#options.self,
      directory: (peerId) => this.#options.directory(namespace, peerId),
      /** Final write sealing precedes synchronous retirement callbacks and controller abort. */
      track: (promise) =>
        session.closing && !session.canKeepalive()
          ? promise
          : this.#draining.track(carrier.id, promise),
      draining: (remainingMs, announce) => this.#draining.drain(carrier.id, remainingMs, announce),
      report: this.#options.report,
      scheduler: this.#options.scheduler ?? systemScheduler,
      timestamp: this.#options.timestamp ?? (() => systemWallClock.timestamp()),
      maxFrameBytes: this.#options.maxFrameBytes ?? SessionText.defaultMaxFrameBytes,
      controlTimeoutMs: this.#options.controlTimeoutMs ?? SessionText.defaultControlTimeoutMs,
      handshakeTimeoutMs:
        (scope === undefined ? undefined : this.#scopes.get(scope)!.handshakeTimeoutMs) ??
        this.#options.handshakeTimeoutMs
    })
    return session
  }

  /** Explicit names retain priority over an instance fallback, including unusual caller names. */
  get(namespace: string, peerOrName: string): IRpcSessionSelection | undefined {
    /** Namespace membership is read once per addressed lookup. */
    const index = this.#namespaces.get(namespace)
    return index?.names.get(peerOrName) ?? index?.peers.get(peerOrName)
  }

  /** Business selection preserves actual native departure errors without changing readonly lookup. */
  select(namespace: string, address: string): IRpcSessionSelection | undefined {
    /** Live replacements always take precedence over the previous name's departure. */
    const selection = this.get(namespace, address)
    /** A terminal native source rejects immediately while its same physical close still settles. */
    const departed = this.#namespaces.get(namespace)?.departed.get(address)
    if (departed && (!selection || departed.carrierId === selection.carrierId))
      throw departed.reason
    return selection
  }

  /** Actual physical transfer capability is checked before callers read options or capture data. */
  assertTransfer(carrierId: string, options?: object): void {
    this.#sessions.get(carrierId)?.assertTransfer(options)
  }

  /** Native resources attach metadata to the original handle while selection stays in this index. */
  lookup(namespace: string, address: string): IRpcAttachedSession | undefined {
    /** Both reads borrow existing state; caller queries cannot publish or retarget a session. */
    const selected = this.get(namespace, address)
    /** The original handle remains stable when a directory update replaces its descriptive view. */
    const session = selected && this.#sessions.get(selected.carrierId)
    return session && { handle: session.handle, view: selected.view }
  }

  /** Only accepted current physical sources can be selected for business work. */
  getById(carrierId: string): IRpcSessionSelection | undefined {
    return this.#accepted.get(carrierId)?.selection
  }

  /** Only the directory accepted for this exact carrier can supply forwarding loop identity. */
  nodeId(carrierId: string): string | undefined {
    return this.#accepted.get(carrierId)?.selection.view.nodeId
  }

  /** Native lifecycle authority is never reconstructed from accepted wire metadata or error codes. */
  nativeGeneration(carrierId: string): IRpcNativeGeneration | undefined {
    return this.#nativeGenerations.get(carrierId)
  }

  /** Origin features borrow actual accepted readiness without inventing ordinary generations. */
  availability(namespace: string, name: string, carrierId: string, source?: IRpcTargetSource) {
    return new SessionAvailability({
      index: this.#namespaces.get(namespace)!,
      name,
      carrierId,
      source,
      native: source?.nativeGeneration(carrierId) ?? this.#nativeGenerations.get(carrierId),
      generation: (id) => source?.nativeGeneration(id) ?? this.#nativeGenerations.get(id),
      currentIndex: () => this.#namespaces.get(namespace),
      signal: (id) => {
        /** Only physical Sessions own a controller; logical origins select media before this port. */
        const session = this.#sessions.get(id)
        return session instanceof Session ? session.signal : undefined
      },
      report: this.#options.report
    })
  }

  /** Enumeration visits each accepted direct peer once within its requested namespace. */
  values(namespace: string): readonly IRpcSessionSelection[] {
    return [...(this.#namespaces.get(namespace)?.peers.values() ?? [])]
  }

  /** A cold directory snapshot advertises local names first, otherwise only unique global names. */
  *forwardTargets(namespace: string): IterableIterator<IRpcSessionSelection> {
    for (const [name, candidates] of this.#globalNames) {
      /**
       * The same canonical selection rule serves discovery without throwing for unrelated
       * ambiguity.
       */
      const local = this.#namespaces.get(namespace)?.names.get(name)
      if (local) yield local
      else if (candidates.size === 1) yield candidates.values().next().value!
    }
  }

  /** A namespace-local name wins; global forwarding requires exactly one live matching name. */
  resolveForward(namespace: string, name: string): IRpcSessionSelection | undefined {
    /** The maintained local name index avoids a session scan on forwarded calls. */
    const local = this.#namespaces.get(namespace)?.names.get(name)
    if (local) return local
    /** Global membership is updated on acceptance, rename and retirement only. */
    const candidates = this.#globalNames.get(name)
    if (!candidates) return undefined
    if (candidates.size !== 1)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RpcCoreErrorText.unknownTarget(name))
    return candidates.values().next().value
  }

  /** Call records retain carrier ids; this owner resolves the current actual write resource. */
  send(
    carrierId: string,
    frame: IRpcSemanticFrame,
    options?: IRpcSessionWriteOptions
  ): Promise<void> {
    return this.#session(carrierId).send(frame, options)
  }

  /** Native supervisors and namespace controls share the same Session-owned control exchange. */
  ping(target: string | IRpcSessionHandle, options?: IRpcPingOptions): Promise<void> {
    return this.#session(target).ping(options)
  }

  /** The source's remaining grace is transmitted without refreshing its deadline. */
  drain(target: string | IRpcSessionHandle, remainingMs: number): Promise<void> {
    /** Handle identity resolves the original carrier even after a same-name replacement. */
    const session = this.#session(target)
    /** No Session facade or alternate business tracker is created for a native drain. */
    const carrierId = typeof target === 'string' ? target : this.#handles.get(target)!.carrierId
    if (session instanceof Session ? session.closing : this.#sessions.get(carrierId) !== session)
      return Promise.resolve()
    return this.#draining.drain(carrierId, remainingMs, (budget) => session.drain(budget))
  }

  /** Track the exact real business completion without replacing its native Promise. */
  track<T>(carrierId: string, promise: Promise<T>): Promise<T> {
    return this.#sessions.has(carrierId) ? this.#draining.track(carrierId, promise) : promise
  }

  /** Every current accepted source announces once; one failed write cannot suppress other peers. */
  async announceDirectory(namespace?: string, excludedCarrierId?: string): Promise<void> {
    /** Snapshot the actual current sessions before any asynchronous write can retire a source. */
    const writes: Promise<void>[] = []
    for (const { selection } of this.#accepted.values())
      if (
        selection.carrierId !== excludedCarrierId &&
        (namespace === undefined || selection.view.namespace === namespace)
      )
        writes.push(this.#session(selection.carrierId).announceDirectory())
    /** The caller reports the first original rejection; this owner reports only additional failures. */
    await this.#joinOperations(writes, false)
  }

  /** A native source retires its exact handle, never an unrelated same-name replacement. */
  detach(
    handle: string | IRpcSessionHandle,
    reason?: unknown,
    kind?: RpcSessionRetirement
  ): Promise<void> {
    /** A terminal native event can follow physical EOF without closing the resource a second time. */
    const input = typeof handle === 'string' ? undefined : this.#handles.get(handle)?.attachment
    if (input?.native && input.name && isRpcCarrierAdmissionFailure(reason) && !this.#closing) {
      /** Never let a late old generation replace a successor's current or retired admission fact. */
      const current = input.index.names.get(input.name)
      /** Only an explicit name keeps a late departure reason after its physical source leaves. */
      const departed = input.index.departed.get(input.name)
      if (
        (current?.carrierId === input.carrierId && current.view.name !== current.view.peerId) ||
        departed?.carrierId === input.carrierId
      )
        input.index.departed.set(input.name, { carrierId: input.carrierId, reason })
    }
    /** Only trusted local policy producers select the actual physical carrier's retirement mapper. */
    const session =
      typeof handle === 'string' ? this.#session(handle) : this.#handles.get(handle)?.session
    if (kind !== undefined && session instanceof Session) return session.close(reason, kind)
    return typeof handle === 'string' ? this.#session(handle).close(reason) : handle.close(reason)
  }

  /** The original native registration joins physical Sessions before aborting acquired media. */
  closeScope(scope: IRpcSessionScope, reason?: unknown): Promise<void> {
    /** Direct and private members keep their same idempotent Session close Promises. */
    const staged = this.#scopes.get(scope)!
    /** Snapshot before native callbacks can remove their exact closing resource from membership. */
    return this.#joinOperations([...staged.sessions].map((session) => session.close(reason)))
  }

  /** Join logical origins and already-started physical drains before aborting accepted business. */
  async quiesce(reason?: unknown): Promise<void> {
    /** Native registration cleanup later joins these same close Promises and owns their errors. */
    const closing: Promise<void>[] = []
    for (const { selection } of this.#accepted.values())
      if (selection.origin)
        closing.push((this.#session(selection.carrierId) as OriginSession).quiesce(reason))
    closing.push(this.#draining.quiesce())
    await Promise.allSettled(closing)
  }

  /** Close joins every owned physical Promise once; primary retirement errors reach work callbacks. */
  readonly close = (reason?: unknown): Promise<void> => {
    if (this.#closing) return this.#closing.promise
    this.#closing = deferred<void>()
    this.#draining.close()
    for (const index of this.#namespaces.values())
      closeSessionReadiness(
        index,
        reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      )
    for (const index of this.#namespaces.values()) index.departed.clear()
    /** Snapshot close operations before their synchronous retire callbacks mutate membership. */
    const closes: Promise<void>[] = []
    for (const session of this.#sessions.values()) closes.push(session.close(reason))
    void this.#joinOperations(closes).then(this.#closing.resolve, this.#closing.reject)
    return this.#closing.promise
  }

  /**
   * Original IO operations share one join policy; directory callers report their primary
   * themselves.
   */
  async #joinOperations(operations: readonly Promise<void>[], reportPrimary = true): Promise<void> {
    /** Every operation settles before the exact first failure returns to its original caller. */
    const results = await Promise.allSettled(operations)
    /** All failures remain reported while the first exact rejection owns the close result. */
    let failure: { reason: unknown } | undefined
    for (const result of results)
      if (result.status === 'rejected') {
        if (failure || reportPrimary) this.#options.report(result.reason)
        failure ??= result
      }
    if (failure) throw failure.reason
  }

  /** Resolve only genuine held handles and current physical ids in constant time. */
  #session(target: string | IRpcSessionHandle): ISessionResource {
    /** Handles are identity-indexed and cannot be replaced by a caller-shaped peer facade. */
    const session =
      typeof target === 'string' ? this.#sessions.get(target) : this.#handles.get(target)?.session
    if (!session) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    return session
  }

  /** Cold admission creates a namespace index only when a physical source presents its directory. */
  #index(namespace: string): INamespaceIndex {
    /** Installed namespace identity remains stable while its current selections come and go. */
    let index = this.#namespaces.get(namespace)
    if (!index) {
      index = this.#newIndex()
      this.#namespaces.set(namespace, index)
    }
    return index
  }

  /** Both staged and directly published namespaces use the same exact native identity indexes. */
  #newIndex(signal?: IAbortSignal): INamespaceIndex {
    return {
      peers: new Map(),
      names: new Map(),
      probing: new Map(),
      pendingPeers: new Map(),
      departed: new Map(),
      waiting: new Map(),
      signal
    }
  }

  /** Admit one name with the retained single ping arbitration, then publish immutable lookup data. */
  async #admit(
    input: ISessionAttachment,
    directory: IRpcDirectory,
    codec: string,
    extensions: readonly string[],
    authentication?: IRpcSessionView['authentication']
  ): Promise<IRpcSessionView> {
    /** The candidate remains unpublished until every awaited arbitration succeeds. */
    const session = this.#sessions.get(input.carrierId) as Session
    /** Only this namespace's identical display name can trigger a liveness probe. */
    const index = input.index
    /** The same carrier may replace its method directory without re-probing its own name. */
    const previous =
      index.names.get(directory.self.name) ?? index.peers.get(directory.self.instanceId)
    /** Two different existing selections cannot be silently collapsed into one direct identity. */
    const peer = index.peers.get(directory.self.instanceId)
    if (
      (peer && peer.carrierId !== input.carrierId) ||
      (index.pendingPeers.has(directory.self.instanceId) &&
        index.pendingPeers.get(directory.self.instanceId) !== input.carrierId)
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.uuidConflict(directory.self.instanceId)
      )
    if (
      index.probing.has(directory.self.name) &&
      index.probing.get(directory.self.name) !== input.carrierId
    )
      throw this.#duplicate()
    /** Method lookup is compiled once, and provisional identity is releasable during a health wait. */
    const view = createSessionView(
      input.namespace,
      directory,
      codec,
      extensions,
      authentication,
      input.callTimeoutCap,
      input.isExclusive
    )
    /** Retirement can find this reservation even while the previous peer's ping is pending. */
    const selection = Object.freeze({ carrierId: input.carrierId, view })
    this.#releaseReservation(input)
    index.probing.set(directory.self.name, input.carrierId)
    index.pendingPeers.set(directory.self.instanceId, input.carrierId)
    this.#reserved.set(input.carrierId, selection)
    try {
      if (previous && previous.carrierId !== input.carrierId) {
        /** Failure retains the original ping error in diagnostics before replacing a dead source. */
        const timeoutMs = session.beginAdmission(
          input.scope?.nameAdmissionTimeoutMs ??
            this.#options.nameProbeTimeoutMs ??
            SessionText.defaultNameProbeTimeoutMs
        )
        /** The old peer's deadline must settle before the candidate's equal-duration timer. */
        const probe = this.#session(previous.carrierId)
          .ping({
            timeoutMs,
            signal: session.signal
          })
          .then(
            () => true,
            (error) => {
              this.#options.report(error)
              return false
            }
          )
        await session.announceAdmission()
        const alive = await probe
        if (session.closing || this.#closing || this.#sessions.get(input.carrierId) !== session)
          throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
        if (alive) throw this.#duplicate()
        await this.#sessions.get(previous.carrierId)?.close()
      }
      if (session.closing || this.#closing || this.#sessions.get(input.carrierId) !== session)
        throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      return view
    } catch (error) {
      this.#releaseReservation(input, selection)
      throw error
    }
  }

  /** A ready reply's actual write is the sole publication point for its reserved identity. */
  #publish(input: ISessionAttachment, view: IRpcSessionView, announce = true): void {
    /** Retirement removes the reservation, so late codecs cannot revive a closed connection. */
    const selection = this.#reserved.get(input.carrierId)
    if (!selection || selection.view !== view || this.#closing)
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (input.scope?.gate && !input.scope.gate.isOpen()) return
    const index = input.index
    /** Existing views are removed before a rename can publish its new lookup keys. */
    const old = this.#accepted.get(input.carrierId)?.selection
    if (old) this.#unindex(old, index)
    index.peers.set(view.peerId, selection)
    index.names.set(view.name, selection)
    input.name = view.name
    index.departed.delete(view.name)
    this.#accepted.set(input.carrierId, { selection, attachment: input })
    this.#releaseReservation(input, selection)
    if (this.#namespaces.get(input.namespace) !== index) return
    input.published = true
    this.#publishName(selection)
    if (old) this.#options.updated?.(input.carrierId, view)
    else {
      this.#options.accepted?.(input.carrierId, view)
      publishSessionReadiness(index, view.name)
    }
    /** The incoming peer already owns this view; only other current peers need the new catalog. */
    if (announce)
      void this.announceDirectory(undefined, input.carrierId).catch(this.#options.report)
  }

  /** Only canonical publication contributes to cross-namespace forwarding selection. */
  #publishName(selection: IRpcSessionSelection): void {
    /** Global uniqueness is maintained at admission rather than scanned during forwarding. */
    let global = this.#globalNames.get(selection.view.name)
    if (!global) {
      global = new Map()
      this.#globalNames.set(selection.view.name, global)
    }
    global.set(selection.carrierId, selection)
  }

  /** Original public duplicate-name code/text remain stable under the new index owner. */
  #duplicate(): Error {
    return createRpcError(RpcCoreErrorCode.hostPeerNameDuplicate, HostErrorText.peerNameDuplicate)
  }

  /** One original admission receipt releases both unpublished identity domains on every outcome. */
  #releaseReservation(input: ISessionAttachment, expected?: IRpcSessionSelection): void {
    /** The reservation is private until physical acceptance; public routing never reads it. */
    const reserved = this.#reserved.get(input.carrierId)
    if (!reserved || (expected && reserved !== expected)) return
    if (input.index.probing.get(reserved.view.name) === input.carrierId)
      input.index.probing.delete(reserved.view.name)
    if (input.index.pendingPeers.get(reserved.view.peerId) === input.carrierId)
      input.index.pendingPeers.delete(reserved.view.peerId)
    this.#reserved.delete(input.carrierId)
  }

  /** Remove exactly this selection; stale retirements cannot erase a replacement's indexes. */
  #unindex(selection: IRpcSessionSelection, index: INamespaceIndex): void {
    /** Reentrant admission may already have replaced either key with a different carrier. */
    if (index.peers.get(selection.view.peerId) === selection)
      index.peers.delete(selection.view.peerId)
    if (index.names.get(selection.view.name) === selection) index.names.delete(selection.view.name)
    this.#unpublish(selection)
  }

  /** Unpublishing an old scope cannot delete a successor's independent carrier contribution. */
  #unpublish(selection: IRpcSessionSelection): void {
    /** Name membership has no stale strong references after this physical source retires. */
    const global = this.#globalNames.get(selection.view.name)
    if (global?.get(selection.carrierId) === selection) global.delete(selection.carrierId)
    if (global?.size === 0) this.#globalNames.delete(selection.view.name)
  }

  /** Synchronous retirement stops new selection before physical cleanup can await native work. */
  #retire(
    input: ISessionAttachment,
    view: IRpcSessionView | undefined,
    error: unknown,
    physicalFailure = false,
    closeFrame?: Readonly<{ reason: unknown }>
  ): void {
    /** A pending candidate also owns a real carrier and must leave the by-id table. */
    const selection = this.#accepted.get(input.carrierId)?.selection
    /** Received peer reasons remain distinct from this Session's already-started local primary. */
    const peerReason = closeFrame ? closeFrame.reason : error
    if (
      selection &&
      selection.view.name !== selection.view.peerId &&
      !this.#closing &&
      !input.index.departed.has(selection.view.name)
    )
      input.index.departed.set(selection.view.name, {
        carrierId: input.carrierId,
        reason: peerReason
      })
    if (selection) this.#unindex(selection, input.index)
    /** A candidate waiting on its actual reply write also releases its reserved name. */
    this.#releaseReservation(input)
    this.#accepted.delete(input.carrierId)
    this.#nativeGenerations.delete(input.carrierId)
    this.#sessions.delete(input.carrierId)
    this.#draining.retire(input.carrierId)
    this.#options.retired?.(
      input.carrierId,
      selection?.view ?? view,
      error,
      physicalFailure,
      input.published,
      undefined,
      input.native
    )
    /** Live peers must withdraw the departed source from their next callable directory. */
    if (selection && input.published && !this.#closing)
      void this.announceDirectory().catch(this.#options.report)
    if ((physicalFailure || closeFrame) && (selection?.view ?? view))
      this.#notifyPeerClosed(input.scope, (selection?.view ?? view)!, error, closeFrame)
  }

  /** Both direct and private Sessions borrow one original scope membership until actual cleanup. */
  #joinMembership(scope: IStagedSessions | undefined, session: Session): void {
    if (!scope) return
    scope.sessions.add(session)
    scope.parent?.sessions.add(session)
    void session.handle.closed.then(
      () => this.#releaseMembership(scope, session),
      () => this.#releaseMembership(scope, session)
    )
  }

  /** The original physical cleanup Promise releases both direct and private scope membership. */
  #releaseMembership(scope: IStagedSessions, session: Session): void {
    scope.sessions.delete(session)
    scope.parent?.sessions.delete(session)
  }

  /** Handler failure is diagnostic only; Session retains its one bounded close transaction. */
  async #notifyClosing(
    scope: IStagedSessions | undefined,
    view: IRpcSessionView,
    reason: unknown
  ): Promise<void> {
    if (!scope) return
    scope = scope.parent ?? scope
    /** The same original Error supplies both the readable reason and complete causal chain. */
    const event = Object.freeze({
      peer: view,
      reason,
      ...(reason instanceof Error ? { error: reason } : {})
    })
    /** A handler added reentrantly belongs to the next closing event, keeping this event linear. */
    const handlers = [...scope.closing]
    for (const handler of handlers)
      try {
        await handler(event)
      } catch (error) {
        this.#handlerFailed(error)
      }
  }

  /** Only remote wire close or real physical loss emits this original scope's departure event. */
  #notifyPeerClosed(
    scope: IStagedSessions | undefined,
    view: IRpcSessionView,
    localReason: unknown,
    closeFrame?: Readonly<{ reason: unknown }>
  ): void {
    if (!scope) return
    scope = scope.parent ?? scope
    /** An observed remote close remains separate from an already-started local primary. */
    const reason = closeFrame ? closeFrame.reason : localReason
    /** Actual close-frame receipt is an ingress fact and is never guessed from an error code. */
    const event = Object.freeze({
      peer: view,
      reason,
      closeFrame: closeFrame !== undefined,
      ...(reason instanceof Error ? { error: reason } : {})
    })
    /** New registrations during a callback cannot extend the current departure dispatch. */
    const handlers = [...scope.peerClosed]
    for (const handler of handlers)
      try {
        void Promise.resolve(handler(event)).catch(this.#handlerFailed)
      } catch (error) {
        this.#handlerFailed(error)
      }
  }

  /**
   * Callback failures keep their original identity and causal chain under the canonical boundary
   * code.
   */
  readonly #handlerFailed = (error: unknown): void => {
    this.#options.report(
      identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.callbackFailed,
        RpcCoreErrorText.callbackFailed
      )
    )
  }
}
