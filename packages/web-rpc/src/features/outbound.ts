import { WebRpcOutboundAttachment } from '../internal/outbound-attachment.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { registerEndpointDebugSnapshot } from '../internal/test-observer.js'
import type { IWebRpcFeature } from '../feature.js'
import { createCanonicalChunkFeature } from './canonical-chunk.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import type {
  IOutboundCapability,
  IOutboundInstallation,
  IWebRpcOutboundCommandObservation
} from '../internal/feature-contract.js'
import type { IWebRpcEndpoint } from '../typing.js'
import {
  WebRpcSharedKey,
  type IWebRpcDiscoveryResolverPort,
  type IWebRpcInboundIdentityPort,
  type IWebRpcIdentityCommand,
  type IWebRpcOutboundOperationsPort,
  type IWebRpcResponseOutboundCommand,
  type IWebRpcSynchronousOutboundCommand,
  type IWebRpcOutboundCommand,
  type IWebRpcOutboundSend,
  type IWebRpcVariationAdmissionRequest,
  type IWebRpcVariationCoordinatorPort
} from '../internal/plugin-shared-keys.js'

/**
 * Static outbound feature token; outbound behavior remains owned by the canonical endpoint
 * pipeline.
 */
export type IOutboundSurface = Pick<
  IWebRpcEndpoint,
  'send' | 'sendAll' | 'dispatch' | 'dispatchAll' | 'hooks'
>

/** Creates the native outbound Feature; allocation waits for endpoint-capabilities installation. */
export const createOutboundFeature = (
  canonicalChunk: ReturnType<typeof createCanonicalChunkFeature>
): IWebRpcFeature<
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
        let attachment: WebRpcOutboundAttachment | undefined
        let resolver: IWebRpcDiscoveryResolverPort | undefined
        let installation: IOutboundInstallation | undefined
        const requireAttachment = (): WebRpcOutboundAttachment => {
          if (!attachment)
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleInvalid
            )
          return attachment
        }
        const prepare = (
          scope: import('../typing.js').IWebRpcPluginInstallScope
        ): IOutboundInstallation => {
          if (installation) return installation
          dependencies.canonicalChunk.prepare(scope)
          const prepared = core.featureExpose.getPrepared()
          attachment = new WebRpcOutboundAttachment(
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
            send: <T>(...args: Parameters<IWebRpcEndpoint['send']>) => attachment!.send<T>(...args),
            sendAll: <T>(...args: Parameters<IWebRpcEndpoint['sendAll']>) =>
              attachment!.sendAll<T>(...args),
            dispatch: (...args: Parameters<IWebRpcEndpoint['dispatch']>) =>
              attachment!.dispatch(...args),
            dispatchAll: (...args: Parameters<IWebRpcEndpoint['dispatchAll']>) =>
              attachment!.dispatchAll(...args),
            hooks: attachment!.hooks
          })
          registerEndpointDebugSnapshot(publicSurface, () => attachment!.debugSnapshot())
          installation = Object.freeze({
            public: publicSurface,
            inboundIdentity: ports[WebRpcSharedKey.inboundIdentity] as IWebRpcInboundIdentityPort,
            outboundOperations: ports[
              WebRpcSharedKey.outboundOperations
            ] as IWebRpcOutboundOperationsPort,
            variationCoordinator: ports[
              WebRpcSharedKey.variationCoordinator
            ] as IWebRpcVariationCoordinatorPort,
            activate: () => attachment!.activate()
          })
          return installation
        }
        const shared = (): Readonly<Record<PropertyKey, unknown>> =>
          createOutboundSharedPorts(requireAttachment(), core.featureExpose.observeOutboundCommand)
        return Object.freeze({
          prepare,
          activate: () => requireAttachment().activate(),
          shared,
          getHooks: () => requireAttachment().hooks,
          connectResolver: (port: IWebRpcDiscoveryResolverPort) => {
            resolver = port
          },
          send: <T>(...args: Parameters<IWebRpcEndpoint['send']>) =>
            requireAttachment().send<T>(...args),
          sendAll: <T>(...args: Parameters<IWebRpcEndpoint['sendAll']>) =>
            requireAttachment().sendAll<T>(...args),
          dispatch: (...args: Parameters<IWebRpcEndpoint['dispatch']>) =>
            requireAttachment().dispatch(...args),
          dispatchAll: (...args: Parameters<IWebRpcEndpoint['dispatchAll']>) =>
            requireAttachment().dispatchAll(...args)
        })
      },
      { canonicalChunk }
    )
    return feature
  })()

/** Publishes the original narrow outbound ports from the canonical attachment owner. */
function createOutboundSharedPorts(
  owner: WebRpcOutboundAttachment,
  observeOutboundCommand?: (observation: IWebRpcOutboundCommandObservation) => void
): Readonly<Record<PropertyKey, unknown>> {
  const verify: IWebRpcInboundIdentityPort['verify'] = (command: IWebRpcIdentityCommand) => {
    if (command.operation === 'admit') return owner.inboundIdentity.admit(command.request)
    if (command.operation === 'retain') return owner.inboundIdentity.retain(command.token)
    owner.inboundIdentity.release(command.token)
  }
  const admit: IWebRpcVariationCoordinatorPort['admit'] = (
    value: IWebRpcVariationAdmissionRequest
  ) => {
    if (value.operation === 'register')
      return owner.variations.register(value.variation, value.handler)
    if (value.operation === 'consumeAbort') return owner.variations.consumeAbort(value.key)
    if (value.operation === 'abort')
      return owner.variations.abort(value.key, value.controller, value.expiresAt, value.reason)
    return undefined
  }
  function send(command: IWebRpcResponseOutboundCommand): Promise<void>
  function send(command: IWebRpcSynchronousOutboundCommand): void
  function send(command: IWebRpcOutboundCommand): Promise<void> | void {
    const observe = (result: void | Promise<void>, error?: unknown): void => {
      if (!observeOutboundCommand) return
      try {
        observeOutboundCommand(
          Object.freeze({ command, result, ...(error === undefined ? {} : { error }) })
        )
      } catch (observerError) {
        owner.emitFailure(observerError, WebRpcErrorCode.internal)
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
        const result = owner.emitFailure(command.error, command.code)
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
    [WebRpcSharedKey.inboundIdentity]: Object.freeze({
      verify
    } satisfies IWebRpcInboundIdentityPort),
    [WebRpcSharedKey.variationCoordinator]: Object.freeze({
      admit
    } satisfies IWebRpcVariationCoordinatorPort),
    [WebRpcSharedKey.outboundOperations]: Object.freeze({
      send: send as IWebRpcOutboundSend
    } satisfies IWebRpcOutboundOperationsPort)
  })
}
