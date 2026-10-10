import { registerJsonObjectFeature } from '../internal/json-object-port.js'
import { RpcCanonicalChunkAttachment } from '../internal/canonical-chunk-attachment.js'
import { defineFeature, type IRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import type { IRpcPluginInstallScope } from '../typing.js'

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
      install: (core) => {
        /** Defers attachment allocation to the endpoint-capabilities Plugin installation stage. */
        let attachment: RpcCanonicalChunkAttachment | undefined
        const prepare = (scope: IRpcPluginInstallScope): RpcCanonicalChunkAttachment => {
          if (attachment) return attachment
          const prepared = core.featureExpose.getPrepared()
          const created = new RpcCanonicalChunkAttachment(
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
  )
