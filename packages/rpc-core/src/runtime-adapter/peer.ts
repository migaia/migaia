import type {
  IRuntimePeerIdentity,
  IRuntimePeerOptions,
  IRuntimePeerSourceContext
} from '../remote/index.js'
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
import { RpcRuntimeGenerationKind, rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import { readAdapterMessagePreparation } from './message/resource.js'
import type { IAdapterMessageResource } from './message/types.js'
import { createRpcError, RpcCoreErrorCode } from '../core/errors.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import type { IRemoteBinding, IRemoteChannel, IRemoteServeEndpoint } from '../remote/types.js'
import type { ISupervisor } from '@migaia/supervision'

/** Adapter deployment objects are ordinary configuration; resource factories remain adapter-owned. */
export type IAdapterPeerOptions = Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'> &
  Readonly<{
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
    return (this.#context = prepareRuntimePeerSourceContext(self, !this.#options.endpointFactory))
  }

  /** A caller can read the original signals without obtaining a context setter or ownership writer. */
  get initialSignal() {
    return this.#preparation?.initialSignal
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
    return createManagedRuntimePeer(
      options,
      binding,
      binding.bindEndpoint,
      this.#preparation,
      binding.drainCurrent ? () => binding.drainCurrent!() : undefined,
      execution
    )
  }

  /**
   * Construct an ordinary Peer after native discovery, retaining the original context on its new
   * options.
   */
  peer(options: IRuntimePeerOptions, resource?: IAdapterMessageResource) {
    if (!resource)
      return withRuntimePreparationContext(options, this.#preparation ?? {}, () =>
        createRuntimePeer(options)
      )
    return this.#resourcePeer(options, resource)
  }

  /** Native automatic preparation reads only this Core resource's actual initial message. */
  async #resourcePeer(options: IRuntimePeerOptions, resource: IAdapterMessageResource) {
    /** Only the exact Core resource can transfer cold capture and actual launch metadata. */
    const preparation = readAdapterMessagePreparation(resource)
    if (!preparation)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
    try {
      /** EventTarget acquisition installs its real reader synchronously before the first await. */
      if (!preparation.initial) {
        /** The original automatic bootstrap deadline starts after the same synchronous capture. */
        const receiving = resource.receiveInitial()
        /** This task belongs only to initial acquisition, not to the later capability exchange. */
        const deadline = systemScheduler.schedule(
          () => preparation.fail(),
          rpcMessageCapabilityControl.timeoutMs
        )
        try {
          await receiving
        } finally {
          deadline.cancel()
        }
      }
      /** The held resource admitted this actual initial message once, before resolving the read. */
      const initial = preparation.initial!
      /**
       * Closed initial-message admission has validated both identities and their address
       * relationship.
       */
      const self = initial.self
      /** Parent addressing is data from this actual initial message, never a principal claim. */
      const parent = initial.parent
      /** Existing competing sources still reach the canonical Peer source rejection. */
      const peerOptions: IRuntimePeerOptions = {
        ...options,
        self: options.self ?? self,
        listen: options.listen ?? options.connect,
        connect: async (context) => {
          if (
            options.self &&
            (options.self.name !== self.name || options.self.instanceId !== self.instanceId)
          )
            throw createRpcError(
              RpcCoreErrorCode.invalidConfig,
              RuntimeApiErrorText.identityInvalid
            )
          /**
           * The canonical clone carrier can locally restore native storage only alongside portable
           * binary.
           */
          const offer = rpcMessageCapabilityControl.localOffer(context.capabilities) as Extract<
            ReturnType<typeof rpcMessageCapabilityControl.localOffer>,
            { valid: true }
          >
          return resource.open({
            peerId: parent.instanceId,
            scheduler: systemScheduler,
            offer: offer.value,
            control: rpcMessageCapabilityControl
          })
        }
      }
      return await withRuntimePreparationContext(peerOptions, this.#preparation ?? {}, () =>
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
          options.report(cleanup)
        } catch (failure) {
          hostRethrowReporter(failure, IpcReporterContext)
        }
      }
      throw primary
    }
  }
}

/** Opaque preparation exposes resource operations and local proposal data, not context writers. */
export type IAdapterPeerPreparation = AdapterPeerPreparation

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
