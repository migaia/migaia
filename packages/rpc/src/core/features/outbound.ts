import { RpcOutboundAttachment } from '../internal/outbound-attachment.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
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
  RpcPortName,
  type IRpcDiscoveryResolverPort,
  type IRpcInboundIdentityPort,
  type IRpcIdentityCommand,
  type IRpcOutboundOperationsPort,
  type IRpcResponseOutboundCommand,
  type IRpcSynchronousOutboundCommand,
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
  'send' | 'sendAll' | 'dispatch' | 'dispatchAll' | 'hooks'
>

/** Creates the native outbound Feature; allocation waits for endpoint-capabilities installation. */
export const createOutboundFeature = (
  canonicalChunk: ReturnType<typeof createCanonicalChunkFeature>
): IRpcFeature<
  IOutboundCapability,
  { readonly canonicalChunk: ReturnType<typeof createCanonicalChunkFeature> },
  IEndpointCapabilitiesFeatureExpose
> =>
  (() => {
    const feature = defineRpcFeature<
      IOutboundCapability,
      { readonly canonicalChunk: ReturnType<typeof createCanonicalChunkFeature> },
      IEndpointCapabilitiesFeatureExpose
    >(
      {
        publicKeys: ['send', 'sendAll', 'dispatch', 'dispatchAll'],
        claims: {
          routes: ['response', 'variation'],
          provides: ['inbound-identity', 'variation-coordinator'],
          consumes: [],
          publicKeys: ['send', 'sendAll', 'dispatch', 'dispatchAll'],
          exposedKeys: [],
          activator: false
        }
      },
      (core, dependencies) => {
        let attachment: RpcOutboundAttachment | undefined
        let resolver: IRpcDiscoveryResolverPort | undefined
        let installation: IOutboundInstallation | undefined
        const requireAttachment = (): RpcOutboundAttachment => {
          if (!attachment)
            throw new RpcError(
              RpcCoreErrorCode.invalidConfig,
              RpcCoreErrorText.endpointModuleInvalid
            )
          return attachment
        }
        const prepare = (
          scope: import('../typing.js').IRpcPluginInstallScope
        ): IOutboundInstallation => {
          if (installation) return installation
          dependencies.canonicalChunk.prepare(scope)
          const prepared = core.featureExpose.getPrepared()
          attachment = new RpcOutboundAttachment(
            core.featureExpose.getKernel(),
            prepared,
            () => resolver
          )
          scope.own(attachment, () => attachment!.dispose())
          registerEndpointDebugSnapshot(attachment, () => attachment!.debugSnapshot())
          const ports = createOutboundSharedPorts(
            attachment,
            core.featureExpose.observeOutboundCommand
          )
          const publicSurface: IOutboundSurface = Object.freeze({
            send: <T>(...args: Parameters<IRpcEndpoint['send']>) => attachment!.send<T>(...args),
            sendAll: <T>(...args: Parameters<IRpcEndpoint['sendAll']>) =>
              attachment!.sendAll<T>(...args),
            dispatch: (...args: Parameters<IRpcEndpoint['dispatch']>) =>
              attachment!.dispatch(...args),
            dispatchAll: (...args: Parameters<IRpcEndpoint['dispatchAll']>) =>
              attachment!.dispatchAll(...args),
            hooks: attachment!.hooks
          })
          registerEndpointDebugSnapshot(publicSurface, () => attachment!.debugSnapshot())
          installation = Object.freeze({
            public: publicSurface,
            inboundIdentity: ports[RpcPortName.inboundIdentity] as IRpcInboundIdentityPort,
            outboundOperations: ports[RpcPortName.outboundOperations] as IRpcOutboundOperationsPort,
            variationCoordinator: ports[
              RpcPortName.variationCoordinator
            ] as IRpcVariationCoordinatorPort,
            activate: () => attachment!.activate()
          })
          return installation
        }
        const ports = (): Readonly<Record<PropertyKey, unknown>> =>
          createOutboundSharedPorts(requireAttachment(), core.featureExpose.observeOutboundCommand)
        return Object.freeze({
          prepare,
          activate: () => requireAttachment().activate(),
          ports,
          getHooks: () => requireAttachment().hooks,
          connectResolver: (port: IRpcDiscoveryResolverPort) => {
            resolver = port
          },
          send: <T>(...args: Parameters<IRpcEndpoint['send']>) =>
            requireAttachment().send<T>(...args),
          sendAll: <T>(...args: Parameters<IRpcEndpoint['sendAll']>) =>
            requireAttachment().sendAll<T>(...args),
          dispatch: (...args: Parameters<IRpcEndpoint['dispatch']>) =>
            requireAttachment().dispatch(...args),
          dispatchAll: (...args: Parameters<IRpcEndpoint['dispatchAll']>) =>
            requireAttachment().dispatchAll(...args)
        })
      },
      { canonicalChunk }
    )
    return feature
  })()

/** Publishes the original narrow outbound ports from the canonical attachment owner. */
function createOutboundSharedPorts(
  owner: RpcOutboundAttachment,
  observeOutboundCommand?: (observation: IRpcOutboundCommandObservation) => void
): Readonly<Record<PropertyKey, unknown>> {
  const verify: IRpcInboundIdentityPort['verify'] = (command: IRpcIdentityCommand) => {
    if (command.operation === 'admit') return owner.inboundIdentity.admit(command.request)
    if (command.operation === 'retain') return owner.inboundIdentity.retain(command.token)
    owner.inboundIdentity.release(command.token)
  }
  const admit: IRpcVariationCoordinatorPort['admit'] = (value: IRpcVariationAdmissionRequest) => {
    if (value.operation === 'register')
      return owner.variations.register(value.variation, value.handler)
    if (value.operation === 'consumeAbort') return owner.variations.consumeAbort(value.key)
    if (value.operation === 'abort')
      return owner.variations.abort(value.key, value.controller, value.expiresAt, value.reason)
    return undefined
  }
  function send(command: IRpcResponseOutboundCommand): Promise<void>
  function send(command: IRpcSynchronousOutboundCommand): void
  function send(command: IRpcOutboundCommand): Promise<void> | void {
    const observe = (result: void | Promise<void>, error?: unknown): void => {
      if (!observeOutboundCommand) return
      try {
        observeOutboundCommand(
          Object.freeze({ command, result, ...(error === undefined ? {} : { error }) })
        )
      } catch (observerError) {
        owner.emitFailure(observerError, RpcCoreErrorCode.internal)
      }
    }
    try {
      if (command.kind === 'response' || command.kind === 'frame') {
        const result = owner.sendFrame(command.message, command.transfer)
        observe(result)
        return result
      }
      if (command.kind === 'dispatch') {
        const result = owner.dispatch(command.targetId, command.method, command.data)
        observe(result)
        return result
      }
      if (command.kind === 'one-way') {
        const result = owner.sendOneWay(command.targetId, command.method, command.data, {
          transfer: command.transfer
        })
        observe(result)
        return result
      }
      if (command.kind === 'validate') {
        const result = owner.validate(command.method, command.side, command.data)
        observe(result)
        return result
      }
      if (command.kind === 'diagnostic') {
        const result = owner.emitDiagnostic(command.event)
        observe(result)
        return result
      }
      if (command.kind === 'report') {
        const result = owner.emitFailure(command.error, command.code, command.field)
        observe(result)
        return result
      }
      return undefined
    } catch (error) {
      observe(undefined, error)
      throw error
    }
  }
  return Object.freeze({
    [RpcPortName.inboundIdentity]: Object.freeze({
      verify
    } satisfies IRpcInboundIdentityPort),
    [RpcPortName.variationCoordinator]: Object.freeze({
      admit
    } satisfies IRpcVariationCoordinatorPort),
    [RpcPortName.outboundOperations]: Object.freeze({
      send: send as IRpcOutboundSend
    } satisfies IRpcOutboundOperationsPort)
  })
}
