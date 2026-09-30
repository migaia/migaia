import { RpcMiddlewareErrorText } from './error-text.js'
import { RpcPlatform } from '../transport-constants.js'
import type {
  IRpcConnectCapability,
  IRpcConnectConfig,
  IRpcDiscoveryMode,
  IRpcPlugin
} from '../typing.js'
import type { IRpcTransport } from '../transport.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { safeRead } from '../internal/safe-value.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'

export type IConnectConfig = IRpcConnectConfig
export type IConnectMiddleware<TMode extends IRpcDiscoveryMode> = IRpcPlugin & {
  readonly discoveryMode: TMode
}

/** Creates one native connect plugin with discovery and transport metadata on its descriptor. */
export const connect = <TMode extends IRpcDiscoveryMode = 'automatic'>(
  config: IConnectConfig & { readonly discoveryMode?: TMode } = {}
): IConnectMiddleware<TMode> => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    const plugin = invalidConnectPlugin('connect descriptor is invalid')
    return freezePlugin({
      ...plugin,
      discoveryMode: 'automatic' as TMode
    }) as IConnectMiddleware<TMode>
  }
  let configuredTransport: IRpcTransport | undefined
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
  const plugin: IRpcPlugin = {
    name: 'connect',
    discoveryMode: (configuredDiscoveryMode ?? 'automatic') as TMode,
    transport: configuredTransport,
    metadata: {
      claims: emptyClaims(),
      sharedProvides: [RpcPortName.connect]
    },
    install: ({ id, transport }) => {
      try {
        return {
          extension: {},
          ports: {
            [RpcPortName.connect]: createConnectCapability(
              id,
              transport,
              configuredIdentifier,
              configuredBaseMode,
              configuredUniqueTargetId,
              configuredDiscoveryMode,
              configuredReceiverSelector
            )
          }
        }
      } catch (cause) {
        if (cause instanceof RpcError) throw cause
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcCoreErrorText.transportDescriptorInvalid,
          cause
        )
      }
    }
  }
  return freezePlugin(plugin) as IConnectMiddleware<TMode>
}

/** Validates one frozen connect snapshot and creates its complete typed shared port. */
function createConnectCapability(
  id: string,
  transport: IRpcTransport,
  identifier: IConnectConfig['identifier'],
  useBaseIdVerifyOnly: IConnectConfig['useBaseIdVerifyOnly'],
  uniqueTargetId: IConnectConfig['uniqueTargetId'],
  configuredDiscoveryMode: IConnectConfig['discoveryMode'],
  receiverSelector: IConnectConfig['receiverSelector']
): IRpcConnectCapability {
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
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.transportTopologyIsInvalid
    )
  if (discoveryMode !== 'automatic' && discoveryMode !== 'manual')
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectDiscoveryModeIsInvalid
    )
  if (receiverSelector !== undefined && typeof receiverSelector !== 'function')
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectReceiverSelectorMustBeAFunction
    )
  if (useBaseIdVerifyOnly === false && !identifier)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectIdentifierIsRequiredWhenBaseVerificationIsDisabled
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
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectTransportIsRequired
    )
  const transportSend = safeRead<unknown>(transport, 'send')
  const transportSubscribe = safeRead<unknown>(transport, 'subscribe')
  if (typeof transportSend !== 'function' || typeof transportSubscribe !== 'function')
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectTransportMustProvideSendAndSubscribeFunctions
    )
  if (useBaseIdVerifyOnly !== undefined && typeof useBaseIdVerifyOnly !== 'boolean')
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectUseBaseIdVerifyOnlyMustBeABoolean
    )
  if (identifier !== undefined && typeof identifier !== 'function')
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.connectIdentifierMustBeAFunction
    )
  const transportPeerId = safeRead<unknown>(transport, 'peerId')
  const transportOrigin = safeRead<unknown>(transport, 'origin')
  if (
    (transportPeerId !== undefined && typeof transportPeerId !== 'string') ||
    (transportOrigin !== undefined && typeof transportOrigin !== 'string')
  )
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.transportIdentityDescriptorInvalid
    )
  const capability: IRpcConnectCapability = {
    identifier,
    useBaseIdVerifyOnly,
    uniqueTargetId: effectiveUniqueTargetId,
    uniqueTargetIdFactory,
    discoveryMode,
    receiverSelector,
    transport,
    verify: async (context, reportRead) => {
      const peerId = context.peerId ?? (transportPeerId as string | undefined)
      const peerIdentity = Boolean(peerId) && context.senderId === peerId
      const originIdentity = transportOrigin !== undefined && context.origin === transportOrigin
      const identifierSource =
        useBaseIdVerifyOnly === false &&
        ((context.source !== undefined && context.source !== null) ||
          safeRead(context.data, '__unique_id__', reportRead) !== undefined)
      const anonymousBroadcast =
        context.platform === RpcPlatform.broadcastChannel &&
        peerId === undefined &&
        context.source == null
      const exclusiveBinding =
        (transportTopology === 'exclusive' ||
          (transportTopology === undefined &&
            context.platform !== undefined &&
            context.platform !== RpcPlatform.worker &&
            context.platform !== RpcPlatform.broadcastChannel &&
            context.platform !== RpcPlatform.iframe)) &&
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
function emptyClaims(): IRpcPlugin['metadata']['claims'] {
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
function invalidConnectPlugin(message: string, cause?: unknown): IRpcPlugin {
  return {
    name: 'connect',
    metadata: {
      claims: emptyClaims(),
      sharedProvides: [RpcPortName.connect]
    },
    install: () => {
      throw new RpcError(RpcCoreErrorCode.invalidConfig, message, cause)
    }
  }
}
