import {
  openComposition,
  type IPluginHostCompositionIntegration
} from '../src/composition-entry.js'
import {
  definePlugin,
  defineFeature,
  type IPlugin,
  type IExcludePluginByName,
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

/** Type-level removal keeps the other installed extension while dropping the named one. */
declare const reducedContract: IExcludePluginByName<[IContractA, IContractB], 'a'>
void reducedContract[0].name

declare const enablementHost: PluginHost<{}, never, [IContractA, IContractB]>
const enablementTypeContract = async (): Promise<void> => {
  const { token, view: reduced } = await enablementHost.plugin.disable('a')
  // @ts-expect-error The disabled plugin is absent from the reduced view tuple.
  void reduced.extensions.aExtension
  const remaining: string = reduced.extensions.bExtension
  const restored = await token.enable()
  const original: string = restored.extensions.aExtension
  const stillInstalled = await enablementHost.plugin.disable('b')
  void stillInstalled.token
  void remaining
  void original
}
void enablementTypeContract

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

// 托管协议不再是 Host 实例的结构子集：它经 `openComposition` 取得，因此这里断言的是出口的形状，
// 而不是「宿主碰巧长得像出口」。
const compositionIntegration: IPluginHostCompositionIntegration<object> =
  openComposition(contractHost)
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
void corefulView
