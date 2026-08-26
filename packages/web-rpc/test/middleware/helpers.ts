import type {
  IWebRpcPlugin,
  IWebRpcPluginInstallResult,
  IWebRpcPluginInstallScope
} from '../../src/typing.js'
import { WebRpcSharedKey } from '../../src/internal/plugin-shared-keys.js'

/** Builds the host-neutral install scope used by direct native-plugin unit tests. */
export function pluginScope(
  transport: IWebRpcPluginInstallScope['transport'] = {
    platform: 'Memory',
    send() {},
    subscribe: () => () => undefined
  }
): IWebRpcPluginInstallScope {
  return {
    id: 'a',
    transport,
    signal: { aborted: false, addEventListener() {}, removeEventListener() {} },
    hooks: () => undefined,
    getShared: () => undefined,
    own: <T>(resource: T): T => resource
  }
}

/** Installs a synchronous native plugin and projects its symbol ports for legacy assertions. */
export function installPlugin(
  plugin: IWebRpcPlugin,
  transport?: IWebRpcPluginInstallScope['transport']
): Map<string, unknown> {
  const result = plugin.install(pluginScope(transport))
  if (result instanceof Promise) throw new Error('test plugin must install synchronously')
  const values = new Map<string, unknown>()
  const shared = (result as IWebRpcPluginInstallResult).shared
  const names = new Map<PropertyKey, string>([
    [WebRpcSharedKey.protocol, 'protocolCapability'],
    [WebRpcSharedKey.contract, 'contractCapability'],
    [WebRpcSharedKey.authentication, 'authenticationCapability'],
    [WebRpcSharedKey.connect, 'connectCapability'],
    [WebRpcSharedKey.timeout, 'timeoutCapability'],
    [WebRpcSharedKey.abort, 'abortCapability'],
    [WebRpcSharedKey.hooks, 'hooks'],
    [WebRpcSharedKey.ping, 'pingCapability'],
    [WebRpcSharedKey.uuid, 'uuid'],
    [WebRpcSharedKey.chunk, 'chunkCapability']
  ])
  for (const key of Reflect.ownKeys(shared)) {
    const name = names.get(key)
    if (name) values.set(name, shared[key])
  }
  return values
}
