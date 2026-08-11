import type {
  IWebRpcConnectCapability,
  IWebRpcMiddleware,
  IWebRpcConnectConfig,
  IWebRpcDiscoveryMode
} from '../typing';
import type { IWebRpcTransport } from '../transport';
import { WebRpcCapabilityKey } from '../internal/runtime';
import { WebRpcError, WebRpcErrorCode } from '../errors';
import { safeRead } from '../internal/safe-value';
export type IConnectConfig = IWebRpcConnectConfig;
export type IConnectMiddleware<TMode extends IWebRpcDiscoveryMode> = IWebRpcMiddleware & {
  readonly discoveryMode: TMode;
};
export const connect = <TMode extends IWebRpcDiscoveryMode = 'automatic'>(
  config: IConnectConfig & { readonly discoveryMode?: TMode } = {}
): IConnectMiddleware<TMode> => {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return {
      name: 'connect',
      discoveryMode: 'automatic' as TMode,
      install: () => {
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect descriptor is invalid');
      }
    };
  let configuredTransport: IWebRpcTransport | undefined;
  let configuredIdentifier: IConnectConfig['identifier'];
  let configuredBaseMode: IConnectConfig['useBaseIdVerifyOnly'];
  let configuredUniqueTargetId: IConnectConfig['uniqueTargetId'];
  let configuredDiscoveryMode: IConnectConfig['discoveryMode'];
  let configuredReceiverSelector: IConnectConfig['receiverSelector'];
  try {
    configuredTransport = config.transport;
    configuredIdentifier = config.identifier;
    configuredBaseMode = config.useBaseIdVerifyOnly;
    configuredUniqueTargetId = config.uniqueTargetId;
    configuredDiscoveryMode = config.discoveryMode;
    configuredReceiverSelector = config.receiverSelector;
  } catch (error) {
    return {
      name: 'connect',
      discoveryMode: 'automatic' as TMode,
      install: () => {
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect descriptor is unreadable',
          error
        );
      }
    };
  }
  return {
    name: 'connect',
    discoveryMode: (configuredDiscoveryMode ?? 'automatic') as TMode,
    transport: configuredTransport,
    install: ({ id, transport, capabilities }) => {
      const identifier = configuredIdentifier;
      const useBaseIdVerifyOnly = configuredBaseMode;
      const uniqueTargetId = configuredUniqueTargetId;
      const discoveryMode = configuredDiscoveryMode ?? 'automatic';
      const receiverSelector = configuredReceiverSelector;
      const transportTopology = safeRead<'exclusive' | 'multiplexed' | 'broadcast'>(
        transport,
        'topology'
      );
      if (
        transportTopology !== undefined &&
        transportTopology !== 'exclusive' &&
        transportTopology !== 'multiplexed' &&
        transportTopology !== 'broadcast'
      )
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport topology is invalid');
      if (discoveryMode !== 'automatic' && discoveryMode !== 'manual')
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect.discoveryMode is invalid');
      if (receiverSelector !== undefined && typeof receiverSelector !== 'function')
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect.receiverSelector must be a function'
        );
      if (configuredBaseMode === false && !identifier)
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect identifier is required when base verification is disabled'
        );
      const effectiveUniqueTargetId =
        typeof uniqueTargetId === 'string' &&
        uniqueTargetId.length > 0 &&
        useBaseIdVerifyOnly === false &&
        typeof identifier === 'function'
          ? uniqueTargetId
          : undefined;
      const uniqueTargetIdFactory =
        typeof uniqueTargetId === 'function' &&
        useBaseIdVerifyOnly === false &&
        typeof identifier === 'function'
          ? uniqueTargetId
          : undefined;
      if (!transport || (typeof transport !== 'object' && typeof transport !== 'function'))
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect transport is required');
      const transportSend = safeRead<unknown>(transport, 'send');
      const transportSubscribe = safeRead<unknown>(transport, 'subscribe');
      if (typeof transportSend !== 'function' || typeof transportSubscribe !== 'function')
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect transport must provide send and subscribe functions'
        );
      if (useBaseIdVerifyOnly !== undefined && typeof useBaseIdVerifyOnly !== 'boolean')
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect.useBaseIdVerifyOnly must be a boolean'
        );
      if (identifier !== undefined && typeof identifier !== 'function')
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect identifier must be a function'
        );
      const transportPeerId = safeRead<unknown>(transport, 'peerId');
      const transportOrigin = safeRead<unknown>(transport, 'origin');
      if (
        (transportPeerId !== undefined && typeof transportPeerId !== 'string') ||
        (transportOrigin !== undefined && typeof transportOrigin !== 'string')
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'transport identity descriptor is invalid'
        );
      const capability: IWebRpcConnectCapability = {
        identifier,
        useBaseIdVerifyOnly: configuredBaseMode,
        uniqueTargetId: effectiveUniqueTargetId,
        uniqueTargetIdFactory,
        discoveryMode,
        receiverSelector,
        transport,
        verify: async (context) => {
          const peerId = context.peerId ?? (transportPeerId as string | undefined);
          const peerIdentity = Boolean(peerId) && context.senderId === peerId;
          const originIdentity =
            transportOrigin !== undefined && context.origin === transportOrigin;
          const identifierSource =
            useBaseIdVerifyOnly === false &&
            ((context.source !== undefined && context.source !== null) ||
              safeRead(context.data, '__unique_id__') !== undefined);
          const anonymousBroadcast =
            context.platform === 'BroadcastChannel' &&
            peerId === undefined &&
            context.source == null;
          const exclusiveBinding =
            (transportTopology === 'exclusive' ||
              (transportTopology === undefined &&
                context.platform !== undefined &&
                context.platform !== 'Worker' &&
                context.platform !== 'BroadcastChannel' &&
                context.platform !== 'Iframe')) &&
            context.targetId === id;
          const baseVerified =
            context.targetId === id &&
            (exclusiveBinding ||
              peerIdentity ||
              originIdentity ||
              identifierSource ||
              anonymousBroadcast);
          if (!baseVerified) return false;
          if (useBaseIdVerifyOnly !== false) return true;
          return Boolean(await identifier?.(context));
        }
      };
      capabilities.set(WebRpcCapabilityKey.connect, capability);
      capabilities.set(WebRpcCapabilityKey.connectCapability, capability);
    }
  };
};
