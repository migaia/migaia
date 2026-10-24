import type { IFeatureCore, IFeatureOutputs } from '@migaia/plugin-host'
import { createRpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcOutboundAttachment } from '../internal/outbound-attachment.js'
import { RpcRuntimeKind, RpcRuntimeMode } from '@migaia/rpc-contract/framing/v1'

import { RpcCoreErrorText } from '../error-text.js'
import { registerEndpointDebugSnapshot } from '../internal/test-observer.js'
import type { IRpcFeature } from '../feature.js'
import { createCanonicalChunkFeature } from './canonical-chunk.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import type {
  IOutboundCapability,
  IOutboundInstallation,
  IRpcOutboundCommandObservation
} from '../internal/feature-contract.js'
import type { IRpcEndpoint } from '../typing.js'
import {
  captureRuntimeGroupSteps,
  dispatchRuntimeGroup,
  dispatchRuntimeOutcome
} from '../internal/outbound-envelope.js'
import {
  RpcPortName,
  type IRpcDiscoveryResolverPort,
  type IRpcInboundIdentityPort,
  type IRpcIdentityCommand,
  type IRpcOutboundOperationsPort,
  type IRpcOutboundCommand,
  type IRpcOutboundSend,
  type IRpcVariationAdmissionRequest,
  type IRpcVariationCoordinatorPort
} from '../internal/plugin-shared-keys.js'

/**
 * Static outbound feature token; outbound behavior remains owned by the canonical endpoint
 * pipeline.
 */
export type IOutboundSurface = Pick<
  IRpcEndpoint,
  'send' | 'sendAll' | 'dispatch' | 'dispatchAll' | 'group' | 'outcome' | 'hooks'
>

/** Own one native outbound Feature's preparation and port publication. */
class OutboundFeatureInstallation {
  /** This exact native Feature core lends canonical endpoint capabilities during preparation. */
  #core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>
  /** Dependency outputs are the original native registration outputs, never copied assemblies. */
  #dependencies: {
    readonly canonicalChunk: IFeatureOutputs<{
      readonly canonicalChunk: ReturnType<typeof createCanonicalChunkFeature>
    }>['canonicalChunk']
  }
  /** The canonical attachment alone owns this installation's runtime resources. */
  #attachment: RpcOutboundAttachment | undefined
  /** Discovery connects the original receiver resolver without a second directory. */
  #resolver: IRpcDiscoveryResolverPort | undefined
  /** The first prepared installation is returned by identity on every later call. */
  #installation: IOutboundInstallation | undefined
  /** The frozen capability keeps the original own methods and detached-call behavior. */
  readonly value: IOutboundCapability
  /** Capture the receiving native registration before any attachment resources are acquired. */
  constructor(
    core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>,
    dependencies: {
      readonly canonicalChunk: IFeatureOutputs<{
        readonly canonicalChunk: ReturnType<typeof createCanonicalChunkFeature>
      }>['canonicalChunk']
    }
  ) {
    this.#core = core
    this.#dependencies = dependencies
    this.value = Object.freeze({
      prepare: this.#prepare,
      activate: () => this.#requireAttachment().activate(),
      ports: this.#ports,
      getHooks: () => this.#requireAttachment().hooks,
      connectResolver: (port: IRpcDiscoveryResolverPort) => {
        this.#resolver = port
      },
      send: <T>(...args: Parameters<IRpcEndpoint['send']>) =>
        this.#requireAttachment().send<T>(...args),
      sendAll: <T>(...args: Parameters<IRpcEndpoint['sendAll']>) =>
        this.#requireAttachment().sendAll<T>(...args),
      dispatch: (...args: Parameters<IRpcEndpoint['dispatch']>) =>
        this.#requireAttachment().dispatch(...args),
      dispatchAll: (...args: Parameters<IRpcEndpoint['dispatchAll']>) =>
        this.#requireAttachment().dispatchAll(...args),
      group: this.#group,
      outcome: this.#outcome
    })
  }
  /** Reject use before the canonical attachment has been prepared. */
  #requireAttachment = (): RpcOutboundAttachment => {
    if (!this.#attachment)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
    return this.#attachment
  }
  /** Resolve existing native target authority before reading caller group input. */
  #runtimeGeneration = (owner: RpcOutboundAttachment, targetId: string) => {
    /** Resolve before caller group capture, preserving the original unavailable error point. */
    const generation = owner.runtimeTargetGeneration(targetId)
    if (!generation)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    return generation
  }
  /** Dispatch the captured group through the original target generation and outbound owner. */
  #group: IRpcEndpoint['group'] = (targetId, steps, options) => {
    /** The installed attachment is the canonical outbound operation owner. */
    const owner = this.#requireAttachment()
    /** Directory admission precedes snapshot and option reads. */
    const generation = this.#runtimeGeneration(owner, targetId)
    return dispatchRuntimeGroup(
      owner,
      targetId,
      generation,
      captureRuntimeGroupSteps(steps),
      options
    )
  }
  /** Read a retained logical outcome from the original accepted target generation. */
  #outcome: IRpcEndpoint['outcome'] = (targetId, idempotencyKey) => {
    /** The key never grants rights to a target absent from the accepted directory. */
    const owner = this.#requireAttachment()
    return dispatchRuntimeOutcome(
      owner,
      targetId,
      this.#runtimeGeneration(owner, targetId),
      idempotencyKey
    )
  }
  /** Prepare the original canonical attachment once under the actual native installation scope. */
  #prepare = (scope: import('../typing.js').IRpcPluginInstallScope): IOutboundInstallation => {
    if (this.#installation) return this.#installation
    this.#dependencies.canonicalChunk.prepare(scope)
    /** Read the original endpoint preparation before constructing this attachment. */
    const prepared = this.#core.featureExpose.getPrepared()
    this.#attachment = new RpcOutboundAttachment(
      this.#core.featureExpose.getKernel(),
      prepared,
      () => this.#resolver
    )
    scope.own(this.#attachment, () => this.#attachment!.dispose())
    registerEndpointDebugSnapshot(this.#attachment, () => this.#attachment!.debugSnapshot())
    /** Publish shared native ports over the same outbound owner and observation callback. */
    const ports = new OutboundSharedPorts(
      this.#attachment,
      this.#core.featureExpose.observeOutboundCommand
    ).value
    /** Publish only the selected Feature methods while retaining their original owner. */
    const publicSurface: IOutboundSurface = Object.freeze({
      send: <T>(...args: Parameters<IRpcEndpoint['send']>) => this.#attachment!.send<T>(...args),
      sendAll: <T>(...args: Parameters<IRpcEndpoint['sendAll']>) =>
        this.#attachment!.sendAll<T>(...args),
      dispatch: (...args: Parameters<IRpcEndpoint['dispatch']>) =>
        this.#attachment!.dispatch(...args),
      dispatchAll: (...args: Parameters<IRpcEndpoint['dispatchAll']>) =>
        this.#attachment!.dispatchAll(...args),
      group: this.#group,
      outcome: this.#outcome,
      hooks: this.#attachment!.hooks
    })
    registerEndpointDebugSnapshot(publicSurface, () => this.#attachment!.debugSnapshot())
    this.#installation = Object.freeze({
      public: publicSurface,
      inboundIdentity: ports[RpcPortName.inboundIdentity] as IRpcInboundIdentityPort,
      outboundOperations: ports[RpcPortName.outboundOperations] as IRpcOutboundOperationsPort,
      variationCoordinator: ports[RpcPortName.variationCoordinator] as IRpcVariationCoordinatorPort,
      activate: () => this.#attachment!.activate()
    })
    return this.#installation
  }
  /** Publish only ports whose original native preparation has completed. */
  #ports = (): Readonly<Record<PropertyKey, unknown>> =>
    new OutboundSharedPorts(
      this.#requireAttachment(),
      this.#core.featureExpose.observeOutboundCommand
    ).value
}

/** Creates the native outbound Feature; allocation waits for endpoint-capabilities installation. */
export const createOutboundFeature = (
  canonicalChunk: ReturnType<typeof createCanonicalChunkFeature>
): IRpcFeature<
  IOutboundCapability,
  { readonly canonicalChunk: ReturnType<typeof createCanonicalChunkFeature> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IOutboundCapability,
    { readonly canonicalChunk: ReturnType<typeof createCanonicalChunkFeature> },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: [
        'send',
        'sendAll',
        'dispatch',
        'dispatchAll',
        RpcRuntimeMode.group,
        RpcRuntimeMode.outcome
      ],
      claims: {
        routes: ['response', 'variation', RpcRuntimeKind.control, RpcRuntimeKind.outcome],
        provides: ['inbound-identity', 'variation-coordinator'],
        consumes: [],
        publicKeys: [
          'send',
          'sendAll',
          'dispatch',
          'dispatchAll',
          RpcRuntimeMode.group,
          RpcRuntimeMode.outcome
        ],
        exposedKeys: [],
        activator: false
      }
    },
    (core, dependencies) => new OutboundFeatureInstallation(core, dependencies).value,
    { canonicalChunk }
  )

/** Publishes the original narrow outbound ports from the canonical attachment owner. */
/** Own the canonical outbound attachment's narrow identity, variation and command ports. */
class OutboundSharedPorts {
  /** The original attachment remains the sole runtime, transport and variation owner. */
  #owner: RpcOutboundAttachment
  /** A native admission observer sees the exact original command/result without granting authority. */
  #observeOutboundCommand: ((observation: IRpcOutboundCommandObservation) => void) | undefined
  /**
   * Frozen port records preserve the original own fields and callable identities for this
   * projection.
   */
  readonly value: Readonly<Record<PropertyKey, unknown>>
  /** Capture the original operation owner before publishing any narrow port. */
  constructor(
    owner: RpcOutboundAttachment,
    observeOutboundCommand?: (observation: IRpcOutboundCommandObservation) => void
  ) {
    this.#owner = owner
    this.#observeOutboundCommand = observeOutboundCommand
    this.value = Object.freeze({
      [RpcPortName.inboundIdentity]: Object.freeze({
        verify: this.#verify
      } satisfies IRpcInboundIdentityPort),
      [RpcPortName.variationCoordinator]: Object.freeze({
        admit: this.#admit
      } satisfies IRpcVariationCoordinatorPort),
      [RpcPortName.outboundOperations]: Object.freeze({
        ...(this.#owner.defaultGenerate === undefined
          ? {}
          : { defaultGenerate: this.#owner.defaultGenerate }),
        send: this.#send as IRpcOutboundSend,
        onTransportFailure: (listener: (error: unknown) => void) =>
          this.#owner.onTransportFailure(listener),
        noteUnknownField: (connection: string, kind: string, pointer: string, field: string) =>
          this.#owner.noteUnknownField(connection, kind, pointer, field)
      } satisfies IRpcOutboundOperationsPort)
    })
  }
  /** Delegate each identity operation to the original admission, retention or release owner. */
  #verify: IRpcInboundIdentityPort['verify'] = (command: IRpcIdentityCommand) => {
    if (command.operation === 'admit') return this.#owner.inboundIdentity.admit(command.request)
    if (command.operation === 'retain') return this.#owner.inboundIdentity.retain(command.token)
    this.#owner.inboundIdentity.release(command.token)
  }
  /** Route each variation operation to the existing canonical variation coordinator. */
  #admit: IRpcVariationCoordinatorPort['admit'] = (value: IRpcVariationAdmissionRequest) => {
    if (value.operation === 'register')
      return this.#owner.variations.register(value.variation, value.handler)
    if (value.operation === 'consumeAbort')
      return this.#owner.variations.consumeAbort(value.key, value.association)
    if (value.operation === 'abort')
      return this.#owner.variations.abort(
        value.key,
        value.controller,
        value.expiresAt,
        value.reason
      )
    return undefined
  }
  /**
   * Observe a physical command result while containing reporter failure in the existing error
   * channel.
   */
  #observe(command: IRpcOutboundCommand, result: void | Promise<void>, error?: unknown): void {
    /** Preserve the original diagnostic callback's unbound receiver. */
    const observeOutboundCommand = this.#observeOutboundCommand
    if (!observeOutboundCommand) return
    try {
      observeOutboundCommand(
        Object.freeze({ command, result, ...(error === undefined ? {} : { error }) })
      )
    } catch (observerError) {
      this.#owner.emitFailure(observerError, RpcCoreErrorCode.internal)
    }
  }
  /** Dispatch each admitted command without replacing the original return or thrown reason. */
  #send = (command: IRpcOutboundCommand): Promise<void> | void => {
    try {
      if (command.kind === 'response' || command.kind === 'frame') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.sendFrame(command.message, command.transfer, command.admission)
        this.#observe(command, result)
        return result
      }
      if (command.kind === 'stream-open') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.sendStreamOpen(command)
        this.#observe(command, result)
        return result
      }
      if (command.kind === 'dispatch') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.dispatch(command.targetId, command.method, command.data)
        this.#observe(command, result)
        return result
      }
      if (command.kind === 'one-way') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.sendOneWay(command.targetId, command.method, command.data, {
          transfer: command.transfer,
          signal: command.signal,
          timeoutMs: command.timeoutMs
        })
        this.#observe(command, result)
        return result
      }
      if (command.kind === 'validate') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.validate(command.method, command.side, command.data)
        this.#observe(command, result)
        return result
      }
      if (command.kind === 'diagnostic') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.emitDiagnostic(command.event)
        this.#observe(command, result)
        return result
      }
      if (command.kind === 'report') {
        /**
         * Retain the original operation receipt so observation runs before returning the same
         * result.
         */
        const result = this.#owner.emitFailure(
          command.error,
          command.code,
          command.field,
          command.detail
        )
        this.#observe(command, result)
        return result
      }
      return undefined
    } catch (error) {
      this.#observe(command, undefined, error)
      throw error
    }
  }
}
