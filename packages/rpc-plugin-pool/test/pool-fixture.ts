import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  defineFeaturePlugin,
  defineTransportPlugin,
  createAdapterDeployment,
  type IRpcHostMember,
  type IRpcFeaturePlugin,
  type IRpcHostAssembleContext,
  type IRpcFeaturePluginDefinition
} from '@migaia/rpc-host/plugin'
import { readRpcPluginMetadata } from '../../rpc-host/dist/plugin/metadata.js'
import type { IPoolPluginOptions, IRpcPoolControls } from '../dist/index.js'
import * as pool from '../dist/index.js'

/** The actual root is read at runtime so entry-red evidence never uses a source-only factory. */
export const poolPlugin = Reflect.get(pool, 'poolPlugin') as (
  options: IPoolPluginOptions
) => IRpcFeaturePlugin & Readonly<{ controls(host: IRpcHost<unknown>): IRpcPoolControls }>

/** Observe or substitute only the existing authoring callback, without changing production. */
export function assemblyFeature(
  plugin: IRpcFeaturePlugin,
  openMember: (context: IRpcHostAssembleContext) => Promise<IRpcHostMember>
): IRpcFeaturePlugin {
  /** The original registered definition retains the factory's own scheduler/control closure. */
  const metadata = readRpcPluginMetadata(plugin)!
  if (metadata.kind !== 'feature' || !metadata.definition.assemble)
    throw new Error('pool fixture requires registered assembly')
  const definition: IRpcFeaturePluginDefinition = metadata.definition
  return defineFeaturePlugin({
    ...definition,
    assemble: (context) =>
      definition.assemble!({ ...context, openMember: () => openMember(context) })
  })
}

/** This cold test carrier must never open when an assembler supplies its SDK member operation. */
export function unusedTransport(
  mode: 'spawn' | 'connect' | 'listen' | 'connect-to-parent' = 'connect',
  open = async (): Promise<never> => {
    throw new Error('unexpected fixture source opening')
  }
) {
  return defineTransportPlugin({
    name: 'scheduler-source',
    mode,
    deployment: createAdapterDeployment({ open })
  })
}

/** Capture real accepted member receipts without replacing raw sources or native supervision. */
export function observingPool(plugin: IRpcFeaturePlugin, members: IRpcHostMember[]) {
  return assemblyFeature(plugin, async (context) => {
    const member = await context.openMember()
    members.push(member)
    return member
  })
}

/** Open a real RPC facade while changing only the established SDK openMember authoring boundary. */
export async function schedulingHost(
  options: IPoolPluginOptions,
  openMember: (context: IRpcHostAssembleContext) => Promise<IRpcHostMember>
) {
  const plugin = poolPlugin(options)
  const host = await createRpcHost({
    plugins: [unusedTransport(), assemblyFeature(plugin, openMember)]
  })
  return { host, controls: plugin.controls(host) }
}
