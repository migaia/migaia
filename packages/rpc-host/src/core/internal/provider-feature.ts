import type { IFeatureCore } from '@migaia/plugin-host'
import { createRpcError, RpcCoreErrorCode } from '../errors.js'

import { RpcCoreErrorText } from '../error-text.js'
import { RpcPortName } from './plugin-shared-keys.js'
import { RpcProviderAttachment } from './provider-attachment.js'
import type { IProviderAdmissionScope } from './provider-admission.js'
import { registerEndpointDebugSnapshot } from './test-observer.js'
import type { IRpcEventListener, IRpcProvider } from '../typing.js'
import type { IRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from './endpoint-capabilities-plugin.js'
import { defineRpcFeature } from './define-rpc-feature.js'
import { RpcRuntimeKind } from '@migaia/rpc-contract/framing/v1'
import type {
  IOutboundCapability,
  IProviderCapability,
  IProviderInstallation
} from './feature-contract.js'

/** Native projection owns only provider registration; composition contributes outbound separately. */
export type IProviderRegistrationSurface = Readonly<{
  /** Register one unique request method and return this registration view. */
  readonly provide: (method: string, provider: IRpcProvider) => IProviderRegistrationSurface
  /** Subscribe to notification delivery and return this exact registration's remover. */
  readonly on: (event: string, listener: IRpcEventListener) => () => void
}>

/** Own one native provider Feature's preparation and port publication. */
class ProviderFeatureInstallation {
  /** This exact native Feature core lends canonical endpoint capabilities during preparation. */
  #core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>
  /** Dependency outputs are the original native registration outputs, never copied assemblies. */
  #dependencies: { readonly outbound: IOutboundCapability }
  /** The canonical attachment alone owns this installation's runtime resources. */
  #attachment: RpcProviderAttachment | undefined
  /** The first prepared installation is returned by identity on every later call. */
  #installation: IProviderInstallation | undefined
  /** The receiving Host lends its original cross-session provider admission scope. */
  #admission: IProviderAdmissionScope | undefined
  /** The actual native registration decides whether held provider work may execute. */
  #commitPolicy: (() => boolean) | undefined
  /** The frozen capability keeps the original own methods and detached-call behavior. */
  readonly value: IProviderCapability
  /** Capture the receiving native registration before any attachment resources are acquired. */
  constructor(
    core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>,
    dependencies: { readonly outbound: IOutboundCapability },
    admission: IProviderAdmissionScope | undefined,
    commitPolicy: (() => boolean) | undefined
  ) {
    this.#core = core
    this.#dependencies = dependencies
    this.#admission = admission
    this.#commitPolicy = commitPolicy
    this.value = Object.freeze({ prepare: this.#prepare, ports: this.#ports })
  }
  /** Prepare the original canonical attachment once under the actual native installation scope. */
  #prepare = (scope: import('../typing.js').IRpcPluginInstallScope): IProviderInstallation => {
    if (this.#installation) return this.#installation
    /** Prepare the canonical outbound dependency before publishing any dependent surface. */
    const outbound = this.#dependencies.outbound.prepare(scope)
    this.#attachment = new RpcProviderAttachment(
      this.#core.featureExpose.getKernel(),
      {
        outboundOperations: outbound.outboundOperations,
        inboundIdentity: outbound.inboundIdentity,
        variationCoordinator: outbound.variationCoordinator
      },
      this.#core.featureExpose.getPrepared(),
      this.#admission,
      this.#commitPolicy
    )
    scope.own(this.#attachment, () => this.#attachment!.dispose())
    /** Keep the canonical provider attachment as the registration and execution owner. */
    const provider = this.#attachment
    const publicSurface: IProviderRegistrationSurface & {
      readonly on: (event: string, listener: IRpcEventListener) => () => void
    } = Object.freeze({
      provide: (method: string, value: IRpcProvider) => {
        provider.provide(method, value)
        return publicSurface
      },
      on: (event: string, listener: IRpcEventListener) => provider.on(event, listener)
    })
    registerEndpointDebugSnapshot(publicSurface, () => this.#attachment!.debugSnapshot())
    const preparedInstallation: IProviderInstallation = Object.freeze({
      public: publicSurface,
      registerStream: (method, handler) => provider.provideStream(method, handler)
    })
    this.#installation = preparedInstallation
    return preparedInstallation
  }
  /** Publish only ports whose original native preparation has completed. */
  #ports = (): Readonly<Record<PropertyKey, unknown>> => {
    if (!this.#attachment)
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.endpointModuleDependencyMissing
      )
    return Object.freeze({
      [RpcPortName.providerCancellation]: Object.freeze({
        abort: (id: string) => this.#attachment!.abort(id)
      })
    })
  }
}

/** Package assembly alone can borrow the final provider's original cross-session admission owner. */
export const createProviderFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>,
  admission?: IProviderAdmissionScope,
  /** Actual held Host registration determines whether this policy has committed. */
  commitPolicy?: () => boolean
): IRpcFeature<
  IProviderCapability,
  { readonly outbound: IRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IProviderCapability,
    { readonly outbound: IRpcFeature<IOutboundCapability> },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: ['provide'],
      claims: {
        routes: ['request', RpcRuntimeKind.call, RpcRuntimeKind.group],
        provides: [],
        consumes: ['inbound-identity', 'variation-coordinator'],
        publicKeys: ['provide'],
        exposedKeys: ['provide'],
        activator: false
      }
    },
    (core, dependencies) =>
      new ProviderFeatureInstallation(core, dependencies, admission, commitPolicy).value,
    { outbound: outboundCapability }
  )
