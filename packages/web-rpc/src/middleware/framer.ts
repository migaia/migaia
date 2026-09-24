import type { IRpcFrameAcceptResult, IRpcFramer } from '@migaia/rpc-contract'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcPlugin, IWebRpcPluginInstallResult } from '../typing.js'

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
): IWebRpcPlugin<{ readonly framer: TDescriptor }> {
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    typeof descriptor.frame !== 'function' ||
    typeof descriptor.accept !== 'function'
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.framerDescriptorInvalid)
  return Object.freeze({
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
    install: (): IWebRpcPluginInstallResult => ({
      extension: Object.freeze({ framer: descriptor }),
      ports: Object.freeze({})
    })
  })
}
