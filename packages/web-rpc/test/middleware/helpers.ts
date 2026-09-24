import type {
  IWebRpcPlugin,
  IWebRpcPluginInstallResult,
  IWebRpcPluginInstallScope
} from '../../src/typing.js'
import { WebRpcPortName } from '../../src/internal/plugin-shared-keys.js'

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
    getPort: () => undefined,
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
  const shared = (result as IWebRpcPluginInstallResult).ports
  const names = new Map<PropertyKey, string>([
    [WebRpcPortName.protocol, 'protocolCapability'],
    [WebRpcPortName.contract, 'contractCapability'],
    [WebRpcPortName.authentication, 'authenticationCapability'],
    [WebRpcPortName.connect, 'connectCapability'],
    [WebRpcPortName.timeout, 'timeoutCapability'],
    [WebRpcPortName.abort, 'abortCapability'],
    [WebRpcPortName.hooks, 'hooks'],
    [WebRpcPortName.ping, 'pingCapability'],
    [WebRpcPortName.uuid, 'uuid']
  ])
  for (const key of Reflect.ownKeys(shared)) {
    const name = names.get(key)
    if (name) values.set(name, shared[key])
  }
  return values
}
