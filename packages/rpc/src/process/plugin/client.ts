import type { IProcessHandle } from '@migaia/supervision/process'
import { normalizeRemoteContract } from '../../remote/contract.js'
import { assembleRemotePluginDefinition } from '../../remote/internal/assemble-plugin.js'
import type { IRemotePluginDefinition } from '../../remote/plugin.js'
import { createConnectProcessBinding, createSpawnProcessBinding, invalidOption } from './binding.js'
import type { IProcessPluginOptions } from './types.js'

/** Adds one supervised process deployment to remote's single trusted PluginHost assembly. */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>
): IRemotePluginDefinition {
  const contract = normalizeRemoteContract(options.contract)
  if (options.name !== contract.plugin) invalidOption('name')
  if (options.deployment.kind === 'spawn') {
    const binding = createSpawnProcessBinding(options.deployment, options.report)
    return assembleRemotePluginDefinition({
      name: options.name,
      contract,
      host: options.host,
      binding,
      endpointFactory: options.endpointFactory,
      report: options.report,
      keyFactory: options.keyFactory,
      retryPort: options.retryPort
    })
  }
  const binding = createConnectProcessBinding(options.deployment, options.report)
  return assembleRemotePluginDefinition({
    name: options.name,
    contract,
    host: options.host,
    binding,
    endpointFactory: options.endpointFactory,
    report: options.report,
    keyFactory: options.keyFactory,
    retryPort: options.retryPort
  })
}
