import { WebRpcCanonicalChunkAttachment } from '../internal/canonical-chunk-attachment.js'
import { defineFeature, type IWebRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import type { IWebRpcPluginInstallScope } from '../typing.js'

/** Creates the native chunk Feature with the existing attachment and root ResourceScope owner. */
export const createCanonicalChunkFeature = (): IWebRpcFeature<
  Readonly<{
    readonly prepare: (scope: IWebRpcPluginInstallScope) => WebRpcCanonicalChunkAttachment
  }>,
  Record<never, never>,
  IEndpointCapabilitiesFeatureExpose
> =>
  defineFeature<
    Readonly<{
      readonly prepare: (scope: IWebRpcPluginInstallScope) => WebRpcCanonicalChunkAttachment
    }>,
    Record<never, never>,
    IEndpointCapabilitiesFeatureExpose
  >({
    publicKeys: [],
    install: (core) => {
      /** Defers attachment allocation to the endpoint-capabilities Plugin installation stage. */
      let attachment: WebRpcCanonicalChunkAttachment | undefined
      const prepare = (scope: IWebRpcPluginInstallScope): WebRpcCanonicalChunkAttachment => {
        if (attachment) return attachment
        const prepared = core.featureExpose.getPrepared()
        const created = new WebRpcCanonicalChunkAttachment(
          core.featureExpose.getKernel(),
          prepared.options.components?.framer
        )
        scope.own(created, () => created.dispose())
        attachment = created
        return created
      }
      return Object.freeze({ prepare })
    }
  })
