import type {
  IRuntimePeerIdentity,
  IRuntimePeerOptions,
  IRuntimePeerSourceContext
} from '../remote/runtime-api/peer.js'
import { createRuntimePeer, prepareRuntimePeerSourceContext } from '../remote/runtime-api/peer.js'
import { createManagedRuntimePeer } from '../remote/runtime-api/managed-peer.js'
import {
  readRuntimeLaunchContext,
  readRuntimePreparationContext,
  withRuntimeLaunchContext,
  withRuntimePreparationContext
} from '../remote/runtime-api/launch-context.js'
import type { IRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
import { readRuntimeDefaultTimeout } from '../remote/runtime-api/timeout.js'
import { defaultRpcId } from '../core/internal/id.js'
import { RpcRuntimeGenerationKind } from '@migaia/rpc-contract/runtime'
import { readAdapterMessagePreparation } from './message/resource.js'
import {
  prepareAdapterMessageBootstrap,
  openPreparedAdapterMessageBootstrap
} from './message/bootstrap-source.js'
import type { IAdapterMessageResource } from './message/types.js'
import { createRpcError, RpcCoreErrorCode } from '../core/errors.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import { assertRuntimeTransferDisabled } from '../core/internal/runtime-call-options.js'
import type { IRemoteBinding, IRemoteChannel, IRemoteServeEndpoint } from '../remote/types.js'
import type { ISupervisor } from '@migaia/supervision'
import type { IRpcHandshakeOffer } from '@migaia/rpc-contract'
import { createAdapterListenerPreparation, type IAdapterListenerPreparation } from './listener.js'
import { createAdapterBytePeer, type IAdapterBytePeerOptions } from './byte/peer.js'
import type { IRuntimeByteIO } from './byte/types.js'
import { defaultRpcReporter } from '../core/default-reporter.js'

/** Adapter deployment objects are ordinary configuration; resource factories remain adapter-owned. */
export type IAdapterPeerOptions = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect' | 'listen' | 'report'
> &
  Readonly<{
    /** Platform factories default to console reporting without copying Host provenance. */
    report?: IRuntimePeerOptions['report']
    spawn?: unknown
    connect?: unknown
    listen?: unknown
  }>

/** A held binding exposes endpoint attachment and shutdown operations, never private context DTOs. */
export type IAdapterManagedBinding<TUnit, TSpec> = IRemoteBinding<TUnit, TSpec> &
  Readonly<{
    bindEndpoint?(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
    drainCurrent?(): Promise<void>
  }>

/** A source preparation retains the original Host context internally across adapter option copies. */
class AdapterPeerPreparation {
  /** Only the original options identity may supply genuine Host preparation provenance. */
  readonly #preparation: IRuntimePreparationContext | undefined
  /** Compiled local roots and identity belong to this preparation, never to a remote claim. */
  #context: IRuntimePeerSourceContext | undefined
  /** Original local configuration is read only when its source actually needs a compiled offer. */
  readonly #options: IAdapterPeerOptions
  /** The adapter's ordinary default label carries no execution or authentication authority. */
  readonly #defaultName: string
  /** A held listener's local configured address may replace only a library-default identity. */
  readonly #selectedSelf: IRuntimePeerIdentity | undefined
  /** Every launch under this preparation shares one Core-generated local provider namespace. */
  #providerId: string | undefined
  /** A fixed narrowing view shares this preparation's identity/namespace without another validation. */
  #withoutTransfer: IAdapterPeerPreparation | undefined

  /** Validate the default before any native acquisition and retain only Core's original context. */
  constructor(
    options: IAdapterPeerOptions,
    defaultName: string,
    selectedSelf?: IRuntimePeerIdentity
  ) {
    readRuntimeDefaultTimeout(options)
    this.#preparation = readRuntimePreparationContext(options)
    this.#options = options
    this.#defaultName = defaultName
    this.#selectedSelf = selectedSelf
  }

  /** Compile the local offer once; automatic children do not allocate an unused default address. */
  get context(): IRuntimePeerSourceContext {
    if (this.#context) return this.#context
    /** An adapter may choose its local address, while an explicit user identity retains precedence. */
    const configured = this.#options.self
    /** Selection is local configuration, not a remote identity or accepted capability claim. */
    const self =
      this.#selectedSelf && (configured === undefined || this.#preparation?.selfDefaulted)
        ? this.#selectedSelf
        : (configured ?? { name: this.#defaultName, instanceId: defaultRpcId() })
    return (this.#context = prepareRuntimePeerSourceContext(
      self,
      !this.#options.endpointFactory,
      this.#options.authentication
    ))
  }

  /** A caller can read the original signals without obtaining a context setter or ownership writer. */
  get initialSignal() {
    return this.#preparation?.initialSignal
  }
  /** Native source generations read the SDK budget from this exact preparation. */
  get connectTimeoutMs() {
    return this.#preparation?.connectTimeoutMs
  }
  /** Native listeners use the same original Host shutdown signal. */
  get lifecycleSignal() {
    return this.#preparation?.lifecycleSignal
  }

  /**
   * Read the genuine local Feature snapshot; copied options cannot install another Host's
   * providers.
   */
  readProvide(fallback: IRuntimePeerOptions['provide']) {
    return this.#preparation?.readProvide?.() ?? fallback
  }

  /**
   * The original Host owns this actual close resource, with no public admission/context
   * registration.
   */
  own(resource: Readonly<{ close(): Promise<void> }>): void {
    this.#preparation?.own?.(() => resource.close())
  }

  /** Launch an actual held resource using this preparation's own compiled offer and namespace. */
  launch<TSpec, TRequest extends Readonly<{ executionGeneration?: number }>, THandle>(
    launcher: Readonly<{ launch(spec: TSpec, request: TRequest): Promise<THandle> }>,
    spec: TSpec,
    request: TRequest,
    childName?: string
  ): Promise<THandle> {
    return withRuntimeLaunchContext(
      request,
      {
        ...this.context,
        ...(childName === undefined ? {} : { childName }),
        generation: {
          kind: RpcRuntimeGenerationKind.restart,
          value: request.executionGeneration!,
          providerId: (this.#providerId ??= defaultRpcId())
        }
      },
      () => launcher.launch(spec, request)
    )
  }

  /** Reserve this source's namespace before binding admission, then retain the original launcher. */
  launcher<TLauncher extends Readonly<{ launch(spec: never, request: never): Promise<unknown> }>>(
    launcher: TLauncher,
    childName?: string
  ): TLauncher {
    this.#providerId ??= defaultRpcId()
    return {
      ...launcher,
      launch: (
        spec: Parameters<TLauncher['launch']>[0],
        request: Parameters<TLauncher['launch']>[1]
      ) =>
        withRuntimeLaunchContext(
          request,
          {
            ...this.context,
            ...(childName === undefined ? {} : { childName }),
            generation: {
              kind: RpcRuntimeGenerationKind.restart,
              value: (request as Readonly<{ executionGeneration?: number }>).executionGeneration!,
              providerId: this.#providerId!
            }
          },
          () => launcher.launch(spec, request)
        )
    } as TLauncher
  }

  /** Prepare a managed Peer over the held binding while Core retains all Host provenance internally. */
  managed<TUnit, TSpec>(
    options: Parameters<typeof createManagedRuntimePeer<TUnit, TSpec>>[0],
    binding: IAdapterManagedBinding<TUnit, TSpec>,
    execution?: ISupervisor<unknown, unknown>
  ) {
    return this.#managed(options, binding, execution, this.#preparation)
  }

  /** Only Core's opaque views select a genuine context for the same held managed resources. */
  #managed<TUnit, TSpec>(
    options: Parameters<typeof createManagedRuntimePeer<TUnit, TSpec>>[0],
    binding: IAdapterManagedBinding<TUnit, TSpec>,
    execution: ISupervisor<unknown, unknown> | undefined,
    preparation: IRuntimePreparationContext | undefined
  ) {
    return createManagedRuntimePeer(
      options,
      binding,
      binding.bindEndpoint,
      preparation,
      binding.drainCurrent ? () => binding.drainCurrent!() : undefined,
      execution
    )
  }

  /**
   * Construct an ordinary Peer after native discovery, retaining the original context on its new
   * options.
   */
  peer(options: IRuntimePeerOptions, resource?: IAdapterMessageResource) {
    return this.#peer(options, resource, this.#preparation)
  }

  /** Validate an ordinary local proposal against this preparation's actual compiled local roots. */
  validateOffer(offer: IRpcHandshakeOffer): void {
    /** This comparison preserves the original local identity/subset admission and error identity. */
    const context = this.context
    if (
      offer.peer.id !== context.self.instanceId ||
      offer.capabilities.some((value) => !context.capabilities.includes(value))
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
  }

  /**
   * Prepare the original listener directory and sessions while Core retains its genuine Host
   * context.
   */
  listener(localOffer: readonly string[]): IAdapterListenerPreparation {
    return this.#listener(localOffer, this.#preparation)
  }

  /** Only Core's narrowing views may select a genuine listener context for the original options. */
  #listener(
    localOffer: readonly string[],
    preparation: IRuntimePreparationContext | undefined
  ): IAdapterListenerPreparation {
    /**
     * Keep the original listener option subset; retry/key/execution policies remain with their
     * owner.
     */
    const options: IRuntimePeerOptions = {
      self: this.context.self,
      provide: this.#options.provide,
      probe: this.#options.probe,
      providerLimits: this.#options.providerLimits,
      authentication: this.#options.authentication,
      defaultTimeoutMs: this.#options.defaultTimeoutMs,
      contract: this.#options.contract,
      endpointFactory: this.#options.endpointFactory,
      report: this.#options.report ?? defaultRpcReporter
    }
    return createAdapterListenerPreparation(options, localOffer, preparation)
  }

  /** Consume Core's original first-frame snapshot on the actual held byte input. */
  bytePeer(options: IRuntimePeerOptions, io: IRuntimeByteIO, local: IAdapterBytePeerOptions) {
    return createAdapterBytePeer(options, io, local, this.#preparation)
  }

  /** A narrowing view preserves context across copied options without exposing a context input. */
  #peer(
    options: IRuntimePeerOptions,
    resource: IAdapterMessageResource | undefined,
    preparation: IRuntimePreparationContext | undefined
  ) {
    if (!resource)
      return withRuntimePreparationContext(options, preparation ?? {}, () =>
        createRuntimePeer(options)
      )
    return this.#resourcePeer(options, resource, preparation)
  }

  /** Native automatic preparation reads only this Core resource's actual initial message. */
  async #resourcePeer(
    options: IRuntimePeerOptions,
    resource: IAdapterMessageResource,
    context: IRuntimePreparationContext | undefined
  ) {
    /** Automatic resource cleanup shares the public default without cloning original options. */
    const report = options.report ?? defaultRpcReporter
    /** Only the exact Core resource can transfer cold capture and actual launch metadata. */
    const preparation = readAdapterMessagePreparation(resource)
    if (!preparation)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
    try {
      /** The old Peer and new Host share the original raw capture and remaining ACK deadline. */
      const captured = await prepareAdapterMessageBootstrap(resource, {
        connectTimeoutMs: context?.connectTimeoutMs
      })
      /** The held resource admitted this actual initial message once, before resolving the read. */
      const initial = preparation.initial!
      /**
       * Closed initial-message admission has validated both identities and their address
       * relationship.
       */
      const self = initial.self
      /** Existing competing sources still reach the canonical Peer source rejection. */
      const peerOptions: IRuntimePeerOptions = {
        ...options,
        self: options.self ?? self,
        listen: options.listen ?? options.connect,
        connect: async (context) => openPreparedAdapterMessageBootstrap(captured, context)
      }
      return await withRuntimePreparationContext(peerOptions, context ?? {}, () =>
        createRuntimePeer(peerOptions, {
          bootstrap: preparation,
          generation: preparation.generation
        })
      )
    } catch (primary) {
      try {
        preparation.close()
      } catch (cleanup) {
        try {
          report(cleanup)
        } catch (failure) {
          hostRethrowReporter(failure, IpcReporterContext)
        }
      }
      throw primary
    }
  }

  /**
   * Disable only transfer on this preparation's real operations, before caller getter/payload
   * capture.
   */
  withoutTransfer(): IAdapterPeerPreparation {
    if (this.#withoutTransfer) return this.#withoutTransfer
    /** This context is copied only from Core's genuine original Host preparation, never caller DTOs. */
    const context: IRuntimePreparationContext = {
      ...this.#preparation,
      restrictTransfer: assertRuntimeTransferDisabled
    }
    /** Fixed view operations close over the genuine context and reuse the original lazy namespace. */
    const view = Object.freeze(
      Object.defineProperties(
        {
          readProvide: (fallback: IRuntimePeerOptions['provide']) =>
            context.readProvide?.() ?? fallback,
          own: (resource: Readonly<{ close(): Promise<void> }>) =>
            context.own?.(() => resource.close()),
          launch: <TSpec, TRequest extends Readonly<{ executionGeneration?: number }>, THandle>(
            launcher: Readonly<{ launch(spec: TSpec, request: TRequest): Promise<THandle> }>,
            spec: TSpec,
            request: TRequest,
            childName?: string
          ) => this.launch(launcher, spec, request, childName),
          launcher: <
            TLauncher extends Readonly<{ launch(spec: never, request: never): Promise<unknown> }>
          >(
            launcher: TLauncher,
            childName?: string
          ) => this.launcher(launcher, childName),
          managed: <TUnit, TSpec>(
            options: Parameters<typeof createManagedRuntimePeer<TUnit, TSpec>>[0],
            binding: IAdapterManagedBinding<TUnit, TSpec>,
            execution?: ISupervisor<unknown, unknown>
          ) => this.#managed(options, binding, execution, context),
          peer: (options: IRuntimePeerOptions, resource?: IAdapterMessageResource) =>
            this.#peer(options, resource, context),
          validateOffer: (offer: IRpcHandshakeOffer) => this.validateOffer(offer),
          listener: (offer: readonly string[]) => this.#listener(offer, context),
          bytePeer: (
            options: IRuntimePeerOptions,
            io: IRuntimeByteIO,
            local: IAdapterBytePeerOptions
          ) => createAdapterBytePeer(options, io, local, context),
          withoutTransfer: () => view
        },
        {
          context: { get: () => this.context, enumerable: true },
          initialSignal: { get: () => context.initialSignal, enumerable: true },
          connectTimeoutMs: { get: () => context.connectTimeoutMs, enumerable: true },
          lifecycleSignal: { get: () => context.lifecycleSignal, enumerable: true }
        }
      )
    ) as IAdapterPeerPreparation
    return (this.#withoutTransfer = view)
  }
}

/** Opaque preparation exposes resource operations and local proposal data, not context writers. */
export type IAdapterPeerPreparation = Readonly<
  Pick<AdapterPeerPreparation, keyof AdapterPeerPreparation>
>

/** Prepare a source from ordinary options; the Core-owned object is the only context carrier. */
export function prepareAdapterPeer(
  options: IAdapterPeerOptions,
  defaultName: string,
  selectedSelf?: IRuntimePeerIdentity
): IAdapterPeerPreparation {
  return new AdapterPeerPreparation(options, defaultName, selectedSelf)
}

/** Read only the launch metadata Core attached to this actual launch request, never caller labels. */
export function holdAdapterLaunch(request: object) {
  /** Exact request identity determines whether Core owns any compiled launch metadata. */
  const context = readRuntimeLaunchContext(request)
  return Object.freeze({
    /** Local bootstrap data is output from Core; no setter or claimed agreement is accepted. */
    get proposal() {
      return context
    }
  })
}
