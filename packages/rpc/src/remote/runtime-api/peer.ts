import { hostRethrowReporter } from '@migaia/utils/promise'
import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'
import { normalizePortable } from '../../contract/normalize.js'
import { registerLocalErrorWireSummary } from '../../contract/contract-error.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import { RpcCapability, RpcWireLimit } from '../../contract/wire-constants.js'
import {
  createRuntimeApiEndpoint,
  rejectRuntimeApiCapability,
  type IRuntimeApiEndpoint
} from '../../core/internal/runtime-api-endpoint.js'
import {
  RpcError,
  RpcCoreErrorCode,
  RpcSerializationError,
  RpcRemoteError
} from '../../core/errors.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { abort } from '../../core/middleware/abort.js'
import { codec } from '../../core/middleware/codec.js'
import { connect } from '../../core/middleware/connect.js'
import { framer } from '../../core/middleware/framer.js'
import { timeout } from '../../core/middleware/timeout.js'
import { createForwardOptions, isForwardedPayload } from '../../core/internal/outbound-envelope.js'
import { retainProviderFailureRoute } from '../../core/internal/provider.js'
import { readRuntimePreparationContext } from './launch-context.js'
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
  IRemoteCallOptions,
  IRemoteChannel,
  IRemoteProxyOptions,
  IRemoteServeEndpoint
} from '../types.js'
import {
  compileRuntimeMethods,
  runtimeForwardRoute,
  type IRuntimePeerProvide,
  type IRuntimeMethodEntry
} from './catalog.js'
import { attachProviderPreflight, readProviderInvocation } from '../../core/internal/provider.js'
import type { IRpcStreamRun } from '../../core/features/stream.js'
import {
  normalizeRuntimeDescription,
  type IRuntimePeerIdentity,
  type IRuntimePeerDescription
} from './description.js'
import {
  RuntimeApiErrorText,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RUNTIME_API_SCHEMA_VERSION,
  RUNTIME_API_CAPABILITIES
} from './constants.js'

export type { IRuntimePeerProvide, IRuntimePeerMethod } from './catalog.js'
export type { IRuntimePeerIdentity } from './description.js'

/** The source learns only safe identity and the capabilities implemented by the shared endpoint. */
export type IRuntimePeerSourceContext = Readonly<{
  self: IRuntimePeerIdentity
  capabilities: readonly string[]
}>

/** Platform bootstrap owns cold receive buffering and transfers it only after endpoint registration. */
export type IRuntimePeerSourceResult = IRemoteChannel & Readonly<{ activateReceive?: () => void }>

/** Platform/channel owners establish real agreement before the shared callable owner starts. */
export type IRuntimePeerSource = (
  context: IRuntimePeerSourceContext
) => Promise<IRuntimePeerSourceResult>

/** This internal assembly input is reused by the four platform factories. */
export type IRuntimePeerOptions = Pick<
  IRemoteProxyOptions<object, unknown>,
  'keyFactory' | 'retryPort'
> &
  Partial<Pick<IRemoteProxyOptions<object, unknown>, 'endpointFactory'>> &
  Readonly<{
    self?: IRuntimePeerIdentity
    provide?: IRuntimePeerProvide
    spawn?: IRuntimePeerSource
    connect?: IRuntimePeerSource
    listen?: IRuntimePeerSource
    providerLimits?: IRpcProviderLimits
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
    options?: IRemoteCallOptions
  ): Promise<IRpcPortableValue | undefined>
  notify(method: string, payload?: unknown, options?: IRemoteCallOptions): Promise<void>
  stream(
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  describe(): Promise<IRuntimePeerDescription>
  close(): Promise<void>
}>

/** Cold connection data comes from the channel's accepted directory, never local describe data. */
type IRuntimePeerConnection = Readonly<{
  peerId: string
  description: IRuntimePeerDescription | undefined
  endpoint: IRuntimePeerEndpoint
  channel: IRemoteChannel
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

/** Normalize one provided payload; an omitted optional argument remains omitted on the wire. */
function payloadValue(payload: unknown): IRpcPortableValue | undefined {
  return payload === undefined ? undefined : normalizePortable(payload)
}

/** A forwarded business failure keeps the serialized provider identity and its original stack. */
function restoreForwardError(error: unknown): never {
  if (error instanceof RpcRemoteError && error.cause instanceof Error) throw error.cause
  throw error
}

/** Both raw and supervised factories validate safe identity through this same cold owner. */
export function prepareRuntimePeerSourceContext(
  configured: IRuntimePeerIdentity | undefined
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
    capabilities: RUNTIME_API_CAPABILITIES
  })
}

/**
 * Construct a symmetric callable endpoint using one canonical provider/outbound/stream closure.
 * Source and method validation precede connection effects; failure closes only resources obtained
 * by this construction, observing secondary cleanup failures while preserving the primary error.
 */
export async function createRuntimePeer(
  options: IRuntimePeerOptions,
  automatic?: Readonly<{
    self: IRuntimePeerIdentity
    source: IRuntimePeerSource
    /** An original managed generation owns channel cleanup while the Peer owns its endpoint. */
    ownsChannel?: boolean
    signal?: IRpcAbortSignal
    /** Private Host provenance survives the original native generation preparation owner. */
    nodeId?: string
    /** Native policy wraps the original endpoint before its providers are registered. */
    wrapEndpoint?(endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
    /** Listener sessions reuse the endpoint already built by their original admission/drain owner. */
    endpoint?: IRemoteServeEndpoint
  }>
): Promise<IRuntimePeer> {
  /** Method descriptors are compiled once; no dispatch searches the application object. */
  const methods = compileRuntimeMethods(options.provide, options.contract)
  /** A platform automatic source and an explicit source can never compete for one Peer. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (source) => source !== undefined
  )
  if (automatic && sources.length > 0) invalid(RuntimeApiErrorText.sourceInvalid)
  if (automatic) sources.push(automatic.source)
  if (sources.length !== 1 || typeof sources[0] !== 'function')
    invalid(RuntimeApiErrorText.sourceInvalid)
  /** Only safe identity fields are retained from user configuration or trusted bootstrap. */
  const configured = automatic?.self ?? options.self
  const sourceContext = prepareRuntimePeerSourceContext(configured)
  if (
    automatic &&
    options.self &&
    (options.self.name !== automatic.self.name ||
      options.self.instanceId !== automatic.self.instanceId)
  )
    invalid(RuntimeApiErrorText.identityInvalid)
  /** Arbitrary extra fields, token, environment and source data never enter this projection. */
  const self = sourceContext.self
  /** Offer only implemented shared capabilities; the platform owner supplies the real intersection. */
  /** One acquired channel transfers to this construction's rollback/close owner. */
  const channel = await sources[0]!(sourceContext)
  /** A local offer alone cannot enable application description or reverse registration. */
  const supportsRuntime = channel.agreement.capabilities.includes(RpcCapability.runtimeApi)
  /** Directory handshake carries a node only after the two source offers actually agree. */
  const supportsForward = channel.agreement.capabilities.includes(RpcCapability.forwardRoute)
  /** Native rebindings preserve the Host node; a standalone callable endpoint owns its own node. */
  const nodeId = supportsForward
    ? (automatic?.nodeId ??
      readRuntimePreparationContext(options)?.nodeId ??
      createAuthenticationNonce())
    : undefined
  /** Health and drain remain real native control operations from the original core owner. */
  const nativeControl = channel.agreement.capabilities.includes(RpcCapability.ping)
  /** The existing stream capability remains an independent AND requirement. */
  const supportsStream =
    supportsRuntime && channel.agreement.capabilities.includes(RpcCapability.stream)
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
  /** Registration completes before the platform hands cold business receive to the endpoint. */
  let localDescription: IRuntimePeerDescription | undefined
  /** The existing directory handshake binds a remote node before either side sends business. */
  let remoteNodeId: string | undefined
  /** Attach policy only to forward entries in the same ordinary provider namespace. */
  const guardForward = <T extends Function>(entry: IRuntimeMethodEntry, provider: T): T =>
    entry.kind === 'forward'
      ? attachProviderPreflight(provider, (route) => {
          try {
            runtimeForwardRoute(entry, route.forwardRoute, remoteNodeId)
          } catch (error) {
            /** Slot withdrawal still keeps its known path; an existing loop route remains exact. */
            const incoming = route.forwardRoute ?? (remoteNodeId ? [remoteNodeId] : undefined)
            throw retainProviderFailureRoute(
              error,
              incoming ? Object.freeze([...incoming, entry.nodeId]) : undefined
            )
          }
        })
      : provider
  if (supportsRuntime) {
    providers[RemoteMethodName.runtimeDescribe] = (context) => {
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
    for (const entry of methods) {
      if (entry.supportedModes?.every((mode) => mode === RuntimeApiMode.stream)) continue
      providers[entry.name] = guardForward(entry, async (context: Parameters<IRpcProvider>[0]) => {
        if (entry.kind === 'forward') {
          /** The compiled slot resolves the current genuine Peer for every admitted invocation. */
          const route = runtimeForwardRoute(entry, context.route, remoteNodeId)
          const connection = entry.slot()
          const options = createForwardOptions(context, route)
          try {
            const result = readProviderInvocation(context)?.dispatchOnly
              ? await connection.peer.notify(entry.method, context.data, options)
              : await connection.peer.request(entry.method, context.data, options)
            return context.success(result)
          } catch (error) {
            throw retainProviderFailureRoute(error, route)
          }
        }
        /** Handler failure stays outside the scalar result validation error boundary. */
        const result = await Reflect.apply(entry.method, entry.receiver, [context.data, context])
        if (result === undefined) return context.success()
        /** Only failed normalization opts in to the payload code and bounded cause transfer. */
        let portable: IRpcPortableValue
        try {
          portable = normalizePortable(result)
        } catch (cause) {
          /** Business RpcSerializationError instances never receive this local trusted summary. */
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
      })
    }
  }
  /** A successfully created endpoint is the only owner disposed during later preparation failure. */
  let endpoint: IRuntimePeerEndpoint | undefined
  try {
    /** Default roots retain initial registration before core receive activation. */
    const initialProviders =
      !options.endpointFactory && !automatic?.endpoint && !automatic?.wrapEndpoint
    /** An original session/binding contributes its real endpoint rather than a second composition. */
    const constructed =
      automatic?.endpoint ??
      (await prepareRuntimePeerEndpoint(
        { ...options, self, report },
        channel,
        automatic?.signal ?? createAbortController().signal,
        initialProviders ? { provider: providers } : {}
      ))
    endpoint = constructed.endpoint as unknown as IRuntimePeerEndpoint
    /**
     * Incoming providers must pass through the selected native policy from their first
     * registration.
     */
    const served = automatic?.wrapEndpoint?.(constructed) ?? constructed
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
    if (!initialProviders)
      for (const [name, provider] of Object.entries(providers)) endpoint.provide(name, provider)
    if (supportsStream) {
      for (const entry of methods)
        if (!entry.supportedModes || entry.supportedModes.includes(RuntimeApiMode.stream))
          endpoint.stream!.provide(
            `${RemoteMethodName.runtimeStreamPrefix}${entry.name}`,
            guardForward(
              entry,
              (payload: unknown, { context }: Parameters<IRpcStreamRun>[1]) =>
                (entry.kind === 'forward'
                  ? entry
                      .slot()
                      .peer.stream(
                        entry.method,
                        payload,
                        createForwardOptions(
                          context,
                          runtimeForwardRoute(entry, context.route, remoteNodeId)
                        )
                      )
                  : Reflect.apply(entry.method, entry.receiver, [payload, context])) as
                  | AsyncIterable<IRpcPortableValue>
                  | Iterable<IRpcPortableValue>
            )
          )
    }
    localDescription = normalizeRuntimeDescription({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self,
      ...(nodeId === undefined ? {} : { nodeId }),
      methods: supportsRuntime
        ? methods.map((entry) => ({
            name: entry.name,
            supportedModes: entry.supportedModes ?? [
              RuntimeApiMode.request,
              RuntimeApiMode.notify,
              ...(supportsStream ? [RuntimeApiMode.stream] : [])
            ],
            modeSource: entry.supportedModes
              ? RuntimeApiModeSource.declared
              : RuntimeApiModeSource.generatedRoutes,
            ...(entry.declaration ? { idempotent: entry.declaration.idempotent } : {}),
            ...(entry.kind === 'forward' ? { forwardedVia: entry.forwardedVia } : {})
          }))
        : []
    })
    channel.activateReceive?.()
    /** Only mutually negotiated application capability permits sending the new reserved method. */
    const remote = supportsRuntime
      ? normalizeRuntimeDescription(
          await endpoint.send(
            channel.peerId,
            RemoteMethodName.runtimeDescribe,
            nodeId === undefined ? null : { nodeId },
            {
              signal: automatic?.signal
            }
          )
        )
      : undefined
    if (remote && remote.self.instanceId !== channel.peerId)
      invalid(RuntimeApiErrorText.identityInvalid)
    if (supportsForward) {
      if (!remote?.nodeId || (remoteNodeId !== undefined && remoteNodeId !== remote.nodeId))
        invalid(RuntimeApiErrorText.identityInvalid)
      remoteNodeId = remote.nodeId
    } else if (remote?.nodeId !== undefined) invalid(RuntimeApiErrorText.identityInvalid)
    /** Both scalar admission and aliases are compiled from the accepted remote directory once. */
    const routes = new Map(
      remote?.methods.map(
        (method) =>
          [
            method.name,
            { ...method, stream: `${RemoteMethodName.runtimeStreamPrefix}${method.name}` }
          ] as const
      )
    )
    /** Preserve receiver-side legacy whitelist rejection when the peer lacks the new directory. */
    const route = (method: string, mode: RuntimeApiMode): void => {
      if (!remote) return
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
      request: (method: string, payload?: unknown, callOptions?: IRemoteCallOptions) => {
        route(method, RuntimeApiMode.request)
        const result = ready.send<IRpcPortableValue | undefined>(
          channel.peerId,
          method,
          isForwardedPayload(callOptions, payload)
            ? (payload as IRpcPortableValue | undefined)
            : payloadValue(payload),
          callOptions
        )
        return routes.get(method)?.forwardedVia || isForwardedPayload(callOptions, payload)
          ? result.catch(restoreForwardError)
          : result
      },
      notify: (method: string, payload?: unknown, callOptions?: IRemoteCallOptions) => {
        route(method, RuntimeApiMode.notify)
        /**
         * The private forward operation awaits C's existing provider response, unlike ordinary
         * notify.
         */
        if (isForwardedPayload(callOptions, payload))
          return ready
            .send(channel.peerId, method, payload, callOptions)
            .then(() => undefined, restoreForwardError)
        return ready.sendOneWay(channel.peerId, method, payloadValue(payload), callOptions)
      },
      stream: (method: string, payload?: unknown, callOptions?: IRemoteCallOptions) => {
        if (!supportsStream) rejectRuntimeApiCapability()
        route(method, RuntimeApiMode.stream)
        return ready.stream!.open(
          channel.peerId,
          routes.get(method)!.stream,
          isForwardedPayload(callOptions, payload)
            ? (payload as IRpcPortableValue | undefined)
            : payloadValue(payload),
          callOptions
        )
      },
      describe: () => Promise.resolve(localDescription!),
      close: () =>
        (closing ??= (async () => {
          try {
            await ready.dispose()
          } catch (failure) {
            try {
              if (automatic?.ownsChannel !== false) await channel.close()
            } catch (cleanup) {
              report(cleanup)
            }
            throw failure
          }
          if (automatic?.ownsChannel !== false) await channel.close()
        })())
    })
    runtimePeerConnections.set(
      peer,
      Object.freeze({
        peerId: channel.peerId,
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
      if (automatic?.ownsChannel !== false) await channel.close()
    } catch (cleanup) {
      report(cleanup)
    }
    throw failure
  }
}

/**
 * Construct the original endpoint once before runtime routes are installed. Listener sessions
 * supply their existing limits/store policy; explicit factories retain their original signature.
 */
export async function prepareRuntimePeerEndpoint(
  options: IRuntimePeerOptions,
  channel: IRemoteChannel,
  signal: IAbortSignal,
  policy: Pick<IRpcFactoryConfig, 'providerLimits' | 'idempotency' | 'provider'> = {}
): Promise<IRemoteServeEndpoint> {
  if (options.endpointFactory) return options.endpointFactory(channel, signal)
  /** Only the real channel agreement can install native control and streaming roots. */
  const nativeControl = channel.agreement.capabilities.includes(RpcCapability.ping)
  /** Streaming remains optional even when the symmetric application directory is installed. */
  const supportsStream =
    channel.agreement.capabilities.includes(RpcCapability.runtimeApi) &&
    channel.agreement.capabilities.includes(RpcCapability.stream)
  /**
   * Each selected endpoint keeps the actual scheduler, framing, security Features and provider
   * limits.
   */
  const endpoint = await createRuntimeApiEndpoint(
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
    { supports: (peerId) => supportsStream && peerId === channel.peerId },
    nativeControl
  )
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
