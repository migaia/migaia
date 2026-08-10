import { PluginHost } from '@migai/plugin-host';
import { WebRpcEndpoint } from './endpoint';
import { WebRpcError, WebRpcErrorCode } from './errors';
import type { IWebRpcEndpoint, IWebRpcFactoryConfig, IWebRpcMiddleware } from './typing';

class WebRpcPluginHost extends PluginHost<object> {}

export async function createEndpoint<TTargetId extends string = string>(
  config: IWebRpcFactoryConfig<TTargetId>
): Promise<IWebRpcEndpoint<TTargetId>> {
  if (!config || typeof config.id !== 'string' || config.id.length === 0)
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'id must be a non-empty string');
  if (!Array.isArray(config.middlewares))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'middlewares must be an array');
  const names = new Set<string>();
  for (const middleware of config.middlewares) {
    if (names.has(middleware.name))
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        `Duplicate middleware: ${middleware.name}`
      );
    names.add(middleware.name);
  }
  if (!names.has('connect'))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect middleware is required');
  const middleware = config.middlewares.find((item) => item.name === 'connect') as
    | IWebRpcMiddleware
    | undefined;
  const transport = config.transport ?? middleware?.transport;
  if (!transport)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect middleware must provide transport'
    );
  const host = new WebRpcPluginHost();
  const contractMiddleware = config.middlewares.find((item) => item.name === 'contract');
  const uuidMiddleware = config.middlewares.find((item) => item.name === 'uuid');
  const protocolMiddleware = config.middlewares.find((item) => item.name === 'protocol');
  const timeoutMiddleware = config.middlewares.find((item) => item.name === 'timeout');
  const hooksMiddleware = config.middlewares.find((item) => item.name === 'hooks');
  const chunkMiddleware = config.middlewares.find((item) => item.name === 'chunk');
  const connectMiddleware = config.middlewares.find((item) => item.name === 'connect');
  const endpoint = new WebRpcEndpoint<TTargetId>(
    config.id,
    transport,
    config.provider,
    contractMiddleware?.contract,
    uuidMiddleware?.uuid,
    protocolMiddleware?.protocol,
    timeoutMiddleware?.timeout,
    hooksMiddleware?.hooks,
    chunkMiddleware?.chunk,
    config.targetIds,
    connectMiddleware?.connect
  );
  const disposers: (() => void | Promise<void>)[] = [];
  try {
    for (const item of config.middlewares) {
      const result = await item.install({ id: config.id, transport, hooks: () => undefined });
      if (typeof result === 'function') disposers.push(result);
    }
    return endpoint;
  } catch (error) {
    await endpoint.dispose();
    await host.dispose();
    throw error;
  }
}
