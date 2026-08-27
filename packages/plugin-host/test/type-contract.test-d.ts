import type { IPlugin, PluginHost } from '../src/index'

type IContractA = IPlugin<{}, { aExtension: string }, { aConfig: number }, { aShared: boolean }> & {
  readonly name: 'a'
}
type IContractB = IPlugin<{}, { bExtension: string }, { bConfig: string }, { bShared: Date }> & {
  readonly name: 'b'
}

declare const contractHost: PluginHost<{}>
declare const contractA: IContractA
declare const contractB: IContractB

const accumulatedContract = async (): Promise<void> => {
  const appA = await contractHost.use(contractA)
  const appAB = await appA.use(contractB)
  void appAB.extensions.aExtension
  void appAB.extensions.bExtension
  appAB.getShared('aShared')
  appAB.getShared('bShared')
  appAB.getShared('optional-plugin-feature')
  await appAB.config.update('a', (previous) => ({ aConfig: previous.aConfig + 1 }))
  await appAB.config.update('b', (previous) => ({ bConfig: previous.bConfig.toUpperCase() }))
  appAB.config.get('a.aConfig')
  // @ts-expect-error onDispose belongs only to plugin lifecycle core.
  appAB.onDispose(() => undefined)
}

type IRequiredCore = { adminOnly(): void }
declare const adminPlugin: IPlugin<IRequiredCore>
declare const restrictedHost: PluginHost<{}>

// @ts-expect-error Host must reject plugins requiring capabilities it does not provide.
restrictedHost.use(adminPlugin)

void accumulatedContract
