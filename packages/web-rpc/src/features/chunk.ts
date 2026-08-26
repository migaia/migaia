import { defineEndpointModule, EndpointModuleKey } from '../internal/endpoint-modules.js'
import { WebRpcChunkAttachment } from '../internal/chunk-attachment.js'
import type { IWebRpcInboundIdentityPort, IWebRpcTimePort } from '../internal/plugin-shared-keys.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
import { outbound } from './outbound.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from '../core.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IInboundIdentityPort } from '../internal/inbound-identity.js'

/** Chunk contributes framing behavior but no feature-specific public method. */
export type IChunkSurface = IWebRpcKernelSurface

/** Static chunk feature token. */
const chunkModule = defineEndpointModule<IWebRpcCoreConfig, IChunkSurface>(
  EndpointModuleKey.chunk,
  async ({ kernel, prepared, getShared }) => {
    const inboundIdentity = getShared(WebRpcSharedKey.inboundIdentity) as
      | IWebRpcInboundIdentityPort
      | undefined
    const time = getShared(WebRpcSharedKey.time) as IWebRpcTimePort | undefined
    if (!inboundIdentity || !time)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        WebRpcErrorText.endpointModuleDependencyMissing
      )
    const identity: IInboundIdentityPort = {
      admit: async (request) => {
        const admission = await inboundIdentity.verify({ operation: 'admit', request })
        return typeof admission === 'object' && admission !== null && 'token' in admission
          ? admission
          : undefined
      },
      retain: (token) => inboundIdentity.verify({ operation: 'retain', token }) === true,
      release: (token) => {
        inboundIdentity.verify({ operation: 'release', token })
      },
      clear: () => undefined
    }
    const attachment = new WebRpcChunkAttachment(kernel, prepared, identity, time)
    return Object.freeze({ dispose: () => attachment.dispose() }) as IChunkSurface
  },
  [outbound()],
  [],
  {
    routes: ['chunk'],
    consumes: ['inbound-identity'],
    sharedConsumes: [WebRpcSharedKey.inboundIdentity, WebRpcSharedKey.time]
  }
)
export function chunk() {
  return chunkModule
}
