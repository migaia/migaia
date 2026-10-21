/**
 * Source-verified React 19 adapter reference, 2026-10-18. Provider generations follow ready-array
 * identity. Registry admission closes before owned callbacks and publishes stable async completion
 * for reentrancy. Cleanup failures retain native identity or original cause with their owning code.
 * Defaults remain readable application data; Provider/Registry never dispose the Runtime itself.
 */
import type {
  ICaseDoc,
  ILibraryReference,
  IMemberDoc,
  IOptionCaseDoc,
  ISymbolDoc,
  IText
} from './contract.js'
import { storeReactCases } from './store-react-cases.js'

/** Constructs one bilingual explanation. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Describes an instance operation with a concrete example. */
const method = (
  en: string,
  zh: string,
  params: Readonly<Record<string, IText>>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Token identity is created once by the public factory, never by matching its label. */
const token = t(
  'The exact IStoreToken returned by createStoreToken; reuse that object for registration and lookup. Equal debug names do not share identity.',
  '`createStoreToken` 返回的精确令牌；登记与查询复用同一对象，相同调试名不会共享身份。'
)
/** Feature paths name normalized flags rather than loading an implementation. */
const path = t(
  'wasm or experimental.<name>; select a flag explicitly declared by the application Provider configuration.',
  '选择应用提供者配置中显式声明的开关路径，取值为 `wasm` 或 `experimental.<name>`。'
)
/** Equality callback is a pure synchronous selector boundary. */
const equality = t(
  'Optional synchronous comparator receiving previous and next selector results; return true to reuse the prior snapshot. Defaults to Object.is; throws propagate.',
  '可选同步比较器接收先前与新的选择结果，返回 `true` 时复用快照；默认 `Object.is`，抛错传播。'
)
/** Source Runtime owns graph operations and stays caller-owned. */
const runtime = t(
  'IRuntime from @migaia/reactive that owns the source nodes; this adapter never disposes it.',
  '来自 `@migaia/reactive`、持有源节点的运行时，本适配器不会释放它。'
)
/** Protocol hook examples remain ordinary component functions. */
const storeExample = `import { createStore } from '@migaia/store-light'
import { useStore } from '@migaia/store-react'
const counter = createStore({ count: 0 })
function Counter() {
  const count = useStore(counter, state => state.count)
  return <button onClick={() => { counter.count += 1 }}>{count}</button>
}`
/** Provider definition example shows both read and write hooks under their required owner. */
const definitionExample = `import { atomDef } from '@migaia/store-keyed'
import { StoreProvider, useAtomDefinition, useSetAtomDefinition } from '@migaia/store-react'
const countDef = atomDef(0)
function Counter() {
  const count = useAtomDefinition(countDef)
  const setCount = useSetAtomDefinition(countDef)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
function App() { return <StoreProvider><Counter /></StoreProvider> }`
/** Registry use stays reversible and releases only its owned values. */
const registryExample = `const registry = createStoreRegistry()
const settingsToken = createStoreToken<{ theme: string }>('settings')
const unregister = registry.register(settingsToken, { theme: 'light' })
console.log(registry.require(settingsToken).theme)
unregister()
await registry.disposeAsync()`
/** Injection example registers before the consumer renders and uses the Registry runtime. */
const injectionExample = `import { Suspense } from 'react'
import { createStore } from '@migaia/store-light'
import { Resource } from '@migaia/resource'
import { StoreProvider, createStoreRegistry, createStoreToken, useProvidedStore, useStoreFromProvider, useResourceValue } from '@migaia/store-react'
const registry = createStoreRegistry()
const settings = createStore({ theme: 'light' }, { runtime: registry.runtime })
const settingsToken = createStoreToken<typeof settings>('settings')
registry.register(settingsToken, settings, { owned: true })
const profile = new Resource(async () => ({ name: 'Ada' }), registry.runtime)
const profileToken = createStoreToken<typeof profile>('profile')
registry.register(profileToken, profile, { owned: true })
function Theme() {
  const theme = useProvidedStore(settingsToken, state => state.theme)
  return <span>{theme}</span>
}
function Profile() {
  const profile = useResourceValue(useStoreFromProvider(profileToken))
  return <span>{profile.name}</span>
}
function App() { return <StoreProvider registry={registry}><Theme /><Suspense fallback={null}><Profile /></Suspense></StoreProvider> }
const application = { App, dispose: () => registry.disposeAsync() }`
/** Config inspection starts from the same normalizer as the Provider. */
const configExample = `const config = normalizeStoreConfig({ features: { experimental: { charts: true } } })
console.log(readStoreFeature(config, 'experimental.charts'))
assertStoreFeature(config, 'experimental.charts', 'Charts')`

/** A pricing panel waits for the initialization promised by its WASM declaration. */
const wasmOptionExample = `import { StoreProvider } from '@migaia/store-react'

const pricingConfig = {
  features: { wasm: true },
  ready: [initializePricingWasm]
}
function PricingApp() {
  return (
    <StoreProvider config={pricingConfig}>
      <PricingTable />
    </StoreProvider>
  )
}`

/** A Store explicitly consumes the preference exposed by normalized application configuration. */
const featureOptionExample = `import { normalizeStoreConfig, readStoreFeature } from '@migaia/store-react'
import { createStore } from '@migaia/store-light'

const config = normalizeStoreConfig({
  features: { experimental: { charts: true } },
  defaults: { warnAsyncActions: true }
})
const invoice = createStore({ total: 0 }, {
  warnAsyncActions: config.defaults.warnAsyncActions
})
if (readStoreFeature(config, 'experimental.charts')) mountInvoiceCharts(invoice)`

/** An application feature guard gives the user an unavailable view instead of opening the panel. */
const disabledFeatureOptionExample = `import { normalizeStoreConfig, assertStoreFeature } from '@migaia/store-react'

const config = normalizeStoreConfig({ features: { wasm: false } })
function openPricing() {
  try {
    assertStoreFeature(config, 'wasm', 'PricingPanel')
    openPricingPanel()
  } catch (error) {
    showFeatureUnavailable(error)
  }
}
pricingButton.onclick = openPricing`

/** One editor widget transfers its registry's final cleanup to its Provider. */
const providerOwnershipOptionExample = `import { StoreProvider, createStoreRegistry, createStoreToken } from '@migaia/store-react'

const registry = createStoreRegistry()
const editorToken = createStoreToken<typeof editorStore>('editor')
registry.register(editorToken, editorStore, { owned: true })
function EditorWidget() {
  return (
    <StoreProvider registry={registry} runtime={registry.runtime} disposeOnUnmount={true}>
      <Editor />
    </StoreProvider>
  )
}`

/** A stable configuration keeps asynchronous editor preparation outside the child render. */
const providerReadyOptionExample = `import { StoreProvider } from '@migaia/store-react'

const editorConfig = {
  ready: [loadEditorSettings],
  fallback: <p>Loading editor settings…</p>
}
function EditorApp() {
  return (
    <StoreProvider config={editorConfig}>
      <Editor />
    </StoreProvider>
  )
}`

/** Shared inspection cases use real normalized configuration, not partial lookalikes. */
const featureOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t('Inspect an enabled application feature', '读取已启用的应用特性'),
    problem: t(
      'An invoice screen enables an experimental chart panel and wants its Stores to warn about asynchronous actions. A Provider preference does not configure those Stores automatically. Read the normalized preference when creating the Store, and check the chart flag before mounting its UI.',
      '发票页面启用实验图表，并希望它的 Store 对异步操作发出警告。Provider 中的偏好不会自动配置这些 Store；创建 Store 时读取归一化偏好，再在挂载图表前检查开关。'
    ),
    example: featureOptionExample,
    result: t(
      'The invoice chart mounts because its application flag is enabled, and the Store receives the warning preference explicitly.',
      '发票图表因应用开关已启用而挂载，Store 也显式取得异步操作警告偏好。'
    ),
    covers: ['features', 'features.experimental', 'defaults']
  },
  {
    title: t('Reject use of a disabled feature', '拒绝使用已关闭的特性'),
    problem: t(
      'A pricing panel requires WASM, but this deployment disables that feature. Opening the panel directly would ignore the application policy. Guard the entry action with assertStoreFeature so the page can explain why the panel is unavailable without loading it.',
      '定价面板依赖 WASM，但当前部署关闭了这个特性。直接打开面板会忽略应用策略；在入口操作使用 assertStoreFeature，页面便能说明面板为何不可用，而不去加载它。'
    ),
    example: disabledFeatureOptionExample,
    result: t(
      'Clicking the pricing control shows the unavailable view with FEATURE_DISABLED; the WASM panel never opens.',
      '点击定价入口会显示带 FEATURE_DISABLED 的不可用界面，不会打开 WASM 面板。'
    ),
    covers: ['features']
  }
]

/** Provider configuration and lifecycle remain separate decisions. */
const readyOptionCase: IOptionCaseDoc = {
  title: t('Wait for initialization before rendering children', '初始化完成后再渲染子树'),
  problem: t(
    'An editor needs its saved settings before its controls can render. Rendering immediately could show the wrong initial state. Keep the settings loader in a stable configuration and show a loading view until it finishes, then mount the editor.',
    '编辑器需要先取得保存的设置，才能显示控件。立即渲染可能展示错误的初始状态；把设置加载函数放入稳定配置，加载完成前显示等待界面，再挂载编辑器。'
  ),
  example: providerReadyOptionExample,
  result: t(
    'The settings-loading message appears first. The editor appears after the settings load, without rendering against incomplete configuration.',
    '先显示设置加载提示，设置加载完成后再显示编辑器，避免用不完整配置渲染控件。'
  ),
  covers: ['ready', 'fallback']
}
/** Features are declarative switches, not automatic implementation installers. */
const features: Readonly<Record<string, IMemberDoc>> = {
  wasm: {
    whenToUse: t(
      'Set true when the subtree uses WASM fields, and supply its initialization barriers in `ready`. This declaration does not initialize WASM. False, including omission, disables the declaration and requires no WASM barrier; true without a barrier creates rejected readiness.',
      '子树使用 WASM 字段时设为真，并通过 `ready` 提供初始化屏障。这个声明不会初始化 WASM。设为假或省略时关闭声明，不要求 WASM 屏障；设为真却没有屏障时，就绪状态会拒绝。'
    ),
    example: wasmOptionExample,
    summary: t(
      'Declares WASM field usage. True requires at least one readiness barrier; otherwise normalization creates a rejecting configuration barrier.',
      '声明使用网页汇编字段；启用时必须提供至少一个就绪屏障，否则归一化创建拒绝的配置屏障。'
    ),
    default: t('`false`: no WASM readiness requirement.', '默认 `false`，不要求 WASM 就绪。'),
    values: {
      true: t(
        'Require caller-supplied initialization readiness before rendering the subtree.',
        '渲染子树前要求调用方提供初始化就绪条件。'
      ),
      false: t('Do not require a WASM initialization barrier.', '不要求网页汇编初始化屏障。')
    }
  },
  experimental: {
    summary: t(
      'Application feature dictionary; only exact true enables an enumerable data-property entry. A sorted frozen null-prototype snapshot excludes accessors.',
      '应用实验特性字典，仅精确真值启用可枚举数据属性；按排序创建冻结无原型快照，排除访问器。'
    ),
    default: t(
      'Empty frozen dictionary; every experimental path is disabled.',
      '默认空冻结字典，全部实验路径关闭。'
    )
  }
}
/** Application defaults are data exposed for explicit consumption. */
const defaults: Readonly<Record<string, IMemberDoc>> = {
  warnAsyncActions: {
    summary: t(
      'Application-readable default in useStoreConfig; the Provider does not pass it into createStore, so each Store must explicitly apply its own option.',
      '通过配置钩子读取的应用默认值；提供者不把它传给轻量存储工厂，各存储必须显式应用自身选项。'
    ),
    default: t('`false` in the normalized configuration.', '归一化配置默认 `false`。'),
    values: {
      true: t(
        'Expose an enabled application preference without changing any Store automatically.',
        '公开启用的应用偏好，不自动修改任何存储。'
      ),
      false: t('Expose a disabled application preference.', '公开关闭的应用默认偏好值。')
    }
  }
}
/** Provider configuration belongs to one barrier scope. */
const configOptions: Readonly<Record<string, IMemberDoc>> = {
  features: {
    summary: t(
      'Application feature declarations normalized to explicit WASM and experimental booleans.',
      '应用特性声明，归一化为显式网页汇编与实验开关布尔值。'
    ),
    default: t('Omitted: all features are disabled.', '省略时所有特性均关闭。')
  },
  ready: {
    summary: t(
      'Promises or zero-argument synchronous/async factories. Normalization eagerly invokes uncached factories before returning, caches factory results by scope plus factory identity, and separately caches each list Promise by scope plus array identity. Rejected factory results leave the factory cache; scopes are isolated. A changed array identity selects a new Provider generation and ReadyBoundary, so an old generation cannot release the new one; changing only the array does not rerun a successful cached factory.',
      'Promise 或无参数同步、异步工厂。归一化返回前即调用未缓存工厂，按作用域与工厂身份缓存结果，列表 Promise 另按作用域与数组身份缓存。失败的工厂结果会移出缓存，不同作用域相互隔离。数组身份变化会创建新的 Provider 就绪代次，旧代次无法放行新子树；仅换数组不会重跑成功缓存的工厂。'
    ),
    returns: t(
      'Factory result is awaited and discarded; rejection blocks the subtree and reaches its outer Error Boundary.',
      '等待工厂结果后丢弃其值；拒绝阻止子树并进入外层错误边界。'
    ),
    default: t(
      'No barrier, unless WASM is enabled without one, which creates a rejected barrier.',
      '默认无屏障；启用网页汇编却未提供屏障时创建拒绝屏障。'
    )
  },
  fallback: {
    summary: t(
      'ReactNode rendered while readiness remains pending; rejected barriers throw instead of rendering this fallback.',
      '就绪仍待完成时渲染的界面节点；屏障拒绝会抛错，不渲染此等待内容。'
    ),
    default: t('`null`: render no subtree while pending.', '默认 `null`，等待期间不渲染子树。')
  },
  defaults: {
    summary: t(
      'Application-readable defaults snapshot; it does not change existing or future Store construction options.',
      '应用可读取的默认值快照，不改变已有或未来存储的构造选项。'
    ),
    default: t('`warnAsyncActions` is `false`.', '`warnAsyncActions` 默认设为 `false`。')
  }
}
/** Real nested configuration fields retain their owning path. */
const configOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  ...configOptions,
  'features.wasm': features.wasm!,
  'features.experimental': features.experimental!,
  'defaults.warnAsyncActions': defaults.warnAsyncActions!
}
/** Normalized config differs from input: every top-level field is present and ready is tracked. */
const normalizedConfig: Readonly<Record<string, IMemberDoc>> = {
  features: {
    summary: t(
      'Normalized explicit WASM boolean and frozen experimental dictionary; only exact true is enabled.',
      '归一化后的显式网页汇编布尔值与冻结实验字典，仅精确真值启用。'
    )
  },
  defaults: {
    summary: t(
      'Application defaults with explicit warnAsyncActions boolean; consumers decide whether to apply it to their Stores.',
      '含显式异步操作警告布尔值的应用默认值，由消费方决定是否应用于存储。'
    )
  },
  ready: {
    summary: t(
      'Null when no barrier exists; otherwise {promise, status(), error()}. Status is pending/ready/error, updated in a microtask; error() preserves rejection identity.',
      '无屏障时为空值，否则包含承诺、同步状态查询与错误查询；状态为待完成、就绪或错误，在微任务中更新，错误查询保留拒绝身份。'
    ),
    example: `import { normalizeStoreConfig } from '@migaia/store-react'

const config = normalizeStoreConfig({ ready: [loadEditorSettings] })
await config.ready?.promise
mountEditor(config)`
  }
}
/** Component props describe ownership independently of readiness. */
const providerProps: Readonly<Record<string, IMemberDoc>> = {
  children: {
    example: `import { StoreProvider } from '@migaia/store-react'

const editorView = <StoreProvider children={<Editor />} />`,
    summary: t(
      'React subtree receiving configuration and Registry contexts after readiness succeeds.',
      '就绪成功后接收配置与登记表上下文的组件子树。'
    )
  },
  registry: {
    summary: t(
      'Caller-owned StoreRegistry returned by createStoreRegistry or new StoreRegistry; when runtime is also supplied it must be the same object as registry.runtime.',
      '由登记表工厂或构造器返回、调用方持有的登记表；同时传运行时时必须与其所属运行时为同一对象。'
    ),
    default: t(
      'Create an internal registry for this Provider scope.',
      '默认创建此提供者作用域的内部登记表。'
    )
  },
  runtime: {
    summary: t(
      'IRuntime used for an internally created Registry; when an external registry is supplied it may only confirm the same runtime identity.',
      '用于内部登记表的运行时；已有外部登记表时，只能提供同一身份以确认所有权。'
    ),
    default: t(
      'External registry.runtime, or a new createRuntime for an internal registry.',
      '外部登记表存在时使用其运行时，否则为内部登记表创建新运行时。'
    )
  },
  disposeOnUnmount: {
    whenToUse: t(
      'Use true for a registry whose lifetime belongs to this mounted widget: its owned registrations are released after the final unmount. Use false when an application shell keeps the registry across remounts and will dispose it itself. Omission chooses true for internal registries and false for supplied registries.',
      '登记表的生命周期归当前挂载组件所有时设为真：最终卸载后释放自持有登记。应用外壳需要跨重新挂载保留登记表、并自行释放时设为假。省略时，内部登记表默认真，传入的登记表默认假。'
    ),
    example: providerOwnershipOptionExample,
    summary: t(
      'Whether final Provider release disposes the registry, its atomStore and owned registrations after a task delay; Runtime remains outside this ownership.',
      '最终提供者释放是否在任务延后后释放登记表、原子存储与自持有登记；运行时不属于此释放责任。'
    ),
    default: t(
      '`true` for internal registries, `false` for injected external registries; SSR runs no unmount effects.',
      '内部登记表默认 `true`，注入的外部登记表默认 `false`；SSR 不执行卸载副作用。'
    ),
    values: {
      true: t(
        'Dispose the registry once no retained Provider owner remains.',
        '不再有提供者持有时释放此登记表。'
      ),
      false: t(
        'Leave registry disposal to the external application owner.',
        '将登记表释放留给外部应用拥有者。'
      )
    }
  },
  config: {
    example: providerReadyOptionExample,
    summary: t(
      'Optional IStoreProviderConfig for feature declarations, readiness, pending fallback and readable defaults.',
      '可选提供者配置，声明特性、就绪屏障、等待界面与可读默认值。'
    ),
    default: t(
      'All features disabled with no readiness barrier.',
      '默认关闭全部特性且没有就绪屏障。'
    )
  }
}
/** Real Provider nested option paths can be expanded without inventing a separate source. */
const providerOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  ...providerProps,
  ...Object.fromEntries(
    Object.entries(configOptionDocs).map(([name, doc]) => [`config.${name}`, doc])
  )
}
/** Registration ownership policy is chosen per entry. */
const registrationOptions: Readonly<Record<string, IMemberDoc>> = {
  owned: {
    summary: t(
      'Transfer value cleanup responsibility to this registration. Prefer $dispose when present, otherwise dispose; values with neither method need no cleanup.',
      '将值清理责任交给本登记；存在专用存储释放方法时优先调用，否则调用普通释放方法，两者都没有时无需清理。'
    ),
    default: t(
      '`false`: the caller retains value ownership.',
      '默认 `false`，调用方保留值所有权。'
    ),
    values: {
      true: t(
        'Unregister, replacement, removal or registry disposal can release this value.',
        '退订、替换、移除或登记表释放均可释放此值。'
      ),
      false: t(
        'Only remove the registry reference; do not dispose the borrowed value.',
        '仅移除登记引用，不释放借用的值。'
      )
    }
  }
}
/** Standard hook declaration keeps source lifetime with the caller. */
const hook = (
  en: string,
  zh: string,
  params: Readonly<Record<string, IText>>,
  returns: IText,
  example: string,
  cases?: readonly ICaseDoc[],
  exampleIntro?: IText
): ISymbolDoc => ({
  role: 'operation',
  purpose: t(en, zh),
  params,
  returns,
  example: cases?.[0]?.example ?? example,
  cases,
  exampleIntro
})
/** Atom protocol examples receive stable application-owned source objects. */
const atomExample = `function Counter({ atom }: { atom: IWritableAtom<number, readonly [number], void> }) {
  const [count, write] = useAtom(atom)
  return <button onClick={() => write(count + 1)}>{count}</button>
}`
/** Registry instance operations preserve admission and cleanup boundaries. */
const registryMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'Owning graph used for cross-runtime admission and lifecycle failure reporting; never disposed by this registry.',
      '用于跨运行时接纳与生命周期失败报告的所属依赖图，本登记表不会释放它。'
    )
  },
  atomStore: {
    summary: t(
      'Registry-local IAtomStore from store-keyed; registries remain isolated even when sharing one Runtime.',
      '来自键控包的登记表本地原子存储；即使共享同一运行时，各登记表状态仍隔离。'
    )
  },
  lifecycle: {
    summary: t(
      'Canonical ILifecycleState: public admission enters closing before any owned disposer runs, then reaches terminal only after every tracked disposer settles.',
      '规范生命周期状态：任何自持有清理回调执行前，公开接纳已进入关闭；全部受跟踪释放操作完成后才进入终态。'
    )
  },
  disposed: {
    summary: t(
      'True as soon as whole-registry disposal starts, including during the first owned callback; register/replace/get/require/has/remove and retain reject. Use whenTerminal for physical completion.',
      '整个登记表开始释放即为真，包括首个自持有清理回调期间；此时登记、替换、查询、移除与持有均拒绝。物理完成需等待终态承诺。'
    )
  },
  whenTerminal: method(
    'Waits for the whole-registry disposal ledger to finish; it does not initiate disposal or wait for ad-hoc remove/replace cleanup.',
    '等待整个登记表释放账本完成；不主动开始释放，也不等待临时移除或替换清理。',
    {},
    t(
      'Promise of physical terminal completion; inspect disposeAsync for cleanup failures.',
      '返回物理终态完成承诺，清理失败由异步释放结果提供。'
    ),
    'registry.dispose()\nawait registry.whenTerminal()'
  ),
  register: method(
    'Registers one token/value pair after runtime admission; duplicate token registration rejects. Use the original token returned by createStoreToken.',
    '搭配 `createStoreToken` 使用，接纳同运行时的令牌值登记，重复令牌会拒绝。',
    {
      token,
      value: t(
        'Application-owned value; reactive ownership, if present, must match registry.runtime.',
        '应用持有的值；存在响应式所有权时必须匹配登记表运行时。'
      ),
      options: t(
        'Optional IStoreRegistrationOptions; owned defaults false and nonobject or nonboolean flags reject.',
        '可选登记选项，持有标记默认假值；非对象选项或非布尔标记会拒绝。'
      )
    },
    t(
      'Idempotent unregister function; it only removes its original entry and disposes it when owned, leaving replacements untouched.',
      '返回幂等退订函数，仅移除自身原登记并按持有标记释放，不触碰替换后的登记。'
    ),
    registryExample
  ),
  replace: method(
    'Installs or replaces a token entry. A different previously owned value is disposed after replacement, so a cleanup throw does not undo the new entry.',
    '安装或替换令牌登记；替换后释放不同的旧自持有值，清理抛错不撤销新登记。',
    {
      token,
      value: t(
        'Replacement value admitted to this Runtime ownership boundary.',
        '通过此运行时所有权边界接纳的替换值。'
      ),
      options: t(
        'Optional ownership for the new entry, default false; not inherited from the old entry.',
        '新登记的可选持有策略，默认假值，不继承旧登记。'
      )
    },
    t(
      'Nothing; the new value is registered, or validation/old synchronous cleanup fails.',
      '无返回值；新值已登记，或校验、旧值同步清理失败。'
    ),
    "const registry = createStoreRegistry(); const token = createStoreToken<number>('count'); registry.replace(token, 1); await registry.disposeAsync()"
  ),
  get: method(
    'Looks up a token synchronously without adding a React subscription to registry changes.',
    '同步查询令牌，不为登记变化增加组件订阅。',
    { token },
    t(
      'Registered value, or undefined if absent; throws after registry closure.',
      '返回登记值，缺失时为空值；登记表关闭后抛错。'
    ),
    "const registry = createStoreRegistry(); const token = createStoreToken<number>('count'); console.log(registry.get(token)); registry.dispose()"
  ),
  require: method(
    'Reads an existing registration and rejects a missing token with STORE_MISSING.',
    '读取已有登记，缺失令牌时以存储缺失错误拒绝。',
    { token },
    t('Registered value preserving its original identity.', '返回保留原对象身份的登记值。'),
    registryExample
  ),
  has: method(
    'Checks whether this exact token key has a current entry; no source data subscription is created.',
    '检查精确令牌键是否有当前登记，不创建源数据订阅。',
    { token },
    t(
      'True for a present entry, including one storing undefined.',
      '存在登记时为真，包括保存值为空值的登记。'
    ),
    "const registry = createStoreRegistry(); const token = createStoreToken<number>('count'); console.log(registry.has(token)); registry.dispose()"
  ),
  remove: method(
    'Deletes an entry before optional owned-value cleanup; asynchronous cleanup failures are reported through Runtime and not joined by later disposeAsync.',
    '先删除登记再按需清理自持有值；异步清理失败通过运行时报告，不加入后续登记表异步释放。',
    {
      token,
      disposeOwned: t(
        'Defaults true; false removes the registration while retaining any owned value for external cleanup.',
        '默认真值；假值仅移除登记，保留原自持有值供外部清理。'
      )
    },
    t(
      'True if an entry was removed, false if absent; synchronous cleanup can throw after removal.',
      '实际移除登记时为真，缺失时为假；同步清理可在移除后抛错。'
    ),
    "const registry = createStoreRegistry(); const token = createStoreToken<number>('count'); registry.register(token, 1); registry.remove(token); registry.dispose()"
  ),
  retain: method(
    'Acquires one Provider retention. Its release function schedules disposal via setTimeout(0) only if requested and the registry still has zero owners in that generation.',
    '取得一次提供者持有；释放函数仅在要求释放且同代次仍为零持有者时，经零毫秒定时任务调度登记表释放。',
    {
      disposeOnRelease: t(
        'True requests terminal registry disposal after the last owner releases; false only drops this retention.',
        '真值请求最后持有者释放后终止登记表；假值仅减少本次持有。'
      )
    },
    t(
      'Idempotent release callback; repeated release cannot decrement ownership twice.',
      '返回幂等释放回调，重复调用不会重复减少持有。'
    ),
    'const registry = createStoreRegistry()\nconst release = registry.retain(true)\nrelease()\nawait registry.whenTerminal()'
  ),
  dispose: method(
    'Closes public admission before callbacks, starts reverse-registration-order owned cleanup, then atomStore cleanup. The shared async completion is published first, so reentrant disposeAsync returns the same Promise. Every cleanup is attempted; thenables stay observed and tracked until terminal completion.',
    '回调前关闭公开接纳，按登记逆序启动自持有值清理，再清理原子存储。先发布共享异步完成承诺，重入异步释放取得同一对象；尝试全部清理，可等待结果持续被观察和跟踪直至终态。',
    {},
    t(
      'Nothing; idempotent after the first start. One mutable native uncoded failure retains object/type/stack and gains REGISTRY_DISPOSAL_FAILED; frozen or non-Error failures remain on cause/errors. Complete foreign identity stays unchanged; multiple failures form AggregateError in cleanup order.',
      '无返回值，首次开始后幂等。单个可扩展未编码原生失败保留对象、类型与堆栈并附 `REGISTRY_DISPOSAL_FAILED`；冻结错误或非错误值经原因、聚合列表可达。完整外包身份不变，多个失败按清理顺序形成聚合错误。'
    ),
    'const registry = createStoreRegistry(); registry.dispose(); await registry.disposeAsync()'
  ),
  disposeAsync: method(
    'Starts disposal if needed and returns one stable shared completion, including thenables started by an earlier synchronous dispose.',
    '按需启动释放并返回稳定共享完成承诺，包括先前同步释放已经启动的可等待结果。',
    {},
    t(
      'One stable Promise resolving at cleanup completion, including reentrant calls. Failures use the same native identity/cause/foreign-owner policy as dispose; multiple failures reject as ordered AggregateError.',
      '返回稳定共享承诺，包括重入调用，清理完成后兑现。失败遵循同步释放相同的原生身份、原因链及外包拥有者策略，多个失败以有序聚合错误拒绝。'
    ),
    'const registry = createStoreRegistry(); await registry.disposeAsync()'
  )
}
/** Complete Store React reference. */
export const storeReactReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'React 19/react-dom 19 or later subscriptions and scoped injection for external Store, Atom, Signal and Resource models. This pure ESM library exposes only its root entry; package.json sets type: module. Start with useStore/useSignal for direct sources or StoreProvider with definition hooks for per-subtree state.',
        '要求十九或更高版本的组件框架及其渲染器，为外部存储、原子、信号与资源模型提供组件订阅及作用域注入；本库为纯标准模块，仅发布根入口，模块类型设为标准模块；直接源从订阅钩子开始，子树隔离状态使用提供者与定义钩子。'
      ),
      example: definitionExample
    }
  },
  symbols: {
    StoreProvider: {
      role: 'enhancer',
      purpose: t(
        'Provides Registry and feature/readiness contexts to a React subtree. Pending barriers render fallback; rejection reaches an outer Error Boundary and new barrier-list identity creates a new readiness generation.',
        '为组件子树提供登记表与特性、就绪上下文；屏障待完成时渲染等待界面，拒绝进入外层错误边界，新屏障列表身份创建新就绪代次。'
      ),
      params: {
        props: t(
          'JSX props object destructured by the component: children, optional registry/runtime ownership, disposal policy and feature/readiness config.',
          '由组件解构的属性对象，包含子树、可选登记表与运行时所有权、释放策略及特性就绪配置。'
        )
      },
      optionDocs: providerOptionDocs,
      optionCases: [
        {
          title: t('Choose who releases an injected registry', '选择谁来释放注入的登记表'),
          problem: t(
            'An embedded editor owns its registered Store and should release it when the widget disappears. An injected registry stays borrowed by default, so a plain unmount would retain it. Explicitly transfer final unmount cleanup to the Provider while keeping the matching runtime identity.',
            '嵌入式编辑器拥有自己登记的 Store，组件消失后应释放它。注入的登记表默认借用，普通卸载仍会保留它；显式把最终卸载清理交给 Provider，并传入匹配的运行时身份。'
          ),
          example: providerOwnershipOptionExample,
          result: t(
            'The editor uses the injected registry. After its final unmount, the registry and its owned Store are released; the runtime remains caller-owned.',
            '编辑器使用注入的登记表；最终卸载后，登记表和它拥有的 Store 被释放，运行时仍归调用方所有。'
          ),
          covers: ['registry', 'runtime']
        },
        { ...readyOptionCase, covers: ['config'] }
      ],
      returns: t(
        'React element tree; internal registries default to disposal on final unmount and external registries remain borrowed by default.',
        '返回组件元素树；内部登记表默认在最终卸载后释放，外部登记表默认借用。'
      ),
      example: storeReactCases.StoreProvider![0]!.example,
      cases: storeReactCases.StoreProvider,
      exampleIntro: t(
        'Install React 19 and react-dom 19 or later with this package. createStoreRegistry() creates a fresh Runtime when omitted. children is required; this example supplies ready and fallback explicitly. SSR does not run unmount effects, so the request owner awaits registry.disposeAsync().',
        '同时安装 React 19、react-dom 19 或更高版本。`createStoreRegistry()` 省略运行时时会新建一份；`children` 必填，本例显式传入 `ready` 与 `fallback`。SSR 不执行卸载副作用，请求拥有者须等待 `registry.disposeAsync()`。'
      )
    },
    createStoreRegistry: {
      role: 'factory',
      purpose: t(
        'Creates an isolated Registry and its local AtomStore in a chosen Runtime; use one per Provider or SSR request when state must stay independent.',
        '在所选运行时创建隔离登记表及本地原子存储；需要状态隔离时，每个提供者或服务端请求各建一份。'
      ),
      params: {
        runtime: t(
          'Caller IRuntime or omitted for a new createRuntime; registry disposal never disposes this Runtime.',
          '调用方运行时，省略时创建新运行时；登记表释放不会释放该运行时。'
        )
      },
      returns: t(
        'Caller-owned StoreRegistry with explicit sync or async disposal.',
        '返回调用方持有、支持显式同步或异步释放的登记表。'
      ),
      example: registryExample
    },
    StoreRegistry: {
      role: 'factory',
      purpose: t(
        'Constructs the same runtime-bound registry as createStoreRegistry, holding typed registrations and a registry-local AtomStore.',
        '构造与登记表工厂相同的运行时绑定容器，持有类型化登记与本地原子存储。'
      ),
      params: { runtime },
      returns: t(
        'Owned registry; an omitted Runtime creates a fresh graph, not the global default.',
        '返回自持有登记表；省略运行时时创建新依赖图，不使用全局默认图。'
      ),
      example: 'const registry = new StoreRegistry()\nawait registry.disposeAsync()'
    },
    createStoreToken: {
      role: 'factory',
      purpose: t(
        'Creates a frozen typed token with a fresh Symbol and nonempty diagnostic name. Reuse the token object; separately created tokens with equal names are distinct.',
        '创建带全新符号与非空诊断名的冻结类型化令牌；必须复用令牌对象，分别创建的同名令牌互不相同。'
      ),
      params: {
        debugName: t(
          'Nonempty application-selected diagnostic label; it does not determine token equality.',
          '应用指定的非空诊断标签，不决定令牌相等性。'
        )
      },
      returns: t(
        'IStoreToken for register/get/require and Provider lookup; invalid names throw INVALID_CONFIG.',
        '返回用于登记、查询及提供者读取的令牌；非法名称抛无效配置错误。'
      ),
      example: registryExample
    },
    useStore: hook(
      'Selectively subscribes to Store fields using its own Runtime; async Stores suspend through storeReady before the selector runs. No Provider is required.',
      '使用源存储运行时选择性订阅字段；异步存储先等待就绪再运行选择器，不要求提供者。',
      {
        store: t(
          'Stable IReactiveStore returned by createStore from store-light; the caller retains ownership.',
          '轻量包工厂返回的稳定响应式存储，调用方保留所有权。'
        ),
        selector: t(
          'Synchronous callback receiving the Store state view and returning render data; reads establish dependencies and throws reach render.',
          '同步回调接收存储状态视图并返回渲染数据；读取建立依赖，抛错进入渲染。'
        ),
        isEqual: equality
      },
      t(
        'Current selected value; equality preserves the prior snapshot reference.',
        '返回当前选择值，相等比较保留先前快照引用。'
      ),
      storeExample,
      storeReactCases.useStore,
      t(
        'Also install @migaia/store-light and the React 19 peers. createStore(initialState) requires the initial record; omitted options use the Store default Runtime. The selector receives state synchronously. isEqual defaults to Object.is. Each renderToString call below is a separate server render, not a mounted subscription.',
        '还需直接安装 `@migaia/store-light` 及 React 19 的两个 peer 包。`createStore(initialState)` 的初始对象必填，省略选项时使用 Store 的默认运行时。选择器同步接收状态，`isEqual` 默认 `Object.is`。下面两次 `renderToString` 是独立服务端渲染，不是挂载后的订阅更新。'
      )
    ),
    useTracked: hook(
      'Tracks arbitrary synchronous reactive reads with render capture and commit validation; changing selectors retracks dependencies without exposing abandoned render closures.',
      '通过渲染捕获与提交校验追踪任意同步响应式读取；选择器改变时重追踪依赖，不发布被放弃渲染的闭包。',
      {
        read: t(
          'No-argument synchronous reader returning render data; do not return asynchronous work. Throws surface through rendering.',
          '无参数同步读取函数，返回渲染数据；不要返回异步工作，抛错通过渲染呈现。'
        ),
        isEqual: equality,
        runtime: t(
          'Owning IRuntime; omitted uses defaultRuntime, and switching it creates a separate tracking instance.',
          '所属运行时，省略时使用默认运行时；切换时创建独立追踪实例。'
        )
      },
      t(
        'Current reader result; only tracked dependencies and equality affect notifications.',
        '返回当前读取结果，仅追踪依赖与相等比较影响通知。'
      ),
      'function Total({ price, quantity }: { price: IReactiveSignal<number>; quantity: IReactiveSignal<number> }) { return <span>{useTracked(() => price.value * quantity.value, Object.is, price.runtime)}</span> }'
    ),
    useNodeValue: hook(
      'Subscribes to one stable, ownership-admitted node through an Effect and reads snapshots using peek; ownership mismatch throws during render.',
      '通过副作用订阅单个稳定且已接纳所有权的节点，用未追踪方法读取快照；所有权不匹配时在渲染期间抛错。',
      {
        node: t(
          'Stable reactive-owned IStableNode with tracked value and untracked peek; a plain lookalike without reactive ownership is not sufficient.',
          '具有追踪值与未追踪读取方法、持有响应式所有权的稳定节点；普通同形对象不满足所有权要求。'
        ),
        runtime,
        enabled: t(
          'Defaults true. False disables subscribing but still validates ownership and reads the current peek snapshot.',
          '默认真值；假值关闭订阅，但仍校验所有权并读取当前未追踪快照。'
        )
      },
      t(
        'Current node.peek result; enabled false does not freeze snapshots on parent rerenders.',
        '返回当前未追踪读取结果；禁用订阅不会冻结父组件重渲染时的快照。'
      ),
      'function Value({ signal }: { signal: IReactiveSignal<number> }) { return <span>{useNodeValue(signal, signal.runtime)}</span> }'
    ),
    useSignal: hook(
      'Reads one signal through the stable-node path and returns a setter stable for that signal identity, without requiring a Provider.',
      '通过稳定节点路径读取单个信号，返回随信号身份稳定的写入函数，不要求提供者。',
      {
        s: t(
          'IReactiveSignal created in its owning Runtime; caller retains signal lifetime.',
          '由所属运行时创建的响应式信号，调用方保留信号生命周期。'
        )
      },
      t(
        'Readonly pair [value, setter]; setter(next) assigns the exact value synchronously, returns void and propagates write failures.',
        '返回只读值与写入函数二元组；写入函数同步赋予精确新值，返回空值并传播写入失败。'
      ),
      'function Count({ signal }: { signal: IReactiveSignal<number> }) { const [count, setCount] = useSignal(signal); return <button onClick={() => setCount(count + 1)}>{count}</button> }'
    ),
    useResource: hook(
      'Subscribes to a Resource state machine without automatically unwrapping or throwing its pending/error state.',
      '订阅资源状态机，不自动解包，也不主动抛出其等待或错误状态。',
      {
        res: t(
          'Stable Resource<T> from @migaia/resource; its Runtime owns tracking.',
          '来自 `@migaia/resource` 的稳定资源，其运行时持有依赖追踪。'
        )
      },
      t(
        'Current external IResourceState<T>, including idle, pending, success, error or cancelled.',
        '返回外部资源当前状态，包含空闲、等待、成功、错误或取消。'
      ),
      'function Profile({ resource }: { resource: Resource<string> }) { return <span>{useResource(resource).status}</span> }'
    ),
    useResourceValue: hook(
      'Unwraps a subscribed Resource during render: returns success data, throws its Promise for idle/pending, and throws the original error for error/cancelled.',
      '渲染期间读取资源：成功时返回数据，空闲或等待时抛出 Promise，错误或取消时抛出原始错误。',
      {
        resource: t(
          'Stable caller-owned Resource<T> from @migaia/resource, rendered under appropriate Suspense and Error Boundary owners.',
          '来自资源包、由调用方持有的稳定资源，应在相应等待边界与错误边界下渲染。'
        )
      },
      t(
        'Successful T value; pending suspends and failure propagates through React rendering.',
        '返回成功值；等待时挂起，失败通过组件渲染传播。'
      ),
      'function Profile({ resource }: { resource: Resource<string> }) { return <span>{useResourceValue(resource)}</span> }',
      storeReactCases.useResourceValue,
      t(
        'Also install @migaia/resource and @migaia/reactive. Resource(fetcher, runtime, options) requires the fetcher and Runtime; options defaults to {}, autoStart to true and ttl to Infinity. The fetcher returns the loaded value. This example awaits resource.promise before SSR and explicitly disposes the caller-owned Resource.',
        '还需直接安装 `@migaia/resource` 与 `@migaia/reactive`。`Resource(fetcher, runtime, options)` 的加载函数与运行时必填；选项默认 `{}`，`autoStart` 默认 `true`，`ttl` 默认 `Infinity`。加载函数返回业务值，本例先等待 `resource.promise`，再生成 HTML，最后显式释放 Resource。'
      )
    ),
    useStoreResource: hook(
      'Subscribes to the store-light resource protocol, captures a render snapshot and commits its lease in layout; previous committed leases release after replacement.',
      '订阅轻量存储资源协议，捕获渲染快照并在布局提交租约；替换后释放先前已提交租约。',
      {
        resource: t(
          'Stable IStoreResource field from store-light; distinct from Resource<T> and retained by its source Store owner.',
          '轻量存储提供的稳定资源字段，与通用资源协议不同，由源存储拥有者持有。'
        )
      },
      t(
        'Captured snapshot value; resource read failures or suspension remain governed by its captureSnapshot contract.',
        '返回捕获快照值；资源读取失败或挂起仍由其快照捕获契约决定。'
      ),
      'function Profile({ resource }: { resource: IStoreResource<string> }) { return <span>{useStoreResource(resource)}</span> }'
    ),
    useAsyncAtomValue: hook(
      'Reads atom.resource through the same render-time Resource unwrapping as useResourceValue; it does not create or own the Resource.',
      '按同一渲染期资源解包路径读取异步原子的资源属性，不创建或持有该资源。',
      {
        atom: t(
          'Application-owned object containing a stable Resource<T> in its readonly resource property.',
          '应用持有的对象，在只读资源属性中包含稳定的通用资源。'
        )
      },
      t(
        'Successful resource data; idle/pending throws Promise and error/cancelled throws the original failure.',
        '返回成功资源数据；空闲或等待抛承诺，错误或取消抛原始失败。'
      ),
      'function Profile({ atom }: { atom: { readonly resource: Resource<string> } }) { return <span>{useAsyncAtomValue(atom)}</span> }'
    ),
    useAtomValue: hook(
      'Reads an atom protocol value; when both Provider and atomDefinition exist, uses the Provider AtomStore and disables direct-node subscription.',
      '读取原子协议值；提供者与原子定义同时存在时使用提供者原子存储，并关闭直接节点订阅。',
      {
        atom: t(
          'Stable IReadableAtom from the external store-keyed protocol; atomDefinition optionally bridges it to scoped state.',
          '外部键控协议的稳定可读原子；可选原子定义将其连接到作用域状态。'
        )
      },
      t(
        'Current scoped or direct atom value; hook subscription cleanup does not dispose the caller atom.',
        '返回当前作用域值或直接原子值；钩子退订不释放调用方原子。'
      ),
      'function Count({ atom }: { atom: IReadableAtom<number> }) { return <span>{useAtomValue(atom)}</span> }'
    ),
    useSetAtom: hook(
      'Returns a stable writer using Provider AtomStore when a definition bridge exists, otherwise atom.write; it creates no value subscription.',
      '返回稳定写入函数；存在提供者定义桥时使用其原子存储，否则调用原子写入方法；不创建值订阅。',
      {
        atom: t(
          'Stable external IWritableAtom with declared Args and Result.',
          '声明写入参数与返回值的稳定外部可写原子。'
        )
      },
      t(
        'Callback forwarding original arguments and return value synchronously; write failures propagate unchanged.',
        '返回同步转发原参数与返回值的回调，写入失败原样传播。'
      ),
      'function Increment({ atom }: { atom: IWritableAtom<number, readonly [number], void> }) { const set = useSetAtom(atom); return <button onClick={() => set(1)}>1</button> }'
    ),
    useAtom: hook(
      'Combines atom value subscription and stable writer without changing Provider routing or source ownership.',
      '组合原子值订阅与稳定写入函数，不改变提供者路由或源所有权。',
      {
        atom: t(
          'Stable external IWritableAtom; definitions route through the current Provider when available.',
          '稳定外部可写原子；存在当前提供者时通过其定义进行路由。'
        )
      },
      t(
        'Readonly [current value, writer] pair; writer preserves Args, Result and synchronous failures.',
        '返回当前值与写入函数的只读二元组，写入函数保留参数、返回值与同步失败。'
      ),
      atomExample
    ),
    useAtomDefinition: hook(
      'Reads and subscribes to exactly the current Provider AtomStore, using speculative preview snapshots without publishing derived edges during render.',
      '精确读取并订阅当前提供者原子存储，通过推测预览取得快照，不在渲染期间发布派生依赖边。搭配 `StoreProvider` 使用。',
      {
        definition: t(
          'IAtomDefinition returned by the external atomDef, derivedDef or familyDef APIs.',
          '外部原子定义、派生定义或族定义接口返回的原子定义。'
        )
      },
      t(
        'Current definition value; missing Provider throws PROVIDER_REQUIRED.',
        '返回当前定义值；缺少提供者抛提供者必需错误。'
      ),
      definitionExample,
      storeReactCases.useAtomDefinition,
      t(
        'Also install @migaia/store-keyed and @migaia/reactive. atomDef(initialValue, debugLabel?) requires an initial value; debugLabel defaults to undefined. createStoreRegistry(runtime?) creates a Runtime only when omitted and never disposes it. The example shares one Runtime while each registry owns its own AtomStore.',
        '还需直接安装 `@migaia/store-keyed` 与 `@migaia/reactive`。`atomDef(initialValue, debugLabel?)` 的初始值必填，调试标签默认 `undefined`。`createStoreRegistry(runtime?)` 仅在省略时新建运行时，释放注册表不会释放运行时；本例共享运行时，每个注册表仍拥有独立的 AtomStore。'
      )
    ),
    useSetAtomDefinition: hook(
      'Returns a stable writer for one writable definition in the current Provider AtomStore without subscribing to its value.',
      '返回当前提供者原子存储中某可写定义的稳定写入函数，不订阅其值。搭配 `StoreProvider` 使用。',
      {
        definition: t(
          'External IWritableAtomDefinition whose Args and Result define the returned callback.',
          '外部可写原子定义，其参数与返回类型决定所返回回调。'
        )
      },
      t(
        'Synchronous callback forwarding arguments to AtomStore.set and preserving its result/failures; missing Provider throws.',
        '返回同步转发参数至原子存储设置方法的回调，保留返回值与失败；缺少提供者抛错。'
      ),
      definitionExample
    ),
    useStoreRegistry: hook(
      'Reads the current Registry context without creating a new registry or subscribing to entry replacements.',
      '读取当前登记表上下文，不创建新登记表，也不订阅条目替换。搭配 `StoreProvider` 使用。',
      {},
      t(
        'Current StoreRegistry; missing Provider throws PROVIDER_REQUIRED.',
        '返回当前登记表，缺少提供者时抛提供者必需错误。'
      ),
      'function Scope() { const registry = useStoreRegistry(); return <span>{registry.atomStore.size}</span> }\nfunction App() { return <StoreProvider><Scope /></StoreProvider> }'
    ),
    useStoreRuntime: hook(
      'Returns the Runtime of the current Registry; it does not construct or dispose a graph.',
      '返回当前登记表的运行时，不构造或释放依赖图。搭配 `StoreProvider` 使用。',
      {},
      t(
        'Borrowed IRuntime; missing Provider throws PROVIDER_REQUIRED.',
        '返回借用的运行时，缺少提供者时抛提供者必需错误。'
      ),
      'function Scope() { const runtime = useStoreRuntime(); return <span>{String(runtime !== undefined)}</span> }\nfunction App() { return <StoreProvider><Scope /></StoreProvider> }'
    ),
    useStoreFromProvider: hook(
      'Requires one registered token from the nearest Provider; registry entry replacement alone is not an external-store subscription.',
      '从最近提供者要求取得某令牌登记；仅替换登记条目不构成外部存储订阅。搭配 `StoreProvider` 和 `createStoreToken` 使用。',
      { token },
      t(
        'Exact registered value; missing Provider or registration throws its corresponding stable code.',
        '返回精确登记值；提供者或登记缺失时抛对应稳定错误码。'
      ),
      injectionExample
        .replace('useProvidedStore }', 'useStoreFromProvider }')
        .replace(
          'useProvidedStore(settingsToken, state => state.theme)',
          'useStoreFromProvider(settingsToken).theme'
        )
    ),
    useProvidedStore: hook(
      'Resolves a Store token from the nearest Provider and subscribes to the selected fields through useStore; it inherits async Store readiness.',
      '从最近提供者解析存储令牌，再选择性订阅字段，继承异步存储就绪行为。搭配 `StoreProvider` 和 `createStoreToken` 使用。',
      {
        token,
        selector: t(
          'Synchronous callback receiving the resolved Store state view and returning render data; throws reach rendering.',
          '同步回调接收解析所得存储的状态视图并返回渲染数据，抛错进入渲染。'
        ),
        isEqual: equality
      },
      t(
        'Current selected Store value; missing Provider/registration throws before selection.',
        '返回当前存储选择值，提供者或登记缺失时先于选择器抛错。'
      ),
      injectionExample,
      storeReactCases.useProvidedStore,
      t(
        'Also install @migaia/store-light. createStoreToken(debugName) requires a nonempty diagnostic name; token identity comes from its fresh Symbol. register(token, value, options = {}) defaults owned to false; these request examples transfer cleanup with owned: true and construct Stores using registry.runtime. isEqual defaults to Object.is.',
        '还需直接安装 `@migaia/store-light`。`createStoreToken(debugName)` 需要非空诊断名，身份由全新 Symbol 决定。`register(token, value, options = {})` 的 `owned` 默认 `false`；请求示例以 `owned: true` 移交清理责任，并用 `registry.runtime` 创建 Store。`isEqual` 默认 `Object.is`。'
      )
    ),
    normalizeStoreConfig: {
      role: 'factory',
      purpose: t(
        'Normalizes features and defaults before eagerly starting readiness factories within a caller cache scope. Top-level and nested defaults getter failures throw INVALID_CONFIG with original cause before any ready factory runs. Experimental flags become a frozen data-only dictionary.',
        '在调用方缓存作用域内先归一化特性与默认值，再立即启动就绪工厂；顶层及嵌套默认值读取失败在任何工厂执行前抛带原始原因的 `INVALID_CONFIG`。实验开关成为仅含数据属性的冻结字典。'
      ),
      params: {
        config: t(
          'Optional application IStoreProviderConfig; omitted disables all features and adds no barrier.',
          '可选应用提供者配置，省略时关闭全部特性且不增加屏障。'
        ),
        barrierScope: t(
          'Caller-selected object identity isolating readiness factory caches; omitted creates a fresh scope per call.',
          '调用方指定、隔离就绪工厂缓存的对象身份；省略时每次调用创建新作用域。'
        )
      },
      optionDocs: configOptionDocs,
      optionCases: [
        ...featureOptionCases.map((optionCase) => ({
          ...optionCase,
          covers: optionCase.covers.filter((field) => field !== 'features.experimental')
        })),
        readyOptionCase
      ],
      returns: t(
        'IStoreConfigValue with ready null or tracked {promise,status(),error()}; malformed configuration throws INVALID_CONFIG.',
        '返回归一化配置，就绪值为空或含承诺及状态、错误查询；格式非法抛无效配置错误。'
      ),
      example: configExample
    },
    readStoreFeature: {
      optionCases: featureOptionCases,
      ...hook(
        'Synchronously reads a normalized feature path without throwing merely because it is disabled.',
        '同步读取归一化特性路径，特性处于关闭状态本身不会引发错误。',
        {
          config: t(
            'IStoreConfigValue returned by normalizeStoreConfig or useStoreConfig after checking for null.',
            '归一化函数返回的配置，或配置钩子返回且已排除空值的配置。'
          ),
          path
        },
        t(
          'Boolean enabled value; unknown or empty experimental names return false.',
          '返回是否启用的布尔值，未知或空实验名称返回假。'
        ),
        configExample
      ),
      optionDocs: {
        ...normalizedConfig,
        'features.wasm': features.wasm!,
        'features.experimental': features.experimental!
      }
    },
    assertStoreFeature: {
      optionCases: featureOptionCases,
      ...hook(
        'Throws PROVIDER_REQUIRED for absent config and FEATURE_DISABLED for a disabled path; it does not initialize the requested feature.',
        '配置缺失抛提供者必需错误，路径关闭抛特性未启用错误；不初始化所请求特性。',
        {
          config: t(
            'Normalized config from normalizeStoreConfig or useStoreConfig, possibly null.',
            '来自归一化函数或配置钩子的归一化配置，可能为空。'
          ),
          path,
          apiName: t(
            'Optional application API label used in diagnostics; defaults to this API.',
            '诊断中使用的可选应用接口标签，默认使用通用接口名称。'
          )
        },
        t(
          'Nothing when enabled; otherwise throws a stable package error.',
          '启用时无返回值，否则抛稳定的本包错误。'
        ),
        configExample
      ),
      optionDocs: {
        ...normalizedConfig,
        'features.wasm': features.wasm!,
        'features.experimental': features.experimental!
      }
    },
    useStoreConfig: hook(
      'Reads configuration context independently of Registry lookup; missing Provider returns null without throwing.',
      '独立于登记表查询读取配置上下文；缺少提供者时返回空值而不抛错。',
      {},
      t(
        'Current IStoreConfigValue or null; defaults remain application-readable data.',
        '返回当前归一化配置或空值，默认值仍只是应用可读数据。'
      ),
      'function Flags() { const config = useStoreConfig(); return <span>{String(config?.features.wasm ?? false)}</span> }'
    ),
    useStoreFeature: hook(
      'Reads a normalized feature flag in the current context; returns false when no configuration Provider exists.',
      '读取当前上下文归一化特性开关；没有配置提供者时返回假值。',
      { path },
      t('True only for an explicitly enabled feature.', '仅显式启用特性时返回真值。'),
      "function Charts() { return useStoreFeature('experimental.charts') ? <canvas /> : null }"
    ),
    useAssertStoreFeature: hook(
      'Guards a component API against missing configuration or disabled features during rendering.',
      '在渲染期间为组件接口检查配置缺失或特性关闭。搭配 `StoreProvider` 使用。',
      {
        path,
        apiName: t(
          'Optional application API name for diagnostic text; defaults to this API.',
          '诊断文本中的可选应用接口名称，默认使用通用接口名称。'
        )
      },
      t(
        'Nothing when enabled; otherwise throws PROVIDER_REQUIRED or FEATURE_DISABLED.',
        '启用时无返回值，否则抛提供者必需或特性未启用错误。'
      ),
      "function Charts() { useAssertStoreFeature('experimental.charts', 'Charts'); return <canvas /> }\nfunction App() { return <StoreProvider config={{ features: { experimental: { charts: true } } }}><Charts /></StoreProvider> }"
    ),
    createStoreReactError: {
      role: 'operation',
      purpose: t(
        'Creates a native Error tagged with this package source and code; a supplied cause preserves its original identity and the helper does not throw.',
        '创建带本包来源与错误码的原生错误，传入原因保留原身份，辅助函数不主动抛出。'
      ),
      params: {
        code: t(
          'A stable value selected from StoreReactErrorCode for the actual scenario.',
          '从本包错误码表选择、对应实际场景的稳定值。'
        ),
        message: t('Caller-authored concrete error explanation.', '调用方编写的具体错误说明文本。')
      },
      optionDocs: {
        cause: {
          summary: t(
            'Original failure attached to the new Error cause without replacing it.',
            '附加到新错误原因属性上的原始失败，不替换原始对象。'
          ),
          default: t('Omitted: no cause property is supplied.', '省略时不提供原始原因属性。')
        }
      },
      optionCases: [
        {
          title: t('Keep a failed configuration loader', '保留配置加载器的原始失败'),
          problem: t(
            'A configuration loader failed and the application needs a Provider-specific message. Without `cause`, creating that message loses the original error and stack. Pass the original error to retain it by identity.',
            '配置加载器失败后，应用需要补充 Provider 相关消息。不传 `cause` 时，新错误会丢失原始失败及堆栈。传入原始错误即可按身份保留它。'
          ),
          example: `import { createStoreReactError, StoreReactErrorCode } from '@migaia/store-react'

async function loadSettings() {
  try {
    return await fetchEditorSettings()
  } catch (cause) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      'Unable to load editor settings',
      { cause }
    )
  }
}
await loadSettings().catch(showSettingsError)`,
          result: t(
            'The page shows an editor-specific failure message, and monitoring can inspect the original loader error through cause.',
            '页面显示编辑器设置加载失败的消息，监控仍可通过 cause 查看原始加载错误。'
          ),
          covers: ['cause']
        },
        {
          title: t('Keep a structured readiness rejection', '保留结构化的就绪拒绝原因'),
          problem: t(
            'An initializer rejects with a record instead of an Error. A string message alone cannot preserve that record. The `cause` option accepts the original value without converting it.',
            '初始化器用记录对象而不是 Error 表示拒绝原因。只有字符串消息无法保留这个记录。`cause` 可直接接收原始值，不做转换。'
          ),
          example: `import { createStoreReactError, StoreReactErrorCode } from '@migaia/store-react'

const ready = initializeEditor().catch((cause: unknown) => {
  throw createStoreReactError(
    StoreReactErrorCode.readyRejected,
    'Editor is not ready',
    { cause }
  )
})
showInitializationState(ready)`,
          result: t(
            'The editor shows its initialization failure while the original rejection record remains available to explain which initializer failed.',
            '编辑器显示初始化失败，原始拒绝记录仍可用于说明哪个初始化步骤失败。'
          ),
          covers: ['cause']
        }
      ],
      returns: t(
        'Tagged native Error preserving stack and instanceof identity.',
        '返回带身份的原生错误，保留堆栈与运行时类型判断。'
      ),
      example:
        "const error = createStoreReactError(StoreReactErrorCode.invalidConfig, 'Invalid provider configuration')"
    },
    createStoreReactAggregateError: {
      role: 'operation',
      purpose: t(
        'Creates a native AggregateError with package identity and original failures reachable through errors in input order.',
        '创建带本包身份的原生聚合错误，原始失败按输入顺序通过错误列表可达。'
      ),
      params: {
        code: t(
          'A semantic value selected from StoreReactErrorCode.',
          '从本包错误码表选择的语义码值。'
        ),
        errors: t(
          'Original failure values retained in the native errors array.',
          '保留在原生错误数组中的原始失败值。'
        ),
        message: t(
          'Caller-authored explanation covering the combined failure.',
          '调用方编写、描述组合失败的说明文本。'
        )
      },
      returns: t(
        'Tagged AggregateError; the helper returns without throwing.',
        '返回带身份的聚合错误，辅助函数不主动抛出。'
      ),
      example:
        "const error = createStoreReactAggregateError(StoreReactErrorCode.registryDisposalFailed, [firstFailure, secondFailure], 'Registry cleanup failed')"
    },
    STORE_REACT_SOURCE: {
      role: 'constant',
      purpose: t(
        'Stable @migaia/store-react source identity attached to package-owned errors; inspect source and code together.',
        '附加到包拥有错误上的稳定来源身份，读取来源与错误码应同时进行。'
      ),
      example: 'console.log(STORE_REACT_SOURCE)'
    },
    StoreReactErrorCode: {
      role: 'constant',
      purpose: t(
        'Stable codes for Registry admission/disposal, Provider requirements, feature gates and readiness failures.',
        '登记表接纳与释放、提供者要求、特性门控及就绪失败的稳定错误码。'
      ),
      example: 'console.log(StoreReactErrorCode.providerRequired)'
    },
    StoreProviderState: {
      role: 'constant',
      purpose: t(
        'Readiness state vocabulary selecting pending fallback, fulfilled subtree or render-time error propagation.',
        '选择等待界面、已就绪子树或渲染期错误传播的就绪状态词表。'
      ),
      example: 'console.log(StoreProviderState.pending)'
    }
  },
  types: {
    IStableNode: {
      summary: t(
        'Stable externally owned reactive node protocol with tracked value and untracked peek; useNodeValue also requires canonical reactive ownership.',
        '外部持有的稳定响应式节点协议，包含追踪值与未追踪读取；节点钩子还要求规范响应式所有权。'
      ),
      members: {
        value: {
          summary: t(
            'Tracked current node value, read by the owning Runtime Effect for notifications.',
            '受追踪的当前节点值，由所属运行时副作用读取以产生通知。'
          )
        },
        peek: method(
          'Reads the current node snapshot without registering a dependency, safe for repeated React snapshot reads.',
          '不登记依赖地读取当前节点快照，可供组件重复读取快照。',
          {},
          t(
            'Current synchronous node value; source read errors propagate.',
            '返回当前同步节点值，源读取错误传播。'
          ),
          'const snapshot = node.peek()'
        )
      }
    },
    IStoreConfigValue: {
      summary: t(
        'Normalized feature/default/readiness context returned by normalizeStoreConfig or useStoreConfig; the whole object is not deep-frozen.',
        '归一化函数或配置钩子返回的特性、默认值与就绪上下文，整体对象并未深冻结。'
      ),
      scenarios: [
        t(
          'Inspect normalized flags or await a readiness Promise outside a component.',
          '检查归一化开关，或在组件外等待就绪承诺。'
        )
      ],
      example: configExample,
      members: normalizedConfig
    },
    IStoreFeatures: {
      summary: t(
        'Input feature switches requiring explicit true; they declare usage and do not install external capabilities.',
        '要求显式真值的输入特性开关，只声明用法，不安装外部能力。'
      ),
      members: features
    },
    IStoreProviderDefaults: {
      summary: t(
        'Readable application preferences, not automatic Store construction overrides.',
        '可读应用偏好，不是自动覆盖存储构造的选项。'
      ),
      members: defaults
    },
    IStoreProviderConfig: {
      summary: t(
        'Input configuration for normalized features, readiness gates, pending fallback and application defaults.',
        '归一化特性、就绪门控、等待界面与应用默认值的输入配置。'
      ),
      members: configOptions
    },
    IStoreProviderProps: {
      summary: t(
        'React Provider ownership and configuration props; external Registry and Runtime identities must agree.',
        '组件提供者的所有权与配置属性，外部登记表与运行时身份必须一致。'
      ),
      members: providerProps
    },
    IStoreRegistrationOptions: {
      summary: t(
        'Per-registration cleanup ownership selected independently for new and replacement entries.',
        '每个新建或替换登记独立选择的清理所有权。'
      ),
      members: registrationOptions
    },
    IStoreToken: {
      summary: t(
        'Frozen token from createStoreToken carrying a fresh Symbol key and readable label, with a type-only value association.',
        '令牌工厂返回的冻结令牌，带全新符号键、可读标签与仅类型层面的值关联。'
      ),
      scenarios: [
        t(
          'Address the same typed registration from a Provider consumer without string-key collisions.',
          '让提供者消费方寻址同一类型化登记，避免字符串键冲突。'
        )
      ],
      example: registryExample,
      members: {
        key: {
          summary: t(
            'Fresh Symbol issued by createStoreToken; Registry indexing uses this symbol rather than the label.',
            '令牌工厂签发的全新符号，登记索引使用该符号而非名称。'
          )
        },
        debugName: {
          summary: t(
            'Caller-selected nonempty diagnostic name; tokens with equal labels remain distinct.',
            '调用方指定的非空诊断名称，同名令牌仍保持不同身份。'
          )
        }
      }
    },
    StoreRegistry: {
      summary: t(
        'Caller-owned Runtime-bound token registry with its own AtomStore and lifecycle disposal ledger; lookup is synchronous rather than a reactive entry inventory.',
        '调用方持有的运行时绑定令牌登记表，含自身原子存储与生命周期释放账本；查询是同步操作，不是响应式条目清单。'
      ),
      scenarios: [
        t(
          'Isolate state per React subtree or SSR request while explicitly choosing cleanup ownership.',
          '按组件子树或服务端请求隔离状态，并显式选择清理所有权。'
        )
      ],
      example: registryExample,
      members: registryMembers
    },
    IStoreReadyBarrier: {
      summary: t(
        'Promise or zero-argument factory returning any value or Promise. A factory is invoked synchronously during normalization; its result is awaited and discarded, and throws become rejections.',
        '承诺或返回任意值、承诺的无参数工厂；归一化期间同步调用工厂，等待并丢弃结果，抛错转成拒绝。'
      ),
      members: {}
    },
    IStoreFeatureExperimental: {
      summary: t(
        'Application string-to-boolean feature dictionary; normalization accepts only exact true values from enumerable own data properties.',
        '应用字符串到布尔值的特性字典，归一化仅接受自有可枚举数据属性中的精确真值。'
      ),
      members: {}
    },
    IStoreFeaturePath: {
      summary: t(
        'Feature lookup path: wasm or experimental.<name>; an empty experimental suffix is disabled.',
        '特性查询路径为网页汇编开关或实验前缀加名称；实验后缀为空时关闭。'
      ),
      members: {}
    },
    IStoreProviderState: {
      summary: t(
        'Value union of StoreProviderState for readiness pending, ready and error.',
        '提供者状态词表的值联合，表示就绪等待、成功与错误。'
      ),
      members: {}
    },
    IStoreReactErrorCode: {
      summary: t(
        'Value union of stable StoreReactErrorCode members for typed package failure recognition.',
        '稳定组件存储错误码的值联合，用于类型化识别本包失败。'
      ),
      members: {}
    }
  },
  enums: {
    StoreProviderState: {
      summary: t(
        'Provider readiness outcomes, independent of Registry lifetime.',
        '提供者就绪结果，与登记表生命周期独立。'
      ),
      values: {
        pending: t(
          'At least one barrier is still pending; render configured fallback.',
          '至少一个屏障仍待完成，渲染配置的等待界面。'
        ),
        ready: t(
          'Every barrier fulfilled; render the configured subtree.',
          '全部屏障成功完成，渲染配置的组件子树。'
        ),
        error: t(
          'A barrier rejected; propagate its normalized error from render.',
          '某个屏障拒绝，从渲染传播其归一化错误。'
        )
      }
    },
    StoreReactErrorCode: {
      summary: t(
        'Stable semantic failure identities owned by the React Store adapter.',
        '组件存储适配器拥有的稳定语义失败身份。'
      ),
      values: {
        registryDisposed: t(
          'Registry lookup or mutation after its lifecycle left open.',
          '登记表离开开放生命周期后仍进行查询或写入。'
        ),
        registryDisposalFailed: t(
          'Owned cleanup failed: a mutable native uncoded error keeps identity and gains this code; frozen or non-Error values remain on cause/errors. Foreign coded errors keep their owner; multiple failures form an ordered native AggregateError.',
          '自持有清理失败：可扩展未编码原生错误保留身份并附此码，冻结错误或非错误值经原因、聚合列表可达。外包带码错误保留拥有者，多个失败形成有序原生聚合错误。'
        ),
        providerRequired: t(
          'Provider-dependent hook or feature assertion has no Provider configuration.',
          '依赖提供者的钩子或特性断言没有提供者上下文。'
        ),
        featureDisabled: t(
          'Feature assertion targets a flag not explicitly enabled.',
          '特性断言针对未显式启用的特性开关。'
        ),
        storeMissing: t(
          'Required token has no current Registry entry.',
          '必需令牌在当前登记表中没有对应登记。'
        ),
        storeDuplicate: t(
          'Register attempts to insert an already registered token.',
          '登记操作试图插入已经登记的相同令牌。'
        ),
        crossRuntime: t(
          'Registered reactive value belongs to another Runtime graph.',
          '登记的响应式值属于另一个运行时依赖图。'
        ),
        invalidConfig: t(
          'Malformed token, ownership, Provider config or readiness declaration.',
          '令牌、所有权、提供者配置或就绪声明格式非法。'
        ),
        readyRejected: t(
          'Readiness rejected with a non-Error value; wrapper retains that original value in cause.',
          '就绪以非错误值拒绝，包装错误在原因属性中保留该值。'
        )
      }
    }
  },
  enhancers: {
    StoreProvider: {
      kind: 'adapter',
      target: 'React subtree',
      summary: t(
        'Installs scoped Registry and configuration contexts; definition hooks gain one local AtomStore and token hooks resolve registered values.',
        '安装作用域登记表与配置上下文；定义钩子取得本地原子存储，令牌钩子解析已登记值。'
      ),
      install: definitionExample,
      grants: [
        {
          signature: 'useStoreRegistry()',
          summary: t(
            'Access the nearest Registry for explicit registration and ownership control.',
            '访问最近登记表，显式控制登记与所有权。'
          ),
          returns: t(
            'Borrowed StoreRegistry, or PROVIDER_REQUIRED when absent.',
            '返回借用登记表，缺少提供者时抛对应错误。'
          ),
          example:
            'function Scope() { const registry = useStoreRegistry(); return <span>{registry.atomStore.size}</span> }\nfunction App() { return <StoreProvider><Scope /></StoreProvider> }'
        },
        {
          signature: 'useAtomDefinition(definition)',
          summary: t(
            'Read a definition from this Provider isolated AtomStore.',
            '从本提供者隔离原子存储中读取定义。'
          ),
          params: {
            definition: t(
              'External IAtomDefinition selecting the desired local state.',
              '选择所需本地状态的外部原子定义。'
            )
          },
          returns: t('Current subscribed definition value.', '返回当前已订阅定义的值。'),
          example: definitionExample
        },
        {
          signature: 'useSetAtomDefinition(definition)',
          summary: t(
            'Write through this Provider local AtomStore without subscribing to the value.',
            '通过本提供者的本地原子存储写入，不订阅当前值。'
          ),
          params: {
            definition: t(
              'Writable definition whose argument and result contract is preserved.',
              '保留原参数与返回契约的可写定义。'
            )
          },
          returns: t(
            'Stable callback forwarding writes and their failures to the original AtomStore.',
            '返回稳定回调，将写入与失败转给原子存储。'
          ),
          example: definitionExample
        },
        {
          signature: 'useStoreRuntime()',
          summary: t(
            'Borrow the graph owned by this Provider Registry for creating compatible source nodes.',
            '借用本提供者登记表所属依赖图，用于创建相容源节点。'
          ),
          returns: t(
            'Current Registry IRuntime; missing Provider throws PROVIDER_REQUIRED.',
            '返回当前登记表运行时，缺少提供者时抛对应错误。'
          ),
          example:
            'function Scope() { const runtime = useStoreRuntime(); return <span>{String(runtime !== undefined)}</span> }\nfunction App() { return <StoreProvider><Scope /></StoreProvider> }'
        },
        {
          signature: 'useStoreFromProvider(token)',
          summary: t(
            'Resolve an exact registered value from this Provider without a field selector subscription.',
            '从本提供者解析精确登记值，不创建字段选择器订阅。'
          ),
          params: { token },
          returns: t(
            'Original registered value, or a stable missing-Provider/missing-store failure.',
            '返回原始登记值，缺少提供者或登记时抛稳定失败。'
          ),
          example: injectionExample
            .replace('useProvidedStore }', 'useStoreFromProvider }')
            .replace(
              'useProvidedStore(settingsToken, state => state.theme)',
              'useStoreFromProvider(settingsToken).theme'
            )
        },
        {
          signature: 'useProvidedStore(token, selector, isEqual?)',
          summary: t(
            'Resolve a Store from this Provider and subscribe to selected fields in the Store graph.',
            '从本提供者解析存储，并在源依赖图中订阅选定字段。'
          ),
          params: {
            token,
            selector: t(
              'Synchronous selector receiving the resolved Store state and returning render data; throws reach render.',
              '同步选择器接收解析所得存储状态并返回渲染数据，抛错进入渲染。'
            ),
            isEqual: equality
          },
          returns: t(
            'Current selected value, preserving equal snapshots with the supplied comparator.',
            '返回当前选择值，通过所选比较器保留相等快照。'
          ),
          example: injectionExample
        },
        {
          signature: 'useStoreConfig()',
          summary: t(
            'Read this Provider normalized configuration without inheriting Store construction options automatically.',
            '读取本提供者归一化配置，不自动继承为存储构造选项。'
          ),
          returns: t(
            'IStoreConfigValue from the nearest configuration Provider, otherwise null.',
            '返回最近配置提供者的归一化配置，否则为空值。'
          ),
          example:
            'function Flags() { const config = useStoreConfig(); return <span>{String(config?.features.wasm ?? false)}</span> }\nfunction App() { return <StoreProvider><Flags /></StoreProvider> }'
        },
        {
          signature: 'useStoreFeature(path)',
          summary: t(
            'Read one explicitly enabled flag from this Provider feature snapshot.',
            '从本提供者特性快照读取一个显式启用开关。'
          ),
          params: { path },
          returns: t(
            'Enabled boolean; false when no Provider configuration exists.',
            '返回启用布尔值，没有提供者配置时为假。'
          ),
          example:
            "function Charts() { return useStoreFeature('experimental.charts') ? <canvas /> : null }\nfunction App() { return <StoreProvider config={{ features: { experimental: { charts: true } } }}><Charts /></StoreProvider> }"
        },
        {
          signature: 'useAssertStoreFeature(path, apiName?)',
          summary: t(
            'Reject a component feature entry when this Provider has not explicitly enabled the requested flag.',
            '本提供者未显式启用请求开关时拒绝组件特性入口。'
          ),
          params: {
            path,
            apiName: t(
              'Optional application API label for diagnostics, defaulting to this API.',
              '可选应用接口诊断标签，默认使用通用接口名称。'
            )
          },
          returns: t(
            'Nothing on admission; otherwise throws the missing-Provider or disabled-feature error.',
            '接纳时无返回值，否则抛提供者缺失或特性关闭错误。'
          ),
          example:
            "function Charts() { useAssertStoreFeature('experimental.charts', 'Charts'); return <canvas /> }\nfunction App() { return <StoreProvider config={{ features: { experimental: { charts: true } } }}><Charts /></StoreProvider> }"
        }
      ],
      behaviors: [
        t(
          'Direct Store and Signal hooks retain their source Runtime. Atom protocol hooks with a definition bridge route to the Provider AtomStore; unregistering the component releases subscriptions without disposing borrowed sources.',
          '直接存储与信号钩子保留源运行时；带定义桥的原子协议钩子转至提供者原子存储，组件卸载只退订，不释放借用源。'
        ),
        t(
          'Readiness blocks the subtree but does not initialize WASM automatically. External registries remain caller-owned unless disposeOnUnmount is true.',
          '就绪屏障阻止子树渲染，但不自动初始化网页汇编；外部登记表保持调用方所有权，除非显式要求卸载释放。'
        )
      ],
      scenarios: [
        t(
          'Provide independent atom state per subtree and gate rendering on application initialization.',
          '按子树提供独立原子状态，并在应用初始化完成后开放渲染。'
        )
      ],
      example: definitionExample
    }
  }
}
