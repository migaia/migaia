import { hostRethrowReporter } from '@migaia/utils/promise'
import { normalizePortable } from '../../contract/normalize.js'
import { registerLocalErrorWireSummary } from '../../contract/contract-error.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import { RpcCapability, RpcWireLimit } from '../../contract/wire-constants.js'
import {
  createRuntimeApiEndpoint,
  rejectRuntimeApiCapability,
  type IRuntimeApiEndpoint
} from '../../core/internal/runtime-api-endpoint.js'
import { RpcError, RpcCoreErrorCode, RpcSerializationError } from '../../core/errors.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { abort } from '../../core/middleware/abort.js'
import { codec } from '../../core/middleware/codec.js'
import { connect } from '../../core/middleware/connect.js'
import { framer } from '../../core/middleware/framer.js'
import { timeout } from '../../core/middleware/timeout.js'
import { hooks } from '../../core/middleware/hooks.js'
import { ping } from '../../core/middleware/ping.js'
import type {
  IRpcEndpoint,
  IRpcProvider,
  IRpcProviderLimits,
  IRpcAbortSignal
} from '../../core/typing.js'
import { RemoteMethodName } from '../constants.js'
import type { IRemoteContract } from '../contract.js'
import type { IRemoteCallOptions, IRemoteChannel, IRemoteProxyOptions } from '../types.js'
import { compileRuntimeMethods, type IRuntimePeerProvide } from './catalog.js'
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
  endpoint: IRuntimeApiEndpoint
  channel: IRemoteChannel
  report(error: unknown): void
  routes: ReadonlyMap<string, IRuntimePeerRoute>
}>

/** Only this callable assembly mints metadata for its own prepared facade; no lifecycle lives here. */
const runtimePeerConnections = new WeakMap<
  IRuntimePeer,
  IRuntimePeerConnection | (() => IRuntimePeer)
>()

/** Read the canonical accepted receipt for Plugin publication without another handshake or registry. */
export function readRuntimePeerConnection(peer: IRuntimePeer): IRuntimePeerConnection {
  /** An application-shaped Peer cannot inject identity or directory authority into a Host slot. */
  const connection = runtimePeerConnections.get(peer)
  if (!connection) invalid(RuntimeApiErrorText.peerInvalid)
  return typeof connection === 'function' ? readRuntimePeerConnection(connection()) : connection
}

/** Configuration rejection keeps its canonical code and does not reflect source secrets. */
function invalid(message: string): never {
  throw new RpcError(RpcCoreErrorCode.invalidConfig, message)
}

/** Normalize one provided payload; an omitted optional argument remains omitted on the wire. */
function payloadValue(payload: unknown): IRpcPortableValue | undefined {
  return payload === undefined ? undefined : normalizePortable(payload)
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
  if (supportsRuntime) {
    providers[RemoteMethodName.runtimeDescribe] = (context) => context.success(localDescription)
    for (const entry of methods) {
      if (entry.supportedModes?.every((mode) => mode === RuntimeApiMode.stream)) continue
      providers[entry.name] = async (context) => {
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
      }
    }
  }
  /** A successfully created endpoint is the only owner disposed during later preparation failure. */
  let endpoint: IRuntimeApiEndpoint | undefined
  try {
    endpoint = await createRuntimeApiEndpoint(
      {
        id: self.instanceId,
        scheduler: channel.scheduler,
        transport: channel.transport,
        targetIds: [channel.peerId],
        provider: providers,
        providerLimits: options.providerLimits,
        middlewares: [
          codec(channel.pipeline.codec),
          framer(channel.pipeline.framer),
          abort(),
          timeout(),
          hooks({ onHookError: report }),
          ...(nativeControl ? [ping()] : []),
          connect({ transport: channel.transport })
        ],
        features: channel.features
      },
      { supports: (peerId) => supportsStream && peerId === channel.peerId },
      nativeControl
    )
    if (supportsStream) {
      for (const entry of methods)
        if (!entry.supportedModes || entry.supportedModes.includes(RuntimeApiMode.stream))
          endpoint.stream.provide(
            `${RemoteMethodName.runtimeStreamPrefix}${entry.name}`,
            (payload, { context }) =>
              Reflect.apply(entry.method, entry.receiver, [payload, context]) as
                | AsyncIterable<IRpcPortableValue>
                | Iterable<IRpcPortableValue>
          )
    }
    localDescription = normalizeRuntimeDescription({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self,
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
            ...(entry.declaration ? { idempotent: entry.declaration.idempotent } : {})
          }))
        : []
    })
    channel.activateReceive?.()
    /** Only mutually negotiated application capability permits sending the new reserved method. */
    const remote = supportsRuntime
      ? normalizeRuntimeDescription(
          await endpoint.send(channel.peerId, RemoteMethodName.runtimeDescribe, null, {
            signal: automatic?.signal
          })
        )
      : undefined
    if (remote && remote.self.instanceId !== channel.peerId)
      invalid(RuntimeApiErrorText.identityInvalid)
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
        return ready.send<IRpcPortableValue | undefined>(
          channel.peerId,
          method,
          payloadValue(payload),
          callOptions
        )
      },
      notify: (method: string, payload?: unknown, callOptions?: IRemoteCallOptions) => {
        route(method, RuntimeApiMode.notify)
        return ready.sendOneWay(channel.peerId, method, payloadValue(payload), callOptions)
      },
      stream: (method: string, payload?: unknown, callOptions?: IRemoteCallOptions) => {
        if (!supportsStream) rejectRuntimeApiCapability()
        route(method, RuntimeApiMode.stream)
        return ready.stream.open(
          channel.peerId,
          routes.get(method)!.stream,
          payloadValue(payload),
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
