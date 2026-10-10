import type { IRpcPortableValue, IRpcRuntimeEnvelope } from '../contract/index.js'
import {
  createRuntimeRequestInput,
  retainRuntimeRequestInput,
  isForwardedPayload,
  type IRuntimeRequestInput
} from './internal/outbound-envelope.js'
import { readEndpointOwner, retainEndpointProjection } from './internal/endpoint-projection.js'
import { EndpointOwnerKey } from './endpoint-kernel.js'
import type { RpcOutboundAttachment } from './internal/outbound-attachment.js'
import { createComposedEndpoint } from './composed.js'
import { createCanonicalChunkFeature } from './features/canonical-chunk.js'
import { createOutboundFeature, type IOutboundSurface } from './features/outbound.js'
import { createProviderFeatureWithScope } from './internal/provider-feature.js'
import { createOneWayFeature, type IOneWaySurface } from './features/one-way.js'
import { createDiscoveryFeature, type IDiscoverySurface } from './features/discovery.js'
import { createControlFeature, type IControlSurface } from './features/control.js'
import {
  createStreamFeature,
  type IRpcStreamRuntime,
  type IRpcStreamCapabilityPort
} from './features/stream.js'
import type { IRpcFactoryConfig, IRpcEndpoint, ISendOptions } from './typing.js'
import { RpcError, RpcCoreErrorCode } from './errors.js'
import { RpcCoreErrorText } from './error-text.js'
import type { IProviderAdmissionScope, IProviderRegistrationSurface } from './features/provider.js'
import { RpcCapability } from '../contract/wire-constants.js'

/** Constructor controls derive their portable fields from the existing public call envelope. */
type IRpcRuntimeOptions = Extract<IRpcRuntimeEnvelope, { kind: 'runtime-call' }>['options']
/** Groups retain the existing portable controls and local signal/ownership selectors. */
type IRuntimeEndpointGroupOptions = Omit<IRpcRuntimeOptions, 'timeoutMs'> &
  Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
/** Neutral channel resources grant rights only over the supplied transport and peer. */
type IRuntimeEndpointChannel = Readonly<{
  agreement: Readonly<{ capabilities: readonly string[] }>
  peerId: string
  transport: IRpcFactoryConfig['transport']
  /** The original Host reservation stages its own limit policy and reports actual commit. */
  hostRegistration?: Readonly<{
    stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
    isCommitted(): boolean
  }>
}>

/** Reject an unavailable runtime operation at its canonical capability/error owner. */
export function rejectRuntimeApiCapability(): never {
  throw new RpcError(RpcCoreErrorCode.capabilityUnsupported, RpcCoreErrorText.capabilityUnsupported)
}

/** The internal symmetric preset exposes only its existing canonical owner surfaces. */
type IRuntimeApiEndpoint = IOutboundSurface &
  IProviderRegistrationSurface &
  IOneWaySurface &
  Partial<IDiscoverySurface & IControlSurface> &
  Readonly<{
    stream: IRpcStreamRuntime
    readonly ready: Promise<void>
    request(
      method: string,
      payload?: unknown,
      options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
        Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
    ): Promise<IRpcPortableValue | undefined>
    notify(
      method: string,
      payload?: unknown,
      options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
        Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
    ): Promise<void>
    dispose(): Promise<void>
  }>

/** The original composed projection owns physical operations; ready belongs to this resource. */
type IRuntimePhysicalEndpoint = Omit<IRuntimeApiEndpoint, 'ready' | 'request' | 'notify'>

/** Held caller operations keep their existing capture, retry and lazy consumer owners. */
type IRuntimeEndpointBinding = Readonly<{
  ready: Promise<void>
  request(
    method: string,
    payload?: unknown,
    options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
      Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
  ): Promise<IRpcPortableValue | undefined>
  notify(
    method: string,
    payload?: unknown,
    options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
      Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
  ): Promise<void>
  stream: Readonly<{
    open(
      method: string,
      payload?: unknown,
      options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
        Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
    ): AsyncIterableIterator<IRpcPortableValue>
  }>
  dispose(): Promise<void>
}>

/** Borrowing callable operations grants only the rights already held by that binding object. */
export function createRuntimeApiEndpoint(
  config: Readonly<{ binding: IRuntimeEndpointBinding }>
): IRuntimeEndpointBinding
/** Install the existing composed kernel behind a synchronous actual-channel resource. */
export function createRuntimeApiEndpoint(
  config: IRpcFactoryConfig,
  channel: IRuntimeEndpointChannel,
  admission?: IProviderAdmissionScope
): IRuntimeApiEndpoint
export function createRuntimeApiEndpoint(
  config: IRpcFactoryConfig | Readonly<{ binding: IRuntimeEndpointBinding }>,
  channel?: IRuntimeEndpointChannel,
  admission?: IProviderAdmissionScope
): IRuntimeApiEndpoint | IRuntimeEndpointBinding {
  if ('binding' in config) {
    /** These are complete owned operations, never caller claims or public preparation plumbing. */
    const binding = config.binding
    /** Repeated disposal joins the held binding's original first settlement Promise. */
    let closing: Promise<void> | undefined
    return Object.freeze({
      get ready() {
        return binding.ready
      },
      request: (method: string, payload?: unknown, options?: IRuntimeEndpointGroupOptions) =>
        binding.request(method, payload, options),
      notify: (method: string, payload?: unknown, options?: IRuntimeEndpointGroupOptions) =>
        binding.notify(method, payload, options),
      stream: binding.stream,
      dispose: () => (closing ??= binding.dispose())
    })
  }
  if (!channel) rejectRuntimeApiCapability()
  /** Only the actual Host reservation records candidate limit policy. */
  channel.hostRegistration?.stagePolicy(
    config.providerLimits?.maxGlobal,
    config.providerLimits?.maxPerPeer
  )
  /** Actual agreement chooses installed roots; caller options never supply capability flags. */
  const nativeControl = channel.agreement.capabilities.includes(RpcCapability.ping)
  /** The stream predicate captures this exact channel and its actual bilateral agreement. */
  const capability: IRpcStreamCapabilityPort = {
    supports: (peerId) =>
      peerId === channel.peerId &&
      channel.agreement.capabilities.includes(RpcCapability.runtimeApi) &&
      channel.agreement.capabilities.includes(RpcCapability.stream)
  }
  /** The canonical chunk dependency remains the sole framing/reassembly owner. */
  const chunk = createCanonicalChunkFeature()
  /** Request, response, notify and stream share one sender and inbound identity owner. */
  const outbound = createOutboundFeature(chunk)
  /** Stream and scalar routes remain in the original provider namespace/registry. */
  const provider = createProviderFeatureWithScope(
    outbound,
    admission,
    () => channel.hostRegistration?.isCommitted() ?? true
  )
  /** Only an actual native capability intersection installs original discovery/control resources. */
  const discovery = nativeControl ? createDiscoveryFeature(outbound) : undefined
  /** Channel Features join the same explicit root batch rather than the user Feature tuple overload. */
  const { features, ...options } = config
  /** The canonical composition remains the only installation and rollback owner. */
  const installing = createComposedEndpoint(options, {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-provider': provider,
    'first-party-one-way': createOneWayFeature(outbound),
    'first-party-stream': createStreamFeature(outbound, provider, { capability }),
    ...(discovery
      ? {
          'first-party-discovery': discovery,
          'first-party-control': createControlFeature(outbound, discovery)
        }
      : {}),
    ...Object.fromEntries((features ?? []).map((feature, index) => [`channel-${index}`, feature]))
  }) as Promise<IRuntimePhysicalEndpoint>
  /** Ready-path delegates retain original operation Promise and consumer identity. */
  let physical: IRuntimePhysicalEndpoint | undefined
  /** Disposal continues to share one original settlement result. */
  let closing: Promise<void> | undefined
  /** A new cold resource has no reflection-based owner or admission marker. */
  const facade = Object.create(null) as Record<string, unknown>
  /** Link only this resource's successfully constructed canonical endpoint. */
  const ready = installing.then((endpoint) => {
    physical = endpoint
    retainEndpointProjection(endpoint, facade)
  })
  /** Ancillary synchronous controls require the real installed composition. */
  const current = (): IRuntimePhysicalEndpoint => physical ?? rejectRuntimeApiCapability()
  /** Select grammar once at each operation's original position relative to payload capture. */
  const usesNativeGrammar = (
    callOptions: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
      Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
  ): boolean =>
    channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
    callOptions.orderKey !== undefined ||
    callOptions.cancel !== undefined ||
    Object.hasOwn(callOptions, 'transfer')
  /** New physical requests reuse the existing input and transport operations. */
  const dispatch = (
    input: IRuntimeRequestInput,
    callOptions: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
      Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>,
    mode: 'request' | 'notify',
    native: boolean
  ): Promise<IRpcPortableValue | undefined | void> => {
    if (native) {
      /** The original sender and already accepted remote generation remain authoritative. */
      const sender = readEndpointOwner<RpcOutboundAttachment>(
        current(),
        EndpointOwnerKey.outboundAttachment
      )
      const generation = sender?.runtimeTargetGeneration(channel.peerId)
      if (!sender || !generation) rejectRuntimeApiCapability()
      return sender.sendRuntimeOperation(
        channel.peerId,
        generation,
        mode,
        input,
        callOptions
      ) as Promise<IRpcPortableValue | undefined>
    }
    /** Legacy formatting uses the existing depth-two capture association. */
    const options = { ...callOptions }
    retainRuntimeRequestInput(options, input)
    return mode === 'notify' && !isForwardedPayload(callOptions, input.payload)
      ? current().sendOneWay(channel.peerId, input.method, input.payload, options)
      : current().send<IRpcPortableValue>(channel.peerId, input.method, input.payload, options)
  }
  /** Request selection precedes snapshot; notify keeps its separate original capture order. */
  const request = (
    method: string,
    payload: unknown,
    callOptions: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
      Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'> = {},
    mode: 'request' | 'notify' = 'request'
  ) => {
    /** Request selects before capture; notify selects after its original depth-zero capture. */
    let native = mode === 'request' ? usesNativeGrammar(callOptions) : false
    /** Preserve depth zero for native grammar and depth two for the legacy request carrier. */
    const depth = mode === 'notify' || native ? 0 : 2
    /** Reuse the existing canonical capture operation; no new proof pipeline is installed. */
    const input = createRuntimeRequestInput(
      method,
      payload,
      channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
        rejectRuntimeApiCapability,
      callOptions,
      depth
    )
    if (mode === 'notify') native = usesNativeGrammar(callOptions)
    /** Only new cold requests await installation; an installed operation returns its own Promise. */
    return physical
      ? dispatch(input, callOptions, mode, native)
      : ready.then(() => dispatch(input, callOptions, mode, native))
  }
  Object.defineProperties(facade, {
    ready: { value: ready, enumerable: true },
    request: {
      value: (
        method: string,
        payload?: unknown,
        options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
          Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
      ) => request(method, payload, options),
      enumerable: true
    },
    notify: {
      value: (
        method: string,
        payload?: unknown,
        options?: Omit<IRpcRuntimeOptions, 'timeoutMs'> &
          Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
      ) => request(method, payload, options, 'notify'),
      enumerable: true
    },
    send: {
      /** Existing generic admission remains at its original lower owner, including option getters. */
      value: <T>(
        targetId: string,
        method: string,
        data: unknown,
        options?: ISendOptions
      ): Promise<T> =>
        physical
          ? physical.send<T>(targetId, method, data, options)
          : ready.then(() => current().send<T>(targetId, method, data, options)),
      enumerable: true
    },
    sendOneWay: {
      value: (...args: Parameters<IOneWaySurface['sendOneWay']>) =>
        physical ? physical.sendOneWay(...args) : ready.then(() => current().sendOneWay(...args)),
      enumerable: true
    },
    provide: {
      value: (method: string, provider: Parameters<IProviderRegistrationSurface['provide']>[1]) => {
        current().provide(method, provider)
        return facade
      },
      enumerable: true
    },
    on: {
      value: (...args: Parameters<IProviderRegistrationSurface['on']>) => current().on(...args),
      enumerable: true
    },
    dispose: {
      value: () =>
        (closing ??= physical ? physical.dispose() : ready.then(() => current().dispose())),
      enumerable: true
    },
    stream: {
      value: Object.freeze({
        open: (...args: Parameters<IRpcStreamRuntime['open']>) => {
          if (physical) return physical.stream.open(...args)
          /** New cold resource calls preserve the original depth-zero payload snapshot. */
          const input = createRuntimeRequestInput(
            args[1],
            args[2],
            channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
              rejectRuntimeApiCapability,
            args[3]
          )
          /** One options association and one original consumer serve every cold control. */
          const options = { ...args[3] }
          retainRuntimeRequestInput(options, input)
          /** An unpulled stream observes only ready; the first control activates one consumer. */
          let consumer: Promise<AsyncIterableIterator<IRpcPortableValue>> | undefined
          /** Controls share installation failure and the same original lazy stream iterator. */
          const activeConsumer = () =>
            (consumer ??= ready.then(() =>
              current().stream.open(args[0], input.method, input.payload, options)
            ))
          return Object.freeze({
            next: (...values: Parameters<AsyncIterableIterator<IRpcPortableValue>['next']>) =>
              activeConsumer().then((iterator) => iterator.next(...values)),
            return: (value?: IRpcPortableValue) =>
              activeConsumer().then((iterator) => iterator.return!(value)),
            throw: (reason?: unknown) =>
              activeConsumer().then((iterator) => iterator.throw!(reason)),
            [Symbol.asyncIterator]() {
              return this
            }
          })
        },
        provide: (...args: Parameters<IRpcStreamRuntime['provide']>) =>
          current().stream.provide(...args),
        dispose: () => current().stream.dispose()
      }),
      enumerable: true
    }
  })
  /** Existing optional surfaces retain their exact physical functions and property availability. */
  for (const key of [
    'hooks',
    'sendAll',
    'dispatch',
    'dispatchAll',
    'announceClose',
    'connect',
    'discovery'
  ] as const)
    Object.defineProperty(facade, key, {
      get: () => (current() as unknown as IRpcEndpoint)[key],
      enumerable: true
    })
  if (nativeControl)
    for (const key of ['ping', 'pingAll'] as const)
      Object.defineProperty(facade, key, {
        get: () => (current() as unknown as IRpcEndpoint)[key],
        enumerable: true
      })
  return Object.freeze(facade) as unknown as IRuntimeApiEndpoint
}
