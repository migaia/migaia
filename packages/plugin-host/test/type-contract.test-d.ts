import {
  definePlugin,
  defineFeature,
  setupHost,
  type IPlugin,
  type IPluginHostCompositionIntegration,
  type IPluginHostOptions,
  type IPluginRegistrationReceipt,
  PluginHost
} from '../src/index.js'

const featureTypeDependency = defineFeature(() => ({ read: () => 1 }))
// @ts-expect-error Feature factories are synchronous; only returned methods may be async.
defineFeature(async () => ({ invalid: true }))
const featureTypeRoot = defineFeature(
  (_core: { readonly featureExpose: { readonly value: () => string } }, dependencies) => ({
    value: () => `${dependencies.dependency.read()}`
  }),
  { dependency: featureTypeDependency }
)
const featureTypePlugin = definePlugin(
  'feature-type',
  (core) => ({
    featureExpose: () => ({ value: () => 'typed' }),
    install: () => ({ result: core.config.get().toString })
  }),
  { root: featureTypeRoot }
)
void featureTypePlugin

const typedFeature = defineFeature<
  { readonly required: () => number },
  Record<never, never>,
  { readonly output: () => number }
>((core) => ({ output: core.featureExpose.required }))
definePlugin({
  name: 'typed-options',
  features: { typed: typedFeature },
  featureExpose: { required: () => 1 },
  config: { retries: 1 },
  install: (core) => {
    core.features.typed.output()
    core.featureExpose.required()
    return {}
  },
  shared: (core) => {
    core.features.typed.output()
    return {}
  },
  update: (_next, core) => {
    core.features.typed.output()
  }
})
// @ts-expect-error required expose is enforced for selected Feature roots.
definePlugin({
  name: 'missing-expose',
  install: () => ({}),
  features: { typed: typedFeature },
  featureExpose: {}
})
// @ts-expect-error object declarations enforce the same selected Feature expose requirement.
definePlugin({
  name: 'object-missing-expose',
  features: { typed: typedFeature },
  featureExpose: {},
  install: () => ({})
})
const transitiveFeature = defineFeature<
  { readonly transitive: () => string },
  Record<never, never>,
  { readonly read: () => string }
>((core) => ({ read: core.featureExpose.transitive }))
const selectedTransitiveFeature = defineFeature<
  Record<never, never>,
  { readonly transitive: typeof transitiveFeature },
  { readonly read: () => string }
>((_core, dependencies) => ({ read: dependencies.transitive.read }), {
  transitive: transitiveFeature
})
// @ts-expect-error direct roots retain transitive expose requirements.
definePlugin({
  name: 'missing-transitive-expose',
  install: () => ({}),
  features: { selected: selectedTransitiveFeature },
  featureExpose: {}
})
definePlugin({
  name: 'typed-object-feature',
  features: { typed: typedFeature },
  featureExpose: { required: () => 1 },
  config: { label: 'object' },
  shared: (core) => ({ value: core.features.typed.output() }),
  install: (core) => ({ value: core.featureExpose.required() }),
  update: (next, core) => {
    const label: string = next.label
    core.features.typed.output()
    void label
  }
})
import {
  createView,
  type IRegistrationToken,
  type IRegistrationView
} from '../src/composition-entry.js'

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

const descriptorTypePlugin = definePlugin('descriptor-type', (core) => {
  core.getShared('optional')
  return {
    install: () => ({ installed: 1 }),
    expose: () => ({ exposed: 'public' })
  }
})

const descriptorTypeContract = async (): Promise<void> => {
  const view = await restrictedHost.use(descriptorTypePlugin)
  const installed: number = view.extensions.installed
  const exposed: string = view.extensions.exposed
  void installed
  void exposed
}

const compositionIntegration: IPluginHostCompositionIntegration<typeof contractHost> = contractHost
void compositionIntegration.createPluginAdmission(contractA)
void compositionIntegration.createDataOrderSlot('a')
void compositionIntegration.getCurrentView()
void compositionIntegration.revision

declare const legacyToken: IPluginRegistrationReceipt<IContractA>
declare const canonicalToken: IRegistrationToken<IContractA>
const canonicalFromLegacy: IRegistrationToken<IContractA> = legacyToken
const legacyFromCanonical: IPluginRegistrationReceipt<IContractA> = canonicalToken
const canonicalView: IRegistrationView<IContractA> = createView(canonicalToken)
void canonicalFromLegacy
void legacyFromCanonical
void canonicalView.extensions.aExtension

// @ts-expect-error Host must reject plugins requiring capabilities it does not provide.
restrictedHost.use(adminPlugin)

void accumulatedContract
void descriptorTypeContract

const coreBoundDescriptor = definePlugin<
  { readonly domain: number },
  { readonly domainValue: number },
  never,
  'core-bound'
>('core-bound', (core) => ({ install: () => ({ domainValue: core.domain }) }))
declare const corelessHost: PluginHost<Record<string, never>>
declare const corefulHost: PluginHost<{ readonly domain: number }>
// @ts-expect-error root Host use retains the descriptor core requirement.
await corelessHost.use(coreBoundDescriptor)
const corefulView = await corefulHost.use(coreBoundDescriptor)
// @ts-expect-error accumulated view use retains the descriptor core requirement.
await contractHost.getCurrentView().use(coreBoundDescriptor)
// @ts-expect-error dynamic view use retains the descriptor core requirement.
await corelessHost.getCurrentView().use(coreBoundDescriptor)
const validSetup = await setupHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  setupTimeoutMs: false,
  core: () => ({ domain: 1 }),
  plugins: [coreBoundDescriptor] as const
})
void validSetup.extensions.domainValue
await setupHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  setupTimeoutMs: false,
  core: () => ({}),
  // @ts-expect-error setup initial tuple retains the descriptor core requirement.
  plugins: [coreBoundDescriptor] as const
})
const corelessSetup = await setupHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  setupTimeoutMs: false,
  core: () => ({})
})
// @ts-expect-error setup host use retains the descriptor core requirement.
await corelessSetup.host.use(coreBoundDescriptor)
// @ts-expect-error setup view use retains the descriptor core requirement.
await corelessSetup.use(coreBoundDescriptor)
void corefulView

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
