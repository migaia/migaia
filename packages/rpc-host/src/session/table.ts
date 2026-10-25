/** Own accepted identity/name indexes; Session owns the actual carrier and codec lifecycle. */
import { deferred, type IDeferred, type IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import type {
  IRpcCarrier,
  IRpcConnectionContext,
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
  IRpcOriginHandle
} from '@migaia/rpc-contract/interfaces'
import type { IRpcDirectory, IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, tagRpcError } from '@migaia/rpc-contract/errors'
import {
  createRpcError,
  createRpcConfigurationError,
  createRpcLifecycleError
} from '../host/error-owner.js'
import { HostErrorText } from '../host/error-text.js'
import { Session } from './session.js'
import { SessionText } from './text.js'
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
  IRpcSessionScope,
  IRpcSessionTableOptions,
  IRpcSessionWriteOptions
} from './types.js'

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

/** Pending admission retains only descriptive node identity in addition to the eventual view. */
type IReservedSession = IRpcSessionSelection & Readonly<{ nodeId?: string }>

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
  /** A transport may retain its original connect budget independently from negotiation. */
  nameAdmissionTimeoutMs?: number
  /** The actual source lends its complete native wall feature without a second host timer. */
  callTimeoutCap?: IRpcSessionView['callTimeoutCap']
  /** The exact native query remains live when Root reconstructs admitted dispatch context. */
  isExclusive?: IRpcSessionView['isExclusive']
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
  readonly #scopes = new WeakMap<
    IRpcSessionScope,
    Readonly<{
      namespace: string
      index: INamespaceIndex
      handshakeTimeoutMs?: number
      nameAdmissionTimeoutMs?: number
    }>
  >()
  /** Global name membership is maintained incrementally for unique cross-namespace forwarding. */
  readonly #globalNames = new Map<string, Map<string, IRpcSessionSelection>>()
  /** Carrier membership also owns the current immutable accepted view. */
  readonly #accepted = new Map<string, IAdmittedSession>()
  /** Accepted identities are reserved before their reply write and published only after it settles. */
  readonly #reserved = new Map<string, IReservedSession>()
  /** Forwarding consults the actual accepted direct directory's node id without retaining it whole. */
  readonly #nodeIds = new Map<string, string>()
  /** Only a genuine transport attachment can lend native generation observations to call features. */
  readonly #nativeGenerations = new Map<string, IRpcNativeGeneration>()
  /** One original business-drain owner tracks actual work independently of publication scope. */
  readonly #draining: SessionDrain
  /** Closing all namespaces joins one original Promise, including rejected physical cleanup. */
  #closing: IDeferred<void> | undefined

  /** Capture host authority before any physical source can subscribe or send hello. */
  constructor(options: IRpcSessionTableOptions) {
    this.#options = options
    this.#draining = new SessionDrain({
      scheduler: options.scheduler ?? systemScheduler,
      report: options.report
    })
  }

  /** Prepare a namespace candidate without publishing peers, global names or readiness events. */
  stage(
    namespace: string,
    options?: Pick<IRpcSessionTableOptions, 'handshakeTimeoutMs'> & {
      signal?: IAbortSignal
      nameAdmissionTimeoutMs?: number
    }
  ): IRpcSessionScope {
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
    this.#scopes.set(scope, {
      namespace,
      index: this.#newIndex(options?.signal),
      handshakeTimeoutMs,
      nameAdmissionTimeoutMs: options?.nameAdmissionTimeoutMs
    })
    return scope
  }

  /** Native commit atomically swaps the canonical alias before announcing candidate readiness. */
  commit(scope: IRpcSessionScope): void {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    /** Only stage-created native tokens reach this internal commit operation. */
    const staged = this.#scopes.get(scope)!
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
      nameAdmissionTimeoutMs:
        scope === undefined ? undefined : this.#scopes.get(scope)!.nameAdmissionTimeoutMs,
      callTimeoutCap: facts?.callTimeoutCap,
      isExclusive: facts?.isExclusive
    }
    /** Native resources receive only this Session's lifecycle handle. */
    const session = this.#createSession(namespace, carrier, facts, scope, {
      connection,
      admit: (directory, codec, extensions, authentication) =>
        this.#admit(input, directory, codec, extensions, authentication),
      publish: (view) => this.#publish(input, view),
      receive: (view, frame) => this.#options.receive(input.carrierId, view, frame),
      rejected:
        this.#options.rejected === undefined
          ? undefined
          : (view, frame, error) => this.#options.rejected!(input.carrierId, view, frame, error),
      retire: (view, error, physicalFailure) => this.#retire(input, view, error, physicalFailure)
    })
    this.#sessions.set(input.carrierId, session)
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
    const input = { carrier, source, changed }
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
      receive: (view, frame) => this.#options.receive(carrier.id, view, frame, source),
      rejected: (view, frame, error) =>
        this.#options.rejected?.(carrier.id, view, frame, error, source),
      retire: (view, error, physicalFailure) => {
        this.#draining.retire(input.carrier.id)
        this.#options.retired?.(input.carrier.id, view, error, physicalFailure, false, input.source)
        input.changed?.()
      }
    })
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
          origin: binding.origin,
          nodeId: view.nodeId
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
      'admit' | 'publish' | 'receive' | 'rejected' | 'retire' | 'source' | 'changed' | 'connection'
    >
  ): Session {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (facts) this.#options.admitSourceFacts?.(facts)
    return new Session({
      ...callbacks,
      namespace,
      carrier,
      expectedPeerId: facts?.expectedPeerId,
      sessionId: facts?.sessionId,
      isExclusive: facts?.isExclusive,
      flow: this.#options.flow,
      pipelines: this.#options.pipelines,
      self: this.#options.self,
      directory: () => this.#options.directory(namespace),
      track: (promise) => this.#draining.track(carrier.id, promise),
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
    if (!selection) {
      /** Descriptive lookups never consult this native call-admission receipt. */
      const departed = this.#namespaces.get(namespace)?.departed.get(address)
      if (departed) throw departed.reason
    }
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
    return this.#nodeIds.get(carrierId)
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
    if (session instanceof Session && session.closing) return Promise.resolve()
    /** No Session facade or alternate business tracker is created for a native drain. */
    const carrierId = typeof target === 'string' ? target : this.#handles.get(target)!.carrierId
    return this.#draining.drain(carrierId, remainingMs, (budget) => session.drain(budget))
  }

  /** Track the exact real business completion without replacing its native Promise. */
  track<T>(carrierId: string, promise: Promise<T>): Promise<T> {
    return this.#draining.track(carrierId, promise)
  }

  /** Every current accepted source announces once; one failed write cannot suppress other peers. */
  async announceDirectory(namespace?: string): Promise<void> {
    /** Snapshot the actual current sessions before any asynchronous write can retire a source. */
    const writes: Promise<void>[] = []
    for (const { selection } of this.#accepted.values())
      if (namespace === undefined || selection.view.namespace === namespace)
        writes.push(this.#session(selection.carrierId).announceDirectory())
    /** The caller reports the first original rejection; this owner reports only additional failures. */
    const results = await Promise.allSettled(writes)
    /** No aggregate wrapper obscures the original native write failure. */
    let failure: { reason: unknown } | undefined
    for (const result of results)
      if (result.status === 'rejected') {
        if (failure) this.#options.report(result.reason)
        else failure = result
      }
    if (failure) throw failure.reason
  }

  /** A native source retires its exact handle, never an unrelated same-name replacement. */
  detach(handle: string | IRpcSessionHandle, reason?: unknown): Promise<void> {
    /** A terminal native event can follow physical EOF without closing the resource a second time. */
    const input = typeof handle === 'string' ? undefined : this.#handles.get(handle)?.attachment
    if (input?.native && input.name && isRpcCarrierAdmissionFailure(reason) && !this.#closing) {
      /** Never let a late old generation replace a successor's current or retired admission fact. */
      const departed = input.index.departed.get(input.name)
      if (departed?.carrierId === input.carrierId && !input.index.names.has(input.name))
        input.index.departed.set(input.name, { carrierId: input.carrierId, reason })
    }
    return typeof handle === 'string' ? this.#session(handle).close(reason) : handle.close(reason)
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
    void Promise.allSettled(closes).then((results) => {
      /** Cleanup failures are all reported while the first original rejection owns close failure. */
      let failure: { reason: unknown } | undefined
      for (const result of results)
        if (result.status === 'rejected') {
          this.#options.report(result.reason)
          failure ??= result
        }
      if (failure) this.#closing!.reject(failure.reason)
      else this.#closing!.resolve()
    })
    return this.#closing.promise
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
      index.pendingPeers.has(directory.self.instanceId)
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.uuidConflict(directory.self.instanceId)
      )
    if (index.probing.has(directory.self.name)) throw this.#duplicate()
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
    const selection = Object.freeze({ carrierId: input.carrierId, view, nodeId: directory.nodeId })
    index.probing.set(directory.self.name, input.carrierId)
    index.pendingPeers.set(directory.self.instanceId, input.carrierId)
    this.#reserved.set(input.carrierId, selection)
    try {
      if (previous && previous.carrierId !== input.carrierId) {
        /** Failure retains the original ping error in diagnostics before replacing a dead source. */
        const timeoutMs = session.beginAdmission(
          input.nameAdmissionTimeoutMs ??
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
  #publish(input: ISessionAttachment, view: IRpcSessionView): void {
    /** Retirement removes the reservation, so late codecs cannot revive a closed connection. */
    const selection = this.#reserved.get(input.carrierId)
    if (!selection || selection.view !== view || this.#closing)
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    const index = input.index
    /** Existing views are removed before a rename can publish its new lookup keys. */
    const old = this.#accepted.get(input.carrierId)?.selection
    if (old) this.#unindex(old, index)
    index.peers.set(view.peerId, selection)
    index.names.set(view.name, selection)
    input.name = view.name
    index.departed.delete(view.name)
    this.#accepted.set(input.carrierId, { selection, attachment: input })
    if (selection.nodeId === undefined) this.#nodeIds.delete(input.carrierId)
    else this.#nodeIds.set(input.carrierId, selection.nodeId)
    this.#releaseReservation(input, selection)
    if (this.#namespaces.get(input.namespace) !== index) return
    input.published = true
    this.#publishName(selection)
    if (old) this.#options.updated?.(input.carrierId, view)
    else {
      this.#options.accepted?.(input.carrierId, view)
      publishSessionReadiness(index, view.name)
    }
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
    physicalFailure = false
  ): void {
    /** A pending candidate also owns a real carrier and must leave the by-id table. */
    const selection = this.#accepted.get(input.carrierId)?.selection
    if (selection && this.#nativeGenerations.has(input.carrierId) && !this.#closing)
      input.index.departed.set(selection.view.name, { carrierId: input.carrierId, reason: error })
    if (selection) this.#unindex(selection, input.index)
    /** A candidate waiting on its actual reply write also releases its reserved name. */
    this.#releaseReservation(input)
    this.#accepted.delete(input.carrierId)
    this.#nodeIds.delete(input.carrierId)
    this.#nativeGenerations.delete(input.carrierId)
    this.#sessions.delete(input.carrierId)
    this.#draining.retire(input.carrierId)
    this.#options.retired?.(
      input.carrierId,
      selection?.view ?? view,
      error,
      physicalFailure,
      input.published
    )
  }
}
