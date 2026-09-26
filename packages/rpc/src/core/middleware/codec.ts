import type { ICodec } from '@migaia/serialize/codec'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcPlugin, IRpcPluginInstallResult } from '../typing.js'

/** Structural codec floor preserves a concrete descriptor's callable variance through plugin typing. */
type ICodecDescriptor = Omit<ICodec<unknown, unknown>, 'encode' | 'decode'> & {
  readonly encode: (...args: never[]) => unknown
  readonly decode: (...args: never[]) => unknown
}

/** Creates a format-owned codec plugin for consumers migrating off codec-shaped protocol(). */
export function codec<TDescriptor extends ICodecDescriptor>(
  descriptor: TDescriptor
): IRpcPlugin<{ readonly codec: TDescriptor }> {
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    typeof descriptor.encode !== 'function' ||
    typeof descriptor.decode !== 'function'
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.codecDescriptorInvalid)
  return Object.freeze({
    name: 'codec',
    codec: descriptor,
    metadata: Object.freeze({
      claims: Object.freeze({
        routes: [],
        provides: [],
        consumes: [],
        publicKeys: [],
        exposedKeys: [],
        activator: false
      })
    }),
    install: (): IRpcPluginInstallResult => ({
      extension: Object.freeze({ codec: descriptor }),
      ports: Object.freeze({})
    })
  })
}
