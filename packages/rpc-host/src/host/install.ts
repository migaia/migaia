import type { IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcTransportPluginDefinition } from '../plugin/types.js'
import { readRpcInstallationPort } from './install-port.js'
import { installOrdinaryRpcTransport } from './install-ordinary.js'

/** Transport hooks alone acquire native sources and retain the heavy runtime assembly graph. */
export function installRpcTransport(
  core: IPluginHostCore,
  definition: IRpcTransportPluginDefinition
): Promise<Record<never, never>> {
  const port = readRpcInstallationPort(core)
  return port ? port.transport(core, definition) : installOrdinaryRpcTransport(core, definition)
}
