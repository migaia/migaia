/** Admit cold RPC configuration, then create its one native plugin-host and namespace projections. */
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { readRpcDefinition } from '../sdk/metadata.ts'
import { RpcFlowProgram } from '../sdk/flow-program.ts'
import { RpcHost } from './rpc-host.ts'
import type { IRpcHostPlugin } from '../sdk/types.ts'
import { HostErrorText } from './error-text.ts'
import type { IRpcHost, IRpcHostOptions } from './public.ts'

/** Validate all transport namespaces before any definition can acquire a physical resource. */
export function createRpcHost<
  TRemote = Record<never, never>,
  const TPlugins extends readonly IRpcHostPlugin[] = readonly IRpcHostPlugin[]
>(options: IRpcHostOptions<TPlugins>): Promise<IRpcHost<TRemote, TPlugins>> {
  /** The plugin list is read once; a throwing getter or revoked Proxy is HOST_PLUGIN_INVALID. */
  let plugins: readonly IRpcHostPlugin[]
  try {
    plugins = options.plugins
    if (!Array.isArray(plugins))
      throw tagRpcError(
        new TypeError(HostErrorText.pluginInvalid),
        RpcCoreErrorCode.hostPluginInvalid
      )
  } catch (cause) {
    if (cause instanceof TypeError && cause.message === HostErrorText.pluginInvalid) throw cause
    throw tagRpcError(
      new TypeError(HostErrorText.pluginInvalid, { cause }),
      RpcCoreErrorCode.hostPluginInvalid
    )
  }
  /** The exact native definitions alone carry SDK registration identity. */
  const namespaces = new Map<string, IRpcHostPlugin>()
  /** Fixed intervention stages must be installed before any transport in this cold native batch. */
  const flows: IRpcHostPlugin[] = []
  for (const plugin of plugins) {
    /** Configuration copies and public discriminator fields cannot impersonate SDK definitions. */
    const metadata = readRpcDefinition(plugin)
    if (!metadata)
      throw tagRpcError(
        new TypeError(HostErrorText.pluginInvalid),
        RpcCoreErrorCode.hostPluginInvalid
      )
    if (metadata.kind !== 'transport') {
      flows.push(plugin)
      continue
    }
    if (namespaces.has(metadata.definition.namespace))
      throw tagRpcError(
        new TypeError(HostErrorText.namespaceDuplicate),
        RpcCoreErrorCode.hostNamespaceDuplicate
      )
    namespaces.set(metadata.definition.namespace, plugin)
  }
  if (namespaces.size === 0)
    throw tagRpcError(
      new TypeError(HostErrorText.transportMissing),
      RpcCoreErrorCode.hostTransportMissing
    )
  /** Invalid local Feature placement is rejected before Root subscribes to an external signal. */
  const program = new RpcFlowProgram([...flows, ...namespaces.values()])
  return new RpcHost(options).open(program) as unknown as Promise<IRpcHost<TRemote, TPlugins>>
}
