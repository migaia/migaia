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
import {
  codec,
  framer,
  abort,
  timeout,
  hooks,
  ping,
  connect,
  authentication
} from '../core/index.js'
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
import { readRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
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

/** Create one canonical endpoint and project its physical sessions through the host call surface. */
export function createRuntimeHost(
  options: IRpcHostOptions,
  definition: IRpcTransportPluginDefinition,
  features: readonly IRpcFeaturePluginDefinition[],
  nodeId = createAuthenticationNonce(),
  onConnection?: (connection: IRuntimePluginConnection) => () => void,
  selfDefaulted = options.self === undefined,
  assemblyHost?: () => IRpcHost<unknown>
): IRpcHostRuntime {
  /** Contributions configure existing canonical roots before their sole construction. */
  const contributions = features
    .map((feature) => feature.contribution)
    .filter((value) => value !== undefined)
  /** Native Host provenance remains associated with the exact ordinary options carrier. */
  let preparation = readRuntimePreparationContext(options)
  /** One selected authentication profile controls both local offer and canonical middleware. */
  const credentials =
    options.authentication ??
    contributions.find((value) => value.authentication !== undefined)?.authentication
  /** Safe explicit identity is fixed; a default may be replaced only by actual bootstrap authority. */
  let source = prepareRuntimePeerSourceContext(options.self, true, credentials)
  /** Native installation owns cancellation; every physical opening receives this same lifetime. */
  const controller = createAbortController()
  /** A reporter failure follows the existing terminal observation policy. */
  const report = (error: unknown): void => {
    try {
      ;(options.report ?? defaultRpcReporter)(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /** The canonical inherited budget is captured once for all requests on this fixed feature set. */
  const defaultTimeout = readRuntimeDefaultTimeout({
    defaultTimeoutMs:
      options.defaultTimeoutMs ??
      contributions.find((value) => value.defaultTimeoutMs !== undefined)?.defaultTimeoutMs
  })
  /** Ordinary hot requests reuse the original immutable default options instead of rebuilding them. */
  const callTimeout = prepareRuntimeCallTimeout(defaultTimeout)
  /** The actual transport adapter selects framing for each held physical source. */
  let multiplex: ReturnType<typeof createHostMultiplexTransport> | undefined
  /** Only pre-identity bootstrap acquisition owns this raw resource before channel handoff. */
  let bootstrapSource: IAdapterByteBootstrapSource | IAdapterMessageBootstrapSource | undefined
  /** Both bootstrap variants close the same raw resource that supplied their admitted identity. */
  const closeBootstrapSource = async (): Promise<void> => {
    if (!bootstrapSource) return
    const message = readAdapterMessageBootstrapSource(bootstrapSource)
    if (message) await message.resource.close()
    else
      await readAdapterByteBootstrapSource(
        bootstrapSource as IAdapterByteBootstrapSource
      ).io.close()
  }
  /** Physical session receipts are the sole accepted directory/lifetime inventory. */
  const sessions = new Map<string, IHostSession>()
  /** Only simultaneous same-name admission probes need a temporary exclusion token. */
  const probing = new Set<string>()
  /** Directory subscribers own observation only, with no copied membership state. */
  const accepted = new Set<(description: IRuntimePeerDescription) => unknown>()
  /** Held own-data capability trees retain their original connection generation. */
  const peers: Record<string, object> = Object.create(null)
  /** The original emitter is constructed only after native bootstrap selects the final identity. */
  let probe: IProbeEmitter | undefined
  /** Canonical kernel cleanup and failed construction share this idempotent binding release. */
  let releaseProbe: (() => void) | undefined
  /** Lifecycle observations reuse the canonical event publisher. */
  const eventsPublisher = createRuntimeEventPublisher(() => probe)
  /** Provider generation belongs to this one endpoint, independent of physical attempt counters. */
  let generation: IRpcRuntimeGeneration = {
    kind: RpcRuntimeGenerationKind.session,
    value: 0,
    providerId: source.self.instanceId
  }
  /** Assembly results may replace the direct-target projection without replacing physical sessions. */
  let assembled: IRpcHostMember | undefined
  /** The original managed facade retains supervision, generation readiness and retry authority. */
  let managedPeer: IRuntimePeer | undefined
  /** Its logical direct name survives a transient physical rebind, as on the original registration. */
  let managedName: string | undefined
  /** Original registration/event subscriptions are released before its holder closes. */
  const managedSubscriptions: (() => void)[] = []
  /** Each original holder remains the sole owner of one managed transport opening. */
  const managedMembers: Readonly<{
    started(): boolean
    close(): Promise<void>
  }>[] = []
  /** A listener remains owned by this transport installation. */
  let listener: { close(): void | Promise<void> } | undefined
  /** Host close publishes one completion before invoking any user cleanup. */
  let closing: Promise<void> | undefined
  /** The endpoint is constructed only by start, after genuine native installation begins. */
  let endpoint!: ReturnType<typeof createRuntimeApiEndpoint>
  /** The original outbound attachment owns all correlation, replay and runtime generations. */
  let outbound!: RpcOutboundAttachment
  /** The original registry holds local, namespace and explicitly captured forward providers. */
  let registry!: ProviderRegistry
  /** The one shared provider compiler remains reusable by standalone peer construction. */
  let assembly!: ReturnType<typeof prepareRuntimeProviderAssembly>
  /** Every start caller joins the same native opening rather than acquiring duplicate resources. */
  let starting: Promise<void> | undefined
  /** Native source preparation has one genuine token; copied empty objects confer no authority. */
  const deployment = readAdapterDeployment(definition.deployment)

  /** A direct target must be ready on its original physical channel at this exact call. */
  const live = (session: IHostSession): boolean =>
    Boolean(session.connection && !session.closing && !session.channel.transport.closed)
  /** Target names are the remote handshake name, never the local plugin registration. */
  const byName = (name: string): IHostSession | undefined => {
    for (const session of sessions.values())
      if (session.direct && session.name === name && live(session)) return session
    return undefined
  }
  /** Existing target diagnostics preserve their canonical semantic code and text. */
  const unknown = (_name: string): never => {
    throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
  }
  /** Direct calls select one current accepted receipt, with no waiting or retargeting. */
  const direct = (name: string): IRuntimePeer => {
    if (closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (assembled?.id === name) return assembled as unknown as IRuntimePeer
    /** Existing names retain priority; endpoint ids still select only live direct sessions. */
    const addressed = sessions.get(name)
    const session = byName(name) ?? (addressed?.direct && live(addressed) ? addressed : undefined)
    return session?.connection?.peer ?? session?.peer ?? unknown(name)
  }
  /** Build a per-connection snapshot; accepted peers are never hot-updated within a generation. */
  const description = (peerId?: string): IRuntimePeerDescription =>
    normalizeRuntimeDescription({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self: multiplex!.supports(peerId ?? '', RpcCapability.generation)
        ? { ...source.self, generation }
        : source.self,
      ...(multiplex!.supports(peerId ?? '', RpcCapability.forwardRoute) ? { nodeId } : {}),
      methods: describeRuntimeMethods(
        assembly.methods(),
        multiplex!.supports(peerId ?? '', RpcCapability.stream)
      ).map((method) => {
        if (method.forwardedVia === undefined || namespaceSegment.test(method.forwardedVia))
          return method
        const { forwardedVia: _hint, ...description } = method
        return description
      })
    })
  /** A captured capability uses canonical forwarding and may never follow a same-name successor. */
  const forward = (
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
      nodeId,
      supportedModes: method.supportedModes,
      ...(!held
        ? {
            readDescription: () => {
              const current = byName(targetName)
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
        const current = byName(targetName)
        if (!current || (heldSession !== undefined && current !== heldSession)) unknown(targetName)
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
  const projectMethods = (
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
  const project = (session: IHostSession): object =>
    projectMethods(readRuntimePeerConnection(session.peer!).description!.methods, (method) => {
      const entry = forward(session, method, method.name, true)
      /** Generated routes admit every mode; their default capability call remains a scalar request. */
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
    })
  /** Resolve the longest accepted namespace after the canonical exact-local lookup has failed. */
  const resolveNamespace = (method: string) => {
    if (
      method.length > RpcWireLimit.maxIdentifierChars ||
      !method.split('.').every((part) => namespaceSegment.test(part))
    )
      return undefined
    if (method.startsWith(RemoteMethodName.runtimeNamespace) || !method.includes('.'))
      return undefined
    const names = [
      ...new Set(
        assembly
          .methods()
          .filter((entry) => entry.kind === 'forward')
          .map((entry) => (entry as IRuntimeForwardMethodEntry).forwardedVia)
      ),
      ...[...sessions.values()]
        .map((session) => session.name)
        .filter((name): name is string => name !== undefined)
    ]
    const name = names
      .filter((name) => method.startsWith(`${name}.`))
      .sort((left, right) => right.length - left.length)[0]
    if (!name) unknown(method)
    const session = byName(name!) ?? unknown(name!)
    const selected = readRuntimePeerConnection(session.peer!).description!.methods.find(
      (entry) => entry.name === method.slice(name!.length + 1)
    )
    if (!selected)
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    assembly.append([forward(session, selected, method, false)])
    return registry.providers.get(method)
  }
  /** Closing a physical receipt never disposes the host's one shared endpoint. */
  const retire = (session: IHostSession, reason?: unknown): Promise<void> => {
    if (session.closing) return session.closing
    const completion = deferred<void>()
    session.closing = completion.promise
    /** Only an unaccepted candidate waits for its already-running directory reply's actual write. */
    const release = (): void => {
      if (session.peer && probe && (probe.mask & (1 << RpcProbeStage.peer)) !== 0)
        probe.peer(RuntimeProbeLifecycle.closing, session.channel.peerId, reason)
      if (sessions.get(session.channel.peerId) === session) sessions.delete(session.channel.peerId)
      const departed = reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      session.reason = departed
      for (const observe of Array.from(session.departures)) {
        try {
          observe(departed)
        } catch (failure) {
          report(failure)
        }
      }
      session.departures.clear()
      outbound?.retireRuntimeTarget(session.channel.peerId, departed)
      readEndpointOwner<RpcStreamOwner>(endpoint, EndpointOwnerKey.streamOwner)?.retireTarget(
        session.channel.peerId,
        departed
      )
      session.withdraw?.()
      if (session.name && peers[session.name] && byName(session.name) === undefined)
        delete peers[session.name]
      try {
        session.detach()
      } catch (error) {
        report(error)
      }
      void Promise.resolve()
        .then(async () => {
          if (session.peer) await session.peer.close()
          else await session.channel.close()
        })
        .then(completion.resolve, completion.reject)
      if (!session.managed && session.peer && session.name)
        eventsPublisher.publish(
          {
            type: RuntimeEventName.exit,
            name: session.name,
            instanceId: session.channel.peerId,
            generation: 0,
            timestamp: session.channel.scheduler.now(),
            clock: RuntimeQueryClock.scheduler,
            ...(reason === undefined ? {} : { error: runtimeErrorIdentity(reason, report) })
          },
          report
        )
    }
    if (!session.peer && session.replySettled)
      void session.replySettled.then(release).then(undefined, completion.reject)
    else release()
    return completion.promise
  }
  /** Name arbitration uses one existing ping, and lets only the winning candidate publish. */
  const admitName = (session: IHostSession, name: string): Promise<void> => {
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
        if (probing.has(name)) throw createPeerNameDuplicateError()
        const previous = [...sessions.values()].find(
          (candidate) =>
            candidate !== session &&
            candidate.direct &&
            (candidate.name ?? candidate.admission?.name) === name &&
            !candidate.closing
        )
        if (previous) {
          if (!previous.peer) throw createPeerNameDuplicateError()
          if (!previous.channel.transport.closed) {
            probing.add(name)
            try {
              let alive = false
              try {
                alive = await endpoint.ping!(previous.channel.peerId, undefined, {
                  timeoutMs: definition.connect?.timeoutMs ?? 10_000
                })
              } catch (failure) {
                report(failure)
              }
              if (alive) throw createPeerNameDuplicateError()
              await retire(previous)
            } finally {
              probing.delete(name)
            }
          } else await retire(previous)
        }
        session.name = name
      })
      .then(completion.resolve, completion.reject)
    return completion.promise
  }
  /** Publish the original prepared receipt only after the accepting owner commits readiness. */
  const publishSession = async (
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
      report
    })
    /** Hidden members retain genuine readiness observation without becoming public direct targets. */
    if (probe && (probe.mask & (1 << RpcProbeStage.peer)) !== 0)
      probe.peer(RuntimeEventName.ready, session.channel.peerId, undefined)
    if (!session.direct) return
    session.withdraw = onConnection?.(session.connection)
    if (session.direct) {
      Object.defineProperty(peers, remote.self.name, {
        value: project(session),
        enumerable: true,
        configurable: true
      })
      const additions = remote.methods
        .filter(
          (method) =>
            namespaceSegment.test(remote.self.name) &&
            `${remote.self.name}.${method.name}`.length <= RpcWireLimit.maxIdentifierChars &&
            !registry.providers.has(`${remote.self.name}.${method.name}`) &&
            !assembly.methods().some((entry) => entry.name === `${remote.self.name}.${method.name}`)
        )
        .map((method) => forward(session, method, `${remote.self.name}.${method.name}`, false))
      if (additions.length) assembly.append(additions)
    }
    for (const observe of Array.from(accepted)) {
      try {
        await observe(remote)
      } catch (error) {
        report(error)
      }
    }
    eventsPublisher.publish(
      runtimeReadyEvent(remote.self.name, publishedPeer, publishedGeneration),
      report
    )
  }
  /**
   * A fresh raw channel joins the existing endpoint before the original bilateral directory
   * exchange.
   */
  const accept = async (
    channel: IRuntimePeerSourceResult,
    directTarget = true,
    preparation?: Readonly<{
      managed?: true
      signal?: IAbortSignal
      wrapEndpoint?: IAdapterDeploymentEndpointPreparation['wrapEndpoint']
      policy?: IAdapterDeploymentEndpointPreparation
    }>
  ): Promise<IRpcHostMember> => {
    if (closing) {
      await channel.close()
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    }
    try {
      multiplex!.assertAttach(channel.peerId)
    } catch (primary) {
      try {
        await channel.close()
      } catch (cleanup) {
        report(cleanup)
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
    sessions.set(channel.peerId, session)
    try {
      /** The accepted native source contributes its original execution policy exactly once. */
      const nativePolicy =
        preparation?.policy ?? deployment?.prepareEndpoint?.(channel, options.providerLimits)
      session.execution = nativePolicy?.execution
      /** This view preserves the same kernel while native rollback can only retire its own session. */
      const borrowed = Object.freeze(
        Object.create(endpoint, { dispose: { value: () => retire(session) } })
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
      session.detach = multiplex!.attach(channel)
      const peer = await createRuntimePeer(
        {
          self: source.self,
          defaultTimeoutMs:
            options.defaultTimeoutMs ??
            contributions.find((value) => value.defaultTimeoutMs !== undefined)?.defaultTimeoutMs,
          report
        },
        {
          channel: preparation?.managed ? { ...channel, close: undefined } : channel,
          wrapEndpoint: wrap,
          endpoint: { endpoint: borrowed, oneWay: endpoint, stream: endpoint.stream },
          assembly,
          generation,
          nodeId,
          hostSession: true,
          restrictTransfer: (callOptions) => {
            if (
              callOptions &&
              Object.hasOwn(callOptions, 'transfer') &&
              !multiplex!.supports(channel.peerId, RpcCapability.transfer)
            )
              rejectRuntimeApiCapability()
          },
          signal: preparation?.signal ?? controller.signal,
          description: () => description(channel.peerId)
        }
      )
      const remote = readRuntimePeerConnection(peer).description!
      if (probe && (probe.mask & (1 << RpcProbeStage.peer)) !== 0) {
        probe.peer(RuntimeProbeLifecycle.handshake, channel.peerId, undefined)
        probe.peer(RuntimeProbeLifecycle.directory, channel.peerId, undefined)
      }
      await admitName(session, remote.self.name)
      session.peer = peer
      if (!session.managed) await publishSession(session)
      const member = Object.freeze({
        ...peer,
        id: remote.self.name,
        close: () => retire(session),
        [Symbol.asyncDispose]: () => retire(session)
      })
      retainRuntimeSessionConnection(member, peer)
      return member
    } catch (error) {
      try {
        await retire(session, error)
      } catch (cleanup) {
        report(cleanup)
      }
      throw error
    }
  }
  /** Read numeric generation from the accepted wire owner; no host retry counter is introduced. */
  const sessionGeneration = (session: IHostSession): number =>
    readRuntimePeerConnection(session.peer!).description?.self.generation?.value ?? 0
  /**
   * Retry is opt-in and delegates capture, keys, timeout and the replay decision to canonical
   * owners.
   */
  const request = (
    peer: IRuntimePeer,
    method: string,
    payload?: unknown,
    callOptions?: Parameters<IRuntimePeer['request']>[2]
  ) => {
    const session = Array.from(sessions.values()).find((candidate) => candidate.peer === peer)
    const suppliedPort = contributions.find((value) => value.retryPort !== undefined)?.retryPort
    if (!session || (!suppliedPort && !contributions.some((value) => value.retry)))
      return peer.request(method, payload, callOptions)
    if (
      callOptions &&
      Object.hasOwn(callOptions, 'transfer') &&
      !multiplex!.supports(session.channel.peerId, RpcCapability.transfer)
    )
      rejectRuntimeApiCapability()
    if (!session.retryRequest) {
      /** Original ready/exit publications are observed without owning a reconnect state machine. */
      const current = () =>
        byName(session.name!) ??
        (() => {
          throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed, session.reason, {
            generation: sessionGeneration(session)
          })
        })()
      const events: IRemoteGenerationEvents = {
        current: () => {
          const active = byName(session.name!)
          return {
            generation: active ? sessionGeneration(active) : sessionGeneration(session),
            active: active !== undefined
          }
        },
        onLeave: (generation, observe) => {
          const active = byName(session.name!)
          if (!active || sessionGeneration(active) !== generation) {
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
            const existing = byName(session.name!)
            if (existing && existing !== session) {
              resolve(sessionGeneration(existing))
              return
            }
            const stopped = () => {
              remove()
              reject(
                signal?.aborted ? resolveAbortReason(signal) : resolveAbortReason(controller.signal)
              )
            }
            const ready = eventsPublisher.on(RuntimeEventName.ready, (event) => {
              if (event.name !== session.name) return
              const accepted = byName(session.name!)
              if (!accepted || accepted === session) return
              remove()
              resolve(sessionGeneration(accepted))
            })
            const remove = () => {
              ready()
              signal?.removeEventListener('abort', stopped)
              controller.signal.removeEventListener('abort', stopped)
            }
            if (signal?.aborted || controller.signal.aborted) stopped()
            else {
              signal?.addEventListener('abort', stopped, { once: true })
              controller.signal.addEventListener('abort', stopped, { once: true })
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
              number: sessionGeneration(active),
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
          timeout: (value) => (value === false ? undefined : (value ?? defaultTimeout)),
          closed: (generation, cause) =>
            createRemoteLayerError(RpcRemoteLayerErrorCode.closed, cause, { generation }),
          departureCause: () => session.reason,
          restoreFailure: (error) => {
            throw error
          }
        },
        report,
        suppliedPort
      )
    }
    return session.retryRequest(method, payload, callTimeout(callOptions))
  }
  /** Fanout captures target identity once and retains independent original settlement values. */
  const targets = (): readonly Readonly<{ id: string; peer: IRuntimePeer }>[] => {
    if (closing) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (assembled) return [{ id: assembled.id, peer: assembled as unknown as IRuntimePeer }]
    if (managedPeer && managedName) return [{ id: managedName, peer: managedPeer }]
    return [...sessions.values()]
      .filter((session) => session.direct && live(session))
      .map((session) => ({ id: session.name!, peer: session.connection?.peer ?? session.peer! }))
  }
  /** Reject unsupported ownership options before async fanout can turn admission into a result. */
  const admitTransfer = (callOptions: object | undefined, target?: string): void => {
    if (!callOptions || !Object.hasOwn(callOptions, 'transfer') || assembled) return
    /** Explicit names retain priority over an endpoint-id fallback, including unusual user names. */
    const addressed = target === undefined ? undefined : (byName(target) ?? sessions.get(target))
    for (const session of target === undefined ? sessions.values() : addressed ? [addressed] : [])
      if (
        session.direct &&
        live(session) &&
        !multiplex!.supports(session.channel.peerId, RpcCapability.transfer)
      )
        rejectRuntimeApiCapability()
  }
  /** Direct dispatch keeps its original Promise rejection timing for non-transfer target failures. */
  const sendRequest = async (
    target: string,
    method: string,
    payload?: unknown,
    callOptions?: Parameters<IRuntimePeer['request']>[2]
  ) => request(direct(target), method, payload, callOptions)
  /** Records use the endpoint's canonical key grammar and have no inherited dictionary members. */
  const fanout = <T>(): {
    fulfilled: Partial<Record<string, T>>
    rejected: Partial<Record<string, unknown>>
  } => ({ fulfilled: Object.create(null), rejected: Object.create(null) })
  /** Scalar and Promise operations preserve single-target behavior and isolate multiple targets. */
  const broadcast = async <T>(
    operation: (peer: IRuntimePeer) => T | Promise<T>
  ): Promise<T | IRpcFanoutResult<T>> => {
    const selected = targets()
    if (selected.length === 1) return operation(selected[0]!.peer)
    const result = fanout<T>()
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
  const openManaged = async (
    context: IAdapterDeploymentContext,
    directTarget: boolean
  ): Promise<IRpcHostMember> => {
    const native = await deployment!.managed!(context)
    /** One binding retains its preceding accepted receipt until the next native generation opens. */
    let precedingSession: IRpcHostMember | undefined
    const peer = await createManagedRuntimePeer(
      {
        self: source.self,
        provide: options.provide,
        authentication: credentials,
        defaultTimeoutMs: defaultTimeout,
        providerLimits: options.providerLimits,
        contract: options.contract,
        report,
        keyFactory: native.keyFactory ?? deployment!.runtimeOptions?.keyFactory,
        retryPort:
          contributions.find((value) => value.retryPort !== undefined)?.retryPort ??
          native.retryPort ??
          deployment!.runtimeOptions?.retryPort,
        callDeadlineCapMs: native.callDeadlineCapMs
      },
      native.binding,
      native.bindEndpoint,
      {
        ...preparation,
        prepareReplacement: native.prepareReplacement,
        initialSignal: controller.signal,
        lifecycleSignal: controller.signal,
        prepareRuntime: async (channel, signal) => {
          /** Abandoned native work can outlive its logical session; its successor owns this slot. */
          try {
            await precedingSession?.close()
          } catch (cleanup) {
            report(cleanup)
          }
          precedingSession = await accept(channel, directTarget, {
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
      const session = sessions.get(receipt.peerId)
      if (!session || closing) return
      session.direct = directTarget
      if (directTarget) managedName = receipt.description!.self.name
      registration.events.onLeave(number, (reason) => {
        void retire(session, reason).catch(report)
      })
      await publishSession(session, peer, number)
    }
    managedSubscriptions.push(
      registration.onReady((peer, number) => {
        void committed(peer, number).catch(report)
      })
    )
    if (directTarget)
      for (const event of [
        RuntimeEventName.exit,
        RuntimeEventName.restart,
        RuntimeEventName.degraded,
        RuntimeEventName.terminal
      ])
        managedSubscriptions.push(
          peer.on(event, (observation) =>
            eventsPublisher.publish(
              { ...observation, name: managedName ?? observation.name },
              report
            )
          )
        )
    /** Pool rollback and host fallback join one original native close attempt, including rejection. */
    let memberClosing: Promise<void> | undefined
    /** This receipt releases only this binding's canonical holder and never the shared endpoint. */
    const closeMember = (): Promise<void> => (memberClosing ??= peer.close())
    const member = Object.freeze({
      ...peer,
      id: readRuntimePeerConnection(peer).description!.self.name,
      close: closeMember,
      [Symbol.asyncDispose]: closeMember
    })
    managedMembers.push({ started: () => memberClosing !== undefined, close: closeMember })
    if (directTarget) managedPeer = peer
    await committed(registration.currentPeer(), registration.events.current().generation)
    retainRuntimeSessionConnection(member, peer)
    return member
  }

  /** Close prevents late admission and releases every acquired resource despite cleanup failures. */
  const close = (): Promise<void> => {
    if (closing) return closing
    const completion = deferred<void>()
    closing = completion.promise
    eventsPublisher.close()
    void Promise.resolve()
      .then(async () => {
        const failures: unknown[] = []
        /** The original assembler drains accepted work while all member channels remain usable. */
        try {
          await assembled?.close()
        } catch (error) {
          failures.push(error)
        }
        for (const dispose of managedSubscriptions.splice(0))
          try {
            dispose()
          } catch (error) {
            failures.push(error)
          }
        for (const member of managedMembers.splice(0).reverse())
          try {
            if (!member.started()) await member.close()
          } catch (error) {
            failures.push(error)
          }
        /** Native listener sessions drain their own generations before the fallback retirement. */
        try {
          await listener?.close()
        } catch (error) {
          failures.push(error)
        }
        /** Acquisition cancellation follows native drains while their actual channels remain live. */
        controller.abort(createRpcLifecycleError(RpcCoreErrorText.endpointDisposed))
        for (const session of [...sessions.values()].reverse())
          try {
            await retire(session)
          } catch (error) {
            failures.push(error)
          }
        try {
          await endpoint?.dispose()
        } catch (error) {
          failures.push(error)
        }
        try {
          releaseProbe?.()
          await multiplex?.close()
          await closeBootstrapSource()
        } catch (error) {
          failures.push(error)
        }
        accepted.clear()
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
  const host = {
    get self() {
      return source.self
    },
    peers,
    on: eventsPublisher.on,
    close,
    [Symbol.asyncDispose]: close,
    provide: (provide: IRuntimePeerProvide) => assembly.append(compileRuntimeMethods(provide)),
    request: (
      method: string,
      payload?: unknown,
      callOptions?: Parameters<IRuntimePeer['request']>[2]
    ) => {
      admitTransfer(callOptions)
      return broadcast((peer) => request(peer, method, payload, callOptions))
    },
    notify: (
      method: string,
      payload?: unknown,
      callOptions?: Parameters<IRpcHost['notify']>[2]
    ) => {
      admitTransfer(callOptions, callOptions?.targetId)
      return callOptions?.targetId === undefined
        ? broadcast((peer) => peer.notify(method, payload, callOptions))
        : direct(callOptions.targetId).notify(method, payload, callOptions)
    },
    stream: (
      method: string,
      payload?: unknown,
      callOptions?: Parameters<IRuntimePeer['stream']>[2]
    ) => {
      admitTransfer(callOptions)
      const selected = targets()
      if (selected.length === 1) return selected[0]!.peer.stream(method, payload, callOptions)
      const result = fanout<ReturnType<IRuntimePeer['stream']>>()
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
      admitTransfer(callOptions)
      return broadcast((peer) => peer.group(steps, callOptions))
    },
    outcome: (key: string) => broadcast((peer) => peer.outcome(key)),
    send: (
      target: string,
      method: string,
      payload?: unknown,
      callOptions?: Parameters<IRuntimePeer['request']>[2]
    ) => {
      admitTransfer(callOptions, target)
      return sendRequest(target, method, payload, callOptions)
    },
    dispatch: (target: string, method: string, payload?: unknown) => {
      try {
        void direct(target).notify(method, payload).catch(report)
      } catch (error) {
        report(error)
      }
    },
    describe: runtimeQuery(async () => {
      /** Local identity, provider inventory and counters remain the canonical fresh safe view. */
      const local = runtimeDetail(
        description(),
        [...sessions.values()]
          .filter((session) => session.direct && live(session))
          .map((session) =>
            runtimeConnectionDetail(
              readRuntimePeerConnection(session.peer!).directory,
              RuntimeQueryStatus.ready,
              { report, counters: runtimeCounters(endpoint) }
            )
          ),
        [],
        undefined,
        runtimeCounters(endpoint)
      )
      if (!assembled) return local
      /** Only the assembler's own safe state projection augments the local view. */
      const detail = await assembled.describe()
      return detail.pool === undefined ? local : Object.freeze({ ...local, pool: detail.pool })
    })
  } as IRpcHost<unknown>

  return {
    host,
    close,
    featureContext: (onDispose) => ({
      host,
      report,
      onDispose,
      directories: {
        current: () =>
          [...sessions.values()]
            .filter((session) => live(session))
            .map((session) => readRuntimePeerConnection(session.peer!).description!),
        onAccepted: (observe) => {
          accepted.add(observe)
          return () => {
            accepted.delete(observe)
          }
        }
      }
    }),
    start: (initialSignal) => {
      if (starting) return starting
      /** Native installation cancellation ends after preparation; Host lifetime remains attached. */
      let detachInitialSignal: (() => void) | undefined
      starting = Promise.resolve()
        .then(async () => {
          preparation ??= readRuntimePreparationContext(options)
          if (!deployment)
            throw createRpcError(RpcCoreErrorCode.invalidConfig, HostErrorText.deploymentInvalid)
          for (const signal of [
            options.signal,
            preparation?.initialSignal,
            preparation?.lifecycleSignal,
            initialSignal
          ]) {
            if (!signal) continue
            const cancel = () => controller.abort(resolveAbortReason(signal))
            if (signal.aborted) cancel()
            else signal.addEventListener('abort', cancel, { once: true })
            /** A later Host mutation must not supersede a successfully installed byte connection. */
            if (
              (signal === preparation?.initialSignal || signal === initialSignal) &&
              signal !== options.signal &&
              signal !== preparation?.lifecycleSignal
            )
              detachInitialSignal = () => signal.removeEventListener('abort', cancel)
            else
              preparation?.own?.(async () => {
                signal.removeEventListener('abort', cancel)
              })
          }
          /** Context snapshots read final identity only after the actual bootstrap preparation. */
          const context = (): IAdapterDeploymentContext => ({
            ...source,
            signal: controller.signal,
            connectTimeoutMs: definition.connect?.timeoutMs,
            report,
            ...(endpoint
              ? {
                  ownClose: (close: () => void | Promise<void>) => {
                    readEndpointOwner<ResourceScope>(
                      endpoint!,
                      EndpointOwnerKey.resourceScope
                    )!.add(EndpointResourceLabel.transportSubscription, close, 'critical')
                  }
                }
              : {}),
            configuredReport: options.report,
            features: options.plugins.filter(
              (plugin) => readRpcPluginMetadata(plugin)?.kind === 'feature'
            ) as readonly import('../plugin/types.js').IRpcFeaturePlugin[],
            launcher: (launcher, childName) =>
              prepareAdapterPeer(
                { self: source.self, authentication: credentials },
                source.self.name
              ).launcher(launcher, childName)
          })
          if (deployment.bootstrap) {
            bootstrapSource = await deployment.bootstrap(context())
            try {
              /**
               * The real first frame is the sole authority for a default child's
               * identity/generation.
               */
              const prepared =
                readAdapterMessageBootstrapSource(bootstrapSource)?.preparation.initial ??
                readAdapterByteBootstrapSource(bootstrapSource as IAdapterByteBootstrapSource)
                  .bootstrap
              if (
                !selfDefaulted &&
                (source.self.name !== prepared.self.name ||
                  source.self.instanceId !== prepared.self.instanceId)
              )
                throw createRpcError(
                  RpcCoreErrorCode.invalidConfig,
                  RuntimeApiErrorText.identityInvalid
                )
              source = prepareRuntimePeerSourceContext(prepared.self, true, credentials)
              generation = prepared.generation ?? {
                kind: RpcRuntimeGenerationKind.session,
                value: 0,
                providerId: source.self.instanceId
              }
              if (controller.signal.aborted)
                throw createRpcAbortError(
                  undefined,
                  undefined,
                  resolveAbortReason(controller.signal)
                )
            } catch (primary) {
              try {
                await closeBootstrapSource()
              } catch (cleanup) {
                report(cleanup)
              }
              bootstrapSource = undefined
              throw primary
            }
          }
          multiplex = createHostMultiplexTransport(source.self, report)
          /** Native options and feature slots lend their exact genuine registered probe objects. */
          const probes = [
            deployment.runtimeOptions?.probe,
            ...features.flatMap((feature) => [feature.probe, feature.contribution?.probe])
          ].flatMap((configured) =>
            configured === undefined
              ? []
              : Array.isArray(configured)
                ? configured
                : [configured as IRpcProbe]
          )
          if (probes.length) {
            probe = createProbeEmitter(
              probes,
              () => multiplex!.channel.scheduler.now(),
              source.self.instanceId
            )
            probe.peerOwned = true
            probe.authentication = credentials?.encrypt
              ? 'encrypt-sign'
              : credentials
                ? 'sign'
                : 'none'
            releaseProbe = bindInstalledProbe(multiplex.channel.transport, probe)
          }
          endpoint = createRuntimeApiEndpoint(
            {
              id: source.self.instanceId,
              scheduler: multiplex!.channel.scheduler,
              transport: multiplex!.channel.transport,
              providerLimits: options.providerLimits,
              middlewares: [
                codec(multiplex!.channel.pipeline.codec),
                framer(multiplex!.channel.pipeline.framer),
                ...(credentials ? [authentication(credentials)] : []),
                abort(),
                timeout(),
                hooks({ onHookError: report }),
                ping(),
                connect({ transport: multiplex!.channel.transport }),
                ...contributions.flatMap((value) => value.middlewares ?? [])
              ],
              features: contributions.flatMap((value) => value.features ?? [])
            },
            {
              ...multiplex!.channel,
              supportsPeer: multiplex!.supports,
              chunk: contributions.find((value) => value.chunk)?.chunk,
              hostRegistration: preparation?.providerAdmissionRegistration
            },
            preparation?.providerAdmission
          )
          await endpoint.ready
          outbound = readEndpointOwner<RpcOutboundAttachment>(
            endpoint,
            EndpointOwnerKey.outboundAttachment
          )!
          outbound.configureRuntime(generation)
          registry = readEndpointOwner<ProviderRegistry>(
            endpoint,
            EndpointOwnerKey.providerRegistry
          )!
          assembly = prepareRuntimeProviderAssembly({
            methods: compileRuntimeMethods(options.provide, options.contract),
            streams: true,
            localOutcomes: true,
            supports: (peerId, capability) => multiplex!.supports(peerId ?? '', capability),
            remoteNode: (peerId) => sessions.get(peerId ?? '')?.remoteNode,
            bindRemoteNode: (peerId, value) => {
              const session = sessions.get(peerId ?? '')
              if (session) session.remoteNode = value
            },
            describe: description,
            acceptCaller: async (context) => {
              const supplied =
                typeof context.data === 'object' && context.data !== null
                  ? Reflect.get(context.data, 'self')
                  : undefined
              if (supplied === undefined) return
              const identity = prepareRuntimePeerSourceContext(supplied).self
              if (identity.instanceId !== context.senderId)
                throw createRpcError(
                  RpcCoreErrorCode.invalidConfig,
                  RuntimeApiErrorText.identityInvalid
                )
              const session = sessions.get(context.senderId)
              if (session) {
                if (!session.peer) session.replySettled ??= whenProviderReplySettled(context)
                await admitName(session, identity.name)
              }
            }
          })
          assembly.install(endpoint)
          registry.runtimeResolve = resolveNamespace
          registry.sessionPolicy = (senderId) => sessions.get(senderId)?.execution
          multiplex!.channel.activateReceive?.()
          multiplex!.onDeparture((peerId, error) => {
            const session = sessions.get(peerId)
            if (session) void retire(session, error).catch(report)
          })
          const preparedContext = context()
          const assembler = features.find((feature) => feature.assemble)
          if (assembler) {
            try {
              assembled = await assembler.assemble!({
                host: assemblyHost?.() ?? host,
                transport: { name: definition.name, mode: definition.mode },
                openMember: async () =>
                  deployment.managed
                    ? openManaged(preparedContext, false)
                    : accept(await deployment.open(preparedContext), false)
              })
              /**
               * Method names come from accepted members; invocation always re-enters the one
               * assembler.
               */
              const methods = new Map<string, IRuntimePeerDescription['methods'][number]>()
              for (const session of sessions.values())
                if (!session.direct && live(session))
                  for (const method of readRuntimePeerConnection(session.peer!).description!
                    .methods)
                    if (!methods.has(method.name)) methods.set(method.name, method)
              Object.defineProperty(peers, assembled.id, {
                value: projectMethods([...methods.values()], (method) => {
                  /** The logical capability never captures a physical member or a private proof. */
                  const streaming =
                    method.supportedModes.every((mode) => mode === RuntimeApiMode.stream) ||
                    method.yield !== undefined
                  return (payload?: unknown) =>
                    streaming
                      ? assembled!.stream(method.name, payload)
                      : assembled!.request(method.name, payload)
                }),
                enumerable: true,
                configurable: true
              })
            } catch (failure) {
              const cleanup: unknown[] = []
              for (const session of [...sessions.values()].reverse())
                try {
                  await retire(session)
                } catch (error) {
                  cleanup.push(error)
                }
              if (cleanup.length) report(new AggregateError(cleanup, HostErrorText.cleanupFailed))
              throw failure
            }
          } else if (deployment.managed) await openManaged(preparedContext, true)
          else if (definition.mode === 'listen' && deployment.listen)
            listener = await deployment.listen(preparedContext, async (channel, policy) => {
              const peer = await accept(channel, true, { policy })
              return { peer, endpoint: readRuntimePeerEndpoint(peer as unknown as IRuntimePeer) }
            })
          else if (bootstrapSource) {
            const channel = readAdapterMessageBootstrapSource(bootstrapSource)
              ? await openAdapterMessageBootstrapSource(
                  bootstrapSource as IAdapterMessageBootstrapSource,
                  preparedContext
                )
              : await openAdapterByteBootstrapSource(
                  bootstrapSource as IAdapterByteBootstrapSource,
                  preparedContext
                )
            bootstrapSource = undefined
            await accept(channel)
          } else await accept(await deployment.open(preparedContext))
        })
        .finally(() => detachInitialSignal?.())
      return starting
    }
  }
}
