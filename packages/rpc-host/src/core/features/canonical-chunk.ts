import type { IFeatureCore } from '@migaia/plugin-host'
import { registerJsonObjectFeature } from '../internal/json-object-port.js'
import { RpcCanonicalChunkAttachment } from '../internal/canonical-chunk-attachment.js'
import { defineFeature, type IRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import type { IRpcPluginInstallScope } from '../typing.js'

/** Own deferred construction of the one canonical chunk attachment for this native Feature. */
class CanonicalChunkFeatureInstallation {
  /** The actual Feature core supplies endpoint bootstrap and kernel ownership. */
  #core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>
  /** Repeated native preparation returns the original attachment by identity. */
  #attachment: RpcCanonicalChunkAttachment | undefined
  /** The original frozen one-method capability remains detached-call safe. */
  readonly value: Readonly<{
    readonly prepare: (scope: IRpcPluginInstallScope) => RpcCanonicalChunkAttachment
  }>
  /** Capture the native core without allocating attachment resources during token definition. */
  constructor(core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>) {
    this.#core = core
    this.value = Object.freeze({ prepare: this.#prepare })
  }
  /** Prepare once under the original construction scope and retain its exact release callback. */
  #prepare = (scope: IRpcPluginInstallScope): RpcCanonicalChunkAttachment => {
    if (this.#attachment) return this.#attachment
    /** The original bootstrap snapshot selects the same canonical framer. */
    const prepared = this.#core.featureExpose.getPrepared()
    /** Attachment lifecycle remains owned by the original scope, with no parallel queue. */
    const created = new RpcCanonicalChunkAttachment(
      this.#core.featureExpose.getKernel(),
      prepared.options.components?.framer
    )
    scope.own(created, () => created.dispose())
    this.#attachment = created
    return created
  }
}

/** Creates the native chunk Feature with the existing attachment and root ResourceScope owner. */
export const createCanonicalChunkFeature = (): IRpcFeature<
  Readonly<{
    readonly prepare: (scope: IRpcPluginInstallScope) => RpcCanonicalChunkAttachment
  }>,
  Record<never, never>,
  IEndpointCapabilitiesFeatureExpose
> =>
  registerJsonObjectFeature(
    defineFeature<
      Readonly<{
        readonly prepare: (scope: IRpcPluginInstallScope) => RpcCanonicalChunkAttachment
      }>,
      Record<never, never>,
      IEndpointCapabilitiesFeatureExpose
    >({
      publicKeys: [],
      install: (core) => new CanonicalChunkFeatureInstallation(core).value
    })
  )
