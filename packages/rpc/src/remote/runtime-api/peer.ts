import { createRuntimePeerCalls } from '../../core/internal/runtime-call.js'
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
import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'
import { normalizePortable } from '../../contract/normalize.js'
import { normalizeRuntimeGeneration } from '../../contract/runtime-api/metadata.js'
import type {
  IRpcRuntimeGeneration,
  IRpcRuntimeStep,
  IRpcRuntimeStepOutcome,
  IRpcRuntimeOutcomeResult
} from '../../contract/runtime-api/types.js'
import { RpcRuntimeGenerationKind, RpcRuntimeKind } from '../../contract/runtime-api/constants.js'
import { readEndpointOwner } from '../../core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../core/endpoint-kernel.js'
import type {
  RpcOutboundAttachment,
  IRpcRuntimeSendOptions
} from '../../core/internal/outbound-attachment.js'
import { registerLocalErrorWireSummary } from '../../contract/contract-error.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import { RpcCapability, RpcWireLimit } from '../../contract/wire-constants.js'
import {
  createRuntimeApiEndpoint,
  rejectRuntimeApiCapability,
  type IRuntimeEndpointChannel,
  type IRuntimeApiEndpoint
} from '../../core/internal/runtime-api-endpoint.js'
import { RpcError, RpcCoreErrorCode, RpcSerializationError } from '../../core/errors.js'
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
import type { IRuntimeCallOptions } from './typing.js'
import {
  isProviderAdmissionScopeOwner,
  type IProviderAdmissionScope
} from '../../core/internal/provider-admission.js'
import { createAuthenticationNonce } from '../../core/middleware/authentication-envelope.js'
import { hooks } from '../../core/middleware/hooks.js'
import { ping } from '../../core/middleware/ping.js'
import type {
  IRpcEndpoint,
  IRpcProvider,
  IRpcProviderLimits,
  IRpcFactoryConfig,
  IRpcAbortSignal
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
  type ProviderRegistry
} from '../../core/internal/provider.js'
import type { IRpcStreamRun } from '../../core/features/stream.js'
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

export type { IRuntimePeerProvide, IRuntimePeerMethod } from './catalog.js'
export type { IRuntimePeerIdentity } from './description.js'

/** The source learns only safe identity and the capabilities implemented by the shared endpoint. */
export type IRuntimePeerSourceContext = Readonly<{
  self: IRuntimePeerIdentity
  capabilities: readonly string[]
}>

/** Platform bootstrap owns cold receive buffering and transfers it only after endpoint registration. */
export type IRuntimePeerSourceResult = IRemoteChannel &
  Readonly<{
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
      signal: IAbortSignal
    ): Promise<IRemoteServeEndpoint>
    self?: IRuntimePeerIdentity
    provide?: IRuntimePeerProvide
    spawn?: IRuntimePeerSource
    connect?: IRuntimePeerSource
    listen?: IRuntimePeerSource
    providerLimits?: IRpcProviderLimits
    /** Only request/stream inherit this positive default in their original timeout scope. */
    defaultTimeoutMs?: number
    /** Explicit advanced schema, modes and idempotency retain their original contract owner. */
    contract?: IRemoteContract
    report(error: unknown): void
  }>

/** Accepted routes are compiled once for both the direct Peer and canonical managed dispatch. */
type IRuntimePeerRoute = IRuntimePeerDescription['methods'][number] & Readonly<{ stream: string }>

/** Advanced factories may omit unnegotiated stream roots; the actual selected roots own dispatch. */
type IRuntimePeerEndpoint = Omit<IRuntimeApiEndpoint, 'stream'> &
  Pick<IRemoteServeEndpoint, 'stream'>

/** Hot calls return the original operation result; only local description queries are asynchronous. */
export type IRuntimePeer = Readonly<{
  self: IRuntimePeerIdentity
  request(
    method: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): Promise<IRpcPortableValue | undefined>
  notify(method: string, payload?: unknown, options?: IRuntimeCallOptions): Promise<void>
  stream(
    method: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  group(
    steps: readonly IRpcRuntimeStep[],
    options?: IRpcRuntimeSendOptions
  ): Promise<readonly IRpcRuntimeStepOutcome[]>
  outcome(idempotencyKey: string): Promise<IRpcRuntimeOutcomeResult>
  describe: IRuntimeQuery<IRuntimeDetail>
  close(): Promise<void>
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
      throw new RpcError(
        peers.length === 0 ? RpcCoreErrorCode.targetUnknown : RpcCoreErrorCode.capabilityConflict,
        peers.length === 0 ? RuntimeApiErrorText.targetUnknown : RuntimeApiErrorText.targetAmbiguous
      )
    return readRuntimePeerConnection(peers[0]!)
  }
  return typeof connection === 'function' ? readRuntimePeerConnection(connection()) : connection
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
  throw new RpcError(RpcCoreErrorCode.invalidConfig, message)
}

/** Both raw and supervised factories validate safe identity through this same cold owner. */
export function prepareRuntimePeerSourceContext(
  configured: IRuntimePeerIdentity | undefined,
  canonicalAssembly = true
): IRuntimePeerSourceContext {
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
  return Object.freeze({
    self: Object.freeze({ name: configured.name, instanceId: configured.instanceId }),
    capabilities: canonicalAssembly ? RUNTIME_API_CAPABILITIES : RUNTIME_API_BASE_CAPABILITIES
  })
}

/** Acquired objects grant rights only over their own resources; descriptive fields grant none. */
type IRuntimePeerResources = Readonly<{
  channel?: Omit<IRuntimePeerSourceResult, 'close'> &
    Partial<Pick<IRuntimePeerSourceResult, 'close'>>
  bootstrap?: Readonly<{ close(): void | Promise<void> }>
  host?: import('@migaia/plugin-host').IPluginRuntimeIntegration
  providerAdmission?: IProviderAdmissionScope
  providerAdmissionRegistration?: IRuntimeEndpointChannel['hostRegistration']
  signal?: IRpcAbortSignal
  generation?: IRpcRuntimeGeneration
  endpoint?: IRemoteServeEndpoint
  wrapEndpoint?(endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
}>

/**
 * Construct a symmetric callable endpoint using one canonical provider/outbound/stream closure.
 * Source and method validation precede connection effects; failure closes only resources obtained
 * by this construction, observing secondary cleanup failures while preserving the primary error.
 */
export async function createRuntimePeer(
  options: IRuntimePeerOptions,
  resources?: IRuntimePeerResources
): Promise<IRuntimePeer> {
  /** Invoke only the native rejection policy retained by this exact preparation context. */
  const restrictTransfer = readRuntimePreparationContext(options)?.restrictTransfer
  /** Native source metadata stays with the same private preparation owner. */
  const connectionOrigin = readRuntimePreparationContext(options)?.connectionOrigin
  /** Invalid timeout configuration cannot consume bootstrap or acquire a physical channel. */
  const callTimeout = prepareRuntimeCallTimeout(readRuntimeDefaultTimeout(options))
  /** The compiler retains its original whitelist index; relay dispatch creates no second table. */
  let methodIndex!: ReadonlyMap<string, IRuntimeMethodEntry>
  /** Method descriptors are compiled once; no dispatch searches the application object. */
  const methods = compileRuntimeMethods(options.provide, options.contract, (index) => {
    methodIndex = index
  })
  /** A platform automatic source and an explicit source can never compete for one Peer. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (source) => source !== undefined
  )
  if (resources?.channel && sources.length > 0) invalid(RuntimeApiErrorText.sourceInvalid)
  if (!resources?.channel && (sources.length !== 1 || typeof sources[0] !== 'function'))
    invalid(RuntimeApiErrorText.sourceInvalid)
  /** Only safe identity fields are retained from user configuration or trusted bootstrap. */
  const configured = options.self
  const sourceContext = prepareRuntimePeerSourceContext(configured, !options.endpointFactory)
  /** Arbitrary extra fields, token, environment and source data never enter this projection. */
  const self = sourceContext.self
  /** A standalone accepted connection starts its own session at zero; native owners override it. */
  const generation = normalizeRuntimeGeneration(
    resources?.generation ?? {
      kind: RpcRuntimeGenerationKind.session,
      value: 0,
      providerId: self.instanceId
    }
  )
  /** Offer only implemented shared capabilities; the platform owner supplies the real intersection. */
  /** One acquired channel transfers to this construction's rollback/close owner. */
  const channel = resources?.channel ?? (await sources[0]!(sourceContext))
  /**
   * Both negotiated baseline capabilities are required before endpoint construction or receive
   * activation.
   */
  const baselineAccepted =
    channel.agreement.capabilities.includes(RpcCapability.runtimeApi) &&
    channel.agreement.capabilities.includes(RpcCapability.batch)
  /**
   * A negotiated binary profile selects the same original runtime task owner for bidirectional
   * results.
   */
  const supportsBinary = channel.agreement.capabilities.includes(RpcCapability.portableBinary)
  /** Generation requires the actual bilateral base and one original prepared endpoint. */
  const supportsGeneration = channel.agreement.capabilities.includes(RpcCapability.generation)
  /** Directory handshake carries a node only after the two source offers actually agree. */
  const supportsForward = channel.agreement.capabilities.includes(RpcCapability.forwardRoute)
  /** Native rebindings preserve the Host node; a standalone callable endpoint owns its own node. */
  const nodeId = supportsForward
    ? (resources?.host?.nodeId ??
      readRuntimePreparationContext(options)?.host?.nodeId ??
      createAuthenticationNonce())
    : undefined
  /** Health and drain remain real native control operations from the original core owner. */
  const nativeControl = channel.agreement.capabilities.includes(RpcCapability.ping)
  /** The existing stream capability remains an independent AND requirement. */
  const supportsStream = channel.agreement.capabilities.includes(RpcCapability.stream)
  /** Reports remain observable even when a user reporter itself throws. */
  const report = (error: unknown): void => {
    try {
      options.report(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /** Core owns provider dispatch and all admission/replay/cancellation leases. */
  const providers: Record<string, IRpcProvider> = Object.create(null)
  /** One cold completion adapter keeps D47 normalization outside handler and context failures. */
  const completeScalar = (
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
        supportsBinary || rejectRuntimeApiCapability
      )
    } catch (cause) {
      const failure = new RpcSerializationError(RuntimeApiErrorText.resultInvalid, cause)
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
  /** Registration completes before the platform hands cold business receive to the endpoint. */
  let localDescription: IRuntimePeerDescription | undefined
  /** The existing directory handshake binds a remote node before either side sends business. */
  let remoteNodeId: string | undefined
  /** This cold read reaches only the genuine kernel/attachment retained by canonical projection. */
  let runtimeOutbound: RpcOutboundAttachment | undefined
  /** Preserve local Host permission or forwarding policy on the actual canonical provider. */
  const guardMethod = <T extends Function>(entry: IRuntimeMethodEntry, provider: T): T =>
    entry.kind === 'forward'
      ? attachProviderPreflight(provider, (route) => {
          try {
            runtimeForwardRoute(entry, route.forwardRoute, remoteNodeId)
          } catch (error) {
            /** Slot withdrawal still keeps its known path; an existing loop route remains exact. */
            throw retainProviderFailureRoute(
              error,
              runtimeForwardDiagnosticRoute(entry, route.forwardRoute, remoteNodeId)
            )
          }
        })
      : retainProviderPreflight(entry.method, provider)
  /** Delegate the original lazy iterator and retain known route facts on terminal business errors. */
  const forwardStream = async function* (
    entry: IRuntimeForwardMethodEntry,
    context: Parameters<IRpcProvider>[0]
  ): AsyncIterableIterator<IRpcPortableValue> {
    const route = runtimeForwardRoute(entry, context.route, remoteNodeId)
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
        runtimeForwardDiagnosticRoute(entry, context.route, remoteNodeId)
      )
    }
  }
  {
    const describeProvider: IRpcProvider = (context) => {
      if (supportsGeneration) {
        const supplied = normalizeRuntimeGeneration(
          typeof context.data === 'object' && context.data !== null
            ? Reflect.get(context.data, 'generation')
            : undefined
        )
        const token = readProviderIdentity(context)
        if (!token || !runtimeOutbound) invalid(RuntimeApiErrorText.identityInvalid)
        runtimeOutbound.bindRuntimeCaller(token, supplied)
      }
      if (supportsForward) {
        /** Only the bilateral directory handshake may exchange a private runtime node. */
        const supplied =
          typeof context.data === 'object' && context.data !== null
            ? Reflect.get(context.data, 'nodeId')
            : undefined
        if (
          typeof supplied !== 'string' ||
          !/^[0-9a-f]{32}$/u.test(supplied) ||
          (remoteNodeId !== undefined && remoteNodeId !== supplied)
        )
          invalid(RuntimeApiErrorText.identityInvalid)
        remoteNodeId = supplied
      }
      return context.success(localDescription)
    }
    providers[RemoteMethodName.runtimeDescribe] = supportsGeneration
      ? attachProviderPreflight(describeProvider, () => undefined)
      : describeProvider
    for (const entry of methods) {
      if (entry.supportedModes?.every((mode) => mode === RuntimeApiMode.stream)) continue
      if (entry.kind !== 'forward') {
        /** The original provider owner maps actual async results; the scalar facade is synchronous. */
        providers[entry.name] = guardMethod(entry, (context: Parameters<IRpcProvider>[0]) =>
          completeProviderReturn(
            Reflect.apply(entry.method, entry.receiver, [context.data, context]),
            context,
            completeScalar
          )
        )
        continue
      }
      providers[entry.name] = guardMethod(entry, async (context: Parameters<IRpcProvider>[0]) => {
        if (entry.kind === 'forward') {
          const relay = readProviderRuntimeRelay(context)
          if (relay) return context.success(await relay.execute(context))
          /** The compiled slot resolves the current genuine Peer for every admitted invocation. */
          const route = runtimeForwardRoute(entry, context.route, remoteNodeId)
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
              runtimeForwardDiagnosticRoute(entry, context.route, remoteNodeId)
            )
          }
        }
        return context.success()
      })
    }
  }
  /** A successfully created endpoint is the only owner disposed during later preparation failure. */
  let endpoint: IRuntimePeerEndpoint | undefined
  try {
    if (!baselineAccepted) rejectRuntimeApiCapability()
    /** Default roots retain initial registration before core receive activation. */
    const initialProviders =
      !options.endpointFactory && !resources?.endpoint && !resources?.wrapEndpoint
    /** An original session/binding contributes its real endpoint rather than a second composition. */
    const constructed =
      resources?.endpoint ??
      (await prepareRuntimePeerEndpoint(
        { ...options, self, report },
        channel,
        resources?.signal ?? createAbortController().signal,
        initialProviders ? { provider: providers } : {},
        supportsGeneration
          ? (resources?.providerAdmission ??
              readRuntimePreparationContext(options)?.providerAdmission)
          : undefined,
        resources?.providerAdmissionRegistration ??
          readRuntimePreparationContext(options)?.providerAdmissionRegistration
      ))
    endpoint = constructed.endpoint as unknown as IRuntimePeerEndpoint
    /**
     * Incoming providers must pass through the selected native policy from their first
     * registration.
     */
    const served = resources?.wrapEndpoint?.(constructed) ?? constructed
    if (
      !served.oneWay ||
      (supportsStream && !served.stream) ||
      (nativeControl && typeof served.endpoint.ping !== 'function')
    )
      rejectRuntimeApiCapability()
    /** A cold view joins existing roots without replacing frozen methods or adding hot wrappers. */
    const selected: IRuntimePeerEndpoint = Object.create(served.endpoint)
    Object.defineProperties(selected, {
      sendOneWay: { value: served.oneWay.sendOneWay },
      stream: { value: served.stream }
    })
    endpoint = Object.freeze(selected)
    if (supportsGeneration) {
      runtimeOutbound = readEndpointOwner<RpcOutboundAttachment>(
        endpoint,
        EndpointOwnerKey.outboundAttachment
      )
      if (!runtimeOutbound) rejectRuntimeApiCapability()
      runtimeOutbound.configureRuntime(generation)
      if (methods.some((entry) => entry.kind === 'forward')) {
        /**
         * The canonical provider registry stores only a cold resolver into its existing compiled
         * entries.
         */
        const registry = readEndpointOwner<ProviderRegistry>(
          endpoint,
          EndpointOwnerKey.providerRegistry
        )!
        /**
         * Without a method on lookup, only one unambiguous forward-only logical namespace is
         * selectable.
         */
        const queryEntries = methods.filter((entry) => !entry.reserved)
        /** One key-only query cannot select between B-local and multiple final provider namespaces. */
        const queryTarget =
          queryEntries[0]?.kind === 'forward' &&
          queryEntries.every(
            (entry) =>
              entry.kind === 'forward' &&
              entry.forwardedVia === (queryEntries[0] as IRuntimeForwardMethodEntry).forwardedVia
          )
            ? queryEntries[0]
            : undefined
        registry.runtimeLookup = (envelope) => {
          const first = queryTarget
          if (!first) rejectRuntimeApiCapability()
          const route = runtimeForwardRoute(first, envelope.route.forwardRoute, remoteNodeId)
          return lookupRuntimePeerOutcome(
            first.slot().peer,
            envelope.idempotencyKey,
            createForwardQueryOptions(route)
          )
        }
        registry.runtimeRelay = (envelope) => {
          if (envelope.kind !== RpcRuntimeKind.call && envelope.kind !== RpcRuntimeKind.group)
            return undefined
          /** Do not accept keyed work whose original namespace cannot subsequently be queried. */
          if (envelope.options.idempotencyKey !== undefined && !queryTarget)
            rejectRuntimeApiCapability()
          /**
           * These references capture actual method entries; there is no second routing or principal
           * table.
           */
          const entries = (
            envelope.kind === RpcRuntimeKind.group
              ? envelope.steps
              : [{ method: envelope.task.method! }]
          ).map((step) => methodIndex.get(step.method))
          const first = entries[0]
          if (!entries.some((entry) => entry?.kind === 'forward')) return undefined
          if (
            !first ||
            first.kind !== 'forward' ||
            entries.some(
              (entry) => entry?.kind !== 'forward' || entry.forwardedVia !== first.forwardedVia
            )
          )
            throw new RpcError(
              RpcCoreErrorCode.invalidConfig,
              RpcCoreErrorText.runtimeGroupTargetsInvalid
            )
          /**
           * Slot identity remains captured while this original operation waits; replacement cannot
           * retarget it.
           */
          const connection = first.slot()
          const route = runtimeForwardRoute(first, envelope.route.forwardRoute, remoteNodeId)
          const selected = () => {
            if (first.slot() !== connection)
              throw new RpcError(
                RpcCoreErrorCode.providerGenerationRetired,
                RpcCoreErrorText.providerGenerationRetired
              )
            return connection.peer
          }
          /**
           * One original downstream consumer belongs to this captured task, including prepare and
           * finish.
           */
          let iterator: AsyncIterableIterator<IRpcPortableValue> | undefined
          const stream = (context: Parameters<IRpcProvider>[0]) =>
            (iterator ??= selected().stream(
              first.method,
              context.data,
              createForwardOptions(context, route)
            ))
          return {
            execute: async (context) => {
              const options = createForwardOptions(context, route)
              if (envelope.kind === RpcRuntimeKind.group)
                return selected().group(
                  envelope.steps.map((step, index) => ({
                    ...step,
                    method: (entries[index] as IRuntimeForwardMethodEntry).method
                  })),
                  options
                )
              return envelope.task.mode === RuntimeApiMode.notify
                ? selected()
                    .notify(first.method, context.data, options)
                    .then(() => undefined)
                : selected().request(first.method, context.data, options)
            },
            stream,
            prepareStream: (context) => prepareRuntimeStreamConsumer(stream(context)),
            finishStream: async (reason) => {
              if (!iterator) rejectRuntimeApiCapability()
              if (reason === undefined) await iterator.return?.()
              else await iterator.throw?.(reason)
            }
          }
        }
      }
    }
    if (!initialProviders)
      for (const [name, provider] of Object.entries(providers)) endpoint.provide(name, provider)
    if (supportsStream) {
      for (const entry of methods)
        if (!entry.supportedModes || entry.supportedModes.includes(RuntimeApiMode.stream))
          endpoint.stream!.provide(
            `${RemoteMethodName.runtimeStreamPrefix}${entry.name}`,
            guardMethod(
              entry,
              (payload: unknown, { context }: Parameters<IRpcStreamRun>[1]) =>
                (entry.kind === 'forward'
                  ? (readProviderRuntimeRelay(context)?.stream(context) ??
                    forwardStream(entry, context))
                  : Reflect.apply(entry.method, entry.receiver, [payload, context])) as
                  | AsyncIterable<IRpcPortableValue>
                  | Iterable<IRpcPortableValue>
            )
          )
    }
    localDescription = normalizeRuntimeDescription({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self: supportsGeneration ? { ...self, generation } : self,
      ...(nodeId === undefined ? {} : { nodeId }),
      methods: describeRuntimeMethods(methods, supportsStream)
    })
    channel.activateReceive?.()
    /** Only mutually negotiated application capability permits sending the new reserved method. */
    const remote = normalizeRuntimeDescription(
      await endpoint.send(
        channel.peerId,
        RemoteMethodName.runtimeDescribe,
        supportsGeneration || nodeId !== undefined
          ? {
              ...(nodeId === undefined ? {} : { nodeId }),
              ...(supportsGeneration ? { generation } : {})
            }
          : null,
        {
          signal: resources?.signal
        }
      )
    )
    if (remote.self.instanceId !== channel.peerId) invalid(RuntimeApiErrorText.identityInvalid)
    if (supportsGeneration) {
      if (!remote.self.generation) invalid(RuntimeApiErrorText.identityInvalid)
      runtimeOutbound!.bindRuntimeTarget(channel.peerId, remote.self.generation)
    } else if (remote.self.generation !== undefined) invalid(RuntimeApiErrorText.identityInvalid)
    if (supportsForward) {
      if (!remote.nodeId || (remoteNodeId !== undefined && remoteNodeId !== remote.nodeId))
        invalid(RuntimeApiErrorText.identityInvalid)
      remoteNodeId = remote.nodeId
    } else if (remote.nodeId !== undefined) invalid(RuntimeApiErrorText.identityInvalid)
    /** Both scalar admission and aliases are compiled from the accepted remote directory once. */
    const routes = new Map(
      remote.methods.map(
        (method) =>
          [
            method.name,
            { ...method, stream: `${RemoteMethodName.runtimeStreamPrefix}${method.name}` }
          ] as const
      )
    )
    /** Every accepted baseline channel uses its actual v2 method and mode whitelist. */
    const route = (method: string, mode: RuntimeApiMode): void => {
      /** Admission uses the accepted generation's compiled whitelist and actual installed modes. */
      const selected = routes.get(method)
      if (!selected)
        throw new RpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
      if (!selected.supportedModes.includes(mode)) rejectRuntimeApiCapability()
    }
    /** Capture original operation surfaces; hot calls allocate no facade Promise or bound function. */
    const ready = endpoint
    /** Close retains one Promise identity, including failure and concurrent provider reentry. */
    let closing: Promise<void> | undefined
    /** This exact facade is minted only after both directory and endpoint preparation succeed. */
    const peer: IRuntimePeer = Object.freeze({
      self,
      ...createRuntimePeerCalls({
        restrictTransfer,
        callTimeout,
        route,
        ready,
        runtimeOutbound,
        peerId: channel.peerId,
        generation: remote.self.generation,
        supportsBinary,
        supportsStream,
        routes
      }),
      describe: runtimeQuery(() => {
        /** The original adapter alone can prove physical closure; absent proof remains unavailable. */
        const state =
          channel.transport.closed === undefined
            ? undefined
            : channel.transport.closed
              ? RuntimeQueryStatus.closed
              : RuntimeQueryStatus.ready
        /** One canonical endpoint owns both the self and connection client count denominator. */
        const counters = runtimeCounters(ready)
        return runtimeDetail(
          localDescription!,
          [
            runtimeConnectionDetail(readRuntimePeerConnection(peer).directory, state, {
              counters,
              report
            })
          ],
          [],
          undefined,
          counters
        )
      }),
      close: () =>
        (closing ??= (async () => {
          try {
            await ready.dispose()
          } catch (failure) {
            try {
              await channel.close?.()
            } catch (cleanup) {
              report(cleanup)
            }
            throw failure
          }
          await channel.close?.()
        })())
    })
    runtimePeerConnections.set(
      peer,
      Object.freeze({
        peerId: channel.peerId,
        directory: Object.freeze({
          localDescription,
          description: remote,
          carrier: channel.transport.platform,
          ...(connectionOrigin?.() ?? {
            kind: options.spawn
              ? RuntimeSourceKind.spawn
              : options.listen
                ? RuntimeSourceKind.listen
                : RuntimeSourceKind.connect,
            direction: resources?.bootstrap
              ? RuntimeConnectionDirection.spawnedBy
              : options.spawn
                ? RuntimeConnectionDirection.spawned
                : options.listen
                  ? RuntimeConnectionDirection.listen
                  : RuntimeConnectionDirection.connect
          })
        }),
        description: remote,
        endpoint: ready,
        channel,
        report,
        routes
      })
    )
    return peer
  } catch (failure) {
    try {
      await endpoint?.dispose()
    } catch (cleanup) {
      report(cleanup)
    }
    try {
      await channel.close?.()
    } catch (cleanup) {
      report(cleanup)
    }
    throw failure
  }
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
  registration?: IRuntimeEndpointChannel['hostRegistration']
): Promise<IRemoteServeEndpoint> {
  if (options.endpointFactory) {
    /** Custom roots retain their original signature and must supply the actual borrowed owner. */
    const endpoint = await options.endpointFactory(channel, signal)
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
          options.report(cleanup)
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
        abort(),
        timeout(),
        hooks({ onHookError: options.report }),
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
