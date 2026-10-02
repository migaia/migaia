import { registerJsonObjectDescriptorMiddleware } from '../internal/json-object-port.js'
import type { IRpcFrameAcceptResult, IRpcFramer } from '../../contract/index.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcPlugin, IRpcPluginInstallResult } from '../typing.js'

/**
 * Structural framer floor preserves a concrete descriptor's input and frame union through plugin
 * typing.
 */
type IFramerDescriptor = Omit<IRpcFramer<unknown, unknown, string, number>, 'frame' | 'accept'> & {
  readonly frame: (...args: never[]) => readonly unknown[]
  readonly accept: (...args: never[]) => IRpcFrameAcceptResult<unknown>
}

/** Creates a framing-owned plugin; framing remains independent of semantic envelopes and codecs. */
export function framer<TDescriptor extends IFramerDescriptor>(
  descriptor: TDescriptor
): IRpcPlugin<{ readonly framer: TDescriptor }> {
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    typeof descriptor.frame !== 'function' ||
    typeof descriptor.accept !== 'function'
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.framerDescriptorInvalid)
  return registerJsonObjectDescriptorMiddleware(
    Object.freeze({
      name: 'framer',
      framer: descriptor,
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
        extension: Object.freeze({ framer: descriptor }),
        ports: Object.freeze({})
      })
    }),
    descriptor
  )
}
