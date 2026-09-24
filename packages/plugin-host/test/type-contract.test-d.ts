import {
  createView,
  openComposition,
  type IPluginHostCompositionIntegration,
  type IRegistrationToken,
  type IRegistrationView
} from '../src/composition-entry.js'
import {
  defineFeature,
  definePlugin,
  type IPlugin,
  type IPluginRegistrationReceipt,
  PluginHost
} from '../src/index.js'

const dependency = defineFeature(() => ({ read: () => 1 }))
// @ts-expect-error Feature factories are synchronous; returned methods may be async instead.
defineFeature(async () => ({ invalid: true }))
const root = defineFeature(
  (core: { readonly featureExpose: { readonly value: () => string } }, dependencies) => ({
    value: () => `${core.featureExpose.value()}:${dependencies.dependency.read()}`
  }),
  { dependency }
)
const plugin = definePlugin({
  name: 'typed',
  features: { root },
  featureExpose: { value: () => 'typed' },
  config: { retries: 1 },
  install: (core) => ({ result: core.features.root.value() }),
  update: (next, core) => {
    const retries: number = next.retries
    core.features.root.value()
    void retries
  }
})

// @ts-expect-error Selected Feature roots enforce their required expose surface.
definePlugin({ name: 'missing-expose', features: { root }, featureExpose: {}, install: () => ({}) })

declare const host: PluginHost<Record<string, never>>
const [handle] = await host.use(plugin)
const result: string = handle.extensions.result
const output: string = handle.getFeature('root').value()
const retries: number = handle.config.get().retries
await handle.config.update((previous) => ({ retries: previous.retries + 1 }))
void result
void output
void retries
// @ts-expect-error Plugin handles never expose Host mutation methods.
handle.use(plugin)
// @ts-expect-error Public Plugin/Host surfaces do not expose retired shared state.
host.getShared('retired')

type IRequiredCore = { adminOnly(): void }
declare const adminPlugin: IPlugin<IRequiredCore>
declare const restrictedHost: PluginHost<Record<string, never>>
// @ts-expect-error Host rejects plugins requiring domain capabilities it does not provide.
await restrictedHost.use(adminPlugin)

const composition: IPluginHostCompositionIntegration<object> = openComposition(host)
void composition.createPluginAdmission(plugin)
void composition.createDataOrderSlot('typed')
void composition.getCurrentSnapshot()
void composition.revision

declare const legacyToken: IPluginRegistrationReceipt<typeof plugin>
declare const canonicalToken: IRegistrationToken<typeof plugin>
const canonicalFromLegacy: IRegistrationToken<typeof plugin> = legacyToken
const legacyFromCanonical: IPluginRegistrationReceipt<typeof plugin> = canonicalToken
const canonicalView: IRegistrationView<typeof plugin> = createView(canonicalToken)
void canonicalFromLegacy
void legacyFromCanonical
void canonicalView.extensions.result

const coreBound = definePlugin<
  { readonly domain: number },
  { readonly domainValue: number },
  never,
  'core-bound'
>('core-bound', (core) => ({ install: () => ({ domainValue: core.domain }) }))
declare const corefulHost: PluginHost<{ readonly domain: number }>
// @ts-expect-error Root Host use retains the descriptor core requirement.
await restrictedHost.use(coreBound)
const [corefulHandle] = await corefulHost.use(coreBound)
const domainValue: number = corefulHandle.extensions.domainValue
void domainValue
