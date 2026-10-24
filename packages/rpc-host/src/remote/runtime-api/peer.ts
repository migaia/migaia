import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { createRpcError, createRpcSerializationError } from '../../core/errors.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import type { IRpcProbe } from '../../core/probe/types.js'
import { createRuntimePeerCalls } from '../internal/runtime-call.js'
import {
  runtimeConnectionDetail,
  runtimeDetail,
  runtimeQuery,
  runtimeCounters,
  type IRuntimeQuery,
  type IRuntimeDetail,
  type IRuntimeConnectionDirectory
} from './overview.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { createAbortController } from '@migaia/lifecycle'
import { normalizePortable } from '@migaia/rpc-contract'
import { normalizeRuntimeGeneration } from '@migaia/rpc-contract/runtime/metadata'
import type { IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type { IRpcRuntimeStep, IRpcRuntimeOutcomeResult } from '@migaia/rpc-contract/runtime'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/v1'
import { RpcRuntimeGenerationKind, RpcRuntimeKind } from '@migaia/rpc-contract/framing/v1'
import { readEndpointOwner } from '../../core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../core/endpoint-kernel.js'
import type { RpcOutboundAttachment } from '../../core/internal/outbound-attachment.js'
import { registerLocalErrorWireSummary } from '../../core/internal/error-wire-metadata.js'
import type { IRpcPortableValue, IRpcRuntimeEnvelope } from '@migaia/rpc-contract'
import { RpcCapability, RpcWireLimit } from '@migaia/rpc-contract'
import { createRuntimeApiEndpoint } from '../../core/runtime-api-endpoint.js'
import { rejectRuntimeApiCapability } from '../../core/runtime-api-endpoint.js'
import { RpcCoreErrorCode } from '../../core/errors.js'
import { completeProviderReturn } from '../../core/internal/provider.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { abort } from '../../core/middleware/abort.js'
import { codec } from '../../core/middleware/codec.js'
import { connect } from '../../core/middleware/connect.js'
import { framer } from '../../core/middleware/framer.js'
import { timeout } from '../../core/middleware/timeout.js'
import {
  createForwardOptions,
  createForwardQueryOptions
} from '../../core/internal/outbound-envelope.js'
import { retainProviderFailureRoute } from '../../core/internal/provider.js'
import { RpcCoreErrorText } from '../../core/error-text.js'
import { readRuntimePreparationContext } from './launch-context.js'
import { readRuntimeDefaultTimeout, prepareRuntimeCallTimeout } from './timeout.js'
import type { IRuntimeCallOptions, IRuntimeTypedPeer } from './typing.js'
import { defaultRpcId } from '../../core/internal/id.js'
import {
  createRuntimeEventPublisher,
  RuntimeProbeLifecycle,
  type IRuntimeEventPublisher
} from './events.js'
import {
  bindInstalledProbe,
  createProbeEmitter,
  readInstalledProbe,
  validateProbes
} from '../../core/internal/probe-emitter.js'
import { RpcProbeStage } from '../../core/probe/constants.js'
import { RuntimeEventName } from './constants.js'
import { deferred } from '@migaia/utils/promise'
import { isProviderAdmissionScopeOwner } from '../../core/internal/provider-admission.js'
import type { IProviderAdmissionScope } from '../../core/internal/provider-admission.js'
import { createAuthenticationNonce } from '../../core/middleware/authentication-envelope.js'
import { authentication } from '../../core/middleware/authentication.js'
import { snapshotAuthenticationConfig } from '../../core/middleware/authentication.js'
import { hooks } from '../../core/middleware/hooks.js'
import { ping } from '../../core/middleware/ping.js'
import {
  type IRpcEndpoint,
  type IRpcProvider,
  type IRpcProviderLimits,
  type IRpcFactoryConfig,
  type IRpcAuthenticationConfig
} from '../../core/typing.js'
import { RemoteMethodName } from '../constants.js'
import type { IRemoteContract } from '../contract.js'
import type {
  IRemoteChannel,
  IRemoteChannelResources,
  IRemoteProxyOptions,
  IRemoteServeEndpoint
} from '../types.js'
import {
  compileRuntimeMethods,
  readCommitGate,
  runtimeForwardRoute,
  runtimeForwardDiagnosticRoute,
  type IRuntimePeerProvide,
  type IRuntimeMethodEntry,
  type IRuntimeForwardMethodEntry
} from './catalog.js'
import {
  attachProviderPreflight,
  retainProviderPreflight,
  readProviderInvocation,
  readProviderIdentity,
  readProviderRuntimeRelay,
  type IProviderRuntimeRelay,
  type ProviderRegistry
} from '../../core/internal/provider.js'
import { type IRpcStreamRun } from '../../core/stream/index.js'
import { prepareRuntimeStreamConsumer } from '../../core/internal/stream/owner.js'
import {
  normalizeRuntimeDescription,
  describeRuntimeMethods,
  type IRuntimePeerIdentity,
  type IRuntimePeerDescription
} from './description.js'
import {
  RuntimeApiErrorText,
  RuntimeSourceKind,
  RuntimeConnectionDirection,
  RuntimeQueryStatus,
  RuntimeApiMode,
  RUNTIME_API_SCHEMA_VERSION,
  RUNTIME_API_CAPABILITIES,
  RUNTIME_API_BASE_CAPABILITIES
} from './constants.js'
import { RUNTIME_PEER_DEFAULT_NAME } from './constants.js'
import { defaultRpcReporter } from '../../core/default-reporter.js'

export type { IRuntimePeerProvide, IRuntimePeerMethod } from './catalog.js'
export type { IRuntimePeerIdentity } from './description.js'

/** The source learns only safe identity and the capabilities implemented by the shared endpoint. */
export type IRuntimePeerSourceContext = Readonly<{
  /** Safe local name and instance identity already admitted by Core. */
  self: IRuntimePeerIdentity
  /** Capabilities implemented by this actual compiled endpoint offer. */
  capabilities: readonly string[]
}>

/** Platform bootstrap owns cold receive buffering and transfers it only after endpoint registration. */
export type IRuntimePeerSourceResult = IRemoteChannel &
  Readonly<{
    /**
     * Release captured early receives only after endpoint registration; omission needs no
     * activation step.
     */
    activateReceive?: () => void
  }>

/** Platform/channel owners establish real agreement before the shared callable owner starts. */
export type IRuntimePeerSource = (
  context: IRuntimePeerSourceContext
) => Promise<IRuntimePeerSourceResult>

/** This internal assembly input is reused by the four platform factories. */
export type IRuntimePeerOptions = Pick<
  IRemoteProxyOptions<object, unknown>,
  'keyFactory' | 'retryPort'
> &
  Readonly<{
    /** A custom runtime assembly receives only the operations held by this channel view. */
    endpointFactory?(
      channel: IRemoteChannelResources,
      signal: INativeAbortSignal
    ): Promise<IRemoteServeEndpoint>
    /** Optional local identity; omission generates an instance id with the display name peer. */
    self?: IRuntimePeerIdentity
    /**
     * Explicit nested own-data method groups; defaults to no application methods and rejects
     * accessors during compilation.
     */
    provide?: IRuntimePeerProvide
    /** Owned source opener; exactly one of spawn, connect or listen is required. */
    spawn?: IRuntimePeerSource
    /** Connected source opener; exactly one source is required. */
    connect?: IRuntimePeerSource
    /** Listener source opener; exactly one source is required. */
    listen?: IRuntimePeerSource
    /** Provider quotas, defaulting to 256 global and 64 per verified peer. */
    providerLimits?: IRpcProviderLimits
    /** Existing per-frame credentials enable signed native transfer without a custom endpoint. */
    authentication?: IRpcAuthenticationConfig
    /** Installs an endpoint-local synchronous observer without changing pipeline selection. */
    probe?: IRpcProbe | readonly IRpcProbe[]
    /** Only request/stream inherit this positive default in their original timeout scope. */
    defaultTimeoutMs?: number
    /** Explicit advanced schema, modes and idempotency retain their original contract owner. */
    contract?: IRemoteContract
    /** Omission reports background failures to console.error through the original owner. */
    report?(error: unknown): void
  }>

/** Accepted routes are compiled once for both the direct Peer and canonical managed dispatch. */
type IRuntimePeerRoute = IRuntimePeerDescription['methods'][number] & Readonly<{ stream: string }>

/** Advanced factories may omit unnegotiated stream roots; the actual selected roots own dispatch. */
type IRuntimePeerEndpoint = Omit<ReturnType<typeof createRuntimeApiEndpoint>, 'stream'> &
  Pick<IRemoteServeEndpoint, 'stream'>

/** Hot calls return the original operation result; only local description queries are asynchronous. */
export type IRuntimePeer = Readonly<{
  /** Accepted safe local identity; it grants no native execution authority. */
  self: IRuntimePeerIdentity
  /**
   * Invoke one accepted scalar route and await its portable result; call admission or remote
   * failure rejects.
   */
  request(
    method: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): Promise<IRpcPortableValue | undefined>
  /** Send an accepted scalar notification; settlement confirms local send, not provider completion. */
  notify(method: string, payload?: unknown, options?: IRuntimeCallOptions): Promise<void>
  /** Open an accepted iterable route; the caller owns iteration and early return cleanup. */
  stream(
    method: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  /** Submit one admitted scalar group and retain its individual step outcomes. */
  group(
    steps: readonly IRpcRuntimeStep[],
    options?: Omit<
      Extract<
        import('@migaia/rpc-contract').IRpcRuntimeEnvelope,
        { kind: 'runtime-call' }
      >['options'],
      'timeoutMs'
    > &
      Pick<import('../../core/typing.js').ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
  ): Promise<readonly IRpcRuntimeStepOutcome[]>
  /** Query the existing logical key without invoking the provider again. */
  outcome(idempotencyKey: string): Promise<IRpcRuntimeOutcomeResult>
  /** Read a cold safe local detail projection; optional json/yaml/toml formatting returns text. */
  describe: IRuntimeQuery<IRuntimeDetail>
  /** Subscribe from now on; factory resolution already represents initial accepted readiness. */
  on: IRuntimeEventPublisher['on']
  /** Idempotently retire the original endpoint/channel ownership and share terminal cleanup. */
  close(): Promise<void>
  /** Scoped cleanup is the exact original close operation, including its Promise identity. */
  [Symbol.asyncDispose](): Promise<void>
}>

/** Cold connection data comes from the channel's accepted directory, never local describe data. */
type IRuntimePeerConnection = Readonly<{
  peerId: string
  /** Safe cold metadata is separate from the accepted private wire directory. */
  directory: IRuntimeConnectionDirectory
  description: IRuntimePeerDescription | undefined
  endpoint: IRuntimePeerEndpoint
  channel: IRemoteChannelResources
  report(error: unknown): void
  routes: ReadonlyMap<string, IRuntimePeerRoute>
}>

/** A private reader projects the original listener's actual session records, owning no membership. */
type IRuntimePeerSessions = Readonly<{ peers(): readonly IRuntimePeer[] }>

/** Only this callable assembly mints metadata for its own prepared facade; no lifecycle lives here. */
const runtimePeerConnections = new WeakMap<
  IRuntimePeer,
  IRuntimePeerConnection | (() => IRuntimePeer) | IRuntimePeerSessions
>()

/** Read the canonical accepted receipt for Plugin publication without another handshake or registry. */
export function readRuntimePeerConnection(peer: IRuntimePeer): IRuntimePeerConnection {
  /** An application-shaped Peer cannot inject identity or directory authority into a Host slot. */
  const connection = runtimePeerConnections.get(peer)
  if (!connection) invalid(RuntimeApiErrorText.peerInvalid)
  if (typeof connection !== 'function' && 'peers' in connection) {
    /** This cold read retains no membership beyond the original listener owner. */
    const peers = connection.peers()
    if (peers.length !== 1)
      throw createRpcError(
        peers.length === 0 ? RpcCoreErrorCode.targetUnknown : RpcCoreErrorCode.capabilityConflict,
        peers.length === 0 ? RuntimeApiErrorText.targetUnknown : RuntimeApiErrorText.targetAmbiguous
      )
    return readRuntimePeerConnection(peers[0]!)
  }
  return typeof connection === 'function' ? readRuntimePeerConnection(connection()) : connection
}

/** Retain a host session's accepted canonical connection on a projected member facade. */
export function retainRuntimeSessionConnection(facade: IRuntimePeer, prepared: IRuntimePeer): void {
  runtimePeerConnections.set(facade, readRuntimePeerConnection(prepared))
}

/** Read only genuine listener provenance; an application-shaped Peer cannot inject sessions. */
export function readRuntimePeerSessions(peer: IRuntimePeer): readonly IRuntimePeer[] | undefined {
  /** Only the privately minted provenance reader may project actual native sessions. */
  const source = runtimePeerConnections.get(peer)
  return source && typeof source !== 'function' && 'peers' in source ? source.peers() : undefined
}

/** Retain a reader for the original service handle, without copying its session Set. */
export function retainRuntimePeerSessions(
  peer: IRuntimePeer,
  read: () => readonly IRuntimePeer[]
): void {
  runtimePeerConnections.set(peer, Object.freeze({ peers: read }))
}

/** Configuration rejection keeps its canonical code and does not reflect source secrets. */
function invalid(message: string): never {
  throw createRpcError(RpcCoreErrorCode.invalidConfig, message)
}

/** Both raw and supervised factories validate safe identity through this same cold owner. */
export function prepareRuntimePeerSourceContext(
  configured: IRuntimePeerIdentity | undefined,
  canonicalAssembly = true,
  credentials?: IRpcAuthenticationConfig
): IRuntimePeerSourceContext {
  /** Default identity is minted once before source acquisition; explicit identities stay exact. */
  configured ??= { name: RUNTIME_PEER_DEFAULT_NAME, instanceId: defaultRpcId() }
  if (
    !configured ||
    typeof configured.name !== 'string' ||
    !configured.name ||
    configured.name.length > RpcWireLimit.maxIdentifierChars ||
    typeof configured.instanceId !== 'string' ||
    !configured.instanceId ||
    configured.instanceId.length > RpcWireLimit.maxIdentifierChars
  )
    invalid(RuntimeApiErrorText.identityInvalid)
  /** Local credentials propose transfer; only actual ACK and authentication mint its authority. */
  const profile = credentials === undefined ? undefined : snapshotAuthenticationConfig(credentials)
  /** The validated ordinary configuration proposes storage transfer without claiming agreement. */
  const signedNativeTransfer =
    canonicalAssembly &&
    typeof profile?.sign === 'function' &&
    typeof profile.verify === 'function' &&
    profile.encrypt === undefined &&
    (profile.encodedType === undefined || profile.encodedType === 'any')
  return Object.freeze({
    self: Object.freeze({ name: configured.name, instanceId: configured.instanceId }),
    capabilities: signedNativeTransfer
      ? Object.freeze([...RUNTIME_API_CAPABILITIES, RpcCapability.transfer])
      : canonicalAssembly
        ? RUNTIME_API_CAPABILITIES
        : RUNTIME_API_BASE_CAPABILITIES
  })
}

/** Acquired objects grant rights only over their own resources; descriptive fields grant none. */
type IRuntimePeerResources = Readonly<{
  channel?: Omit<IRuntimePeerSourceResult, 'close'> &
    Partial<Pick<IRuntimePeerSourceResult, 'close'>>
  bootstrap?: Readonly<{ close(): void | Promise<void> }>
  host?: import('@migaia/plugin-host').IPluginRuntimeIntegration
  providerAdmission?: IProviderAdmissionScope
  providerAdmissionRegistration?: Readonly<{
    stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
    isCommitted(): boolean
  }>
  signal?: IAbortSignal
  generation?: IRpcRuntimeGeneration
  endpoint?: IRemoteServeEndpoint
  wrapEndpoint?(endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
  /** A host lends its one prepared registry/endpoint to each accepted session facade. */
  assembly?: ReturnType<typeof prepareRuntimeProviderAssembly>
  /** Shared host node identity belongs to the one provider assembly. */
  nodeId?: string
  /** Session offers include safe identity so canonical name admission precedes directory response. */
  hostSession?: true
  /** Multiplexed calls check only the selected physical carrier before payload capture. */
  restrictTransfer?(options: object | undefined): void
  /** The directory snapshot is captured for this actual physical connection. */
  description?(): IRuntimePeerDescription
}>

/** Shared provider preparation keeps one canonical registry for standalone and multi-session hosts. */
export type IRuntimeProviderAssemblyOptions = Readonly<{
  methods: readonly IRuntimeMethodEntry[]
  streams: boolean
  supports(peerId: string | undefined, capability: string): boolean
  remoteNode(peerId: string | undefined): string | undefined
  bindRemoteNode(peerId: string | undefined, nodeId: string): void
  describe(peerId: string | undefined): IRuntimePeerDescription | undefined
  /** Host name admission uses the existing directory request and preserves its remote failure. */
  acceptCaller?(context: Parameters<IRpcProvider>[0]): void | Promise<void>
  /** Legacy channels without generations retain their original unguarded describe provider. */
  generations?: boolean
  /** Automatic namespaces do not redirect or disable the host's own local outcome store. */
  localOutcomes?: true
}>

/** Prepare canonical local/forward handlers before receive activation; append uses the same owner. */
/** Own one compiled provider/directory/relay assembly over the original endpoint registry. */
class RuntimeProviderAssembly {
  /** Canonical local and forwarding policies stay with the original assembly configuration. */
  #configuration: IRuntimeProviderAssemblyOptions
  /** One compiled index supplies scalar, stream and relay dispatch without a second route table. */
  #methodIndex: Map<string, IRuntimeMethodEntry>
  /** Directory order follows the compiler and later canonical incremental registrations. */
  #methods: IRuntimeMethodEntry[]
  /** The endpoint is borrowed only after its original construction completes. */
  #selected: IRuntimePeerEndpoint | undefined
  /** Generation binding remains owned by the selected endpoint's actual outbound attachment. */
  #runtimeOutbound: RpcOutboundAttachment | undefined
  /** Original compiled providers are registered by the existing Core provider/admission owner. */
  readonly providers: Record<string, IRpcProvider> = Object.create(null)

  /** Compile cold providers before receive activation without opening or owning another endpoint. */
  constructor(configuration: IRuntimeProviderAssemblyOptions) {
    this.#configuration = configuration
    this.#methodIndex = new Map(configuration.methods.map((entry) => [entry.name, entry]))
    this.#methods = [...configuration.methods]
    this.#prepareDescribe()
    this.#appendProviders(this.#methods)
  }

  /** The bilateral directory is the sole generation/node binding and caller acceptance path. */
  #prepareDescribe(): void {
    const describeProvider: IRpcProvider = (context) => {
      if (this.#configuration.supports(context.senderId, RpcCapability.generation)) {
        const supplied = normalizeRuntimeGeneration(
          typeof context.data === 'object' && context.data !== null
            ? Reflect.get(context.data, 'generation')
            : undefined
        )
        const token = readProviderIdentity(context)
        if (!token || !this.#runtimeOutbound) invalid(RuntimeApiErrorText.identityInvalid)
        this.#runtimeOutbound.bindRuntimeCaller(token, supplied)
      }
      if (this.#configuration.supports(context.senderId, RpcCapability.forwardRoute)) {
        /** Only the bilateral directory handshake may exchange a private runtime node. */
        const supplied =
          typeof context.data === 'object' && context.data !== null
            ? Reflect.get(context.data, 'nodeId')
            : undefined
        if (
          typeof supplied !== 'string' ||
          !/^[0-9a-f]{32}$/u.test(supplied) ||
          (this.#configuration.remoteNode(context.senderId) !== undefined &&
            this.#configuration.remoteNode(context.senderId) !== supplied)
        )
          invalid(RuntimeApiErrorText.identityInvalid)
        this.#configuration.bindRemoteNode(context.senderId, supplied)
      }
      const accepted = this.#configuration.acceptCaller?.(context)
      return accepted === undefined
        ? context.success(this.#configuration.describe(context.senderId))
        : Promise.resolve(accepted).then(() =>
            context.success(this.#configuration.describe(context.senderId))
          )
    }
    this.providers[RemoteMethodName.runtimeDescribe] =
      this.#configuration.generations === false
        ? describeProvider
        : attachProviderPreflight(describeProvider, () => undefined)
  }

  /**
   * Normalize only completed business results; context and handler failures keep their original
   * classification.
   */
  #completeScalar = (
    result: unknown,
    context: Parameters<IRpcProvider>[0]
  ): ReturnType<Parameters<IRpcProvider>[0]['success']> => {
    if (result === undefined) return context.success()
    /** Only failed normalization opts in to the payload code and bounded cause transfer. */
    let portable: IRpcPortableValue
    try {
      portable = normalizePortable(
        result,
        0,
        new Set<object>(),
        this.#configuration.supports(context.senderId, RpcCapability.portableBinary) ||
          rejectRuntimeApiCapability
      )
    } catch (cause) {
      const failure = createRpcSerializationError(RuntimeApiErrorText.resultInvalid, cause)
      registerLocalErrorWireSummary(
        failure,
        RpcCoreErrorCode.payloadInvalid,
        RuntimeApiErrorText.resultInvalid,
        { preserveSerializedError: true }
      )
      throw failure
    }
    return context.success(portable)
  }

  /**
   * Preserve the original local commit guard or exact forwarded route preflight on its canonical
   * provider.
   */
  #guardMethod = <T extends Function>(entry: IRuntimeMethodEntry, provider: T): T =>
    entry.kind === 'forward'
      ? attachProviderPreflight(provider, (route) => {
          try {
            runtimeForwardRoute(
              entry,
              route.forwardRoute,
              this.#configuration.remoteNode(route.senderId)
            )
          } catch (error) {
            /** Slot withdrawal still keeps its known path; an existing loop route remains exact. */
            throw retainProviderFailureRoute(
              error,
              runtimeForwardDiagnosticRoute(
                entry,
                route.forwardRoute,
                this.#configuration.remoteNode(route.senderId)
              )
            )
          }
        })
      : retainProviderPreflight(entry.method, provider)

  /** Compile original local/forward handlers once into the same provider record. */
  #appendProviders = (entries: readonly IRuntimeMethodEntry[]): void => {
    for (const entry of entries) {
      if (entry.supportedModes?.every((mode) => mode === RuntimeApiMode.stream)) continue
      if (entry.kind !== 'forward') {
        /** The original provider owner maps actual async results; the scalar facade is synchronous. */
        this.providers[entry.name] = this.#guardMethod(
          entry,
          (context: Parameters<IRpcProvider>[0]) => {
            /** A committed local method retains the original synchronous provider return path. */
            const invoke = () =>
              completeProviderReturn(
                Reflect.apply(entry.method, entry.receiver, [context.data, context]),
                context,
                this.#completeScalar
              )
            /** Only exposed local Feature methods carry their install's private commit metadata. */
            const gate = readCommitGate(entry.method)
            if (!gate || gate.isOpen()) return invoke()
            return gate.wait(context.signal).then(() => {
              if (context.signal.aborted) throw resolveAbortReason(context.signal)
              return invoke()
            })
          }
        )
        continue
      }
      this.providers[entry.name] = this.#guardMethod(
        entry,
        async (context: Parameters<IRpcProvider>[0]) => {
          if (entry.kind === 'forward') {
            const relay = readProviderRuntimeRelay(context)
            if (relay) return context.success(await relay.execute(context))
            /** The compiled slot resolves the current genuine Peer for every admitted invocation. */
            const route = runtimeForwardRoute(
              entry,
              context.route,
              this.#configuration.remoteNode(context.senderId)
            )
            const connection = entry.slot()
            const options = createForwardOptions(context, route)
            try {
              /** A response-waiting forward preserves the accepted notify-only business mode. */
              const result =
                readProviderInvocation(context)?.dispatchOnly ||
                entry.supportedModes.every((mode) => mode === RuntimeApiMode.notify)
                  ? await connection.peer.notify(entry.method, context.data, options)
                  : await connection.peer.request(entry.method, context.data, options)
              return context.success(result)
            } catch (error) {
              throw retainProviderFailureRoute(
                error,
                runtimeForwardDiagnosticRoute(
                  entry,
                  context.route,
                  this.#configuration.remoteNode(context.senderId)
                )
              )
            }
          }
          return context.success()
        }
      )
    }
  }

  /** Register original lazy stream consumers with the same commit and forwarding guards. */
  #appendStreams = (entries: readonly IRuntimeMethodEntry[]): void => {
    if (this.#configuration.streams) {
      for (const entry of entries)
        if (!entry.supportedModes || entry.supportedModes.includes(RuntimeApiMode.stream))
          this.#selected!.stream!.provide(
            `${RemoteMethodName.runtimeStreamPrefix}${entry.name}`,
            this.#guardMethod(
              entry,
              (payload: unknown, { context }: Parameters<IRpcStreamRun>[1]) => {
                if (entry.kind === 'forward')
                  return (
                    readProviderRuntimeRelay(context)?.stream(context) ??
                    this.#forwardStream(entry, context)
                  )
                /** Stream admission stays iterable while its first read waits for Host commit. */
                const gate = readCommitGate(entry.method)
                if (gate && !gate.isOpen())
                  return (async function* () {
                    await gate.wait(context.signal)
                    if (context.signal.aborted) throw resolveAbortReason(context.signal)
                    return yield* Reflect.apply(entry.method, entry.receiver, [
                      payload,
                      context
                    ]) as AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>
                  })()
                return Reflect.apply(entry.method, entry.receiver, [payload, context]) as
                  | AsyncIterable<IRpcPortableValue>
                  | Iterable<IRpcPortableValue>
              }
            )
          )
    }
  }

  /** Delegate the actual lazy downstream iterator and preserve exact forwarding diagnostic routes. */
  async *#forwardStream(
    entry: IRuntimeForwardMethodEntry,
    context: Parameters<IRpcProvider>[0]
  ): AsyncIterableIterator<IRpcPortableValue> {
    const route = runtimeForwardRoute(
      entry,
      context.route,
      this.#configuration.remoteNode(context.senderId)
    )
    try {
      /** Only new-profile relay metadata captures a target before its original key waiting. */
      const relay = readProviderRuntimeRelay(context)
      const result = yield* relay
        ? relay.stream(context)
        : entry.slot().peer.stream(entry.method, context.data, createForwardOptions(context, route))
      return relay ? result : undefined
    } catch (error) {
      throw retainProviderFailureRoute(
        error,
        runtimeForwardDiagnosticRoute(
          entry,
          context.route,
          this.#configuration.remoteNode(context.senderId)
        )
      )
    }
  }

  /** Select only one unambiguous forwarding namespace for a key-only lookup. */
  #queryTargetForMethods(): IRuntimeForwardMethodEntry | undefined {
    /** Reserved management entries do not create an application outcome namespace. */
    const entries = this.#methods.filter((entry) => !entry.reserved)
    return entries[0]?.kind === 'forward' &&
      entries.every(
        (entry) =>
          entry.kind === 'forward' &&
          entry.forwardedVia === (entries[0] as IRuntimeForwardMethodEntry).forwardedVia
      )
      ? entries[0]
      : undefined
  }

  /** The original provider registry borrows cold lookup/relay resolution from this compiled index. */
  #installRelays(): void {
    if (!this.#methods.some((entry) => entry.kind === 'forward')) return
    /** No parallel provider or principal registry is allocated by the relay configuration. */
    const registry = readEndpointOwner<ProviderRegistry>(
      this.#selected!,
      EndpointOwnerKey.providerRegistry
    )!
    registry.runtimeLookup =
      this.#configuration.localOutcomes && !this.#queryTargetForMethods()
        ? undefined
        : (envelope) => this.#lookupOutcome(envelope)
    registry.runtimeRelay = (envelope) => this.#relay(envelope)
  }

  /** Query the original final provider using its captured forwarding route and canonical key. */
  #lookupOutcome(envelope: Parameters<NonNullable<ProviderRegistry['runtimeLookup']>>[0]) {
    /** A query without a method cannot guess among independent target namespaces. */
    const first = this.#queryTargetForMethods()
    if (!first) rejectRuntimeApiCapability()
    /** Original route validation retains known final-provider diagnostics. */
    const route = runtimeForwardRoute(
      first,
      envelope.route.forwardRoute,
      this.#configuration.remoteNode(envelope.route.senderId)
    )
    return lookupRuntimePeerOutcome(
      first.slot().peer,
      envelope.idempotencyKey,
      createForwardQueryOptions(route)
    )
  }

  /** Capture one actual downstream task, rejecting mixed or unqueryable provider namespaces. */
  #relay(envelope: IRpcRuntimeEnvelope): IProviderRuntimeRelay | undefined {
    if (envelope.kind !== RpcRuntimeKind.call && envelope.kind !== RpcRuntimeKind.group)
      return undefined
    if (
      !this.#configuration.localOutcomes &&
      envelope.options.idempotencyKey !== undefined &&
      !this.#queryTargetForMethods()
    )
      rejectRuntimeApiCapability()
    /** Entries reference the original compiled methods rather than a copied routing authority. */
    const entries = (
      envelope.kind === RpcRuntimeKind.group ? envelope.steps : [{ method: envelope.task.method! }]
    ).map((step) => this.#methodIndex.get(step.method))
    /** A whole relay must retain one original forwarded provider namespace. */
    const first = entries[0]
    if (!entries.some((entry) => entry?.kind === 'forward')) return undefined
    if (
      this.#configuration.localOutcomes &&
      envelope.options.idempotencyKey !== undefined &&
      !this.#queryTargetForMethods()
    )
      rejectRuntimeApiCapability()
    if (
      !first ||
      first.kind !== 'forward' ||
      entries.some(
        (entry) => entry?.kind !== 'forward' || entry.forwardedVia !== first.forwardedVia
      )
    )
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.runtimeGroupTargetsInvalid
      )
    return new RuntimeForwardRelay(
      envelope,
      first,
      entries as IRuntimeForwardMethodEntry[],
      this.#configuration.remoteNode(envelope.route.senderId)
    )
  }

  /** Return the original ordered method array without inventing a second directory snapshot. */
  methods(): readonly IRuntimeMethodEntry[] {
    return this.#methods
  }
  /** Borrow a completed endpoint and install into its actual provider/stream registry. */
  install(endpoint: IRuntimePeerEndpoint, alreadyRegistered = false): void {
    this.#selected = endpoint
    this.#runtimeOutbound = readEndpointOwner<RpcOutboundAttachment>(
      endpoint,
      EndpointOwnerKey.outboundAttachment
    )
    if (!alreadyRegistered)
      for (const [name, provider] of Object.entries(this.providers))
        endpoint.provide(name, provider)
    this.#appendStreams(this.#methods)
    this.#installRelays()
  }
  /** Append actual methods while preserving duplicate diagnostics and insertion order. */
  append(entries: readonly IRuntimeMethodEntry[]): void {
    for (const entry of entries) {
      if (this.#methodIndex.has(entry.name)) {
        // The canonical registration owner supplies the existing duplicate-name diagnostic.
        this.#selected!.provide(entry.name, this.providers[entry.name]!)
      }
    }
    this.#appendProviders(entries)
    for (const entry of entries) {
      this.#methodIndex.set(entry.name, entry)
      this.#methods.push(entry)
      if (this.providers[entry.name])
        this.#selected!.provide(entry.name, this.providers[entry.name]!)
    }
    this.#appendStreams(entries)
    this.#installRelays()
  }
}

/** One downstream relay retains its accepted slot and original lazy stream consumer. */
class RuntimeForwardRelay implements IProviderRuntimeRelay {
  /** Only call/group operations enter this existing canonical relay path. */
  #envelope: Extract<
    IRpcRuntimeEnvelope,
    { kind: typeof RpcRuntimeKind.call | typeof RpcRuntimeKind.group }
  >
  /** The first actual entry identifies the shared final provider namespace. */
  #first: IRuntimeForwardMethodEntry
  /** Each group step retains its original compiled forwarding method. */
  #entries: readonly IRuntimeForwardMethodEntry[]
  /** Slot identity remains fixed while the operation waits; replacement cannot retarget it. */
  #connection: ReturnType<IRuntimeForwardMethodEntry['slot']>
  /** Original validated forwarding metadata is reused by execute, stream and terminal controls. */
  #route: ReturnType<typeof runtimeForwardRoute>
  /** All stream phases share one genuine downstream iterator created lazily on first use. */
  #iterator: AsyncIterableIterator<IRpcPortableValue> | undefined

  /** Capture the existing task and final slot without sending or creating another dispatch owner. */
  constructor(
    envelope: Extract<
      IRpcRuntimeEnvelope,
      { kind: typeof RpcRuntimeKind.call | typeof RpcRuntimeKind.group }
    >,
    first: IRuntimeForwardMethodEntry,
    entries: readonly IRuntimeForwardMethodEntry[],
    remoteNode: string | undefined
  ) {
    this.#envelope = envelope
    this.#first = first
    this.#entries = entries
    this.#connection = first.slot()
    this.#route = runtimeForwardRoute(first, envelope.route.forwardRoute, remoteNode)
  }

  /** A retired slot cannot redirect accepted work through its replacement. */
  #selected(): IRuntimePeer {
    if (this.#first.slot() !== this.#connection)
      throw createRpcError(
        RpcCoreErrorCode.providerGenerationRetired,
        RpcCoreErrorText.providerGenerationRetired
      )
    return this.#connection.peer
  }

  /** Preserve group step order and the original notify-only versus response-waiting mode. */
  async execute(context: Parameters<IRpcProvider>[0]): Promise<IRpcPortableValue | undefined> {
    /** Every original child operation reuses the admitted route and cancellation/deadline context. */
    const options = createForwardOptions(context, this.#route)
    if (this.#envelope.kind === RpcRuntimeKind.group)
      return this.#selected().group(
        this.#envelope.steps.map((step, index) => ({
          ...step,
          method: this.#entries[index]!.method
        })),
        options
      )
    return this.#envelope.task.mode === RuntimeApiMode.notify
      ? this.#selected()
          .notify(this.#first.method, context.data, options)
          .then(() => undefined)
      : this.#selected().request(this.#first.method, context.data, options)
  }

  /** Acquire only the original lazy stream, sharing it across prepare and finish. */
  stream(context: Parameters<IRpcProvider>[0]): AsyncIterableIterator<IRpcPortableValue> {
    return (this.#iterator ??= this.#selected().stream(
      this.#first.method,
      context.data,
      createForwardOptions(context, this.#route)
    ))
  }

  /** The executor lends this callback to its stream receipt, so retain the original relay owner. */
  prepareStream = (context: Parameters<IRpcProvider>[0]): Promise<void> => {
    return prepareRuntimeStreamConsumer(this.stream(context))
  }

  /** The borrowed terminal callback retains the same iterator and unchanged terminal reason. */
  finishStream = async (reason?: unknown): Promise<void> => {
    if (!this.#iterator) rejectRuntimeApiCapability()
    if (reason === undefined) await this.#iterator.return?.()
    else await this.#iterator.throw?.(reason)
  }
}

/** Prepare the actual provider owner before receive activation; append retains the same registry. */
export function prepareRuntimeProviderAssembly(configuration: IRuntimeProviderAssemblyOptions) {
  return new RuntimeProviderAssembly(configuration)
}

/**
 * Construct a symmetric callable endpoint using one canonical provider/outbound/stream closure.
 * Source and method validation precede connection effects; failure closes only resources obtained
 * by this construction, observing secondary cleanup failures while preserving the primary error.
 */
/** A declared remote surface preserves method and payload types on the original callable facade. */
/**
 * One actual Peer owns its admitted source, provider assembly, directory and exact close
 * settlement.
 */
class RuntimePeerResource {
  /** Original user options retain private native preparation provenance without a copied context. */
  #options: IRuntimePeerOptions
  /** Managed/Host construction lends its actual endpoint, provider assembly and generation facts. */
  #resources: IRuntimePeerResources | undefined
  /** Only this native policy can reject explicit ownership transfer before payload capture. */
  #restrictTransfer: IRuntimePeerResources['restrictTransfer']
  /** Native connection metadata is read from the original private preparation owner. */
  #connectionOrigin: NonNullable<
    ReturnType<typeof readRuntimePreparationContext>
  >['connectionOrigin']
  /** The validated default is captured before any source can be acquired. */
  #callTimeout: ReturnType<typeof prepareRuntimeCallTimeout>
  /** Method declarations are compiled exactly once before physical opening. */
  #methods: readonly IRuntimeMethodEntry[]
  /** The fixed three source fields retain exclusive configuration admission. */
  #sources: readonly IRuntimePeerSource[]
  /** The actual source receives the same safe identity and implemented capability proposal. */
  #sourceContext: IRuntimePeerSourceContext
  /** Safe identity is shared by the provider directory, facade and connection receipt. */
  #self: IRuntimePeerIdentity
  /** Native owners may lend a genuine generation; standalone peers start one session at zero. */
  #generation: IRpcRuntimeGeneration
  /** User reporting keeps its original bare receiver and native rethrow route. */
  #reporter: (error: unknown) => void
  /** This acquired channel is owned by exactly this construction's close/rollback path. */
  #channel!: NonNullable<IRuntimePeerResources['channel']>
  /** Rollback may dispose only the endpoint actually created before a later failure. */
  #endpoint: IRuntimePeerEndpoint | undefined
  /** Only the actual accepted agreement grants binary result normalization. */
  #supportsBinary = false
  /** Generation requires the original negotiated profile and prepared outbound attachment. */
  #supportsGeneration = false
  /** The bilateral directory exchanges a private node only when forwarding was accepted. */
  #supportsForward = false
  /** Native health/drain require the real channel's control capability. */
  #nativeControl = false
  /** Stream support remains an independent capability intersection. */
  #supportsStream = false
  /** The Host's actual node is retained; standalone forwarding gets one original nonce. */
  #nodeId: string | undefined
  /** Original providers enter the sole endpoint before cold receive activation. */
  #assembly!: ReturnType<typeof prepareRuntimeProviderAssembly>
  /** Default construction pre-registers providers; custom/borrowed endpoints install afterwards. */
  #initialProviders = false
  /** Local descriptions are fixed after endpoint construction and before the first directory send. */
  #localDescription: IRuntimePeerDescription | undefined
  /** The accepted bilateral exchange owns one remote node, never payload-derived routing authority. */
  #remoteNodeId: string | undefined
  /** The actual outbound attachment owns runtime generations and operation correlation. */
  #runtimeOutbound: RpcOutboundAttachment | undefined
  /** Remote directory validation precedes publication of any callable facade. */
  #remote!: IRuntimePeerDescription
  /** All methods and aliases use the same accepted snapshot. */
  #routes!: Map<string, IRuntimePeerRoute>
  /** Events borrow the installed endpoint probe and own only subscriber membership. */
  #events!: IRuntimeEventPublisher
  /** The native channel lends its original installed probe without another middleware. */
  #probe: ReturnType<typeof readInstalledProbe>
  /** Every explicit/scoped/concurrent close joins the exact original completion. */
  #closing: ReturnType<typeof deferred<void>> | undefined
  /** The original receipt is minted only after endpoint and directory preparation succeed. */
  #peer: IRuntimePeer | undefined

  /** Validate methods, timeout and exclusive sources before any physical acquisition. */
  constructor(options: IRuntimePeerOptions, resources?: IRuntimePeerResources) {
    this.#options = options
    this.#resources = resources
    if (options.probe !== undefined)
      validateProbes(Array.isArray(options.probe) ? options.probe : [options.probe as IRpcProbe])
    this.#restrictTransfer =
      resources?.restrictTransfer ?? readRuntimePreparationContext(options)?.restrictTransfer
    this.#connectionOrigin = readRuntimePreparationContext(options)?.connectionOrigin
    this.#callTimeout = prepareRuntimeCallTimeout(readRuntimeDefaultTimeout(options))
    this.#methods = compileRuntimeMethods(options.provide, options.contract)
    this.#sources = [options.spawn, options.connect, options.listen].filter(
      (source) => source !== undefined
    )
    if (resources?.channel && this.#sources.length > 0) invalid(RuntimeApiErrorText.sourceInvalid)
    if (
      !resources?.channel &&
      (this.#sources.length !== 1 || typeof this.#sources[0] !== 'function')
    )
      invalid(RuntimeApiErrorText.sourceInvalid)
    this.#sourceContext = prepareRuntimePeerSourceContext(
      options.self,
      !options.endpointFactory,
      options.authentication
    )
    this.#self = this.#sourceContext.self
    this.#generation = normalizeRuntimeGeneration(
      resources?.generation ?? {
        kind: RpcRuntimeGenerationKind.session,
        value: 0,
        providerId: this.#self.instanceId
      }
    )
    this.#reporter = options.report ?? defaultRpcReporter
  }

  /** Reporter failures remain visible on the existing host route without replacing primaries. */
  #report = (error: unknown): void => {
    try {
      ;(0, this.#reporter)(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }

  /**
   * Open the original source, then retain the original await boundaries for composition and
   * directory.
   */
  async open(): Promise<IRuntimePeer> {
    this.#channel = this.#resources?.channel ?? (await this.#sources[0]!(this.#sourceContext))
    try {
      this.#prepareAgreement()
      /** Original resources bypass construction without adding another asynchronous phase. */
      const constructed = this.#resources?.endpoint ?? (await this.#constructEndpoint())
      this.#bindEndpoint(constructed)
      this.#channel.activateReceive?.()
      this.#remote = normalizeRuntimeDescription(await this.#sendDirectory())
      this.#acceptDirectory()
      return this.#project()
    } catch (failure) {
      try {
        if (!this.#resources?.assembly) await this.#endpoint?.dispose()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      try {
        await this.#channel.close?.()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw failure
    }
  }

  /** Derive actual accepted rights and create only the original cold provider assembly. */
  #prepareAgreement(): void {
    /** Both baseline capabilities are required before endpoint construction or receive activation. */
    const baselineAccepted =
      this.#channel.agreement.capabilities.includes(RpcCapability.runtimeApi) &&
      this.#channel.agreement.capabilities.includes(RpcCapability.batch)
    this.#supportsBinary = this.#channel.agreement.capabilities.includes(
      RpcCapability.portableBinary
    )
    this.#supportsGeneration = this.#channel.agreement.capabilities.includes(
      RpcCapability.generation
    )
    this.#supportsForward = this.#channel.agreement.capabilities.includes(
      RpcCapability.forwardRoute
    )
    this.#nodeId = this.#supportsForward
      ? (this.#resources?.nodeId ??
        this.#resources?.host?.nodeId ??
        readRuntimePreparationContext(this.#options)?.host?.nodeId ??
        createAuthenticationNonce())
      : undefined
    this.#nativeControl = this.#channel.agreement.capabilities.includes(RpcCapability.ping)
    this.#supportsStream = this.#channel.agreement.capabilities.includes(RpcCapability.stream)
    this.#assembly =
      this.#resources?.assembly ??
      prepareRuntimeProviderAssembly({
        methods: this.#methods,
        streams: this.#supportsStream,
        generations: this.#supportsGeneration,
        supports: (_peerId, capability) =>
          this.#channel.agreement.capabilities.includes(capability),
        remoteNode: () => this.#remoteNodeId,
        bindRemoteNode: (_peerId, value) => {
          this.#remoteNodeId = value
        },
        describe: () => this.#localDescription
      })
    if (!baselineAccepted) rejectRuntimeApiCapability()
    this.#initialProviders =
      !this.#options.endpointFactory && !this.#resources?.endpoint && !this.#resources?.wrapEndpoint
  }

  /** Construct through the existing actual endpoint owner without an extra async wrapper. */
  #constructEndpoint(): Promise<IRemoteServeEndpoint> {
    return prepareRuntimePeerEndpoint(
      { ...this.#options, self: this.#self, report: this.#report },
      this.#channel,
      this.#resources?.signal ?? createAbortController().signal,
      this.#initialProviders ? { provider: this.#assembly.providers } : {},
      this.#supportsGeneration
        ? (this.#resources?.providerAdmission ??
            readRuntimePreparationContext(this.#options)?.providerAdmission)
        : undefined,
      this.#resources?.providerAdmissionRegistration ??
        readRuntimePreparationContext(this.#options)?.providerAdmissionRegistration
    )
  }

  /**
   * Retain the actual constructed endpoint for rollback before native policy or projection can
   * fail.
   */
  #bindEndpoint(constructed: IRemoteServeEndpoint): void {
    this.#endpoint = constructed.endpoint as unknown as IRuntimePeerEndpoint
    const served = this.#resources?.wrapEndpoint?.(constructed) ?? constructed
    if (
      !served.oneWay ||
      (this.#supportsStream && !served.stream) ||
      (this.#nativeControl && typeof served.endpoint.ping !== 'function')
    )
      rejectRuntimeApiCapability()
    const selected: IRuntimePeerEndpoint = Object.create(served.endpoint)
    Object.defineProperties(selected, {
      sendOneWay: { value: served.oneWay.sendOneWay },
      stream: { value: served.stream }
    })
    this.#endpoint = Object.freeze(selected)
    if (this.#supportsGeneration) {
      this.#runtimeOutbound = readEndpointOwner<RpcOutboundAttachment>(
        this.#endpoint!,
        EndpointOwnerKey.outboundAttachment
      )
      if (!this.#runtimeOutbound) rejectRuntimeApiCapability()
      if (!this.#resources?.assembly) this.#runtimeOutbound.configureRuntime(this.#generation)
    }
    if (!this.#resources?.assembly)
      this.#assembly.install(this.#endpoint!, Boolean(this.#initialProviders))
    this.#localDescription =
      this.#resources?.description?.() ??
      normalizeRuntimeDescription({
        schemaVersion: RUNTIME_API_SCHEMA_VERSION,
        self: this.#supportsGeneration
          ? { ...this.#self, generation: this.#generation }
          : this.#self,
        ...(this.#nodeId === undefined ? {} : { nodeId: this.#nodeId }),
        methods: describeRuntimeMethods(this.#methods, this.#supportsStream)
      })
  }

  /** Only negotiated application rights permit the original reserved directory request. */
  #sendDirectory() {
    return this.#endpoint!.send(
      this.#channel.peerId,
      RemoteMethodName.runtimeDescribe,
      this.#supportsGeneration || this.#nodeId !== undefined
        ? {
            ...(this.#nodeId === undefined ? {} : { nodeId: this.#nodeId }),
            ...(this.#supportsGeneration ? { generation: this.#generation } : {}),
            ...(this.#resources?.hostSession ? { self: this.#self } : {})
          }
        : null,
      {
        signal: this.#resources?.signal
      }
    )
  }

  /** Validate original identity/generation/node facts and compile the accepted method snapshot once. */
  #acceptDirectory(): void {
    if (this.#remote.self.instanceId !== this.#channel.peerId)
      invalid(RuntimeApiErrorText.identityInvalid)
    if (this.#supportsGeneration) {
      if (!this.#remote.self.generation) invalid(RuntimeApiErrorText.identityInvalid)
      this.#runtimeOutbound!.bindRuntimeTarget(this.#channel.peerId, this.#remote.self.generation)
    } else if (this.#remote.self.generation !== undefined)
      invalid(RuntimeApiErrorText.identityInvalid)
    if (this.#supportsForward) {
      if (
        !this.#remote.nodeId ||
        (this.#remoteNodeId !== undefined && this.#remoteNodeId !== this.#remote.nodeId)
      )
        invalid(RuntimeApiErrorText.identityInvalid)
      this.#remoteNodeId = this.#remote.nodeId
    } else if (this.#remote.nodeId !== undefined) invalid(RuntimeApiErrorText.identityInvalid)
    this.#routes = new Map(
      this.#remote.methods.map(
        (method) =>
          [
            method.name,
            { ...method, stream: `${RemoteMethodName.runtimeStreamPrefix}${method.name}` }
          ] as const
      )
    )
  }

  /**
   * String calls retain the accepted generation's original mode whitelist and Host incremental
   * rule.
   */
  #route = (method: string, mode: RuntimeApiMode): void => {
    /** Admission uses the accepted generation's compiled whitelist and actual installed modes. */
    const selected = this.#routes.get(method)
    // Host string calls reach incremental providers on the selected live session; capability trees keep their accepted snapshot.
    if (!selected && this.#resources?.hostSession) return
    if (!selected)
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    if (!selected.supportedModes.includes(mode)) rejectRuntimeApiCapability()
  }

  /** Cold safe detail reads only the original endpoint counters and actual physical closure proof. */
  #describe = () => {
    /** The original adapter alone can prove physical closure; absent proof remains unavailable. */
    const state =
      this.#channel.transport.closed === undefined
        ? undefined
        : this.#channel.transport.closed
          ? RuntimeQueryStatus.closed
          : RuntimeQueryStatus.ready
    /** One canonical endpoint owns both the self and connection client count denominator. */
    const counters = runtimeCounters(this.#endpoint!)
    return runtimeDetail(
      this.#localDescription!,
      [
        runtimeConnectionDetail(readRuntimePeerConnection(this.#peer!).directory, state, {
          counters,
          report: this.#report
        })
      ],
      [],
      undefined,
      counters
    )
  }

  /** Publish the first completion before synchronous observers or cleanup can reenter close. */
  #close = (): Promise<void> => {
    if (this.#closing) return this.#closing.promise
    this.#closing = deferred<void>()
    if (this.#probe && (this.#probe.mask & (1 << RpcProbeStage.peer)) !== 0)
      this.#probe.peer(RuntimeProbeLifecycle.closing, this.#channel.peerId, undefined)
    this.#events.close()
    try {
      void (this.#resources?.assembly ? Promise.resolve() : this.#endpoint!.dispose()).then(
        () => this.#finishChannel(undefined, false),
        (failure) => this.#finishChannel(failure, true)
      )
    } catch (failure) {
      this.#finishChannel(failure, true)
    }
    return this.#closing.promise
  }

  /** Native channel cleanup preserves the original primary and its asynchronous settlement boundary. */
  #finishChannel(primary: unknown, failed: boolean): void {
    /** Native close may return synchronously or throw before yielding its original Promise. */
    let result: void | Promise<void>
    try {
      result = this.#channel.close?.()
    } catch (cleanup) {
      if (failed) this.#report(cleanup)
      this.#closing!.reject(failed ? primary : cleanup)
      return
    }
    void Promise.resolve(result).then(
      () => {
        if (failed) this.#closing!.reject(primary)
        else this.#closing!.resolve()
      },
      (cleanup) => {
        if (failed) this.#report(cleanup)
        this.#closing!.reject(failed ? primary : cleanup)
      }
    )
  }

  /**
   * Mint the same frozen facade and private actual connection receipt only after bilateral
   * readiness.
   */
  #project(): IRuntimePeer {
    this.#probe = readInstalledProbe(this.#channel.transport)
    this.#events = createRuntimeEventPublisher(this.#probe)
    if (this.#probe && (this.#probe.mask & (1 << RpcProbeStage.peer)) !== 0) {
      this.#probe.peer(RuntimeProbeLifecycle.handshake, this.#channel.peerId, undefined)
      this.#probe.peer(RuntimeProbeLifecycle.directory, this.#channel.peerId, undefined)
      if (this.#resources?.generation === undefined)
        this.#probe.peer(RuntimeEventName.ready, this.#channel.peerId, undefined)
    }
    this.#peer = Object.freeze({
      self: this.#self,
      on: this.#events.on,
      ...createRuntimePeerCalls({
        restrictTransfer: this.#restrictTransfer,
        callTimeout: this.#callTimeout,
        route: this.#route,
        ready: this.#endpoint!,
        runtimeOutbound: this.#runtimeOutbound,
        peerId: this.#channel.peerId,
        generation: this.#remote.self.generation,
        supportsBinary: this.#supportsBinary,
        supportsStream: this.#supportsStream,
        routes: this.#routes
      }),
      describe: runtimeQuery(this.#describe),
      close: this.#close,
      [Symbol.asyncDispose]: this.#close
    })
    runtimePeerConnections.set(
      this.#peer!,
      Object.freeze({
        peerId: this.#channel.peerId,
        directory: Object.freeze({
          localDescription: this.#localDescription!,
          description: this.#remote,
          carrier: this.#channel.transport.platform,
          ...((0, this.#connectionOrigin)?.() ?? {
            kind: this.#options.spawn
              ? RuntimeSourceKind.spawn
              : this.#options.listen
                ? RuntimeSourceKind.listen
                : RuntimeSourceKind.connect,
            direction: this.#resources?.bootstrap
              ? RuntimeConnectionDirection.spawnedBy
              : this.#options.spawn
                ? RuntimeConnectionDirection.spawned
                : this.#options.listen
                  ? RuntimeConnectionDirection.listen
                  : RuntimeConnectionDirection.connect
          })
        }),
        description: this.#remote,
        endpoint: this.#endpoint!,
        channel: this.#channel,
        report: this.#report,
        routes: this.#routes
      })
    )
    return this.#peer!
  }
}

export function createRuntimePeer<TRemote = never>(
  options: IRuntimePeerOptions,
  resources?: IRuntimePeerResources
): Promise<[TRemote] extends [never] ? IRuntimePeer : IRuntimeTypedPeer<TRemote>>
/** The dynamic signature remains last so existing factory consumers and mocks retain its type. */
export function createRuntimePeer(
  options: IRuntimePeerOptions,
  resources?: IRuntimePeerResources
): Promise<IRuntimePeer>
/** Internal assembly retains its original dynamic operations and exact returned Promise. */
export async function createRuntimePeer(
  options: IRuntimePeerOptions,
  resources?: IRuntimePeerResources
): Promise<IRuntimePeer> {
  return new RuntimePeerResource(options, resources).open()
}

/**
 * Internal query forwarding uses the genuine Peer receipt and its original outbound/correlation
 * owner.
 */
export function lookupRuntimePeerOutcome(
  peer: IRuntimePeer,
  idempotencyKey: string,
  options: object
): Promise<IRpcRuntimeOutcomeResult> {
  const connection = readRuntimePeerConnection(peer)
  const outbound = readEndpointOwner<RpcOutboundAttachment>(
    connection.endpoint,
    EndpointOwnerKey.outboundAttachment
  )
  if (!outbound || !connection.description?.self.generation) rejectRuntimeApiCapability()
  return outbound.sendRuntimeOperation(
    connection.channel.peerId,
    connection.description.self.generation,
    'outcome',
    { idempotencyKey },
    options
  ) as Promise<IRpcRuntimeOutcomeResult>
}

/**
 * Construct the original endpoint once before runtime routes are installed. Listener sessions
 * supply their existing limits/store policy; explicit factories retain their original signature.
 */
export async function prepareRuntimePeerEndpoint(
  options: IRuntimePeerOptions,
  channel: IRemoteChannelResources,
  signal: IAbortSignal,
  policy: Pick<IRpcFactoryConfig, 'providerLimits' | 'idempotency' | 'provider'> = {},
  admission?: IProviderAdmissionScope,
  registration?: Readonly<{
    stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
    isCommitted(): boolean
  }>
): Promise<IRemoteServeEndpoint> {
  /** Peer options bind directly to the owned transport, leaving canonical middleware proofs intact. */
  /** Managed preparation may already own this exact endpoint before its facade is constructed. */
  const existingProbe = readInstalledProbe(channel.transport)
  const probe =
    options.probe === undefined
      ? undefined
      : (existingProbe ??
        createProbeEmitter(
          Array.isArray(options.probe) ? options.probe : [options.probe as IRpcProbe],
          () => channel.scheduler.now(),
          prepareRuntimePeerSourceContext(options.self).self.instanceId
        ))
  /** Failure before kernel acquisition releases all genuine stage subscriptions. */
  let releaseProbe: (() => void) | undefined
  if (probe && existingProbe === undefined) {
    probe.peerOwned = true
    probe.authentication = options.authentication?.encrypt
      ? 'encrypt-sign'
      : options.authentication
        ? 'sign'
        : 'none'
    releaseProbe = bindInstalledProbe(channel.transport, probe)
  }
  try {
    /** Default diagnostics do not require copying the options that carry Host provenance. */
    const report = options.report ?? defaultRpcReporter
    if (options.endpointFactory) {
      /** Custom roots retain their original signature and must supply the actual borrowed owner. */
      const endpoint = await options.endpointFactory(channel, signal as INativeAbortSignal)
      if (
        admission &&
        !isProviderAdmissionScopeOwner(
          admission,
          readEndpointOwner(endpoint.endpoint, EndpointOwnerKey.providerAdmission)
        )
      ) {
        try {
          await endpoint.endpoint.dispose()
        } catch (cleanup) {
          try {
            report(cleanup)
          } catch (failure) {
            hostRethrowReporter(failure, IpcReporterContext)
          }
        }
        rejectRuntimeApiCapability()
      }
      return endpoint
    }
    /** Only the real channel agreement can install native control and streaming roots. */
    const nativeControl = channel.agreement.capabilities.includes(RpcCapability.ping)
    /**
     * Each selected endpoint keeps the actual scheduler, framing, security Features and provider
     * limits.
     */
    const endpoint = createRuntimeApiEndpoint(
      {
        id: prepareRuntimePeerSourceContext(options.self).self.instanceId,
        scheduler: channel.scheduler,
        transport: channel.transport,
        targetIds: [channel.peerId],
        providerLimits: options.providerLimits,
        ...policy,
        middlewares: [
          codec(channel.pipeline.codec),
          framer(channel.pipeline.framer),
          ...(options.authentication ? [authentication(options.authentication)] : []),
          abort(),
          timeout(),
          hooks({ onHookError: report }),
          ...(nativeControl ? [ping()] : []),
          connect({ transport: channel.transport })
        ],
        features: channel.features
      },
      { ...channel, ...(registration ? { hostRegistration: registration } : {}) },
      admission
    )
    await endpoint.ready
    return {
      endpoint: endpoint as unknown as IRpcEndpoint,
      oneWay: endpoint,
      stream: endpoint.stream
    }
  } catch (error) {
    releaseProbe?.()
    throw error
  }
}

/**
 * The real composed endpoint is handed to native health/drain only after its controls are
 * installed.
 */
export function readRuntimePeerEndpoint(peer: IRuntimePeer) {
  /** No synthetic control implementation is created; the binding validates this real composition. */
  const endpoint = readRuntimePeerConnection(peer).endpoint
  return {
    endpoint: endpoint as unknown as IRpcEndpoint,
    oneWay: endpoint,
    stream: endpoint.stream
  }
}

/** A managed facade retains accepted metadata from its exact genuine first-generation Peer. */
export function retainRuntimePeerConnection(
  facade: IRuntimePeer,
  prepared: IRuntimePeer | (() => IRuntimePeer)
): void {
  runtimePeerConnections.set(
    facade,
    typeof prepared === 'function' ? prepared : readRuntimePeerConnection(prepared)
  )
}
