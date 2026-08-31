import {
  definePlugin,
  setupHost,
  type IPlugin,
  type IPluginHostCompositionIntegration,
  type IPluginHostOptions,
  PluginHost
} from '../src/index.js'

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

const compositionIntegration: IPluginHostCompositionIntegration<typeof contractHost> = contractHost
void compositionIntegration.createPluginAdmission(contractA)
void compositionIntegration.createDataOrderSlot('a')
void compositionIntegration.getCurrentView()
void compositionIntegration.revision

// @ts-expect-error Host must reject plugins requiring capabilities it does not provide.
restrictedHost.use(adminPlugin)

void accumulatedContract

type ISetupCore = { readonly value: number }
const setupPlugin = definePlugin<ISetupCore, { readonly doubled: number }, number>({
  name: 'setup',
  install: (core) => {
    core.usePipeline((value, next) => next(value + 1))
    return { doubled: core.value * 2 }
  }
})
const setupHostOptions = {
  host: {
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  } satisfies IPluginHostOptions,
  setupTimeoutMs: false,
  core: () => ({ value: 1 }),
  plugins: [setupPlugin] as const
} as const

const setupTypeContract = async (): Promise<void> => {
  const setupView = await setupHost<ISetupCore, readonly [typeof setupPlugin], number>(
    setupHostOptions
  )
  void setupView.extensions.doubled
  setupView.host.usePipeline((value, next) => next(value + 1))
  setupView.host.useAsyncPipeline(async (value, next) => next(value + 1))
  setupView.host.useGeneratorPipeline(function* (value) {
    yield value + 1
    return undefined
  })
  setupView.host.useAsyncGeneratorPipeline(async function* (value) {
    yield value + 1
    return undefined
  })
  // @ts-expect-error setupHost exposes one ordered `plugins` tuple, not a second async queue.
  setupHost({ ...setupHostOptions, asyncPlugins: [setupPlugin] })
}

const emptySetupTypeContract = async (): Promise<void> => {
  const setupView = await setupHost<ISetupCore>({
    host: setupHostOptions.host,
    setupTimeoutMs: false,
    core: setupHostOptions.core
  })
  setupView.config.get('missing')
}

void setupTypeContract
void emptySetupTypeContract
