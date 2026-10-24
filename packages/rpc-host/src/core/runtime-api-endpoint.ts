import { createRpcError, RpcCoreErrorCode } from './errors.js'
import type { IRpcPortableValue, IRpcRuntimeEnvelope } from '@migaia/rpc-contract'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/v1'
import {
  createRuntimeRequestInput,
  retainForwardOptions,
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
import { createProviderFeature } from './internal/provider-feature.js'
import { createOneWayFeature, type IOneWaySurface } from './features/one-way.js'
import { createDiscoveryFeature, type IDiscoverySurface } from './features/discovery.js'
import { createControlFeature, type IControlSurface } from './features/control.js'
import {
  createStreamFeature,
  type IRpcStreamRuntime,
  type IRpcStreamCapabilityPort
} from './features/stream.js'
import type {
  IRpcFactoryConfig,
  IRpcEndpoint,
  IRpcPingEndpointSurface,
  ISendOptions
} from './typing.js'
import type { IRpcFeatureSurface } from './feature.js'
import type { ICheckedInput, IFeatures, IMiddlewares } from './pipeline-contract.js'
import type {
  IFactoryDiscoveryMode,
  IFactoryPingCapability,
  INativeMiddlewareSurface,
  IRecursiveProvideSurface
} from './internal/factory-types.js'

import { RpcCoreErrorText } from './error-text.js'
import type { IProviderAdmissionScope } from './internal/provider-admission.js'
import type { IProviderRegistrationSurface } from './internal/provider-feature.js'
import { RpcCapability } from '@migaia/rpc-contract/wire'
import { deferred } from '@migaia/utils/promise'

/** Constructor controls derive their portable fields from the existing public call envelope. */
type IRpcRuntimeOptions = Extract<IRpcRuntimeEnvelope, { kind: 'runtime-call' }>['options']
/** Groups retain the existing portable controls and local signal/ownership selectors. */
type IRuntimeEndpointGroupOptions = Omit<IRpcRuntimeOptions, 'timeoutMs'> &
  Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
/** Atomic group inputs reuse the canonical public wire grammar without a second DTO. */
type IRuntimeEndpointGroupSteps = Extract<IRpcRuntimeEnvelope, { kind: 'runtime-group' }>['steps']
/** Outcome lookup returns only the original store and terminal result, never wire routing fields. */
type IRuntimeEndpointOutcomeResult =
  | Pick<
      Extract<IRpcRuntimeEnvelope, { kind: 'runtime-outcome'; state: 'pending' | 'unknown' }>,
      'state' | 'store'
    >
  | Pick<
      Extract<IRpcRuntimeEnvelope, { kind: 'runtime-outcome'; state: 'done' }>,
      'state' | 'store' | 'outcome'
    >
/** Neutral channel resources grant rights only over the supplied transport and peer. */
type IRuntimeEndpointChannel = Readonly<{
  agreement: Readonly<{ capabilities: readonly string[] }>
  peerId: string
  transport: IRpcFactoryConfig['transport']
  /** A logical host delegates every capability check to the actual selected physical agreement. */
  supportsPeer?(peerId: string, capability: string): boolean
  /** Feature contributions replace this one canonical outbound framing dependency. */
  chunk?: ReturnType<typeof createCanonicalChunkFeature>
  /** The original Host reservation stages its own limit policy and reports actual commit. */
  hostRegistration?: Readonly<{
    stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
    isCommitted(): boolean
  }>
}>

/** Reject an unavailable runtime operation at its canonical capability/error owner. */
export function rejectRuntimeApiCapability(): never {
  throw createRpcError(
    RpcCoreErrorCode.capabilityUnsupported,
    RpcCoreErrorText.capabilityUnsupported
  )
}

/** The internal symmetric preset exposes only its existing canonical owner surfaces. */
type IRuntimeApiEndpoint = Omit<IOutboundSurface, 'group' | 'outcome'> &
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
    /** Submit the admitted request steps as one task and retain each original step outcome. */
    group(
      steps: IRuntimeEndpointGroupSteps,
      options?: IRuntimeEndpointGroupOptions
    ): Promise<readonly IRpcRuntimeStepOutcome[]>
    /** Select an admitted target explicitly, as on the same composed outbound Feature. */
    group(
      targetId: string,
      steps: IRuntimeEndpointGroupSteps,
      options?: IRuntimeEndpointGroupOptions
    ): Promise<readonly IRpcRuntimeStepOutcome[]>
    /** Query a logical key's stored outcome without executing its providers again. */
    outcome(idempotencyKey: string): Promise<IRuntimeEndpointOutcomeResult>
    /** The explicit target form grants only the actual endpoint's existing admitted rights. */
    outcome(targetId: string, idempotencyKey: string): Promise<IRuntimeEndpointOutcomeResult>
    dispose(): Promise<void>
  }>

/** The original composed projection owns physical operations; ready belongs to this resource. */
type IRuntimePhysicalEndpoint = Omit<
  IRuntimeApiEndpoint,
  'ready' | 'request' | 'notify' | 'group' | 'outcome'
> &
  Pick<IOutboundSurface, 'group' | 'outcome'>

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

/** Physical composition needs only the channel's actual agreement and resource admission rights. */
type IRuntimeCompositionChannel = Pick<
  IRuntimeEndpointChannel,
  'agreement' | 'peerId' | 'supportsPeer' | 'chunk' | 'hostRegistration'
>

/** Refine physical controls only from the installed channel and original middleware tuple. */
type IRuntimeCompositionSurface<
  TConfig,
  TChannel extends IRuntimeCompositionChannel
> = IRecursiveProvideSurface<
  Omit<IRuntimePhysicalEndpoint, 'connect' | 'discovery' | 'ping' | 'pingAll'> &
    IRpcFeatureSurface<IFeatures<TConfig>> &
    INativeMiddlewareSurface<IMiddlewares<TConfig>> &
    (typeof RpcCapability.ping extends TChannel['agreement']['capabilities'][number]
      ? Pick<
          IRpcEndpoint<string, IFactoryDiscoveryMode<IMiddlewares<TConfig>>>,
          'connect' | 'discovery'
        > &
          IRpcPingEndpointSurface<IFactoryPingCapability<IMiddlewares<TConfig>>>
      : Record<never, never>)
>

/** Build the actual runtime's one native Feature record; private owner oracles reuse this assembly. */
export function createRuntimeFeatureRoots(
  config: IRpcFactoryConfig,
  channel: IRuntimeCompositionChannel,
  admission?: IProviderAdmissionScope
) {
  /** Actual agreement chooses installed roots; caller options never supply capability flags. */
  const nativeControl = channel.agreement.capabilities.includes(RpcCapability.ping)
  /** The stream predicate captures this exact channel and its actual bilateral agreement. */
  const capability: IRpcStreamCapabilityPort = {
    supports: (peerId) =>
      channel.supportsPeer
        ? channel.supportsPeer(peerId, RpcCapability.runtimeApi) &&
          channel.supportsPeer(peerId, RpcCapability.stream)
        : peerId === channel.peerId &&
          channel.agreement.capabilities.includes(RpcCapability.runtimeApi) &&
          channel.agreement.capabilities.includes(RpcCapability.stream)
  }
  /** The canonical chunk dependency remains the sole framing/reassembly owner. */
  const chunk = channel.chunk ?? createCanonicalChunkFeature()
  /** Request, response, notify and stream share one sender and inbound identity owner. */
  const outbound = createOutboundFeature(chunk)
  /** Stream and scalar routes remain in the original provider namespace/registry. */
  const provider = createProviderFeature(
    outbound,
    admission,
    () => channel.hostRegistration?.isCommitted() ?? true
  )
  /** Only an actual native capability intersection installs original discovery/control resources. */
  const discovery = nativeControl ? createDiscoveryFeature(outbound) : undefined
  /** Channel Features join the same explicit root batch rather than the user Feature tuple overload. */
  const { features, ...options } = config
  /** The canonical composition remains the only installation and rollback owner. */
  const roots = {
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
  }
  return { nativeControl, roots, options }
}

/** Install the physical kernel used by actual Host startup and owner-level protocol oracles. */
export function createRuntimeEndpointComposition<
  const TConfig extends ICheckedInput,
  const TChannel extends IRuntimeCompositionChannel
>(
  config: TConfig,
  channel: TChannel,
  admission?: IProviderAdmissionScope
): {
  readonly nativeControl: boolean
  readonly installing: Promise<IRuntimeCompositionSurface<TConfig, TChannel>>
} {
  channel.hostRegistration?.stagePolicy(
    config.providerLimits?.maxGlobal,
    config.providerLimits?.maxPerPeer
  )
  /** Root construction captures user options once at their original point in assembly. */
  const { nativeControl, roots, options } = createRuntimeFeatureRoots(
    config as IRpcFactoryConfig,
    channel,
    admission
  )
  /** Canonical composition remains the sole installation and rollback owner. */
  const installing = createComposedEndpoint(options, roots)
  return {
    nativeControl,
    installing: installing as unknown as Promise<IRuntimeCompositionSurface<TConfig, TChannel>>
  }
}

/** Callable bindings retain one facade-owned disposal settlement even during synchronous reentry. */
class RuntimeBindingEndpoint {
  /** Borrowed operations remain owned by the original accepted binding. */
  #binding: IRuntimeEndpointBinding
  /** Every terminal caller observes the first disposal Promise. */
  #closing: Promise<void> | undefined

  /** Capture an existing binding without allocating another transport or endpoint. */
  constructor(binding: IRuntimeEndpointBinding) {
    this.#binding = binding
  }

  /** Publish the same frozen own-property surface as the original binding facade. */
  surface(): IRuntimeEndpointBinding {
    /** Borrowed ready identity belongs to the same original binding. */
    const binding = this.#binding
    return Object.freeze({
      get ready() {
        return binding.ready
      },
      request: (method: string, payload?: unknown, options?: IRuntimeEndpointGroupOptions) =>
        this.#binding.request(method, payload, options),
      notify: (method: string, payload?: unknown, options?: IRuntimeEndpointGroupOptions) =>
        this.#binding.notify(method, payload, options),
      stream: this.#binding.stream,
      dispose: () => this.#dispose()
    })
  }

  /** Publish settlement before disposal can synchronously reenter the facade. */
  #dispose(): Promise<void> {
    if (this.#closing) return this.#closing
    /** The original binding may throw before returning its disposal Promise. */
    const done = deferred<void>()
    this.#closing = done.promise
    try {
      void Promise.resolve(this.#binding.dispose()).then(done.resolve, done.reject)
    } catch (error) {
      done.reject(error)
    }
    return this.#closing
  }
}

/** Cold streams capture once and acquire their original iterator only on the first control. */
class PendingRuntimeStream implements AsyncIterableIterator<IRpcPortableValue> {
  /** The installed physical endpoint remains the sole stream owner. */
  #owner: RuntimeEndpointResource
  /** Captured stream routing and input preserve the original call-time snapshot. */
  #args: Parameters<IRpcStreamRuntime['open']>
  /** All controls share one lazy consumer Promise and installation failure. */
  #consumer: Promise<AsyncIterableIterator<IRpcPortableValue>> | undefined

  /** Retain the already captured request without activating an unpulled stream. */
  constructor(owner: RuntimeEndpointResource, args: Parameters<IRpcStreamRuntime['open']>) {
    this.#owner = owner
    this.#args = args
  }

  /** Lazily activate exactly one original physical stream after installation. */
  #active(): Promise<AsyncIterableIterator<IRpcPortableValue>> {
    return (this.#consumer ??= this.#owner.ready.then(() =>
      this.#owner.current().stream.open(...this.#args)
    ))
  }

  /** Forward the next control to the original consumer and retain its result. */
  next = (...values: Parameters<AsyncIterableIterator<IRpcPortableValue>['next']>) =>
    this.#active().then((iterator) => iterator.next(...values))

  /** Forward cancellation only after the same lazy consumer has been selected. */
  return = (value?: IRpcPortableValue) => this.#active().then((iterator) => iterator.return!(value))

  /** Preserve the original consumer's thrown reason semantics. */
  throw = (reason?: unknown) => this.#active().then((iterator) => iterator.throw!(reason));

  /** Iterator identity remains stable across every consumer request. */
  [Symbol.asyncIterator](): AsyncIterableIterator<IRpcPortableValue> {
    return this
  }
}

/** Own one physical composition, its synchronous facade, and its cold operation admission. */
class RuntimeEndpointResource {
  /** Rights come only from the actual selected transport agreement. */
  #channel: IRuntimeEndpointChannel
  /** The installed kernel remains the only operation and resource owner. */
  #physical: IRuntimePhysicalEndpoint | undefined
  /** Disposal shares the first canonical terminal settlement. */
  #closing: Promise<void> | undefined
  /** Stable null-prototype projection preserves the original own-property contract. */
  #facade = Object.create(null) as Record<string, unknown>
  /** Installation is shared by all cold operations and never retried here. */
  readonly ready: Promise<void>

  /** Install canonical resources before publishing the synchronous operation facade. */
  constructor(
    config: IRpcFactoryConfig,
    channel: IRuntimeEndpointChannel,
    admission?: IProviderAdmissionScope
  ) {
    this.#channel = channel
    /** Host startup and owner-level oracles consume the same physical assembly. */
    const { nativeControl, installing } = createRuntimeEndpointComposition(
      config,
      channel,
      admission
    )
    this.ready = installing.then((endpoint) => {
      this.#physical = endpoint
      retainEndpointProjection(endpoint, this.#facade)
    })
    this.#publishOperations()
    this.#publishControls(nativeControl)
    Object.freeze(this.#facade)
  }

  /** Return the existing frozen projection without creating another ownership layer. */
  surface(): IRuntimeApiEndpoint {
    return this.#facade as unknown as IRuntimeApiEndpoint
  }

  /** Ancillary synchronous controls require the real installed composition. */
  current(): IRuntimePhysicalEndpoint {
    return this.#physical ?? rejectRuntimeApiCapability()
  }

  /** Select native grammar at the original position relative to payload capture. */
  #usesNativeGrammar(options: IRuntimeEndpointGroupOptions): boolean {
    return (
      this.#channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
      options.orderKey !== undefined ||
      options.cancel !== undefined ||
      Object.hasOwn(options, 'transfer')
    )
  }

  /** Dispatch through the original accepted generation and canonical input owner. */
  #dispatch(
    input: IRuntimeRequestInput,
    callOptions: IRuntimeEndpointGroupOptions,
    mode: 'request' | 'notify',
    native: boolean
  ): Promise<IRpcPortableValue | undefined | void> {
    if (native) {
      /** Only the existing sender can admit the actual remote generation. */
      const sender = readEndpointOwner<RpcOutboundAttachment>(
        this.current(),
        EndpointOwnerKey.outboundAttachment
      )
      /** A missing generation cannot acquire rights from caller-supplied options. */
      const generation = sender?.runtimeTargetGeneration(this.#channel.peerId)
      if (!sender || !generation) rejectRuntimeApiCapability()
      return sender.sendRuntimeOperation(
        this.#channel.peerId,
        generation,
        mode,
        input,
        callOptions
      ) as Promise<IRpcPortableValue | undefined>
    }
    /** Legacy formatting retains admitted forwarding provenance alongside its captured input. */
    const options = retainForwardOptions(callOptions, { ...callOptions })
    retainRuntimeRequestInput(options, input)
    return mode === 'notify' && !isForwardedPayload(callOptions, input.payload)
      ? this.current().sendOneWay(this.#channel.peerId, input.method, input.payload, options)
      : this.current().send<IRpcPortableValue>(
          this.#channel.peerId,
          input.method,
          input.payload,
          options
        )
  }

  /** Preserve request-before-capture and notify-after-capture grammar selection. */
  #request(
    method: string,
    payload: unknown,
    options: IRuntimeEndpointGroupOptions = {},
    mode: 'request' | 'notify' = 'request'
  ) {
    /** Notify selects grammar after the original depth-zero snapshot. */
    let native = mode === 'request' ? this.#usesNativeGrammar(options) : false
    /** Only legacy scalar requests use the original depth-two capture. */
    const depth = mode === 'notify' || native ? 0 : 2
    /** The existing request input owns validation and forwarding provenance. */
    const input = createRuntimeRequestInput(
      method,
      payload,
      this.#channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
        rejectRuntimeApiCapability,
      options,
      depth
    )
    if (mode === 'notify') native = this.#usesNativeGrammar(options)
    return this.#physical
      ? this.#dispatch(input, options, mode, native)
      : this.ready.then(() => this.#dispatch(input, options, mode, native))
  }

  /** Both group overloads delegate to the same physical admission operation. */
  #group(
    targetOrSteps: string | IRuntimeEndpointGroupSteps,
    stepsOrOptions?: IRuntimeEndpointGroupSteps | IRuntimeEndpointGroupOptions,
    options?: IRuntimeEndpointGroupOptions
  ): Promise<readonly IRpcRuntimeStepOutcome[]> {
    return typeof targetOrSteps === 'string'
      ? this.current().group(targetOrSteps, stepsOrOptions as IRuntimeEndpointGroupSteps, options)
      : this.current().group(
          this.#channel.peerId,
          targetOrSteps,
          stepsOrOptions as IRuntimeEndpointGroupOptions | undefined
        )
  }

  /** Preserve explicit-target and bound-target lookup Promise identity. */
  #outcome(...args: [string] | [string, string]): Promise<IRuntimeEndpointOutcomeResult> {
    return args.length === 1
      ? this.current().outcome(this.#channel.peerId, args[0])
      : this.current().outcome(args[0], args[1])
  }

  /** Cold stream controls retain the original depth-zero snapshot and forwarding provenance. */
  #openStream(...args: Parameters<IRpcStreamRuntime['open']>) {
    if (this.#physical) return this.#physical.stream.open(...args)
    /** Snapshot before readiness so later caller mutation remains unobservable. */
    const input = createRuntimeRequestInput(
      args[1],
      args[2],
      this.#channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
        rejectRuntimeApiCapability,
      args[3]
    )
    /** One options association retains the admitted input for the physical stream. */
    const options = retainForwardOptions(args[3], { ...args[3] })
    retainRuntimeRequestInput(options, input)
    return Object.freeze(
      new PendingRuntimeStream(this, [args[0], input.method, input.payload, options])
    )
  }

  /** Publish operation callbacks without making closures the resource's state owner. */
  #publishOperations(): void {
    Object.defineProperties(this.#facade, {
      ready: { value: this.ready, enumerable: true },
      request: {
        value: (method: string, payload?: unknown, options?: IRuntimeEndpointGroupOptions) =>
          this.#request(method, payload, options),
        enumerable: true
      },
      notify: {
        value: (method: string, payload?: unknown, options?: IRuntimeEndpointGroupOptions) =>
          this.#request(method, payload, options, 'notify'),
        enumerable: true
      },
      group: {
        value: (
          target: string | IRuntimeEndpointGroupSteps,
          steps?: IRuntimeEndpointGroupSteps | IRuntimeEndpointGroupOptions,
          options?: IRuntimeEndpointGroupOptions
        ) => this.#group(target, steps, options),
        enumerable: true
      },
      outcome: {
        value: (...args: [string] | [string, string]) => this.#outcome(...args),
        enumerable: true
      },
      send: {
        value: <T>(
          targetId: string,
          method: string,
          data: unknown,
          options?: ISendOptions
        ): Promise<T> =>
          this.#physical
            ? this.#physical.send<T>(targetId, method, data, options)
            : this.ready.then(() => this.current().send<T>(targetId, method, data, options)),
        enumerable: true
      },
      sendOneWay: {
        value: (...args: Parameters<IOneWaySurface['sendOneWay']>) =>
          this.#physical
            ? this.#physical.sendOneWay(...args)
            : this.ready.then(() => this.current().sendOneWay(...args)),
        enumerable: true
      },
      provide: {
        value: (
          method: string,
          provider: Parameters<IProviderRegistrationSurface['provide']>[1]
        ) => {
          this.current().provide(method, provider)
          return this.#facade
        },
        enumerable: true
      },
      on: {
        value: (...args: Parameters<IProviderRegistrationSurface['on']>) =>
          this.current().on(...args),
        enumerable: true
      },
      dispose: {
        value: () =>
          (this.#closing ??= this.#physical
            ? this.#physical.dispose()
            : this.ready.then(() => this.current().dispose())),
        enumerable: true
      },
      stream: {
        value: Object.freeze({
          open: (...args: Parameters<IRpcStreamRuntime['open']>) => this.#openStream(...args),
          provide: (...args: Parameters<IRpcStreamRuntime['provide']>) =>
            this.current().stream.provide(...args),
          dispose: () => this.current().stream.dispose()
        }),
        enumerable: true
      }
    })
  }

  /** Fixed public control keys preserve property availability and original physical functions. */
  #publishControls(nativeControl: boolean): void {
    // Seven base keys and two optional ping keys are compile-time fixed, independent of peer count.
    for (const key of [
      'hooks',
      'sendAll',
      'dispatch',
      'dispatchAll',
      'announceClose',
      'connect',
      'discovery'
    ] as const)
      Object.defineProperty(this.#facade, key, {
        get: () => (this.current() as unknown as IRpcEndpoint)[key],
        enumerable: true
      })
    if (nativeControl)
      for (const key of ['ping', 'pingAll'] as const)
        Object.defineProperty(this.#facade, key, {
          get: () => (this.current() as unknown as IRpcEndpoint)[key],
          enumerable: true
        })
  }
}

/** Borrow callable operations with one facade-owned terminal settlement. */
export function createRuntimeApiEndpoint(
  config: Readonly<{ binding: IRuntimeEndpointBinding }>
): IRuntimeEndpointBinding
/** Install canonical physical owners behind one synchronous actual-channel resource. */
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
  if ('binding' in config) return new RuntimeBindingEndpoint(config.binding).surface()
  if (!channel) rejectRuntimeApiCapability()
  return new RuntimeEndpointResource(config, channel, admission).surface()
}
