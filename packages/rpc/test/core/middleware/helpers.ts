import type {
  IRpcPlugin,
  IRpcPluginInstallResult,
  IRpcPluginInstallScope
} from '../../../src/core/typing.js'
import { RpcPortName } from '../../../src/core/internal/plugin-shared-keys.js'

/** Builds the host-neutral install scope used by direct native-plugin unit tests. */
export function pluginScope(
  transport: IRpcPluginInstallScope['transport'] = {
    platform: 'Memory',
    send() {},
    subscribe: () => () => undefined
  }
): IRpcPluginInstallScope {
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
  plugin: IRpcPlugin,
  transport?: IRpcPluginInstallScope['transport']
): Map<string, unknown> {
  const result = plugin.install(pluginScope(transport))
  if (result instanceof Promise) throw new Error('test plugin must install synchronously')
  const values = new Map<string, unknown>()
  const shared = (result as IRpcPluginInstallResult).ports
  const names = new Map<PropertyKey, string>([
    [RpcPortName.protocol, 'protocolCapability'],
    [RpcPortName.contract, 'contractCapability'],
    [RpcPortName.authentication, 'authenticationCapability'],
    [RpcPortName.connect, 'connectCapability'],
    [RpcPortName.timeout, 'timeoutCapability'],
    [RpcPortName.abort, 'abortCapability'],
    [RpcPortName.hooks, 'hooks'],
    [RpcPortName.ping, 'pingCapability'],
    [RpcPortName.uuid, 'uuid']
  ])
  for (const key of Reflect.ownKeys(shared)) {
    const name = names.get(key)
    if (name) values.set(name, shared[key])
  }
  return values
}
