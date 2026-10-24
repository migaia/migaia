import { registerLocalErrorWireSummary } from '../core/internal/error-wire-metadata.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRemoteServeEndpoint } from '../remote/types.js'
import {
  createManagedRuntimePeer,
  readManagedRuntimeRegistration
} from '../remote/runtime-api/managed-peer.js'
import { createAbortController } from '@migaia/lifecycle'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import { RpcCapability, RpcWireLimit, type IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import { REMOTE_NAME_PATTERN, RemoteMethodMode } from '../remote/contract.js'
import { RpcRuntimeGenerationKind } from '@migaia/rpc-contract/framing/v1'
import {
  rejectRuntimeApiCapability,
  createRuntimeApiEndpoint
} from '../core/runtime-api-endpoint.js'
import { codec } from '../core/middleware/codec.js'
import { framer } from '../core/middleware/framer.js'
import { abort } from '../core/middleware/abort.js'
import { timeout } from '../core/middleware/timeout.js'
import { hooks } from '../core/middleware/hooks.js'
import { ping } from '../core/middleware/ping.js'
import { connect } from '../core/middleware/connect.js'
import { authentication } from '../core/middleware/authentication.js'
import { createAuthenticationNonce } from '../core/middleware/authentication-envelope.js'
import {
  createRpcError,
  createRpcLifecycleError,
  createRpcAbortError,
  RpcLifecycleError
} from '../core/errors.js'
import { RpcCoreErrorCode } from '../core/error-code.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import { readEndpointOwner } from '../core/internal/endpoint-projection.js'
import { EndpointOwnerKey, EndpointResourceLabel } from '../core/endpoint-kernel.js'
import type { ResourceScope } from '../core/internal/resource-scope.js'
import {
  bindInstalledProbe,
  createProbeEmitter,
  type IProbeEmitter
} from '../core/internal/probe-emitter.js'
import type { IRpcProbe } from '../core/probe/types.js'
import { RpcProbeStage } from '../core/probe/constants.js'
import type { RpcOutboundAttachment } from '../core/internal/outbound-attachment.js'
import type { RpcStreamOwner } from '../core/internal/stream/owner.js'
import {
  whenProviderReplySettled,
  composeProviderSessionPolicy,
  type ProviderRegistry,
  type IProviderSessionPolicy
} from '../core/internal/provider.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { defaultRpcReporter } from '../core/default-reporter.js'
import {
  createRuntimePeer,
  prepareRuntimePeerSourceContext,
  prepareRuntimeProviderAssembly,
  readRuntimePeerConnection,
  readRuntimePeerEndpoint,
  retainRuntimeSessionConnection,
  type IRuntimePeer,
  type IRuntimePeerSourceResult
} from '../remote/runtime-api/peer.js'
import {
  compileRuntimeMethods,
  retainRuntimeForwardMethod,
  type IRuntimeForwardMethodEntry,
  type IRuntimePeerProvide
} from '../remote/runtime-api/catalog.js'
import {
  describeRuntimeMethods,
  normalizeRuntimeDescription,
  type IRuntimePeerDescription
} from '../remote/runtime-api/description.js'
import {
  createRuntimeEventPublisher,
  runtimeReadyEvent,
  RuntimeProbeLifecycle
} from '../remote/runtime-api/events.js'
import {
  runtimeQuery,
  runtimeDetail,
  runtimeConnectionDetail,
  runtimeCounters,
  runtimeErrorIdentity
} from '../remote/runtime-api/overview.js'
import {
  RuntimeApiErrorText,
  RuntimeApiMode,
  RuntimeEventName,
  RuntimeQueryClock,
  RuntimeQueryStatus,
  RuntimeSourceKind,
  RuntimeConnectionDirection,
  RUNTIME_API_SCHEMA_VERSION
} from '../remote/runtime-api/constants.js'
import type { IRuntimePluginConnection } from '../remote/runtime-api/outlet.js'
import { RemoteMethodName } from '../remote/constants.js'
import { createHostRetryRequest } from '../remote/runtime-api/host-retry.js'
import {
  readRuntimeDefaultTimeout,
  prepareRuntimeCallTimeout
} from '../remote/runtime-api/timeout.js'
import { createRemoteLayerError } from '../remote/error.js'
import { RpcRemoteLayerErrorCode } from '../remote/error-code.js'
import { assertTimeout } from '../core/internal/outbound-attachment.js'
import type { IRemoteGenerationEvents } from '../remote/types.js'
import { readRpcPluginMetadata } from '../plugin/metadata.js'
import { prepareAdapterPeer } from '../runtime-adapter/peer.js'
import {
  readAdapterByteBootstrapSource,
  openAdapterByteBootstrapSource
} from '../runtime-adapter/byte/bootstrap-source.js'
import type { IAdapterByteBootstrapSource } from '../runtime-adapter/byte/bootstrap-source.js'
import {
  readAdapterMessageBootstrapSource,
  openAdapterMessageBootstrapSource,
  type IAdapterMessageBootstrapSource
} from '../runtime-adapter/message/bootstrap-source.js'
import {
  readRuntimePreparationContext,
  withRuntimePreparationContext
} from '../remote/runtime-api/launch-context.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { createHostMultiplexTransport } from '../runtime-adapter/host-multiplex.js'
import {
  readAdapterDeployment,
  type IAdapterDeploymentContext,
  type IAdapterDeploymentEndpointPreparation
} from '../runtime-adapter/deployment.js'
import type {
  IRpcFeaturePluginDefinition,
  IRpcHostMember,
  IRpcTransportPluginDefinition
} from '../plugin/types.js'
import { RpcTransportMode } from '../plugin/types.js'
import type { IRpcHost, IRpcHostOptions, IRpcHostFeatureContext } from './types.js'
import { HostErrorText } from './error-text.js'
import type { IRpcFanoutResult } from '../core/typing.js'

/** Existing canonical method grammar determines which names can be advertised as dotted aliases. */
const namespaceSegment = new RegExp(REMOTE_NAME_PATTERN, 'u')

/** Only this owner-created admission failure may expose its fixed duplicate-name code on wire. */
function createPeerNameDuplicateError() {
  /** The original native RPC error retains its code, stack and local control identity. */
  const error = createRpcError(
    RpcCoreErrorCode.hostPeerNameDuplicate,
    HostErrorText.peerNameDuplicate
  )
  registerLocalErrorWireSummary(
    error,
    RpcCoreErrorCode.hostPeerNameDuplicate,
    HostErrorText.peerNameDuplicate,
    {
      preserveSerializedError: true
    }
  )
  return error
}

/** One accepted physical session borrows the host endpoint and retains only its original receipt. */
type IHostSession = {
  channel: IRuntimePeerSourceResult
  detach(): void
  name?: string
  admission?: Readonly<{ name: string; promise: Promise<void> }>
  /** A rejected initial directory offer must finish its original reply before channel retirement. */
  replySettled?: Promise<void>
  peer?: IRuntimePeer
  connection?: IRuntimePluginConnection
  remoteNode?: string
  closing?: Promise<void>
  direct: boolean
  /** Managed registration owns physical close and publishes only after its current pointer commits. */
  managed?: true
  /** These subscribers borrow this exact receipt's original departure, including its error identity. */
  departures: Set<(reason: unknown) => void>
  reason?: unknown
  retryRequest?: ReturnType<typeof createHostRetryRequest>
  /** The original native policy is borrowed only for this verified physical sender. */
  execution?: IAdapterDeploymentEndpointPreparation['execution']
  withdraw?: () => void
}

/** The actual runtime handle supports native installation without exposing adapter plumbing. */
export type IRpcHostRuntime = Readonly<{
  host: IRpcHost<unknown>
  start(initialSignal?: IAbortSignal): Promise<void>
  close(): Promise<void>
  featureContext(onDispose: (dispose: () => void | Promise<void>) => void): IRpcHostFeatureContext
}>

/** A managed member retains one original native close attempt, including its rejected Promise. */
class ManagedMemberClose {
  /** Closing releases this exact binding holder rather than the shared Host endpoint. */
  readonly #peer: IRuntimePeer
  /** Pool rollback and Host fallback join the original attempt once it starts. */
  #closing: Promise<void> | undefined

  /** The genuine managed facade remains the sole native release authority. */
  constructor(peer: IRuntimePeer) {
    this.#peer = peer
  }

  /** A rejected or pending original close still counts as an already-started attempt. */
  readonly started = (): boolean => this.#closing !== undefined

  /** Retain the exact native Promise without wrapping or replacing its rejection. */
  readonly close = (): Promise<void> => (this.#closing ??= this.#peer.close())
}

/** One canonical installed Host owns all session, provider and lifetime state. */
class RuntimeHost implements IRpcHostRuntime {
  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #options: IRpcHostOptions

  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #definition: IRpcTransportPluginDefinition

  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #features: readonly IRpcFeaturePluginDefinition[]

  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #nodeId: string

  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #onConnection: ((connection: IRuntimePluginConnection) => () => void) | undefined

  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #selfDefaulted: boolean

  /** Original constructor input is retained by this runtime owner for its full installed lifetime. */
  readonly #assemblyHost: (() => IRpcHost<unknown>) | undefined

  /** Contributions configure existing canonical roots before their sole construction. */
  #contributions

  /** Native Host provenance remains associated with the exact ordinary options carrier. */
  #preparation

  /** One selected authentication profile controls both local offer and canonical middleware. */
  #credentials

  /** Safe explicit identity is fixed; a default may be replaced only by actual bootstrap authority. */
  #source

  /** Native installation owns cancellation; every physical opening receives this same lifetime. */
  #controller

  /** A reporter failure follows the existing terminal observation policy. */
  #report = (error: unknown): void => {
    try {
      ;(this.#options.report ?? defaultRpcReporter)(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }

  /** The canonical inherited budget is captured once for all requests on this fixed feature set. */
  #defaultTimeout

  /** Ordinary hot requests reuse the original immutable default options instead of rebuilding them. */
  #callTimeout

  /** The actual transport adapter selects framing for each held physical source. */
  #multiplex: ReturnType<typeof createHostMultiplexTransport> | undefined

  /** Only pre-identity bootstrap acquisition owns this raw resource before channel handoff. */
  #bootstrapSource: IAdapterByteBootstrapSource | IAdapterMessageBootstrapSource | undefined

  /** Both bootstrap variants close the same raw resource that supplied their admitted identity. */
  #closeBootstrapSource = async (): Promise<void> => {
    if (!this.#bootstrapSource) return
    const message = readAdapterMessageBootstrapSource(this.#bootstrapSource)
    if (message) await message.resource.close()
    else
      await readAdapterByteBootstrapSource(
        this.#bootstrapSource as IAdapterByteBootstrapSource
      ).io.close()
  }

  /** Physical session receipts are the sole accepted directory/lifetime inventory. */
  #sessions

  /** Only simultaneous same-name admission probes need a temporary exclusion token. */
  #probing

  /** Directory subscribers own observation only, with no copied membership state. */
  #accepted

  /** Held own-data capability trees retain their original connection generation. */
  #peers: Record<string, object>

  /** The original emitter is constructed only after native bootstrap selects the final identity. */
  #probe: IProbeEmitter | undefined

  /** Canonical kernel cleanup and failed construction share this idempotent binding release. */
  #releaseProbe: (() => void) | undefined

  /** Lifecycle observations reuse the canonical event publisher. */
  #eventsPublisher

  /** Provider generation belongs to this one endpoint, independent of physical attempt counters. */
  #generation: IRpcRuntimeGeneration

  /** Assembly results may replace the direct-target projection without replacing physical sessions. */
  #assembled: IRpcHostMember | undefined

  /** The original managed facade retains supervision, generation readiness and retry authority. */
  #managedPeer: IRuntimePeer | undefined

  /** Its logical direct name survives a transient physical rebind, as on the original registration. */
  #managedName: string | undefined

  /** Original registration/event subscriptions are released before its holder closes. */
  #managedSubscriptions: (() => void)[]

  /** Each original holder remains the sole owner of one managed transport opening. */
  #managedMembers: Readonly<{
    started(): boolean
    close(): Promise<void>
  }>[]

  /** A listener remains owned by this transport installation. */
  #listener: { close(): void | Promise<void> } | undefined

  /** Host close publishes one completion before invoking any user cleanup. */
  #closing: Promise<void> | undefined

  /** The endpoint is constructed only by start, after genuine native installation begins. */
  #endpoint!: ReturnType<typeof createRuntimeApiEndpoint>

  /** The original outbound attachment owns all correlation, replay and runtime generations. */
  #outbound!: RpcOutboundAttachment

  /** The original registry holds local, namespace and explicitly captured forward providers. */
  #registry!: ProviderRegistry

  /** The one shared provider compiler remains reusable by standalone peer construction. */
  #assembly!: ReturnType<typeof prepareRuntimeProviderAssembly>

  /** Every start caller joins the same native opening rather than acquiring duplicate resources. */
  #starting: Promise<void> | undefined

  /** Native source preparation has one genuine token; copied empty objects confer no authority. */
  #deployment

  /** A direct target must be ready on its original physical channel at this exact call. */
  #live = (session: IHostSession): boolean =>
    Boolean(session.connection && !session.closing && !session.channel.transport.closed)

  /** Target names are the remote handshake name, never the local plugin registration. */
  #byName = (name: string): IHostSession | undefined => {
    for (const session of this.#sessions.values())
      if (session.direct && session.name === name && this.#live(session)) return session
    return undefined
  }

  /** Existing target diagnostics preserve their canonical semantic code and text. */
  #unknown = (_name: string): never => {
    throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
  }

  /** Direct calls select one current accepted receipt, with no waiting or retargeting. */
  #direct = (name: string): IRuntimePeer => {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (this.#assembled?.id === name) return this.#assembled as unknown as IRuntimePeer
    /** Existing names retain priority; endpoint ids still select only live direct sessions. */
    const addressed = this.#sessions.get(name)
    const session =
      this.#byName(name) ?? (addressed?.direct && this.#live(addressed) ? addressed : undefined)
    return session?.connection?.peer ?? session?.peer ?? this.#unknown(name)
  }

  /** Build a per-connection snapshot; accepted peers are never hot-updated within a generation. */
  #description = (peerId?: string): IRuntimePeerDescription =>
    normalizeRuntimeDescription({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self: this.#multiplex!.supports(peerId ?? '', RpcCapability.generation)
        ? { ...this.#source.self, generation: this.#generation }
        : this.#source.self,
      ...(this.#multiplex!.supports(peerId ?? '', RpcCapability.forwardRoute)
        ? { nodeId: this.#nodeId }
        : {}),
      methods: describeRuntimeMethods(
        this.#assembly.methods(),
        this.#multiplex!.supports(peerId ?? '', RpcCapability.stream)
      ).map((method) => {
        if (method.forwardedVia === undefined || namespaceSegment.test(method.forwardedVia))
          return method
        const { forwardedVia: _hint, ...description } = method
        return description
      })
    })

  /** A captured capability uses canonical forwarding and may never follow a same-name successor. */
  #forward = (
    session: IHostSession,
    method: IRuntimePeerDescription['methods'][number],
    name: string,
    held: boolean
  ): IRuntimeForwardMethodEntry => {
    const targetName = session.name!
    const heldSession = held ? session : undefined
    return {
      kind: 'forward',
      name,
      method: method.name,
      forwardedVia: targetName,
      nodeId: this.#nodeId,
      supportedModes: method.supportedModes,
      ...(!held
        ? {
            readDescription: () => {
              const current = this.#byName(targetName)
              return (
                current &&
                readRuntimePeerConnection(current.peer!).description!.methods.find(
                  (entry) => entry.name === method.name
                )
              )
            }
          }
        : {}),
      ...(method.input === undefined &&
      method.output === undefined &&
      method.yield === undefined &&
      method.idempotent === undefined
        ? {}
        : {
            declaration: {
              mode:
                method.supportedModes.every((mode) => mode === RuntimeApiMode.stream) ||
                method.yield !== undefined
                  ? RemoteMethodMode.asyncGenerator
                  : method.supportedModes.every((mode) => mode === RuntimeApiMode.notify)
                    ? RemoteMethodMode.oneWay
                    : RemoteMethodMode.request,
              idempotent: method.idempotent ?? false,
              ...(method.input === undefined ? {} : { input: method.input }),
              ...(method.output === undefined ? {} : { output: method.output }),
              ...(method.yield === undefined ? {} : { yield: method.yield })
            }
          }),
      slot: () => {
        const current = this.#byName(targetName)
        if (!current || (heldSession !== undefined && current !== heldSession))
          this.#unknown(targetName)
        const declaration = readRuntimePeerConnection(current!.peer!).description?.methods.find(
          (entry) => entry.name === method.name
        )
        if (!declaration)
          throw createRpcError(
            RpcCoreErrorCode.providerNotFound,
            RuntimeApiErrorText.methodUnavailable
          )
        return current!.connection!
      }
    }
  }

  /** One provider tree builder keeps physical and logical capabilities on the same own-data rules. */
  #projectMethods = (
    methods: IRuntimePeerDescription['methods'],
    callable: (method: IRuntimePeerDescription['methods'][number]) => unknown
  ): object => {
    /** Validated method segments never become prototype setters. */
    const tree: Record<string, unknown> = Object.create(null)
    for (const method of methods) {
      const parts = method.name.split('.')
      let object = tree
      for (const part of parts.slice(0, -1)) {
        if (!Object.hasOwn(object, part))
          Object.defineProperty(object, part, { value: Object.create(null), enumerable: true })
        object = object[part] as Record<string, unknown>
      }
      Object.defineProperty(object, parts.at(-1)!, {
        value: callable(method),
        enumerable: true
      })
    }
    return tree
  }

  /** A physical capability retains the same original forwarding receipt and generation check. */
  #project = (session: IHostSession): object =>
    this.#projectMethods(
      readRuntimePeerConnection(session.peer!).description!.methods,
      (method) => {
        const entry = this.#forward(session, method, method.name, true)
        /**
         * Generated routes admit every mode; their default capability call remains a scalar
         * request.
         */
        const streaming =
          method.supportedModes.every((mode) => mode === RuntimeApiMode.stream) ||
          method.yield !== undefined
        return retainRuntimeForwardMethod((payload?: unknown) => {
          try {
            const current = entry.slot().peer
            return streaming
              ? current.stream(method.name, payload)
              : current.request(method.name, payload)
          } catch (error) {
            if (streaming) throw error
            return Promise.reject(error)
          }
        }, entry)
      }
    )

  /** Resolve the longest accepted namespace after the canonical exact-local lookup has failed. */
  #resolveNamespace = (method: string) => {
    if (
      method.length > RpcWireLimit.maxIdentifierChars ||
      !method.split('.').every((part) => namespaceSegment.test(part))
    )
      return undefined
    if (method.startsWith(RemoteMethodName.runtimeNamespace) || !method.includes('.'))
      return undefined
    const names = [
      ...new Set(
        this.#assembly
          .methods()
          .filter((entry) => entry.kind === 'forward')
          .map((entry) => (entry as IRuntimeForwardMethodEntry).forwardedVia)
      ),
      ...[...this.#sessions.values()]
        .map((session) => session.name)
        .filter((name): name is string => name !== undefined)
    ]
    /** Longest prefix selection preserves the first equal-length match in one traversal. */
    let name: string | undefined
    for (const candidate of names)
      if (
        method.startsWith(`${candidate}.`) &&
        (name === undefined || candidate.length > name.length)
      )
        name = candidate
    if (!name) this.#unknown(method)
    const session = this.#byName(name!) ?? this.#unknown(name!)
    const selected = readRuntimePeerConnection(session.peer!).description!.methods.find(
      (entry) => entry.name === method.slice(name!.length + 1)
    )
    if (!selected)
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    this.#assembly.append([this.#forward(session, selected, method, false)])
    return this.#registry.providers.get(method)
  }

  /** Closing a physical receipt never disposes the host's one shared endpoint. */
  #retire = (session: IHostSession, reason?: unknown): Promise<void> => {
    if (session.closing) return session.closing
    const completion = deferred<void>()
    session.closing = completion.promise
    /** Only an unaccepted candidate waits for its already-running directory reply's actual write. */
    const release = (): void => {
      if (session.peer && this.#probe && (this.#probe.mask & (1 << RpcProbeStage.peer)) !== 0)
        this.#probe.peer(RuntimeProbeLifecycle.closing, session.channel.peerId, reason)
      if (this.#sessions.get(session.channel.peerId) === session)
        this.#sessions.delete(session.channel.peerId)
      const departed = reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      session.reason = departed
      for (const observe of Array.from(session.departures)) {
        try {
          observe(departed)
        } catch (failure) {
          this.#report(failure)
        }
      }
      session.departures.clear()
      this.#outbound?.retireRuntimeTarget(session.channel.peerId, departed)
      readEndpointOwner<RpcStreamOwner>(this.#endpoint, EndpointOwnerKey.streamOwner)?.retireTarget(
        session.channel.peerId,
        departed
      )
      session.withdraw?.()
      if (session.name && this.#peers[session.name] && this.#byName(session.name) === undefined)
        delete this.#peers[session.name]
      try {
        session.detach()
      } catch (error) {
        this.#report(error)
      }
      void Promise.resolve()
        .then(async () => {
          if (session.peer) await session.peer.close()
          else await session.channel.close()
        })
        .then(completion.resolve, completion.reject)
      if (!session.managed && session.peer && session.name)
        this.#eventsPublisher.publish(
          {
            type: RuntimeEventName.exit,
            name: session.name,
            instanceId: session.channel.peerId,
            generation: 0,
            timestamp: session.channel.scheduler.now(),
            clock: RuntimeQueryClock.scheduler,
            ...(reason === undefined ? {} : { error: runtimeErrorIdentity(reason, this.#report) })
          },
          this.#report
        )
    }
    if (!session.peer && session.replySettled)
      void session.replySettled.then(release).then(undefined, completion.reject)
    else release()
    return completion.promise
  }

  /** Name arbitration uses one existing ping, and lets only the winning candidate publish. */
  #admitName = (session: IHostSession, name: string): Promise<void> => {
    if (!session.direct) {
      session.name = name
      return Promise.resolve()
    }
    if (session.admission?.name === name) return session.admission.promise
    /** The same bilateral exchange joins one arbitration and never probes the old peer twice. */
    const completion = deferred<void>()
    session.admission = { name, promise: completion.promise }
    void Promise.resolve()
      .then(async () => {
        if (session.name === name) return
        if (this.#probing.has(name)) throw createPeerNameDuplicateError()
        const previous = [...this.#sessions.values()].find(
          (candidate) =>
            candidate !== session &&
            candidate.direct &&
            (candidate.name ?? candidate.admission?.name) === name &&
            !candidate.closing
        )
        if (previous) {
          if (!previous.peer) throw createPeerNameDuplicateError()
          if (!previous.channel.transport.closed) {
            this.#probing.add(name)
            try {
              let alive = false
              try {
                alive = await this.#endpoint.ping!(previous.channel.peerId, undefined, {
                  timeoutMs: this.#definition.connect?.timeoutMs ?? 10_000
                })
              } catch (failure) {
                this.#report(failure)
              }
              if (alive) throw createPeerNameDuplicateError()
              await this.#retire(previous)
            } finally {
              this.#probing.delete(name)
            }
          } else await this.#retire(previous)
        }
        session.name = name
      })
      .then(completion.resolve, completion.reject)
    return completion.promise
  }

  /** Publish the original prepared receipt only after the accepting owner commits readiness. */
  #publishSession = async (
    session: IHostSession,
    publishedPeer = session.peer!,
    publishedGeneration = 0
  ): Promise<void> => {
    const remote = readRuntimePeerConnection(session.peer!).description!
    session.connection = Object.freeze({
      name: remote.self.name,
      instanceId: session.channel.peerId,
      identity: remote.self,
      description: remote,
      peer: publishedPeer,
      report: this.#report
    })
    /** Hidden members have no public ready event; direct sessions use the publisher below once. */
    if (!session.direct && this.#probe && (this.#probe.mask & (1 << RpcProbeStage.peer)) !== 0)
      this.#probe.peer(RuntimeEventName.ready, session.channel.peerId, undefined)
    if (!session.direct) return
    session.withdraw = (0, this.#onConnection)?.(session.connection)
    if (session.direct) {
      Object.defineProperty(this.#peers, remote.self.name, {
        value: this.#project(session),
        enumerable: true,
        configurable: true
      })
      /** One accepted catalog snapshot suffices for every method in this arriving session. */
      const existingMethods = new Set(this.#assembly.methods().map((entry) => entry.name))
      const additions = remote.methods
        .filter(
          (method) =>
            namespaceSegment.test(remote.self.name) &&
            `${remote.self.name}.${method.name}`.length <= RpcWireLimit.maxIdentifierChars &&
            !this.#registry.providers.has(`${remote.self.name}.${method.name}`) &&
            !existingMethods.has(`${remote.self.name}.${method.name}`)
        )
        .map((method) =>
          this.#forward(session, method, `${remote.self.name}.${method.name}`, false)
        )
      if (additions.length) this.#assembly.append(additions)
    }
    for (const observe of Array.from(this.#accepted)) {
      try {
        await observe(remote)
      } catch (error) {
        this.#report(error)
      }
    }
    this.#eventsPublisher.publish(
      runtimeReadyEvent(remote.self.name, publishedPeer, publishedGeneration),
      this.#report
    )
  }

  /** Preserve source metadata from the genuine installed mode while the Peer borrows a channel. */
  #connectionOrigin = () => {
    if (this.#definition.mode === RpcTransportMode.listen)
      return { kind: RuntimeSourceKind.listen, direction: RuntimeConnectionDirection.listen }
    if (this.#definition.mode === RpcTransportMode.spawn)
      return { kind: RuntimeSourceKind.spawn, direction: RuntimeConnectionDirection.spawned }
    return {
      kind: RuntimeSourceKind.connect,
      direction:
        this.#definition.mode === RpcTransportMode['connect-to-parent']
          ? RuntimeConnectionDirection.spawnedBy
          : RuntimeConnectionDirection.connect
    }
  }

  /** Join the original shared endpoint without replacing native admission or close ownership. */
  #accept = async (
    channel: IRuntimePeerSourceResult,
    directTarget = true,
    preparation?: Readonly<{
      managed?: true
      signal?: IAbortSignal
      wrapEndpoint?: IAdapterDeploymentEndpointPreparation['wrapEndpoint']
      policy?: IAdapterDeploymentEndpointPreparation
    }>
  ): Promise<IRpcHostMember> => {
    if (this.#closing) {
      await channel.close()
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    }
    try {
      this.#multiplex!.assertAttach(channel.peerId)
    } catch (primary) {
      try {
        await channel.close()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw primary
    }
    const session: IHostSession = {
      channel,
      detach: () => undefined,
      direct: directTarget,
      ...(preparation?.managed ? { managed: true } : {}),
      departures: new Set()
    }
    this.#sessions.set(channel.peerId, session)
    try {
      /** The accepted native source contributes its original execution policy exactly once. */
      const nativePolicy =
        preparation?.policy ??
        this.#deployment?.prepareEndpoint?.(channel, this.#options.providerLimits)
      session.execution = nativePolicy?.execution
      /** This view preserves the same kernel while native rollback can only retire its own session. */
      const borrowed = Object.freeze(
        Object.create(this.#endpoint, { dispose: { value: () => this.#retire(session) } })
      )
      /** Native health/drain views compose around a session-only disposal boundary. */
      const wrap = (served: IRemoteServeEndpoint): IRemoteServeEndpoint => {
        /** Canonical native policy never replaces the host's shared endpoint owner. */
        /** The original physical generation contributes lifetime policy to only this session. */
        const onExecution = (execution: IProviderSessionPolicy): void => {
          session.execution = composeProviderSessionPolicy(session.execution, execution)
        }
        const native = nativePolicy?.wrapEndpoint?.(served, onExecution) ?? served
        return preparation?.wrapEndpoint?.(native, onExecution) ?? native
      }
      session.detach = this.#multiplex!.attach(channel)
      /**
       * Original source provenance survives borrowing instead of defaulting every session to
       * connect.
       */
      const peerOptions = {
        self: this.#source.self,
        defaultTimeoutMs:
          this.#options.defaultTimeoutMs ??
          this.#contributions.find((value) => value.defaultTimeoutMs !== undefined)
            ?.defaultTimeoutMs,
        report: this.#report
      }
      const peer = await withRuntimePreparationContext(
        peerOptions,
        { connectionOrigin: this.#connectionOrigin },
        () =>
          createRuntimePeer(peerOptions, {
            channel: preparation?.managed ? { ...channel, close: undefined } : channel,
            wrapEndpoint: wrap,
            endpoint: { endpoint: borrowed, oneWay: this.#endpoint, stream: this.#endpoint.stream },
            assembly: this.#assembly,
            generation: this.#generation,
            nodeId: this.#nodeId,
            hostSession: true,
            restrictTransfer: (callOptions) => {
              if (
                callOptions &&
                Object.hasOwn(callOptions, 'transfer') &&
                !this.#multiplex!.supports(channel.peerId, RpcCapability.transfer)
              )
                rejectRuntimeApiCapability()
            },
            signal: preparation?.signal ?? this.#controller.signal,
            description: () => this.#description(channel.peerId)
          })
      )
      const remote = readRuntimePeerConnection(peer).description!
      if (this.#probe && (this.#probe.mask & (1 << RpcProbeStage.peer)) !== 0) {
        this.#probe.peer(RuntimeProbeLifecycle.handshake, channel.peerId, undefined)
        this.#probe.peer(RuntimeProbeLifecycle.directory, channel.peerId, undefined)
      }
      await this.#admitName(session, remote.self.name)
      /**
       * Readiness follows the original local directory reply physical write, not only its remote
       * receipt.
       */
      await session.replySettled
      session.peer = peer
      if (!session.managed) await this.#publishSession(session)
      const member = Object.freeze({
        ...peer,
        id: remote.self.name,
        close: () => this.#retire(session),
        [Symbol.asyncDispose]: () => this.#retire(session)
      })
      retainRuntimeSessionConnection(member, peer)
      return member
    } catch (error) {
      try {
        await this.#retire(session, error)
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw error
    }
  }

  /** Read numeric generation from the accepted wire owner; no host retry counter is introduced. */
  #sessionGeneration = (session: IHostSession): number =>
    readRuntimePeerConnection(session.peer!).description?.self.generation?.value ?? 0

  /**
   * Retry is opt-in and delegates capture, keys, timeout and the replay decision to canonical
   * owners.
   */
  #request = (
    peer: IRuntimePeer,
    method: string,
    payload?: unknown,
    callOptions?: Parameters<IRuntimePeer['request']>[2]
  ) => {
    const session = Array.from(this.#sessions.values()).find((candidate) => candidate.peer === peer)
    const suppliedPort = this.#contributions.find(
      (value) => value.retryPort !== undefined
    )?.retryPort
    if (!session || (!suppliedPort && !this.#contributions.some((value) => value.retry)))
      return peer.request(method, payload, callOptions)
    if (
      callOptions &&
      Object.hasOwn(callOptions, 'transfer') &&
      !this.#multiplex!.supports(session.channel.peerId, RpcCapability.transfer)
    )
      rejectRuntimeApiCapability()
    if (!session.retryRequest) {
      /** Original ready/exit publications are observed without owning a reconnect state machine. */
      const current = () =>
        this.#byName(session.name!) ??
        (() => {
          throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed, session.reason, {
            generation: this.#sessionGeneration(session)
          })
        })()
      const events: IRemoteGenerationEvents = {
        current: () => {
          const active = this.#byName(session.name!)
          return {
            generation: active ? this.#sessionGeneration(active) : this.#sessionGeneration(session),
            active: active !== undefined
          }
        },
        onLeave: (generation, observe) => {
          const active = this.#byName(session.name!)
          if (!active || this.#sessionGeneration(active) !== generation) {
            observe(session.reason)
            return () => undefined
          }
          active.departures.add(observe)
          return () => {
            active.departures.delete(observe)
          }
        },
        whenReady: (_afterGeneration, signal) =>
          new Promise<number>((resolve, reject) => {
            const existing = this.#byName(session.name!)
            if (existing && existing !== session) {
              resolve(this.#sessionGeneration(existing))
              return
            }
            const stopped = () => {
              remove()
              reject(
                signal?.aborted
                  ? resolveAbortReason(signal)
                  : resolveAbortReason(this.#controller.signal)
              )
            }
            const ready = this.#eventsPublisher.on(RuntimeEventName.ready, (event) => {
              if (event.name !== session.name) return
              const accepted = this.#byName(session.name!)
              if (!accepted || accepted === session) return
              remove()
              resolve(this.#sessionGeneration(accepted))
            })
            const remove = () => {
              ready()
              signal?.removeEventListener('abort', stopped)
              this.#controller.signal.removeEventListener('abort', stopped)
            }
            if (signal?.aborted || this.#controller.signal.aborted) stopped()
            else {
              signal?.addEventListener('abort', stopped, { once: true })
              this.#controller.signal.addEventListener('abort', stopped, { once: true })
            }
          })
      }
      session.retryRequest = createHostRetryRequest(
        {
          scheduler: session.channel.scheduler,
          events,
          current: () => {
            const active = current()
            const receipt = readRuntimePeerConnection(active.peer!)
            return {
              number: this.#sessionGeneration(active),
              channel: receipt.channel,
              endpoint: receipt.endpoint as never
            }
          },
          observedGeneration: () => events.current().generation,
          declaration: (method, mode) => {
            const route = readRuntimePeerConnection(current().peer!).routes.get(method)
            if (!route && method.includes('.')) return undefined
            if (!route)
              throw createRpcError(
                RpcCoreErrorCode.providerNotFound,
                RuntimeApiErrorText.methodUnavailable
              )
            if (!route.supportedModes.includes(mode)) rejectRuntimeApiCapability()
            return route
          },
          validateOptions: (value) =>
            assertTimeout((value as Parameters<IRuntimePeer['request']>[2])?.timeoutMs),
          timeout: (value) => (value === false ? undefined : (value ?? this.#defaultTimeout)),
          closed: (generation, cause) =>
            createRemoteLayerError(RpcRemoteLayerErrorCode.closed, cause, { generation }),
          departureCause: () => session.reason,
          restoreFailure: (error) => {
            throw error
          }
        },
        this.#report,
        suppliedPort
      )
    }
    return session.retryRequest(method, payload, this.#callTimeout(callOptions))
  }

  /** Fanout captures target identity once and retains independent original settlement values. */
  #targets = (): readonly Readonly<{ id: string; peer: IRuntimePeer }>[] => {
    if (this.#closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (this.#assembled)
      return [{ id: this.#assembled.id, peer: this.#assembled as unknown as IRuntimePeer }]
    if (this.#managedPeer && this.#managedName)
      return [{ id: this.#managedName, peer: this.#managedPeer }]
    return [...this.#sessions.values()]
      .filter((session) => session.direct && this.#live(session))
      .map((session) => ({ id: session.name!, peer: session.connection?.peer ?? session.peer! }))
  }

  /** Reject unsupported ownership options before async fanout can turn admission into a result. */
  #admitTransfer = (callOptions: object | undefined, target?: string): void => {
    if (!callOptions || !Object.hasOwn(callOptions, 'transfer') || this.#assembled) return
    /** Explicit names retain priority over an endpoint-id fallback, including unusual user names. */
    const addressed =
      target === undefined ? undefined : (this.#byName(target) ?? this.#sessions.get(target))
    for (const session of target === undefined
      ? this.#sessions.values()
      : addressed
        ? [addressed]
        : [])
      if (
        session.direct &&
        this.#live(session) &&
        !this.#multiplex!.supports(session.channel.peerId, RpcCapability.transfer)
      )
        rejectRuntimeApiCapability()
  }

  /** Direct dispatch keeps its original Promise rejection timing for non-transfer target failures. */
  #sendRequest = async (
    target: string,
    method: string,
    payload?: unknown,
    callOptions?: Parameters<IRuntimePeer['request']>[2]
  ) => this.#request(this.#direct(target), method, payload, callOptions)

  /** Records use the endpoint's canonical key grammar and have no inherited dictionary members. */
  #fanout = <T>(): {
    fulfilled: Partial<Record<string, T>>
    rejected: Partial<Record<string, unknown>>
  } => ({ fulfilled: Object.create(null), rejected: Object.create(null) })

  /** Scalar and Promise operations preserve single-target behavior and isolate multiple targets. */
  #broadcast = async <T>(
    operation: (peer: IRuntimePeer) => T | Promise<T>
  ): Promise<T | IRpcFanoutResult<T>> => {
    const selected = this.#targets()
    if (selected.length === 1) return operation(selected[0]!.peer)
    const result = this.#fanout<T>()
    await Promise.all(
      selected.map(async ({ id, peer }) => {
        const key = JSON.stringify(['target', id])
        try {
          result.fulfilled[key] = await operation(peer)
        } catch (error) {
          result.rejected[key] = error
        }
      })
    )
    return result
  }

  /** Open each task with the original managed factory while borrowing this host's single endpoint. */
  #openManaged = async (
    context: IAdapterDeploymentContext,
    directTarget: boolean
  ): Promise<IRpcHostMember> => {
    const native = await this.#deployment!.managed!(context)
    /** One binding retains its preceding accepted receipt until the next native generation opens. */
    let precedingSession: IRpcHostMember | undefined
    const peer = await createManagedRuntimePeer(
      {
        self: this.#source.self,
        provide: this.#options.provide,
        authentication: this.#credentials,
        defaultTimeoutMs: this.#defaultTimeout,
        providerLimits: this.#options.providerLimits,
        contract: this.#options.contract,
        report: this.#report,
        keyFactory: native.keyFactory ?? this.#deployment!.runtimeOptions?.keyFactory,
        retryPort:
          this.#contributions.find((value) => value.retryPort !== undefined)?.retryPort ??
          native.retryPort ??
          this.#deployment!.runtimeOptions?.retryPort,
        callDeadlineCapMs: native.callDeadlineCapMs
      },
      native.binding,
      native.bindEndpoint,
      {
        ...this.#preparation,
        prepareReplacement: native.prepareReplacement,
        initialSignal: this.#controller.signal,
        lifecycleSignal: this.#controller.signal,
        prepareRuntime: async (channel, signal) => {
          /** Abandoned native work can outlive its logical session; its successor owns this slot. */
          try {
            await precedingSession?.close()
          } catch (cleanup) {
            this.#report(cleanup)
          }
          precedingSession = await this.#accept(channel, directTarget, {
            managed: true,
            signal,
            ...(native.bindEndpoint
              ? {
                  wrapEndpoint: (served, onExecution) =>
                    native.bindEndpoint!(channel, served, onExecution)
                }
              : {})
          })
          return precedingSession as unknown as IRuntimePeer
        }
      },
      native.beforeRelease,
      native.execution
    )
    const registration = readManagedRuntimeRegistration(peer)!
    /**
     * This existing registration supplies actual local generations even when remote wire values
     * repeat.
     */
    const committed = async (currentPeer: IRuntimePeer, number: number): Promise<void> => {
      const receipt = readRuntimePeerConnection(currentPeer)
      const session = this.#sessions.get(receipt.peerId)
      if (!session || this.#closing) return
      session.direct = directTarget
      if (directTarget) this.#managedName = receipt.description!.self.name
      registration.events.onLeave(number, (reason) => {
        void this.#retire(session, reason).catch(this.#report)
      })
      await this.#publishSession(session, peer, number)
    }
    this.#managedSubscriptions.push(
      registration.onReady((peer, number) => {
        void committed(peer, number).catch(this.#report)
      })
    )
    if (directTarget)
      for (const event of [
        RuntimeEventName.exit,
        RuntimeEventName.restart,
        RuntimeEventName.degraded,
        RuntimeEventName.terminal
      ])
        this.#managedSubscriptions.push(
          peer.on(event, (observation) =>
            this.#eventsPublisher.publish(
              { ...observation, name: this.#managedName ?? observation.name },
              this.#report
            )
          )
        )
    /** Pool rollback and Host fallback retain the exact original native close attempt. */
    const receipt = new ManagedMemberClose(peer)
    /** This member releases only its binding's holder and never the shared endpoint. */
    const member = Object.freeze({
      ...peer,
      id: readRuntimePeerConnection(peer).description!.self.name,
      close: receipt.close,
      [Symbol.asyncDispose]: receipt.close
    })
    this.#managedMembers.push(receipt)
    if (directTarget) this.#managedPeer = peer
    await committed(registration.currentPeer(), registration.events.current().generation)
    retainRuntimeSessionConnection(member, peer)
    return member
  }

  /** Close prevents late admission and releases every acquired resource despite cleanup failures. */
  readonly close = (): Promise<void> => {
    if (this.#closing) return this.#closing
    const completion = deferred<void>()
    this.#closing = completion.promise
    this.#eventsPublisher.close()
    void Promise.resolve()
      .then(async () => {
        const failures: unknown[] = []
        /** The original assembler drains accepted work while all member channels remain usable. */
        try {
          await this.#assembled?.close()
        } catch (error) {
          failures.push(error)
        }
        for (const dispose of this.#managedSubscriptions.splice(0))
          try {
            dispose()
          } catch (error) {
            failures.push(error)
          }
        for (const member of this.#managedMembers.splice(0).reverse())
          try {
            if (!member.started()) await member.close()
          } catch (error) {
            failures.push(error)
          }
        /** Native listener sessions drain their own generations before the fallback retirement. */
        try {
          await this.#listener?.close()
        } catch (error) {
          failures.push(error)
        }
        /** Acquisition cancellation follows native drains while their actual channels remain live. */
        this.#controller.abort(createRpcLifecycleError(RpcCoreErrorText.endpointDisposed))
        for (const session of [...this.#sessions.values()].reverse())
          try {
            await this.#retire(session)
          } catch (error) {
            failures.push(error)
          }
        try {
          await this.#endpoint?.dispose()
        } catch (error) {
          failures.push(error)
        }
        try {
          this.#releaseProbe?.()
          await this.#multiplex?.close()
          await this.#closeBootstrapSource()
        } catch (error) {
          failures.push(error)
        }
        this.#accepted.clear()
        /** A single canonical lifecycle diagnostic already retains its exact native cleanup leaves. */
        if (failures.length === 1 && failures[0] instanceof RpcLifecycleError) throw failures[0]
        if (failures.length)
          throw createRpcError(
            RpcCoreErrorCode.transport,
            HostErrorText.cleanupFailed,
            new AggregateError(failures, HostErrorText.cleanupFailed)
          )
      })
      .then(completion.resolve, completion.reject)
    return completion.promise
  }

  /** The public runtime surface is later installed on the same genuine native Host handle. */
  readonly host: IRpcHost<unknown>

  /** Project the public Host onto this runtime without copying its mutable ownership facts. */
  #createHost = (): IRpcHost<unknown> => {
    return Object.defineProperty(
      {
        self: undefined,
        peers: this.#peers,
        on: this.#eventsPublisher.on,
        close: this.close,
        [Symbol.asyncDispose]: this.close,
        provide: (provide: IRuntimePeerProvide) =>
          this.#assembly.append(compileRuntimeMethods(provide)),
        request: (
          method: string,
          payload?: unknown,
          callOptions?: Parameters<IRuntimePeer['request']>[2]
        ) => {
          this.#admitTransfer(callOptions)
          return this.#broadcast((peer) => this.#request(peer, method, payload, callOptions))
        },
        notify: (
          method: string,
          payload?: unknown,
          callOptions?: Parameters<IRpcHost['notify']>[2]
        ) => {
          this.#admitTransfer(callOptions, callOptions?.targetId)
          return callOptions?.targetId === undefined
            ? this.#broadcast((peer) => peer.notify(method, payload, callOptions))
            : this.#direct(callOptions.targetId).notify(method, payload, callOptions)
        },
        stream: (
          method: string,
          payload?: unknown,
          callOptions?: Parameters<IRuntimePeer['stream']>[2]
        ) => {
          this.#admitTransfer(callOptions)
          const selected = this.#targets()
          if (selected.length === 1) return selected[0]!.peer.stream(method, payload, callOptions)
          const result = this.#fanout<ReturnType<IRuntimePeer['stream']>>()
          for (const { id, peer } of selected)
            try {
              result.fulfilled[JSON.stringify(['target', id])] = peer.stream(
                method,
                payload,
                callOptions
              )
            } catch (error) {
              result.rejected[JSON.stringify(['target', id])] = error
            }
          return result
        },
        group: (
          steps: Parameters<IRuntimePeer['group']>[0],
          callOptions?: Parameters<IRuntimePeer['group']>[1]
        ) => {
          this.#admitTransfer(callOptions)
          return this.#broadcast((peer) => peer.group(steps, callOptions))
        },
        outcome: (key: string) => this.#broadcast((peer) => peer.outcome(key)),
        send: (
          target: string,
          method: string,
          payload?: unknown,
          callOptions?: Parameters<IRuntimePeer['request']>[2]
        ) => {
          this.#admitTransfer(callOptions, target)
          return this.#sendRequest(target, method, payload, callOptions)
        },
        dispatch: (target: string, method: string, payload?: unknown) => {
          try {
            void this.#direct(target).notify(method, payload).catch(this.#report)
          } catch (error) {
            this.#report(error)
          }
        },
        describe: runtimeQuery(async () => {
          /** Local identity, provider inventory and counters remain the canonical fresh safe view. */
          const local = runtimeDetail(
            this.#description(),
            [...this.#sessions.values()]
              .filter((session) => session.direct && this.#live(session))
              .map((session) =>
                runtimeConnectionDetail(
                  readRuntimePeerConnection(session.peer!).directory,
                  RuntimeQueryStatus.ready,
                  { report: this.#report, counters: runtimeCounters(this.#endpoint) }
                )
              ),
            [],
            undefined,
            runtimeCounters(this.#endpoint)
          )
          if (!this.#assembled) return local
          /** Only the assembler's own safe state projection augments the local view. */
          const detail = await this.#assembled.describe()
          return detail.pool === undefined ? local : Object.freeze({ ...local, pool: detail.pool })
        })
      },
      'self',
      { get: () => this.#source.self, enumerable: true, configurable: true }
    ) as unknown as IRpcHost<unknown>
  }

  /** Expose read-only directory observation and the existing feature disposal registration. */
  readonly featureContext: IRpcHostRuntime['featureContext'] = (onDispose) => ({
    host: this.host,
    report: this.#report,
    onDispose,
    directories: {
      current: () =>
        [...this.#sessions.values()]
          .filter((session) => this.#live(session))
          .map((session) => readRuntimePeerConnection(session.peer!).description!),
      onAccepted: (observe) => {
        this.#accepted.add(observe)
        return () => {
          this.#accepted.delete(observe)
        }
      }
    }
  })

  /** Only native-installation signals are detached after the single opening settles. */
  #detachInitialSignal: (() => void) | undefined

  /** Install cancellation subscriptions before any native source acquisition. */
  #attachInitialSignals(initialSignal?: IAbortSignal): void {
    this.#preparation ??= readRuntimePreparationContext(this.#options)
    if (!this.#deployment)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, HostErrorText.deploymentInvalid)
    for (const signal of [
      this.#options.signal,
      this.#preparation?.initialSignal,
      this.#preparation?.lifecycleSignal,
      initialSignal
    ]) {
      if (!signal) continue
      const cancel = () => this.#controller.abort(resolveAbortReason(signal))
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
      /** A later Host mutation must not supersede a successfully installed byte connection. */
      if (
        (signal === this.#preparation?.initialSignal || signal === initialSignal) &&
        signal !== this.#options.signal &&
        signal !== this.#preparation?.lifecycleSignal
      )
        this.#detachInitialSignal = () => signal.removeEventListener('abort', cancel)
      else
        this.#preparation?.own?.(async () => {
          signal.removeEventListener('abort', cancel)
        })
    }
  }

  /** Context snapshots read final identity only after the actual bootstrap preparation. */
  #deploymentContext = (): IAdapterDeploymentContext => ({
    ...this.#source,
    signal: this.#controller.signal,
    connectTimeoutMs: this.#definition.connect?.timeoutMs,
    report: this.#report,
    ...(this.#endpoint
      ? {
          ownClose: (close: () => void | Promise<void>) => {
            readEndpointOwner<ResourceScope>(this.#endpoint!, EndpointOwnerKey.resourceScope)!.add(
              EndpointResourceLabel.transportSubscription,
              close,
              'critical'
            )
          }
        }
      : {}),
    configuredReport: this.#options.report,
    features: this.#options.plugins.filter(
      (plugin) => readRpcPluginMetadata(plugin)?.kind === 'feature'
    ) as readonly import('../plugin/types.js').IRpcFeaturePlugin[],
    launcher: (launcher, childName) =>
      prepareAdapterPeer(
        { self: this.#source.self, authentication: this.#credentials },
        this.#source.self.name
      ).launcher(launcher, childName)
  })

  /** Bootstrap bytes or messages determine the final native identity before endpoint creation. */
  async #bootstrapIdentity(): Promise<void> {
    if (this.#deployment!.bootstrap) {
      this.#bootstrapSource = await this.#deployment!.bootstrap(this.#deploymentContext())
      try {
        /** The real first frame is the sole authority for a default child's identity/generation. */
        const prepared =
          readAdapterMessageBootstrapSource(this.#bootstrapSource)?.preparation.initial ??
          readAdapterByteBootstrapSource(this.#bootstrapSource as IAdapterByteBootstrapSource)
            .bootstrap
        if (
          !this.#selfDefaulted &&
          (this.#source.self.name !== prepared.self.name ||
            this.#source.self.instanceId !== prepared.self.instanceId)
        )
          throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
        this.#source = prepareRuntimePeerSourceContext(prepared.self, true, this.#credentials)
        this.#generation = prepared.generation ?? {
          kind: RpcRuntimeGenerationKind.session,
          value: 0,
          providerId: this.#source.self.instanceId
        }
        if (this.#controller.signal.aborted)
          throw createRpcAbortError(
            undefined,
            undefined,
            resolveAbortReason(this.#controller.signal)
          )
      } catch (primary) {
        try {
          await this.#closeBootstrapSource()
        } catch (cleanup) {
          this.#report(cleanup)
        }
        this.#bootstrapSource = undefined
        throw primary
      }
    }
  }

  /** Create and activate the sole endpoint, its provider registry and original physical multiplex. */
  async #installEndpoint(): Promise<void> {
    this.#multiplex = createHostMultiplexTransport(this.#source.self, this.#report)
    /** Native options and feature slots lend their exact genuine registered probe objects. */
    const probes = [
      this.#deployment!.runtimeOptions?.probe,
      ...this.#features.flatMap((feature) => [feature.probe, feature.contribution?.probe])
    ].flatMap((configured) =>
      configured === undefined
        ? []
        : Array.isArray(configured)
          ? configured
          : [configured as IRpcProbe]
    )
    if (probes.length) {
      this.#probe = createProbeEmitter(
        probes,
        () => this.#multiplex!.channel.scheduler.now(),
        this.#source.self.instanceId
      )
      this.#probe.peerOwned = true
      this.#probe.authentication = this.#credentials?.encrypt
        ? 'encrypt-sign'
        : this.#credentials
          ? 'sign'
          : 'none'
      this.#releaseProbe = bindInstalledProbe(this.#multiplex.channel.transport, this.#probe)
    }
    this.#endpoint = createRuntimeApiEndpoint(
      {
        id: this.#source.self.instanceId,
        scheduler: this.#multiplex!.channel.scheduler,
        transport: this.#multiplex!.channel.transport,
        providerLimits: this.#options.providerLimits,
        middlewares: [
          codec(this.#multiplex!.channel.pipeline.codec),
          framer(this.#multiplex!.channel.pipeline.framer),
          ...(this.#credentials ? [authentication(this.#credentials)] : []),
          abort(),
          timeout(),
          hooks({ onHookError: this.#report }),
          ping(),
          connect({ transport: this.#multiplex!.channel.transport }),
          ...this.#contributions.flatMap((value) => value.middlewares ?? [])
        ],
        features: this.#contributions.flatMap((value) => value.features ?? [])
      },
      {
        ...this.#multiplex!.channel,
        supportsPeer: this.#multiplex!.supports,
        chunk: this.#contributions.find((value) => value.chunk)?.chunk,
        hostRegistration: this.#preparation?.providerAdmissionRegistration
      },
      this.#preparation?.providerAdmission
    )
    await this.#endpoint.ready
    this.#outbound = readEndpointOwner<RpcOutboundAttachment>(
      this.#endpoint,
      EndpointOwnerKey.outboundAttachment
    )!
    this.#outbound.configureRuntime(this.#generation)
    this.#registry = readEndpointOwner<ProviderRegistry>(
      this.#endpoint,
      EndpointOwnerKey.providerRegistry
    )!
    this.#assembly = prepareRuntimeProviderAssembly({
      methods: compileRuntimeMethods(this.#options.provide, this.#options.contract),
      streams: true,
      localOutcomes: true,
      supports: (peerId, capability) => this.#multiplex!.supports(peerId ?? '', capability),
      remoteNode: (peerId) => this.#sessions.get(peerId ?? '')?.remoteNode,
      bindRemoteNode: (peerId, value) => {
        const session = this.#sessions.get(peerId ?? '')
        if (session) session.remoteNode = value
      },
      describe: this.#description,
      acceptCaller: async (context) => {
        const supplied =
          typeof context.data === 'object' && context.data !== null
            ? Reflect.get(context.data, 'self')
            : undefined
        if (supplied === undefined) return
        const identity = prepareRuntimePeerSourceContext(supplied).self
        if (identity.instanceId !== context.senderId)
          throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
        const session = this.#sessions.get(context.senderId)
        if (session) {
          if (!session.peer) session.replySettled ??= whenProviderReplySettled(context)
          await this.#admitName(session, identity.name)
        }
      }
    })
    this.#assembly.install(this.#endpoint)
    this.#registry.runtimeResolve = this.#resolveNamespace
    this.#registry.sessionPolicy = (senderId) => this.#sessions.get(senderId)?.execution
    this.#multiplex!.channel.activateReceive?.()
    this.#multiplex!.onDeparture((peerId, error) => {
      const session = this.#sessions.get(peerId)
      if (session) void this.#retire(session, error).catch(this.#report)
    })
  }

  /** Open the selected native deployment after canonical providers and receive ownership exist. */
  async #openDeployment(preparedContext: IAdapterDeploymentContext): Promise<void> {
    const assembler = this.#features.find((feature) => feature.assemble)
    if (assembler) {
      try {
        this.#assembled = await assembler.assemble!({
          host: (0, this.#assemblyHost)?.() ?? this.host,
          transport: { name: this.#definition.name, mode: this.#definition.mode },
          openMember: async () =>
            this.#deployment!.managed
              ? this.#openManaged(preparedContext, false)
              : this.#accept(await this.#deployment!.open(preparedContext), false)
        })
        /** Method names come from accepted members; invocation always re-enters the one assembler. */
        const methods = new Map<string, IRuntimePeerDescription['methods'][number]>()
        for (const session of this.#sessions.values())
          if (!session.direct && this.#live(session))
            for (const method of readRuntimePeerConnection(session.peer!).description!.methods)
              if (!methods.has(method.name)) methods.set(method.name, method)
        Object.defineProperty(this.#peers, this.#assembled.id, {
          value: this.#projectMethods([...methods.values()], (method) => {
            /** The logical capability never captures a physical member or a private proof. */
            const streaming =
              method.supportedModes.every((mode) => mode === RuntimeApiMode.stream) ||
              method.yield !== undefined
            return (payload?: unknown) =>
              streaming
                ? this.#assembled!.stream(method.name, payload)
                : this.#assembled!.request(method.name, payload)
          }),
          enumerable: true,
          configurable: true
        })
      } catch (failure) {
        const cleanup: unknown[] = []
        for (const session of [...this.#sessions.values()].reverse())
          try {
            await this.#retire(session)
          } catch (error) {
            cleanup.push(error)
          }
        if (cleanup.length) this.#report(new AggregateError(cleanup, HostErrorText.cleanupFailed))
        throw failure
      }
    } else if (this.#deployment!.managed) await this.#openManaged(preparedContext, true)
    else if (this.#definition.mode === 'listen' && this.#deployment!.listen)
      this.#listener = await this.#deployment!.listen(preparedContext, async (channel, policy) => {
        const peer = await this.#accept(channel, true, { policy })
        return { peer, endpoint: readRuntimePeerEndpoint(peer as unknown as IRuntimePeer) }
      })
    else if (this.#bootstrapSource) {
      const channel = readAdapterMessageBootstrapSource(this.#bootstrapSource)
        ? await openAdapterMessageBootstrapSource(
            this.#bootstrapSource as IAdapterMessageBootstrapSource,
            preparedContext
          )
        : await openAdapterByteBootstrapSource(
            this.#bootstrapSource as IAdapterByteBootstrapSource,
            preparedContext
          )
      this.#bootstrapSource = undefined
      await this.#accept(channel)
    } else await this.#accept(await this.#deployment!.open(preparedContext))
  }

  /** Join one canonical opening and preserve its original completion identity. */
  readonly start: IRpcHostRuntime['start'] = (initialSignal) => {
    if (this.#starting) return this.#starting
    this.#starting = Promise.resolve()
      .then(async () => {
        this.#attachInitialSignals(initialSignal)
        await this.#bootstrapIdentity()
        await this.#installEndpoint()
        await this.#openDeployment(this.#deploymentContext())
      })
      .finally(() => this.#detachInitialSignal?.())
    return this.#starting
  }

  /** Capture immutable inputs and initialize state in the original construction order. */
  constructor(
    options: IRpcHostOptions,
    definition: IRpcTransportPluginDefinition,
    features: readonly IRpcFeaturePluginDefinition[],
    nodeId = createAuthenticationNonce(),
    onConnection?: (connection: IRuntimePluginConnection) => () => void,
    selfDefaulted = options.self === undefined,
    assemblyHost?: () => IRpcHost<unknown>
  ) {
    this.#options = options
    this.#definition = definition
    this.#features = features
    this.#nodeId = nodeId
    this.#onConnection = onConnection
    this.#selfDefaulted = selfDefaulted
    this.#assemblyHost = assemblyHost
    this.#contributions = this.#features
      .map((feature) => feature.contribution)
      .filter((value) => value !== undefined)
    this.#preparation = readRuntimePreparationContext(this.#options)
    this.#credentials =
      this.#options.authentication ??
      this.#contributions.find((value) => value.authentication !== undefined)?.authentication
    this.#source = prepareRuntimePeerSourceContext(this.#options.self, true, this.#credentials)
    this.#controller = createAbortController()
    this.#defaultTimeout = readRuntimeDefaultTimeout({
      defaultTimeoutMs:
        this.#options.defaultTimeoutMs ??
        this.#contributions.find((value) => value.defaultTimeoutMs !== undefined)?.defaultTimeoutMs
    })
    this.#callTimeout = prepareRuntimeCallTimeout(this.#defaultTimeout)
    this.#sessions = new Map<string, IHostSession>()
    this.#probing = new Set<string>()
    this.#accepted = new Set<(description: IRuntimePeerDescription) => unknown>()
    this.#peers = Object.create(null)
    this.#eventsPublisher = createRuntimeEventPublisher(() => this.#probe)
    this.#generation = {
      kind: RpcRuntimeGenerationKind.session,
      value: 0,
      providerId: this.#source.self.instanceId
    }
    this.#managedSubscriptions = []
    this.#managedMembers = []
    this.#deployment = readAdapterDeployment(this.#definition.deployment)
    this.host = this.#createHost()
  }
}

export function createRuntimeHost(
  options: IRpcHostOptions,
  definition: IRpcTransportPluginDefinition,
  features: readonly IRpcFeaturePluginDefinition[],
  nodeId = createAuthenticationNonce(),
  onConnection?: (connection: IRuntimePluginConnection) => () => void,
  selfDefaulted = options.self === undefined,
  assemblyHost?: () => IRpcHost<unknown>
): IRpcHostRuntime {
  return new RuntimeHost(
    options,
    definition,
    features,
    nodeId,
    onConnection,
    selfDefaulted,
    assemblyHost
  )
}
