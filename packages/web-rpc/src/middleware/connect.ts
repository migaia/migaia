import type {
  IWebRpcConnectCapability,
  IWebRpcConnectConfig,
  IWebRpcDiscoveryMode,
  IWebRpcPlugin
} from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { safeRead } from '../internal/safe-value.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'

export type IConnectConfig = IWebRpcConnectConfig
export type IConnectMiddleware<TMode extends IWebRpcDiscoveryMode> = IWebRpcPlugin & {
  readonly discoveryMode: TMode
}

/** Creates one native connect plugin with discovery and transport metadata on its descriptor. */
export const connect = <TMode extends IWebRpcDiscoveryMode = 'automatic'>(
  config: IConnectConfig & { readonly discoveryMode?: TMode } = {}
): IConnectMiddleware<TMode> => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    const plugin = invalidConnectPlugin('connect descriptor is invalid')
    return freezePlugin({
      ...plugin,
      discoveryMode: 'automatic' as TMode
    }) as IConnectMiddleware<TMode>
  }
  let configuredTransport: IWebRpcTransport | undefined
  let configuredIdentifier: IConnectConfig['identifier']
  let configuredBaseMode: IConnectConfig['useBaseIdVerifyOnly']
  let configuredUniqueTargetId: IConnectConfig['uniqueTargetId']
  let configuredDiscoveryMode: IConnectConfig['discoveryMode']
  let configuredReceiverSelector: IConnectConfig['receiverSelector']
  try {
    configuredTransport = config.transport
    configuredIdentifier = config.identifier
    configuredBaseMode = config.useBaseIdVerifyOnly
    configuredUniqueTargetId = config.uniqueTargetId
    configuredDiscoveryMode = config.discoveryMode
    configuredReceiverSelector = config.receiverSelector
  } catch (error) {
    const plugin = invalidConnectPlugin('connect descriptor is unreadable', error)
    return freezePlugin({
      ...plugin,
      discoveryMode: 'automatic' as TMode
    }) as IConnectMiddleware<TMode>
  }
  const plugin: IWebRpcPlugin = {
    name: 'connect',
    discoveryMode: (configuredDiscoveryMode ?? 'automatic') as TMode,
    transport: configuredTransport,
    metadata: {
      claims: emptyClaims(),
      sharedProvides: [WebRpcPortName.connect]
    },
    install: ({ id, transport }) => ({
      extension: {},
      ports: {
        [WebRpcPortName.connect]: createConnectCapability(
          id,
          transport,
          configuredIdentifier,
          configuredBaseMode,
          configuredUniqueTargetId,
          configuredDiscoveryMode,
          configuredReceiverSelector
        )
      }
    })
  }
  return freezePlugin(plugin) as IConnectMiddleware<TMode>
}

/** Validates one frozen connect snapshot and creates its complete typed shared port. */
function createConnectCapability(
  id: string,
  transport: IWebRpcTransport,
  identifier: IConnectConfig['identifier'],
  useBaseIdVerifyOnly: IConnectConfig['useBaseIdVerifyOnly'],
  uniqueTargetId: IConnectConfig['uniqueTargetId'],
  configuredDiscoveryMode: IConnectConfig['discoveryMode'],
  receiverSelector: IConnectConfig['receiverSelector']
): IWebRpcConnectCapability {
  const discoveryMode = configuredDiscoveryMode ?? 'automatic'
  const transportTopology = safeRead<'exclusive' | 'multiplexed' | 'broadcast'>(
    transport,
    'topology'
  )
  if (
    transportTopology !== undefined &&
    transportTopology !== 'exclusive' &&
    transportTopology !== 'multiplexed' &&
    transportTopology !== 'broadcast'
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport topology is invalid')
  if (discoveryMode !== 'automatic' && discoveryMode !== 'manual')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect.discoveryMode is invalid')
  if (receiverSelector !== undefined && typeof receiverSelector !== 'function')
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect.receiverSelector must be a function'
    )
  if (useBaseIdVerifyOnly === false && !identifier)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect identifier is required when base verification is disabled'
    )
  const effectiveUniqueTargetId =
    typeof uniqueTargetId === 'string' &&
    uniqueTargetId.length > 0 &&
    useBaseIdVerifyOnly === false &&
    typeof identifier === 'function'
      ? uniqueTargetId
      : undefined
  const uniqueTargetIdFactory =
    typeof uniqueTargetId === 'function' &&
    useBaseIdVerifyOnly === false &&
    typeof identifier === 'function'
      ? uniqueTargetId
      : undefined
  if (!transport || (typeof transport !== 'object' && typeof transport !== 'function'))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect transport is required')
  const transportSend = safeRead<unknown>(transport, 'send')
  const transportSubscribe = safeRead<unknown>(transport, 'subscribe')
  if (typeof transportSend !== 'function' || typeof transportSubscribe !== 'function')
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect transport must provide send and subscribe functions'
    )
  if (useBaseIdVerifyOnly !== undefined && typeof useBaseIdVerifyOnly !== 'boolean')
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect.useBaseIdVerifyOnly must be a boolean'
    )
  if (identifier !== undefined && typeof identifier !== 'function')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect identifier must be a function')
  const transportPeerId = safeRead<unknown>(transport, 'peerId')
  const transportOrigin = safeRead<unknown>(transport, 'origin')
  if (
    (transportPeerId !== undefined && typeof transportPeerId !== 'string') ||
    (transportOrigin !== undefined && typeof transportOrigin !== 'string')
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport identity descriptor is invalid')
  const capability: IWebRpcConnectCapability = {
    identifier,
    useBaseIdVerifyOnly,
    uniqueTargetId: effectiveUniqueTargetId,
    uniqueTargetIdFactory,
    discoveryMode,
    receiverSelector,
    transport,
    verify: async (context) => {
      const peerId = context.peerId ?? (transportPeerId as string | undefined)
      const peerIdentity = Boolean(peerId) && context.senderId === peerId
      const originIdentity = transportOrigin !== undefined && context.origin === transportOrigin
      const identifierSource =
        useBaseIdVerifyOnly === false &&
        ((context.source !== undefined && context.source !== null) ||
          safeRead(context.data, '__unique_id__') !== undefined)
      const anonymousBroadcast =
        context.platform === 'BroadcastChannel' && peerId === undefined && context.source == null
      const exclusiveBinding =
        (transportTopology === 'exclusive' ||
          (transportTopology === undefined &&
            context.platform !== undefined &&
            context.platform !== 'Worker' &&
            context.platform !== 'BroadcastChannel' &&
            context.platform !== 'Iframe')) &&
        context.targetId === id
      const baseVerified =
        context.targetId === id &&
        (exclusiveBinding ||
          peerIdentity ||
          originIdentity ||
          identifierSource ||
          anonymousBroadcast)
      if (!baseVerified) return false
      if (useBaseIdVerifyOnly !== false) return true
      return Boolean(await identifier?.(context))
    }
  }
  return Object.freeze(capability)
}

/** Builds the fixed empty static claim set used by middleware plugins. */
function emptyClaims(): IWebRpcPlugin['metadata']['claims'] {
  return {
    routes: [],
    provides: [],
    consumes: [],
    publicKeys: [],
    exposedKeys: [],
    activator: false
  }
}

/** Builds an invalid native plugin while preserving the factory's deferred error timing. */
function invalidConnectPlugin(message: string, cause?: unknown): IWebRpcPlugin {
  return {
    name: 'connect',
    metadata: {
      claims: emptyClaims(),
      sharedProvides: [WebRpcPortName.connect]
    },
    install: () => {
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, message, cause)
    }
  }
}
